# Agent Run Log — `B6-LOCAL-STUDIO-03`

Nhật ký thực thi và chứng cứ cho **B6-03 — MOTION & RETENTION ENGINE (`Run ID: B6-LOCAL-STUDIO-03`)** trên nhánh `master` (`D:\Project_github\Agent-Skill\Skill-B6`).

## 1. Tổng quan thay đổi kiến trúc

1. **Reusable Articulated 2D Motion Engine ([`motion_runtime/`](../../../motion_runtime/))**:
   - `b6_motion_core.py` (`771c76b4...ac81ae4`): 2-bone bent-knee planar IK, world-locked foot contact (`ContactEvent` & `resolve_foot_contacts`), pelvis drop compensation, action grammar (`idle`, `anticipate`, `walk`, `run`, `dash`, `stop`, `turn`, `react`, `recover`), counter-swing cánh tay nhường `ContactState`, đánh giá thuần `f(t)` random-seek invariant.
   - `b6_motion_render.py` (`7c38a2d3...6b8a4d5`): Compositor tuân thủ contract `Puppet.pose()` + vẽ chân 2 đoạn dưới thân áo với `validate_render_result()` pass 100%, không dùng tham số deprecated của Pillow `Image.fromarray`.
   - `b6_motion_qc.py` (`1948a05c...084aa1e7`): Kiểm định 300 frames xuất `motion_qc.json` (`b6-motion-qc/1`) đo stance drift, lún đất, sai lệch độ dài xương, góc gập gối tối đa và tiếp xúc prop.
   - `motion_runtime/manifest.json` + `motion_runtime/tests/test_motion_core.py` (**8/8 OK**, zero `DeprecationWarning`).
2. **Backend Schemas, Atomic Rollback & Motion QC Gating**:
   - [`app/shared/src/schemas.ts`](../../../app/shared/src/schemas.ts): Bổ sung schema backward-compatible cho `MotionModeSchema`, `MotionPresetSchema`, `VisualBeatKindSchema`, `CameraPresetSchema`, `GaitParamsSchema`, `ContactEventSchema`, `ShotMotionSchema`, `DirectorBeatSchema`, `motionQcStatus`.
   - [`app/server/src/services/script-timeline-service.ts`](../../../app/server/src/services/script-timeline-service.ts): Rollback journal đa file nguyên tử thật (`onBeforeCommitFile` hook kiểm chứng bằng fault-injection), bảo tồn `motionMode` / `motion` / `cameraPreset` / `visualBeat`.
   - [`app/server/src/services/qa-evidence-service.ts`](../../../app/server/src/services/qa-evidence-service.ts) & [`review-service.ts`](../../../app/server/src/services/review-service.ts): Đọc `motion_qc.json` cho dự án `articulated_v1`, trả về `motionQcStatus` (`pass | fail | stale | pending`), sinh mã `MOTION_QC_FAILED` / `MOTION_QC_STALE`, và khóa `renderUnlocked` nếu thiếu chứng cứ.
   - [`app/server/src/services/editor-binding-service.ts`](../../../app/server/src/services/editor-binding-service.ts) & [`character-binding-service.ts`](../../../app/server/src/services/character-binding-service.ts): Hàm `motion_state_at`, `director_beat_at`, `camera_director_at` trong `scene_runtime.py`; route mới `GET /api/projects/:id/motion-capability`; trạng thái `gaitStatus` phân biệt trung thực `authored_verified` (Samurai `articulated_v1`) vs `unsupported_needs_authoring` (Cowboy/Roman `legacy_stance`).
   - [`scripts/hydrate-project.mjs`](../../../scripts/hydrate-project.mjs) & [`Skill-B6/.gitattributes`](../../../.gitattributes): Hydrate `b6_motion_*.py` chỉ cho project bật `articulated_v1`, giữ nguyên hoàn toàn hai baseline `roman-gladiator-10s` và `cowboy-hat-10s`; ép `eol=lf` khi clone sạch trên Windows.
3. **Frontend Studio Binding & Diagnostic Overlay**:
   - [`app/frontend/src/App.tsx`](../../../app/frontend/src/App.tsx), [`InspectorPanel.tsx`](../../../app/frontend/src/components/InspectorPanel.tsx), [`PlayerStage.tsx`](../../../app/frontend/src/components/PlayerStage.tsx): Giữ nguyên metadata `motion` qua chu trình load/save/reload, cung cấp nút bật/tắt **Motion Overlay** đọc trực tiếp trên Stage (`shot · preset · cam · beat · cadence · stride · facing · engine`), điều khiển preset & gait ở tab `Shot`, và chọn `Camera Preset` ở tab `Camera`.

## 2. Samurai 10s Production Preview (`workspace/projects/samurai-red-leaf-10s`)

- **Tựa đề**: *"The Samurai Who Challenged a Leaf"* (`9:16`, `720x1280`, `30fps`, `10.0s`, `6` shots, `6` director beats, `8` phụ đề `Archivo Black` đơn dòng).
- **Video preview lưu trữ tự chứa**: [`samurai-preview-10s.mp4`](samurai-preview-10s.mp4) (`4,280,778` bytes, SHA-256 `436a13bdaf1b68de381db376a4e6721ebfa5755fc542479dfdb7bfc463687289`).
- **Bảng tổng hợp khung hình & Keyframe giải mã**: [`samurai-contact-sheet.jpg`](samurai-contact-sheet.jpg) + 12 PNG trong [`frames/`](frames/).
- **Motion & FFprobe Evidence**: [`evidence/samurai-motion-qc.json`](evidence/samurai-motion-qc.json), [`evidence/samurai-ffprobe.json`](evidence/samurai-ffprobe.json), [`evidence/samurai-trajectories.json`](evidence/samurai-trajectories.json), [`evidence/samurai-motion-evidence.json`](evidence/samurai-motion-evidence.json).

## 3. Tài liệu chi tiết & Bằng chứng kiểm thử

- [`QA-REPORT.md`](QA-REPORT.md) — Kết quả kiểm chứng Backend/Python/Playwright/Upstream & Gate thực tế.
- [`MOTION-RETENTION-REVIEW.md`](MOTION-RETENTION-REVIEW.md) — Chi tiết engine khớp gối 2-bone, phân tích retention 6 shot & soi từng frame giải mã (kèm ghi nhận nhược điểm trung thực).
- [`TEST-MATRIX.md`](TEST-MATRIX.md) — Ma trận phân tầng `fast | medium | release`, 16 test Vitest, 8 test Python, 3 test Playwright.
- [`BENCHMARK.md`](BENCHMARK.md) — Kết quả benchmark `workers=1` (`112,714 ms`) vs `workers=2` (`96,101 ms`, **`1.17x`**, `parityOk: true`) và breakdown render 10s Samurai (`168.9845 s`).
- [`OUTPUT-MANIFEST.json`](OUTPUT-MANIFEST.json) — Danh mục kích thước + SHA-256 toàn bộ artifact của lượt chạy B6-03.
- [`screenshots/`](screenshots/) — 7 ảnh chụp UI Playwright (1440px & 375px).
