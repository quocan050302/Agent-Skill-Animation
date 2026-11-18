# Technical QA Report (`SHORT-01`)

## 1. Quality Gate Summary (`G01` – `G17`)

| Gate | Requirement | Status | Evidence Summary |
|---|---|---|---|
| `G01` | Original source inventoried | **PASS** | 14 files + 5 dirs in `cartoon-short-kit.zip` cataloged; missing `Pasted markdown.md` (`BLOCKED`), `voice.mp3`, and `mix.py` documented. |
| `G02` | Source SHA-256 manifest verified | **PASS** | 14/14 files in `vendor/cartoon-short-kit/` verified byte-identical to archive SHA-256 hashes (`vendor/source-manifest.json`, `docs/SOURCE_FIDELITY_MANIFEST.json`). |
| `G03` | License/provenance gate resolved | **BLOCKED** | Target repo is public; `cartoon-short-kit.zip` has no `LICENSE` file. Upstream `three@0.160.0` (MIT) & `mromidev/claude-animated-shorts` (MIT) verified. Unverified kit files preserved locally and blocked from Git push. |
| `G04` | Dependencies pinned and installable | **PASS** | `three@0.160.0`, `playwright@1.65.1` locked in `package-lock.json`; `claude-animated-shorts` pinned to `e3b817b6afc6cd413466d43f11ba31209e034bbf`. (Windows execution `UNVERIFIED` on macOS runner.) |
| `G05` | Chromium starts successfully | **PASS** | Headless Chromium `159.0.8154.6` verified over loopback `127.0.0.1`. |
| `G06` | WebGL renderer initializes | **PASS** | WebGL 2.0 (`ANGLE Metal Renderer: Apple M1 Pro` & `SwiftShader`), `0` page/shader/HTTP errors. |
| `G07` | Original frame 0 renders | **PASS** | `1080×1920`, `nonBlackRatio=1.0`, `meanLuma=119.017`, `Metal` vs `SwiftShader` MAE `0.608/255`. |
| `G08` | Multiple original frames render | **PASS** | `592/592` frames rendered (`33.01 ms/frame`); `10/14` `stills.jpg` tiles matched (`PSNR 22.54–37.64 dB`). |
| `G09` | Ink and character rendering inspected | **PASS** | `#e` ink edge pass, `#nd` normal/depth pass, Pillow `darkInkRatio=0.132`, `edgeGradientP99 > 20`, plus visual inspection of both contact sheets. |
| `G10` | Frame output passes validation | **PASS** | `592` Soldier + `300` Zombie frames passed SOI/EOI/SOF `1080×1920` (`9:16`), non-black, ordered sequence validation. |
| `G11` | Timing pipeline tested | **PASS** | `timing_validator.py` verified 56 words / 9 phrases (`approximate-silence-dp`) + negative manifest tests. |
| `G12` | Audio path tested to the available extent | **PASS** | Dual-mode tested: `original-baseline` (`ducked+tanh`) & `spec-compliant` `mix.py` (`-6.000 dB` music, `-5.908 dB` / `-6.000 dB` SFX gated RMS). Authentic Soldier `voice.mp3` parity `UNVERIFIED`. |
| `G13` | MP4 export tested | **PASS** | Both MP4s verified via `ffprobe`: `h264` (`High`, `yuv420p`, `1080×1920`, `30/1`), `aac` (`48 kHz` stereo), `+faststart` (`moov` at byte `32` < `mdat`), `0` black/freeze spans. |
| `G14` | Repeatability/regression checked | **PASS** | Identical frame SHA-256 across independent Chromium sessions; `14/14` vendor immutability backtest; `12/12` negative tests passed. |
| `G15` | New original scenario tested | **PASS** | `zombie-supermarket-10s` (`300` frames, `10.000 s`) rendered from code (`35.75 ms/frame`) with new 3D world, pose/expression progression, knocked tin can action, close-up scream, flash transition, secondary motion, and slump ending. |
| `G16` | Unrelated `Skill-B6` files unchanged | **PASS** | `git diff -- Skill-B6` SHA-256 unchanged (`e67777498d661750ac6b971b40d4597fa663148fc11a3a854ebf32384bb2cbc8`); `0` `Skill-B6` files staged/committed. |
| `G17` | GitHub commit/push status verified | **PASS / VERIFIED AT PUSH** | Verified on `origin/feat/short-01-original-engine-fidelity` with `0` unverified third-party kit files in commit tree. |

---

## 2. Test DAG Execution Summary (`npm test`)

Executed via `node tests/run-dag.mjs` (`8/8` DAG stages passed):
1. `source-audit` (`PASS`)
2. `hash-verification` (`PASS`)
3. `dependency-checks` (`PASS`)
4. `unit-tests` (`PASS` — 6 subtests)
5. `engine-setup` (`PASS`)
6. `browser-smoke-and-integration` (`PASS` — WebGL `#nd`/`#e`/final passes, Pillow ink/luma QA, `-6 dB` linear mixer, H.264/AAC faststart MP4)
7. `regression-backtest-negative` (`PASS` — multi-session SHA-256 determinism, vendor snapshot backtest, and 12 negative failure-propagation tests)
8. `e2e-viewer-and-full-render-qa` (`PASS` — Playwright E2E test of `127.0.0.1` 9:16 real-engine test viewer across both projects)

---

## 3. Visual QA Findings

- **`out/original-reference-contact-sheet.jpg` (`1890 × 960`, 14 tiles)**: Confirmed crisp `#241726` bean-head outlines, 2-band toon shading, bridge plank/stone procedural textures, autumn leaves, golden-hour temple collapse, white flash transition at `f0278`, snoring bearded soldier with cobweb, 3D carved helmet interior (`"THE BRIDGE IS NOT SAFE"`), shock sweat drops, and under-bridge rotting piles with snapped diagonal brace.
- **`out/new-original-contact-sheet.jpg` (`1350 × 960`, 10 tiles)**: Confirmed automatic glass doors sliding open under `"FRESH-MART 24H"` & `"AISLE 4 — ORGANIC BRAINZ — 100% SOLD OUT!"`, stocked side aisles, shambling green zombie with stitched forehead scar, reaching & knocking red tin can off bare shelf with dust puff, unobstructed `"SOLD OUT / NO BRAINS LEFT / TRY TOFU IN AISLE 9"` close-up, unobstructed hands-on-cheeks scream close-up, and dazed spiral-eyed crying slump ending.
  - *Note*: Subjective human viewer retention/playback enjoyment is marked `NOT_VERIFIED` (technical and frame-sheet inspection only).
