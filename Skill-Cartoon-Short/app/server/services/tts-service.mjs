/**
 * Project-Scoped Gemini TTS Service (QA-TTS-01)
 *
 * Guarantees:
 * - Never writes a global `tts-output.wav`; every artifact is stored under
 *   `workspace/projects/<projectId>/generated/tts/<unique-hash>.wav` with atomic write+fsync+rename.
 * - Probes generated WAV via FFprobe and produces a normalized 48 kHz stereo WAV for tools/audio/mix.py.
 * - Distinct bounded paths for Voice Preview (<= 150 chars) vs Full Narration (<= 4000 chars).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PROJECT_ROOT, sha256Buffer } from '../../../tools/setup/hydrate.mjs';
import { DEFAULT_VOICE_ID, GEMINI_PREBUILT_VOICES, validateSafeId, validateVoiceId } from '../../shared/contract.mjs';
import {
  atomicWriteSecureSync,
  defaultSettingsDir,
  getSanitizedTtsSettings,
  loadTtsSettings,
  resolveGeminiApiKey,
  updateTtsSettings,
} from './settings-store.mjs';
import { createModelCatalogService, rankGeminiModels } from './gemini-models.mjs';
import { createGeminiTtsExecutor, ModelHealthRegistry } from './gemini-transport.mjs';

export const MAX_PREVIEW_CHARS = 150;
export const MAX_NARRATION_CHARS = 4000;
export const DEFAULT_PREVIEW_SAMPLE_TEXT = 'During World War Two, a secret unit built an army that was not real.';

/**
 * Runs FFprobe on a local audio file and validates single audio stream metadata.
 * @param {string} filePath
 * @returns {{ codec: string, sampleRate: number, channels: number, durationSec: number, byteSize: number }}
 */
export function probeAudioFile(filePath) {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { encoding: 'utf8', timeout: 15_000 }
  );
  const parsed = JSON.parse(raw);
  const audioStreams = (parsed.streams || []).filter((s) => s.codec_type === 'audio');
  const videoStreams = (parsed.streams || []).filter((s) => s.codec_type === 'video');
  if (audioStreams.length !== 1 || videoStreams.length > 0) {
    const err = new Error(
      `INVALID_AUDIO_STREAMS: Expected exactly 1 audio stream and 0 video streams (got audio=${audioStreams.length}, video=${videoStreams.length}).`
    );
    err.code = 'INVALID_AUDIO_STREAMS';
    err.statusCode = 400;
    throw err;
  }
  const s = audioStreams[0];
  const durationSec = Number(s.duration || parsed.format?.duration || 0);
  const sampleRate = Number(s.sample_rate || 0);
  const channels = Number(s.channels || 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0.05) {
    const err = new Error(`INVALID_AUDIO_DURATION: Audio duration (${durationSec}s) is empty or invalid.`);
    err.code = 'INVALID_AUDIO_DURATION';
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    const err = new Error(`INVALID_AUDIO_SAMPLE_RATE: Sample rate ${sampleRate} Hz is outside allowed bounds (8000..192000).`);
    err.code = 'INVALID_AUDIO_SAMPLE_RATE';
    err.statusCode = 400;
    throw err;
  }
  return {
    codec: String(s.codec_name || 'unknown'),
    sampleRate,
    channels,
    durationSec: Number(durationSec.toFixed(4)),
    byteSize: fs.statSync(filePath).size,
  };
}

/**
 * Normalizes an audio file to 48 kHz stereo signed 16-bit PCM WAV via FFmpeg args arrays.
 * @param {string} srcPath
 * @param {string} destWavPath
 * @returns {object}
 */
export function normalizeTo48kStereoWav(srcPath, destWavPath) {
  fs.mkdirSync(path.dirname(destWavPath), { recursive: true });
  const tmp = `${destWavPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp.wav`;
  try {
    execFileSync(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', srcPath, '-vn', '-sn', '-dn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', tmp],
      { stdio: 'pipe', timeout: 60_000 }
    );
    fs.renameSync(tmp, destWavPath);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
  return probeAudioFile(destWavPath);
}

/**
 * Creates the TTS service instance bound to a project root and settings directory.
 * @param {object} [opts]
 */
export function createTtsService({
  projectRoot = PROJECT_ROOT,
  settingsDir = defaultSettingsDir(),
  env = process.env,
  fetchImpl = globalThis.fetch,
  baseUrl,
  clock = () => Date.now(),
} = {}) {
  const catalogService = createModelCatalogService({ fetchImpl, baseUrl, clock });
  const healthRegistry = new ModelHealthRegistry({ clock });
  const executor = createGeminiTtsExecutor({
    catalogService,
    healthRegistry,
    fetchImpl,
    baseUrl,
    clock,
  });

  function resolveGeneratedDir(projectId, sub = 'tts') {
    const safeId = validateSafeId(projectId, 'projectId');
    const base = path.resolve(projectRoot, 'workspace', 'projects', safeId, 'generated', sub);
    const rootBoundary = path.resolve(projectRoot, 'workspace', 'projects') + path.sep;
    if (!base.startsWith(rootBoundary)) {
      throw new Error('PATH_CONFINEMENT_VIOLATION');
    }
    return base;
  }

  function listVoices() {
    const settings = loadTtsSettings(settingsDir);
    const sanitized = getSanitizedTtsSettings(settings, env);
    return {
      provider: 'gemini',
      available: sanitized.hasKey,
      status: sanitized.hasKey ? 'KEY_CONFIGURED_UNVERIFIED' : 'BLOCKED_NO_API_KEY',
      defaultVoice: settings.gemini.defaultVoice || DEFAULT_VOICE_ID,
      voices: GEMINI_PREBUILT_VOICES,
      settings: sanitized,
    };
  }

  async function discoverModels({ forceRefresh = false, signal } = {}) {
    const settings = loadTtsSettings(settingsDir);
    const resolved = resolveGeminiApiKey(settings, env);
    const sanitized = getSanitizedTtsSettings(settings, env);
    if (!resolved.apiKey) {
      return {
        ok: false,
        blocked: true,
        status: 'BLOCKED_NO_API_KEY',
        error: 'NO_API_KEY: Set GEMINI_API_KEY or save a local API key in Settings to discover Gemini TTS models.',
        settings: sanitized,
        models: [],
      };
    }
    try {
      const cat = await catalogService.listModels(resolved.apiKey, { forceRefresh, signal });
      const ranked = rankGeminiModels(cat.models, {
        policy: settings.gemini.modelPolicy,
        includePreview: settings.gemini.includePreview,
      });
      return {
        ok: true,
        status: 'DISCOVERED',
        fromCache: cat.fromCache,
        totalDiscovered: cat.totalDiscovered,
        ttsEligibleCount: ranked.length,
        settings: sanitized,
        models: ranked,
      };
    } catch (err) {
      return {
        ok: false,
        blocked: true,
        status: 'DISCOVERY_FAILED',
        error: err?.message || String(err),
        settings: sanitized,
        models: [],
      };
    }
  }

  async function saveSettings(patch) {
    const res = await updateTtsSettings(patch, { settingsDir });
    if (res.keyChanged) {
      catalogService.invalidate();
      healthRegistry.clear();
    }
    return {
      ok: true,
      keyChanged: res.keyChanged,
      configChanged: res.configChanged,
      settings: getSanitizedTtsSettings(res.settings, env),
    };
  }

  async function synthesizeAndPersist({ projectId, text, voice, mode, modelOverride, signal }) {
    const safeProjectId = validateSafeId(projectId, 'projectId');
    const cleanVoice = validateVoiceId(voice || DEFAULT_VOICE_ID);
    const cleanText = String(text || '').trim();
    const maxLen = mode === 'preview' ? MAX_PREVIEW_CHARS : MAX_NARRATION_CHARS;
    if (!cleanText) {
      const err = new Error('EMPTY_TTS_TEXT: Narration text must not be empty.');
      err.code = 'EMPTY_TTS_TEXT';
      err.statusCode = 400;
      throw err;
    }
    if (cleanText.length > maxLen) {
      const err = new Error(`TTS_TEXT_TOO_LONG: Text length (${cleanText.length}) exceeds ${mode} limit of ${maxLen} characters.`);
      err.code = 'TTS_TEXT_TOO_LONG';
      err.statusCode = 400;
      throw err;
    }

    const settings = loadTtsSettings(settingsDir);
    if (modelOverride) {
      settings.gemini = { ...settings.gemini, selectionMode: 'manual', ttsModel: modelOverride };
    }
    const resolved = resolveGeminiApiKey(settings, env);
    const synthRes = await executor.synthesize({
      apiKey: resolved.apiKey,
      text: cleanText,
      voiceName: cleanVoice,
      settings,
      signal,
    });

    if (!synthRes.ok) {
      return synthRes;
    }

    const sub = mode === 'preview' ? 'tts-previews' : 'tts';
    const outDir = resolveGeneratedDir(safeProjectId, sub);
    const uniqueNonce = crypto.randomBytes(4).toString('hex');
    const digestInput = JSON.stringify({
      projectId: safeProjectId,
      mode,
      voice: cleanVoice,
      model: synthRes.model,
      text: cleanText,
    });
    const shortHash = crypto.createHash('sha256').update(digestInput).digest('hex').slice(0, 14);
    const audioId = `${mode === 'preview' ? 'prev' : 'tts'}-${shortHash}-${uniqueNonce}`;
    const rawWavPath = path.join(outDir, `${audioId}.wav`);
    const normWavPath = path.join(outDir, `${audioId}.48k.wav`);

    atomicWriteSecureSync(rawWavPath, synthRes.wav, { mode: 0o600 });
    const rawProbe = probeAudioFile(rawWavPath);
    const normProbe = mode === 'narration' ? normalizeTo48kStereoWav(rawWavPath, normWavPath) : rawProbe;

    const artifact = {
      audioId,
      projectId: safeProjectId,
      kind: mode === 'preview' ? 'tts-preview' : 'tts-narration',
      provider: 'gemini',
      model: synthRes.model,
      preferredModel: synthRes.preferredModel,
      downgraded: synthRes.downgraded,
      voice: cleanVoice,
      textChars: cleanText.length,
      textSha256: crypto.createHash('sha256').update(cleanText).digest('hex'),
      rawPath: rawWavPath,
      normalizedPath: mode === 'narration' ? normWavPath : rawWavPath,
      sha256: sha256Buffer(synthRes.wav),
      durationSec: rawProbe.durationSec,
      sampleRate: rawProbe.sampleRate,
      channels: rawProbe.channels,
      normalizedSampleRate: normProbe.sampleRate,
      normalizedChannels: normProbe.channels,
      byteSize: rawProbe.byteSize,
      alreadyWrapped: synthRes.alreadyWrapped,
      sourceMimeType: synthRes.mimeType,
      rms: synthRes.metadata.rms,
      peak: synthRes.metadata.peak,
      audioUrl: `/api/projects/${encodeURIComponent(safeProjectId)}/audio/${encodeURIComponent(audioId)}`,
      createdAt: new Date(clock()).toISOString(),
      traceId: synthRes.traceId,
    };

    const metaPath = path.join(outDir, `${audioId}.json`);
    atomicWriteSecureSync(metaPath, Buffer.from(JSON.stringify(artifact, null, 2), 'utf8'), { mode: 0o600 });

    return {
      ok: true,
      traceId: synthRes.traceId,
      attemptedModels: synthRes.attemptedModels,
      artifact,
    };
  }

  /**
   * Generates a bounded ephemeral voice preview WAV for a selected Gemini voice.
   */
  async function generateVoicePreview({ projectId = 'preview-sandbox', text = DEFAULT_PREVIEW_SAMPLE_TEXT, voice = DEFAULT_VOICE_ID, model, signal } = {}) {
    return synthesizeAndPersist({
      projectId,
      text: String(text || DEFAULT_PREVIEW_SAMPLE_TEXT).slice(0, MAX_PREVIEW_CHARS),
      voice,
      mode: 'preview',
      modelOverride: model,
      signal,
    });
  }

  /**
   * Generates full project narration via Gemini TTS and persists a unique per-project WAV + 48 kHz normalized WAV.
   */
  async function generateNarration({ projectId, scriptText, voice = DEFAULT_VOICE_ID, model, signal }) {
    return synthesizeAndPersist({
      projectId,
      text: scriptText,
      voice,
      mode: 'narration',
      modelOverride: model,
      signal,
    });
  }

  return {
    listVoices,
    discoverModels,
    saveSettings,
    generateVoicePreview,
    generateNarration,
    getSettings: () => getSanitizedTtsSettings(loadTtsSettings(settingsDir), env),
  };
}
