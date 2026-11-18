# Test Matrix — `B6-LOCAL-STUDIO-03`

Ma trận kiểm chứng phân tầng (`fast`, `medium`, `release`) qua DAG điều phối [`scripts/verify-all.mjs`](../../../scripts/verify-all.mjs) cùng bộ kiểm thử đơn vị Python, REST/Service backend, Chromium E2E, clean git clone và kiểm tra read-only upstream.

## 1. Phân tầng DAG Orchestrator (`verify-all.mjs`)

| Node DAG | Tier | Điều kiện chạy | Concurrency / Lock | Bao phủ |
|---|---|---|---|---|
| `upstream_doctor_checkpack` | `fast`, `medium`, `release` | Luôn chạy | Light | `autopilot.mjs doctor --style B6`, `b6-dynamic-meme.mjs check-pack` |
| `workspace_build` | `fast`, `medium`, `release` | Luôn chạy | Light | `npm run build` (`@b6-studio/shared`, `@b6-studio/server`, `@b6-studio/frontend`) |
| `hydrate_verify_existing` | `fast`, `medium`, `release` | Luôn chạy | Light | Kiểm tra `upstream-lock.json`, `motion_runtime/manifest.json`, `--verify-only` cho tất cả project |
| `python_motion_unit_tests` | `fast`, `medium`, `release` | Luôn chạy | Light | Python `unittest -W error::DeprecationWarning` (`motion_runtime/tests/test_motion_core.py`, **8/8 OK**) |
| `frontend_typecheck` | `fast`, `medium`, `release` | Luôn chạy | Light | `tsc -b --noEmit` trên `@b6-studio/frontend` |
| `samurai_preflight_validate` | `fast`, `medium`, `release` | Luôn chạy | Per-project lock (`samurai`) | `run.py preflight` + `run.py validate` trên `samurai-red-leaf-10s` |
| `cowboy_preflight_validate` | `medium`, `release` | Từ `medium` | Per-project lock (`cowboy`) | `run.py preflight` + `run.py validate` trên `cowboy-hat-10s` |
| `clean_clone_hydrate_test` | `medium`, `release` | Từ `medium` | Isolated temp dir | `git clone --local --no-hardlinks`, kiểm tra vắng `.gitignore`, chạy `hydrate-project.mjs --all`, `--verify-only`, `run.py validate` |
| `server_vitest` | `medium`, `release` | Từ `medium` | Heavy semaphore `1` | `@b6-studio/server` (`vitest run`: **16/16 PASS**) |
| `samurai_motion_qc_determinism` | `release` | Chỉ `release` | Heavy + `samurai` lock | Sandbox `1.0s` draft render, FFmpeg `rgb24` decode SHA-256, `scene._evaluate_frame` random seek `[180, 0, 299, 90, 180]` |
| `cowboy_regression_slice` | `release` | Chỉ `release` | Heavy + `cowboy` lock | Hai slice `1.0s` (`t=2.65` & `t=5.1`) đảm bảo `legacy_stance` không hồi quy |
| `roman_baseline_sandbox_replay` | `release` | Chỉ `release` | Heavy + `roman` lock | Replay sandbox `roman-gladiator-10s` (`preflight`, `validate`, `1.5s` draft) |
| `playwright_e2e` | `medium`, `release` | Trừ `--skip-e2e` | Heavy (`B6_STUDIO_PORT=4399`) | Chromium headless `studio.spec.ts` (**3/3 PASS**) |

## 2. Chi tiết bộ kiểm thử Backend (`app/server/test/api.test.ts` — 16/16 PASS)

1–13. Toàn bộ 13 test R1/R2 về bảo mật đường dẫn, timeline validation, CLI init, CRUD/persistence, bảo vệ media gốc upstream (`b6_asset_roles`), yêu cầu `--trusted-code`, preflight lỗi rig, hủy tiến trình (`taskkill /T /F`), đánh dấu job `interrupted` khi khởi động lại, khóa `409 Conflict`, `VOICE_NEEDS_REGENERATION`, bẫy âm tính QA (fake approval, sai tỷ lệ, thiếu SHA, tampered `<35` subchecks, `DiskGuard`), và pixel MAD `> 2.5` khi sửa camera/prop trên `cowboy-hat-10s`.
14. `reverts ALL target files atomically on mid-commit fault injection without incrementing revision` — Bơm lỗi ổ đĩa giữa chừng ở tầng rollback journal trong `ScriptTimelineService`, chứng minh mọi file (`studio.meta.json`, `story.json`, `captions.json`, `formats/*.json`, `scene-control.json`) hoàn nguyên byte SHA-256 y hệt bản trước và giữ nguyên `revision`.
15. `rejects stale/failing motion_qc.json honestly and locks renderUnlocked` — Xác nhận `articulated_v1` mặc định là `pending`, `motion_qc.json` thất bại trả `motionQcStatus: 'fail'` + mã `MOTION_QC_FAILED`, và `motion_qc.json` lệch fingerprint nguồn trả `motionQcStatus: 'stale'` + `MOTION_QC_STALE`, đồng thời giữ `renderUnlocked === false`.
16. `proves UI motion.preset & gait edits on Samurai flow into real draft pixel output` — Chỉnh `motion.preset`/`endX`/`cadenceHz`/`footLift`/`cameraPreset` qua `PATCH /api/projects/:id`, render 2 đoạn draft `0.4s` (`t=2.8..3.2s`) trước/sau và xác nhận sai khác pixel giải mã FFmpeg `MAD > 2.5`.

## 3. Chi tiết Python Unit Tests (`motion_runtime/tests/test_motion_core.py` — 8/8 OK)

Chạy với `.venv\Scripts\python.exe -B -W error::DeprecationWarning -m unittest motion_runtime/tests/test_motion_core.py -v` (không dung thứ mọi `DeprecationWarning`):
- `test_two_bone_ik_preserves_lengths_and_forward_knee_polarity`
- `test_world_locked_foot_contact_zero_slip_and_zero_ground_penetration`
- `test_time_reversal_and_random_seek_determinism`
- `test_pelvis_vertical_compensation_keeps_stance_ankle_reachable`
- `test_shot_boundary_transition_keeps_continuity`
- `test_smooth_follow_camera_has_zero_unrequested_rollback`
- `test_upper_body_counter_swing_yields_to_locked_prop_arm`
- `test_validate_motion_contract_rejects_negative_mutations`
