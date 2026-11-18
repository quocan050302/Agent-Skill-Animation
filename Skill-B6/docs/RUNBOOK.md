# Operations Runbook — B6 Local Studio

## 1. Setup & Environment Doctor
Chạy một lệnh setup để kiểm tra và cài đủ toolchain:
```powershell
.\scripts\setup.ps1
```
Kiểm tra lại bất cứ lúc nào qua API `GET http://127.0.0.1:4310/api/doctor` hoặc CLI:
```powershell
$env:B6_PYTHON = "D:\Project_github\Agent-Skill\Skill-B6\.venv\Scripts\python.exe"
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONPYCACHEPREFIX = "D:\Project_github\Agent-Skill\Skill-B6\workspace\cache\pycache"
cd D:\Project_github\Agent-Skill\Skill-B6\vendor\stickman-video-director\skills\directing-stickman-videos
node scripts/autopilot.mjs doctor --style B6 --python $env:B6_PYTHON
node scripts/b6-dynamic-meme.mjs check-pack
```

## 2. Windows-Specific Notes (Đã kiểm chứng thực tế)
1. **Git Line Endings (`core.autocrlf`)**: Upstream không có `.gitattributes`. Khi clone trên Windows với `core.autocrlf=true`, một số file `.json`/`.py`/`.txt` chuyển sang CRLF làm sai SHA-256 trong `check-pack` và `b6_production.py`. Script `setup.ps1` tự động thiết lập `core.autocrlf false` và `core.eol lf` trong `vendor/stickman-video-director` rồi `git reset --hard HEAD` để bảo toàn chính xác từng byte của upstream.
2. **Python Bytecode Cache (`__pycache__`)**: Khi `run.py` audit đọc file nội bộ trong project, việc Python tự sinh `__pycache__/*.pyc` bên trong thư mục project có thể gây lỗi `Declare project-local code/art dependencies in inputs`. Backend và các script luôn set `PYTHONDONTWRITEBYTECODE=1` và `PYTHONPYCACHEPREFIX=workspace/cache/pycache`.
3. **NumPy Pin (`numpy==2.0.2`)**: Engine V90 dùng `np.cross()` với vector 2D (đã bị xóa khỏi NumPy >=2.2). Môi trường `.venv` được pin chính xác theo `requirements.txt` (`numpy==2.0.2`, `Pillow==11.3.0`, `opencv-python-headless==4.13.0.92`).
4. **FFmpeg 9 Compatibility (`-vsync` -> `-fps_mode`)**: FFmpeg 9.0.2 đã gỡ bỏ cờ `-vsync` (thay bằng `-fps_mode`), trong khi `b6_motion_review.py` (file đã khóa SHA-256 bởi `b6_production.py`) gọi `ffmpeg ... -vsync vfr`. `scripts/ffmpeg-compat/ffmpeg.exe` chuyển đổi cờ này một cách trong suốt mà không chạm vào `vendor/`.

## 3. Common Errors & Troubleshooting
- **`Character preflight failed: upper arm points back into cuff`**: Góc `poses` hoặc `exit_normal` trong `package.json` khiến cánh tay quay ngược vào cổ tay áo (`dot <= 0.02`). Chỉnh `exit_normal` đúng hướng mở tay áo hoặc điều chỉnh `poses` trong `package.json` rồi chạy lại `Preflight`.
- **`Actual forearm/hand alpha disconnected` / `not sufficiently readable`**: Prop (như khiên/giấy) đang che mất phần đầu cánh tay hoặc khớp cẳng tay. Điều chỉnh vị trí prop hoặc khai báo `front_limb_parts` trên `PropFrame` nếu cẳng tay đi phía trước prop.
- **`Missing user approval: approval-9x16.json`**: Nút **Xuất Video Full MP4** bị khóa cho đến khi preview được tạo `review-pack`, hoàn thành 35 mục trong `motion-review.json` (`check-review` pass) và người dùng nhấn **Ghi nhận Phê duyệt** với ghi chú thực tế.
- **Lỗi thiếu dung lượng đĩa**: Backend tự chặn render nếu ổ đĩa còn dưới `512 MiB` và cảnh báo dưới `10 GiB`. Dọn các thư mục `outputs/draft-*` cũ không dùng trong từng project.

## 4. Cleanup & Disk Safety
- Chỉ xóa output hoặc project trong `workspace/projects/` qua UI hoặc xóa thư mục con cụ thể trong `outputs/`.
- Tuyệt đối không chạy xóa đệ quy trên `vendor/` hoặc bên ngoài `Skill-B6`.
- Thư mục `workspace/cache/` và `workspace/temp/` có thể dọn an toàn khi không có job đang chạy.
