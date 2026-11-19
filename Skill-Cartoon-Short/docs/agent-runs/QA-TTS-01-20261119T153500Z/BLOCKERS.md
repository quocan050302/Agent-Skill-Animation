# QA-TTS-01 Truthful Blockers & Known Limitations

This document discloses every verified blocker, unverified item, and capability boundary without fabricating PASS results.

## 1. Live Gemini TTS Execution (`BLOCKED_NO_API_KEY`)
- **Status**: `BLOCKED` (for live external Gemini API network synthesis) / `PASS (MOCKED)` (for local mocked HTTP tests).
- **Root Cause**: `GEMINI_API_KEY` is not set in the execution environment, and project security rules strictly prohibit copying API keys from external repositories (`out-of-step-studio`) or arbitrary user machine directories.
- **What Is Verified**: Full Gemini TTS backend (`settings-store.mjs`, `gemini-models.mjs`, `gemini-transport.mjs`, `tts-service.mjs`, `/api/tts/*`, `/api/projects/:id/tts`, Studio Step 1 UI + Settings dialog) is implemented and verified with mocked HTTP tests covering model discovery/ranking, global 429 halt, 503 fallback, raw PCM vs RIFF no-double-wrap validation, secret masking/redaction, and concurrent per-project unique WAV isolation.
- **How to Unblock Locally**: Copy `.env.example` to `.env`, set `GEMINI_API_KEY=<your-key>` (or save via Studio `API Settings` dialog into gitignored `0600` local store), and click **Discover TTS Models** / **Listen Voice Sample** / **Generate Full Narration**.

## 2. Public Redistribution Gate (`G03: BLOCKED`)
- **Status**: `BLOCKED` (unchanged from SHORT-01, strictly preserved).
- **Root Cause**: Target repository `quocan050302/Agent-Skill-Animation` is public, and the supplied `cartoon-short-kit.zip` contains no `LICENSE` or redistribution permission.
- **Mitigation**: `vendor/cartoon-short-kit/`, hydrated `engine/web/*`, `workspace/projects/soldier-baseline/*`, and local generated audio/video outputs remain excluded via `.gitignore` (`trackedKitFiles = 0`).

## 3. Aspect Ratios Beyond 9:16 (`1:1` and `16:9` — `DISABLED`)
- **Status**: `DISABLED` / `UNVERIFIED`.
- **Root Cause**: Supporting `1:1` (`1080×1080`) or `16:9` (`1920×1080`) truthfully requires perspective camera recomposition, widened 3D stage blocking, updated Ink/DOF WebGL render target dimensions, recalculated subtitle safe zones, and dedicated 60+ frame QA per ratio; cropping or stretching `9:16` is prohibited.
- **Current Behavior**: Only `9:16` (`1080×1920`) is enabled and QA-verified; `1:1` and `16:9` appear visibly disabled in both `app/shared/contract.mjs` and Step 2 UI with explicit plain-language reasons.

## 4. Word-Level ASR Synchronization (`UNVERIFIED_WORD_SYNC`)
- **Status**: `UNVERIFIED` for exact automatic ASR word timestamps.
- **Root Cause**: Local `whisper` ASR is not installed in the Python environment; `tools/timing/timing_validator.py` falls back to `approximate-silence-dp` phrase alignment, which is honestly labeled `UNVERIFIED_WORD_SYNC` by `timing-service.mjs` and Step 3 UI.
- **Ghost Army 30s Demo Mitigation**: Subtitle chunk windows in `workspace/projects/ghost-army-ww2-30s/src/subtitles.json` were authored directly from FFmpeg speech-segment timings of the real spoken recording and visually verified across 10 post-burn timestamps (`ghost-army-ww2-30s-sub-check.jpg`).

## 5. Human Subjective Viewing & Playback Inspection (`UNVERIFIED`)
- **Status**: `UNVERIFIED` (automated FFprobe, EBU R128 loudness, black/freeze detection, lower-third subtitle pixel-diff, contact sheets, and Playwright visual inspections passed; no human reviewer watched live audio-video playback in real time during this automated run).
