# B6 Local Studio

Ứng dụng web desktop-local (chạy trên `127.0.0.1`) khai thác trực tiếp engine **B6 — Dynamic Meme Animation** (Code Engine) từ mã nguồn chính thức [`kaomei/stickman-video-director`](https://github.com/kaomei/stickman-video-director).

> **Nguyên tắc cốt lõi:** Toàn bộ chuyển động (puppet IK, contact timeline, depth camera, caption raster 3× Lanczos, muxing FFmpeg) được tạo và render **bằng code Python/Node local**, tuyệt đối không gọi video-generation AI API (Veo/Kling/Runway/Flow). Một dự án mới luôn bắt đầu ở trạng thái `needs_authoring` — cần hoàn thiện kịch bản, tài nguyên RGBA tách lớp, rig nhân vật (`b6-puppet/1`), âm thanh gốc và `scene.py` trước khi preview/export.

## 1. Đường dẫn tuyệt đối trên máy

- **App Root**: `D:\Project_github\Agent-Skill\Skill-B6`
- **Upstream Vendor Checkout (Read-Only)**: `D:\Project_github\Agent-Skill\Skill-B6\vendor\stickman-video-director`
- **B6 Skill Entrypoint**: `D:\Project_github\Agent-Skill\Skill-B6\vendor\stickman-video-director\skills\directing-stickman-videos`
- **Workspace Projects**: `D:\Project_github\Agent-Skill\Skill-B6\workspace\projects`
- **Project mẫu La Mã 10s (Baseline R1 — `legacy_stance`)**: `D:\Project_github\Agent-Skill\Skill-B6\workspace\projects\roman-gladiator-10s`
- **Project Cao bồi 10s (R2 — `legacy_stance` + Live `scene-control.json`)**: `D:\Project_github\Agent-Skill\Skill-B6\workspace\projects\cowboy-hat-10s`
- **Project Samurai 10s (Mới R3 — `articulated_v1` Bent-Knee Motion + Camera Director)**: `D:\Project_github\Agent-Skill\Skill-B6\workspace\projects\samurai-red-leaf-10s`
- **Video preview tự chứa của run R3**: `docs/agent-runs/B6-LOCAL-STUDIO-03/samurai-preview-10s.mp4` (`4.08 MiB`, `720x1280`, `30fps`, `10.0s`)
- **Shared Articulated Motion Runtime**: `D:\Project_github\Agent-Skill\Skill-B6\motion_runtime` (`b6_motion_core.py`, `b6_motion_render.py`, `b6_motion_qc.py`)
- **Jobs & Logs**: `D:\Project_github\Agent-Skill\Skill-B6\workspace\jobs`
- **Python Isolated Virtualenv**: `D:\Project_github\Agent-Skill\Skill-B6\.venv\Scripts\python.exe`

## 2. Yêu cầu hệ thống (Prerequisites)

- **Node.js** `>= 20` (đã xác nhận `v26.13.1`)
- **Python** `>= 3.9` (đã xác nhận `3.12.10` với `numpy==2.0.2`, `Pillow==11.3.0`, `opencv-python-headless==4.13.0.92`)
- **FFmpeg & FFprobe** (đã xác nhận `9.0.2`; app tự kèm shim `scripts/ffmpeg-compat/ffmpeg.exe` chuyển `-vsync` sang `-fps_mode` cho `b6_motion_review.py` mà không sửa file vendor)
- **Git** (`>= 2.x`) và tối thiểu `6–10 GiB` dung lượng ổ đĩa trống

## 3. Khởi động nhanh (One-Command Startup)

### Cài đặt & Hydrate sau khi `git clone` sạch (Windows PowerShell / macOS & Linux)
```powershell
# Windows PowerShell (cài dependencies, checkout upstream SHA ghim ở upstream-lock.json, hydrate engine/fonts/reference)
.\scripts\setup.ps1

# Hoặc chỉ hydrate lại các artifact .gitignore vào workspace/projects
npm run hydrate
```
```bash
# macOS / Linux
./scripts/setup.sh
```

### Khởi động ứng dụng (1 lệnh cho cả FE + BE)
```powershell
# Chạy đồng thời Backend (:4310) + Frontend (:5176) với log [BE] / [FE]
cd D:\Project_github\Agent-Skill\Skill-B6
npm run dev
```
Hoặc dùng script PowerShell / Shell (tự hỗ trợ `-Open` mở trình duyệt / `-Prod` chạy bản build một cổng):
```powershell
# Windows PowerShell (Dev mode: Vite :5176 + Fastify API :4310)
.\scripts\dev.ps1 -Open

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

### Kiểm chứng toàn bộ hệ thống (Bounded-Parallel DAG + Clean Clone + E2E)
```powershell
# Hoặc: powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
npm run verify:all
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

- **Walk / Run Gait (`legacy_stance` vs `articulated_v1`)**: `b6_puppet.py` gốc (`legacy_stance`, giữ nguyên cho La Mã R1 & Cao bồi R2) chỉ hỗ trợ chân đứng tĩnh với `ankle_targets` giới hạn (±25% chiều dài chân). Tầng mở rộng `Skill-B6/motion_runtime/` (`articulated_v1`, áp dụng cho Samurai R3 và project mới chọn opt-in) cung cấp 2-bone bent-knee IK + khóa bàn chân theo world + `b6_motion_qc.py`, trong khi `render` vẫn tuân thủ kiểm định 35 mục visual review và user approval riêng.
- **Native 9:16 vs 16:9**: B6 đạt chất lượng cao nhất ở **9:16 dọc** (lấy Eiffel V44 làm chuẩn mực chính). Chuyển sang 16:9 phải author riêng bố cục, camera và `native_layout_reason`, không crop/kéo giãn.
- **Tạo ảnh & Giọng đọc (Image / TTS)**: Chưa có callable API trực tiếp từ web app localhost sang tool tạo ảnh của Anti. Tạo ảnh qua cơ chế `asset-request.json` + `assets/inbox/`, âm thanh qua nhập WAV/M4A hoặc tổng hợp local (ví dụ macOS `say` / Windows SAPI TTS).
- **Upstream Windows Notes**: File `b6_motion_review.py` của upstream dùng `-vsync vfr` (đã bỏ ở FFmpeg 9) và `write_text()` CRLF khi lưu lịch sử lỗi `.b6-review-history/`. Xem chi tiết tại [docs/B6-SOURCE-AUDIT.md](docs/B6-SOURCE-AUDIT.md).

---

## 6. B6-04 & B6-05 (Semantic Action Validation) — Checkpoint 2026-11-18

### Đã hoàn thành & xác thực kỹ thuật
- **Editorial Runtime (`editorial_runtime/`, B6-04 + mở rộng B6-05)**:
  - Đã thêm phân tích `0.25s` buckets (`per_quarter_second`) và tách riêng chuyển động theo mask nhân vật/đạo cụ (`actor_mask_motion_mean`, `prop_mask_motion_mean`, `meaningful_action_coverage`) khỏi camera-compensated optical residual trong `editorial_runtime/b6_editorial_metrics.py` & `editorial_runtime/b6_editorial_cli.py`.
- **Semantic Runtime (`semantic_runtime/`, `b6-semantic/1`)**:
  - `b6_semantic_contract.py`: Hợp đồng semantic actions (`sneeze`, `detach`, `drop`, `bounce`, `roll`, `chase`, `avoid_obstacle`, `hide_behind`, `trip`, `reach`, `take`, `reattach`, `walk`, `collide`, `react`), kiểm tra causality / thứ tự `prerequisiteIds` và từ chối unknown action thiếu criteria.
  - `b6_semantic_evidence.py`: Đo pixel mask, `cv2.distanceTransform` contact (`actor->prop`, `actor@occluder`), occlusion thật (`occlusion_ratio`, `in_front_leak_ratio`), trajectory, decoded MP4 binding (`beauty_sha256`, `decoded_luma_std`) và ảnh debug overlay/triptych.
  - `b6_semantic_qc.py` & `b6_semantic_cli.py`: Kiểm tra độ phủ từng frame, cross-check decoded MP4 với `semantic-evidence.jsonl`, xuất `semantic_qc.json` + `semantic-report.json` (`--strict-exit`), giữ nguyên `human_visual_review: "PENDING"` & `user_approval: "PENDING"`.
- **Motion Render & Hydration Backward Compatibility**:
  - `motion_runtime/b6_motion_render.py`: Hỗ trợ opt-in `head_mount_state` (`attached|detaching|detached|reattaching`) & `capture_semantic_masks=False`, bảo toàn `legacy_v1_sha256` trong `motion_runtime/manifest.json`.
  - `scripts/hydrate-project.mjs`: Tự hydrate `semantic_v1`; xác nhận 4 project mẫu cũ (`roman-gladiator-10s`, `cowboy-hat-10s`, `samurai-red-leaf-10s`, `zombie-mirror-10s`) nguyên vẹn 100% checksum theo `BASELINE.json`.
- **Shared Schemas, Server QA Truth Hardening & Frontend UI**:
  - `app/shared/src/schemas.ts`, `qa-evidence-service.ts`, `editor-binding-service.ts`, `app.ts`, `b6-command-adapter.ts`, `job-queue.ts`, `review-service.ts`, `script-timeline-service.ts`: Siết chặt `pass === true && status === 'pass'`, kiểm tra hash/fingerprint chống stale/tamper, thêm `GET /api/projects/:id/semantic-report`, `POST /api/projects/:id/analyze-semantic`, và cập nhật UI (`PlayerStage.tsx`, `InspectorPanel.tsx`, `JobsQaView.tsx`) tách rõ `Image Residual Flow` vs `Actor mask`.
- **Project mẫu mới `workspace/projects/zombie-runaway-head-10s`** (*"The Zombie Who Lost His Head"*):
  - Tài nguyên RGBA gốc tạo bằng Antigravity `image-generator` (`pip`, `maya`, `bg_dawn_plaza_tram.png`, `prop_tram_pole.png`, `prop_orange_rail.png`, `prop_pip_head_shock.png`), âm thanh mix `audio/narration_mixed.wav` (`Daniel en_GB` + Foley), 14 phụ đề single-line Archivo Black khớp envelope lời thoại, `16` causal semantic actions, và render full `720x1280` `30fps` `10.0s` tại `workspace/projects/zombie-runaway-head-10s/outputs/preview-01/preview.mp4`.
- **Bài kiểm thử đã chạy và PASS gần nhất**:
  - Python `unittest`: `29/29` test (`motion_runtime/tests/test_motion_core.py`, `editorial_runtime/tests/test_editorial_runtime.py`, `semantic_runtime/tests/test_semantic_{contract,evidence,qc}.py`).
  - Workspace build + FE typecheck + Server Vitest: `npm run build`, `npm --workspace=app/frontend run typecheck`, `npm --workspace=app/server run test` (`21/21` passed).
  - Kiểm tra checksum 4 project baseline trong [`BASELINE.json`](docs/agent-runs/B6-LOCAL-STUDIO-05/BASELINE.json): `0` mismatches.

---

## 7. Kế hoạch thực hiện tiếp ngày mai (2026-11-19 — Continuation Checklist)

> Xem log chi tiết & tài liệu run tại [`docs/agent-runs/B6-LOCAL-STUDIO-05/README.md`](docs/agent-runs/B6-LOCAL-STUDIO-05/README.md).

1. **Xử lý nhánh Git về `master` (nếu cần hợp nhất)**:
   - Trong lúc thực hiện checkpoint, `HEAD` hiện tại ở trên nhánh `feat/short-01-original-engine-fidelity` (chứa commit baseline `9936680` của `Skill-Cartoon-Short`). Không force-push hay reset; để đưa toàn bộ phần `Skill-B6` lên `master` sạch sẽ không làm mất `Skill-Cartoon-Short`:
     ```bash
     git fetch origin
     git checkout master
     git cherry-pick <SHA_COMMIT_B6_05_TREN_NHANH_NAY>
     git push origin master
     ```
2. **Kiểm tra hậu kiểm output & review trực quan `zombie-runaway-head-10s`**:
   - Nếu `outputs/preview-01` chưa có đủ `semantic_qc.json`, `editorial_qc.json`, `motion_qc.json`, `semantic_debug/`, `outputs/review-01`: chạy lại bước collect 300-frame evidence + `b6_editorial_cli.py` + `b6_semantic_cli.py --strict-exit` + `run.py review-pack`.
   - Mở xem trực quan `outputs/preview-01/semantic_debug/{triptych_*, mask_overlay_*}.png`, `editorial-contact-sheet.jpg`, `editorial-pacing-chart.svg`, và phát kiểm âm thanh/hình `preview.mp4`.
   - Chép MP4, contact sheet 12+54 tile, `0/0.5/1s` keyframes và các báo cáo JSON QC vào `docs/agent-runs/B6-LOCAL-STUDIO-05/` (làm deliverable tự chứa, không sửa `approval-9x16.json`, giữ nguyên `human_visual_review: PENDING`).
3. **Chạy trọn bộ Release Verification + E2E Playwright + Pure Clean Clone**:
   - Chạy `cd Skill-B6 && npm run build && node scripts/verify-all.mjs --tier release --benchmark-workers --max-workers 2` (gồm cả `playwright_e2e` với screenshot vào `docs/agent-runs/B6-LOCAL-STUDIO-05/screenshots/`).
   - Mở xem trực quan toàn bộ screenshot Playwright E2E trên desktop `1440x900` và mobile `375px`.
   - Sau khi commit sạch, chạy thêm `--pure-clone` để xác nhận `cleanCloneMode=pure_committed_git_clone`, `decodedPixelsParity=true`, và checksum 4 legacy projects khớp 100%.
4. **Hoàn tất bộ báo cáo nghiệm thu `docs/agent-runs/B6-LOCAL-STUDIO-05/`**:
   - Viết đầy đủ: `SEMANTIC-EVENT-REVIEW.md`, `PACING-COMPARISON.md` (so sánh Samurai B6-03 vs Zombie-Mirror B6-04 vs Zombie-Runaway-Head B6-05), `TEST-MATRIX.md`, `QA-REPORT.md`, `BENCHMARK.md`, `CLEAN-CLONE-REPORT.md`, `OUTPUT-MANIFEST.json`, và cập nhật tổng kết `README.md`.
5. **Commit & Push cuối cùng lên `origin master`**:
   - Chỉ sau khi toàn bộ gate đạt PASS thật và người dùng/reviewer xem video thực tế, mới ghi nhận trạng thái hoàn tất cuối cùng (không tự mở khóa `renderUnlocked` trước khi có `check-review` / `approve`).

