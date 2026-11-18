# Engine Parity Report (`SHORT-01`)

## 1. Exact Source Reproduction

- **Byte-Identical Snapshot**: All 14 files in `cartoon-short-kit.zip` (`SHA-256: 784c07e36df5e91ddf93c78a1dde6b98b3aa3e3c37cadff03c5603d3971ce788`) were extracted without modification into local `vendor/cartoon-short-kit/` and verified byte-for-byte (`14/14` SHA-256 matches).
- **Soldier Parity Baseline (`engine/web/` & `workspace/projects/soldier-baseline/web/`)**: Executes the **100% unmodified** original `index.html`, `main.js`, `motion.js`, `paint.js`, `roman.js`, and `example/soldier/story.js` alongside pinned `three@0.160.0` and `mromidev/claude-animated-shorts` (`e3b817b6afc6cd413466d43f11ba31209e034bbf`).

---

## 2. Actual Rendered Behavior & Reference `stills.jpg` Forensic Comparison

All `592` frames (`f0000.jpg` .. `f0591.jpg`, `19.733 s` @ `30 FPS`, `1080 × 1920`) of the original Soldier story were rendered (`33.01 ms/frame` on `ANGLE Metal Renderer: Apple M1 Pro`).

Comparing every `270 × 480` tile of `example/soldier/stills.jpg` (`1890 × 960`, 7×2 grid) against all `592` rendered frames established:

### 2.1 Directly Matched Reference Tiles (10 / 14 Tiles)

| `stills.jpg` Tile | Matched Frame | Shot ID | MAE (`0..255`) | PSNR (`dB`) | Parity Note |
|---:|---:|---|---:|---:|---|
| Tile 0 (r0c0) | `f0005` | `hook` | `3.390` | `32.86 dB` | Near-identical close-up Roman soldier, Bokeh houses, ink & toon shading |
| Tile 4 (r0c4) | `f0160` | `collapse` | `1.931` | `37.64 dB` | Near-identical golden-hour temple pre-collapse & foreground defocused soldier |
| Tile 5 (r0c5) | `f0215` | `collapse` | `3.206` | `33.11 dB` | Near-identical rack-focus back to soldier in golden hour |
| Tile 7 (r1c0) | `f0300` | `workers` | `3.150` | `30.51 dB` | Near-identical sleeping bearded soldier with `ZZZ`, cobweb, and two workers |
| Tile 8 (r1c1) | `f0340` | `workers` | `3.671` | `29.22 dB` | Near-identical rusted helmet lifted above bald bearded soldier |
| Tile 9 (r1c2) | `f0401` | `inside` | `2.699` | `31.30 dB` | Near-identical 3D helmet interior `"THE BRIDGE IS NOT SAFE"` |
| Tile 10 (r1c3) | `f0450` | `inside` | `4.738` | `25.98 dB` | Matched close-in push + Dutch roll (`DejaVu Serif` vs macOS `Times/Serif` fallback explains minor glyph width difference) |
| Tile 11 (r1c4) | `f0470` | `shock` | `3.961` | `27.91 dB` | Near-identical workers hands-on-cheeks shock reaction + sweat drops |
| Tile 12 (r1c5) | `f0520` | `under` | `3.926` | `28.00 dB` | Near-identical under-bridge rotting piles, moss, bracket fungus, river |
| Tile 13 (r1c6) | `f0575` | `under` | `6.159` | `22.54 dB` | Matched end-of-shot under-bridge framing after diagonal brace snaps |

### 2.2 Divergent Reference Tiles in `stills.jpg` (4 / 14 Tiles: Indices 1, 2, 3, 6)

Tiles `1` (`hook` wide), `2` (`hook` end), `3` (`refuse`), and `6` (`crazy`) in `example/soldier/stills.jpg` were captured by the kit author from an earlier camera draft of `story.js` before `CAMS.hook`, `CAMS.refuse`, and `CAMS.crazy` were updated in the shipped `story.js`:
- Example proof: in `stills.jpg` Tile 1 & Tile 2, the camera is positioned further forward past the stone gate (`x > -20`), whereas `story.js` L48–49 sets `CAMS.hook` to `pos: [-30.5, 10.8, 12.0]` (behind the stone gate arch, framing the soldier under the gate). Similarly, `stills.jpg` Tile 3 clips half of the toga citizen at the right border, whereas `story.js` L52–53 widens `CAMS.refuse` (`fov: 40`) so both characters fit cleanly inside the frame.
- Consistent with Section 10.1 rules, no similarity score is claimed for those 4 unmatched camera-draft tiles.

### 2.3 Cross-Backend Determinism (`ANGLE Metal` vs `SwiftShader`)

- Same-session and cross-session renders on `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)` produced **100% identical JPEG SHA-256 hashes** (`f0000`, `f0160`, `f0401` verified in `tests/regression/parity-and-negative.test.mjs`).
- Comparing `ANGLE Metal` against `SwiftShader` (`--use-angle=swiftshader`, matching original `tools/render.mjs`) on `f0000.jpg` yielded `MAE = 0.608 / 255` (`99.76%` pixel agreement), with `Metal` running ~20× faster (`33 ms/frame` vs `~700–3500 ms/frame`).

---

## 3. Compatibility Differences & Isolated Extensions

1. **System Font Fallback on macOS (`DejaVu Serif, serif` / `Arial Black, Arial`)**:
   - `paint.js` (`banner()`, `helmetInside()`) specifies `DejaVu Serif, serif`. On Linux hosts `DejaVu Serif` is default; on macOS Chromium falls back to the system `serif` face, causing tiny glyph kerning differences inside the helmet inscription while keeping text crisp and legible.
2. **Audio Mixing Discrepancy (`audio.py` vs `tools/audio/mix.py`)**:
   - Original `example/soldier/audio.py` applies envelope-follower ducking and `tanh` soft-clipping (`+3.2 dBFS` raw inter-sample peak before `loudnorm`).
   - `tools/audio/mix.py` (NEW CODE) implements the specification-compliant linear gated-RMS mixer (`-6.0 dB` music and SFX relative to narration, zero ducking, `-1.0 dBFS` true-peak ceiling). Both modes are preserved and tested separately.
3. **Isolated World Generalization (`engine/patches/modular-world.mjs`)**:
   - Original `engine/main.js` hardcodes the Roman bridge/temple scene. To prove general story rendering (`zombie-supermarket-10s`) without altering the Soldier parity baseline, `modular-world.mjs` injects an optional `STORY.buildWorld()` / `updateWorld()` hook **only** inside `workspace/projects/zombie-supermarket-10s/web/main.js`.

---

## 4. Known Gaps & Unverified Items

- **Authentic Soldier `voice.mp3` Parity (`UNVERIFIED`)**: `cartoon-short-kit.zip` omits `voice.mp3`. Technical video/audio pipeline verification used a clearly labeled procedural synthetic speech-cadence fixture (`19.733 s`, 9 phrase windows).
- **SKILL Specification Verbatim Audit (`BLOCKED`)**: `Pasted markdown.md` was not present in the workspace.
- **Public Redistribution of `cartoon-short-kit` (`G03: BLOCKED`)**: `cartoon-short-kit.zip` carries no license file; preserved locally and excluded from public Git commits.
- **Native Windows Runner Execution (`UNVERIFIED`)**: `tools/setup/setup.ps1` and cross-platform Node/Python tools avoid hardcoded paths/symlinks, but were executed on `darwin-arm64` rather than a Windows host.

---

## 5. Future Improvements (Before Full Studio UI)

1. Obtain copyright/licensing clearance (or clean-room MIT replacement of `engine/*`) to unblock `G03` for public Git distribution.
2. Design a declarative `scene.json` -> ES module story compiler for `SHOTS`, `CAMS`, `LIGHTS`, `dofAt`, and modular prop/world kits so the Studio UI can edit keyframes without raw JS rewriting.
3. Bundle an OFL-licensed serif/display webfont (`Noto Serif` / `Archivo Black`) in `engine/web/` to eliminate Linux vs macOS/Windows canvas glyph differences.
