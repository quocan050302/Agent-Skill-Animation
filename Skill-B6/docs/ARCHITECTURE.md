# Architecture — B6 Local Studio

## 1. System Overview
B6 Local Studio tách bạch hoàn toàn thành 3 tầng trên máy local (`127.0.0.1`), giữ nguyên vẹn mã nguồn upstream tại `vendor/stickman-video-director`:

```
+-------------------------------------------------------------------+
|  Frontend (React 19 + Vite + TypeScript)                          |
|  - Projects, PlayerStage, Timeline, Inspector (5 tabs),           |
|    Assets (Anti Brief & Inbox), Jobs & QA Drawer                  |
+-------------------------------+-----------------------------------+
                                | REST JSON + Multipart + SSE + Range
+-------------------------------v-----------------------------------+
|  Backend API & Job Orchestrator (Node 20+ Fastify + TypeScript)   |
|  - Zod contract validation (@b6-studio/shared)                    |
|  - ProjectService, ScriptTimelineService, AssetService,           |
|    CharacterBindingService, ReviewService, OutputService,         |
|    MediaService (HTTP Range streaming), EnvDoctorService          |
|  - B6CommandAdapter (argv arrays, shell=false) + JobQueue (SSE)   |
+-------------------------------+-----------------------------------+
                                | spawn(argv[], shell=false)
+-------------------------------v-----------------------------------+
|  B6 Code Engine (Read-Only Upstream Vendor)                       |
|  - Node CLI: autopilot.mjs (workflow, doctor, init)               |
|  - Project Python Runner: run.py (b6_production.py)               |
|    -> b6_puppet.py, b6_character_preflight.py, b6_space.py,       |
|       b6_actions.py, b6_iteration.py, caption_renderer.py,        |
|       b6_asset_roles.py, motion_review.py                         |
|  - FFmpeg / FFprobe (+ app-owned ffmpeg-compat shim on Windows)   |
+-------------------------------------------------------------------+
```

## 2. Backend Service Responsibilities (`app/server/src/services/`)
- `EnvDoctorService`: Kiểm tra Node, Python `.venv`, imports (`numpy`, `PIL`, `cv2`), FFmpeg/FFprobe, chạy `autopilot.mjs doctor --style B6`, kiểm tra dung lượng đĩa trống (`6 GiB` clone / `10 GiB` render warning / `1 GiB` hard block mặc định qua `resolveMinFreeBytesRender()`).
- `UpstreamService`: Đọc read-only SHA commit `HEAD`, nhánh, license MIT, xác minh hash tham chiếu chính `eiffel-portrait-v44.mp4` và `check-pack` đối chiếu `upstream-lock.json`.
- `ProjectService`: Quản lý `workspace/projects/<id>`. Tạo dự án mới bằng CLI `autopilot.mjs init <dir> --style B6 --ratio <r>`, tự động cài đặt `scene_runtime.py` + `scene-control.json` khởi điểm, lưu `studio.meta.json` (`revision`, `lastRenderedRevision`, `voiceTextSha256`) và giữ cấu trúc tách biệt khỏi `vendor/`.
- `EditorBindingService`: Biên dịch và kiểm định `scene-control.json` (`b6-studio-scene-control/1`), phát hành `scene_runtime.py` (`load_scene_plan`, `shot_at`, `camera_at`, `actor_state_at`, `prop_state_at`, `qa_trace_at`, `motion_state_at`, `director_beat_at`, `camera_director_at`) để camera keyframes, pose/expression/arm-actions, easing, articulated motion presets/gait và prop keyframes từ UI chảy trực tiếp vào `frame()`/`draft_frame()`, đồng thời phơi bày bảng ánh xạ binding và trạng thái đồng bộ (`EditorSyncState`, `motionEngineMode`).
- `QaEvidenceResolver`: Nguồn chân lý QA duy nhất (`qa-evidence-service.ts`). Uỷ quyền `run.py validate` tính fingerprint nguồn hiện tại, đối chiếu `report.json` (`video_sha256`, `technical_status`, `checked_frames`, `ffprobe` dimension/fps/duration/audio), xác minh `motion_qc.json` cho dự án `articulated_v1` (`motionQcStatus` + `MOTION_QC_FAILED`/`MOTION_QC_STALE`), kiểm tra đủ 8 nhóm / 35 subchecks với observation không rỗng của `motion-review.json`, xác nhận `approval-9x16.json`/`approval-16x9.json` trùng fingerprint & playback SHA, phát hiện `VOICE_NEEDS_REGENERATION` khi narration thay đổi, và chỉ mở khóa `renderUnlocked` khi toàn bộ tầng QA khớp source hiện hành.
- `ScriptTimelineService`: Kiểm tra transactional **trước khi ghi file** (`validateTimelineData` + `validateCanonicalScenePlan`), áp dụng rollback journal nguyên tử đa file (hỗ trợ inject lỗi thử nghiệm `onBeforeCommitFile`), khóa concurrency theo project (`withProjectLock`), optimistic lock `expectedRevision` (`409` nếu xung đột), kiểm tra cú pháp Python trước khi lưu `scene.py`, tổng hợp giọng Windows SAPI local (`synthesizeLocalVoiceWav`) và xóa cache QA sau mỗi lần sửa.
- `AssetService`: Quản lý `assets/manifest.json`, inspect ảnh bằng `sharp` (width, height, alpha bbox, transparent exterior), kiểm tra âm thanh bằng `ffprobe`, chặn SHA-256 trùng media mẫu từ `b6_asset_roles.py` nếu nhập làm `PRODUCTION ASSET`, đồng bộ `voiceTextSha256` & bump `revision` khi nhập voice mới.
- `CharacterBindingService`: Đọc `characters.json` và `characters/<id>/package.json` (`b6-puppet/1`, `binding_version: 2`), phân biệt trung thực `gaitStatus` (`authored_verified` khi dự án dùng `articulated_v1` + đạt `motion_qc.json`, hoặc `unsupported_needs_authoring` cho `legacy_stance`), cập nhật anchor, tính lại SHA-256 gói nhân vật, tăng `revision` và làm mất hiệu lực QA cũ.
- `B6CommandAdapter` & `JobQueue`:
  - Khởi chạy process với `shell: false`, `PYTHONDONTWRITEBYTECODE=1`, `PYTHONPYCACHEPREFIX=workspace/cache/pycache`, và `scripts/ffmpeg-compat` đứng đầu `PATH` (khi chạy trên Windows có FFmpeg 9).
  - Hàng đợi khóa theo từng project (`activeProjectLocks`), giới hạn tối đa `1` job encode nặng đồng thời, kiểm tra disk floor `>= max(1 GiB, 2 * estimatedTempBytes)` và xác minh report/MP4 đầu ra khi job thoát `0` (fail closed nếu thiếu/rỗng artifact).
  - Durable state lưu tại `workspace/jobs/<jobId>.json` và log append-only tại `workspace/jobs/<jobId>.log`. Khi server khởi động lại, mọi job còn ở trạng thái `running`/`queued` được đánh dấu trung thực là `interrupted`.
  - Hỗ trợ hủy cây tiến trình (`taskkill /PID ... /T /F` trên Windows, `SIGTERM` -> `SIGKILL` trên Unix) và chỉ xóa thư mục output riêng của job bị hủy.
- `MediaService`: Phục vụ media trong project qua `/api/media/:projectId/*` với `resolveInsideRoot` chống path traversal/symlink escape và hỗ trợ HTTP `206 Partial Content` (Range streaming).
- `ReviewService` & `OutputService`: Ủy quyền qua `QaEvidenceResolver` để trả về 3 trạng thái QA tách biệt (`pass | fail | pending | stale`), `verificationStatus` từng output (`current | historical | stale | corrupt`), thông số `ffprobe` thực tế và mở thư mục output local.

## 3. REST & SSE Endpoints
- `GET /api/health`, `GET /api/doctor`, `GET /api/upstream`
- `GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id`, `PATCH /api/projects/:id`, `PUT /api/projects/:id/scene`, `POST /api/projects/:id/duplicate`, `DELETE /api/projects/:id`
- `GET /api/projects/:id/editor-binding`, `GET /api/projects/:id/motion-capability`, `GET /api/projects/:id/qa`, `POST /api/projects/:id/voice/synthesize-local`
- `GET /api/projects/:id/assets`, `POST /api/projects/:id/assets/import`, `POST /api/projects/:id/assets/brief`
- `GET /api/projects/:id/characters`, `PATCH /api/projects/:id/characters/:actorId/views/:viewId`
- `POST /api/projects/:id/{preflight|validate|draft|preview|review-pack|check-review|approve|render}` (route `render` chặn `400` nếu `renderUnlocked !== true`)
- `GET /api/projects/:id/outputs`, `POST /api/projects/:id/outputs/open-folder`, `GET /api/projects/:id/review`
- `GET /api/jobs`, `GET /api/jobs/:jobId`, `GET /api/jobs/:jobId/events` (SSE), `POST /api/jobs/:jobId/cancel`
- `GET /api/media/:projectId/*`

## 4. Portable Clean-Clone Hydration & Shared Motion Runtime
- `upstream-lock.json` + `.gitattributes` (`eol=lf`) + `scripts/hydrate-project.{mjs,ps1,sh}`: Khôi phục không phá hủy `engine/`, `fonts/` và `reference/` bị `.gitignore` cho mọi project từ checkout `vendor/` đã pin SHA `833e277cab230f22e6d9c24b31a1baccaae0e22d`, đồng thời đồng bộ `motion_runtime/b6_motion_{core,render,qc}.py` (kiểm chứng `motion_runtime/manifest.json`) chỉ vào những project opt-in `articulated_v1`.
- `scripts/verify-all.mjs` (hỗ trợ `--tier fast|medium|release`, `--benchmark-workers --max-workers N`, được gọi bởi `scripts/verify.{ps1,sh}`): DAG runner song song có giới hạn (`heavyRenderSemaphore = 1`, khóa theo từng project), kiểm tra parity pixel giải mã FFmpeg + container byte + random-seek invariance, ghi log JSONL tại `docs/agent-runs/B6-LOCAL-STUDIO-03/verify-all.jsonl`.
