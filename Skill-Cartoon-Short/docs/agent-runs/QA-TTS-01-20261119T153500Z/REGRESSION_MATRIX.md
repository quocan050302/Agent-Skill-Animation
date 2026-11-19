# QA-TTS-01 Regression & Backtest Matrix

| Area / Baseline | Pre-QA-TTS-01 (`c67dbd7`) | Post-QA-TTS-01 (`QA`) | Status | Notes |
|---|---|---|---|---|
| **Vendor Kit Snapshot (`14/14` SHA-256)** | 14/14 matched | 14/14 matched | **PASS** | `vendor/cartoon-short-kit/` immutable, `trackedKitFiles = 0` (`G03` stays `BLOCKED`). |
| **`Skill-B6/` Repository Isolation** | Tree SHA `f27f501f...8eea4ed` | Tree SHA `f27f501f...8eea4ed`, `diff = 0`, `staged = 0` | **PASS** | Byte-for-byte untouched. |
| **Source Branch (`feat/short-01-original-engine-fidelity`)** | `c67dbd78...` | `c67dbd78...` (unchanged) | **PASS** | All work strictly on branch `QA`. |
| **Soldier Baseline (`soldier-baseline`, 592f)** | WebGL 1080×1920, deterministic | WebGL 1080×1920, 3/3 sampled frames byte-identical across 2 Chromium sessions | **PASS** | Preserved unmodified (`engine/web/main.js` untouched). |
| **Zombie 10s Proof (`zombie-supermarket-10s`, 300f)** | Modular world hydrated, 300f MP4 | Modular world hydrated, 300f MP4 & legacy viewer intact | **PASS** | Zero breaking changes to `src/story.js` or `modular-world.mjs`. |
| **Legacy Real-Engine Test Viewer (`viewer.html`)** | Served at `/` | Served intact at `/legacy` (E2E verified Soldier 592f + Zombie 300f) | **PASS** | New React Dark Studio SPA served at `/` with link to `/legacy`. |
| **Spec-Compliant Audio Mixer (`tools/audio/mix.py`)** | Linear gated-RMS `-6 dB`, 0 ducking | Reused directly by Studio `JobManager` & `ghost-army-ww2-30s` (`-6.0 dB`) | **PASS** | Zero unwanted ducking or `tanh` clipping. |
| **Cartoon Subtitle Engine (`tools/subtitles/cartoon_subs.py`)** | CLI-only ASS + libass burn-in | Integrated directly into Studio Step 2/3/4/5 (`SUB ON` vs `SUB OFF`, `-c:a copy`) | **PASS** | Reused directly with `punchWords`, `#241726` ink, `#FFE055` highlight. |
| **QA Gate Truthfulness (`tools/qa/verify-gates.mjs`)** | `G14` false-PASS on `undefined`; `G17` hardcoded branch | `G14` returns `UNVERIFIED` when omitted; `G17` branch-aware (`QA`) | **PASS** | Regression unit test verifies `G14` cannot false-PASS. |
| **Negative Suite (12 Failure Modes)** | 11/12 passed in fresh worktree (#6 needed local `voice.mp3`) | 12/12 self-contained PASS | **PASS** | Self-contained valid WAV fallback for clean-clone runs. |
| **Forbidden Repo (`Skill-Stick-Animation`)** | Untouched | Zero writes / untouched | **PASS** | Verified strictly inside `Agent-Skill-Animation/Skill-Cartoon-Short/`. |
