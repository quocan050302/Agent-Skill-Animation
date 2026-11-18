# Motion & Retention Review — `B6-LOCAL-STUDIO-03` (`samurai-red-leaf-10s`)

Đánh giá kiến trúc chuyển động khớp nối 2D (`Skill-B6/motion_runtime/`), đạo diễn camera có chủ đích và kiểm tra từng khung hình giải mã thực tế của phim **Samurai 10s** (`"The Samurai Who Challenged a Leaf"`).

---

## 1. Kiến trúc `motion_runtime/` (Re-usable Across Any Story)

1. **`b6_motion_core.py` (`b6-motion-frame/1`)**:
   - Giải **2-bone planar knee IK** với bảo toàn chiều dài đùi/cẳng chân (`upper_len`, `lower_len`, sai số thực tế **`0.0`**) và ép đúng chiều gập gối hướng mặt (`knee_forward_ok: true`).
   - **World-locked foot contact (`ContactEvent`)**: Khóa tọa độ bàn chân trụ (`plant_world`) suốt pha chạm đất so với camera di chuyển, hạ hông bù lực (`pelvis_drop`, `root_y`) giúp chân trụ không bị rướn trượt và đạt **`max_stance_drift_world = 0.0 px`** & **`max_ground_penetration_world = 0.0 px`**.
   - **Action Grammar tái sử dụng**: Hỗ trợ preset `none`, `idle`, `anticipate`, `walk`, `run`, `dash`, `stop`, `turn`, `react`, `recover`, bù đắp pha lăng cánh tay ngược nhịp hông nhưng **nhường quyền điều khiển** cho `ContactState` / tay cầm vũ khí.
   - **Pure stateless evaluation `f(t)`**: Mọi truy vấn tại frame `t` đều là hàm thuần của `t` và spec — kiểm chứng random-seek `[180, 0, 299, 90, 180]` khớp tuyệt đối.
2. **`b6_motion_render.py`**:
   - Vẽ nhân vật tuân thủ hợp đồng lớp của B6 (`b6_puppet.py`), chạy qua `Puppet.pose()` kiểm tra tay áo (`cuff`), `neck_attachment`, tỷ lệ hiển thị và vẽ đè cụm chân 2 đoạn có khớp gối + bàn chân bám đất từ phía dưới thân áo hakama, trả đúng `RenderResult` tương thích `validate_render_result()`.
3. **`b6_motion_qc.py` (`b6-motion-qc/1`)**:
   - Đọc chuỗi evidence 300 khung hình, kiểm tra cứng ngưỡng trượt chân trụ (`<= 0.75 px`), lún đất (`<= 0.5 px`), sai lệch độ dài xương (`<= 3.5%`), độ gập gối tối đa (`<= 136°`), biến thiên gập gối khi di chuyển (`>= 7.5°` & `>= 2.5 px`), bước nhảy không khai báo (`<= 48 px`), và tiếp xúc prop (`<= 0.75 px`).

---

## 2. Cấu trúc Nhịp Retention 10 Giây — `samurai-red-leaf-10s`

- **Hook (`0.00–0.80s` · `shot_01_hook`, `react`, `reaction_closeup`)**: Lá phong đỏ lao sượt qua mặt ngay ở `0.15–0.50s` kích hoạt `head-surprised` — vào xung đột hài dưới `1.0s`.
- **Coiling & Draw (`0.80–2.15s` · `shot_02_anticipate`, `anticipate`, `object_insert`)**: Ren gập gối sâu hạ trọng tâm vào thế nhún, rút thanh katana dựng mũi sắc nét với ánh mắt quyết đấu (`head-focused`).
- **Dash Pursuit (`2.15–4.45s` · `shot_03_dash`, `dash`, `follow`)**: Tăng tốc sang phải across sân đền mùa thu (`root_x: 250 -> ~675`), **59 khung hình locomotion** luân phiên 2 chân trụ `left` / `right` với góc gập gối đạt tới **`131.66°`** (`max_locomotion_knee_deviation_px = 64.26 px`) đồng bộ từng tiếng bước chân Foley + parallax đèn đá tiền cảnh.
- **Lunge Whiff (`4.45–6.55s` · `shot_04_slash_miss`, `stop`, `impact`)**: Phanh gấp và chém mạnh xuống trước nhưng luồng gió kiếm lại hất chiếc lá bay vọt lên cao một cách vô lý (`head-surprised`, `max_prop_contact_error_px = 1.27e-13 px`).
- **Nose Tap Punchline (`6.55–8.15s` · `shot_05_leaf_nose`, `turn`, `reaction_closeup`)**: Chuyển cảnh cận phản ứng khi chiếc lá nhẹ nhàng rơi thẳng xuống sống mũi Ren.
- **Deadpan Defeat Hold (`8.15–10.00s` · `shot_06_deadpan`, `recover`, `settle`)**: Góc máy mở nhẹ lấy trọn dáng đứng thua cuộc lặng thinh (`head-deadpan`), hạ kiếm khi chiếc lá chậm rãi bay lướt đi (*"The leaf won without a fight."*).

---

## 3. Soi trực tiếp các Frame giải mã (`frames/samurai_*.png` & `samurai-contact-sheet.jpg`)

Đã mở kiểm tra trực quan toàn bộ **12 PNG** được trích từ [`samurai-preview-10s.mp4`](samurai-preview-10s.mp4) và bảng tổng hợp [`samurai-contact-sheet.jpg`](samurai-contact-sheet.jpg):

- **Điểm đạt rõ rệt**:
  - Biểu cảm khuôn mặt thay đổi sắc nét, dễ đọc trên 9:16 dọc (`head` -> `head-surprised` -> `head-focused` -> `head-surprised` -> `head-deadpan`).
  - Tại `t=2.70s`, `3.30s`, `4.20s` (`shot_03_dash`), chuyển động 2 đoạn đùi–cẳng chân cho thấy rõ góc gập đầu gối hướng trước, chân trụ đặt phẳng trên mặt đường và chân sau đẩy gót tự nhiên thay cho chân thẳng cứng `legacy_stance`.
  - Tại `t=8.40s` (`samurai_08_40s.png`), lá phong đậu gọn trên sống mũi tạo nhịp hài hước rõ ràng ngay phía trên phụ đề `"without a fight."`.
  - Phụ đề `Archivo Black` 1 dòng đơn (`baseline: 914`, raster `[75..642, 873..931]`) tương phản tốt, không che khuôn mặt hay bàn chân nhân vật.
- **Nhược điểm hình ảnh còn tồn tại (ghi nhận trung thực để hoàn thiện mỹ thuật nếu chỉnh sửa tiếp)**:
  1. Ở `samurai_01_40s.png` (`t=1.40s`, rút kiếm đứng dọc) và `samurai_04_20s.png` (`t=4.20s`), đầu mũi katana hơi chạm nhẹ phần má trái khuôn mặt khi camera đẩy gần.
  2. Do nền `samurai_courtyard_bg.png` có bậc thềm hiên đền nâng nhẹ về phía bên phải, khi Ren chạy đến vùng `x ~ 675` (`t=4.95–9.70s`), đường viền sàn hiên hậu cảnh nằm ngang qua khoảng cẳng chân dù `ground_y` vật lý vẫn giữ thẳng `0.0`.
  3. Chưa có bóng mờ riêng động trên mặt đất tách biệt rõ nhân vật với vệt sàn đền phía sau khi đứng xa (`t=6–10s`).

---

## 4. Ranh giới Sự thật QA (Không suy diễn kết quả sáng tạo)

- **Technical Preview & Motion QC**: **PASS** (`report.json` `technical_status: "pass"`, `motion_qc.json` `status: "pass"`, `0` lỗi drift/lún đất/xương).
- **Visual Motion Review (35 mục)**: **PENDING (`Pass: 0/35 · Pending: 35`)** — `outputs/review-01/motion-review.json` và `index.html` đã sẵn sàng cho người dùng nghe/xem playback 1x thực tế.
- **User Approval & Full Export**: **PENDING (`EXPORT ĐANG KHÓA`)** — Không có `approval-9x16.json`, tuyệt đối không giả lập hay ngoại suy độ giữ chân người xem thực tế.
