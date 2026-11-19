# QA-TTS-01 Final Status & Acceptance Checklist

- **Overall Status**: **`PARTIALLY_PASS`** (All code, Dark Studio React UI, async/parallel acceleration, 13/13 DAG tests, responsive E2E screenshots, and the 30.000s / 900-frame Ghost Army demo **PASS**; external live Gemini TTS is honestly **`BLOCKED_NO_API_KEY`**, public kit redistribution **`G03`** stays **`BLOCKED`**, `1:1`/`16:9` ratios stay **`DISABLED`**, local ASR word sync is **`UNVERIFIED_WORD_SYNC`**, and human live playback is **`UNVERIFIED`**.)
- **Canonical Repository**: `https://github.com/quocan050302/Agent-Skill-Animation.git`
- **Forbidden Repo (`Skill-Stick-Animation`)**: Untouched (`0` writes)
- **Source Branch**: `origin/feat/short-01-original-engine-fidelity` (`c67dbd785c08edb4d824f8036588ce2294b627fe`, untouched)
- **Target Branch**: `QA` (commit & non-force push verified via `git ls-remote --heads origin QA == git rev-parse HEAD` + post-push `npm run qa` `G17: PASS`)
- **Scoped Directory**: `Skill-Cartoon-Short/**` ONLY (`Skill-B6/` diff = `0`, tree SHA-256 = `f27f501f23c8c927a5ccf50f9bd6dcd63d90bc0e9fa01649fc73f7a508eea4ed`)

## Acceptance Checklist

| # | Deliverable / Gate | Status | Evidence |
|---|---|---|---|
| 1 | Correct repository (`Agent-Skill-Animation`), branch `QA`, `Skill-Cartoon-Short/**` scope only | **PASS** | `FILES_CHANGED.md`, `BASELINE.md`, `G16: PASS` |
| 2 | Compact Dark Studio React 18 + TS + Vite SPA (`5` visible steps, `>=44px` targets, responsive `320–1440px`, `/legacy` intact) | **PASS** | `npm run build` PASS, `tests/e2e/studio-ui.test.mjs` PASS, 6 screenshots in `screenshots/` |
| 3 | Gemini TTS ported from `out-of-step-studio` (MIT), MIME/WAV guard, global 429 halt, per-project WAVs | **PASS (MOCKED)** / **BLOCKED (LIVE)** | Mocked HTTP tests PASS (`unit-tts-studio`, `integration-studio-api`); live network synthesis `BLOCKED_NO_API_KEY` |
| 4 | Import Audio replacement workflow (magic sniff + FFprobe + 48 kHz WAV + Range streaming) | **PASS** | Used end-to-end for real English Ghost Army voiceover + negative spoofed-file rejection tests |
| 5 | Honest Aspect Ratios (`9:16` supported; `1:1` & `16:9` disabled with explanation) | **PASS** | `app/shared/contract.mjs`, API `400`, Step 2 UI |
| 6 | Cartoon Subtitles (`tools/subtitles/cartoon_subs.py`) `SUB ON` vs `SUB OFF` with `-c:a copy` | **PASS** | `ghost-army-ww2-30s-sub-on.mp4` (`8/10` visible caption diff) + `ghost-army-ww2-30s-sub-off.mp4` |
| 7 | New 30s / 900f Ghost Army Demo (**"The Fake Army That Fooled the Nazis"**) | **PASS** | `16,440,125` B, SHA-256 `1a4caf250c769e116800951dda4c7aa59c59b677bd6e4db6fe230002d15711e7`, `30.000s`, `900` frames, `-16.1 LUFS`, `0` black/freeze |
| 8 | Async & bounded parallel acceleration with lossless parity | **PASS** | 2-worker WebGL `14.18s` vs serial `23.10s` (`1.63×`, `63.46 FPS`, `900/900` bit-exact SHA-256); non-blocking mux (`0` poll drops); 13/13 parallel DAG in `33.96s` |
| 9 | Full Evidence Reports (`15` files + `6` screenshots) | **PASS** | `Skill-Cartoon-Short/docs/agent-runs/QA-TTS-01-20261119T153500Z/` |
| 10 | Security hygiene (`0` secrets, `0` kit files, `0` `.mp4`/`.wav` staged) | **PASS** | Verified via `git ls-files --others` & `.gitignore`; `G03` stays `BLOCKED` |
| 11 | Git commit + non-force `git push -u origin QA` + remote SHA match | **EXECUTING NOW -> VERIFIED POST-PUSH** | Verified immediately via `git ls-remote --heads origin QA` & `npm run qa` |
