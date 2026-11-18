# Benchmark Report — `B6-LOCAL-STUDIO-03`

Đo đạc thực tế trên cùng một máy Windows (`12th Gen Intel Core i5-12400`, `Node v26.13.1`, `Python 3.12.10` `.venv`, `FFmpeg 9.0.2`) với bộ kiểm chứng DAG song song có giới hạn [`scripts/verify-all.mjs`](../../../scripts/verify-all.mjs) và lệnh benchmark:

```powershell
cd D:\Project_github\Agent-Skill\Skill-B6
node scripts/verify-all.mjs --benchmark-workers --max-workers 2
```

> Nguồn số liệu nguyên bản: [`verify-all-summary.json`](verify-all-summary.json) và [`verify-all.jsonl`](verify-all.jsonl) (`generatedAt: 2026-11-18T09:12:10.929Z`).

## 1. So sánh Worker Concurrency (`workers=1` vs `workers=2`)

| Chỉ số | `workers=1` | `workers=2` (`heavyRenderSemaphore=1`) | Chênh lệch / Ghi chú |
|---|---|---|---|
| **Overall Verdict (`ok`)** | `true` | `true` | Toàn bộ 13/13 DAG nodes exit `0` |
| **Tổng thời gian (`wallMs`)** | **`112,714 ms`** (`112.71 s`) | **`96,101 ms`** (`96.10 s`) | Giảm `16,613 ms` (**`speedupRatio: 1.17x`**) |
| **Peak Orchestrator RSS** | `78 MiB` | `80 MiB` | Trong giới hạn ngân sách RAM |
| **Decoded Pixels Parity** | Khớp 100% | Khớp 100% | `e969af65...00319610` (`decodedPixelsParity: true`) |
| **Container Byte Parity** | Khớp 100% | Khớp 100% | `96aab290...7fd30d3a39` (`containerByteParity: true`) |
| **Geometry & Random Seek Parity** | `b9895fe0...1f2436bb` | `b9895fe0...1f2436bb` | `randomSeekPass: true` (`[180, 0, 299, 90, 180]`) |
| **Parity Classification** | `exact_decoded_and_container_match` | `exact_decoded_and_container_match` | `parityOk: true` |

## 2. Thời gian thực thi từng node DAG

| Task ID | Heavy Lock | `workers=1` (ms) | `workers=2` (ms) | Exit |
|---|---|---:|---:|---:|
| `upstream_doctor_checkpack` | No | `940` | `967` | `0` |
| `workspace_build` | No | `7,663` | `7,886` | `0` |
| `hydrate_verify_existing` | No | `700` | `750` | `0` |
| `python_motion_unit_tests` | No | `1,438` | `1,581` | `0` |
| `frontend_typecheck` | No | `2,151` | `2,170` | `0` |
| `samurai_preflight_validate` | No (`samurai` lock) | `932` | `920` | `0` |
| `cowboy_preflight_validate` | No (`cowboy` lock) | `880` | `961` | `0` |
| `samurai_motion_qc_determinism` | Yes (`samurai` lock) | `10,509` | `10,530` | `0` |
| `clean_clone_hydrate_test` | No | `6,678` | `6,396` | `0` |
| `server_vitest` | Yes (`vitest-sandbox`) | `26,207` | `24,213` | `0` |
| `cowboy_regression_slice` | Yes (`cowboy` lock) | `12,941` | `12,330` | `0` |
| `roman_baseline_sandbox_replay` | Yes (`roman` lock) | `10,813` | `11,429` | `0` |
| `playwright_e2e` | Yes (E2E server) | `28,586` | `30,187` | `0` |

## 3. Native 10s Preview Render Timing (`samurai-red-leaf-10s`)

Trích xuất từ `workspace/projects/samurai-red-leaf-10s/outputs/preview-01/report.json`:
- **Tổng thời gian (`timings.total_seconds`)**: **`168.9845 s`**
- `load_seconds`: `0.6818 s`
- `setup_seconds`: `0.2408 s`
- `scene_seconds` (300 frames x 720x1280 + `b6_motion_render` + `b6_motion_qc` audit): `157.0989 s` (~`0.524 s / frame`)
- `validation_seconds`: `6.5329 s`
- `caption_seconds` (3x Lanczos `Archivo Black` 47px): `1.7315 s`
- `encoder_write_seconds`: `0.6690 s`
- `mux_seconds` (H.264 + AAC 44.1kHz): `0.3114 s`
