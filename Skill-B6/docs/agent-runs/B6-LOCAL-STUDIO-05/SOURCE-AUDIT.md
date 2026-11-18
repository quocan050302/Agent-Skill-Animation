# B6-05 Source Audit — B6-LOCAL-STUDIO-05

- **Run ID**: `B6-LOCAL-STUDIO-05`
- **Branch**: `master`
- **Start Commit SHA**: `6b1c42c6a7eaa482a764c12e6d11cc87f6fd8dd4` (`B6-04: add Dynamic Editorial Director runtime, UI/QA wiring, and zombie-mirror-10s preview`)
- **Upstream Pin**: `vendor/stickman-video-director/` at `833e277cab230f22e6d9c24b31a1baccaae0e22d` (READ ONLY)
- **Date**: 2026-11-18

---

## 1. Existing Architecture & Reusable Assets

| Module | Key Functions / Symbols Inspected | Role & Reuse Plan |
|---|---|---|
| [`app/shared/src/schemas.ts`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/app/shared/src/schemas.ts) | `ShotItemSchema`, `EditorialShotConfigSchema`, `PatchProjectInputSchema`, `CanonicalScenePlanSchema`, `QaEvidenceSummarySchema`, `JobKindSchema`, `migrateShotToEditorial` | Extend backward-compatibly with optional `semanticMode`, `semanticActions`, `semanticQcStatus`, `semanticQcSummary`, `analyze-semantic` job kind. Keep all existing fields/defaults intact so historic projects parse cleanly. |
| [`app/server/src/services/editor-binding-service.ts`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/app/server/src/services/editor-binding-service.ts) | `FIELD_RUNTIME_MAPPINGS` (L45–109), `SCENE_RUNTIME_PY_SOURCE` (L111–619: `load_scene_plan`, `shot_at`, `camera_at`, `actor_state_at`, `prop_state_at`, `motion_state_at`, `director_beat_at`, `camera_director_at`, `_get_compiled_editorial`, `editorial_state_at`, `camera_editorial_at`, `qa_trace_at`), `EditorBindingService.{buildCanonicalScenePlan, validateCanonicalScenePlan, resolveBindingStatus}` (L621–937) | Add `semantic_actions_at` and `semantic_state_at` in `SCENE_RUNTIME_PY_SOURCE` (only updated when missing or `semantic_v1` enabled), extend `CanonicalScenePlan` & causality validation, and expose `semanticMode` / `semanticQcVerified` in `resolveBindingStatus`. |
| [`app/server/src/services/script-timeline-service.ts`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/app/server/src/services/script-timeline-service.ts) | `validateTimelineData` (L18–129), `normalizeShotsFromPlan` (L131–164), `ScriptTimelineService.{patchProject, saveScenePy, synthesizeLocalVoiceWav}` (L166–676) | Preserve transactional multi-file rollback & 409 `expectedRevision` lock; forward `semanticMode`, `semanticActions`, and stage `semantic_runtime/` helpers only for `semantic_v1` opt-in projects. |
| [`app/server/src/services/qa-evidence-service.ts`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/app/server/src/services/qa-evidence-service.ts) | `computeFastStateKey` (L105–134), `resolveCurrentProjectFingerprint` (L136–260), `probeVideoStrict`, `loadAndVerifyPreviewReport`, `loadAndVerifyVisualReview` (35 checks), `loadAndVerifyApproval`, `resolveQaState` (L785–1161) | Replace permissive checks on `motion_qc.json` and `editorial_qc.json`, add `loadAndVerifySemanticQc`, tighten `fpCache` key dependencies, and gate `renderUnlocked` strictly on `semanticQcStatus === 'pass'` when `semantic_v1` is active. |
| [`app/server/src/services/b6-command-adapter.ts`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/app/server/src/services/b6-command-adapter.ts) | `buildPreflight`, `buildValidate`, `buildDraft`, `buildPreview`, `buildAnalyzeEditorial` (L318–396) | Add `buildAnalyzeSemantic` targeting `semantic_runtime/b6_semantic_cli.py`, keeping `outputDir: null` so cancel cannot delete rendered preview folders. |
| [`app/server/src/services/job-queue.ts`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/app/server/src/services/job-queue.ts) | `JobQueue` (`maxHeavyConcurrency=1`, `maxLightConcurrency=2`, `activeProjectLocks`, process-tree kill, cancel cleanup, L20–530) | Require artifact verification for `analyze-semantic` (`semantic_qc.json` + `semantic-report.json`) alongside `analyze-editorial`. |
| [`app/server/src/app.ts`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/app/server/src/app.ts) & [`review-service.ts`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/app/server/src/services/review-service.ts) | `/api/projects/:id/{editor-binding, qa, editorial-report, analyze-editorial, render}` | Add `GET /api/projects/:id/semantic-report` and `POST /api/projects/:id/analyze-semantic`, and surface `semanticQcStatus` + `semanticQcSummary` in `/qa` and `ReviewService`. |
| [`motion_runtime/b6_motion_core.py`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/motion_runtime/b6_motion_core.py) & [`b6_motion_qc.py`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/motion_runtime/b6_motion_qc.py) | 2-bone leg IK, world foot-lock, `motion_evidence_at`, `validate_motion_contract` | Preserve 100% semantics and unit test coverage (`motion_runtime/tests/test_motion_core.py`). |
| [`motion_runtime/b6_motion_render.py`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/motion_runtime/b6_motion_render.py) | `render_articulated_scene` (L337–833), `_stroke_articulated_leg_mask`, neck attachment check (L603–608, L686–688) | Add opt-in per-actor/frame `head_mount_state` (`attached | detaching | detached | reattaching`) without globally weakening neck checks for attached states or legacy projects. |
| [`editorial_runtime/b6_editorial_metrics.py`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/editorial_runtime/b6_editorial_metrics.py) & [`b6_editorial_qc.py`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/editorial_runtime/b6_editorial_qc.py) | `compute_frame_activity` (L279–500), `analyze_video_editorial_metrics`, `evaluate_editorial_qc` | Add separate `actor_mask_motion`, `prop_mask_motion`, `0.25s` pacing buckets, and `meaningful_action_coverage` while preserving all existing keys and schema compatibility. Keep `b6_editorial_contract.py` & `b6_editorial_director.py` unchanged for retained projects. |
| [`scripts/hydrate-project.mjs`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/scripts/hydrate-project.mjs) | Project hydration of `engine/`, `fonts/`, `reference/`, `motion_runtime`, `editorial_runtime` (L281–327) | Add opt-in `semantic_v1` hydration (`semantic_runtime` helpers) plus `legacy_v1_sha256` backwards-compatible acceptance ONLY for legacy non-`semantic_v1` `b6_motion_render.py` so retained `samurai-red-leaf-10s` and `zombie-mirror-10s` hashes stay byte-identical. |
| [`scripts/verify-all.mjs`](file:///Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-B6/scripts/verify-all.mjs) | Bounded-parallel DAG runner (`--max-workers`, `--benchmark-workers`, `clean_clone_hydrate_test` L418–523) | Update log dir & E2E screenshot targets cleanly, add strict pure-committed git clone mode, disk/timeout/process-tree guards, semantic runtime & `zombie-mirror-10s` negative backtest, `zombie-runaway-head-10s` deterministic & native QC checks, and hash preservation verification against `B6-LOCAL-STUDIO-05/BASELINE.json`. |
| Frontend (`PlayerStage.tsx`, `InspectorPanel.tsx`, `JobsQaView.tsx`, `App.tsx`, `api/client.ts`, `e2e/studio.spec.ts`) | Overlay toggle (L52, L196–233), Shot/Editorial Inspector (L829–1030), Editorial Diagnostics card (L131–329) | Add Semantic Actions editor & badges, Semantic Overlay toggle (plus mask/evidence links in Jobs & QA), `Semantic Evidence` card + `Analyze Semantic` button, and distinct UI labels separating `Actor-only Motion` from `Image Residual Flow`. |

---

## 2. Specific Weaknesses & Defect Locations Found Before B6-05

### 2.1 QA Truth Weaknesses (`qa-evidence-service.ts`)
1. **OR-logic verdict acceptance (`L933`, `L1011`)**:
   - `qcPassed = qcDoc.pass === true || qcDoc.status === 'pass'` (`L933`) and `edPassed = edDoc.pass === true || edDoc.status === 'pass'` (`L1011`).
   - A tampered file containing `{ "status": "fail", "pass": true, "errors": ["CRITICAL"] }` or `{ "status": "pass", "pass": false }` currently evaluates to `pass`.
2. **Permissive short-circuiting on missing fingerprints & hashes (`L930-932`, `L997-1010`)**:
   - In `motion_qc.json`: `Boolean(qcDoc.source_fingerprint && fpInfo.fingerprint && ...)` evaluates to `false` (not stale!) if `source_fingerprint` is empty string or omitted. Also skips checking `errors.length === 0` or `summary.total_frames > 0`.
   - In `editorial_qc.json`: `!edDoc.editorial_report_sha256 || ...` (`L999`) short-circuits to valid whenever `editorial_report_sha256` is omitted; `edDoc.video_sha256 && ...` and `edDoc.source_fingerprint && ...` skip validation when omitted; `editorial-report.json` internals (`video_sha256`, `summary.frame_count`) and `edDoc.errors` / `edDoc.frames_checked` are never checked.
   - Note for backward compatibility: retained B6-03/04 `b6-motion-qc/1` JSONs (e.g. `samurai-red-leaf-10s` and `zombie-mirror-10s`) emit `{ schema: "b6-motion-qc/1", status: "pass", errors: [], source_fingerprint: "<hex>", summary: { total_frames: 300 } }` without top-level `pass` boolean; therefore the strict validator must enforce non-empty matching `source_fingerprint`, `errors.length === 0`, non-zero frames, `status === 'pass'`, AND reject `pass === false`, while requiring full `pass === true && status === 'pass'` plus SHA bindings for `editorial_qc.json` and `semantic_qc.json`.
3. **Cache key omissions (`computeFastStateKey`, `L105-117`)**:
   - Currently stats only project files (`project.json`, `studio.meta.json`, `story.json`, `captions.json`, `scene.py`, `scene-control.json`, `scene_runtime.py`, `characters.json`, `engine/manifest.json`, portrait/landscape JSON). Does not invalidate cache if `b6_semantic_contract.py` or `semantic_qc.json` / `motion_qc.json` / `editorial_qc.json` change independently.
4. **Missing Semantic Gate (`L1142-1147`)**:
   - `renderUnlocked` checks `technicalStatus`, `visualReviewStatus`, `userApprovalStatus`, `motionQcStatus`, and `editorialQcStatus`, with no `semanticQcStatus` verification.

### 2.2 Editorial Activity Attribution Limitation (`editorial_runtime/b6_editorial_metrics.py`)
- In `compute_frame_activity` (`L279-500`), `_estimate_flow_and_camera_compensation` (`L166-277`) fits a 4-DOF global similarity model between decoded MP4 frames and treats all non-caption residual motion (`foreground_relative_motion`) as foreground activity.
- Rain particles, moving highlights, camera edges, and multi-layered parallax contribute directly to `foreground_relative_motion`, so metrics cannot distinguish environmental motion from real actor or prop displacement.
- Adding optional `actor_mask_motion`, `prop_mask_motion`, `0.25s` buckets, and `meaningful_action_coverage` (computed strictly from per-actor/prop masks when supplied and cleanly labeled `"mask_evidence_unavailable"` otherwise) eliminates false equivalence without altering legacy B6-04 metric keys.

### 2.3 Rigid Neck-Attachment Assumption (`motion_runtime/b6_motion_render.py`)
- Lines `603–608` and `686–688` always composite `head_warped` attached at `runtime._head_placement(a)` and fail frame QA if `v.neck_attachment` alpha does not connect head & body.
- This blocks authentic storytelling actions like `head_detach` -> `roll` -> `reattach` unless solved cleanly with explicit per-actor, per-frame `head_mount_state` (`attached | detaching | detached | reattaching`). Leaving `head_mount_state = "attached"` as default guarantees zero regression on all existing character rigs, and enabling `detached` only inside explicitly declared intervals preserves neck integrity checks everywhere else (including immediate re-validation upon `reattached` / `attached`).

### 2.4 Semantic Story-to-Render Gap (`B6-04` Root Cause) & `clean_clone_hydrate_test`
- Storyboard labels (`shot.action`, `editorial.role`, `directorBeats`) exist solely as narrative text/metadata; nothing measures from composited masks + decoded MP4 frames whether an action such as `trip`, `fall`, `hide_behind`, `detach`, `take`, `reattach`, or `collide` visually occurs within its declared window with sufficient visibility, occlusion, contact, trajectory, and pose delta.
- `scripts/verify-all.mjs` (`L455-469`) currently copies modified local files into the clean git clone when the workspace is dirty, rather than verifying a pure committed `git clone` against `HEAD`. Adding pure committed clone validation plus post-commit verification guarantees zero hidden uncommitted dependency drift.

---

## 3. Preservation Contract (Locked Hashes)
- Retained projects **never to be modified**:
  - `workspace/projects/roman-gladiator-10s` (`30` files hashed in `BASELINE.json`)
  - `workspace/projects/cowboy-hat-10s` (`32` files hashed in `BASELINE.json`)
  - `workspace/projects/samurai-red-leaf-10s` (`37` files hashed in `BASELINE.json`)
  - `workspace/projects/zombie-mirror-10s` (`45` files hashed in `BASELINE.json`)
- Retained logs/runs **never to be modified**: `docs/agent-runs/B6-LOCAL-STUDIO-01` .. `B6-LOCAL-STUDIO-04`.
- Read-only upstream directory: `vendor/stickman-video-director/` (`833e277cab230f22e6d9c24b31a1baccaae0e22d`).
