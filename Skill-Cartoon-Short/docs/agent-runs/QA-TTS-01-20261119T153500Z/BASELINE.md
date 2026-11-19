# QA-TTS-01 Baseline & Git Forensics

- **Run ID**: `QA-TTS-01-20261119T153500Z`
- **Date (UTC)**: `2026-11-19T15:35:00Z`
- **Repository (Canonical Origin)**: `https://github.com/quocan050302/Agent-Skill-Animation.git`
- **Forbidden Repository Guard**: `https://github.com/quocan050302/Skill-Stick-Animation.git` — **NOT TOUCHED / ZERO WRITES**
- **Primary Repository Root**: `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation`
- **Active Working Tree**: Direct `QA` branch inside primary repository root (initially bootstrapped cleanly in an isolated sibling worktree, then moved directly onto `QA` inside `Agent-Skill-Animation` per explicit user confirmation after verifying 0 dirty files on `feat/short-01-original-engine-fidelity`)
- **Source Branch**: `origin/feat/short-01-original-engine-fidelity`
- **Source Branch Verified HEAD SHA**: `c67dbd785c08edb4d824f8036588ce2294b627fe`
- **Target Deployment Branch**: `QA` (newly branched cleanly from `origin/feat/short-01-original-engine-fidelity`; `origin/QA` did not exist prior to this run)
- **Allowed Modification Scope**: `Skill-Cartoon-Short/**` ONLY

## Repository Structure & Isolation Verification

- Both `Skill-B6/` and `Skill-Cartoon-Short/` verified present at repository root.
- `Skill-B6/` baseline Git tree SHA-256 (`git ls-tree -r HEAD -- Skill-B6 | shasum -a 256`):
  `f27f501f23c8c927a5ccf50f9bd6dcd63d90bc0e9fa01649fc73f7a508eea4ed`
- `git status --short` in primary worktree before starting: **clean (0 dirty files)**
- `git status --short` in isolated `QA` worktree after `npm ci` + `npm run setup`: **clean (0 modified/untracked files)**

## Host Environment & Tool Versions

- **OS / Arch**: `darwin-arm64` (8 CPU cores, 16 GB RAM)
- **Available Disk Space (at baseline)**: `17,387 MB` (~17.0 GiB)
- **Node.js**: `v22.22.3`
- **npm**: `10.9.8`
- **Python**: `3.13.0` (`numpy`, `PIL`/Pillow installed)
- **FFmpeg**: `6.0` (verified `libass` / `ass` filter compiled in)
- **FFprobe**: `4.4-tessus`
- **Playwright / Chromium**: `playwright@1.65.1`, `three@0.160.0`

## Original Engine Kit & Credentials Preflight

- **Local Unlicensed Kit (`vendor/cartoon-short-kit/`)**: Present locally (copied from primary worktree into isolated gitignored path), `14/14` SHA-256 entries matched `vendor/source-manifest.json`. Public redistribution gate `G03` remains **BLOCKED** and excluded via `.gitignore`.
- **Pinned Upstream (`mromidev/claude-animated-shorts`)**: Cached locally at commit `e3b817b6afc6cd413466d43f11ba31209e034bbf` (MIT License verified).
- **Hydration Baseline (`npm run setup`)**: `ok: true`, `kitVerifiedCount: 14`, `zombieHydrated: true`.
- **`GEMINI_API_KEY` Environment Variable**: **ABSENT** (`BLOCKED` for live Gemini TTS synthesis; zero keys copied from `out-of-step-studio` or any other machine folder).
- **User-Supplied Real English Ghost Army Voiceover**: Present at conversation upload path (`uploaded_media_1795095152372.wav`, `pcm_s16le`, `24000 Hz`, mono, `35.20s` total / `34.65s` last spoken word, `1,689,672` bytes). Usable via real **Import Audio** pipeline with documented pitch-preserving tempo calibration to fit exact `30.00s / 900` frames without truncating any spoken word.

## Baseline Test Suite Results (Before Any QA-TTS-01 Changes)

| Suite | Command | Result | Duration | Notes |
|---|---|---|---|---|
| Unit | `npm run test:unit` | **PASS** (6/6) | 343 ms | `tests/unit/source-and-motion.test.mjs` |
| Integration | `npm run test:integration` | **PASS** (2/2) | 2,278 ms | `tests/integration/pipeline.test.mjs` |
| E2E Legacy Viewer | `npm run test:e2e` | **PASS** (1/1) | 1,526 ms | `tests/e2e/viewer.test.mjs` (`soldier-baseline` 592f + `zombie-supermarket-10s` 300f) |
| Regression & Negative | `npm run test:regression` | **4 PASS / 1 FAIL** | ~5.8 s | Failure #4 (`parity-and-negative.test.mjs:117`) expected gitignored `soldier-baseline/work/voice.mp3` absent in a clean fresh worktree |
| Full DAG (`npm test`) | `node tests/run-dag.mjs` | **FAIL (ENOENT)** | — | `tests/run-dag.mjs:204` unconditionally reads gitignored `work/render-manifest.json` absent in fresh worktree |
