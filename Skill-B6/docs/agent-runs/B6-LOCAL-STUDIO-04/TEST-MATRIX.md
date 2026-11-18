# Verification & Test Matrix — `B6-LOCAL-STUDIO-04`

All automated checks below were executed after final source and scene edits via [`scripts/verify-all.mjs`](../../../scripts/verify-all.mjs) (`--tier release --benchmark-workers --max-workers 2`, exit code `0`).

## 1. Suite Summary

| Suite / Layer | Executor | Count / Scope | Result | Source Anchor |
|---|---|---:|---|---|
| Editorial Python Unit & Negative/Gaming Tests | `.venv/bin/python3 -m unittest` (`-W error::DeprecationWarning`) | `6` tests (compilation guards, random-seek determinism, strobe/camera-shake/empty-microcut gaming rejection, intentional hold carveout, tamper/missing QC fail-closed, deterministic auto-propose) | **PASS (`6/6`)** | [`editorial_runtime/tests/test_editorial_runtime.py`](../../../editorial_runtime/tests/test_editorial_runtime.py) |
| Motion Core Python Unit & Fault Tests | `.venv/bin/python3 -m unittest` | `8` tests (2-bone IK, stance world-lock, forward knees, counterfactual fault rejection) | **PASS (`8/8`)** | [`motion_runtime/tests/test_motion_core.py`](../../../motion_runtime/tests/test_motion_core.py) |
| Fastify Server + Editorial/QA Integration Tests | `vitest` (`--workspace=app/server`) | `19` tests (`15` B6-03 baseline/binding/atomic-rollback/tamper + `4` B6-04 `editorial_v1` schema/repetition/tamper/UI-pixel/job tests) | **PASS (`19/19`)** | [`app/server/test/api.test.ts`](../../../app/server/test/api.test.ts) |
| Frontend TypeScript + Vite Build | `tsc -b` + `vite build` | Shared + Server + Frontend packages | **PASS** | [`app/frontend/package.json`](../../../app/frontend/package.json) |
| Playwright Chromium E2E Tests | `playwright test` (`Chromium v1255`, `B6_STUDIO_PORT=4399`) | `4` specs (320/375/768/1024/1440 responsive overflow, project create/save/asset/Cowboy check, Samurai articulated controls, **Zombie Editorial Studio + `Jobs & QA` diagnostics + `375px` mobile + persistence round-trip**) | **PASS (`4/4`)** | [`app/frontend/e2e/studio.spec.ts`](../../../app/frontend/e2e/studio.spec.ts) |
| Legacy Baseline Regression & Replay | `verify-all.mjs` | Sandbox draft replays (`roman-gladiator-10s`, `cowboy-hat-10s`, `samurai-red-leaf-10s`) + SHA-256 verification vs [`baselines/legacy-project-hashes.json`](./baselines/legacy-project-hashes.json) | **PASS (`exact_match`)** | [`scripts/verify-all.mjs`](../../../scripts/verify-all.mjs) |
| Samurai Baseline Negative Editorial Proof | `b6_editorial_cli.py` vs `samurai-preview-10s.mp4` | Asserts `editorial_qc.status === "fail"` (`EDITORIAL_EXCESSIVE_DUPLICATE_SHOTS`, `unique_compositions: 3`) | **PASS** | [`baselines/samurai-editorial-qc.json`](./baselines/samurai-editorial-qc.json) |
| Zombie Native Preview + Determinism Replay | `verify-all.mjs` + `FFmpeg rawvideo` + random-seek sweep | `720x1280` `30fps` `AAC`, `motion_qc: pass`, `editorial_qc: pass`, out-of-order `[264, 0, 299, 96, 135, 264]` determinism + `workers=1` vs `workers=2` parity | **PASS (`exact_decoded_and_container_match`)** | [`evidence/zombie-editorial-qc.json`](./evidence/zombie-editorial-qc.json) |
| Clean-Clone Hydration Test | `git clone --local` + `hydrate-project.mjs --all --verify-only` | Verifies `.gitignored` `engine/`/`fonts/` absent pre-hydrate, hydrates + validates Cowboy, Samurai & Zombie cleanly | **PASS** | [`scripts/hydrate-project.mjs`](../../../scripts/hydrate-project.mjs) |

---

## 2. Negative, Anti-Gaming & Fault-Injection Coverage

1. **Pixel MAD Gaming Fixtures (`test_negative_gaming_fixtures_all_flagged_and_fail_qc`)**:
   - Rapid empty hard-cuts (`30+` cuts across flat visual content): rejected (`EXCESSIVE_MICRO_CUTS` / `TOO_SIMILAR_CONSECUTIVE_SHOTS`).
   - Full-frame strobe flashing (`luminance` alternation with zero subject novelty): flagged as `gaming_detected` -> `editorial_qc: fail`.
   - Constant camera shake on frozen scene (`high_pixel_low_semantics` / `camera_global_motion` dominates `foreground_relative_motion`): flagged & rejected (`editorial_qc: fail`).
2. **Intentional Reaction Hold Protection (`test_intentional_reaction_hold_allowed_and_real_motion_clean`)**:
   - Verifies short calm beats explicitly annotated (`hold_payoff` / `reaction_hold_s > 0`) are **NOT** penalized like unmotivated 4-second dead air.
3. **API & File Integrity Guards (`api.test.ts`, `test_editorial_qc_fails_closed...`)**:
   - Path traversal (`../`), null bytes, corrupt JSON, missing `editorial_qc.json`, tampered `editorial_report_sha256`, `source_fingerprint` mismatch, and fake `"pass"` reports all fail closed and keep `renderUnlocked: false`.
   - `analyze-editorial` queue cancellation sets `outputDir: null` in `b6-command-adapter.ts`, ensuring cancelled editorial jobs never erase rendered `outputs/preview-01/`.
   - Atomic mid-commit write failure rolls back all target files (`project.json`, `story.json`, `formats/portrait.json`, `scene-control.json`) cleanly without incrementing `revision`.
   - `409 Conflict` revision lock enforced (and fixed in `App.tsx` where `expectedRevisionRef` raced secondary bundle fetches).
