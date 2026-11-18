# `motion_runtime` (`b6-studio-articulated/1`)

App-owned, reusable 2D articulated locomotion, two-bone knee IK, world-locked foot contact, and motion telemetry runtime for **B6 Local Studio**.

## Modules
- `b6_motion_core.py`: Pure stateless kinematics & analytical step planner (`MotionProfile`, `ShotMotion`, `solve_two_bone_ik`, `resolve_foot_contacts`, `solve_pelvis_root`, `sample_upper_body_motion`, `sample_gait`). Zero frame-order dependence so random seek (`[180, 0, 299]`), `0.5x` draft, and `1x` native playback match deterministically.
- `b6_motion_render.py`: `render_articulated_legs` + `render_articulated_scene` compatible with upstream B6 `run.py` / `b6_puppet.py` `RenderResult` and pixel/SHA/connectivity/neck/cuff/prop-grip/foreground-matte audits. Replaces static straight legs only for projects enabling `b6-studio-articulated/1`, leaving legacy baselines (`roman-gladiator-10s`, `cowboy-hat-10s`) untouched.
- `b6_motion_qc.py`: Frame telemetry (`motion_evidence_at`), strict closed-loop validator (`validate_motion_contract`), and scoped shot draft runner (`generate_motion_preview`).

## Verified Capabilities & Honest Limits
- **Verified**: Analytical 2-bone knee IK with bone-length preservation and forward knee polarity, world-locked stance foot anchors (`drift_world <= 0.75`), alternating left/right support & swing trajectories, pelvis lowering to protect reach, opposing arm counter-swing yielding to `ContactState` prop grips, and tabi/capsule footwear compositing.
- **Explicit Limits**: Stylized 2D animated IK + procedural foot contact schedule — **not** a rigid-body 3D physics simulator; characters opting into articulated legs must author a torso `body.png` without baked straight legs beneath the garment hem to prevent double-leg silhouettes.
