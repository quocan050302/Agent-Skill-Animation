# QA-TTS-01 Evidence-Based QA Report (Q01–Q18 & G01–G17)

- **Run ID**: `QA-TTS-01-20261119T153500Z`
- **Evaluated At (UTC)**: `2026-11-19T16:30:12Z`
- **Truthfulness Policy**: Every gate requires verifiable tool/artifact evidence; blocked external capabilities (`GEMINI_API_KEY`, public kit redistribution `G03`), disabled ratios (`1:1`, `16:9`), approximate alignment (`UNVERIFIED_WORD_SYNC`), and human subjective playback review (`UNVERIFIED`) are disclosed explicitly rather than marked PASS.

## Part A: QA-TTS-01 Quality Gates (Q01–Q18)

| Gate | Title | Status | Concrete Evidence |
|---|---|---|---|
| **Q01** | Git forensics & single-repo/branch/scope discipline | **PASS** | `origin` = `quocan050302/Agent-Skill-Animation.git`, branch `QA` from `c67dbd78...`, 100% modified/added paths inside `Skill-Cartoon-Short/**`, `Skill-B6` SHA-256 unchanged (`f27f501f...8eea4ed`), `Skill-Stick-Animation` untouched. |
| **Q02** | Dark Studio UI compact visual design & responsive layout | **PASS** | React 18 + TS + Vite build clean (`tsc --noEmit` + `vite build`); Playwright verified `1440×900`, `768×1024`, `390×844`, `320×720` with `0` horizontal overflow, `0` console/page errors, `>= 44px` hit targets, all 5 numbered steps & live `9:16` stage visible. |
| **Q03** | Security & secret hygiene (`0600`, loopback, traversal, redaction) | **PASS** | Loopback `127.0.0.1` + Host/Origin validation, raw URL `..`/`%2e%2e`/dotfile `403` rejection, `0600` gitignored settings store, API keys never returned in plaintext or leaked in error logs (`tests/unit/tts-and-studio.test.mjs` + `tests/integration/studio-api.test.mjs`). |
| **Q04** | Gemini TTS architecture, MIME/WAV guard & quota policy | **PASS (MOCKED)** / **BLOCKED (LIVE)** | Live API is **`BLOCKED_NO_API_KEY`** (`GEMINI_API_KEY` absent, zero copied external keys). Mocked HTTP suite verified TTS-only model discovery/ranking, global 429 halt without model-hopping, 503 fallback, raw `audio/L16` single-wrap vs `audio/wav` no-double-wrap, corrupt/silent rejection, and concurrent per-project unique WAV isolation. |
| **Q05** | Import Audio replacement workflow (magic sniff + FFprobe + Range) | **PASS** | Verified real English Ghost Army WAV imported via `POST /api/projects/ghost-army-ww2-30s/import-audio` + magic-byte rejection of spoofed PNG/ZIP/HTML files + HTTP `200`/`206` Range playback + 48 kHz stereo WAV normalization. |
| **Q06** | Voiceover & audio format verified via FFprobe | **PASS** | `ghost-army-ww2-30s-sub-on.mp4`: `aac`, `48000 Hz`, `2ch`, `30.000s`, `-16.1 LUFS`, `-1.1 dBFS` true peak. |
| **Q07** | Audio-script timing alignment & overflow protection | **UNVERIFIED** (ASR) / **PASS** (Guard) | Local Whisper absent -> honestly reported `approximate-silence-dp` / `UNVERIFIED_WORD_SYNC`; overflow guard & `strictDurationGuard` verified rejecting audio longer than frame budget (`AUDIO_LONGER_THAN_VIDEO`). |
| **Q08** | Renderer continuity & single-engine discipline (`ShortRendererSession`) | **PASS** | `900/900` contiguous `1080×1920` non-black frames rendered exclusively via Three.js `ShortRendererSession`; `900/900` bit-exact SHA-256 match between 1-worker serial and 2-worker parallel modes. |
| **Q09** | Aspect ratio capability honesty (`9:16` vs `1:1`/`16:9`) | **PASS** | `9:16` (`1080×1920`) `SUPPORTED` & QA-verified; `1:1` and `16:9` explicitly `DISABLED` in `contract.mjs`, API (`400 UNSUPPORTED_ASPECT_RATIO`), and Step 2 UI without fake crop/stretch. |
| **Q10** | Sound mix numeric metrics (`tools/audio/mix.py`) | **PASS** | Linear gated-RMS mix: `measuredMusicRelDb = -6.0 dB`, `measuredSfxRelDb = -6.0 dB`, `duckingApplied = false`, `nonlinearWaveshapingApplied = false`, `masterPeakDbfs = -1.0 dBFS`. |
| **Q11** | MP4 codecs, `+faststart`, duration & anomaly detection | **PASS** | `h264 (High)`, `yuv420p`, `1080×1920`, `30/1 FPS`, `nb_frames = 900`, `duration = 30.000s`, `moovOffset = 32 < mdatOffset = 34236`, `0` black events, `0` freeze events. |
| **Q12** | Subtitles ON (`cartoon_subs.py`) visual burn & audio preservation | **PASS** | `19` curated chunks (`punchWords`, `#241726` ink, `#FFE055` highlight, `#FF6347` punch), `-c:a copy` verified (`audioPreserved = true`), `8/10` non-adjacent post-burn frames confirmed lower-third pixel diff vs `sub-off.mp4`. |
| **Q13** | Subtitles OFF truly unsubtitled | **PASS** | Verified in `tests/integration/studio-api.test.mjs` (`SUB OFF` skips `cartoon_subs.py` cleanly) and paired clean `ghost-army-ww2-30s-sub-off.mp4` (`14,188,724` B, SHA-256 `89d671dc...92b907296`). |
| **Q14** | Async job FSM, cancellation, 409 double-submit, crash recovery | **PASS** | Isolated `jobs/<jobId>/`, `409 JOB_ALREADY_RUNNING`, process-tree cancel cleanup, startup stale-job recovery (`INTERRUPTED`), `0` poll errors across `123` concurrent HTTP requests during 900f render/mux. |
| **Q15** | Full bounded async test DAG (`npm test`) | **PASS** | `13/13` nodes PASS in `33,956 ms` (`lightConcurrency = 4`, `webglWorkers = 2`). |
| **Q16** | Backtest & regression (Soldier 592f, Zombie 300f, `/legacy`, `Skill-B6`) | **PASS** | All legacy workflows intact; `/legacy` E2E passed; 12 negative failure modes self-contained PASS; `Skill-B6` untouched. |
| **Q17** | New 30s Ghost Army demo originality & historical respect | **PASS** | Original 7-scene 2D+3D comedy-history story (`ghost-army-ww2-30s/src/`), zero Nazi emblems, real English spoken narration (0 truncated words), verified 30.000s MP4 + contact & sub-check sheets. |
| **Q18** | Export playability, contact sheets & human review disclosure | **PASS** (Tech) / **UNVERIFIED** (Human) | Playable `16,440,125` B MP4, `1620×960` contact sheet, `1350×960` subtitle QA sheet verified; human real-time playback review explicitly recorded as `UNVERIFIED`. |

## Part B: SHORT-01 Technical Gates (`tools/qa/verify-gates.mjs`, G01–G17)

| Gate | Status | Notes |
|---|---|---|
| `G01`, `G02`, `G04`–`G16` | **PASS** (15 gates) | Fixed `G14` false-PASS bug (`undefined` -> `UNVERIFIED`) and `G16` `Skill-B6` exact tree-hash check. |
| `G03` | **BLOCKED** | Public repo cannot redistribute unlicensed `cartoon-short-kit.zip` (`trackedKitFiles = 0`). |
| `G17` | **PENDING PUSH -> VERIFIED POST-PUSH** | Refactored to branch-aware `expectedBranch = 'QA'`; re-run `npm run qa` immediately after `git push -u origin QA` to confirm `localHEAD === remoteSHA`. |
