# UI Specification — B6 Local Studio

## 1. Design Tokens & Visual Language
- **Phong cách**: Professional video production workspace — tối giản, mật độ hợp lý, tương phản rõ ràng (WCAG AA), không gradient sặc sỡ, không card KPI thừa, không animation gây xao nhãng.
- **Tokens (`app/frontend/src/styles/tokens.css`)**:
  - Background: `#F7F8FA` (`--bg`)
  - Surface: `#FFFFFF` (`--surface`), Subtle Surface: `#F1F4F8`
  - Text: `#17212F` (`--text`), Muted: `#64748B`
  - Border: `#E4E8ED` (`--border`)
  - Primary Accent: `#216B74` (`--primary`), Hover: `#18565E`
  - Semantic States: Success `#217A53`, Warning `#A86817`, Danger `#B93A36`
  - Typography: `Inter` / System UI (`14px` body, `12–13px` labels, `18–20px` headings)
  - Radii: `8px–14px`; Buttons: `>=36px` desktop, `>=44px` mobile touch targets.

## 2. Information Architecture & Layout
- **Header mỏng (56px)**: Logo `B6 Local Studio` | Dự án đang mở + Ratio + Stage badge | Nút mở Inspector (tablet) | Trạng thái Doctor (`Source OK` / `Kiểm tra môi trường`) | Help | Settings.
- **Left Navigation (`206px` desktop, `64px` tablet icon-only, bottom bar 5 mục trên mobile)**:
  - `Projects` · `Studio` · `Assets` · `Jobs & QA` + Danh sách nhanh các dự án gần đây.
- **Center Stage**:
  - Trong `Projects`: Thư viện dự án thực từ `workspace/projects/`, form tạo dự án mới (gọi B6 CLI init thật), nhân bản, xóa có xác nhận.
  - Trong `Studio`: Trình phát Video (`9:16` / `16:9` thực tế với HTTP Range scrubbing), điều khiển Play/Pause, lùi/tiến 1 frame (`1/30s`), timecode `mm:ss:ff`, âm lượng, fit-to-screen, chọn bản Draft/Preview/Film, và dải Timeline hiển thị từng Shot (`in–out`, nhân vật, hành động, biểu cảm).
  - Trong `Assets`: Kéo/thả & upload PNG/JPEG/WAV/M4A theo role, sinh prompt khóa chuẩn B6 (`asset-request.json`), quét & nhập tệp từ `assets/inbox/`, tách rõ badge `PRODUCTION ASSET` và `REFERENCE ONLY`.
  - Trong `Jobs & QA`: Bảng 3 trạng thái QA tách biệt (Technical / Visual Review 35 mục / User Approval), danh sách jobs với tiến độ frame thật, live log stdout/stderr, nút Hủy job, kết quả FFprobe.
- **Right Inspector (`336px` desktop, slide-over drawer trên tablet/mobile)**:
  - 5 tabs ngữ cảnh: `Story | Shot | Camera | Character | Export`.
  - Toolbar lưu tức thời trên đầu Inspector: badge `Đã lưu / Đang lưu / Chưa lưu / Lỗi lưu`, nút `Hoàn tác` (Undo), nút `Lưu (Ctrl+S)`.
- **Bottom Jobs Drawer (có thể thu gọn/mở rộng)**:
  - Thanh trạng thái `aria-live="polite"` hiển thị job đang chạy, frame counter `checkedFrame/totalFrames`, thời gian chạy, nút Hủy và bảng log trực tiếp.

## 3. Responsive Rules (320px – 1440px)
- `>= 1200px`: 3 cột (`206px` sidebar + center + `336px` inspector).
- `768px – 1199px`: Sidebar thu gọn `64px`; Inspector mở dạng drawer bên phải khi bấm nút.
- `320px – 767px`: Thanh điều hướng cố định dưới đáy (`56px`, 5 nút: `Dự án | Studio | Chỉnh sửa | Ảnh | Jobs`), nút chạm tối thiểu `44px`, zero horizontal overflow (`scrollWidth <= innerWidth`).

## 4. User Editability Guarantees
- Tất cả input/textarea không bị che bởi overlay hoặc `pointer-events: none` / `readOnly` ngầm.
- Autosave debounce `700ms` + phím tắt `Ctrl/Cmd + S` + Undo stack local + lưu trực tiếp xuống JSON atomic trên ổ đĩa (`studio.meta.json`, `story.json`, `captions.json`, `formats/*.json`).
- Validation lỗi hiển thị inline cảnh báo ngay dưới thanh trạng thái lưu, **không bao giờ xóa dữ liệu người dùng đang nhập**.
