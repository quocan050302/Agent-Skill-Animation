# Vendor Snapshot & Licensing Gate (`Skill-Cartoon-Short/vendor`)

## Provenance & Public Publication Gate (`G03: BLOCKED`)

1. **`cartoon-short-kit/` (Local-Only Unaltered Snapshot)**
   - **Archive**: `cartoon-short-kit.zip` (`444,936` bytes, SHA-256 `784c07e36df5e91ddf93c78a1dde6b98b3aa3e3c37cadff03c5603d3971ce788`)
   - **License Status**: **UNLICENSED / UNVERIFIED FOR PUBLIC REDISTRIBUTION (`G03 = BLOCKED`)**.
   - `cartoon-short-kit.zip` contains no `LICENSE` file, no SPDX identifier, and no explicit redistribution authorization from its author(s). While its `README.md` notes that `toon.ts` comes from `github.com/mromidev/claude-animated-shorts` (MIT), MIT licensing of that upstream dependency does **not** automatically license the authored `engine/*`, `example/soldier/*`, or `tools/*` files inside `cartoon-short-kit.zip`.
   - Because `https://github.com/quocan050302/Agent-Skill-Animation` is a **public** GitHub repository, `vendor/cartoon-short-kit/` is preserved locally byte-for-byte for verification and rendering tests, and excluded from Git commits via `.gitignore`.
   - **To unblock public publication (`G03`)**: Provide a verifiable license file or written redistribution grant from the copyright holder of `cartoon-short-kit.zip`.

2. **Verified Open-Source Upstream Dependencies**
   - **`three@0.160.0`** (`mrdoob/three.js` r160): **MIT License** (`node_modules/three/LICENSE`, SHA-256 `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d`; `build/three.module.js` SHA-256 `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495`).
   - **`mromidev/claude-animated-shorts`** (pinned commit `e3b817b6afc6cd413466d43f11ba31209e034bbf`): **MIT License** (`Copyright (c) 2026 Mr omi`, `LICENSE` SHA-256 `0c88b6c1afe23ba94a2326eb289868fa4bb24edfd6994ad0c6bb7f2f2ed517e2`; `templates/bridge/toon.ts` SHA-256 `ed6823daad4cc5cdb88a7215502af545fe621efc18d58ea175f7464cc02fd725`).

## Local Hydration

Place `cartoon-short-kit.zip` locally (or set `CARTOON_SHORT_KIT_ZIP=/path/to/cartoon-short-kit.zip`) and run:

```bash
npm run setup
```

`tools/setup/hydrate.mjs` extracts `cartoon-short-kit.zip` into `vendor/cartoon-short-kit/` without modifying a single byte and verifies every SHA-256 hash against `vendor/source-manifest.json`.
