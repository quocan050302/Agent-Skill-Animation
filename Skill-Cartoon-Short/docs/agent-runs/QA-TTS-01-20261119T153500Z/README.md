# QA-TTS-01 Run Index (`QA-TTS-01-20261119T153500Z`)

- **Repository**: `https://github.com/quocan050302/Agent-Skill-Animation.git`
- **Source Branch / Anchor SHA**: `origin/feat/short-01-original-engine-fidelity` (`c67dbd785c08edb4d824f8036588ce2294b627fe`)
- **Target Branch**: `QA`
- **Scoped Directory**: `Skill-Cartoon-Short/` ONLY (`Skill-B6/` byte-for-byte unchanged)
- **Mission**: Build compact dark Studio UI (React + TypeScript + Vite), port/harden Gemini TTS & Import Audio pipeline, integrate Cartoon Subtitles (`cartoon_subs.py`) & honest ratio capabilities, render and QA-verify the new 30-second 900-frame Ghost Army demo (**"The Fake Army That Fooled the Nazis"**), and execute bounded async verification DAG.

## Reproducible Commands

```bash
cd Skill-Cartoon-Short
npm ci
npm run setup        # Hydrates engine + zombie-supermarket-10s + ghost-army-ww2-30s
npm run build        # TypeScript check + Vite production bundle (app/frontend/dist/)
npm run studio       # Launches loopback Studio at http://127.0.0.1:4319/ (legacy viewer at /legacy)
npm test             # Runs full bounded async DAG (unit, integration, determinism, regression, E2E)
npm run qa           # Runs 17-gate truthfulness verifier (G01-G17)
```

## Report Contents

1. [BASELINE.md](./BASELINE.md) — Git forensics, environment versions, disk/kit preflight, baseline test runs
2. [SOURCE_AUDIT.md](./SOURCE_AUDIT.md) — Verified existing functions & `out-of-step-studio` MIT provenance + MIME/WAV fixes
3. [PLAN.md](./PLAN.md) — Component boundary & execution plan
4. [IMPLEMENTATION.md](./IMPLEMENTATION.md) — Exact modules created & modified
5. [FILES_CHANGED.md](./FILES_CHANGED.md) — Git scope guard proof (`Skill-Cartoon-Short/**` only)
6. [TEST_RESULTS.json](./TEST_RESULTS.json) — Real exit codes, durations, DAG node results, resource metrics
7. [QA_REPORT.md](./QA_REPORT.md) & [QA_REPORT.json](./QA_REPORT.json) — Q01–Q18 & G01–G17 evidence-based truthfulness ledger
8. [REGRESSION_MATRIX.md](./REGRESSION_MATRIX.md) — Soldier/Zombie/Legacy viewer/Kit/Skill-B6 backtest matrix
9. [PERFORMANCE.md](./PERFORMANCE.md) — Render FPS, DAG elapsed times, bounded concurrency, peak RAM & disk
10. [SCREENSHOTS.md](./SCREENSHOTS.md) — Desktop 1440×900, Tablet 768×1024, Mobile 390×844 & 320×720 UI captures
11. [GHOST_ARMY_30S.md](./GHOST_ARMY_30S.md) — Script, voice provenance, 7-scene map, exact local artifact paths & SHA-256 hashes
12. [BLOCKERS.md](./BLOCKERS.md) — Honest disclosure of `NO_API_KEY`, `G03`, `1:1`/`16:9` disabled ratios, `UNVERIFIED_WORD_SYNC`, human review
13. [FINAL_STATUS.md](./FINAL_STATUS.md) — Final acceptance checklist & verified remote push SHA
