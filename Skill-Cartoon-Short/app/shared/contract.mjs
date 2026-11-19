/**
 * Backend & Studio UI Interface Contract (SHORT-01 + QA-TTS-01)
 * Target Product: Cartoon Short Studio — 2D + 3D, 9:16 (1080x1920, 30 FPS)
 *
 * Truthfulness rule:
 * - Only genuinely rendered and QA-verified ratios may be marked supported: true.
 * - 1:1 and 16:9 remain explicitly DISABLED with an actionable explanation until camera
 *   recomposition, render targets, actor blocking, and caption safe-zone QA are implemented.
 */

export const PROJECT_SCHEMA_VERSION = 2;

export const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export const STUDIO_FORMAT_LOCK = Object.freeze({
  productName: 'Cartoon Short Studio — 2D + 3D, 9:16',
  aspectRatio: '9:16',
  width: 1080,
  height: 1920,
  fps: 30,
  rendererEngine: 'threejs-r160-pen2d-ink-dof',
  prohibitedEngines: ['skia', 'remotion', 'moviepy-slideshow', 'longform-16x9'],
});

export const ASPECT_RATIOS = Object.freeze({
  '9:16': Object.freeze({
    id: '9:16',
    label: '9:16 Vertical (1080×1920)',
    width: 1080,
    height: 1920,
    fps: 30,
    supported: true,
    status: 'SUPPORTED',
    reason: 'Native Three.js r160 + Pen 2D + Ink + 48-tap DOF + cartoon_subs.py safe-zone pipeline verified.',
  }),
  '1:1': Object.freeze({
    id: '1:1',
    label: '1:1 Square (1080×1080)',
    width: 1080,
    height: 1080,
    fps: 30,
    supported: false,
    status: 'DISABLED',
    reason:
      'Not yet supported: requires camera recomposition, 1:1 Ink/DOF render targets, and caption safe-zone QA (cropping or stretching 9:16 is prohibited).',
  }),
  '16:9': Object.freeze({
    id: '16:9',
    label: '16:9 Widescreen (1920×1080)',
    width: 1920,
    height: 1080,
    fps: 30,
    supported: false,
    status: 'DISABLED',
    reason:
      'Not yet supported: requires widescreen camera framing, widened 3D stage blocking, and 16:9 subtitle QA (stretching 9:16 is prohibited).',
  }),
});

export const DEFAULT_VOICE_ID = 'Kore';

/**
 * Gemini API prebuilt TTS voice allowlist.
 * Descriptions deliberately state verified prebuilt voice names only — no invented gender/accent labels.
 */
export const GEMINI_PREBUILT_VOICES = Object.freeze([
  Object.freeze({ id: 'Kore', label: 'Kore', isDefault: true, notes: 'Gemini prebuilt voice (default).' }),
  Object.freeze({ id: 'Charon', label: 'Charon', isDefault: false, notes: 'Gemini prebuilt voice.' }),
  Object.freeze({ id: 'Puck', label: 'Puck', isDefault: false, notes: 'Gemini prebuilt voice.' }),
  Object.freeze({ id: 'Aoede', label: 'Aoede', isDefault: false, notes: 'Gemini prebuilt voice.' }),
  Object.freeze({ id: 'Zephyr', label: 'Zephyr', isDefault: false, notes: 'Gemini prebuilt voice.' }),
]);

export const CAPTION_STYLES = Object.freeze({
  cartoon: Object.freeze({
    id: 'cartoon',
    label: 'Cartoon',
    engine: 'tools/subtitles/cartoon_subs.py',
    font: 'Arial Black',
    baseColor: '#FFFBF0',
    activeColor: '#FFE055',
    punchColor: '#FF6347',
    inkColor: '#241726',
    marginV: 330,
  }),
});

export const JOB_STAGES = Object.freeze([
  'QUEUED',
  'PREPARING',
  'VALIDATING_INPUT',
  'GENERATING_TTS',
  'PROBING_AUDIO',
  'ALIGNING',
  'RENDERING_FRAMES',
  'MIXING',
  'MUXING',
  'SUBTITLES',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'BLOCKED',
]);

export const UI_CAPABILITY_MATRIX = Object.freeze({
  projects: {
    controlMode: 'direct-now',
    adapterEndpoint: 'GET /api/projects',
    notes: 'Creates, lists, edits, duplicates, and guarded-deletes Studio projects while remaining compatible with hydrated legacy projects.',
  },
  script: {
    controlMode: 'direct-now',
    adapterEndpoint: 'PATCH /api/projects/:id',
    notes: 'Plaintext narration script persisted per project and consumed by Gemini TTS and tools/timing/timing_validator.py.',
  },
  voiceover: {
    controlMode: 'direct-now',
    adapterEndpoint: 'POST /api/projects/:id/tts | POST /api/projects/:id/import-audio',
    notes: 'Supports either Gemini TTS synthesis (per-project unique WAV) or imported WAV/MP3/M4A voiceover normalized to 48 kHz WAV.',
  },
  subtitles: {
    controlMode: 'direct-now',
    adapterEndpoint: 'GET /api/projects/:id/subtitles-preview?time=S',
    notes: 'Toggles Cartoon ASS/libass burn-in ON/OFF via tools/subtitles/cartoon_subs.py with punchWords and -c:a copy.',
  },
  aspectRatio: {
    controlMode: 'direct-now-9x16-only',
    supportedRatios: ['9:16'],
    disabledRatios: ['1:1', '16:9'],
    notes: 'Only 9:16 (1080x1920) is enabled and QA-verified; 1:1 and 16:9 are explicitly disabled with explanation.',
  },
  shotList: {
    controlMode: 'read-preview-now',
    sourceExport: 'story.js -> SHOTS, shotAt(f)',
    notes: 'Exposed for clickable frame seeking in Step 3; shot geometry remains authored via modular story.js modules.',
  },
  characterPoses: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'story.js -> actorsAt(f, T)',
    notes: 'Poses are procedural per-frame JS expressions inside each project story module.',
  },
  characterExpressions: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'toon.ts / *-cast.js -> FACE[expr], blinkAt(f, seed)',
    notes: 'Discrete expression presets selected per frame in actorsAt(f).',
  },
  environment3D: {
    controlMode: 'requires-world-module-adapter',
    sourceExport: 'main.js | patches/modular-world.mjs -> story.buildWorld()',
    notes: 'Custom 3D worlds are isolated per project in story.buildWorld().',
  },
  cameraKeyframes: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'story.js -> camAt(f) / motion.js -> camFromKeys()',
    notes: 'Keyframes are JS constants in story.js.',
  },
  lighting: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'story.js -> LIGHTS, lightFor(S, f)',
    notes: 'Lighting presets drive Three.js sun, hemi, fog, saturation, and vignette.',
  },
  depthOfField: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'story.js -> dofAt(f)',
    notes: '48-tap Golden-angle circle-of-confusion shader driven per frame.',
  },
  renderQuality: {
    controlMode: 'direct-now',
    adapterMethod: 'renderFrame(f, { quality, debugMode })',
    notes: 'JPEG quality (0..1], render pass debug mode (final, #nd, #e), and H.264 CRF/preset.',
  },
  previewFrame: {
    controlMode: 'direct-now',
    adapterEndpoint: 'GET /api/projects/:id/preview?frame=N',
    notes: 'Live deterministic single-frame WebGL evaluation at 1080x1920.',
  },
  fullRender: {
    controlMode: 'direct-now',
    adapterEndpoint: 'POST /api/projects/:id/render',
    notes: 'Async JobManager state machine over ShortRendererSession with bounded concurrency, cancel, and resume.',
  },
  audioSfx: {
    controlMode: 'direct-dual-mode',
    adapterModule: 'tools/audio/mix.py (spec-compliant) | example/soldier/audio.py (original-baseline)',
    notes: 'Linear gated-RMS (-6 dB relative to narration) via mix.py with zero unwanted dynamic ducking.',
  },
  qa: {
    controlMode: 'direct-now',
    adapterModule: 'tools/qa/verify-gates.mjs | app/server/services/qa-service.mjs',
    notes: 'Evidence-based Q01-Q18 and G01-G17 gates without false PASS on missing inputs.',
  },
  mp4Export: {
    controlMode: 'direct-now',
    adapterModule: 'tools/render/mux-mp4.mjs',
    notes: 'Encodes H.264 yuv420p 1080x1920 @ 30 FPS + AAC 48 kHz stereo with verified moov-before-mdat faststart.',
  },
});

/**
 * Validates a project/job identifier strictly against path traversal and unsafe characters.
 * @param {string} id
 * @param {string} [label='projectId']
 * @returns {string}
 */
export function validateSafeId(id, label = 'projectId') {
  const raw = String(id || '').trim();
  if (!SAFE_ID_RE.test(raw) || raw === '.' || raw === '..') {
    const err = new Error(`INVALID_${label.toUpperCase()}: "${raw.slice(0, 64)}" is not a safe identifier.`);
    err.code = `INVALID_${label.toUpperCase()}`;
    err.statusCode = 400;
    throw err;
  }
  return raw;
}

/**
 * Validates that a voice ID belongs to the supported Gemini prebuilt allowlist.
 * @param {string} voiceId
 * @returns {string}
 */
export function validateVoiceId(voiceId) {
  const clean = String(voiceId || '').trim();
  const match = GEMINI_PREBUILT_VOICES.find((v) => v.id === clean);
  if (!match) {
    const err = new Error(
      `UNSUPPORTED_VOICE_ID: "${clean.slice(0, 64)}" is not in the supported Gemini prebuilt voice allowlist (${GEMINI_PREBUILT_VOICES.map((v) => v.id).join(', ')}).`
    );
    err.code = 'UNSUPPORTED_VOICE_ID';
    err.statusCode = 400;
    throw err;
  }
  return match.id;
}

/**
 * Validates requested aspect ratio against genuine renderer capability.
 * @param {string} ratio
 * @returns {object}
 */
export function validateAspectRatio(ratio = '9:16') {
  const spec = ASPECT_RATIOS[String(ratio || '9:16')];
  if (!spec) {
    const err = new Error(`UNKNOWN_ASPECT_RATIO: "${String(ratio).slice(0, 32)}" is unknown.`);
    err.code = 'UNSUPPORTED_ASPECT_RATIO';
    err.statusCode = 400;
    throw err;
  }
  if (!spec.supported) {
    const err = new Error(`UNSUPPORTED_ASPECT_RATIO: "${spec.id}" is disabled. ${spec.reason}`);
    err.code = 'UNSUPPORTED_ASPECT_RATIO';
    err.statusCode = 400;
    throw err;
  }
  return spec;
}

/**
 * Validates a render request payload (backward-compatible with SHORT-01 unit tests).
 * @param {object} req
 * @returns {object}
 */
export function validateProjectRenderRequest(req) {
  if (!req || typeof req !== 'object') {
    throw new Error('INVALID_RENDER_REQUEST: Request must be an object.');
  }
  const ratioSpec = validateAspectRatio(req.aspectRatio || '9:16');
  if (req.width !== undefined && Number(req.width) !== ratioSpec.width) {
    throw new Error(`UNSUPPORTED_WIDTH: Expected ${ratioSpec.width}, got ${req.width}`);
  }
  if (req.height !== undefined && Number(req.height) !== ratioSpec.height) {
    throw new Error(`UNSUPPORTED_HEIGHT: Expected ${ratioSpec.height}, got ${req.height}`);
  }
  if (req.fps !== undefined && Number(req.fps) !== ratioSpec.fps) {
    throw new Error(`UNSUPPORTED_FPS: Expected ${ratioSpec.fps}, got ${req.fps}`);
  }
  if (req.engine && STUDIO_FORMAT_LOCK.prohibitedEngines.includes(String(req.engine).toLowerCase())) {
    throw new Error(`PROHIBITED_ENGINE: "${req.engine}" is forbidden in Cartoon Short Renderer.`);
  }
  const quality = Number(req.quality ?? 0.94);
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
    throw new Error(`INVALID_RENDER_QUALITY: Expected 0 < quality <= 1, got ${req.quality}`);
  }
  return {
    projectId: String(req.projectId || 'soldier-baseline'),
    startFrame: Number(req.startFrame ?? 0),
    endFrame: Number(req.endFrame ?? 0),
    quality,
    captionsEnabled: req.captionsEnabled !== undefined ? Boolean(req.captionsEnabled) : true,
    aspectRatio: ratioSpec.id,
    format: STUDIO_FORMAT_LOCK,
  };
}
