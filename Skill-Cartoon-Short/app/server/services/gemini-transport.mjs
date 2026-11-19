/**
 * Gemini TTS Transport, WAV/PCM Validation & Quota-Safe Fallback Engine (QA-TTS-01)
 *
 * Provenance: Adapted from quocan050302/out-of-step-studio/app/server/gemini-transport.mjs
 * (branch feat/studio-react-vite-migration @ 58426ab0, MIT License).
 *
 * Key QA-TTS-01 fixes over upstream:
 * 1. MIME-aware audio validation: wraps raw `audio/L16` PCM16 once to RIFF/WAVE;
 *    validates already-packaged `audio/wav` RIFF/WAVE without EVER double-wrapping!
 * 2. Strict silent/truncated/corrupt/oversized/unexpected-MIME rejection.
 * 3. Global/daily 429 quota immediately HALTS without model-hopping.
 */
import crypto from 'node:crypto';
import { DEFAULT_GEMINI_BASE, normalizeModelId, resolveTtsCandidates } from './gemini-models.mjs';
import { keyFingerprint, redactSecrets } from './settings-store.mjs';

export const MAX_TTS_AUDIO_BYTES = 24000 * 2 * 240 + 4096; // ~4 minutes of 24kHz mono PCM16 + header
export const MIN_TTS_PCM_BYTES = 480; // >= 10ms at 24kHz mono PCM16
const SILENCE_RMS_THRESHOLD = 1e-4;

/**
 * Wraps raw signed 16-bit little-endian PCM bytes in a canonical 44-byte RIFF/WAVE header.
 * @param {Buffer} pcm
 * @param {number} [sampleRate=24000]
 * @param {number} [channels=1]
 * @returns {Buffer}
 */
export function wavWrapPcm16(pcm, sampleRate = 24000, channels = 1) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 2 || pcm.length % (channels * 2) !== 0) {
    const err = new Error('INVALID_PCM_BUFFER: PCM16 buffer length must be non-empty and frame-aligned.');
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    const err = new Error(`INVALID_SAMPLE_RATE: Unsupported PCM sample rate ${sampleRate}`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 2) {
    const err = new Error(`INVALID_CHANNELS: Unsupported PCM channel count ${channels}`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function measurePcm16Rms(pcmBuf) {
  const sampleCount = Math.floor(pcmBuf.length / 2);
  if (sampleCount === 0) return { rms: 0, peak: 0 };
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const s = pcmBuf.readInt16LE(i * 2) / 32768;
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
    sumSq += s * s;
  }
  return { rms: Math.sqrt(sumSq / sampleCount), peak };
}

/**
 * Inspects and strictly validates a RIFF/WAVE PCM16 buffer (detecting truncation, non-PCM, bad metadata, silence).
 * @param {Buffer} buf
 * @returns {{ sampleRate: number, channels: number, bitsPerSample: number, dataBytes: number, durationSec: number, rms: number, peak: number }}
 */
export function inspectWavBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) {
    const err = new Error('TRUNCATED_WAV: Buffer smaller than 44-byte RIFF header.');
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF' || buf.subarray(8, 12).toString('ascii') !== 'WAVE') {
    const err = new Error('INVALID_WAV_HEADER: Missing RIFF/WAVE signature.');
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  const riffSize = buf.readUInt32LE(4);
  if (riffSize + 8 > buf.length) {
    const err = new Error(`TRUNCATED_WAV: RIFF header declares ${riffSize + 8} bytes but buffer has ${buf.length}.`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }

  let offset = 12;
  let fmt = null;
  let dataSlice = null;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + chunkSize;
    if (bodyEnd > buf.length) {
      const err = new Error(`TRUNCATED_WAV_CHUNK: Chunk "${chunkId}" exceeds buffer length.`);
      err.code = 'INVALID_OUTPUT';
      throw err;
    }
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        const err = new Error('INVALID_WAV_FMT: fmt chunk too short.');
        err.code = 'INVALID_OUTPUT';
        throw err;
      }
      fmt = {
        audioFormat: buf.readUInt16LE(bodyStart),
        channels: buf.readUInt16LE(bodyStart + 2),
        sampleRate: buf.readUInt32LE(bodyStart + 4),
        bitsPerSample: buf.readUInt16LE(bodyStart + 14),
      };
    } else if (chunkId === 'data') {
      dataSlice = buf.subarray(bodyStart, bodyEnd);
    }
    offset = bodyEnd + (chunkSize % 2);
  }

  if (!fmt || !dataSlice) {
    const err = new Error('INCOMPLETE_WAV: Missing fmt or data chunk.');
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    const err = new Error(`UNSUPPORTED_WAV_ENCODING: Expected PCM16 (format=1, bits=16), got format=${fmt.audioFormat}, bits=${fmt.bitsPerSample}.`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  if (fmt.channels < 1 || fmt.channels > 2 || fmt.sampleRate < 8000 || fmt.sampleRate > 96000) {
    const err = new Error(`UNSUPPORTED_WAV_PARAMS: channels=${fmt.channels}, sampleRate=${fmt.sampleRate}.`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  const frameAlign = fmt.channels * 2;
  if (dataSlice.length < MIN_TTS_PCM_BYTES || dataSlice.length % frameAlign !== 0) {
    const err = new Error(`INVALID_WAV_DATA_LENGTH: ${dataSlice.length} bytes.`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  // Reject double-wrapped WAV where inner payload begins with another RIFF/WAVE header
  if (
    dataSlice.length >= 12 &&
    dataSlice.subarray(0, 4).toString('ascii') === 'RIFF' &&
    dataSlice.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    const err = new Error('DOUBLE_WRAPPED_WAV_DETECTED: Data payload contains nested RIFF/WAVE header.');
    err.code = 'INVALID_OUTPUT';
    throw err;
  }

  const { rms, peak } = measurePcm16Rms(dataSlice);
  if (rms < SILENCE_RMS_THRESHOLD) {
    const err = new Error(`SILENT_TTS_AUDIO: Audio RMS (${rms.toExponential(2)}) is silent/all-zero.`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }

  const durationSec = dataSlice.length / (fmt.sampleRate * frameAlign);
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    dataBytes: dataSlice.length,
    durationSec: Number(durationSec.toFixed(4)),
    rms: Number(rms.toFixed(6)),
    peak: Number(peak.toFixed(6)),
  };
}

function parseMimeType(rawMime) {
  const parts = String(rawMime || '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const essence = (parts[0] || '').toLowerCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq > 0) {
      params[parts[i].slice(0, eq).trim().toLowerCase()] = parts[i].slice(eq + 1).trim();
    }
  }
  return { essence, params };
}

/**
 * Validates a Gemini `generateContent` TTS response and extracts a verified RIFF/WAVE Buffer.
 * Distinguishes raw PCM (`audio/L16`) from already-wrapped WAV (`audio/wav`) and never double-wraps.
 * @param {object} json
 * @returns {{ wav: Buffer, mimeType: string, alreadyWrapped: boolean, metadata: object }}
 */
export function validateTtsAudioResponse(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const audioPart = parts.find((p) => p?.inlineData && typeof p.inlineData.data === 'string');
  if (!audioPart) {
    const err = new Error('NO_AUDIO_DATA: Model returned no inlineData audio payload.');
    err.code = 'INVALID_OUTPUT';
    throw err;
  }

  const rawMime = String(audioPart.inlineData.mimeType || '').trim();
  const { essence, params } = parseMimeType(rawMime);
  const allowedPcm = essence === 'audio/l16' || essence === 'audio/pcm' || essence === 'audio/x-pcm';
  const allowedWav = essence === 'audio/wav' || essence === 'audio/x-wav' || essence === 'audio/wave';
  if (!allowedPcm && !allowedWav) {
    const err = new Error(`UNSUPPORTED_AUDIO_MIME: Received "${rawMime || '(empty)'}", expected audio/L16 or audio/wav.`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }

  const cleanB64 = audioPart.inlineData.data.replace(/\s+/g, '');
  if (!cleanB64 || cleanB64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanB64)) {
    const err = new Error('MALFORMED_BASE64_AUDIO: Invalid base64 encoding in inlineData.data.');
    err.code = 'INVALID_OUTPUT';
    throw err;
  }

  const rawBuf = Buffer.from(cleanB64, 'base64');
  if (rawBuf.length < MIN_TTS_PCM_BYTES) {
    const err = new Error(`AUDIO_TOO_SHORT: Decoded payload is only ${rawBuf.length} bytes.`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }
  if (rawBuf.length > MAX_TTS_AUDIO_BYTES) {
    const err = new Error(`AUDIO_OVERSIZED: Decoded payload (${rawBuf.length} bytes) exceeds cap (${MAX_TTS_AUDIO_BYTES}).`);
    err.code = 'INVALID_OUTPUT';
    throw err;
  }

  const hasRiffHeader =
    rawBuf.length >= 12 &&
    rawBuf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    rawBuf.subarray(8, 12).toString('ascii') === 'WAVE';

  if (allowedWav || hasRiffHeader) {
    const metadata = inspectWavBuffer(rawBuf);
    return {
      wav: rawBuf,
      mimeType: rawMime || 'audio/wav',
      alreadyWrapped: true,
      metadata,
    };
  }

  const rate = params.rate ? Number.parseInt(params.rate, 10) : 24000;
  const channels = params.channels ? Number.parseInt(params.channels, 10) : 1;
  const wav = wavWrapPcm16(rawBuf, rate, channels);
  const metadata = inspectWavBuffer(wav);
  return {
    wav,
    mimeType: rawMime,
    alreadyWrapped: false,
    metadata,
  };
}

function parseRetryDelayMs(json, retryAfterHeader) {
  if (retryAfterHeader) {
    const sec = Number.parseFloat(retryAfterHeader);
    if (Number.isFinite(sec) && sec >= 0) return Math.round(sec * 1000);
  }
  const details = Array.isArray(json?.error?.details) ? json.error.details : [];
  for (const d of details) {
    if (typeof d?.retryDelay === 'string') {
      const m = /^(\d+(?:\.\d+)?)(ms|s)$/i.exec(d.retryDelay.trim());
      if (m) {
        const val = Number.parseFloat(m[1]);
        return m[2].toLowerCase() === 'ms' ? Math.round(val) : Math.round(val * 1000);
      }
    }
  }
  return null;
}

function inspectQuotaScope(json, fallbackMessage = '') {
  const details = Array.isArray(json?.error?.details) ? json.error.details : [];
  const parts = [String(json?.error?.message || fallbackMessage || '')];
  let hasModelDimension = false;
  for (const d of details) {
    if (Array.isArray(d?.violations)) {
      for (const v of d.violations) {
        if (v?.quotaDimensions?.model) hasModelDimension = true;
        parts.push(String(v?.quotaId || ''), String(v?.quotaMetric || ''), JSON.stringify(v?.quotaDimensions || {}));
      }
    }
  }
  const combined = parts.join(' ');
  if (
    /\b(per[_ -]?day|daily|GenerateRequestsPerDay|plan and billing|billing account|project[_ -]?quota|global[_ -]?quota|account quota)\b/i.test(
      combined
    ) &&
    !/PerMinutePerProjectPerModel/i.test(combined)
  ) {
    return 'global';
  }
  if (
    hasModelDimension ||
    /\b(PerMinutePerProjectPerModel|PerModel|per[_ -]?model|RPM|TPM|for model|model rate limit)\b/i.test(combined)
  ) {
    return 'model';
  }
  return 'unknown';
}

/**
 * Classifies Gemini transport errors to prevent bypassing global quotas and auth errors.
 * @param {Error} err
 * @returns {{ category: string, retryable: boolean, fallbackEligible: boolean, maxRetries: number, cooldownMs?: number, rediscoverOnce?: boolean, summary: string }}
 */
export function classifyGeminiError(err) {
  const status = Number(err?.status || 0);
  const grpc = String(err?.grpcStatus || '').toUpperCase();
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');

  if (code === 'NO_API_KEY') {
    return { category: 'no_key', retryable: false, fallbackEligible: false, maxRetries: 0, summary: 'No Gemini API key configured.' };
  }
  if (err?.name === 'AbortError' || code === 'ABORTED') {
    return { category: 'aborted', retryable: false, fallbackEligible: false, maxRetries: 0, summary: 'Request canceled.' };
  }
  if (status === 401 || grpc === 'UNAUTHENTICATED' || /API_KEY_INVALID|invalid authentication/i.test(msg)) {
    return { category: 'auth', retryable: false, fallbackEligible: false, maxRetries: 0, summary: 'Invalid Gemini API key (HTTP 401).' };
  }
  if (status === 403 || grpc === 'PERMISSION_DENIED') {
    return { category: 'permission', retryable: false, fallbackEligible: false, maxRetries: 0, summary: 'Gemini permission or billing denied (HTTP 403).' };
  }
  if (status === 429 || grpc === 'RESOURCE_EXHAUSTED') {
    const scope = err?.quotaScope || inspectQuotaScope({ error: { details: err?.errorDetails, message: msg } }, msg);
    if (scope === 'global' || (Number.isFinite(err?.retryAfterMs) && err.retryAfterMs > 60_000)) {
      return {
        category: 'quota_global',
        retryable: false,
        fallbackEligible: false,
        maxRetries: 0,
        summary: 'Project or daily Gemini quota exhausted (HTTP 429). Halted without model-hopping.',
      };
    }
    if (scope === 'unknown') {
      return {
        category: 'quota_global',
        retryable: false,
        fallbackEligible: false,
        maxRetries: 0,
        summary: 'Gemini quota/rate limit reached (HTTP 429, unknown scope). Halted to protect project quota.',
      };
    }
    return {
      category: 'rate_limited_model',
      retryable: true,
      fallbackEligible: true,
      maxRetries: 1,
      cooldownMs: Math.max(err?.retryAfterMs || 0, 45_000),
      summary: 'Model-specific rate limit (HTTP 429); retrying once or switching eligible TTS model.',
    };
  }
  if (status === 503 || status === 529 || grpc === 'UNAVAILABLE' || /overloaded|unavailable/i.test(msg)) {
    return {
      category: 'overload',
      retryable: true,
      fallbackEligible: true,
      maxRetries: 1,
      cooldownMs: 60_000,
      summary: 'Gemini model overloaded (HTTP 503).',
    };
  }
  if (status === 404 || grpc === 'NOT_FOUND') {
    return {
      category: 'unsupported',
      retryable: false,
      fallbackEligible: true,
      rediscoverOnce: true,
      maxRetries: 0,
      cooldownMs: 300_000,
      summary: 'Model not found (HTTP 404); refreshing catalog.',
    };
  }
  if (code === 'SAFETY_BLOCKED' || code === 'INVALID_OUTPUT') {
    return { category: code.toLowerCase(), retryable: false, fallbackEligible: false, maxRetries: 0, summary: msg };
  }
  if (status === 400 || grpc === 'INVALID_ARGUMENT' || code === 'INVALID_MODEL_ID') {
    return { category: 'invalid_request', retryable: false, fallbackEligible: false, maxRetries: 0, summary: msg };
  }
  if (err?.isTimeout || status === 408 || grpc === 'DEADLINE_EXCEEDED') {
    return { category: 'timeout', retryable: true, fallbackEligible: true, maxRetries: 1, cooldownMs: 30_000, summary: msg };
  }
  if (status >= 500 || code === 'NON_JSON' || status === 0) {
    return { category: 'transient', retryable: true, fallbackEligible: true, maxRetries: 1, cooldownMs: 20_000, summary: msg };
  }
  return { category: 'fatal', retryable: false, fallbackEligible: false, maxRetries: 0, summary: msg };
}

/**
 * Performs a single bounded Gemini `generateContent` HTTP call with header auth and secret redaction.
 * @param {object} opts
 */
export async function geminiGenerate({
  apiKey,
  model,
  parts,
  generationConfig,
  baseUrl = DEFAULT_GEMINI_BASE,
  timeoutMs = 60_000,
  signal,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
}) {
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey) {
    const err = new Error('NO_API_KEY: No Gemini API key configured.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const normalizedModel = normalizeModelId(model);
  if (signal?.aborted) throw new DOMException('Operation aborted', 'AbortError');

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const url = `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
  const t0 = clock();

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': cleanKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        ...(generationConfig ? { generationConfig } : {}),
      }),
      signal: combinedSignal,
    });
  } catch (fetchErr) {
    if (signal?.aborted) throw new DOMException('Operation aborted', 'AbortError');
    const isTimeout = timeoutSignal.aborted || fetchErr?.name === 'TimeoutError' || /timed?\s*out/i.test(String(fetchErr?.message || ''));
    const err = new Error(
      isTimeout
        ? `Gemini TTS timed out after ${Math.round(timeoutMs / 1000)}s on ${normalizedModel}.`
        : `Gemini network error on ${normalizedModel}: ${redactSecrets(fetchErr?.message || fetchErr, [cleanKey])}`
    );
    err.isTimeout = isTimeout;
    err.status = isTimeout ? 408 : 0;
    err.latencyMs = Math.max(0, clock() - t0);
    throw err;
  }

  const latencyMs = Math.max(0, clock() - t0);
  const rawText = await res.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    const err = new Error(`Gemini returned non-JSON (HTTP ${res.status}): ${redactSecrets(rawText.slice(0, 180), [cleanKey])}`);
    err.status = res.status;
    err.code = 'NON_JSON';
    err.latencyMs = latencyMs;
    throw err;
  }

  if (!res.ok) {
    const msg = redactSecrets(json?.error?.message || rawText.slice(0, 220), [cleanKey]);
    const err = new Error(`Gemini HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.grpcStatus = String(json?.error?.status || '');
    err.retryAfterMs = parseRetryDelayMs(json, res.headers?.get?.('retry-after'));
    err.quotaScope = res.status === 429 ? inspectQuotaScope(json, msg) : null;
    err.errorDetails = Array.isArray(json?.error?.details) ? json.error.details : [];
    err.latencyMs = latencyMs;
    throw err;
  }

  const blockReason = json?.promptFeedback?.blockReason;
  const finishReason = json?.candidates?.[0]?.finishReason;
  if (blockReason || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(String(finishReason || ''))) {
    const err = new Error(`Gemini blocked TTS output due to content policy (${blockReason || finishReason}).`);
    err.code = 'SAFETY_BLOCKED';
    err.status = 200;
    err.latencyMs = latencyMs;
    throw err;
  }

  return { status: res.status, data: json, latencyMs };
}

export class ModelHealthRegistry {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.cooldowns = new Map();
  }
  markCooldown(keyFp, modelId, { durationMs = 60_000, reason = 'overload' } = {}) {
    if (!keyFp || !modelId || durationMs <= 0) return;
    this.cooldowns.set(`${keyFp}:${modelId}`, { until: this.clock() + durationMs, reason });
  }
  getCooldown(keyFp, modelId) {
    if (!keyFp || !modelId) return null;
    const key = `${keyFp}:${modelId}`;
    const entry = this.cooldowns.get(key);
    if (!entry) return null;
    if (this.clock() >= entry.until) {
      this.cooldowns.delete(key);
      return null;
    }
    return entry;
  }
  clear() {
    this.cooldowns.clear();
  }
}

function defaultSleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Operation aborted', 'AbortError'));
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Operation aborted', 'AbortError'));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Creates a bounded concurrency Gemini TTS execution engine with quota-safe fallback.
 */
export function createGeminiTtsExecutor({
  catalogService,
  healthRegistry = new ModelHealthRegistry(),
  baseUrl = DEFAULT_GEMINI_BASE,
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
  clock = () => Date.now(),
  maxConcurrent = 2,
  attemptTimeoutMs = 45_000,
  totalDeadlineMs = 90_000,
  baseRetryDelayMs = 400,
} = {}) {
  let active = 0;
  const waiters = [];

  async function acquireSlot(signal) {
    if (signal?.aborted) throw new DOMException('Operation aborted', 'AbortError');
    if (active < maxConcurrent) {
      active += 1;
    } else {
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          const i = waiters.indexOf(wake);
          if (i >= 0) waiters.splice(i, 1);
          reject(new DOMException('Operation aborted', 'AbortError'));
        };
        const wake = () => {
          signal?.removeEventListener('abort', onAbort);
          active += 1;
          resolve();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        waiters.push(wake);
      });
    }
    let released = false;
    return () => {
      if (!released) {
        released = true;
        active -= 1;
        const next = waiters.shift();
        if (next) next();
      }
    };
  }

  async function synthesize({ apiKey, text, voiceName, settings, signal }) {
    const traceId = crypto.randomBytes(6).toString('hex');
    const startedAt = clock();
    const deadlineAt = startedAt + totalDeadlineMs;
    const keyFp = keyFingerprint(apiKey);
    const attemptedModels = [];

    if (!apiKey) {
      return {
        ok: false,
        blocked: true,
        traceId,
        reasonCategory: 'no_key',
        error: 'NO_API_KEY: Configure GEMINI_API_KEY in environment or Studio Settings to synthesize live Gemini TTS.',
        attemptedModels,
      };
    }

    const release = await acquireSlot(signal);
    try {
      const catalog = await catalogService.listModels(apiKey, { signal });
      let selection = resolveTtsCandidates(catalog.models, {
        policy: settings?.gemini?.modelPolicy || 'quality',
        includePreview: settings?.gemini?.includePreview !== false,
        selectionMode: settings?.gemini?.selectionMode || 'auto',
        manualModel: settings?.gemini?.ttsModel || '',
        healthRegistry,
        keyFp,
        maxCandidates: 3,
      });

      if (selection.manualRejectedReason) {
        return {
          ok: false,
          traceId,
          reasonCategory: 'invalid_request',
          error: selection.manualRejectedReason,
          attemptedModels,
        };
      }
      if (selection.candidates.length === 0) {
        return {
          ok: false,
          blocked: true,
          traceId,
          reasonCategory: 'no_tts_models',
          error: 'NO_TTS_MODELS: Account catalog returned zero TTS-capable generateContent models.',
          attemptedModels,
        };
      }

      let queue = selection.candidates.slice();
      const tried = new Set();
      let rediscovered = false;
      let lastErr = null;
      let lastClass = null;

      while (queue.length > 0 && clock() < deadlineAt) {
        const candidate = queue.shift();
        if (!candidate || tried.has(candidate.id)) continue;
        tried.add(candidate.id);

        let attempt = 0;
        let maxAttempts = 1;
        while (attempt < maxAttempts && clock() < deadlineAt) {
          attempt += 1;
          const remaining = Math.max(1000, deadlineAt - clock());
          const t0 = clock();
          try {
            const res = await geminiGenerate({
              apiKey,
              model: candidate.id,
              parts: [{ text }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName },
                  },
                },
              },
              baseUrl,
              timeoutMs: Math.min(attemptTimeoutMs, remaining),
              signal,
              fetchImpl,
              clock,
            });
            const validated = validateTtsAudioResponse(res.data);
            attemptedModels.push({
              model: candidate.id,
              attempt,
              elapsedMs: Math.max(0, clock() - t0),
              statusCode: res.status,
              outcome: 'success',
            });
            return {
              ok: true,
              traceId,
              model: candidate.id,
              preferredModel: selection.preferredModel || candidate.id,
              downgraded: candidate.id !== (selection.preferredModel || candidate.id),
              latencyMs: Math.max(0, clock() - startedAt),
              attemptedModels,
              ...validated,
            };
          } catch (err) {
            if (err?.name === 'AbortError' || signal?.aborted) {
              throw new DOMException('Operation aborted', 'AbortError');
            }
            const info = classifyGeminiError(err);
            lastErr = err;
            lastClass = info;
            attemptedModels.push({
              model: candidate.id,
              attempt,
              elapsedMs: Math.max(0, clock() - t0),
              statusCode: err?.status || 0,
              classification: info.category,
              outcome: 'failed',
              message: redactSecrets(err?.message || info.summary, [apiKey]).slice(0, 180),
            });

            if (info.retryable && attempt <= info.maxRetries) {
              maxAttempts = info.maxRetries + 1;
              const waitMs = Math.min(3000, Math.max(baseRetryDelayMs * attempt, err?.retryAfterMs || 0));
              if (clock() + waitMs < deadlineAt) {
                await sleepImpl(waitMs, signal);
                continue;
              }
            }

            if (info.cooldownMs) {
              healthRegistry.markCooldown(keyFp, candidate.id, { durationMs: info.cooldownMs, reason: info.category });
            }
            if (info.rediscoverOnce && !rediscovered) {
              rediscovered = true;
              try {
                const fresh = await catalogService.listModels(apiKey, { signal, forceRefresh: true });
                selection = resolveTtsCandidates(fresh.models, {
                  policy: settings?.gemini?.modelPolicy || 'quality',
                  includePreview: settings?.gemini?.includePreview !== false,
                  selectionMode: settings?.gemini?.selectionMode || 'auto',
                  manualModel: settings?.gemini?.ttsModel || '',
                  healthRegistry,
                  keyFp,
                  maxCandidates: 4,
                });
                queue = selection.candidates.filter((c) => !tried.has(c.id));
              } catch {
                // Keep remaining queue
              }
            }
            if (!info.fallbackEligible) {
              queue = [];
            }
            break;
          }
        }
      }

      return {
        ok: false,
        blocked: ['no_key', 'quota_global', 'auth', 'permission'].includes(lastClass?.category || ''),
        traceId,
        reasonCategory: lastClass?.category || 'fatal',
        error: redactSecrets(lastErr?.message || lastClass?.summary || 'Gemini TTS failed.', [apiKey]),
        latencyMs: Math.max(0, clock() - startedAt),
        attemptedModels,
      };
    } catch (outerErr) {
      if (outerErr?.name === 'AbortError' || signal?.aborted) {
        return { ok: false, aborted: true, traceId, reasonCategory: 'aborted', error: 'Request canceled.', attemptedModels };
      }
      const info = classifyGeminiError(outerErr);
      return {
        ok: false,
        blocked: ['no_key', 'quota_global', 'auth', 'permission'].includes(info.category),
        traceId,
        reasonCategory: info.category,
        error: redactSecrets(outerErr?.message || info.summary, [apiKey]),
        attemptedModels,
      };
    } finally {
      release();
    }
  }

  return { synthesize };
}
