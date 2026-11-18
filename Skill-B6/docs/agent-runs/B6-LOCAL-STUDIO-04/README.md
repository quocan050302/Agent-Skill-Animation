# Agent Run Report — `B6-LOCAL-STUDIO-04`

**Run ID**: `B6-LOCAL-STUDIO-04` (Prompt: `B6-04 — DYNAMIC EDITORIAL DIRECTOR & RETENTION PACING`)
**Branch**: `master`
**Starting Baseline HEAD**: `8433384f10632b1bc0896992d03d2e17980fe9fd`
**Read-Only Upstream Lock**: [`upstream-lock.json`](../../../upstream-lock.json) (`kaomei/stickman-video-director` @ `833e277cab230f22e6d9c24b31a1baccaae0e22d`, untouched)
**App Root**: [`Skill-B6/`](../../../)

---

## Executive Summary

B6-04 investigated slow/static late-reel pacing and consecutive wide-shot repetition observed in `samurai-red-leaf-10s` (`B6-LOCAL-STUDIO-03`), implemented a reusable data-driven **`editorial_runtime/`** engine (`b6-studio-editorial/1`) integrated across shared TypeScript/Zod schemas, Fastify backend API/QA/job orchestration, project hydration, and React Studio UI, and produced a brand-new 10.0s `9:16` native (`720x1280`, `30fps`, AAC `44.1kHz`) comedy preview **`zombie-mirror-10s`** (*"The Zombie Who Was Afraid of a Human"*).

### Key Technical Results (All Observed After Final Code Edits)

- **Samurai `B6-03` Baseline Audited First** ([`baselines/samurai-editorial-metrics.json`](./baselines/samurai-editorial-metrics.json), [`baselines/samurai-editorial-qc.json`](./baselines/samurai-editorial-qc.json)):
  - `editorial_qc.status`: **`fail`** (`EDITORIAL_EXCESSIVE_DUPLICATE_SHOTS`, `EDITORIAL_EXTENDED_STATIC_LULL: SUSTAINED_LOW_ACTIVITY_INTERVAL (6-10s: fg_rel<0.28, y_mad<1.40)`).
  - `unique_compositions`: `3 / 6` shots (`too_similar_pairs: 3`, `duplicate_ratio: 0.6`).
  - Late-reel `6–10s` seconds dropped to `foreground_relative_motion_mean = 0.0958–0.2343 px/frame`.
- **Zombie `B6-04` Native Preview (`zombie-preview-10s.mp4`)**:
  - Original hand-cleaned RGBA art via Antigravity `image-generator` (background convenience store street, foreground `24H` A-frame sidewalk sign, vanity mirror prop, traffic cone prop, `zombie` character with 4 head expressions + `human` character with 3 head expressions), zero reuse of Eiffel/Hong Kong/Roman/Cowboy/Samurai media.
  - `8` distinct semantic shots with non-repeating framing (`close -> wide -> insert -> extreme_close -> wide -> insert -> close -> medium`), **8/8 unique compositions** (`too_similar_pairs: 0`), `cuts_detected: 7`, `foreground_relative_motion_mean: 0.8994 px/frame` (+83.3% vs Samurai `0.4907`), `camera_global_motion_mean: 0.4343 px/frame` (more stable camera than Samurai `0.5097`), `gaming_detected: false`, `high_pixel_low_semantics: false`.
  - **`motion_qc.json`**: **`pass`** (`300/300` frames, `121` locomotion frames, `max_stance_drift_world: 0.0`, `max_ground_penetration_world: 0.0`, `max_bone_length_rel_err: 0.0`, `max_prop_contact_error_px: 0.0`).
  - **`editorial_qc.json`**: **`pass`** (`300` frames, `0` errors, `0` warnings).
- **Automated Verification (`verify-all.mjs --tier release --benchmark-workers --max-workers 2`)**:
  - `ok: true`, `parityOk: true`, `decodedPixelsParity: true`, `containerByteParity: true`, `parityClassification: "exact_decoded_and_container_match"`, `21/21` release tasks succeeded in both `workers=1` (`137.7s`) and `workers=2` (`123.4s`).
  - Legacy baseline hashes across `roman-gladiator-10s`, `cowboy-hat-10s`, and `samurai-red-leaf-10s` matched [`baselines/legacy-project-hashes.json`](./baselines/legacy-project-hashes.json) byte-for-byte (`legacy_hashes=exact_match`).

### Honest Factual Boundaries (Pending Human Sign-Off)

- `audience_retention_estimate`: **`"unavailable"`** — Pixel MAD, optical flow, and SSIM measure frame variation telemetry only, never human watch-time or CTR.
- `human_visual_review`: **`"PENDING"`** — 35-item `motion-review.json` generated in `motion-review-pack/` and left unapproved.
- `user_approval`: **`"PENDING"`** — Full production render button remains strictly locked (`renderUnlocked: false`).

---

## Navigation Index

| Report | Contents |
|---|---|
| [`ARCHITECTURE-EDITORIAL.md`](./ARCHITECTURE-EDITORIAL.md) | `b6-studio-editorial/1` engine design, schema/backend/hydration/UI wiring, opt-in compatibility & fail-closed checks |
| [`EDITORIAL-METRICS.md`](./EDITORIAL-METRICS.md) | Methodology, cut-excluded vs raw MAD, Samurai B6-03 baseline vs Zombie B6-04 per-second/per-shot breakdown, anti-gaming proof |
| [`TEST-MATRIX.md`](./TEST-MATRIX.md) | Python unit/negative/fault tests, Server Vitest (`19/19`), Playwright E2E (`4/4` desktop + mobile `375px`), Clean-Clone & Legacy Regression |
| [`BENCHMARK.md`](./BENCHMARK.md) | Bounded-parallel DAG timings (`workers=1` vs `workers=2`), exact decoded-pixel & container SHA parity, render timings |
| [`QA-REPORT.md`](./QA-REPORT.md) | `ffprobe`, `motion_qc`, `editorial_qc`, `/qa` endpoint state, `35`-subcheck `PENDING` boundary, and live UI screenshots |
| [`ZOMBIE-STORYBOARD.md`](./ZOMBIE-STORYBOARD.md) | Scene premise, original assets & voice/SFX mix, 8-shot editorial/motion choreography, contact sheets & sample frames |
| [`OUTPUT-MANIFEST.json`](./OUTPUT-MANIFEST.json) | Machine-readable artifact inventory with sizes and SHA-256 digests |
