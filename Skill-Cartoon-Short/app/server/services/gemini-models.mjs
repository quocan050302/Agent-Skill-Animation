/**
 * Gemini TTS Model Discovery, Classification & Ranking (QA-TTS-01)
 *
 * Provenance: Adapted from quocan050302/out-of-step-studio/app/server/gemini-models.mjs
 * (branch feat/studio-react-vite-migration @ 58426ab0, MIT License).
 * Narrowed strictly to TTS-capable generateContent models for Cartoon Short Studio.
 */
import { VALID_MODEL_ID_RE, keyFingerprint, redactSecrets } from './settings-store.mjs';

export const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_DISCOVERY_TTL_MS = 5 * 60 * 1000;
export const MAX_DISCOVERY_PAGES = 15;

const TIER_SCORES_BY_POLICY = {
  quality: { pro: 300, flash: 200, 'flash-lite': 100 },
  balanced: { flash: 300, 'flash-lite': 200, pro: 100 },
  fast: { 'flash-lite': 300, flash: 200, pro: 100 },
};

/**
 * Normalizes and validates a Gemini model ID (stripping optional "models/" prefix).
 * @param {string} rawName
 * @returns {string}
 */
export function normalizeModelId(rawName) {
  const raw = String(rawName || '').trim();
  if (!raw) {
    const err = new Error('Model identifier is empty.');
    err.code = 'INVALID_MODEL_ID';
    throw err;
  }
  const stripped = raw.replace(/^models\//i, '');
  if (!VALID_MODEL_ID_RE.test(stripped)) {
    const err = new Error(`Invalid model identifier: "${stripped.slice(0, 64)}"`);
    err.code = 'INVALID_MODEL_ID';
    throw err;
  }
  return stripped;
}

function parseFamilyVersion(id) {
  const m = /^gemini-(?:omni-)?(\d+(?:\.\d+)?)(?=-|$)/i.exec(id);
  if (!m) return 0;
  const num = Number.parseFloat(m[1]);
  return Number.isFinite(num) ? num : 0;
}

function parseRevision(id) {
  const m = /-(\d{3})$/.exec(id);
  return m ? Number.parseInt(m[1], 10) : 0;
}

/**
 * Classifies a raw Gemini `/models` catalog object strictly for TTS capability.
 * Rejects deprecated, live-only, embedding, image/video/music, transcription, and non-TTS models.
 * @param {object} rawModel
 * @returns {object|null}
 */
export function classifyGeminiModel(rawModel) {
  if (!rawModel || typeof rawModel !== 'object') return null;

  let id;
  try {
    id = normalizeModelId(rawModel.name || rawModel.id || rawModel.baseModelId || '');
  } catch {
    return null;
  }

  const displayName = String(rawModel.displayName || id).trim();
  const description = String(rawModel.description || '').trim();
  const methodsRaw = Array.isArray(rawModel.supportedGenerationMethods)
    ? rawModel.supportedGenerationMethods
    : Array.isArray(rawModel.supportedActions)
      ? rawModel.supportedActions
      : [];
  const methods = methodsRaw.map((m) => String(m));
  const explicitModalities = Array.isArray(rawModel.supportedOutputModalities)
    ? rawModel.supportedOutputModalities.map((x) => String(x).toUpperCase())
    : null;

  const metaText = `${displayName} ${description}`;
  const supportsGenerateContent = methods.includes('generateContent');
  const isDeprecated = /\b(deprecated|decommissioned|discontinued|rerouted|obsolete|sunset)\b/i.test(metaText);
  const isEmbedding = methods.includes('embedContent') || /embedding/i.test(id);
  const isLiveOnly =
    (!supportsGenerateContent && methods.includes('bidiGenerateContent')) ||
    /-(live|native-audio)(?:-|$)/i.test(id);
  const isImageGen =
    /(-image(?:-|$)|^imagen(?:-|$)|nano-banana)/i.test(id) ||
    /\b(nano banana|image generation)\b/i.test(metaText);
  const isVideoOrMusic =
    /^(veo|lyria)(?:-|$)/i.test(id) ||
    methods.includes('bidiGenerateMusic') ||
    methods.includes('predictLongRunning');
  const isTranscribeOnly = /-transcribe(?:-|$)/i.test(id);
  const isSpecializedAgent =
    /^(antigravity|deep-research|aqa)(?:-|$)|-(robotics|computer-use|customtools|decision)(?:-|$)/i.test(id) ||
    (!supportsGenerateContent && methods.includes('generateAnswer'));

  const hasTtsId = /-tts(?:-|$)/i.test(id);
  const explicitAudioOnly = Boolean(
    explicitModalities && explicitModalities.includes('AUDIO') && !explicitModalities.includes('TEXT')
  );
  const explicitNoAudio = Boolean(explicitModalities && !explicitModalities.includes('AUDIO'));

  const isTts = supportsGenerateContent && !explicitNoAudio && (hasTtsId || explicitAudioOnly);

  let exclusionReason = null;
  if (!supportsGenerateContent) exclusionReason = 'no_generate_content';
  else if (isDeprecated) exclusionReason = 'deprecated_or_rerouted';
  else if (isEmbedding) exclusionReason = 'embedding_only';
  else if (isLiveOnly) exclusionReason = 'live_streaming_only';
  else if (isImageGen) exclusionReason = 'image_generation_only';
  else if (isVideoOrMusic) exclusionReason = 'media_generation_only';
  else if (isTranscribeOnly) exclusionReason = 'transcription_only';
  else if (isSpecializedAgent) exclusionReason = 'specialized_agent';
  else if (!isTts) exclusionReason = 'not_tts_capable';

  let tier = 'other';
  if (isTts) {
    if (/-pro(?:-|$)/i.test(id)) tier = 'pro';
    else if (/-flash-lite(?:-|$)/i.test(id)) tier = 'flash-lite';
    else tier = 'flash';
  }

  const isPreview =
    /-(preview|exp|experimental)(?:-|$)/i.test(id) || /\b(preview|experimental)\b/i.test(displayName);
  const isRollingAlias = /-latest$/i.test(id);
  const familyVersion = parseFamilyVersion(id);
  const revision = parseRevision(id);
  const ttsEligible = exclusionReason === null && isTts;

  return {
    id,
    name: `models/${id}`,
    displayName,
    description: description.slice(0, 240),
    supportedGenerationMethods: methods,
    tier,
    familyVersion,
    revision,
    isPreview,
    isStable: !isPreview,
    isRollingAlias,
    isDeprecated,
    isTts,
    exclusionReason,
    capabilities: {
      tts: ttsEligible,
    },
  };
}

/**
 * Deterministically ranks TTS-eligible Gemini models according to policy and stability.
 * @param {object[]} catalog
 * @param {{ policy?: 'quality'|'balanced'|'fast', includePreview?: boolean }} [opts]
 * @returns {object[]}
 */
export function rankGeminiModels(catalog, { policy = 'quality', includePreview = true } = {}) {
  const tierMap = TIER_SCORES_BY_POLICY[policy] || TIER_SCORES_BY_POLICY.quality;
  const items = Array.isArray(catalog)
    ? catalog.map((m) => (m?.capabilities ? m : classifyGeminiModel(m))).filter(Boolean)
    : [];

  const ttsCapable = items.filter((m) => m.capabilities?.tts === true);
  const stableItems = ttsCapable.filter((m) => m.isStable);
  const pool = includePreview || stableItems.length === 0 ? ttsCapable : stableItems;

  const sorted = pool.slice().sort((a, b) => {
    const eraRank = (m) => (m.familyVersion === 0 || m.familyVersion >= 2.0 ? 2 : 1);
    const eraDiff = eraRank(b) - eraRank(a);
    if (eraDiff !== 0) return eraDiff;

    const tierDiff = (tierMap[b.tier] || 0) - (tierMap[a.tier] || 0);
    if (tierDiff !== 0) return tierDiff;

    const stabilityRank = (m) => (m.isStable ? (m.isRollingAlias ? 1 : 2) : 0);
    const stabDiff = stabilityRank(b) - stabilityRank(a);
    if (stabDiff !== 0) return stabDiff;

    if (b.familyVersion !== a.familyVersion) return b.familyVersion - a.familyVersion;
    if (b.revision !== a.revision) return b.revision - a.revision;
    return a.id.localeCompare(b.id);
  });

  return sorted.map((m, index) => ({
    ...m,
    rank: index + 1,
    rankRationale: `policy=${policy}; tier=${m.tier}; stability=${m.isStable ? 'stable' : 'preview'}; family=${m.familyVersion || 'alias'}`,
  }));
}

/**
 * Resolves ordered TTS model candidates honoring manual selection, cooldown health, and TTS capability guard.
 * @param {object[]} catalog
 * @param {{ policy?: string, includePreview?: boolean, selectionMode?: 'auto'|'manual', manualModel?: string, healthRegistry?: object, keyFp?: string, maxCandidates?: number }} [opts]
 * @returns {{ candidates: object[], preferredModel: string|null, manualRejectedReason: string|null }}
 */
export function resolveTtsCandidates(
  catalog,
  {
    policy = 'quality',
    includePreview = true,
    selectionMode = 'auto',
    manualModel = '',
    healthRegistry = null,
    keyFp = '',
    maxCandidates = 3,
  } = {}
) {
  const classified = Array.isArray(catalog)
    ? catalog.map((m) => (m?.capabilities ? m : classifyGeminiModel(m))).filter(Boolean)
    : [];
  const ranked = rankGeminiModels(classified, { policy, includePreview });

  if (selectionMode === 'manual' && manualModel) {
    const normalized = normalizeModelId(manualModel);
    const hit = classified.find((m) => m.id === normalized);
    if (hit && !hit.capabilities.tts) {
      return {
        candidates: [],
        preferredModel: normalized,
        manualRejectedReason: `MODEL_NOT_TTS_CAPABLE: "${normalized}" cannot generate TTS audio (${hit.exclusionReason || 'not_tts'}).`,
      };
    }
    if (hit) {
      return {
        candidates: [{ ...hit, rank: 1 }],
        preferredModel: hit.id,
        manualRejectedReason: null,
      };
    }
    // If catalog hasn't listed the manually typed ID, still refuse obvious non-TTS models.
    const synthetic = classifyGeminiModel({ name: `models/${normalized}`, supportedGenerationMethods: ['generateContent'] });
    if (!synthetic?.capabilities?.tts) {
      return {
        candidates: [],
        preferredModel: normalized,
        manualRejectedReason: `MODEL_NOT_TTS_CAPABLE: "${normalized}" does not match a supported Gemini TTS model.`,
      };
    }
    return {
      candidates: [{ ...synthetic, rank: 1 }],
      preferredModel: normalized,
      manualRejectedReason: null,
    };
  }

  const healthy = [];
  const cooling = [];
  for (const m of ranked) {
    const cd = healthRegistry?.getCooldown?.(keyFp, m.id);
    if (cd) cooling.push(m);
    else healthy.push(m);
  }
  const ordered = [...healthy, ...cooling].slice(0, maxCandidates);
  return {
    candidates: ordered,
    preferredModel: ranked[0]?.id || null,
    manualRejectedReason: null,
  };
}

/**
 * Fetches paginated model metadata from Gemini `/v1beta/models` using header authentication.
 * @param {string} apiKey
 * @param {object} [opts]
 * @returns {Promise<{ models: object[], ttsModels: object[], pagesFetched: number, totalDiscovered: number }>}
 */
export async function fetchGeminiModelCatalog(
  apiKey,
  {
    baseUrl = DEFAULT_GEMINI_BASE,
    fetchImpl = globalThis.fetch,
    signal,
    timeoutMs = 20_000,
    pageSize = 100,
  } = {}
) {
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey) {
    const err = new Error('NO_API_KEY: No Gemini API key configured. Set GEMINI_API_KEY or configure in Settings.');
    err.status = 0;
    err.code = 'NO_API_KEY';
    throw err;
  }

  const seenIds = new Map();
  const seenTokens = new Set();
  let pageToken = '';
  let pagesFetched = 0;

  while (pagesFetched < MAX_DISCOVERY_PAGES) {
    if (signal?.aborted) throw new DOMException('Operation aborted', 'AbortError');
    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/models`);
    url.searchParams.set('pageSize', String(pageSize));
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const reqSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    let res;
    try {
      res = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { 'x-goog-api-key': cleanKey },
        signal: reqSignal,
      });
    } catch (fetchErr) {
      if (signal?.aborted) throw fetchErr;
      const err = new Error(
        `GEMINI_DISCOVERY_NETWORK_ERROR: ${redactSecrets(fetchErr?.message || fetchErr, [cleanKey])}`
      );
      err.code = 'NETWORK_ERROR';
      err.isTimeout = fetchErr?.name === 'TimeoutError' || fetchErr?.name === 'AbortError';
      throw err;
    }

    const rawText = await res.text();
    let json;
    try {
      json = JSON.parse(rawText);
    } catch {
      const err = new Error(
        `GEMINI_NON_JSON (HTTP ${res.status}): ${redactSecrets(rawText.slice(0, 180), [cleanKey])}`
      );
      err.status = res.status;
      err.code = 'NON_JSON';
      throw err;
    }

    if (!res.ok) {
      const msg = redactSecrets(json?.error?.message || rawText.slice(0, 220), [cleanKey]);
      const err = new Error(`Gemini HTTP ${res.status}: ${msg}`);
      err.status = res.status;
      err.grpcStatus = String(json?.error?.status || '');
      throw err;
    }

    pagesFetched += 1;
    const rawModels = Array.isArray(json?.models) ? json.models : [];
    for (const rawModel of rawModels) {
      const classified = classifyGeminiModel(rawModel);
      if (classified && !seenIds.has(classified.id)) {
        seenIds.set(classified.id, classified);
      }
    }

    const next = typeof json?.nextPageToken === 'string' ? json.nextPageToken.trim() : '';
    if (!next || seenTokens.has(next)) break;
    seenTokens.add(next);
    pageToken = next;
  }

  const models = Array.from(seenIds.values()).sort((a, b) => a.id.localeCompare(b.id));
  const ttsModels = rankGeminiModels(models, { policy: 'quality', includePreview: true });
  return {
    models,
    ttsModels,
    pagesFetched,
    totalDiscovered: models.length,
  };
}

/**
 * Creates a TTL-cached, coalesced Gemini model discovery service partitioned by key fingerprint.
 * @param {object} [opts]
 */
export function createModelCatalogService({
  baseUrl = DEFAULT_GEMINI_BASE,
  fetchImpl = globalThis.fetch,
  cacheTtlMs = DEFAULT_DISCOVERY_TTL_MS,
  clock = () => Date.now(),
  timeoutMs = 20_000,
} = {}) {
  const cacheByKey = new Map();
  const inflightByKey = new Map();

  function invalidate(apiKey = null) {
    if (!apiKey) cacheByKey.clear();
    else cacheByKey.delete(keyFingerprint(apiKey));
  }

  async function listModels(apiKey, { signal, forceRefresh = false } = {}) {
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) {
      const err = new Error('NO_API_KEY: No Gemini API key configured.');
      err.code = 'NO_API_KEY';
      throw err;
    }
    const fp = keyFingerprint(cleanKey);
    const now = clock();
    if (!forceRefresh) {
      const hit = cacheByKey.get(fp);
      if (hit && now - hit.syncedAt < cacheTtlMs) {
        return { ...hit, fromCache: true };
      }
    }
    if (inflightByKey.has(fp)) {
      const shared = await inflightByKey.get(fp);
      return { ...shared, fromCache: !forceRefresh, coalesced: true };
    }
    const promise = (async () => {
      const fetched = await fetchGeminiModelCatalog(cleanKey, { baseUrl, fetchImpl, signal, timeoutMs });
      const entry = {
        keyFp: fp,
        models: fetched.models,
        ttsModels: fetched.ttsModels,
        totalDiscovered: fetched.totalDiscovered,
        pagesFetched: fetched.pagesFetched,
        syncedAt: clock(),
      };
      cacheByKey.set(fp, entry);
      return entry;
    })();
    inflightByKey.set(fp, promise);
    try {
      const res = await promise;
      return { ...res, fromCache: false };
    } finally {
      if (inflightByKey.get(fp) === promise) inflightByKey.delete(fp);
    }
  }

  return { listModels, invalidate };
}
