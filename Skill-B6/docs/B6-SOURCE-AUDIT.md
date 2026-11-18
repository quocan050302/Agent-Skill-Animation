# B6 Source Audit — `kaomei/stickman-video-director`

## 1. Provenance & Checkout Integrity
- **Upstream Repository**: `https://github.com/kaomei/stickman-video-director.git`
- **Local Vendor Path**: `D:\Project_github\Agent-Skill\Skill-B6\vendor\stickman-video-director`
- **Branch**: `main`
- **Verified HEAD Commit SHA**: `833e277cab230f22e6d9c24b31a1baccaae0e22d`
- **Tracked Files Count**: `2,068` files
- **Total Checkout Size (excluding `.git`)**: `798.72 MB`
- **Git LFS Status**: No `.gitattributes` or Git LFS pointer files exist in upstream; all media assets (`.mp4`, `.png`, `.m4a`, `.ttf`) are stored directly in Git objects and verified against upstream SHA-256 manifests.
- **Critical Windows Line-Ending Note (`core.autocrlf`)**:
  Upstream does not include a `.gitattributes` file enforcing `eol=lf`. On Windows, cloning with `core.autocrlf=true` converts `.json`, `.py`, and `.txt` files to CRLF, which alters byte-level SHA-256 digests checked by `b6-dynamic-meme.mjs check-pack` (e.g., `paint/carriage-rig.json`), `b6-fonts.mjs` (`OFL-ArchivoBlack.txt`), and `b6_production.py` (`TRUSTED_*_SHA256`). Setting `git config core.autocrlf false` and `git config core.eol lf` followed by `git reset --hard HEAD` restores 100% exact upstream byte hashes without modifying any upstream file.

## 2. Licensing & Redistribution Boundaries
- **Repository License**: MIT License (`LICENSE`, Copyright (c) 2026 Stickman Video Director contributors).
- **Bundled Fonts**:
  - `ArchivoBlack.ttf` — SIL Open Font License 1.1 (`OFL-ArchivoBlack.txt`), SHA-256: `dd9a89a019b4849f66ab75455fe7bdf931311042cbb0f0f97acc061539703180`. Approved default caption font for new B6 stories.
  - `NotoSans.ttf`, `Nunito.ttf`, `Caveat.ttf` — SIL Open Font License 1.1 (`OFL-NotoSans.txt`, `OFL-Nunito.txt`).
- **Bundled Reference Media**:
  - Primary Standard: `skills/directing-stickman-videos/assets/b6/reference/eiffel-portrait-v44.mp4` (`9:16`, SHA-256: `b0047f5889a7ca1fd47097d8c8b3db054ef412e2f4a7297d3fe04fc1083e5d79`). Strict compare-only reference; `b6_asset_roles.py` blocks opening or reusing reference movies/layers as production story inputs.
  - Secondary Engineering Reference: `skills/directing-stickman-videos/assets/b6/reference/hong-kong-v90-20s.mp4` (`16:9`) and `assets/b6/hong-kong-v90/` (85 files, manifest fingerprint `e0e5f6dc0517f09b19c088383e38a1e8bae7af4c3e9bffd8bf796ab779d5d02d`).

## 3. Verified Toolchain & Dependencies
- **Node.js**: `v26.13.1` (meets `>=20` requirement)
- **npm packages** (`skills/directing-stickman-videos/package-lock.json`):
  - `@napi-rs/canvas@0.1.100`
  - `sharp@0.35.5`
- **Python**: `3.12.10` in project-local `.venv` (`D:\Project_github\Agent-Skill\Skill-B6\.venv\Scripts\python.exe` and `python3.exe`)
  - `numpy` (`2.5.4`), `Pillow` (`13.0.0`), `opencv-python-headless` (`4.13.0.92`)
- **FFmpeg / FFprobe**: `9.0.2-full_build-www.gyan.dev`
- **Doctor Verification (`node scripts/autopilot.mjs doctor --style B6`)**:
  All 10 checks pass (`node`, `ffmpeg`, `ffprobe`, `canvas`, `sharp`, `fonts`, `b4_hook_font`, `b6_python_paint_dependencies`, `b6_public_caption_font`, `b6_complete_pack` = `true`).

## 4. Architecture & Entrypoints of the B6 Code Engine

### 4.1 Node.js CLI Entrypoints (`skills/directing-stickman-videos/scripts/`)
- `autopilot.mjs`:
  - `workflow --style B6 --ratio 9:16|16:9 [--project <ABS_PATH>]` — Read-only workflow and command descriptor.
  - `doctor --style B6 [--python <PYTHON_EXE>]` — Verifies Node, FFmpeg/FFprobe, `@napi-rs/canvas`, `sharp`, fonts, Python imports (`numpy`, `PIL`, `cv2`), public caption font hash, and `checkPack()`.
  - `init <ABS_NEW_PROJECT> --style B6 --ratio 9:16|16:9|both [--example hong-kong-v90|blocking-calibration]` — Delegates to `b6-dynamic-meme.mjs` / `b6-production.mjs`.
  - `preflight`, `validate`, `draft`, `preview`, `plan-iteration`, `review-pack`, `check-review`, `approve`, `render` — Dispatches to `runProduction()` in `b6-production.mjs`, which invokes `<PROJECT>/run.py` using `B6_PYTHON`.

### 4.2 Standalone Project Python Runner (`<PROJECT>/run.py` = `scripts/b6_production.py`)
When `init` creates a new B6 production project (`renderer: "b6-production-v1"`, `version: 2`, `purpose: "production"`, `stage: "needs_authoring"`), it copies pinned helper modules into the project root and verifies their exact SHA-256 digests before importing:
- `b6_puppet.py` (`adc4bd4ddcbe2bb184381d080e99ebe1f4bd1beb3b0b6b1a841930ae15d5bed8`) — Schema `b6-puppet/1` (`binding_version: 2`). Loads per-view character packages (`package.json`), verifies RGBA sprites (`body`, `head`, `heads` expressions), local sleeve `cuff` mattes (must overlap body alpha >=98% and stay within `1.1 * upper_length`), convex `neck_attachment` (`mount_polygon` area >=8, body mount fraction >=0.95, head/body overlap fraction >=0.5 and thickness >=2.0 across expressions and head nods), 5 authored FK poses (`rest`, `reach`, `offer`, `receive`, `retract`), bounded 2-bone planar IK (`planar_ik`), optional continuous brush arm (`ink_path: {"mode": "continuous", "sag": ...}`), planted straight legs with bounded `ankle_targets`, `ContactTimeline` / `PropFrame` prop ownership, and `render_scene` / `validate_render_result`.
- `b6_character_preflight.py` (`561c976f7e8be8ab446e37cbbfcf2fa8d99e9c2d24219291a841930ae15d5bed8` / `561c976f...`) — Runs `preflight_project()`, testing package loading, rest-pose alpha rendering, and 25 pose probes (5 actions x 5 phases) per view before full scene encoding.
- `b6_space.py` — 2.5D `Camera` projection (`project`, `ray_plane`, `wall_ground`, `billboard_matrix`), `camera_move`, `depth_order`, `trace_sample`.
- `b6_actions.py` (`4efcf86cb4f677f1369ca62bb5c87021262c8d92493428f4c91171260db27`) — `ArmSegment`, `ArmTrack`, `offer_track`, `receive_track`, `handoff_timeline`, `reaction_nod`, `camera_landing`, `CameraTravel`.
- `b6_iteration.py` (`37aac116a54c860aaa5dca66ae7dbc0e68ab9bf2d9296e7c1c49c5e11dc8f1b0`) — `RenderViewport` for `--draft-scale 0.5|0.75` via `scene.draft_frame(t, context)` and `iteration_plan` change detection.
- `caption_renderer.py` (`5fc03a3f38dce9f55609f2059077125ecc30b7f5fa1d31580f9e007fcf23200b`) — Renders 3x supersampled Lanczos-downsampled captions using `eiffel-v44-portrait-archivo-black-v1` (at `720x1280`: `ArchivoBlack.ttf` 47px, `#ffffff` fill, 4px `#171319` stroke, `ms` anchor at `baseline: 914`, `band: [864, 951]`, `side: 44`).
- `b6_asset_roles.py` (`ade90e92cad1751bd0b010d508501bba73a41a1ffe6c6018dadd4a368ace9c14`) — Content-hash guard preventing reuse of upstream reference/demo/test art or audio in `purpose: "production"` projects, and blocking external file reads or subprocess spawns inside `scene.py`.
- `motion_review.py` (`b2f813cf6d42f65d73053eb75565e6f7ee3f32af7f58600679aa6bd042d921ed`) — Generates `review-pack` (`motion-review.json` + `index.html` + decoded shot clips/frames + reference excerpts) and validates all 35 subchecks across 8 categories via `check-review`.

## 5. Key Engine Constraints & Honest Capabilities
1. **No One-Click Video Generation**: `init` creates an unauthored project (`stage: "needs_authoring"`). Story, native format shot plans (`formats/portrait.json`), RGBA character packages (`characters/<id>/package.json`), environment layers, `scene.py` (`frame` and `draft_frame`), original-speed narration audio (`voice`), and synchronized single-line `captions.json` must be authored before `validate` / `draft` / `preview`.
2. **Locomotion / Walk & Run Gait Limitation**: `b6_puppet.py` v1 provides static planted straight legs (`legs.left`, `legs.right`) with bounded screen-space `ankle_targets` (±25% of leg length, 92%–108% shaft length envelope) for weight shifts, torso leans, and authored step placements. It does **not** include an automatic walk or run cycle generator. Any stepping/advancing motion in a new story must be explicitly authored via foot-contact targets and multi-view or stance progression without whole-sprite sliding.
3. **Three Separate QA & Approval States**:
   - **Technical Status**: Validated by `preflight`, `validate`, and `preview` (`report.json` -> `technical_status: "pass"`).
   - **Creative / Visual Motion Review**: 35 subchecks in `motion-review.json`, verified structurally by `check-review` (`creative_status`).
   - **User Approval**: Recorded by `approve --report ... --review ... --note "..."` into `approval-9x16.json`, required before `render` (full export). Never auto-approved by the backend or UI.

## 6. Upstream Windows Test Verification Findings (Without Modifying Vendor)
Running upstream B6 test suites directly on Windows (`Node v26.13.1`, `Python 3.12.10`, `FFmpeg 9.0.2`) revealed three host-environment specifics:
1. **NumPy Pin (`numpy==2.0.2`)**: Installing exact upstream pinned dependencies (`numpy==2.0.2`) in `.venv` resolved `ValueError: Both input arrays must be 3-dimensional` in `hk-v90-unified-arms/rig.py:83`, allowing `tests/b6_production_test.py` to pass **34/34**.
2. **Python Bytecode Cache (`__pycache__`)**: Upstream `b6_production.py` audits all file reads under the project directory; setting `PYTHONDONTWRITEBYTECODE=1` and `PYTHONPYCACHEPREFIX=workspace/cache/pycache` prevented `.pyc` files inside project directories from failing `tests/b6_asset_isolation_test.py` (**17/17 PASS**).
3. **FFmpeg 9 `-vsync` Removal & `b6_motion_review.py` CRLF Snapshot Digest**:
   - `b6_motion_review.py` line 381 calls `ffmpeg ... -vsync vfr`, which FFmpeg 9.0.2 removed in favor of `-fps_mode vfr`. Our app-owned `scripts/ffmpeg-compat/ffmpeg.exe` shim translates `-vsync` to `-fps_mode` cleanly without modifying any vendor file.
   - `b6_motion_review.py` line 134 calls `frozen.write_text(payload)` on Windows without `newline='\n'`, converting `\n` to `\r\n` after computing the SHA-256 digest over LF bytes; this causes `active_failure` hash checks inside `.b6-review-history/` to fail on Windows when a frozen failure snapshot is written (`tests/b6_motion_review_test.py`). Also `tests/b6-runtime.test.mjs:58` uses `fs.symlinkSync`, which requires elevated/Developer Mode privileges on Windows (`EPERM`). All other 20/21 Node B6 runtime tests, 2/2 production/HK tests, and Python `puppet` (51/51), `actions` (14/14), `preflight` (10/10), `space` (7/7), `caption` (7/7 + 2 skipped), `helper_trust` (10/10), `asset_isolation` (17/17), `resource_paths` (5/5 + 1 skipped), `iteration` (11/11), and `production` (34/34) tests passed.
