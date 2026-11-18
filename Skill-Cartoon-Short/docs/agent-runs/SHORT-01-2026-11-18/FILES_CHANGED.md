# Files Added & Local-Only Preserved Paths (`SHORT-01-2026-11-18`)

## 1. Committed Publishable Files (`Skill-Cartoon-Short/`)

All committed paths reside strictly inside `Skill-Cartoon-Short/` (sibling of untouched `Skill-B6/`):

- `README.md`
- `package.json`, `package-lock.json`, `.gitignore`, `.env.example`
- `vendor/README.md`, `vendor/source-manifest.json`
- `engine/adapters/renderer-adapter.mjs`
- `engine/patches/modular-world.mjs`
- `tools/setup/hydrate.mjs`, `tools/setup/setup.sh`, `tools/setup/setup.ps1`
- `tools/render/render-cli.mjs`, `tools/render/mux-mp4.mjs`, `tools/render/contact-sheet.py`
- `tools/timing/timing_validator.py`
- `tools/audio/mix.py`, `tools/audio/audio_pipeline.py`
- `tools/qa/image-inspector.mjs`, `tools/qa/verify-gates.mjs`
- `app/shared/contract.mjs`, `app/server/viewer-server.mjs`, `app/frontend/viewer.html`
- `workspace/projects/zombie-supermarket-10s/src/paint-supermarket.js`
- `workspace/projects/zombie-supermarket-10s/src/zombie-cast.js`
- `workspace/projects/zombie-supermarket-10s/src/story.js`
- `workspace/projects/zombie-supermarket-10s/audio_zombie.py`
- `tests/run-dag.mjs`
- `tests/unit/source-and-motion.test.mjs`
- `tests/integration/pipeline.test.mjs`
- `tests/regression/parity-and-negative.test.mjs`
- `tests/e2e/viewer.test.mjs`
- `tests/fixtures/synthetic-soldier-timing.json`
- `out/technical-qa.json`, `out/render-metadata.json`
- `docs/ARCHITECTURE.md`, `docs/DEPENDENCIES.md`, `docs/ENGINE_PARITY.md`, `docs/QA_REPORT.md`, `docs/SOURCE_AUDIT.md`, `docs/SOURCE_FIDELITY_MANIFEST.json`
- `docs/agent-runs/SHORT-01-2026-11-18/*`

## 2. Preserved Local-Only Paths (Excluded from Public Push under `G03: BLOCKED`)

- `vendor/cartoon-short-kit/**` (14 unaltered source files from `cartoon-short-kit.zip`)
- `engine/web/{index.html,main.js,motion.js,paint.js,roman.js,story.js,toonbase.js,toon.js,lib/three.module.js}`
- `workspace/projects/soldier-baseline/**`
- `workspace/projects/zombie-supermarket-10s/{web,work}/**`
- `out/original-reference-contact-sheet.jpg`
- `out/original-example-preview.mp4`
- `out/new-original-10s-preview.mp4`
- `out/new-original-contact-sheet.jpg`

## 3. Protected Paths Verified Unchanged

- `Skill-B6/**`: `0` files staged or modified by this run.
