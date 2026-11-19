# QA-TTS-01 Source Audit & Provenance

## 1. Existing Verified Modules in `Agent-Skill-Animation/Skill-Cartoon-Short` (`c67dbd7`)

| File | Verified Exports / Functions | Audit Notes & Planned Evolution |
|---|---|---|
| `package.json` | ESM Node >=22.6, `playwright@1.65.1`, `three@0.160.0` | Add minimal React 18+, TypeScript, Vite (`dev`, `build`, `preview`, `typecheck`, `studio`) while keeping all existing scripts intact. |
| `app/shared/contract.mjs` | `STUDIO_FORMAT_LOCK`, `UI_CAPABILITY_MATRIX`, `validateProjectRenderRequest` | Keep backward-compatible; add versioned project schema (`SCHEMA_VERSION`), honest ratio capability map (`9:16` `SUPPORTED`, `1:1`/`16:9` `DISABLED`), Gemini prebuilt voice allowlist (`Kore` default, `Charon`, `Puck`, `Aoede`, `Zephyr`), subtitle style presets. |
| `app/server/viewer-server.mjs` | `listHydratedProjects`, `startViewerServer` | Keep loopback-only `127.0.0.1` binding, `/api/health`, `/api/contract`, `/engine/:project/*`; mount `/legacy` for unmodified `viewer.html`, serve built React Studio SPA at `/` when compiled, and delegate REST/SSE Studio endpoints to `app/server/api-router.mjs` with Host/Origin validation. |
| `app/frontend/viewer.html` | Legacy 9:16 iframe real-engine viewer (`evaluateFrame`, `loadProject`) | Preserve intact and serve at `/legacy` (and fallback `/` if SPA not built) so legacy viewer smoke test remains 100% functional. |
| `engine/adapters/renderer-adapter.mjs` | `parseFrameSpec`, `ShortRendererSession`, `initializeRenderer`, `renderFrame`, `renderFrameRange`, `renderStill`, `getRenderMetadata`, `disposeRenderer` | Reuse exclusively for all frame rendering and preview still capture. Do NOT build a second renderer. |
| `engine/patches/modular-world.mjs` | `EXPECTED_MAIN_JS_SHA256`, `applyModularWorldPatch` | Reuse for `workspace/projects/ghost-army-ww2-30s/src/story.js` via `hydrate.mjs` without altering immutable `vendor/cartoon-short-kit/`. |
| `tools/setup/hydrate.mjs` | `PROJECT_ROOT`, `loadSourceManifest`, `verifyVendorSnapshot`, `checkFreeDiskMb`, `writeFileAtomic`, `hydrateAll` | Already auto-discovers `workspace/projects/*/src/story.js` and concatenates `*-cast.js` into `web/toon.js`. Reuse untouched. |
| `tools/timing/timing_validator.py` | `probe_audio_duration`, `normalize_tokens`, `validate_timing_manifest`, `run_timing_pipeline` | Wrap via `app/server/services/timing-service.mjs`; enforce honest labeling of `approximate-silence-dp` (`UNVERIFIED_WORD_SYNC`) vs `exact-whisper-asr` and flag audio overflow/mismatch. |
| `tools/audio/mix.py` | `gated_rms`, `mix_linear_spec_compliant`, `write_stereo_wav_int16`, `measure_ebur128` | Reuse untouched via CLI/Python spawn from `JobManager` for linear gated-RMS `-6 dB` mixing. |
| `tools/render/mux-mp4.mjs` | `muxFramesAndAudio`, `probeMp4` | Upgrade to prevent unconditional `-shortest` from silently truncating narration or frames: check audio duration against exact frame count (`-frames:v <N>`), allow explicit bounded tail-silence padding when audio is slightly shorter, and fail loudly on voice overflow. |
| `tools/subtitles/cartoon_subs.py` | `hex_to_ass_bgr`, `escape_ass_text`, `expand_chunk_word_timings`, `build_ass_document`, `chunks_from_timing_words`, `burn_ass_onto_mp4` | Reuse directly via `app/server/services/subtitle-service.mjs`. Preserve `punchWords` field, `#241726` ink outline, `#FFE055` highlight, `#FF6347` punch accent, `-c:a copy`. |
| `tools/qa/verify-gates.mjs` | `evaluateAllGates` | Fix **G14** false-PASS bug (`options.dagTestsPassed === true` required; `undefined` -> `UNVERIFIED`, `false` -> `FAIL`) and **G17** hardcoded branch (parameterized `expectedBranch` default `'QA'`). Preserve `G03: BLOCKED`. |
| `tests/run-dag.mjs` | `runTestDag` | Extend to bounded resource-aware DAG scheduler covering new Studio/TTS/subtitle/security/E2E suites while tolerating absent gitignored baseline manifests cleanly (reporting `UNVERIFIED` rather than crashing `ENOENT`). |

## 2. Reference Provenance: `quocan050302/out-of-step-studio`

- **Source Repo**: `https://github.com/quocan050302/out-of-step-studio` (same owner)
- **Audited Branch & Commit**: `feat/studio-react-vite-migration` @ `58426ab04b3b96fe175afa74930af9157003fd89`
- **Upstream License**: MIT (`UPSTREAM-LICENSE`, Copyright (c) 2026 Mr omi)
- **Ported / Adapted Concepts (TTS-only, cleanly re-authored for `Skill-Cartoon-Short`)**:
  - `gemini-models.mjs`: `normalizeModelId`, `classifyGeminiModel`, `rankGeminiModels`, `fetchGeminiModelCatalog`, `createModelCatalogService` (strictly filtering `generateContent` TTS-capable models and rejecting deprecated/live/vision/embedding/non-TTS).
  - `gemini-transport.mjs`: `wavWrapPcm16`, `classifyGeminiError` (halting immediately on global/daily 429 quota, 401/403 auth, 400 malformed; allowing bounded retry/fallback only on model-specific 429/503/timeout), `ModelHealthRegistry`, `resolveTtsCandidates`, `geminiGenerate`.
  - **Bug Fixes Applied Over Upstream**:
    1. Fixed MIME handling in `validateTtsAudioResponse`: distinguishes raw `audio/L16` PCM (parsing `rate=` / `channels=` and wrapping once with RIFF/WAVE header) from already-packaged `audio/wav` / `audio/x-wav` / `audio/wave` (validating RIFF/WAVE/`fmt `/`data` headers without double-wrapping!), rejecting unexpected MIME, truncated RIFF, odd/empty/oversized buffers, and all-zero/silent audio.
    2. Eliminated global `tts-output.wav` overwrite: persisted strictly to atomic per-project unique paths `workspace/projects/<projectId>/generated/tts/<sha256-key>.wav`.
    3. Zero secrets copied from upstream repo or user filesystem; `settings-store.mjs` uses `0600` local gitignored `workspace/settings/tts-settings.json` + `GEMINI_API_KEY` env lookup with masking/redaction.
