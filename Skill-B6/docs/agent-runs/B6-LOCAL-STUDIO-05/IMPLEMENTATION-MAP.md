# B6-05 Implementation Map

**Run ID**: `B6-LOCAL-STUDIO-05`  
**Starting Baseline SHA**: `6b1c42c6a7eaa482a764c12e6d11cc87f6fd8dd4` (`master`)  
**Scope**: Reusable Semantic Action & Visual Storytelling Validation (`b6-semantic/1`, `semantic_v1`), QA Truth Hardening, Editorial Mask-Motion vs Raw-Residual Separation, Articulated Head Mount Opt-In (`head_mount_state`), Studio UI/API Bindings, and `zombie-runaway-head-10s` Production Preview.

---

## 1. Python Semantic Runtime (`Skill-B6/semantic_runtime/`, schema `b6-semantic/1`)

| Module | Key Exported Symbols | Responsibility |
| --- | --- | --- |
| [`semantic_runtime/manifest.json`](../../../semantic_runtime/manifest.json) | `b6-semantic/1` (`v1.0.0`) | Runtime manifest & SHA-256 checksums synced cleanly by `scripts/hydrate-project.mjs`. |
| [`semantic_runtime/b6_semantic_contract.py`](../../../semantic_runtime/b6_semantic_contract.py) | `canonicalize_action_type`, `normalize_action_evidence_requirements`, `validate_action_causality`, `compile_semantic_action_plan`, `semantic_expected_state_at`, `export_semantic_contract` | Normalizes semantic action types (`sneeze`, `detach`, `drop`, `bounce`, `roll`, `chase`, `avoid_obstacle`, `hide_behind`, `trip`, `reach`, `take`, `reattach`, `walk`, `collide`, `react`, plus custom actions with explicit criteria); enforces causality order, valid actor/prop/occluder references, and no unknown-action silent skips. |
| [`semantic_runtime/b6_semantic_evidence.py`](../../../semantic_runtime/b6_semantic_evidence.py) | `measure_actor_visibility`, `measure_prop_visibility`, `measure_contact`, `measure_occlusion`, `measure_pose_change`, `measure_action_trajectory`, `verify_decoded_frame_binding`, `capture_semantic_frame_evidence`, `write_semantic_evidence_stream`, `load_semantic_evidence_jsonl`, `render_semantic_mask_overlay`, `render_triptych_diagnostic` | Computes pixel-mask geometry, Euclidean `cv2.distanceTransform` contacts (`actor->prop`, `actor@occluder`), foreground-occlusion behind-vs-in-front separation (`occlusion_ratio`, `in_front_leak_ratio`), trajectory kinematics, decoded MP4 binding digests (`beauty_sha256`, `decoded_luma_mean/std`), and debug triptych/mask-overlay visualizations. |
| [`semantic_runtime/b6_semantic_qc.py`](../../../semantic_runtime/b6_semantic_qc.py) | `validate_evidence_coverage`, `classify_semantic_uncertainty`, `detect_semantic_mismatch`, `evaluate_semantic_qc`, `write_semantic_qc_atomic` | Audits monotonic frame coverage, trajectories, vertical bounce reversals, spin angles, pose shifts, contacts, collisions, occlusion thresholds, head detach/reattach state transitions, orientation (`backwards`), causality, decoded binding, and hash parity; outputs machine-readable `REASON_CODES` and keeps `human_visual_review: "PENDING"` / `user_approval: "PENDING"`. |
| [`semantic_runtime/b6_semantic_cli.py`](../../../semantic_runtime/b6_semantic_cli.py) | `_decode_video_frames`, `_cross_verify_decoded_frames`, `main` | Decodes actual H.264 `preview.mp4` frames with OpenCV, cross-verifies against `semantic-evidence.jsonl` and `frame-*.png` keyframes, runs `evaluate_semantic_qc()`, atomically writes `semantic_qc.json` + `semantic-report.json`, and supports `--strict-exit`. |

---

## 2. Additive Motion & Editorial Runtime Extensions (100% Backward Compatible)

| File | Exact Addition | Compatibility |
| --- | --- | --- |
| [`motion_runtime/b6_motion_render.py`](../../../motion_runtime/b6_motion_render.py) | Opt-in per-actor `head_mount_state` (`attached \| detaching \| detached \| reattaching`) & `capture_semantic_masks=False` (`_pre_fg_part_masks`) inside `render_articulated_scene(...)` plus `manifest.json` (`v1.1.0`, preserving `legacy_v1_sha256`). | Existing projects omitting these options behave identically (`head_mount_state="attached"` strict neck check enforced by default). |
| [`editorial_runtime/b6_editorial_metrics.py`](../../../editorial_runtime/b6_editorial_metrics.py) | `per_quarter_second` (0.25s buckets), `_summarize_actor_prop_mask_motion`, `actor_mask_motion_mean`, `prop_mask_motion_mean`, and `meaningful_action_coverage` additive fields in `analyze_video_editorial_metrics(...)` + `b6_editorial_cli.py` JSONL auto-read. | Legacy camera-compensated residual flow metrics stay separate from `actor_mask` / `prop_mask` motion metrics (`b6_editorial_contract.py` & `b6_editorial_director.py` unchanged). |
| [`scripts/hydrate-project.mjs`](../../../scripts/hydrate-project.mjs) | Hydrates `semantic_v1` modules (`b6_semantic_contract.py`, `b6_semantic_evidence.py`, `b6_semantic_qc.py`) when requested and keeps `legacy_v1_sha256` valid for retained projects. | All 4 retained projects remain 100% unmodified (`already_hydrated`). |

---

## 3. Shared Schemas, Fastify Server, QA Truth Hardening & Frontend UI

| Layer / File | Implemented Symbols / Endpoints | Purpose |
| --- | --- | --- |
| [`app/shared/src/schemas.ts`](../../../app/shared/src/schemas.ts) | `SemanticModeSchema`, `SemanticActionTypeSchema`, `SemanticEvidenceRequirementsSchema`, `SemanticActionSpecSchema`, `semanticQcStatus` | Validates semantic actions (`semanticMode: 'semantic_v1'`) in shot/project schemas & API responses cleanly backward-compatible with legacy projects. |
| [`app/server/src/services/qa-evidence-service.ts`](../../../app/server/src/services/qa-evidence-service.ts) | `verifyMotionQcFile`, `verifyEditorialQcFile`, `verifySemanticQcFile`, `semanticQcStatus` gating on `renderUnlocked` | Enforces strict `pass === true && status === 'pass'`, mandatory fingerprint + video SHA-256 bindings, rejects tampered/stale QC files, and surfaces missing/stale/failing semantic/editorial/motion verdicts honestly. |
| [`app/server/src/services/editor-binding-service.ts`](../../../app/server/src/services/editor-binding-service.ts) | `FIELD_RUNTIME_MAPPINGS` entry for `Semantic Action Contract`, `SCENE_RUNTIME_PY_SOURCE` (`semantic_state_at`, `semantic_actions_at`), `buildCanonicalScenePlan`, `validateCanonicalScenePlan`, `resolveBindingStatus` | Compiles `semanticActions` cleanly into canonical `scene-control.json`, validates actor refs & causality before saving, and exposes `semantic_state_at` / `semantic_actions_at` inside generated `scene_runtime.py`. |
| [`app/server/src/services/b6-command-adapter.ts`](../../../app/server/src/services/b6-command-adapter.ts) | `buildAnalyzeSemantic` | Invokes `semantic_runtime/b6_semantic_cli.py --strict-exit` from the server queue/API with `PYTHONDONTWRITEBYTECODE=1` & `PYTHONPYCACHEPREFIX`. |
| [`app/server/src/app.ts`](../../../app/server/src/app.ts), [`job-queue.ts`](../../../app/server/src/services/job-queue.ts), [`review-service.ts`](../../../app/server/src/services/review-service.ts), [`script-timeline-service.ts`](../../../app/server/src/services/script-timeline-service.ts) | `GET /api/projects/:id/semantic-report`, `POST /api/projects/:id/analyze-semantic`, `'semantic'` job type, transactional patch persistence + review-gate parity | Full server persistence, background analysis, and fail-closed Export/Approval gating. |
| [`app/frontend/src/`](../../../app/frontend/src/) (`client.ts`, `App.tsx`, `PlayerStage.tsx`, `InspectorPanel.tsx`, `JobsQaView.tsx`) | `semantic-overlay-actions`, `semantic-action-type-<idx>`, `add-semantic-action-btn`, `semantic-evidence-panel`, `semantic-qc-status-badge`, `analyze-semantic-btn`, `Image Residual Flow` vs `Actor mask` split | Live UI authoring, diagnostic stage overlay, separate optical-flow vs semantic actor-mask readout, and real semantic pass/fail/stale gating in Export & Jobs/QA. |

---

## 4. Verification & Showcase Project

- [`workspace/projects/zombie-runaway-head-10s/`](../../../workspace/projects/zombie-runaway-head-10s/): Brand-new 10.0s `9:16` `720x1280` `30fps` showcase (*"The Zombie Who Lost His Head"*) with original Dawn Transit Plaza illustrations, Pip (zombie) + Maya (commuter) rigs, Foley + `Daniel en_GB` narration WAV, `16` causal semantic actions, `head_mount_state` detach/reattach transitions, and real cantilevered T-pylon occlusion proof.
- [`scripts/verify-all.mjs`](../../../scripts/verify-all.mjs) & [`app/frontend/e2e/studio.spec.ts`](../../../app/frontend/e2e/studio.spec.ts): Async bounded-parallel DAG (`workers=1` vs `workers=2`), `semantic_unit` + `semantic_determinism_replay` + `zombie_runaway_native_qc`, strict `--pure-clone` hydration verification, 4-project `BASELINE.json` hash lock, and full Playwright E2E coverage on both B6-04 and B6-05 projects.
