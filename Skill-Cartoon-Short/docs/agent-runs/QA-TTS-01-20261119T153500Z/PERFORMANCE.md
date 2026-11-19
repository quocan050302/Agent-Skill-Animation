# QA-TTS-01 Performance, Async Parallelism & Resource Benchmark

- **Host**: macOS `darwin-arm64`, 8 CPU cores, 16 GiB RAM, Apple M1 Pro WebGL 2.0 (ANGLE Metal), ~14.9–17.9 GiB free disk.
- **Optimization Guarantee**: Every async and parallel optimization preserves **bit-for-bit identical visual output** (`900/900` frame SHA-256 hashes + final MP4 SHA-256 identical to 1-worker serial render) and enforces hard bounded concurrency caps so Chromium GPU memory and disk I/O never thrash.

## 1. 900-Frame Ghost Army Render (`1080×1920`, 30s) — Serial vs Accelerated Async Pipeline

| Metric | Serial Baseline (`job-mwnqyc93-689379`) | Accelerated Parallel (`job-mwnrkwkn-1eff0c`) | Delta / Speedup |
|---|---:|---:|---|
| **WebGL Worker Pages** | `1` (sequential) | `2` (bounded contiguous chunks + async disk writes) | Bounded `<= 2` |
| **900-Frame Render Time** | `23,099 ms` | **`14,181 ms`** | **`1.63×` faster (`-8.92 s`)** |
| **Per-Frame Latency / Throughput** | `25.67 ms/f` (`38.96 FPS`) | **`15.76 ms/f` (`63.46 FPS`)** | **`+62.9%` throughput** |
| **Audio Mastering (`audio_stems.py` + `mix.py`) & ASS Prep** | Sequential after frames (`~2.5 s`) | **Overlapped via `Promise.all` during WebGL render** | **`0 ms` added wall time** |
| **FFmpeg Mux (`muxFramesAndAudioAsync`)** | Blocking `execFileSync` (could drop keep-alive polls) | **Non-blocking async subprocess** (`16.5 s` for 900f H.264 CRF 18) | **`0` poll errors across `123` HTTP polls** |
| **Subtitle Burn-In (`cartoon_subs.py`, `-c:a copy`)** | `~14.6 s` (libass H.264 re-encode) | `14,569 ms` (async non-blocking) | Event loop responsive |
| **Post-Render QA (`VERIFYING`)** | Sequential FFprobe + 2 sheets + 20 FFmpeg grabs | **Concurrent `Promise.all` (`probeMp4Async` + contact sheet + 4-way FFmpeg pool + batched NumPy diff)** | **`2,820 ms` total** |
| **End-to-End 30s Pipeline Wall Time** | `~60+ s` | **`49,923 ms`** (complete render -> mix -> mux -> sub burn -> QA -> publish) | Fast & non-blocking |
| **Peak Node Process RSS** | `~195 MB` | **`217.28 MB`** | Well under safety budget |
| **Bit-Exact Frame Parity (`0..899`)** | Reference | **`900 / 900` SHA-256 identical (`0` mismatches)** | **100% lossless** |
| **Final `sub-on.mp4` SHA-256** | `1a4caf25...d15711e7` (`16,440,125` B) | **`1a4caf25...d15711e7` (`16,440,125` B)** | **Bit-for-bit identical MP4** |

## 2. Bounded Async Test DAG (`npm test` — `tests/run-dag.mjs`)

Resource-aware concurrency policy: `lightConcurrency = 4`, `maxWebglWorkers = 2` (total memory-aware on macOS `16,384 MB` / `8` cores; avoids false throttling from `os.freemem()` inactive page cache).

| Stage | Parallel Nodes Executed | Individual Node Durations | Stage Critical Path |
|---|---|---|---:|
| **Stage 1** (`lightConcurrency = 4`) | `source-audit` (`16ms`), `hash-verification` (`16ms`), `dependency-checks` (`360ms`), `unit-source-motion` (`484ms`), `frontend-typecheck-build` (`3,162ms`), `unit-tts-studio` (`8,979ms`) | Sum: `13,017 ms` | `~9.0 s` |
| **Stage 2** (Barrier) | `engine-setup` (hydrates Soldier, Zombie 10s, Ghost Army 30s) | `124 ms` | `0.12 s` |
| **Stage 3** (`webglWorkers = 2`) | `integration-pipeline` (`3,304ms`) \|\| `integration-studio-api` (`9,282ms`) | Sum: `12,586 ms` | `~9.3 s` |
| **Stage 4** (`webglWorkers = 2`) | `ghost-army-parallel-parity` (`937ms`, 10f serial vs parallel) \|\| `regression-backtest-negative` (`6,660ms`, 12 failure modes) | Sum: `7,597 ms` | `~6.7 s` |
| **Stage 5** (`webglWorkers = 2`) | `e2e-legacy-viewer` (`3,205ms`) \|\| `e2e-studio-ui` (`6,382ms`, 4 responsive viewports) | Sum: `9,587 ms` | `~6.4 s` |
| **Total (`13/13 PASS`)** | **Sequential sum: `42,911 ms`** -> **Parallel DAG wall clock: `33,956 ms`** | **`1.26×` DAG speedup** | **`33.96 s`** |

## 3. Disk & Memory Headroom

- **Free Disk Before / During / After**: `17,387 MB` baseline -> `14,870 MB` during peak multi-job run -> `17,923 MB` post-run (`> 14×` above the `1,024 MB` `JobManager` preflight guard).
- **Zero Orphan Processes**: Every `ShortRendererSession`, Playwright Chromium instance, FFmpeg subprocess, and loopback HTTP server terminates deterministically in `try/finally` blocks.
