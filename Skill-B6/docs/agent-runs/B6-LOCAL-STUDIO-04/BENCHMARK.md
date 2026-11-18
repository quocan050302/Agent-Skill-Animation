# Bounded-Parallel Verification & Determinism Benchmark (`B6-LOCAL-STUDIO-04`)

Executed via `node scripts/verify-all.mjs --tier release --benchmark-workers --max-workers 2` (log output saved in [`verify-all-summary.json`](./verify-all-summary.json) & [`verify-all.jsonl`](./verify-all.jsonl)).

## 1. Worker Pool & Determinism Summary

| Field | Measured Value |
|---|---|
| `ok` | `true` |
| `tier` | `"release"` |
| `HEAVY_LIMIT` / per-project lock | `1` heavy task concurrent + mutually exclusive `projectLock` |
| `workers=1` total wall time | `137,654 ms` (`21/21` succeeded) |
| `workers=2` total wall time | `123,434 ms` (`21/21` succeeded) |
| `speedupRatio` | `1.12x` |
| `parityOk` | `true` |
| `decodedPixelsParity` | `true` (`samurai_motion_qc_determinism` + `editorial_determinism_replay`) |
| `containerByteParity` | `true` |
| `parityClassification` | `"exact_decoded_and_container_match"` |
| `zombie-mirror-10s` Editorial Determinism Pixel SHA (`rgb24` slice) | `8f049ebe6e3b8c9d0d880f604c45d6860f0ab2a4c6b929a555fc89f52cba8d10` (`workers=1 == workers=2`) |
| `zombie-mirror-10s` Editorial Geometry + Random-Seek SHA (`[264,0,299,96,135,264]`) | `17c90d417484ba73c3bf5793b478965d92ee5c95974cf70c9b7d97517f55787a` (`randomSeekPass: true`) |
| Free Disk Guard | `12.57 GiB >= 1.50 GiB minimum` |

---

## 2. Task-by-Task Timing Breakdown (`workers=1` vs `workers=2`)

| Task ID | `workers=1` (`ms`) | `workers=2` (`ms`) | Status |
|---|---:|---:|---|
| `upstream_doctor_checkpack` | `896` | `730` | `succeeded` |
| `workspace_build` | `6,770` | `9,145` | `succeeded` |
| `hydrate_verify_existing` | `601` | `651` | `succeeded` |
| `disk_space_guard` | `1` | `1` | `succeeded` |
| `python_motion_unit_tests` | `1,003` | `984` | `succeeded` |
| `editorial_unit` | `1,353` | `1,666` | `succeeded` |
| `frontend_typecheck` | `1,826` | `3,207` | `succeeded` |
| `samurai_preflight_validate` | `659` | `767` | `succeeded` |
| `server_vitest` | `27,171` | `28,040` | `succeeded` |
| `cowboy_preflight_validate` | `864` | `838` | `succeeded` |
| `samurai_motion_qc_determinism` | `8,940` | `10,240` | `succeeded` |
| `cowboy_regression_slice` | `8,354` | `8,210` | `succeeded` |
| `roman_baseline_sandbox_replay` | `7,442` | `8,181` | `succeeded` |
| `clean_clone_hydrate_test` | `6,537` | `7,233` | `succeeded` |
| `editorial_metrics_samurai_baseline` | `5,383` | `5,609` | `succeeded` |
| `zombie_preflight_validate` | `688` | `1,053` | `succeeded` |
| `zombie_draft_smoke` | `7,178` | `7,272` | `succeeded` |
| `zombie_native_qc` | `76` | `60` | `succeeded` |
| `editorial_determinism_replay` | `8,219` | `9,906` | `succeeded` |
| `legacy_regression_roman_cowboy_samurai` | `33` | `33` | `succeeded` |
| `playwright_e2e` | `39,903` | `43,825` | `succeeded` |

---

## 3. Native Render Benchmark (`zombie-mirror-10s` Full 10.0s)

- **0.5x Draft (`360x640`, `300` frames)**: `43.14s` total (`scene_seconds: 38.01s`).
- **1.0x Native Preview (`720x1280`, `300` frames)**: `186.20s` total (`scene_seconds: 175.01s`, `validation_seconds: 7.04s`, `caption_seconds: 0.87s`, `mux_seconds: 0.16s`).
