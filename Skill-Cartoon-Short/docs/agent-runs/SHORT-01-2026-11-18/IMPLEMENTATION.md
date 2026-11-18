# Implementation Summary (`SHORT-01-2026-11-18`)

## 1. Original Kit Preservation (Zero-Diff Baseline)

- `vendor/cartoon-short-kit/` holds all 14 archive files unaltered (verified by `vendor/source-manifest.json`).
- `engine/web/` and `workspace/projects/soldier-baseline/web/` execute byte-identical copies of `index.html`, `main.js`, `motion.js`, `paint.js`, `roman.js`, and `example/soldier/story.js` with pinned `three@0.160.0` and `mromidev/claude-animated-shorts@e3b817b6afc6cd413466d43f11ba31209e034bbf` (`toon.ts`).
- All core engine functions (`applyLight`, `placeSun`, `worldState`, `drawActors`, `swapForNd`, `window.renderFrame`, `camFromKeys`, `idle`, `blinkAt`, `walk`, `q`, `OUTFITS`, `romanFront`, `helmetCard`, `headCenter`, `rng`, `tex`, `planks`..`marble`, `SHOTS`..`fxAt`) were preserved unmodified.

## 2. New Independently Authored Modules

- **Setup & Hydration (`tools/setup/hydrate.mjs`, `setup.sh`, `setup.ps1`)**: Isolated project-local cache extraction, SHA-256 verification, pinned upstream `toon.ts` fetch & Node `module.stripTypeScriptTypes` transformation, disk preflight, and atomic writes.
- **Controlled Renderer Adapter (`engine/adapters/renderer-adapter.mjs`, `tools/render/render-cli.mjs`)**: Implements `initializeRenderer`, `renderFrame`, `renderFrameRange`, `renderStill`, `getRenderMetadata`, `disposeRenderer` over `127.0.0.1` loopback HTTP with bounded WebGL concurrency (`max=1`), WebGL context/shader validation, 108×192 luma non-black checks, JPEG SOI/EOI/SOF `1080×1920` verification, `AbortSignal` cancellation, and stale-cache recovery.
- **Isolated Modular World Patch (`engine/patches/modular-world.mjs`)**: Adds optional `STORY.buildWorld()` / `updateWorld()` hook **only** to non-Soldier custom projects (`zombie-supermarket-10s`), keeping the 4-pass Three.js Toon + Card + ND + Ink + DOF pipeline intact.
- **Timing & Dual-Mode Audio (`tools/timing/timing_validator.py`, `tools/audio/mix.py`, `tools/audio/audio_pipeline.py`)**: Validates timing invariants and provides the missing linear gated-RMS `-6.0 dB` mixer (`mix.py`) alongside the legacy ducked/nonlinear `audio.py` runner.
- **MP4 Muxer & Visual QA (`tools/render/mux-mp4.mjs`, `tools/render/contact-sheet.py`, `tools/qa/image-inspector.mjs`, `tools/qa/verify-gates.mjs`)**: Verifies H.264/AAC `1080×1920` `30/1` `yuv420p`, binary `moov < mdat` faststart, EBU R128 loudness, and zero black/freeze spans.
- **New 10-Second Proof (`workspace/projects/zombie-supermarket-10s/`)**: Custom 3D supermarket scene, procedural Canvas2D floor/shelf/sign textures, `zombieFront` bean-head character on MIT `Pen`, 5-shot camera plan using `engine/motion.js`, physical tin-can knock/roll action, reaction scream close-up, and procedural `-6.0 dB` gated-RMS audio.
- **Future Studio UI Preparation (`app/shared/contract.mjs`, `app/server/viewer-server.mjs`, `app/frontend/viewer.html`)**: Strict `9:16` format-locked contract and loopback live Three.js test viewer.
