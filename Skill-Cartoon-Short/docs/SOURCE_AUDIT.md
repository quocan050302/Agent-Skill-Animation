# Source Forensic Audit (`SHORT-01` Phase A)

## 1. Repository & Baseline State

- **Repository**: `https://github.com/quocan050302/Agent-Skill-Animation` (`visibility: public`, default branch `master`)
- **Baseline `master` Commit SHA**: `6b1c42c6a7eaa482a764c12e6d11cc87f6fd8dd4`
- **Feature Branch**: `feat/short-01-original-engine-fidelity`
- **Protected Sibling Directory**: `Skill-B6/` inspected read-only for conventions (`vendor/` gitignored, `upstream-lock.json`, `docs/agent-runs/`). Working-tree diff digest (`e67777498d661750ac6b971b40d4597fa663148fc11a3a854ebf32384bb2cbc8`) verified identical before and after execution.

---

## 2. Primary Input Sources Audit

1. **`cartoon-short-kit.zip`**: **PRESENT** at `/Users/macbook/Downloads/cartoon-short-kit.zip`
   - Archive size: `444,936` bytes
   - Archive SHA-256: `784c07e36df5e91ddf93c78a1dde6b98b3aa3e3c37cadff03c5603d3971ce788`
   - Entries: `19` total ZIP entries (`5` directories + `14` files; `508,309` uncompressed bytes).
   - Separate `reachmora-2d-longform.zip` present in `/Users/macbook/Downloads` was strictly ignored and not imported.
2. **`Pasted markdown.md` (Cartoon Audio Short SKILL specification)**: **`BLOCKED` (MISSING FROM WORKSPACE)**
   - Searched workspace, `/Users/macbook/Downloads`, `/Users/macbook/Desktop`, and `/Users/macbook/Documents`. The ChatGPT attachment `Pasted markdown.md` was not uploaded to the Antigravity environment.
   - Per Section 2 rules, this missing reference input is recorded as `BLOCKED`; no fake `SKILL.md` was fabricated. Specification comparisons in SHORT-01 are scoped strictly to the requirements stated in the execution prompt (`mix.py` missing, gated-RMS ~6 dB below narration, linear non-ducking mix).

---

## 3. Archive Inventory & SHA-256 Digests

| Archive Entry | Bytes | SHA-256 |
|---|---:|---|
| `cartoon-short-kit/README.md` | 956 | `574f1a91094120ba90048494113c24be8a9c039b3c7263451eec97e498f86179` |
| `cartoon-short-kit/engine/index.html` | 361 | `1f0bf31a7ac6b8768d308e076b0f08bbd2135287b535cf3a535c786c0c06812b` |
| `cartoon-short-kit/engine/main.js` | 31,418 | `cedea9f4cccc747d3c54d1880f6434bdff1e6a9d1f1cfa5072d53d221aed1e56` |
| `cartoon-short-kit/engine/motion.js` | 3,826 | `d895b4d0531fbd1126596e8a558801660edab305c7bfd2d0544dcb64c4e4ffcd` |
| `cartoon-short-kit/engine/paint.js` | 11,477 | `90b342fc03a632aa192dc98debf2bcc2d6f8e33f5d3ffc2093360c1a90d65a71` |
| `cartoon-short-kit/engine/roman.js` | 18,980 | `8d53a82332f8974289ccc07fef67ff42b1caee39c10f88480f56dab798b7a4bc` |
| `cartoon-short-kit/example/soldier/audio.py` | 9,194 | `2384466df631d999e5f93550d8f5e26ce0b15a4092d8c703b19621eff1019b2e` |
| `cartoon-short-kit/example/soldier/stills.jpg` | 406,429 | `8a6791234ec3cbe82291e7804b32626979391a729bac30780b198d1425e3cf96` |
| `cartoon-short-kit/example/soldier/story.js` | 14,033 | `5ba77a6a909b84e69d19ea656a24bfc7cea33ef32ead14e748dd9e91eaa96322` |
| `cartoon-short-kit/tools/finish.sh` | 888 | `43672c85845dd6d4e84c77bde34f92fc2bc4170154a5545fd269ec9fed082bbc` |
| `cartoon-short-kit/tools/render.mjs` | 2,163 | `ca0dbd27b5cd8b8e3cb6a97117d2c6b48b86451c40d9516dce06676579d792ba` |
| `cartoon-short-kit/tools/setup.sh` | 2,085 | `799cff19c0b6f302970794e220cd6f250f1a7e5c59ed609f837e825eda91877e` |
| `cartoon-short-kit/tools/sheet.py` | 516 | `49090c5391cda0dc8b66522900684aac39ed50180e60228a7cd168c103037c04` |
| `cartoon-short-kit/tools/timing.py` | 5,983 | `7bcb23376156d013a1c0255c2c7036eea16ada775444deb44f3368e4551eb450` |

---

## 4. Capability vs Actual Implementation Audit Table

| Capability | Source function / module | Status | Evidence |
|---|---|---|---|
| WebGL world renderer | `engine/main.js`: `renderer`, `applyLight()`, `placeSun()`, `worldState()`, `window.renderFrame(f)` | **Present** (Roman-coupled) | `engine/main.js` L6–15, L90–245, L322–365, L401–427. Note: L90–245 & L338–365 hardcode the Roman river, rotting bridge, gate, SPQR banner, collapsing temple, and 3D helmet. |
| Character drawing | `engine/roman.js`: `OUTFITS`, `romanFront()`, `helmetCard()`, `headCenter()` + external `toon.ts` (`Pen`, `headBlob`, `blobPts`, `faceFront`) + `engine/main.js`: `Card`, `drawActors()` | **Present** (requires external `toon.ts`) | `engine/roman.js` L1–260; `engine/main.js` L248–268, L367–380. `roman.js` relies on non-exported lexical symbols (`FACE`, `SH_SKIN`, `SH_CLOTH`, `ellPts`, `faceFront`) by concatenating after stripped `toon.ts`. |
| Camera movement | `engine/motion.js`: `camFromKeys()`, `spline()`, `M` + `example/soldier/story.js`: `camAt(f)`, `CAMS`, `KICKS` | **Present** | `engine/motion.js` L7–37; `story.js` L44–102. Forensic note: `story.js` does not import `motion.js` — it reimplements `smooth`/`lerp3`/`camAt` locally without `camFromKeys`'s FOV `creep`. |
| Ink postprocessing & DOF | `engine/main.js`: `ndMat`, `cardNd`, `waterNd`, `swapForNd()`, `inkScene` (`edgeAt`), `dofScene` (`coc`) | **Present** | `engine/main.js` L41–55, L270–318, L387–399, L414–425. Verified via `#nd` and `#e` render passes in `tests/integration/pipeline.test.mjs`. |
| Audio timing | `tools/timing.py`: `syll()`, `duration()`, `speech_segments()`, `whisper_words()`, `align()` | **Present** (with edge-case gaps) | `tools/timing.py` L15–113. Tested in `tests/unit/source-and-motion.test.mjs` & `timing_validator.py`. Whisper is optional (absent on host -> silence-DP approximation). Original lacks guards for silent audio (`ZeroDivisionError`) and corrupt inputs. |
| Audio mixing (Linear gated-RMS) | `tools/mix.py` (referenced in SKILL spec) / `example/soldier/audio.py` | **Missing (`mix.py`) / Divergent (`audio.py`)** | `mix.py` does not exist in `cartoon-short-kit.zip`. `example/soldier/audio.py` L173–176 applies envelope-follower ducking (`duck = 1 - 0.45 * clip(...)`) and nonlinear `tanh(mix * 0.95) / tanh(0.95)` waveshaping (+3.2 dBFS raw inter-sample peak). Resolved by authoring `tools/audio/mix.py` (NEW CODE, verified `-6.0 dB` gated RMS). |
| Video encoding | `tools/finish.sh` (FFmpeg `loudnorm` + `libx264` + `aac` + `+faststart`) | **Present** (Bash-only, non-failing QA) | `tools/finish.sh` L1–9. Note: `grep ... \|\| true` on L7 prints black/freeze spans without failing exit status. Replaced for cross-platform verification by `tools/render/mux-mp4.mjs` (`ffprobe` + `moov < mdat` + `ebur128` + strict zero black/freeze assertions). |
| Original Soldier voiceover | `voice.mp3` & `script.txt` (referenced in `story.js` L1 & `audio.py` L11) | **Missing** | Absent from `cartoon-short-kit.zip`. Without `voice.mp3`, original `audio.py` L174 divides `0 / 0` (`NaN`) and writes silent PCM. Authentic narrated Soldier parity is marked `UNVERIFIED`. |
| Studio / Project Editor UI | None in kit | **Missing** | Kit contains only CLI scripts + minimal 4-line `<canvas id="c">` `engine/index.html`. |

---

## 5. Dependency Map of Original Kit

```text
engine/index.html
  └── engine/main.js
        ├── ./lib/three.module.js          [EXTERNAL: npm three@0.160.0 (MIT)]
        ├── ./toon.js                      [GENERATED: stripTypeScriptTypes(toon.ts) + roman.js]
        │     ├── templates/bridge/toon.ts [EXTERNAL: mromidev/claude-animated-shorts (MIT)]
        │     └── engine/roman.js          [KIT: Roman outfits, romanFront, helmetCard, fx*]
        ├── ./paint.js                     [KIT: seeded Canvas2D procedural textures]
        └── ./story.js                     [KIT: example/soldier/story.js (or custom story)]
              └── (optional) ./motion.js   [KIT: camFromKeys, spline, idle, blinkAt, walk, q]
```
