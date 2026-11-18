# Agent Run Log — `B6-LOCAL-STUDIO-02`

Nhật ký thực thi thực tế cho **B6-LOCAL-STUDIO-02 — Real Editor Binding, QA Truth, Reproducible Production & Cowboy Retention Demo**.

## 1. Phase 0 — Pre-Flight & Baseline State (2026-11-18 12:06 GMT+7)

- **Repository**: `https://github.com/quocan050302/Agent-Skill-Animation.git`
- **Branch**: `master`
- **Initial Local HEAD**: `4ec3b727ba3ebff6bfd1efe715803525bf792d92` (khớp `origin/master`; bao gồm `5d4f7ad` + commit dọn `npm run dev` `4ec3b72`)
- **Working Tree Status**: Clean trước khi bắt đầu (`git status --short` trống).
- **Upstream Vendor Checkout (`Skill-B6/vendor/stickman-video-director`)**:
  - Branch: `main`, `HEAD`: `833e277cab230f22e6d9c24b31a1baccaae0e22d`
  - Status: Clean (Read-only).
- **Host & Toolchain**:
  - OS: Windows
  - Node.js: `v26.13.1`
  - Python (`.venv`): `Python 3.12.10` (`numpy==2.0.2`, `Pillow==11.3.0`, `opencv-python-headless==4.13.0.92`)
  - FFmpeg / FFprobe: `9.0.2-full_build-www.gyan.dev` (+ shim `scripts/ffmpeg-compat/ffmpeg.exe`)
  - Local Windows SAPI Voices: `Microsoft David Desktop` (en-US Male), `Microsoft Zira Desktop` (en-US Female) — `neural_voice_available: false`.
  - Hardware: 12th Gen Intel Core i5-12400 (12 logical cores), RAM `6.91 GiB` free / `31.75 GiB` total, Disk D: `48.77 GiB` free / `144.02 GiB` total.

### Baseline Audit & Known Issues (Trước khi vá)
1. **`review-service.ts`**:
   - Hiện trả `technicalStatus = latestReport ? 'pass' : 'pending'` và `userApprovalStatus = approvalRecord ? 'approved' : 'pending'` bất kể `report.json` bị `fail`, `video` bị thiếu/hỏng SHA, `fingerprint` đã cũ (sau khi user sửa kịch bản/camera/rig/asset), hoặc `motion-review.json` chưa đủ 35 subchecks.
   - Đang cần nâng cấp thành `QaEvidenceResolver` verify chứng cứ thật theo fingerprint hiện hành của B6 (`run.py validate` + file hash + `ffprobe` + strict stale detection).
2. **`script-timeline-service.ts` & Editor Binding**:
   - `patchProject()` ghi file trước khi kiểm tra `validation.valid` và chưa chặn rollback hay concurrency `revision`.
   - `roman-gladiator-10s/scene.py` và các scene mới chưa đọc canonical plan từ UI (`scene-control.json` -> `scene_runtime.py`).
3. **Clean-Clone Reproducibility**:
   - `.gitignore` loại `vendor/`, `workspace/projects/*/engine/`, `reference/`, `fonts/`, `outputs/`. Hiện chưa có `upstream-lock.json` và lệnh `hydrate-project` tự động dựng lại một repo clone sạch trên máy khác để chạy validate/render độc lập.
4. **Gate Status Ban Đầu**: `PENDING` (chưa chỉnh sửa code/test cho vòng R2).

---

*(Sẽ cập nhật liên tục kết quả từng Phase: P0-A QA Truth, P0-B Editor Binding, P0-C Clean Clone Hydration, Cowboy 10s Preview & Review, Async Test Orchestrator + Backtests, Final Git Push).*

---

## 2. Kết quả thực thi các Phase (`B6-LOCAL-STUDIO-02`)

### Phase 1 — P0-A: QA Truth & Gate Safety
- Thay thế logic kiểm tra tồn tại file ở backend bằng `QaEvidenceResolver` (`app/server/src/services/qa-evidence-service.ts`), đối chiếu trực tiếp `run.py validate` fingerprint hiện hành, `report.json`, SHA-256 video, `ffprobe`, kiểm tra đủ **35 subchecks / 8 nhóm thực của `motion_review.py`** (`space_depth`, `camera_purpose`, `body_action`, `expression_gaze`, `rhythm_continuity`, `drawing_anatomy`, `limb_line_weight`, `native_audio_captions`), phát hiện `voiceStale`, khóa `POST /api/projects/:id/render` khi `!qa.summary.renderUnlocked`, gắn `verificationStatus` (`current | historical | stale | corrupt`) cho từng output, và bắt `JobQueue` fail-closed nếu lệnh render thoát `0` mà thiếu report/video hợp lệ.
- Trong quá trình inspect screenshot thật (`desktop-1440-qa-cowboy.png`), đã phát hiện và vá 2 lỗi thật: (1) `EXPECTED_SUBCHECK_GROUPS` lệch tên nhóm với `motion_review.py` khiến report hiện `8_OF_35` — đã đồng bộ chuẩn 35/35; (2) `App.tsx` từng gán nhầm `bindRes.qa` (`QaEvidenceSummary` không có `latestReport`) làm UI hiện `"Chưa có report.json"` và chớp state cũ khi đổi dự án — đã sửa sang `api.getReviewState` và xóa state ngay khi chuyển dự án.

### Phase 2 — P0-B: Real Editor Binding & Transaction Safety
- Chuẩn hóa `scene-control.json` (`b6-studio-scene-control/1`) + khóa lạc quan `expectedRevision` (`409 Conflict`), mutex theo `projectId`, `validate-before-write` rollback nguyên vẹn file cũ nếu dữ liệu sai, kiểm cú pháp Python `ast.parse` khi lưu `scene.py`, `scene_runtime.py` đọc trực tiếp từ `scene-control.json`, và API `POST /api/projects/:id/voice/synthesize-local` (Windows SAPI).
- Tab `Camera`, `Shot`, `Character`, `Export` trên frontend hiển thị badge `Live Runtime Bound` / `Applied to renderer`, nút `Verify changes`, cảnh báo `VOICE_NEEDS_REGENERATION` và khóa nút `7. Xuất Video Full MP4` khi `!reviewState.renderUnlocked`.

### Phase 3 — P0-C: Reproducible Clean Clone Hydration
- Tạo `upstream-lock.json` (ghim `833e277cab230f22e6d9c24b31a1baccaae0e22d`), `scripts/hydrate-project.{mjs,ps1,sh}`, tích hợp vào `scripts/setup.{ps1,sh}` và `DiskGuard` (`>= max(1 GiB, 2 * estimatedTempBytes)`).
- Kiểm chứng qua `clean_clone_hydrate_test`: copy bản sạch không có `vendor/`, `engine/`, `fonts/`, `reference/`, `outputs/` vào `%TEMP%`, hydrate lại tự động rồi chạy `run.py validate` đạt `valid: true`.

### Phase 4 — P0-D: Phim Mới Cao Bồi 10 Giây (`workspace/projects/cowboy-hat-10s`)
- **"The Cowboy Who Couldn't Catch His Hat"** (`9:16`, `720x1280`, `30fps`, `10.0s`, `5` shots, `7` phụ đề 1 dòng `Archivo Black` chuẩn Eiffel V44).
- Tranh gốc mới (`western_wide_bg.png`, `western_fg_frame.png`, `cowboy_hat.png`, bộ `characters/jesse/three_quarter/*` kèm 4 biểu cảm đầu), mix audio local Windows SAPI (`Microsoft David Desktop`, `voice_speed: 1`, SHA `8d8769396aa7084dd96146bdad2ae520b905de9323dd525b6f8ea650620af203`).
- Tự phát hiện & vá lỗi `Local limb teleport` trong quá trình chạy (`shot-3` giảm `strideCycles` `5.0 -> 3.0`, biên độ tay chạy `0.14/0.16`, `shot-4` tách mốc nhả mũ `t=1.08` tại `y=-123` trước khi bay vút), tối ưu `crop + bilinear` 1 pass trên `bg_raw` & `fg_raw`, và dùng `PYTHONPYCACHEPREFIX` để tránh Python 3.12 import hook quét nhầm `__pycache__`.
- **Native Preview Metrics**:
  - `outputs/preview-01/preview.mp4` (`3,505,764 bytes` = `3.343 MiB`, SHA-256 `cf41b7aed3852ba9aeb8af1f283afca890e03eeaa00c97d4d264c430bc6a9c15`), sao lưu tự chứa tại `docs/agent-runs/B6-LOCAL-STUDIO-02/cowboy-preview-10s.mp4` & `cowboy-contact-sheet.jpg`.
  - `checked_frames: 300`, `arm_poses_checked: 600`, `straight_legs_checked: 600`, `max_prop_contact_error_px: 1.271e-13`, `protected_inputs: []`, `external_media_reads: []`.
  - Đã inspect 6 decoded frames (`0.40s, 1.50s, 3.80s, 5.60s, 6.60s, 8.80s`), `cowboy-contact-sheet.jpg`, và `outputs/review-01/caption-0010.png`.

### Phase 5 — P0-E: Bounded-Parallel Orchestrator & Regression Benchmark
- `node scripts/verify-all.mjs --benchmark-workers --max-workers 2` (log chi tiết tại [verify-all-summary.json](verify-all-summary.json) và [verify-all.jsonl](verify-all.jsonl)):
  - **Pass 1 (`workers=1`)**: **PASS** trong **`86,992 ms`** (`86.99 s`).
  - **Pass 2 (`workers=2`, `heavyRenderSemaphore=1`)**: **PASS** trong **`75,233 ms`** (`75.23 s`).
  - **Parity & Speedup**: `parityOk: true`, **`speedupRatio: 1.16`**.
- **Chi tiết test**:
  - `@b6-studio/server` (`vitest run`): **13/13 PASS** (bao gồm pixel diff MAD > 2.5 khi chỉnh camera/prop qua API thật).
  - `@b6-studio/frontend` (`playwright test` tại `B6_STUDIO_PORT=4399`): **2/2 PASS**, ảnh mới trong `screenshots/`.
  - Upstream Python (`b6_production_test.py` **34/34 OK**, `b6_puppet + actions + space + iteration + character_preflight` **93/93 OK**, `b6_caption_test.py` **7 OK / 2 skipped**), Upstream Node (`b6-fonts.test.mjs` **8/8 PASS**, `b6-production.test.mjs` **1/1 PASS**, gộp kèm `b6-runtime.test.mjs` **19/20 PASS / 1 FAIL EPERM symlink Windows**). `vendor/` giữ sạch 100%.

### Phase 6 — Gate Hiện Tại & Blockers Còn Lại (Trung Thực)
- **Technical Gate (`cowboy-hat-10s` & `roman-gladiator-10s`)**: **PASS**.
- **Visual Motion Review (35 mục)**: **PENDING (`0/35`, `Pass: 0/35 · Pending: 35 · Needs repair: 0`)** — cần người dùng xem & nghe playback 1x qua `outputs/review-01/index.html`.
- **User Approval & Full Production Export**: **PENDING (`EXPORT ĐANG KHÓA`, `NO_APPROVAL_RECORD`)** — tuyệt đối chưa tự chứng nhận `approved` hoặc xuất `render` final production.
- **Giới hạn Gait**: `gaitStatus: unsupported_needs_authoring`.
