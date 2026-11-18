# Architecture — Dynamic Editorial Director (`b6-studio-editorial/1`)

## 1. Design Goals & Non-Negotiable Constraints

B6-03 established articulated 2-bone IK locomotion, world-locked feet, and deterministic rendering (`f(t)`). However, `samurai-red-leaf-10s` revealed an editorial bottleneck: multiple consecutive shots shared nearly identical wide framing and the late segment (`6.55–10.0s`) stalled visually even though `shot` entries existed in JSON.

B6-04 adds a generalizable, data-driven **Editorial Director** layer (`editorial_v1`) that separates **camera framing intent** from hardcoded per-story camera coordinates while strictly preserving:

1. **Opt-In Backward Compatibility**: Legacy projects (`roman-gladiator-10s`, `cowboy-hat-10s`, `samurai-red-leaf-10s`) omit `editorial_mode` (`"legacy"` default) and never receive modified shot behavior, runtime files, or hash drift.
2. **Read-Only Upstream Pin**: `vendor/stickman-video-director` (`833e277cab230f22e6d9c24b31a1baccaae0e22d`) remains untouched.
3. **Pure Deterministic `f(t)`**: Camera poses and transitions are resolved purely from canonical timestamps and `scene_semantics`, guaranteeing identical outputs across random seeks, `workers=1`, and parallel worker pools.
4. **Telemetry != Creative Sign-Off**: `b6-editorial-qc/1` fails closed on duplicate compositions, extended non-hold static lulls, camera jitter gaming, empty micro-cuts, and out-of-frame focal targets — while explicitly leaving `audience_retention_estimate: "unavailable"`, `human_visual_review: "PENDING"`, and `user_approval: "PENDING"`.

---

## 2. `editorial_runtime/` Python Package (`Skill-B6/editorial_runtime/`)

Pinned by [`editorial_runtime/manifest.json`](../../../editorial_runtime/manifest.json) (`b6-editorial-runtime-manifest/1`, verified during hydration and project checks):

| Module | Responsibilities |
|---|---|
| `b6_editorial_contract.py` | Schema `b6-studio-editorial/1`, enums (`EDITORIAL_ROLES`, `SHOT_SIZES`, `FOCUS_TARGET_KINDS`, `CAMERA_MOVEMENTS`, `TRANSITION_KINDS`, `PACING_ADVICE_VALUES`), shot/timeline compilation (`compile_editorial_timeline`), validation against overlaps/gaps/micro-cuts (`< 0.35s`) and excess consecutive repetition, plus deterministic `auto_propose_editorial_plan(...)` and per-frame `editorial_state_at(timeline, t)`. |
| `b6_editorial_director.py` | Translates `EditorialState` + `scene_semantics` (`actor_z`, `actor_vel_xy`, `targets` world coordinates) into concrete camera framing (`x, y, z, focal`), lead-room anticipation offset from subject velocity, intentional reaction holds (`reaction_hold_s`), whip/match-action push/pull easing, and vertical caption-band clearance (`safe_margin`). Exposes `resolve_editorial_camera(...)`. |
| `b6_editorial_metrics.py` | Decodes MP4 video via FFmpeg (`rawvideo rgb24`) downscaled cleanly (`analysis_size: [360, 640]` on 9:16), optionally excludes the bottom caption band (`[0.675, 0.743]` normalized Y), computes raw & **cut-excluded** per-frame luminance/RGB MAD, percentile motion (`p10/p90/p95`), OpenCV Farneback optical flow magnitude, affine RANSAC global camera motion vs **foreground-relative motion**, flow coherence, SSIM / coarse structural similarity, HSV histogram distance across shot pairs, gaming/strobe/empty-cut detectors, and renders SVG pacing charts + annotated 54-tile contact sheets. |
| `b6_editorial_qc.py` | Evaluates compiled `editorial-report/1` metrics against fail-closed thresholds (`validate_editorial_qc`) emitting `editorial_qc.json` (`b6-editorial-qc/1`), and enforces `audience_retention_estimate: "unavailable"`, `human_visual_review: "PENDING"`, `user_approval: "PENDING"`. |
| `b6_editorial_cli.py` | Neutral CLI runner writing `editorial-report.json`, `editorial_qc.json`, optional `--chart`, and `--contact-sheet`. Invoked both standalone and via the Fastify `analyze-editorial` background job queue. |

---

## 3. Shared Schema, Backend, Hydration & Frontend Data Flow

```mermaid
flowchart LR
  UI["React Studio (Inspector / PlayerStage / JobsQaView)"] -->|PATCH /api/projects/:id| ST["ScriptTimelineService (Atomic Write + Revision Lock)"]
  ST -->|Compile & Bind| SC["scene-control.json + scene_runtime.py + editorial_v1 helpers"]
  ST -->|Regenerate Inputs| PJ["project.json (inputs + editorial_mode: editorial_v1)"]
  UI -->|POST /analyze-editorial| JQ["JobQueue (heavy=false / per-project lock)"]
  JQ -->|Run CLI| ED["b6_editorial_cli.py -> editorial-report.json + editorial_qc.json"]
  ED -->|Verify SHA & FP| QA["QaEvidenceResolver -> GET /api/projects/:id/qa + /editorial-report"]
  SC -->|f(t) Render| PY["scene.py -> run.py preview -> preview.mp4"]
```

### Contract Files Updated

- **Shared (`app/shared/src/schemas.ts`, `index.ts`)**:
  - Added `EditorialRoleSchema`, `ShotSizeSchema`, `FocusTargetKindSchema`, `EditorialFocusSchema`, `CameraMovementSchema`, `EditorialTransitionKindSchema`, `EditorialTransitionSchema`, `PacingAdviceSchema`, `ShotEditorialSchema`, `EditorialGlobalSettingsSchema`, and `migrateShotToEditorial(...)`.
  - Extended `ShotItemSchema`, `PatchProjectInputSchema`, `EditorialQcSummaryDto`, `EditorialReportResponseDto`, and `EditorBindingStatusDto` backward-compatibly.
- **Backend (`app/server/src/`)**:
  - `services/editor-binding-service.ts`: Added canonical `editorial_v1` fields to `FIELD_RUNTIME_MAPPINGS`, updated `SCENE_RUNTIME_PY_SOURCE` (`editorial_state_at`, `camera_editorial_at`, `camera_director_at` delegation when `editorialMode === 'editorial_v1'`, preserving legacy path untouched), and surfaced `editorialMode`, `editorialBound`, and `editorialVarietyWarnings` in `resolveBindingStatus`.
  - `services/script-timeline-service.ts`: Atomic transactional writes sync `editorial` metadata into `project.json` (`editorial_mode: 'editorial_v1'`, registers `b6_editorial_contract.py` and `b6_editorial_director.py` in `projectJson.inputs`), compiles `scene-control.json` and `scene_runtime.py`, and rolls back on fault injection.
  - `services/b6-command-adapter.ts` & `services/job-queue.ts`: Added `buildAnalyzeEditorial` (`outputDir: null` so cancelled analysis jobs never purge rendered preview directories) and strict artifact validation for `analyze-editorial` jobs.
  - `services/qa-evidence-service.ts`: Extended `QaEvidenceResolver` to verify `editorial_qc.json` and `editorial-report.json` (`source_fingerprint`, `video_sha256`, `editorial_report_sha256` integrity, fail-closed on tamper/stale) and block `renderUnlocked` unless technical, motion QC, editorial QC, 35-item review, and actual human user approval all pass.
  - `app.ts`: Added `GET /api/projects/:id/editorial-report` and `POST /api/projects/:id/analyze-editorial` with `assertSafeId` and path-containment guards.
- **Hydration (`scripts/hydrate-project.mjs`)**:
  - Verifies `editorial_runtime/manifest.json` SHA-256 checksums and selectively copies `b6_editorial_contract.py` + `b6_editorial_director.py` only into projects with `editorial_mode === 'editorial_v1'`. Verified zero touches on `roman-gladiator-10s`, `cowboy-hat-10s`, and `samurai-red-leaf-10s`.
- **Frontend (`app/frontend/src/`)**:
  - `App.tsx`: Normalized `shots` with editorial metadata, added `editorialReport` loading/refresh, and fixed a revision-lock race condition discovered during Playwright E2E testing (`expectedRevisionRef.current = detail.meta.revision` now initializes synchronously before `setProject(detail)`, plus pending autosave cancellation on project switch).
  - `components/InspectorPanel.tsx`: Added Editorial Director controls in the `Shot` tab (`Editorial Role`, `Shot Size`, `Focus Target`, `Focus Actor/Prop`, `Camera Movement`, `Transition`, `Intensity`, `Action Onset`, `Reaction Hold`, `Pacing Advice`, `Transition Reason`), inline consecutive-shot repetition warnings (`editorial-variety-warnings`), and `Editorial QC` badge in the `Export` tab.
  - `components/PlayerStage.tsx`: Surfaced `editorial` summary inside `Motion Overlay` and timeline cards (`CU/ECU/INS/WS/MS · role`).
  - `components/JobsQaView.tsx`: Added collapsible `Editorial Diagnostics & Pacing Telemetry` card with **Cut-excluded MAD vs Raw MAD** toggle, foreground motion (`px/f`), unique shots/cuts, near-static/gaming indicator, explicit `"Ước lượng retention: Chưa khả dụng"` badge, per-second telemetry table (`0–10s`), and `Phân tích Editorial` trigger button.
