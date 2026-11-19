/**
 * Versioned Studio Project Store (QA-TTS-01)
 *
 * Persists project configuration in `workspace/projects/<projectId>/project.json` (gitignored)
 * while seamlessly discovering hydrated legacy & modular-world story projects (`soldier-baseline`,
 * `zombie-supermarket-10s`, `ghost-army-ww2-30s`) without breaking backward compatibility.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../../tools/setup/hydrate.mjs';
import {
  ASPECT_RATIOS,
  CAPTION_STYLES,
  DEFAULT_VOICE_ID,
  PROJECT_SCHEMA_VERSION,
  validateAspectRatio,
  validateSafeId,
  validateVoiceId,
} from '../../shared/contract.mjs';
import { atomicWriteSecureSync } from './settings-store.mjs';

const BUILTIN_PROJECT_META = Object.freeze({
  'soldier-baseline': {
    title: 'The Soldier Who Never Left (Original Baseline)',
    storyId: 'soldier-baseline',
    protected: true,
    parityBaseline: true,
    expectedDurationSec: 19.7333,
    totalFrames: 592,
    scriptText:
      'A Roman soldier stood guard at a bridge for 30 years, refusing to leave his post. Even when the empire collapsed, he stayed. People called him crazy. But when workers finally removed his helmet, they discovered a message carved inside: The bridge is not safe. Beneath it, the wooden supports had been slowly rotting for centuries.',
    captionsEnabled: false,
    punchWords: ['30 YEARS', 'NOT SAFE', 'ROTTING'],
  },
  'zombie-supermarket-10s': {
    title: 'Sold Out at Fresh-Mart (New 10s Proof)',
    storyId: 'zombie-supermarket-10s',
    protected: true,
    parityBaseline: false,
    expectedDurationSec: 10.0,
    totalFrames: 300,
    scriptText:
      'A hungry zombie shambled into Fresh-Mart at midnight, hunting for one last snack. The aisle looked promising—until he reached the shelf. Completely sold out.',
    captionsEnabled: true,
    punchWords: ['FRESH-MART', 'SOLD OUT'],
  },
  'ghost-army-ww2-30s': {
    title: 'The Fake Army That Fooled the Nazis',
    storyId: 'ghost-army-ww2-30s',
    protected: true,
    parityBaseline: false,
    expectedDurationSec: 30.0,
    totalFrames: 900,
    scriptText:
      "During World War II, the Americans built an entire army that wasn't real. From a distance, German soldiers saw rows of tanks preparing for battle. But those tanks were made of inflatable rubber. And that was just the beginning. Hidden speakers blasted the sounds of thousands of troops and armored vehicles. Fake radio messages made the illusion even more convincing. Just 1,100 men could impersonate a force many times their size, drawing German attention away from real American troops. Their deadliest weapon wasn't a gun. It was deception.",
    captionsEnabled: true,
    punchWords: ["WASN'T", 'REAL', 'INFLATABLE', 'RUBBER', 'SPEAKERS', 'FAKE', '1,100', 'DECEPTION'],
  },
});

/**
 * Safely parses TOTAL and SHOTS from a story.js file without evaluating arbitrary JS code.
 * @param {string} storyJsPath
 * @returns {{ totalFrames: number, shots: Array<{ id: string, a: number, b: number, light?: string }> }}
 */
export function parseStoryMetadataStatic(storyJsPath) {
  if (!storyJsPath || !fs.existsSync(storyJsPath)) {
    return { totalFrames: 300, shots: [] };
  }
  const src = fs.readFileSync(storyJsPath, 'utf8');
  const totalMatch = /export\s+const\s+TOTAL\s*=\s*(\d+)/.exec(src);
  const totalFrames = totalMatch ? Number.parseInt(totalMatch[1], 10) : 300;
  const shots = [];
  const shotsBlockMatch = /export\s+const\s+SHOTS\s*=\s*\[([\s\S]*?)\];/.exec(src);
  if (shotsBlockMatch) {
    const itemRe = /\{\s*id:\s*['"]([^'"]+)['"]\s*,\s*a:\s*(\d+)\s*,\s*b:\s*(\d+)(?:\s*,\s*light:\s*['"]([^'"]+)['"])?/g;
    let m;
    while ((m = itemRe.exec(shotsBlockMatch[1])) !== null) {
      shots.push({
        id: m[1],
        a: Number.parseInt(m[2], 10),
        b: Number.parseInt(m[3], 10),
        light: m[4] || undefined,
      });
    }
  }
  return { totalFrames, shots };
}

/**
 * Computes a deterministic hash of all inputs that impact rendered video output.
 * @param {object} project
 * @returns {string}
 */
export function computeProjectInputSpecHash(project) {
  const canonical = {
    storyId: project.storyId,
    scriptText: project.scriptText,
    narrationSource: project.narrationSource,
    voiceId: project.voiceId,
    ttsModel: project.ttsModel || '',
    sourceAudioId: project.sourceAudioId || '',
    aspectRatio: project.aspectRatio,
    captionsEnabled: Boolean(project.captionsEnabled),
    captionStyle: project.captionStyle || 'cartoon',
    language: project.language || 'en',
    punchWords: Array.isArray(project.punchWords) ? project.punchWords : [],
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 20);
}

/**
 * Creates a ProjectStore bound to a workspace root.
 * @param {{ projectRoot?: string }} [opts]
 */
export function createProjectStore({ projectRoot = PROJECT_ROOT } = {}) {
  const projectsRoot = path.resolve(projectRoot, 'workspace', 'projects');

  function projectDir(projectId) {
    const safeId = validateSafeId(projectId, 'projectId');
    const dir = path.resolve(projectsRoot, safeId);
    if (!dir.startsWith(projectsRoot + path.sep)) {
      const err = new Error('PATH_CONFINEMENT_VIOLATION');
      err.code = 'PATH_CONFINEMENT_VIOLATION';
      err.statusCode = 400;
      throw err;
    }
    return dir;
  }

  function resolveStoryWebDir(storyId) {
    const safeStory = validateSafeId(storyId, 'storyId');
    const candidate = path.resolve(projectsRoot, safeStory, 'web');
    if (candidate.startsWith(projectsRoot + path.sep) && fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
    return null;
  }

  function hydrateProjectRecord(projectId, stored = null) {
    const safeId = validateSafeId(projectId, 'projectId');
    const dir = projectDir(safeId);
    const builtin = BUILTIN_PROJECT_META[safeId] || null;
    const storyId = stored?.storyId || builtin?.storyId || (resolveStoryWebDir(safeId) ? safeId : 'ghost-army-ww2-30s');
    const storyJsCandidate =
      fs.existsSync(path.join(projectsRoot, storyId, 'src', 'story.js'))
        ? path.join(projectsRoot, storyId, 'src', 'story.js')
        : path.join(projectsRoot, storyId, 'web', 'story.js');
    const parsedStory = parseStoryMetadataStatic(storyJsCandidate);
    const totalFrames = Number(stored?.totalFrames || builtin?.totalFrames || parsedStory.totalFrames || 300);
    const expectedDurationSec = Number(
      (stored?.expectedDurationSec || builtin?.expectedDurationSec || totalFrames / 30).toFixed(4)
    );
    const hydratedWebDir = resolveStoryWebDir(storyId);

    const record = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId: safeId,
      title: String(stored?.title || builtin?.title || safeId),
      scriptText: stored?.scriptText !== undefined ? String(stored.scriptText) : (builtin?.scriptText || ''),
      narrationSource: stored?.narrationSource === 'import' ? 'import' : 'tts',
      voiceId: stored?.voiceId || DEFAULT_VOICE_ID,
      ttsModel: String(stored?.ttsModel || ''),
      sourceAudioId: stored?.sourceAudioId ? String(stored.sourceAudioId) : null,
      sourceAudioMeta: stored?.sourceAudioMeta || null,
      importedAudioId: stored?.importedAudioId ? String(stored.importedAudioId) : null,
      importedAudioMeta: stored?.importedAudioMeta || null,
      ttsAudioId: stored?.ttsAudioId ? String(stored.ttsAudioId) : null,
      ttsAudioMeta: stored?.ttsAudioMeta || null,
      aspectRatio: stored?.aspectRatio || '9:16',
      captionsEnabled: stored?.captionsEnabled !== undefined ? Boolean(stored.captionsEnabled) : (builtin?.captionsEnabled ?? true),
      captionStyle: stored?.captionStyle || 'cartoon',
      language: stored?.language || 'en',
      punchWords: Array.isArray(stored?.punchWords) ? stored.punchWords : (builtin?.punchWords || []),
      storyId,
      totalFrames,
      expectedDurationSec,
      shots: parsedStory.shots,
      engineReady: Boolean(hydratedWebDir),
      engineUrl: hydratedWebDir ? `/engine/${encodeURIComponent(storyId)}/index.html` : null,
      parityBaseline: Boolean(builtin?.parityBaseline),
      protected: Boolean(builtin?.protected || fs.existsSync(path.join(dir, 'src', 'story.js'))),
      latestTiming: stored?.latestTiming || null,
      renderJobs: Array.isArray(stored?.renderJobs) ? stored.renderJobs.slice(0, 25) : [],
      exports: Array.isArray(stored?.exports) ? stored.exports.slice(0, 25) : [],
      createdAt: stored?.createdAt || new Date().toISOString(),
      updatedAt: stored?.updatedAt || new Date().toISOString(),
    };
    record.inputSpecHash = computeProjectInputSpecHash(record);
    return record;
  }

  function saveProjectRecord(record) {
    const dir = projectDir(record.projectId);
    fs.mkdirSync(dir, { recursive: true });
    record.updatedAt = new Date().toISOString();
    record.inputSpecHash = computeProjectInputSpecHash(record);
    atomicWriteSecureSync(path.join(dir, 'project.json'), Buffer.from(JSON.stringify(record, null, 2), 'utf8'), {
      mode: 0o644,
    });
    return record;
  }

  function listProjects() {
    fs.mkdirSync(projectsRoot, { recursive: true });
    const ids = new Set();
    for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(entry.name)) continue;
      const d = path.join(projectsRoot, entry.name);
      if (
        fs.existsSync(path.join(d, 'project.json')) ||
        fs.existsSync(path.join(d, 'web', 'index.html')) ||
        fs.existsSync(path.join(d, 'src', 'story.js'))
      ) {
        ids.add(entry.name);
      }
    }
    const items = [];
    for (const id of ids) {
      const jsonPath = path.join(projectsRoot, id, 'project.json');
      let stored = null;
      if (fs.existsSync(jsonPath)) {
        try {
          stored = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        } catch {
          stored = null;
        }
      }
      items.push(hydrateProjectRecord(id, stored));
    }
    items.sort((a, b) => {
      if (a.projectId === 'ghost-army-ww2-30s') return -1;
      if (b.projectId === 'ghost-army-ww2-30s') return 1;
      if (a.parityBaseline !== b.parityBaseline) return a.parityBaseline ? 1 : -1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return items;
  }

  function getProject(projectId) {
    const safeId = validateSafeId(projectId, 'projectId');
    const dir = projectDir(safeId);
    const jsonPath = path.join(dir, 'project.json');
    const exists =
      fs.existsSync(jsonPath) ||
      fs.existsSync(path.join(dir, 'web', 'index.html')) ||
      fs.existsSync(path.join(dir, 'src', 'story.js'));
    if (!exists) {
      const err = new Error(`PROJECT_NOT_FOUND: "${safeId}" does not exist.`);
      err.code = 'PROJECT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    let stored = null;
    if (fs.existsSync(jsonPath)) {
      stored = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    }
    return hydrateProjectRecord(safeId, stored);
  }

  function validatePatchFields(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      const err = new Error('INVALID_PROJECT_PAYLOAD: Expected a JSON object.');
      err.code = 'INVALID_PROJECT_PAYLOAD';
      err.statusCode = 400;
      throw err;
    }
    const allowed = new Set([
      'title',
      'scriptText',
      'narrationSource',
      'voiceId',
      'ttsModel',
      'aspectRatio',
      'captionsEnabled',
      'captionStyle',
      'language',
      'storyId',
      'punchWords',
      'sourceAudioId',
    ]);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        const err = new Error(`UNKNOWN_PROJECT_FIELD: Field "${key.slice(0, 48)}" is not permitted.`);
        err.code = 'UNKNOWN_PROJECT_FIELD';
        err.statusCode = 400;
        throw err;
      }
    }

    const clean = {};
    if (patch.title !== undefined) {
      const t = String(patch.title).trim();
      if (!t || t.length > 140) {
        const err = new Error('INVALID_PROJECT_TITLE: Title must be 1..140 characters.');
        err.code = 'INVALID_PROJECT_TITLE';
        err.statusCode = 400;
        throw err;
      }
      clean.title = t;
    }
    if (patch.scriptText !== undefined) {
      const s = String(patch.scriptText);
      if (s.length > 6000) {
        const err = new Error('SCRIPT_TOO_LONG: Script must not exceed 6000 characters.');
        err.code = 'SCRIPT_TOO_LONG';
        err.statusCode = 400;
        throw err;
      }
      clean.scriptText = s;
    }
    if (patch.narrationSource !== undefined) {
      const src = String(patch.narrationSource);
      if (src !== 'tts' && src !== 'import') {
        const err = new Error('INVALID_NARRATION_SOURCE: Expected "tts" or "import".');
        err.code = 'INVALID_NARRATION_SOURCE';
        err.statusCode = 400;
        throw err;
      }
      clean.narrationSource = src;
    }
    if (patch.voiceId !== undefined) {
      clean.voiceId = validateVoiceId(patch.voiceId);
    }
    if (patch.ttsModel !== undefined) {
      const m = String(patch.ttsModel || '').trim();
      if (m && !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(m)) {
        const err = new Error('INVALID_TTS_MODEL: Malformed model identifier.');
        err.code = 'INVALID_TTS_MODEL';
        err.statusCode = 400;
        throw err;
      }
      clean.ttsModel = m;
    }
    if (patch.aspectRatio !== undefined) {
      validateAspectRatio(patch.aspectRatio);
      clean.aspectRatio = String(patch.aspectRatio);
    }
    if (patch.captionsEnabled !== undefined) {
      if (typeof patch.captionsEnabled !== 'boolean') {
        const err = new Error('INVALID_CAPTIONS_ENABLED: Expected boolean.');
        err.code = 'INVALID_CAPTIONS_ENABLED';
        err.statusCode = 400;
        throw err;
      }
      clean.captionsEnabled = patch.captionsEnabled;
    }
    if (patch.captionStyle !== undefined) {
      const cs = String(patch.captionStyle);
      if (!CAPTION_STYLES[cs]) {
        const err = new Error(`INVALID_CAPTION_STYLE: "${cs}" is unsupported.`);
        err.code = 'INVALID_CAPTION_STYLE';
        err.statusCode = 400;
        throw err;
      }
      clean.captionStyle = cs;
    }
    if (patch.language !== undefined) {
      const lang = String(patch.language).trim().toLowerCase();
      if (!/^[a-z]{2}(-[a-z]{2})?$/.test(lang)) {
        const err = new Error(`INVALID_LANGUAGE: "${lang}" must be an ISO language code (e.g. en).`);
        err.code = 'INVALID_LANGUAGE';
        err.statusCode = 400;
        throw err;
      }
      clean.language = lang;
    }
    if (patch.storyId !== undefined) {
      const sid = validateSafeId(patch.storyId, 'storyId');
      if (!resolveStoryWebDir(sid)) {
        const err = new Error(`STORY_NOT_HYDRATED: "${sid}" has no hydrated Three.js web build.`);
        err.code = 'STORY_NOT_HYDRATED';
        err.statusCode = 400;
        throw err;
      }
      clean.storyId = sid;
    }
    if (patch.punchWords !== undefined) {
      if (!Array.isArray(patch.punchWords) || patch.punchWords.length > 40) {
        const err = new Error('INVALID_PUNCH_WORDS: Expected array of up to 40 words.');
        err.code = 'INVALID_PUNCH_WORDS';
        err.statusCode = 400;
        throw err;
      }
      clean.punchWords = patch.punchWords.map((w) => String(w || '').trim().slice(0, 32)).filter(Boolean);
    }
    if (patch.sourceAudioId !== undefined) {
      clean.sourceAudioId = patch.sourceAudioId ? validateSafeId(patch.sourceAudioId, 'audioId') : null;
    }
    return clean;
  }

  function createProject(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      const err = new Error('INVALID_PROJECT_PAYLOAD: Expected a JSON object.');
      err.code = 'INVALID_PROJECT_PAYLOAD';
      err.statusCode = 400;
      throw err;
    }
    const rawId = body.projectId
      ? validateSafeId(body.projectId, 'projectId')
      : `${String(body.title || 'short')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 32) || 'short'}-${crypto.randomBytes(3).toString('hex')}`;

    const dir = projectDir(rawId);
    if (fs.existsSync(path.join(dir, 'project.json')) || fs.existsSync(path.join(dir, 'src', 'story.js'))) {
      const err = new Error(`PROJECT_ALREADY_EXISTS: "${rawId}" already exists.`);
      err.code = 'PROJECT_ALREADY_EXISTS';
      err.statusCode = 409;
      throw err;
    }

    const patchCopy = { ...body };
    delete patchCopy.projectId;
    const valid = validatePatchFields(patchCopy);
    const storyId = valid.storyId || (resolveStoryWebDir('ghost-army-ww2-30s') ? 'ghost-army-ww2-30s' : 'zombie-supermarket-10s');

    const record = hydrateProjectRecord(rawId, {
      ...valid,
      storyId,
      title: valid.title || 'Untitled Cartoon Short',
      aspectRatio: valid.aspectRatio || '9:16',
      captionsEnabled: valid.captionsEnabled ?? true,
      createdAt: new Date().toISOString(),
    });
    return saveProjectRecord(record);
  }

  function duplicateProject(sourceId, { newTitle } = {}) {
    const src = getProject(sourceId);
    const newId = `${src.projectId.slice(0, 36)}-copy-${crypto.randomBytes(2).toString('hex')}`;
    const copy = hydrateProjectRecord(newId, {
      ...src,
      projectId: newId,
      title: newTitle ? String(newTitle).trim().slice(0, 140) : `${src.title} (Copy)`,
      protected: false,
      parityBaseline: false,
      renderJobs: [],
      exports: [],
      createdAt: new Date().toISOString(),
    });
    return saveProjectRecord(copy);
  }

  function updateProject(projectId, patch) {
    const current = getProject(projectId);
    const valid = validatePatchFields(patch);
    const next = { ...current, ...valid };
    // Never silently destroy imported audio when switching voice; keep importedAudioId intact
    if (valid.narrationSource === 'import' && current.importedAudioId) {
      next.sourceAudioId = current.importedAudioId;
      next.sourceAudioMeta = current.importedAudioMeta;
    } else if (valid.narrationSource === 'tts' && current.ttsAudioId) {
      next.sourceAudioId = current.ttsAudioId;
      next.sourceAudioMeta = current.ttsAudioMeta;
    }
    return saveProjectRecord(hydrateProjectRecord(current.projectId, next));
  }

  function attachAudioArtifact(projectId, artifact, { sourceType }) {
    const current = getProject(projectId);
    const next = { ...current };
    if (sourceType === 'import') {
      next.narrationSource = 'import';
      next.importedAudioId = artifact.audioId;
      next.importedAudioMeta = artifact;
      next.sourceAudioId = artifact.audioId;
      next.sourceAudioMeta = artifact;
    } else {
      next.narrationSource = 'tts';
      next.ttsAudioId = artifact.audioId;
      next.ttsAudioMeta = artifact;
      next.sourceAudioId = artifact.audioId;
      next.sourceAudioMeta = artifact;
    }
    next.latestTiming = null;
    return saveProjectRecord(hydrateProjectRecord(current.projectId, next));
  }

  function updateProjectInternal(projectId, mutator) {
    const current = getProject(projectId);
    const updated = mutator(current) || current;
    return saveProjectRecord(hydrateProjectRecord(current.projectId, updated));
  }

  function deleteProject(projectId, { confirmDelete = false } = {}) {
    if (confirmDelete !== true) {
      const err = new Error('DELETE_CONFIRMATION_REQUIRED: Pass confirmDelete: true to delete a project.');
      err.code = 'DELETE_CONFIRMATION_REQUIRED';
      err.statusCode = 400;
      throw err;
    }
    const project = getProject(projectId);
    if (project.protected) {
      const err = new Error(`PROTECTED_PROJECT: Built-in story source project "${project.projectId}" cannot be deleted.`);
      err.code = 'PROTECTED_PROJECT';
      err.statusCode = 403;
      throw err;
    }
    const dir = projectDir(project.projectId);
    fs.rmSync(dir, { recursive: true, force: true });
    return { deleted: true, projectId: project.projectId };
  }

  return {
    projectsRoot,
    projectDir,
    listProjects,
    getProject,
    createProject,
    duplicateProject,
    updateProject,
    attachAudioArtifact,
    updateProjectInternal,
    deleteProject,
    ASPECT_RATIOS,
  };
}
