# `editorial_runtime` (`b6-studio-editorial/1`)

Shared deterministic editorial director, decoded-frame pacing telemetry, and editorial QA runtime for B6 Local Studio.

- `b6_editorial_contract.py`: Immutable data model (`EditorialProfile`, `ShotIntent`, `SubjectFocus`, `CameraTransition`, `EditorialBeat`, `EditorialTimeline`), strict validation, `compile_editorial_timeline()`, and heuristic `auto_propose_editorial_plan()`.
- `b6_editorial_director.py`: O(log N) deterministic `editorial_state_at(compiled, t, scene_semantics)` and `resolve_editorial_camera()`. Pure `f(t)` random-seek invariant.
- `b6_editorial_metrics.py`: Decodes actual MP4 frames via FFmpeg, computes RGB/Y MAD, p95 motion, histogram distance, SSIM, 4-DOF global camera compensation vs foreground optical flow, spatial flow coherence, gaming/flicker/noise/jitter detectors, shot-variety/scale checks, and audio RMS/peak/clipping/SFX sync.
- `b6_editorial_qc.py`: Produces separate `editorial_qc.json` (`b6-editorial-qc/1`) with honest `audience_retention_estimate: "unavailable"` and `human_visual_review: "PENDING"`.
