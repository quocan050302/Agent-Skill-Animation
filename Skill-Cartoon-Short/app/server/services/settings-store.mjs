/**
 * Secure Local TTS Settings Store & Secret Redaction Utility (QA-TTS-01)
 *
 * Provenance: Adapted from quocan050302/out-of-step-studio (feat/studio-react-vite-migration @ 58426ab0, MIT)
 * Scoped exclusively to Skill-Cartoon-Short/workspace/settings/ (gitignored, POSIX 0600).
 * Never reads API keys from external repositories or arbitrary user machine directories.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../../tools/setup/hydrate.mjs';
import { DEFAULT_VOICE_ID, validateVoiceId } from '../../shared/contract.mjs';

export const SELECTION_MODES = Object.freeze(['auto', 'manual']);
export const MODEL_POLICIES = Object.freeze(['quality', 'balanced', 'fast']);
export const VALID_MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

const writeQueues = new Map();

/**
 * Resolves the default gitignored settings directory inside Skill-Cartoon-Short.
 * @returns {string}
 */
export function defaultSettingsDir() {
  return path.join(PROJECT_ROOT, 'workspace', 'settings');
}

/**
 * Returns default TTS provider settings without any hardcoded secret.
 * @returns {object}
 */
export function defaultTtsSettings() {
  return {
    schemaVersion: 1,
    gemini: {
      apiKey: '',
      ttsModel: '',
      selectionMode: 'auto',
      modelPolicy: 'quality',
      includePreview: true,
      defaultVoice: DEFAULT_VOICE_ID,
    },
  };
}

/**
 * Computes a short non-reversible SHA-256 fingerprint of an API key for cache partitioning.
 * @param {string} apiKey
 * @returns {string}
 */
export function keyFingerprint(apiKey) {
  const clean = String(apiKey || '').trim();
  if (!clean) return '';
  return crypto.createHash('sha256').update(clean).digest('hex').slice(0, 16);
}

/**
 * Masks an API key so only the trailing 4 characters are visible in UI/API status responses.
 * @param {string} key
 * @returns {string}
 */
export function maskKey(key) {
  const clean = String(key || '').trim();
  if (!clean) return '';
  if (clean.length <= 6) return '••••••';
  return '••••••••' + clean.slice(-4);
}

/**
 * Redacts known API keys and Gemini key patterns from error messages and log strings.
 * @param {unknown} input
 * @param {string[]} [extraSecrets=[]]
 * @returns {string}
 */
export function redactSecrets(input, extraSecrets = []) {
  let text = String(input ?? '');
  for (const secret of extraSecrets) {
    const s = String(secret || '').trim();
    if (s.length >= 6) {
      text = text.split(s).join('[REDACTED]');
    }
  }
  text = text.replace(/AIza[0-9A-Za-z_-]{16,}/g, '[REDACTED_API_KEY]');
  text = text.replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED_API_KEY]');
  text = text.replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED_API_KEY]');
  return text;
}

/**
 * Validates and normalizes a Gemini model identifier (stripping optional "models/" prefix).
 * @param {string} raw
 * @returns {string}
 */
export function normalizeModelSettingValue(raw) {
  const trimmed = String(raw || '').trim().replace(/^models\//i, '');
  if (!trimmed) return '';
  if (!VALID_MODEL_ID_RE.test(trimmed)) {
    const err = new Error(`INVALID_MODEL_ID: "${trimmed.slice(0, 48)}"`);
    err.code = 'INVALID_MODEL_ID';
    err.statusCode = 400;
    throw err;
  }
  return trimmed;
}

/**
 * Atomically writes a buffer to disk with restricted 0600 permissions.
 * @param {string} filePath
 * @param {Buffer} buffer
 * @param {{ mode?: number }} [opts]
 */
export function atomicWriteSecureSync(filePath, buffer, { mode = 0o600 } = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const nonce = crypto.randomBytes(6).toString('hex');
  const tmpFile = `${filePath}.${process.pid}.${nonce}.tmp`;
  try {
    const fd = fs.openSync(tmpFile, 'w', mode);
    try {
      fs.writeFileSync(fd, buffer);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpFile, filePath);
    try {
      fs.chmodSync(filePath, mode);
    } catch {
      // Ignore on filesystems without POSIX permissions
    }
  } catch (err) {
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // Ignore cleanup failure
    }
    throw err;
  }
}

function withDirLock(dir, fn) {
  const key = path.resolve(dir);
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  writeQueues.set(
    key,
    next.finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    })
  );
  return next;
}

function coerceSettings(raw) {
  const base = defaultTtsSettings();
  const src = raw?.gemini;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return base;
  if (typeof src.apiKey === 'string') base.gemini.apiKey = src.apiKey.trim();
  if (typeof src.ttsModel === 'string' && src.ttsModel.trim()) {
    try {
      base.gemini.ttsModel = normalizeModelSettingValue(src.ttsModel);
    } catch {
      base.gemini.ttsModel = '';
    }
  }
  if (SELECTION_MODES.includes(String(src.selectionMode))) {
    base.gemini.selectionMode = String(src.selectionMode);
  }
  if (MODEL_POLICIES.includes(String(src.modelPolicy))) {
    base.gemini.modelPolicy = String(src.modelPolicy);
  }
  if (typeof src.includePreview === 'boolean') {
    base.gemini.includePreview = src.includePreview;
  }
  if (typeof src.defaultVoice === 'string') {
    try {
      base.gemini.defaultVoice = validateVoiceId(src.defaultVoice);
    } catch {
      base.gemini.defaultVoice = DEFAULT_VOICE_ID;
    }
  }
  return base;
}

/**
 * Loads local TTS settings from disk (returns clean defaults if absent).
 * @param {string} [settingsDir]
 * @returns {object}
 */
export function loadTtsSettings(settingsDir = defaultSettingsDir()) {
  const file = path.join(settingsDir, 'tts-settings.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return coerceSettings(parsed);
  } catch {
    return defaultTtsSettings();
  }
}

/**
 * Resolves the active Gemini API key strictly from saved local settings or process.env.GEMINI_API_KEY.
 * @param {object} settings
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{ apiKey: string, source: 'settings'|'env'|'none', fingerprint: string }}
 */
export function resolveGeminiApiKey(settings, env = process.env) {
  const saved = String(settings?.gemini?.apiKey || '').trim();
  if (saved) {
    return { apiKey: saved, source: 'settings', fingerprint: keyFingerprint(saved) };
  }
  const fromEnv = String(env?.GEMINI_API_KEY || '').trim();
  if (fromEnv) {
    return { apiKey: fromEnv, source: 'env', fingerprint: keyFingerprint(fromEnv) };
  }
  return { apiKey: '', source: 'none', fingerprint: '' };
}

/**
 * Updates local TTS settings atomically with strict field validation and 0600 permissions.
 * @param {object} patch
 * @param {{ settingsDir?: string }} [opts]
 * @returns {Promise<{ settings: object, keyChanged: boolean, configChanged: boolean, keyFp: string }>}
 */
export async function updateTtsSettings(patch, { settingsDir = defaultSettingsDir() } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const err = new Error('INVALID_SETTINGS_PAYLOAD: Expected a JSON object.');
    err.code = 'INVALID_SETTINGS_PAYLOAD';
    err.statusCode = 400;
    throw err;
  }

  return withDirLock(settingsDir, async () => {
    const current = loadTtsSettings(settingsDir);
    const prevFp = keyFingerprint(current.gemini.apiKey);
    const prevSig = JSON.stringify({
      ttsModel: current.gemini.ttsModel,
      selectionMode: current.gemini.selectionMode,
      modelPolicy: current.gemini.modelPolicy,
      includePreview: current.gemini.includePreview,
      defaultVoice: current.gemini.defaultVoice,
    });

    const allowed = new Set([
      'apiKey',
      'clearKey',
      'ttsModel',
      'selectionMode',
      'modelPolicy',
      'includePreview',
      'defaultVoice',
    ]);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        const err = new Error(`UNKNOWN_SETTINGS_FIELD: "${key.slice(0, 48)}" is not permitted.`);
        err.code = 'UNKNOWN_SETTINGS_FIELD';
        err.statusCode = 400;
        throw err;
      }
    }

    if (patch.clearKey === true) {
      current.gemini.apiKey = '';
    } else if (typeof patch.apiKey === 'string') {
      const trimmed = patch.apiKey.trim();
      if (trimmed) {
        if (trimmed.length > 256 || /\s/.test(trimmed)) {
          const err = new Error('INVALID_API_KEY_FORMAT: API key must not contain whitespace or exceed 256 chars.');
          err.code = 'INVALID_API_KEY_FORMAT';
          err.statusCode = 400;
          throw err;
        }
        current.gemini.apiKey = trimmed;
      }
    }

    if (patch.selectionMode !== undefined) {
      const mode = String(patch.selectionMode).trim();
      if (!SELECTION_MODES.includes(mode)) {
        const err = new Error(`INVALID_SELECTION_MODE: Expected auto or manual, got "${mode}".`);
        err.code = 'INVALID_SELECTION_MODE';
        err.statusCode = 400;
        throw err;
      }
      current.gemini.selectionMode = mode;
    }

    if (patch.modelPolicy !== undefined) {
      const policy = String(patch.modelPolicy).trim();
      if (!MODEL_POLICIES.includes(policy)) {
        const err = new Error(`INVALID_MODEL_POLICY: Expected quality, balanced, or fast, got "${policy}".`);
        err.code = 'INVALID_MODEL_POLICY';
        err.statusCode = 400;
        throw err;
      }
      current.gemini.modelPolicy = policy;
    }

    if (patch.includePreview !== undefined) {
      current.gemini.includePreview = Boolean(patch.includePreview);
    }

    if (patch.ttsModel !== undefined) {
      current.gemini.ttsModel = normalizeModelSettingValue(patch.ttsModel);
    }

    if (patch.defaultVoice !== undefined) {
      current.gemini.defaultVoice = validateVoiceId(patch.defaultVoice);
    }

    const filePath = path.join(settingsDir, 'tts-settings.json');
    atomicWriteSecureSync(filePath, Buffer.from(JSON.stringify(current, null, 2), 'utf8'), { mode: 0o600 });

    const nextFp = keyFingerprint(current.gemini.apiKey);
    const nextSig = JSON.stringify({
      ttsModel: current.gemini.ttsModel,
      selectionMode: current.gemini.selectionMode,
      modelPolicy: current.gemini.modelPolicy,
      includePreview: current.gemini.includePreview,
      defaultVoice: current.gemini.defaultVoice,
    });
    return {
      settings: current,
      keyChanged: prevFp !== nextFp,
      configChanged: prevSig !== nextSig,
      keyFp: nextFp,
    };
  });
}

/**
 * Produces a public, secret-redacted view of TTS settings for API/UI responses.
 * @param {object} settings
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {object}
 */
export function getSanitizedTtsSettings(settings, env = process.env) {
  const resolved = resolveGeminiApiKey(settings, env);
  return {
    provider: 'gemini',
    hasKey: Boolean(resolved.apiKey),
    keySource: resolved.source,
    maskedKey: resolved.apiKey ? maskKey(resolved.apiKey) : '',
    selectionMode: settings?.gemini?.selectionMode || 'auto',
    modelPolicy: settings?.gemini?.modelPolicy || 'quality',
    includePreview: settings?.gemini?.includePreview !== false,
    ttsModel: settings?.gemini?.ttsModel || '',
    defaultVoice: settings?.gemini?.defaultVoice || DEFAULT_VOICE_ID,
  };
}
