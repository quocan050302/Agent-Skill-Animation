# QA Report — `B6-LOCAL-STUDIO-03` (Motion Engine & Samurai 10s Preview)

Báo cáo kết quả kiểm chứng toàn diện cho bản nâng cấp **B6-03** (`Skill-B6/motion_runtime/`, multi-file atomic rollback, QA gate tích hợp `motion_qc.json`, UI Motion/Camera Director, clean git clone trên Windows, và preview Samurai 10s `samurai-red-leaf-10s`). Mọi trạng thái đều phản ánh kết quả chạy thật sau lần sửa mã cuối cùng.

---

## 1. Upstream Read-Only Verification (`vendor/stickman-video-director`)

- **Pinned Upstream SHA**: `833e277cab230f22e6d9c24b31a1baccaae0e22d` (`upstream-lock.json`).
- **Working Tree Status (`git status --short` trong `vendor/`)**: Sạch 100%, không chỉnh sửa hoặc vá đè upstream.
- **`autopilot.mjs doctor --style B6` & `b6-dynamic-meme.mjs check-pack`**: **PASS** (`b6_complete_pack: true`, `gemini_key_present: false`, `network_checked: false`).
- **Python Read-Only Regression (`tests/b6_puppet_test.py`, `b6_production_test.py`, `b6_actions_test.py`, `b6_character_preflight_test.py`)**:
  - **109/109 tests OK** (`21.848s`, exit `0`) khi PATH chứa `.venv\Scripts` và `scripts\ffmpeg-compat`.
- **Các giới hạn upstream Windows đã biết (giữ nguyên đọc-duy-nhất từ R1/R2)**:
  - `b6-runtime.test.mjs:58` (`symlinkSync` `EPERM` trên Windows không có quyền Admin/Developer Mode).
  - `b6_motion_review_test.py` CRLF snapshot digest trong `.b6-review-history/` do upstream `b6_motion_review.py:134`.

---

## 2. Shared Motion Runtime & Studio Verification (`verify-all.mjs`)

Chạy đầy đủ qua [`scripts/verify-all.mjs`](../../../scripts/verify-all.mjs) (`--benchmark-workers --max-workers 2`):
- **Global Gate**: `ok: true`, **`13/13` tasks succeeded** ở cả **`workers=1` (`112,714 ms`)** lẫn **`workers=2` (`96,101 ms`)** (`speedupRatio: 1.17x`, `parityOk: true`, `parityClassification: exact_decoded_and_container_match`).
- **Workspace Build (`npm run build`)**: **PASS** (`@b6-studio/shared`, `@b6-studio/server`, `@b6-studio/frontend` Vite bundle `340.03 kB` JS / `9.89 kB` CSS).
- **Frontend Typecheck (`tsc -b --noEmit`)**: **PASS** (`0` lỗi).
- **Python Articulated Motion Tests (`python -B -W error::DeprecationWarning -m unittest motion_runtime/tests/test_motion_core.py`)**: **8/8 OK** (`0.792s`, zero `DeprecationWarning`).
- **Server REST & Integration Tests (`@b6-studio/server` `vitest run`)**: **16/16 PASS** (`26,207 ms` ở `w=1` / `24,213 ms` ở `w=2`), bao gồm:
  - Fault-injection multi-file rollback journal hoàn nguyên toàn bộ file về byte SHA-256 ban đầu và giữ nguyên `revision`.
  - Bẫy âm tính `motion_qc.json`: `pending` mặc định -> `fail` (`MOTION_QC_FAILED`) -> `stale` (`MOTION_QC_STALE`) và luôn khóa `renderUnlocked === false`.
  - Live API `PATCH` chỉnh `motion.preset` / `endX` / `cadenceHz` / `footLift` trên bản sao sandbox Samurai tạo thay đổi pixel giải mã FFmpeg `MAD > 2.5`.
- **Clean Git Clone Hydration Test (`clean_clone_hydrate_test`)**: **PASS** (`6,678 ms` ở `w=1` / `6,396 ms` ở `w=2`) — clone thật `git clone --local --no-hardlinks` sang `%TEMP%`, xác nhận `.gitignore` loại `engine/` & `fonts/`, chạy `hydrate-project.mjs --all` + `--verify-only` + `run.py validate` trên `samurai-red-leaf-10s` đạt `valid: true`.
  - Đã thêm [`Skill-B6/.gitattributes`](../../../.gitattributes) (`eol=lf` cho `.py`, `.mjs`, `.ts`, `.tsx`, `.json`, `.sh`) để clone sạch trên Windows không làm biến đổi SHA-256 của `caption_renderer.py`.
- **Playwright Chromium E2E (`app/frontend/e2e/studio.spec.ts`)**: **3/3 PASS** (`29.4s` tổng test), bao phủ responsive 5 màn hình (`320..1440px`), luồng CRUD/Assets/Validate trên Cowboy, và mở Studio Samurai bật `Motion Overlay` (`shot_01_hook · react · cam: reaction_closeup · beat: hook · articulated_verified`), kiểm tra Shot/Camera/Export lock, nhân bản -> sửa `dash` + `3.2` -> lưu `PATCH 200` -> reload -> kiểm tra giữ giá trị -> dọn dẹp sạch.

---

## 3. Baseline Regression Preservation (`roman-gladiator-10s` & `cowboy-hat-10s`)

- `roman-gladiator-10s` & `cowboy-hat-10s`: Không chỉnh sửa mã nguồn gốc; cả hai tiếp tục hoạt động ở chế độ `legacy_stance` qua `hydrate-project.mjs --verify-only` (chỉ copy `b6_motion_*.py` cho project chọn `articulated_v1`) và vượt qua `cowboy_regression_slice` + `roman_baseline_sandbox_replay` trong sandbox `%TEMP%`.

---

## 4. Phim Mới Samurai 10s (`workspace/projects/samurai-red-leaf-10s`)

- **Technical Preflight**: `technical_pass: true` (`25` pose probes, `0` lỗi).
- **Validate (`run.py validate`)**: `valid: true`, `protected_inputs: []`, `external_media_reads: []`, source fingerprint `9a44a85f629c5026d8af68291f678dd512e8ce0ea6e4747aaf45c61705e698d5`.
- **Native Preview 9:16 (`outputs/preview-01/preview.mp4` -> [`samurai-preview-10s.mp4`](samurai-preview-10s.mp4))**:
  - `ffprobe`: `h264` High (`yuv420p`), `720x1280`, `30/1 fps`, `300` frames, `10.000000s`, `3,246,749 bps`; audio `aac` LC `44100 Hz` mono `167,746 bps`; dung lượng `4,280,778` bytes (`4.08 MiB`); SHA-256 `436a13bdaf1b68de381db376a4e6721ebfa5755fc542479dfdb7bfc463687289`.
  - `report.json`: `technical_status: "pass"`, `checked_frames: 300`, `arm_poses_checked: 600`, `straight_legs_checked: 600`, `max_prop_contact_error_px: 1.271e-13`.
- **Articulated Motion QC (`motion_qc.json` -> [`evidence/samurai-motion-qc.json`](evidence/samurai-motion-qc.json))**:
  - `status: "pass"`, `pass: true`, `total_frames: 300`, `locomotion_frames: 59`, `supports_observed: ["left", "right"]`, `max_stance_drift_world: 0.0`, `max_ground_penetration_world: 0.0`, `max_bone_length_rel_err: 0.0`, `max_knee_bend_deg: 131.66`, `max_locomotion_knee_deviation_px: 64.26`, `max_prop_contact_error_px: 0.0`.
- **Trạng thái Gate Thực Tế**:
  - **Technical Check & Motion QC**: **PASS**
  - **Visual Motion Review (35 mục)**: **PENDING (`Pass: 0/35 · Pending: 35`)** (`outputs/review-01/motion-review.json` đã sinh kèm 6 clip shot và caption sidecars)
  - **User Approval & Full Export**: **PENDING (`EXPORT ĐANG KHÓA`)** — Không có `approval-9x16.json`, `renderUnlocked: false`.
