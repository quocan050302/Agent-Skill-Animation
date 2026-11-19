# QA-TTS-01 Concise Execution Plan

## Phases & Component Boundaries

1. **Phase 2 — Contract, Storage, Security, Gemini TTS & Audio Import (`app/shared/`, `app/server/services/`)**
   - `app/shared/contract.mjs`: Schema-versioned Studio project contract, honest ratio truth table (`9:16` supported; `1:1`/`16:9` explicitly disabled), Gemini TTS prebuilt voice allowlist (`Kore` default, `Charon`, `Puck`, `Aoede`, `Zephyr`).
   - `settings-store.mjs`: `0600` gitignored settings store, `GEMINI_API_KEY` env resolution, `maskKey`, `redactSecrets`, `keyFingerprint`.
   - `gemini-models.mjs` & `gemini-transport.mjs`: TTS-only discovery/ranking, quota-safe error classification, RIFF vs raw PCM16 MIME-aware `validateTtsAudioResponse`.
   - `tts-service.mjs`: Ephemeral preview (`POST /api/tts/preview`) + atomic per-project unique WAV synthesis (`POST /api/projects/:id/tts`), FFprobe check + 48 kHz stereo normalization.
   - `project-store.mjs` & `media-store.mjs`: Private per-project JSON store + safe WAV/MP3/M4A upload (magic sniff, <=64 MiB, <=180s, single audio stream, FFprobe check, path confinement, Range streaming).
2. **Phase 3 — Timing, Subtitles & Safe Mux (`app/server/services/`, `tools/render/mux-mp4.mjs`)**
   - `timing-service.mjs`: Spawns `tools/timing/timing_validator.py`, probes real audio duration via FFprobe, detects script/duration mismatch, labels `approximate-silence-dp` as `UNVERIFIED_WORD_SYNC`.
   - `subtitle-service.mjs`: Reuses `tools/subtitles/cartoon_subs.py` (`punchWords`, `#241726` ink, `#FFE055` highlight, `-c:a copy`), supports `SUB ON`/`SUB OFF` and live `/subtitles-preview?time=S`.
   - `tools/render/mux-mp4.mjs`: Guard against `-shortest` truncating narration or frames (`-frames:v <N>`, explicit duration check + bounded tail-silence pad when permitted).
3. **Phase 4 — Async Job Orchestrator, QA Service & Loopback API (`app/server/`)**
   - `job-manager.mjs`: Finite-state pipeline (`QUEUED -> PREPARING -> VALIDATING_INPUT -> GENERATING_TTS -> PROBING_AUDIO -> ALIGNING -> RENDERING_FRAMES -> MIXING -> MUXING -> SUBTITLES -> VERIFYING -> COMPLETED|FAILED|CANCELED|BLOCKED`), process-tree cancel, crash recovery (`RUNNING -> INTERRUPTED`), SSE progress stream, isolated `workspace/projects/<id>/jobs/<jobId>/`.
   - `qa-service.mjs` + fixed `tools/qa/verify-gates.mjs`: Fix `G14` false-PASS and `G17` branch hardcode; implement Q01–Q18 per-job evidence ledger.
   - `api-router.mjs` + updated `viewer-server.mjs`: Strict `127.0.0.1` loopback + Host/Origin guard, all Studio REST/SSE routes, built React SPA at `/`, legacy `viewer.html` at `/legacy`.
4. **Phase 5 — Compact Dark Studio Frontend (`app/frontend/`)**
   - React 18 + TypeScript + Vite (`#0D1119` slate/navy, `#161D29` panels, `#2A3443` borders, single cyan accent `#38BDF8`, >=44px hit targets, 320px–1440px zero horizontal overflow).
   - Minimal Project Library + 5-step single-workspace Studio (`1. Script & Voice`, `2. Video Settings`, `3. Timing & Preview`, `4. Render & Mix`, `5. QA & Export`) with real 9:16 Three.js preview + timed subtitle overlay + playable verified MP4.
5. **Phase 6 — NEW 30s Ghost Army Demo (`workspace/projects/ghost-army-ww2-30s/src/`)**
   - Original modular `paint-ghost.js`, `ghost-cast.js`, `story.js` (900 frames / 30.00s / 7 dynamic scenes / 1944 U.S. Ghost Army deception tactics), `audio_ghost_army.py` (original procedural WWII suspense music + synchronized SFX), `subtitles_ghost_army.json`.
   - Real English narration imported from user-supplied WAV (with documented `atempo=1.165` silence-trimmed pacing to fit `30.000s` with zero word truncation), full Studio render (`sub-on.mp4` + `sub-off.mp4`), 12-tile story contact sheet + 10-tile subtitle QA check sheet, manifests & probes.
6. **Phase 7–8 — Async Bounded DAG Tests, Visual/E2E Verification, Full Reports & Push to `origin QA`**
   - Unit, integration, timing, subtitle, renderer determinism, negative, regression/backtest, and Playwright E2E tests (`1440×900`, `768×1024`, `390×844`, `320×720`) + screenshots + all 15 report artifacts + scope verification + push to `origin QA`.
