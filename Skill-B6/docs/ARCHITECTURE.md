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
- `EnvDoctorService`: Kiểm tra Node, Python `.venv`, imports (`numpy`, `PIL`, `cv2`), FFmpeg/FFprobe, chạy `autopilot.mjs doctor --style B6`, kiểm tra dung lượng đĩa trống (`6 GiB` clone / `10 GiB` render warning / `512 MiB` hard block).
- `UpstreamService`: Đọc read-only SHA commit `HEAD`, nhánh, license MIT, xác minh hash tham chiếu chính `eiffel-portrait-v44.mp4` và `check-pack`.
- `ProjectService`: Quản lý `workspace/projects/<id>`. Tạo dự án mới bằng CLI `autopilot.mjs init <dir> --style B6 --ratio <r>`. Ghi `studio.meta.json` và giữ cấu trúc tách biệt khỏi `vendor/`.
- `ScriptTimelineService`: Kiểm tra tính liên tục timeline (no gaps/overlaps, positive shot duration, short-cut reason `<0.9s`, camera keyframes `t=0` & tăng dần, single-line captions khớp `narration`) và ghi atomic (`tmp + fsync + rename`). Hỗ trợ tạo `sceneSyncRequests` hoặc lưu `scene.py`.
- `AssetService`: Quản lý `assets/manifest.json`, inspect ảnh bằng `sharp` (width, height, alpha bbox, transparent exterior), kiểm tra âm thanh bằng `ffprobe`, chặn SHA-256 trùng media mẫu từ `b6_asset_roles.py` nếu nhập làm `PRODUCTION ASSET`, sinh `assets/requests/*.asset-request.json` và nhập file từ `assets/inbox/`.
- `CharacterBindingService`: Đọc `characters.json` và `characters/<id>/package.json` (`b6-puppet/1`, `binding_version: 2`), phơi bày trạng thái walk/run gait (`unsupported_needs_authoring`), cập nhật anchor và tính lại SHA-256 gói nhân vật.
- `B6CommandAdapter` & `JobQueue`:
  - Khởi chạy process với `shell: false`, `PYTHONDONTWRITEBYTECODE=1`, `PYTHONPYCACHEPREFIX=workspace/cache/pycache`, và `scripts/ffmpeg-compat` đứng đầu `PATH` (khi chạy trên Windows có FFmpeg 9).
  - Hàng đợi khóa theo từng project (`activeProjectLocks`) và giới hạn tối đa `1` job encode nặng (`draft`, `preview`, `render`, `review-pack`) chạy đồng thời.
  - Durable state lưu tại `workspace/jobs/<jobId>.json` và log append-only tại `workspace/jobs/<jobId>.log`. Khi server khởi động lại, mọi job còn ở trạng thái `running`/`queued` được đánh dấu trung thực là `interrupted`.
  - Hỗ trợ hủy cây tiến trình (`taskkill /PID ... /T /F` trên Windows, `SIGTERM` -> `SIGKILL` trên Unix) và chỉ xóa thư mục output riêng của job bị hủy.
- `MediaService`: Phục vụ media trong project qua `/api/media/:projectId/*` với `resolveInsideRoot` chống path traversal/symlink escape và hỗ trợ HTTP `206 Partial Content` (Range streaming).
- `ReviewService` & `OutputService`: Tách biệt 3 trạng thái QA (`technicalStatus`, `visualReviewStatus`, `userApprovalStatus`), probe thông số thực của MP4 qua `ffprobe`, và mở thư mục output local khi người dùng bấm nút.

## 3. REST & SSE Endpoints
- `GET /api/health`, `GET /api/doctor`, `GET /api/upstream`
- `GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id`, `PATCH /api/projects/:id`, `PUT /api/projects/:id/scene`, `POST /api/projects/:id/duplicate`, `DELETE /api/projects/:id`
- `GET /api/projects/:id/assets`, `POST /api/projects/:id/assets/import`, `POST /api/projects/:id/assets/brief`
- `GET /api/projects/:id/characters`, `PATCH /api/projects/:id/characters/:actorId/views/:viewId`
- `POST /api/projects/:id/{preflight|validate|draft|preview|review-pack|check-review|approve|render}`
- `GET /api/projects/:id/outputs`, `POST /api/projects/:id/outputs/open-folder`, `GET /api/projects/:id/review`
- `GET /api/jobs`, `GET /api/jobs/:jobId`, `GET /api/jobs/:jobId/events` (SSE), `POST /api/jobs/:jobId/cancel`
- `GET /api/media/:projectId/*`
