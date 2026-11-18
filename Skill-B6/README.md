# B6 Local Studio

Ứng dụng web desktop-local (chạy trên `127.0.0.1`) khai thác trực tiếp engine **B6 — Dynamic Meme Animation** (Code Engine) từ mã nguồn chính thức [`kaomei/stickman-video-director`](https://github.com/kaomei/stickman-video-director).

> **Nguyên tắc cốt lõi:** Toàn bộ chuyển động (puppet IK, contact timeline, depth camera, caption raster 3× Lanczos, muxing FFmpeg) được tạo và render **bằng code Python/Node local**, tuyệt đối không gọi video-generation AI API (Veo/Kling/Runway/Flow). Một dự án mới luôn bắt đầu ở trạng thái `needs_authoring` — cần hoàn thiện kịch bản, tài nguyên RGBA tách lớp, rig nhân vật (`b6-puppet/1`), âm thanh gốc và `scene.py` trước khi preview/export.

## 1. Đường dẫn tuyệt đối trên máy

- **App Root**: `D:\Project_github\Agent-Skill\Skill-B6`
- **Upstream Vendor Checkout (Read-Only)**: `D:\Project_github\Agent-Skill\Skill-B6\vendor\stickman-video-director`
- **B6 Skill Entrypoint**: `D:\Project_github\Agent-Skill\Skill-B6\vendor\stickman-video-director\skills\directing-stickman-videos`
- **Workspace Projects**: `D:\Project_github\Agent-Skill\Skill-B6\workspace\projects`
- **Project mẫu La Mã 10s (Mới)**: `D:\Project_github\Agent-Skill\Skill-B6\workspace\projects\roman-gladiator-10s`
- **Jobs & Logs**: `D:\Project_github\Agent-Skill\Skill-B6\workspace\jobs`
- **Python Isolated Virtualenv**: `D:\Project_github\Agent-Skill\Skill-B6\.venv\Scripts\python.exe`

## 2. Yêu cầu hệ thống (Prerequisites)

- **Node.js** `>= 20` (đã xác nhận `v26.13.1`)
- **Python** `>= 3.9` (đã xác nhận `3.12.10` với `numpy==2.0.2`, `Pillow==11.3.0`, `opencv-python-headless==4.13.0.92`)
- **FFmpeg & FFprobe** (đã xác nhận `9.0.2`; app tự kèm shim `scripts/ffmpeg-compat/ffmpeg.exe` chuyển `-vsync` sang `-fps_mode` cho `b6_motion_review.py` mà không sửa file vendor)
- **Git** (`>= 2.x`) và tối thiểu `6–10 GiB` dung lượng ổ đĩa trống

## 3. Khởi động nhanh (One-Command Startup)

### Cài đặt từ đầu (Windows PowerShell / macOS & Linux)
```powershell
# Windows PowerShell
.\scripts\setup.ps1
```
```bash
# macOS / Linux
./scripts/setup.sh
```

### Khởi động ứng dụng (Localhost)
```powershell
# Windows PowerShell (Dev mode: Vite :5176 + Fastify API :4310)
.\scripts\dev.ps1

# Hoặc chạy bản build production tại một cổng duy nhất http://127.0.0.1:4310
.\scripts\dev.ps1 -Prod -Open
```
```bash
# macOS / Linux
./scripts/dev.sh
```

- **Frontend UI (Dev)**: `http://127.0.0.1:5176`
- **Backend API & Production UI**: `http://127.0.0.1:4310`
- **Health Check**: `http://127.0.0.1:4310/api/health`
- **Dừng ứng dụng**: Nhấn `Ctrl + C` trong terminal đang chạy `dev.ps1` / `dev.sh`.

### Kiểm chứng toàn bộ hệ thống (Tests + Doctor + E2E)
```powershell
.\scripts\verify.ps1
```

## 4. Quy trình sử dụng UI (Từ kịch bản đến Export MP4)

1. **Dự án mới (`Projects`)**: Nhấn **Dự án mới**, nhập tên, tóm tắt, tỷ lệ gốc (`9:16` được khuyến nghị cho B6). Backend chạy `autopilot.mjs init ... --style B6`, khởi tạo dự án ở trạng thái `needs_authoring`.
2. **Kịch bản & Phân cảnh (`Studio -> Inspector: Story / Shot / Camera`)**:
   - Sửa tên dự án, premise, hook, lời thoại (`narration`), danh sách phụ đề 1 dòng (`captions.json`), shots và camera keyframes (`x, y, z, fov`).
   - Tự động lưu sau 700ms hoặc nhấn `Ctrl+S`, có nút **Hoàn tác** (Undo) và tự khôi phục khi tải lại trang.
   - Mọi thay đổi cần biên soạn lại code Python `scene.py` có thể gửi qua mục **Yêu cầu Anti cập nhật scene.py** hoặc chỉnh trực tiếp trong trình xem `scene.py` nâng cao.
3. **Tài nguyên & Tạo ảnh (`Assets`)**:
   - Dùng **Chuẩn bị yêu cầu ảnh cho Anti** để xuất `asset-request.json` chuẩn khóa nét mực/ánh sáng B6 Sample 1.
   - Do trình duyệt localhost không tự gọi tool tạo ảnh nội bộ của Anti, sau khi Anti tạo ảnh vào `assets/inbox/`, nhấn **Nhập kết quả** hoặc tải trực tiếp tệp PNG/WAV/M4A.
   - Backend tính SHA-256, kiểm tra kênh alpha RGBA thực và **từ chối** mọi tệp trùng hash media mẫu của upstream nếu nhập làm `PRODUCTION ASSET`.
4. **Nhân vật & Rig (`Studio -> Inspector: Character`)**:
   - Xem ảnh `head` / `body` / biểu cảm, kiểm tra thông số `neck_attachment`, `cuff`, `ink_width`, và nhấn **Chạy Preflight** (`b6_character_preflight.py`).
5. **Xem thử, Review 35 mục & Xuất video (`Studio -> Inspector: Export` & `Jobs & QA`)**:
   - Tích chọn xác nhận `--trusted-code` cho `scene.py` local.
   - Chạy lần lượt: **1. Validate** → **2. Draft 0.5x/0.75x** → **3. Preview Native MP4** → **4. Tạo Review Pack** → **5. Kiểm tra Review JSON**.
   - Xem tiến trình thực tế theo frame và stdout/stderr ở **Jobs Drawer** dưới đáy màn hình hoặc tab **Jobs & QA**; bấm **Hủy** để chấm dứt cây tiến trình và dọn output dở dang.
   - Trạng thái **Technical**, **Visual Review (35 mục)** và **User Approval** luôn tách biệt. Nút **Xuất Video Full MP4** chỉ mở khóa khi cả review 35 mục lẫn phê duyệt người dùng đều hợp lệ.

## 5. Giới hạn hiện tại của engine B6

- **Walk / Run Gait**: `b6_puppet.py` v1 chỉ hỗ trợ chân đứng tĩnh với `ankle_targets` giới hạn (±25% chiều dài chân cho nhún/chuyển trọng tâm). Không có bộ sinh bước đi/chạy tự động; nhân vật muốn đi/chạy phải author gait + điểm tiếp đất riêng và kiểm tra chống trượt.
- **Native 9:16 vs 16:9**: B6 đạt chất lượng cao nhất ở **9:16 dọc** (lấy Eiffel V44 làm chuẩn mực chính). Chuyển sang 16:9 phải author riêng bố cục, camera và `native_layout_reason`, không crop/kéo giãn.
- **Tạo ảnh & Giọng đọc (Image / TTS)**: Chưa có callable API trực tiếp từ web app localhost sang tool tạo ảnh của Anti. Tạo ảnh qua cơ chế `asset-request.json` + `assets/inbox/`, âm thanh qua nhập WAV/M4A hoặc tổng hợp local (ví dụ Windows SAPI TTS).
- **Upstream Windows Notes**: File `b6_motion_review.py` của upstream dùng `-vsync vfr` (đã bỏ ở FFmpeg 9) và `write_text()` CRLF khi lưu lịch sử lỗi `.b6-review-history/`. Xem chi tiết tại [docs/B6-SOURCE-AUDIT.md](docs/B6-SOURCE-AUDIT.md).
