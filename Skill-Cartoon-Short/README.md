# Skill-Cartoon-Short — Cartoon Short Studio (2D + 3D, 9:16, 30 FPS)

Faithful local reproduction, safety hardening, **Compact Dark Studio UI (React + TypeScript + Vite)**, **Gemini TTS / Imported Voiceover**, **Cartoon Subtitles (`cartoon_subs.py`)**, and **Verified Render & QA Pipeline** for the **9:16 (`1080 × 1920`, `30 FPS`) Cartoon Short Renderer** (2D bean-head `Pen` character cards inside a painted, inked, depth-of-field Three.js `r160` 3D world).

## Licensing & Public Repository Gate (`G03: BLOCKED`)

`Agent-Skill-Animation` is a **public** GitHub repository. Because the supplied `cartoon-short-kit.zip` does not include a `LICENSE` file or explicit public redistribution authorization:
- The unaltered source snapshot (`vendor/cartoon-short-kit/`) and hydrated copies (`engine/web/*`, `workspace/projects/soldier-baseline/*`, local generated audio/MP4 outputs) are **preserved locally for full testing** and excluded from Git commits via `.gitignore`.
- Only independently authored adapters, Studio frontend/backend, TTS integration (MIT provenance from `quocan050302/out-of-step-studio`), tools, tests, original story modules (`workspace/projects/zombie-supermarket-10s/src/`, `workspace/projects/ghost-army-ww2-30s/src/`), and technical documentation are tracked in Git.
- Upstream dependencies `three@0.160.0` (MIT) and `mromidev/claude-animated-shorts` (`e3b817b6afc6cd413466d43f11ba31209e034bbf`, MIT) are pinned and verified by SHA-256.

## Quick Start (Clean Clone + Local `cartoon-short-kit.zip`)

```bash
cd Skill-Cartoon-Short
cp .env.example .env          # Optional: add GEMINI_API_KEY locally (never commit .env)
npm ci
CARTOON_SHORT_KIT_ZIP=/path/to/cartoon-short-kit.zip npm run setup
npm run build
```

### Launch Cartoon Short Studio (Production Loopback Server)

```bash
npm run studio
# Studio UI:      http://127.0.0.1:4319/
# Legacy Viewer:  http://127.0.0.1:4319/legacy
```

### Development Mode (API + Vite HMR Proxy on Loopback)

```bash
# Terminal 1: Loopback API server (127.0.0.1:4319)
npm run dev:api

# Terminal 2: Vite React+TS dev server (127.0.0.1:5173 -> proxies /api, /engine, /legacy)
npm run dev
```

### Run Verification Suites

```bash
npm test                 # Bounded async dependency-aware DAG (build, unit, integration, determinism, regression, E2E)
npm run test:unit        # Unit tests (motion, contract, Gemini TTS classification/WAV/quota, subtitles, QA gates)
npm run test:integration # Renderer adapter, linear -6 dB mixer, Studio API security/TTS/import/SUB ON-OFF/jobs
npm run test:regression  # Cross-session determinism, vendor snapshot backtest, 12 negative tests
npm run test:e2e         # Legacy /legacy viewer + Dark Studio UI E2E across 1440/768/390/320 viewports
npm run qa               # 17-gate truthfulness verifier (G01–G17)
```

### Render Frames via Controlled CLI / Adapter

```bash
# Original Soldier baseline (frames 0..591)
npm run render -- workspace/projects/soldier-baseline/frames 0-591 1 0.94 --project soldier-baseline

# 10-Second Supermarket Zombie proof (frames 0..299)
npm run render -- workspace/projects/zombie-supermarket-10s/frames 0-299 1 0.94 --project zombie-supermarket-10s

# NEW 30-Second Ghost Army Demo ("The Fake Army That Fooled the Nazis", frames 0..899)
npm run render -- workspace/projects/ghost-army-ww2-30s/frames 0-899 1 0.94 --project ghost-army-ww2-30s
```

## Five-Step Studio Workflow (`http://127.0.0.1:4319/`)

1. **1. Script & Voice** — Edit narration script, choose **Gemini TTS** (`Kore` default, `Charon`, `Puck`, `Aoede`, `Zephyr`, voice sample preview & per-project isolated WAV) or **Import Audio** (WAV/MP3/M4A magic-sniffed, FFprobe-checked, normalized to 48 kHz stereo WAV).
2. **2. Video Settings** — Native `9:16` (`1080×1920`) enabled; `1:1` and `16:9` explicitly disabled with truthful capability notes until recomposition & QA are built. Toggle Cartoon Subtitles `ON / OFF` (`tools/subtitles/cartoon_subs.py`), `punchWords`, and safe-zone guide.
3. **3. Timing & Preview** — Run FFprobe + `tools/timing/timing_validator.py`, inspect real duration & honest alignment label (`exact-whisper-asr` vs `UNVERIFIED_WORD_SYNC`), click shots to seek real Three.js 3D frames with live timed subtitle preview.
4. **4. Render & Mix** — Single `Render Video` CTA with live SSE finite-state progress (`QUEUED -> PREPARING -> VALIDATING_INPUT -> GENERATING_TTS -> PROBING_AUDIO -> ALIGNING -> RENDERING_FRAMES -> MIXING -> MUXING -> SUBTITLES -> VERIFYING -> COMPLETED`), double-submit protection (`409`), cancel & retry.
5. **5. QA & Export** — Verified MP4 codecs/duration/loudness, Q06–Q18 evidence table, story & subtitle contact sheets, playable verified `<video>` player, and download link.

## Key Documentation

- [docs/agent-runs/QA-TTS-01-20261119T153500Z/README.md](./docs/agent-runs/QA-TTS-01-20261119T153500Z/README.md) — Full QA-TTS-01 run reports, evidence, screenshots, and Ghost Army 30s dossier
- [docs/SOURCE_AUDIT.md](./docs/SOURCE_AUDIT.md) — Original SHORT-01 forensic inventory & SHA-256 manifest
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 4-pass WebGL pipeline, character cards, timing, linear `-6 dB` audio mixer
