/**
 * Backend / Future Studio UI Interface Contract (SHORT-01 Section 14)
 * Target Product: Cartoon Short Studio — 2D + 3D, 9:16 (1080x1920, 30 FPS)
 *
 * Truthfulness rule:
 * The original Cartoon Short Renderer defines shots, cameras, lighting, characters, and 3D worlds
 * via imperative ES modules (`story.js`, `main.js`, `roman.js`), NOT a declarative JSON scene graph.
 * This contract distinguishes capabilities that are directly controllable today via adapters from
 * capabilities that require Phase 2 AST/JSON authoring adapters.
 */

export const STUDIO_FORMAT_LOCK = Object.freeze({
  productName: 'Cartoon Short Studio — 2D + 3D, 9:16',
  aspectRatio: '9:16',
  width: 1080,
  height: 1920,
  fps: 30,
  rendererEngine: 'threejs-r160-pen2d-ink-dof',
  prohibitedEngines: ['skia', 'remotion', 'moviepy-slideshow', 'longform-16x9'],
});

export const UI_CAPABILITY_MATRIX = Object.freeze({
  projects: {
    controlMode: 'direct-now',
    adapterEndpoint: 'GET /api/projects',
    notes: 'Lists hydrated workspace projects (soldier-baseline, zombie-supermarket-10s) and engine metadata.',
  },
  script: {
    controlMode: 'direct-file-io',
    adapterEndpoint: 'POST /api/timing/align',
    notes: 'Plaintext narration script consumed by tools/timing/timing_validator.py for phrase/word alignment.',
  },
  voiceover: {
    controlMode: 'direct-file-io',
    adapterEndpoint: 'POST /api/timing/align',
    notes: 'Audio input (.mp3/.wav) driving round(duration * 30) frame count and linear gated-RMS mix calibration.',
  },
  shotList: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'story.js -> SHOTS, shotAt(f)',
    notes: 'Exported as JS array [{id, a, b, light}] in story.js; editable via JSON only after a Phase 2 story compiler.',
  },
  characterPoses: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'story.js -> actorsAt(f, T) + romanFront/zombieFront arm/tilt/step opts',
    notes: 'Poses are procedural per-frame JS expressions (e.g. L/R arm switches, walk phase, headTilt, bob).',
  },
  characterExpressions: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'toon.ts / roman.js / zombie-cast.js -> FACE[expr], blinkAt(f, seed)',
    notes: 'Discrete expression presets (neutral, stern, stubborn, shock, laugh, etc.) selected per frame in actorsAt(f).',
  },
  environment3D: {
    controlMode: 'requires-world-module-adapter',
    sourceExport: 'main.js (hardcoded Roman bridge/temple) | patches/modular-world.mjs -> story.buildWorld()',
    notes: 'Original main.js hardcodes the Soldier world; modular-world.mjs isolates custom 3D worlds in story.buildWorld().',
  },
  cameraKeyframes: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'story.js -> camAt(f) / motion.js -> camFromKeys(K, f, {creep, kicks})',
    notes: 'Keyframes {f, pos, look, fov, roll, ease, path} are JS constants in story.js; ready for JSON serialization in Phase 2.',
  },
  lighting: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'story.js -> LIGHTS, lightFor(S, f) -> main.js applyLight(L, f), placeSun(L, focus)',
    notes: 'Presets control sun az/el, sky/ground hemi, fog, saturation, lift/gain, vignette, and shadow frustum extent.',
  },
  depthOfField: {
    controlMode: 'requires-authoring-adapter',
    sourceExport: 'story.js -> dofAt(f) -> {focus, cinf, near}',
    notes: '48-tap Golden-angle circle-of-confusion shader driven per frame by dofAt(f).',
  },
  renderQuality: {
    controlMode: 'direct-now',
    adapterMethod: 'renderFrame(f, { quality, debugMode })',
    notes: 'JPEG quality (0..1], render pass debug mode (final, #nd normal+depth, #e ink edge mask), and H.264 CRF/preset.',
  },
  previewFrame: {
    controlMode: 'direct-now',
    adapterMethod: 'renderStill(frameIndex) / window.renderFrame(frameIndex)',
    notes: 'Live deterministic single-frame WebGL evaluation at 1080x1920.',
  },
  fullRender: {
    controlMode: 'direct-now',
    adapterMethod: 'renderFrameRange(0, TOTAL - 1, options)',
    notes: 'Headless Chromium frame sequence generation with atomic writes, resume validation, and cancellation.',
  },
  audioSfx: {
    controlMode: 'direct-dual-mode',
    adapterModule: 'tools/audio/mix.py (spec-compliant) | example/soldier/audio.py (original-baseline)',
    notes: 'Supports linear gated-RMS (-6 dB relative to narration) via mix.py or legacy ducked/tanh reproduction.',
  },
  qa: {
    controlMode: 'direct-now',
    adapterModule: 'tools/qa/verify-gates.mjs',
    notes: 'Validates SHA-256 manifests, JPEG 9:16 dimensions, non-black/ink gradients, FFprobe codecs, faststart, and EBU R128.',
  },
  mp4Export: {
    controlMode: 'direct-now',
    adapterModule: 'tools/render/mux-mp4.mjs',
    notes: 'Encodes H.264 yuv420p 1080x1920 @ 30 FPS + AAC 48 kHz stereo with verified moov-before-mdat faststart.',
  },
});

export function validateProjectRenderRequest(req) {
  if (!req || typeof req !== 'object') {
    throw new Error('INVALID_RENDER_REQUEST: Request must be an object.');
  }
  if (req.aspectRatio && req.aspectRatio !== '9:16') {
    throw new Error(`UNSUPPORTED_ASPECT_RATIO: Only 9:16 is permitted (got "${req.aspectRatio}").`);
  }
  if (req.width !== undefined && Number(req.width) !== 1080) {
    throw new Error(`UNSUPPORTED_WIDTH: Expected 1080, got ${req.width}`);
  }
  if (req.height !== undefined && Number(req.height) !== 1920) {
    throw new Error(`UNSUPPORTED_HEIGHT: Expected 1920, got ${req.height}`);
  }
  if (req.fps !== undefined && Number(req.fps) !== 30) {
    throw new Error(`UNSUPPORTED_FPS: Expected 30, got ${req.fps}`);
  }
  if (req.engine && STUDIO_FORMAT_LOCK.prohibitedEngines.includes(String(req.engine).toLowerCase())) {
    throw new Error(`PROHIBITED_ENGINE: "${req.engine}" is forbidden in Cartoon Short Renderer.`);
  }
  return {
    projectId: String(req.projectId || 'soldier-baseline'),
    startFrame: Number(req.startFrame ?? 0),
    endFrame: Number(req.endFrame ?? 0),
    quality: Number(req.quality ?? 0.94),
    format: STUDIO_FORMAT_LOCK,
  };
}
