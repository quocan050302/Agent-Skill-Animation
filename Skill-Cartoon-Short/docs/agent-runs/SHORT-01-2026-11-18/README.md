# Agent Execution Run Report — `SHORT-01-2026-11-18`

## Scope

Milestone **SHORT-01 — Original Short Renderer Source Fidelity** inside `Agent-Skill-Animation/Skill-Cartoon-Short/` on branch `feat/short-01-original-engine-fidelity` (branched from `master` commit `6b1c42c6a7eaa482a764c12e6d11cc87f6fd8dd4`).

- Inventoried and preserved byte-identical `cartoon-short-kit.zip` (`SHA-256: 784c07e36df5e91ddf93c78a1dde6b98b3aa3e3c37cadff03c5603d3971ce788`) locally under `vendor/cartoon-short-kit/`.
- Pinned `three@0.160.0` (MIT), `playwright@1.65.1`, and `mromidev/claude-animated-shorts` commit `e3b817b6afc6cd413466d43f11ba31209e034bbf` (MIT).
- Executed full 592-frame (`19.734 s`) Soldier baseline parity render (`out/original-example-preview.mp4`, `out/original-reference-contact-sheet.jpg`) and forensic 14-tile `stills.jpg` comparison.
- Implemented missing specification-compliant linear gated-RMS `-6.0 dB` mixer (`tools/audio/mix.py`, NEW CODE) alongside legacy `audio.py` regression runner.
- Authored and rendered a complete new 300-frame (`10.000 s`) 9:16 scenario (`zombie-supermarket-10s` -> `out/new-original-10s-preview.mp4`, `out/new-original-contact-sheet.jpg`).
- Enforced Public Repository License Gate (`G03: BLOCKED`) so zero bytes of unlicensed `cartoon-short-kit.zip` source or derivative Soldier media are pushed to public GitHub.

## Exact Reproduction Commands

```bash
cd Skill-Cartoon-Short
npm install
CARTOON_SHORT_KIT_ZIP=/Users/macbook/Downloads/cartoon-short-kit.zip npm run setup

# Run full 8-node async verification DAG (unit, integration, visual, regression, 12 negative tests, E2E viewer)
npm test

# Re-render Soldier baseline (592 frames) & Zombie 10s proof (300 frames)
npm run render -- workspace/projects/soldier-baseline/frames 0-591 1 0.94 --project soldier-baseline
npm run render -- workspace/projects/zombie-supermarket-10s/frames 0-299 1 0.94 --project zombie-supermarket-10s
```
