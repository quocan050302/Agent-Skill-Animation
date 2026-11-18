# Dependencies & Provenance Lock (`Skill-Cartoon-Short`)

## 1. Runtime & System Toolchains (Verified on Runner)

| Dependency | Verified Version | Purpose | Platform Verification |
|---|---|---|---|
| Node.js | `v22.22.3` (`>= 22.6.0`) | ES module runtime, built-in `module.stripTypeScriptTypes`, HTTP loopback server, DAG runner | `PASS` (`darwin-arm64`); `UNVERIFIED` (`win32`) |
| npm | `10.9.8` | Deterministic lockfile installation (`package-lock.json`) | `PASS` |
| Python 3 | `3.13.0` | Timing DP alignment, gated-RMS linear mixer (`mix.py`), procedural DSP stems, Pillow contact sheets | `PASS` (`darwin-arm64`); `UNVERIFIED` (`win32`) |
| NumPy | `2.1.3` | Audio synthesis, FFT filtering, gated-RMS calculation, perceptual image metrics | `PASS` |
| Pillow (`PIL`) | `13.0.0` | Contact sheet compositing (`270x480` 9:16 tiles) and frame gradient/ink QA | `PASS` |
| FFmpeg | `6.0` | Audio decode/encode, `silencedetect`, `ebur128`, `blackdetect`, `freezedetect`, `libx264`+`aac` `+faststart` mux | `PASS` |
| FFprobe | `4.4-tessus` | Container/stream/codec/duration/frame-count verification | `PASS` |
| Playwright | `1.65.1` (pinned in `package.json`) | Headless Chromium automation | `PASS` |
| Headless Chromium | `159.0.8154.6` | WebGL 2.0 execution (`ANGLE Metal` & `SwiftShader`) | `PASS` |
| Faster-Whisper / OpenAI-Whisper | *Not installed* | Optional word-level ASR in `timing.py` | Absent -> script + `silencedetect` DP fallback used and explicitly labeled `approximate-silence-dp` |

---

## 2. Pinned External Open-Source Dependencies

### 2.1 Three.js (`three@0.160.0`)
- **Source**: npm official registry (`https://registry.npmjs.org/three/-/three-0.160.0.tgz`)
- **Pinned Version**: `0.160.0` (locked in `package.json` & `package-lock.json`)
- **License**: `MIT` (`node_modules/three/LICENSE`, SHA-256: `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d`)
- **Runtime Module**: `node_modules/three/build/three.module.js`
  - Size: `1,272,972` bytes
  - SHA-256: `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495`

### 2.2 `mromidev/claude-animated-shorts` (`templates/bridge/toon.ts`)
- **Repository**: `https://github.com/mromidev/claude-animated-shorts.git`
- **Pinned Git Commit SHA**: `e3b817b6afc6cd413466d43f11ba31209e034bbf` (verified via `git rev-parse HEAD` inside `tools/setup/hydrate.mjs`, replacing the unpinned `--depth 1` clone in original `tools/setup.sh`)
- **License**: `MIT` (`Copyright (c) 2026 Mr omi`, `LICENSE` SHA-256: `0c88b6c1afe23ba94a2326eb289868fa4bb24edfd6994ad0c6bb7f2f2ed517e2`)
- **Source File**: `templates/bridge/toon.ts`
  - Size: `54,503` bytes
  - SHA-256: `ed6823daad4cc5cdb88a7215502af545fe621efc18d58ea175f7464cc02fd725`
- **Stripped Output (`toonbase.js`)**:
  - Generated deterministically via `module.stripTypeScriptTypes(source, { mode: 'transform' })` on Node `v22.22.3`
  - SHA-256: `8fbe2efb40c8e643c09f01d540d3ec23493a31ae713aac2dcdf7f5f7c5b70c64`

---

## 3. Original `tools/setup.sh` Safety Remediation

| Original `tools/setup.sh` Behavior | Risk | Remediation in `tools/setup/hydrate.mjs`, `setup.sh`, `setup.ps1` |
|---|---|---|
| `cd /tmp && rm -rf _three` / `rm -rf _t3` / `/tmp/_cas` | Mutates shared global `/tmp`; multi-process race conditions; breaks on Windows | Uses isolated project-owned `workspace/cache/` subdirectories with PID+timestamp suffixes |
| `mkdir -p "$KIT/vendor" ... cp ... "$KIT/vendor/toon.ts"` | Mutates the reference kit directory directly | Extracts `vendor/cartoon-short-kit/` once read-only and verifies all 14 SHA-256 hashes |
| `git clone -q --depth 1 https://github.com/mromidev/claude-animated-shorts` | Moving `HEAD` branch without commit or hash check | Fetches exact commit `e3b817b6afc6cd413466d43f11ba31209e034bbf` and verifies `toon.ts` + `LICENSE` SHA-256 |
| `node -e "...stripTypeScriptTypes..." 2>/dev/null` | Silently swallows TypeScript-stripping failures | Checks `typeof module.stripTypeScriptTypes === 'function'` and validates `export class Pen` in output |
| `ln -sf "$(npm root -g)/playwright" "$P/node_modules/playwright"` | Fails without global npm Playwright; requires elevated symlink permissions on Windows | Uses local `package.json` / `package-lock.json` (`playwright@1.65.1`) |
