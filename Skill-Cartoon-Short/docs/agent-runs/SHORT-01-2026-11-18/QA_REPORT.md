# Run QA Report (`SHORT-01-2026-11-18`)

See [../../QA_REPORT.md](../../QA_REPORT.md) for the complete 17-gate table (`G01`–`G17`), [./TEST_RESULTS.json](./TEST_RESULTS.json) for machine-readable DAG test output, and [./RENDER_METRICS.json](./RENDER_METRICS.json) for FFprobe, EBU R128, frame SHA-256, and `stills.jpg` PSNR/MAE parity metrics.

## Summary

- **Async Test DAG**: `8 / 8` stages `PASS` (`unit`, `integration`, `visual`, `regression`, `backtest`, `12/12 negative`, `e2e`).
- **Soldier Baseline Render**: `592 / 592` frames (`1080×1920`, `30 FPS`, `33.01 ms/frame`), `10 / 14` reference `stills.jpg` tiles matched (`PSNR 22.54–37.64 dB`), H.264/AAC `+faststart` MP4 verified (`0` black spans, `0` frozen spans).
- **New 10-Second Proof (`zombie-supermarket-10s`)**: `300 / 300` frames (`1080×1920`, `30 FPS`, `35.75 ms/frame`), `-6.000 dB` music & `-6.000 dB` SFX gated RMS relative to narration, H.264/AAC `+faststart` MP4 verified (`0` black spans, `0` frozen spans).
- **Protected Scope (`G16`)**: `Skill-B6/` verified 100% untouched (`git diff -- Skill-B6` SHA-256 unchanged, `0` staged/committed files outside `Skill-Cartoon-Short/`).
