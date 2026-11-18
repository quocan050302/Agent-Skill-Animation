# QA Report — B6 Local Studio & Smoke Test (`roman-gladiator-10s`)

Báo cáo tổng hợp toàn bộ kết quả kiểm chứng thực tế trên máy local Windows tại `D:\Project_github\Agent-Skill\Skill-B6`. Tất cả trạng thái **PASS / PENDING / FAIL** đều bám sát đầu ra công cụ thực tế — **tuyệt đối không giả lập phê duyệt hay bypass rule B6**.

---

## 1. Upstream B6 Environment & Regression Suite (`vendor/stickman-video-director`)

- **Upstream Checkout**: `https://github.com/kaomei/stickman-video-director.git`, branch `main`, HEAD SHA `833e277cab230f22e6d9c24b31a1baccaae0e22d` (working tree sạch sau khi ép `core.autocrlf false`, `core.eol lf`).
- **Python Environment (`.venv`)**: `numpy==2.0.2`, `Pillow==11.3.0`, `opencv-python-headless==4.13.0.92` (`python3.exe` đồng bộ cạnh `python.exe`).
- **B6 CLI Checks (sau build cuối cùng, trong `scripts/verify.ps1`)**:
  - `node scripts/autopilot.mjs doctor --style B6`: **PASS** (`10/10` checks `true`: `node`, `ffmpeg`, `ffprobe`, `canvas`, `sharp`, `fonts`, `b4_hook_font`, `b6_python_paint_dependencies`, `b6_public_caption_font`, `b6_complete_pack`; `gemini_key_present: false`, `network_checked: false`).
  - `node scripts/b6-dynamic-meme.mjs check-pack`: **PASS** (`ok: true`, `files: 48`, `hong_kong_v90.ok: true`, `files: 85`, `fingerprint: e0e5f6dc0517f09b19c088383e38a1e8bae7af4c3e9bffd8bf796ab779d5d02d`).
- **Upstream Automated Test Suite (audit trước khi xây app, không sửa `vendor/`)**:
  - `b6_puppet_test.py`: **51/51 OK**
  - `b6_production_test.py`: **34/34 OK**
  - `b6_asset_isolation_test.py`: **17/17 OK**
  - `b6_actions_test.py`: **14/14 OK**
  - `b6_iteration_test.py`: **11/11 OK**
  - `b6_character_preflight_test.py`: **10/10 OK**
  - `b6_helper_trust_test.py`: **10/10 OK**
  - `b6_space_test.py`: **7/7 OK**
  - `b6_caption_test.py`: **7/7 OK** (`2 skipped`)
  - `b6_resource_paths_test.py`: **5/5 OK** (`1 skipped`)
  - `b6-fonts.test.mjs`: **8/8 PASS**
  - `b6-production.test.mjs`: **2/2 PASS**
  - `b6-runtime.test.mjs`: **12/13 PASS**, **1 FAIL** trên Windows không có quyền Admin (`symlinkSync` `EPERM`).
  - `b6_motion_review_test.py`: `setUpClass` `build_pack` **PASS** (qua shim `scripts/ffmpeg-compat/ffmpeg.exe`), **10 PASS / 23 ERROR / 3 FAIL** do code upstream `b6_motion_review.py:134` gọi `Path.write_text()` sinh CRLF trên Windows sau khi băm LF. (Đã ghi nhận nguyên nhân và giữ nguyên `vendor/` không chỉnh sửa).

---

## 2. B6 Local Studio — Build, Security & Integration Tests

Chạy qua `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` sau lần sửa code cuối cùng:

- **Workspace Build (`npm run build`)**: **PASS** (`@b6-studio/shared`, `@b6-studio/server` TypeScript, `@b6-studio/frontend` Vite bundle `317.05 kB` JS / `9.89 kB` CSS trong `2.95s`).
- **Server Vitest Suite (`npm --workspace=app/server run test`)**: **10/10 PASS** (`7.40s` tổng, không có unhandled rejection):
  1. `blocks path traversal, absolute paths, and null bytes` — PASS
  2. `rejects timeline overlaps, gaps, zero durations, and narrative mismatches` — PASS
  3. `reports health, doctor, and upstream SHA cleanly` — PASS (`3369ms`)
  4. `creates a real B6 production project (needs_authoring) via CLI init` — PASS (`803ms`)
  5. `persists story, shots, captions, and scene sync requests across reads` — PASS
  6. `rejects upstream protected B6 media imported as PRODUCTION ASSET, and imports valid RGBA PNG from inbox` — PASS
  7. `requires --trusted-code confirmation for draft/preview/render and blocks traversal in media route` — PASS (`400` trên `%2F..%2F` traversal & missing `--trusted-code`)
  8. `detects invalid/missing character rig failure via real Python preflight job` — PASS (`1131ms`, job chuyển `failed` với exit code != 0)
  9. `cancels a running child-process job via HTTP and cleans up process tree` — PASS (`POST /api/jobs/:id/cancel` hủy bằng `taskkill /T /F` và settle sạch sẽ)
  10. `marks previously running and queued jobs as interrupted on server startup` — PASS (cả 2 job kẹt khi reboot chuyển `interrupted` + ghi log hệ thống)
- **Production Boot & Media Streaming (`scripts/dev.ps1 -Prod`)**:
  - `GET http://127.0.0.1:4310/api/health`: `200 OK` (`{"ok":true,"service":"b6-local-studio"}`).
  - `GET http://127.0.0.1:4310/`: `200 OK`, HTML `427 bytes`.
  - `GET http://127.0.0.1:4310/api/media/roman-gladiator-10s/outputs/preview-01/preview.mp4` với header `Range: bytes=0-1023`: **`206 Partial Content`**, `Content-Range: bytes 0-1023/3021956`, `1024 bytes`.

---

## 3. Playwright E2E Verification (`npm --workspace=app/frontend run test:e2e`)

Chạy trên Chromium headless qua production server `node ../../scripts/dev-runner.mjs --prod` tại `http://127.0.0.1:4310` sau lần build cuối:

- **2/2 PASS** (`19.4s`):
  1. **Responsive Overflow & Box Bounds (`320px`, `375px`, `768px`, `1024px`, `1440px`)** (`5.0s`):
     - `document.documentElement.scrollWidth <= window.innerWidth`: PASS trên cả 5 viewport.
     - `.card` và `.input/.select/.textarea` `getBoundingClientRect().right <= window.innerWidth + 1`: PASS trên cả 5 viewport.
     - `runtimeErrors` (`console.error` + `pageerror`): `[]` (rỗng).
  2. **End-to-End CRUD, Persistence, Asset Brief, B6 Jobs & Cleanup** (`11.4s`):
     - Tạo dự án thật qua UI -> CLI `autopilot.mjs init` (`stage: needs_authoring`).
     - Chỉnh sửa tên dự án + narration -> bấm `Lưu (Ctrl+S)` (`PATCH 200`) -> `page.reload()` -> dữ liệu khớp 100%.
     - Vào tab Assets -> tạo `Asset Brief` (`Đã chuẩn bị (req-...)` + prompt copyable, không giả lập generate).
     - Mở dự án `Đấu Sĩ La Mã Phút Cuối (10s)`, kiểm tra thẻ `<video>` trỏ đúng `preview.mp4`, kiểm tra thông báo gait honesty (`Chưa hỗ trợ — cần author gait`), chạy `Preflight` thật, chạy `Validate` thật, chuyển sang view `Jobs & QA`, rồi xóa sạch dự án E2E tạm.
     - `runtimeErrors`: `[]`.

### Ảnh chụp kiểm chứng trực quan (`docs/agent-runs/B6-LOCAL-STUDIO-01/screenshots/`)
- `desktop-1440-projects.png`: Grid dự án Desktop sạch sẽ, trạng thái `Source OK`, card thumbnail contact-sheet của phim La Mã.
- `mobile-375-projects.png`: Đầy đủ chiều ngang 375px, không tràn chữ hay đè nút trên header, thanh điều hướng 5 mục ở đáy.
- `desktop-1440-studio.png`: 3 cột cân đối (Nav | Stage 9:16 + Timeline 5 shots | Inspector + phụ đề), thanh `Tác vụ B6` báo `validate: Hoàn tất validate (1.9s)`.
- `mobile-375-studio.png`: Video 9:16 co gọn hợp lý, có nút `Inspector` mở drawer và `JobsDrawer` hiển thị nút `Hủy`.
- `desktop-1440-qa.png`: Hiển thị rõ ràng **3 tầng QA tách biệt** (`1. TECHNICAL CHECK: PASS`, `2. VISUAL MOTION REVIEW: PENDING (0/35)`, `3. USER APPROVAL: PENDING`) và live log thật.

*(Ghi chú UI nhỏ đã phát hiện khi soi ảnh: trong `JobsQaView.tsx`, dòng mô tả đầu trang còn 1 cụm `` `b6_production.py` `` dùng backtick thuần chưa bọc thẻ `<code>`; không ảnh hưởng chức năng hoặc layout.)*

---

## 4. Smoke Video 10 Giây — `roman-gladiator-10s` (9:16 Native Portrait)

### Asset Provenance & Synthesis
- **Tranh gốc mới 100%** (do Antigravity `image-generator` subagent vẽ mới, tách RGBA ngoài nền trong suốt, đối chiếu SHA-256 trong `assets/manifest.json`, `protected_inputs: []`, `external_media_reads: []`):
  - `assets/production/arena_wide_bg.png`, `arena_foreground.png`, `roman_shield.png`, `roman_pilum.png`
  - `characters/marcus/three_quarter/{body.png, head.png, head-alert.png, head-bracing.png, cuff-left.png, cuff-right.png}`
- **Âm thanh (`audio/narration_mix.wav`)**: Local Windows SAPI (`Microsoft David Desktop`, `voice_speed: 1`) + procedural arena wind/impact SFX bằng Python (`10.000s`, `24kHz`, mono PCM).
- **Puppet Calibration (`characters/marcus/package.json`)**: `b6-puppet/1`, `binding_version: 2`, `head_width: 140.0`, `ink_width: 5.4` (khớp tỷ lệ nét tay dày của Sample 1 Eiffel V44), `ankle_targets` giới hạn biên độ nhún `±25%` giữ chân trụ tĩnh (không giả lập dáng đi).

### Kết quả kiểm tra & Benchmark trên máy
| Stage | Lệnh | Kết quả | Thời gian (`timings.total_seconds`) | Artifact & SHA-256 |
|---|---|---|---|---|
| **Preflight** | `python run.py preflight . --ratio 9:16` | **PASS** (`technical_pass: true`, `25` pose probes, `0` lỗi) | — | `character-preflight.json` |
| **Validate** | `python run.py validate . --ratio 9:16` | **PASS** (`valid: true`) | — | CLI stdout |
| **Draft 0.5x** | `python run.py draft . --ratio 9:16 --trusted-code --draft-scale 0.5 --start 0 --seconds 10` | **PASS** kỹ thuật (`360x640`, `300` frames, `600` arm poses, `600` legs, `max_prop_contact_error_px: 6.355e-14`) | **85.31s** (`scene: 77.60s`) | `outputs/draft-01/preview.mp4` (`78b2d658...09ab40`) |
| **Preview Native** | `python run.py preview . --ratio 9:16 --trusted-code --start 0 --seconds 10` | **PASS** kỹ thuật (`720x1280`, `300` frames, `600` arm poses, `600` legs, `max_prop_contact_error_px: 1.271e-13`) | **253.07s** (`scene: 239.17s`) | `outputs/preview-01/preview.mp4` (`3999cb9e...dddc61`) |
| **Review Pack** | `python run.py review-pack . --ratio 9:16 --report outputs/preview-01/report.json --output outputs/review-01` | **GENERATED** (`5` shots, `3` reference clips, `55` caption PNGs, `motion-review.json` v3, `index.html`) | — | `outputs/review-01/motion-review.json` (`status: pending_actual_playback_and_source_review`) |
| **Delivery Check** | `b-delivery-completeness.mjs init` | **INITIALIZED** (`status: not_checked`) | — | `outputs/review-01/delivery-completeness.json` |

### `ffprobe` Verified Specs (`outputs/preview-01/preview.mp4`)
- Video stream: `h264` (High, `yuv420p`), `720x1280`, `30/1 fps`, `300 frames`, `10.000000s`, `2,307,420 bps`.
- Audio stream: `aac` (LC), `24000 Hz`, `1 channel (mono)`, `10.000000s`, `102,180 bps`.
- Container: `mov,mp4,m4a,3gp,3g2,mj2`, kích thước `3,021,956 bytes` (`~2.88 MiB`).
- Caption contract: `Archivo Black` (`47px`, `stroke: 4`, `baseline: 914`, band `[864, 951]`), `10` câu đơn dòng trong vùng raster `[134..587, 873..930]`, hard-cut sắc nét (đã kiểm chứng trên `caption-0035.png`, `caption-0036.png`, `caption-0041.png`, `contact-sheet.jpg` và các frame giải mã tại `t=0.50, 2.20, 3.95, 4.50, 6.30, 8.50s`).

### Đánh giá trực quan trung thực (Visual Inspection Notes)
- **Điểm đạt**: Cánh tay nét liền khớp vai/cổ tay áo sạch sẽ; độ dày nét tay hài hòa với Sample 1 Eiffel V44; thay đổi biểu cảm đầu rõ nét theo nhịp kịch bản (`head` -> `head-alert` -> `head-bracing`); giáo phóng thẳng xuống cát kèm bóng đổ ở `t=3.95s` với tiếp xúc tay phải chính xác (`1.27e-13 px`); vòm đá tiền cảnh dịch chuyển parallax mượt.
- **Điểm nhỏ còn tồn tại (được ghi nhận trung thực)**:
  1. Ở ảnh `head-alert` và `head-bracing` (`shot-02-1.png`, `shot-03-2.png`), viền chân cổ có vệt răng cưa cutout nhẹ (~2–4 px).
  2. Sau khi vòm đá tiền cảnh trượt ra ngoài ở giây 3.5–10, một góc nhỏ của tảng đá vỡ tiền cảnh vẫn hơi ló vào mép dưới bên trái khung hình.
- **Trạng thái Gate B6 hiện tại của `roman-gladiator-10s`**:
  - **Technical Check**: **PASS** (`outputs/preview-01/report.json`).
  - **Visual Motion Review (35 mục)**: **PENDING** — `outputs/review-01/index.html` & `motion-review.json` đã tạo sẵn; chưa chấm `pass` cho 35 mục vì agent không nghe trực tiếp playback 1x qua loa trình duyệt của người dùng.
  - **User Approval**: **PENDING (`Chờ phê duyệt`)** — `approval-9x16.json` **không tồn tại**; nút `Xuất Video Full MP4` tiếp tục được khóa đúng quy tắc.

---

## 5. Cập nhật `B6-LOCAL-STUDIO-02` — QA Truth, Real Editor Binding, Clean-Clone & Phim Mới Cao Bồi 10s (`cowboy-hat-10s`)

### 5.1 Bounded-Parallel Orchestrator & Benchmark (`node scripts/verify-all.mjs --benchmark-workers --max-workers 2`)
Chạy sau lần chỉnh sửa code cuối cùng (cô lập Playwright tại `B6_STUDIO_PORT=4399` với `node ../server/dist/index.js`, `heavyRenderSemaphore = 1`, khóa theo từng project):
- **Overall**: `ok: true`, **`parityOk: true`**, **`speedupRatio: 1.16`** (`workers=1`: `86,992 ms` vs `workers=2`: `75,233 ms`).
- **Từng tác vụ trên cả hai pass (100% `succeeded`, code `0`)**:
  - `upstream_doctor_checkpack`: `1,151 ms` (`w=1`) / `1,512 ms` (`w=2`) — `autopilot.mjs doctor` (`b6_complete_pack: true`, `gemini_key_present: false`, `network_checked: false`) + `check-pack`.
  - `workspace_build`: `14,254 ms` / `16,730 ms` — `@b6-studio/shared` + `@b6-studio/server` (`tsc --noEmit` đã kiểm riêng exit `0`) + `@b6-studio/frontend` Vite bundle (`332.44 kB` JS, `9.89 kB` CSS).
  - `hydrate_verify_existing`: `2,385 ms` / `939 ms` — Xác minh `upstream-lock.json` (`833e277cab230f22e6d9c24b31a1baccaae0e22d`), `roman-gladiator-10s` và `cowboy-hat-10s` (`already_hydrated`, `0` lỗi).
  - `frontend_typecheck`: `4,263 ms` / `4,680 ms` — `tsc -b --noEmit` sạch lỗi.
  - `server_vitest`: `21,526 ms` / `24,337 ms` — **13/13 PASS** (`test/api.test.ts`), bổ sung:
    11. `blocks transactional invalid patches, enforces 409 revision lock, and marks narration edits voiceStale` — xác nhận rollback nguyên vẹn file cũ khi payload sai, trả `409 Conflict` khi sai `expectedRevision`, và đánh `VOICE_NEEDS_REGENERATION` khi đổi narration sau khi tạo SAPI WAV.
    12. `rejects all fake, missing, SHA-mismatched, wrong-ratio, tampered-35, and stale QA artifacts` — bẫy âm tính cho video thiếu, MP4 hỏng/sai SHA, fake approval, sai ratio `16:9`, tampered `<35` subchecks, `JobQueue` exit-0 không có output, `POST /render` bị khóa `400`, `DiskGuard` chặn khi thiếu dung lượng.
    13. `proves UI edits to camera/prop flow into rendered pixels and mark stale QA honestly` — sửa thật `cameraKeys` & `propKeyframes` qua `PATCH /api/projects/:id`, render 2 đoạn draft trước/sau qua `scene-control.json -> scene_runtime.py -> scene.py`, tính pixel MAD (`sharp` + `ffmpeg`) `> 2.5`.
  - `cowboy_preflight_validate`: `1,058 ms` / `1,532 ms` — `run.py preflight` + `run.py validate` (`valid: true`, `protected_inputs: []`, fingerprint `262bfddf906609c2b52924ef3fc061a892db83558f2941ab1d50e3782311c02c`).
  - `roman_baseline_sandbox_replay`: `12,080 ms` / `22,814 ms` — copy `roman-gladiator-10s` vào `os.tmpdir()` (không chạm bản tracked gốc), chạy `preflight`, `validate`, và draft `1.5s` (`45` frames, `90` arm/leg checks, `max_prop_contact_error_px: 6.355e-14`).
  - `clean_clone_hydrate_test`: `3,606 ms` / `4,847 ms` — copy bản sạch loại bỏ `vendor/`, `node_modules/`, `.venv/`, `dist/`, `outputs/`, `engine/`, `fonts/`, `reference/`, xác nhận thiếu trước khi hydrate, chạy `hydrate-project.mjs --all`, `--verify-only` và `run.py validate` trên `cowboy-hat-10s` đạt `valid: true`.
  - `playwright_e2e`: `2/2 PASS` (`25,216 ms` tại `w=1` và `21,802 ms` tại `w=2`), xuất ảnh kiểm chứng mới vào `docs/agent-runs/B6-LOCAL-STUDIO-02/screenshots/` (`desktop-1440-projects.png`, `desktop-1440-studio-cowboy.png`, `desktop-1440-qa-cowboy.png`, `mobile-375-studio.png`) với `runtimeErrors: []` và `0` horizontal overflow.

### 5.2 Upstream Regression Spot-Check (Không sửa `vendor/stickman-video-director`)
- `vendor/stickman-video-director` `git status --short`: sạch hoàn toàn, pin tại `833e277cab230f22e6d9c24b31a1baccaae0e22d`.
- `b6_production_test.py`: **34/34 OK** (`15.64s`).
- `b6_puppet_test.py` + `b6_actions_test.py` + `b6_space_test.py` + `b6_iteration_test.py` + `b6_character_preflight_test.py`: **93/93 OK** (trong đợt chạy Python unittest; `b6_caption_test.py` chạy cùng `PYTHONPATH=tests` đạt **7 OK, 2 skipped** do không có `Arial Black` gốc trên máy nên giữ Open Fallback).
- `b6-fonts.test.mjs`: **8/8 PASS**; `b6-production.test.mjs`: **1/1 PASS**; `b6-runtime.test.mjs`: trong đợt chạy gộp `b6-fonts + b6-production + b6-runtime` đạt **19/20 PASS**, **1 FAIL** tại `b6-runtime.test.mjs:58` (`Error: EPERM: operation not permitted, symlink` do Windows không ở Developer Mode). `b6_motion_review_test.py` vẫn giữ nguyên hành vi upstream đã biết trên Windows (3 FAIL / 23 ERROR `Previous review history changed`).

### 5.3 Phim Cao Bồi 10s Mới — `workspace/projects/cowboy-hat-10s` (`9:16` Native Portrait)
- **Tài nguyên mới 100% (`assets/production/`, `characters/jesse/`)**: Tranh nền đường phố miền Tây `western_wide_bg.png`, tiền cảnh hàng rào & xương rồng `western_fg_frame.png`, mũ cao bồi `cowboy_hat.png`, nhân vật `jesse` (cuffs + 4 đầu biểu cảm `head.png`, `head-shocked.png`, `head-determined.png`, `head-deadpan.png`), không tái sử dụng ảnh/video/audio từ Eiffel V44, Hong Kong V90 hay La Mã (`protected_inputs: []`, `external_media_reads: []`).
- **Âm thanh (`audio/narration_mix.wav`)**: Local Windows SAPI (`Microsoft David Desktop`, `voice_speed: 1`) + lớp gió sa mạc & bước chạy procedural (`10.000s`, `44100 Hz`, mono, SHA-256 `8d8769396aa7084dd96146bdad2ae520b905de9323dd525b6f8ea650620af203`).
- **Real Editor Binding**: Kịch bản, shot easing, `actorStart -> actorEnd`, `cameraKeys` và `propKeyframes` nằm trong `scene-control.json` và được `scene_runtime.py` cấp trực tiếp cho `scene.py` ở cả `draft` lẫn native `preview`.
- **Native Preview Metrics (`outputs/preview-01/preview.mp4` & bản lưu `docs/agent-runs/B6-LOCAL-STUDIO-02/cowboy-preview-10s.mp4`)**:
  - `ffprobe`: `h264` High (`yuv420p`), `720x1280`, `30/1 fps`, `300 frames`, `10.000000s`, audio `aac` LC `44100 Hz` mono, dung lượng `3,505,764 bytes` (`3.343 MiB`).
  - SHA-256 MP4: `cf41b7aed3852ba9aeb8af1f283afca890e03eeaa00c97d4d264c430bc6a9c15`.
  - Report: `checked_frames: 300`, `arm_poses_checked: 600`, `straight_legs_checked: 600`, `max_prop_contact_error_px: 1.271e-13`, `total_seconds: 174.5116`.
  - Inspect trực tiếp 6 khung hình decoded (`0.40s`, `1.50s`, `3.80s`, `5.60s`, `6.60s`, `8.80s`) và `cowboy-contact-sheet.jpg`: bố cục chân đứng sạch trên mặt đường phía trên vùng phụ đề Archivo Black 1 dòng (`baseline: 914`), tay trái bắt mép mũ khít ở `5.60s`, gió xoáy + bụi cartoon và biểu cảm hài hước rõ ràng ở payoff `8.80s`.
- **Gate & Gait Honesty (Chưa tự ý phê duyệt)**:
  - **Character Gait**: `gaitStatus: unsupported_needs_authoring` — UI tab Character cảnh báo rõ chưa có procedural gait cycle đầy đủ (`stride_cycles` chỉ phối hợp nhún chân giới hạn `ankle_targets` + trượt đường và parallax tiền cảnh).
  - **Technical Check**: **PASS** (`outputs/preview-01/report.json`, khớp fingerprint nguồn `262bfddf906609c2b52924ef3fc061a892db83558f2941ab1d50e3782311c02c`).
  - **Visual Motion Review (35 mục)**: **PENDING** (`Pass: 0/35 · Pending: 35 · Needs repair: 0` trong `outputs/review-01/motion-review.json`).
  - **User Approval & Render Gate**: **PENDING · EXPORT ĐANG KHÓA** (`NO_APPROVAL_RECORD`, nút `Xuất Video Full MP4` disabled và route `POST /render` trả `400`).

---

## 6. Cập nhật `B6-LOCAL-STUDIO-03` — Motion & Retention Engine, Atomic Rollback & Phim Samurai 10s (`samurai-red-leaf-10s`)

Xem báo cáo đầy đủ của đợt chạy R3 tại [`docs/agent-runs/B6-LOCAL-STUDIO-03/README.md`](agent-runs/B6-LOCAL-STUDIO-03/README.md) và [`QA-REPORT.md`](agent-runs/B6-LOCAL-STUDIO-03/QA-REPORT.md):
- **DAG Benchmark (`node scripts/verify-all.mjs --benchmark-workers --max-workers 2`)**: `ok: true`, **13/13 tasks PASS** (`workers=1`: `112,714 ms`, `workers=2`: `96,101 ms`, **`speedupRatio: 1.17x`**, `decodedPixelsParity: true`, `containerByteParity: true`).
- **Python `motion_runtime` (`test_motion_core.py`)**: **8/8 OK** (`-W error::DeprecationWarning`).
- **Server Vitest (`test/api.test.ts`)**: **16/16 PASS** (multi-file rollback fault-injection, `motion_qc.json` trap, live Samurai gait edit MAD `> 2.5`).
- **Playwright Chromium E2E (`studio.spec.ts`)**: **3/3 PASS** (`29.4s`), bao gồm Studio Samurai + Motion Overlay + persistent duplicate edit + clean teardown.
- **Upstream Read-Only Python Check** (`.venv\Scripts` + `ffmpeg-compat` on `PATH`): **109/109 tests OK** (`21.848s`), `vendor/` giữ sạch tại `833e277cab230f22e6d9c24b31a1baccaae0e22d`.
- **Samurai 10s Preview (`samurai-red-leaf-10s`)**: `4,280,778 bytes` (`4.08 MiB`, SHA-256 `436a13bdaf1b68de381db376a4e6721ebfa5755fc542479dfdb7bfc463687289`), `motion_qc.json`: `status: "pass"` (`max_stance_drift_world: 0.0`, `max_ground_penetration_world: 0.0`, `max_knee_bend_deg: 131.66`), **Visual Review 35 mục**: **PENDING (`0/35`)**, **User Approval**: **PENDING (`EXPORT ĐANG KHÓA`)**.
