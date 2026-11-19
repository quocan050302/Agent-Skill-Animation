# QA-TTS-01 Files Changed & Scope Guard Verification

## Repository & Scope Guard Proof

- **Canonical Repository**: `https://github.com/quocan050302/Agent-Skill-Animation.git`
- **Target Branch**: `QA` (branched from `origin/feat/short-01-original-engine-fidelity` @ `c67dbd785c08edb4d824f8036588ce2294b627fe`)
- **Paths Outside `Skill-Cartoon-Short/` Modified or Added**: **`0`**
- **`Skill-B6/` Diff Lines**: **`0`**
- **`Skill-B6/` Git Tree SHA-256**: `f27f501f23c8c927a5ccf50f9bd6dcd63d90bc0e9fa01649fc73f7a508eea4ed` (exact match to baseline)
- **Tracked Unlicensed Kit Files (`vendor/cartoon-short-kit/`)**: **`0`**
- **Tracked Secrets / `.env` / `workspace/settings/` / Binary `.mp4` / `.wav` Outputs**: **`0`**

## Modified Files (`15`)

- `Skill-Cartoon-Short/.env.example`
- `Skill-Cartoon-Short/.gitignore`
- `Skill-Cartoon-Short/README.md`
- `Skill-Cartoon-Short/app/server/viewer-server.mjs`
- `Skill-Cartoon-Short/app/shared/contract.mjs`
- `Skill-Cartoon-Short/engine/adapters/renderer-adapter.mjs`
- `Skill-Cartoon-Short/out/render-metadata.json`
- `Skill-Cartoon-Short/out/technical-qa.json`
- `Skill-Cartoon-Short/package-lock.json`
- `Skill-Cartoon-Short/package.json`
- `Skill-Cartoon-Short/tests/e2e/viewer.test.mjs`
- `Skill-Cartoon-Short/tests/regression/parity-and-negative.test.mjs`
- `Skill-Cartoon-Short/tests/run-dag.mjs`
- `Skill-Cartoon-Short/tools/qa/verify-gates.mjs`
- `Skill-Cartoon-Short/tools/render/mux-mp4.mjs`

## Added Files (`51` — Total Staged: `66` files, 100% under `Skill-Cartoon-Short/**`)

### Compact Dark Studio Frontend (`app/frontend/`)
- `Skill-Cartoon-Short/app/frontend/index.html`
- `Skill-Cartoon-Short/app/frontend/tsconfig.json`
- `Skill-Cartoon-Short/app/frontend/vite.config.ts`
- `Skill-Cartoon-Short/app/frontend/src/App.tsx`
- `Skill-Cartoon-Short/app/frontend/src/main.tsx`
- `Skill-Cartoon-Short/app/frontend/src/types.ts`
- `Skill-Cartoon-Short/app/frontend/src/api/client.ts`
- `Skill-Cartoon-Short/app/frontend/src/styles/studio.css`
- `Skill-Cartoon-Short/app/frontend/src/components/ProjectLibrary.tsx`
- `Skill-Cartoon-Short/app/frontend/src/components/SettingsDialog.tsx`
- `Skill-Cartoon-Short/app/frontend/src/components/StagePreview.tsx`

### Loopback Studio API & Async Services (`app/server/`)
- `Skill-Cartoon-Short/app/server/api-router.mjs`
- `Skill-Cartoon-Short/app/server/services/gemini-models.mjs`
- `Skill-Cartoon-Short/app/server/services/gemini-transport.mjs`
- `Skill-Cartoon-Short/app/server/services/job-manager.mjs`
- `Skill-Cartoon-Short/app/server/services/media-store.mjs`
- `Skill-Cartoon-Short/app/server/services/project-store.mjs`
- `Skill-Cartoon-Short/app/server/services/qa-service.mjs`
- `Skill-Cartoon-Short/app/server/services/settings-store.mjs`
- `Skill-Cartoon-Short/app/server/services/subtitle-service.mjs`
- `Skill-Cartoon-Short/app/server/services/timing-service.mjs`
- `Skill-Cartoon-Short/app/server/services/tts-service.mjs`

### New 30-Second Ghost Army Demo Source (`workspace/projects/ghost-army-ww2-30s/src/`)
- `Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/src/audio_stems.py`
- `Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/src/ghost-cast.js`
- `Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/src/paint-ghost.js`
- `Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/src/story.js`
- `Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/src/subtitles.json`

### Automated Unit, Integration & E2E Tests (`tests/`)
- `Skill-Cartoon-Short/tests/unit/tts-and-studio.test.mjs`
- `Skill-Cartoon-Short/tests/integration/studio-api.test.mjs`
- `Skill-Cartoon-Short/tests/e2e/studio-ui.test.mjs`

### Run Reports & UI Screenshots (`docs/agent-runs/QA-TTS-01-20261119T153500Z/`)
- `BASELINE.md`, `BLOCKERS.md`, `FILES_CHANGED.md`, `FINAL_STATUS.md`, `GHOST_ARMY_30S.md`, `IMPLEMENTATION.md`, `PERFORMANCE.md`, `PLAN.md`, `QA_REPORT.json`, `QA_REPORT.md`, `README.md`, `REGRESSION_MATRIX.md`, `SCREENSHOTS.md`, `SOURCE_AUDIT.md`, `TEST_RESULTS.json`
- `screenshots/desktop-1440x900-library.png`, `desktop-1440x900-qa-export.png`, `desktop-1440x900-studio.png`, `mobile-320x720.png`, `mobile-390x844.png`, `tablet-768x1024.png`
