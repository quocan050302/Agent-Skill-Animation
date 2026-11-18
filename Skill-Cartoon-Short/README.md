# Skill-Cartoon-Short — Original Cartoon Short Renderer (`SHORT-01`)

Faithful local reproduction, safety hardening, verification harness, and modular extension baseline for the **9:16 (`1080 × 1920`, `30 FPS`) Cartoon Short Renderer** (2D bean-head `Pen` character cards inside a painted, inked, depth-of-field Three.js `r160` 3D world).

## Licensing & Public Repository Gate (`G03: BLOCKED`)

`Agent-Skill-Animation` is a **public** GitHub repository. Because the supplied `cartoon-short-kit.zip` does not include a `LICENSE` file or explicit public redistribution authorization:
- The unaltered source snapshot (`vendor/cartoon-short-kit/`) and hydrated copies (`engine/web/*`, `workspace/projects/soldier-baseline/*`, `out/original-*`) are **preserved locally for full testing** and excluded from Git commits via `.gitignore`.
- Only independently authored adapters, tools, tests, new 10-second scenario code (`workspace/projects/zombie-supermarket-10s/`), and technical documentation are committed to `feat/short-01-original-engine-fidelity`.
- Upstream dependencies `three@0.160.0` (MIT) and `mromidev/claude-animated-shorts` (`e3b817b6afc6cd413466d43f11ba31209e034bbf`, MIT) are pinned and verified by SHA-256.

## Quick Start (Clean Clone + Local `cartoon-short-kit.zip`)

```bash
cd Skill-Cartoon-Short
npm install
CARTOON_SHORT_KIT_ZIP=/path/to/cartoon-short-kit.zip npm run setup
```

### Run Full Async Verification DAG

```bash
npm test
```

### Render Frames via Controlled CLI / Adapter

```bash
# Original Soldier baseline (frames 0..591)
npm run render -- workspace/projects/soldier-baseline/frames 0-591 1 0.94 --project soldier-baseline

# New Original 10-Second Supermarket Zombie proof (frames 0..299)
npm run render -- workspace/projects/zombie-supermarket-10s/frames 0-299 1 0.94 --project zombie-supermarket-10s
```

### Launch Minimal Loopback 9:16 Real-Engine Test Viewer

```bash
npm run viewer
# Opens on http://127.0.0.1:4319
```

## Key Documentation

- [docs/SOURCE_AUDIT.md](./docs/SOURCE_AUDIT.md) — Forensic inventory, SHA-256 hashes, capability table, and missing-input audit
- [docs/SOURCE_FIDELITY_MANIFEST.json](./docs/SOURCE_FIDELITY_MANIFEST.json) — File-by-file SHA-256 & provenance classification
- [docs/DEPENDENCIES.md](./docs/DEPENDENCIES.md) — Pinned versions & `setup.sh` safety remediation
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 4-pass WebGL pipeline, character cards, timing, linear `-6 dB` audio mixer, and UI contract
- [docs/ENGINE_PARITY.md](./docs/ENGINE_PARITY.md) — Reference `stills.jpg` PSNR/MAE parity & cross-backend determinism
- [docs/QA_REPORT.md](./docs/QA_REPORT.md) — `G01`–`G17` gate results
