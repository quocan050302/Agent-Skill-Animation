# Editorial Metrics & Baseline Comparison (`B6-03` Samurai vs `B6-04` Zombie)

All measurements below were extracted deterministically by [`editorial_runtime/b6_editorial_cli.py`](../../../editorial_runtime/b6_editorial_cli.py) from decoded H.264/AAC MP4 packets at `360x640` analysis resolution (`30.0 fps`), excluding the single-line bottom caption band (`y in [0.675, 0.743]`).

> [!IMPORTANT]
> Pixel MAD, optical flow magnitude, and SSIM are **frame-variation telemetry**, NOT audience retention or creative quality predictions (`audience_retention_estimate: "unavailable"`). Cut-excluded metrics strip single-frame transition impulses so raw jump cuts cannot masquerade as continuous visual activity.

---

## 1. Aggregate Comparison

| Metric | `samurai-red-leaf-10s` (`B6-03` Baseline) | `zombie-mirror-10s` (`B6-04` Editorial v1) | Delta / Interpretation |
|---|---:|---:|---|
| Video SHA-256 (prefix) | `436a13bdaf1b...` | `9e1633fb8a64...` | Distinct productions |
| Resolution / FPS / Audio | `720x1280` · `30fps` · `AAC 44.1kHz` | `720x1280` · `30fps` · `AAC 44.1kHz` | Exact 9:16 native match |
| Editorial QC Verdict | **`FAIL`** | **`PASS`** | Samurai failed duplicate/lull checks; Zombie passed cleanly |
| `shots_analyzed` / `unique_compositions` | `6` / **`3`** | `8` / **`8`** | **+166% composition variety (`3 -> 8`)** |
| `too_similar_pairs` / `duplicate_ratio` | `3` / `0.60` | **`0`** / **`0.00`** | Eliminated back-to-back similar framing |
| `cuts_detected` | `5` | `7` | Motivated hook/stalk/insert/reveal/dash/impact/deadpan/payoff cuts |
| `raw_y_mad_mean` | `4.2975` | `4.4783` | Nearly equal raw change (+4.2%) |
| `cut_excluded_y_mad_mean` | `4.0487` | `3.7545` | Lower than Samurai's extreme dash impulse (`p95: 8.44 vs 13.02`) — no jitter gaming |
| `cut_excluded_y_mad_median` | `2.0811` | **`3.7454`** | **+80.0% median frame richness across the reel** |
| `flow_mag_mean` (`px/f`) | `0.6445` | **`1.0254`** | +59.1% sustained motion flow |
| `camera_global_motion_mean` (`px/f`) | `0.5097` | **`0.4343`** | **-14.8% global pan/shake** (smoother framing) |
| `foreground_relative_motion_mean` (`px/f`) | `0.4907` | **`0.8994`** | **+83.3% true subject/prop action** |
| `pct_near_static` | `18.37%` | **`11.30%`** | Cut-excluded low-motion frames reduced; remaining ~11% is intentional Shot 7 deadpan contrast |
| `gaming_detected` / `high_pixel_low_semantics` | `false` / `false` | `false` / `false` | Anti-gaming guards clear |

---

## 2. Why Samurai Failed `B6-03` Editorial QC (6.55–10.0s Lull & Duplicate Cuts)

Samurai QC output ([`baselines/samurai-editorial-qc.json`](./baselines/samurai-editorial-qc.json)):

- `EDITORIAL_EXCESSIVE_DUPLICATE_SHOTS`:
  - `shot_01_hook -> shot_02_anticipate`: `coarse_ssim = 0.8211`, `hist_dist = 0.0194` (consecutive wide framing).
  - `shot_04_slash_miss -> shot_05_leaf_nose`: `coarse_ssim = 0.8007`, `hist_dist = 0.0282`.
  - `shot_05_leaf_nose -> shot_06_deadpan`: `coarse_ssim = 0.7491`, `hist_dist = 0.0436`.
- `EDITORIAL_EXTENDED_STATIC_LULL`:
  - `SUSTAINED_LOW_ACTIVITY_INTERVAL (6-10s: fg_rel<0.28, y_mad<1.40)` — `samurai` fell to `fg_rel = 0.0958–0.2343 px/f` for four full seconds (`6–10s`, up to `56.67%` near-static in second `7`).

---

## 3. Per-Second Comparison (`cut_excluded`)

| Second | Samurai Y-MAD | Samurai FG (`px/f`) | Samurai Static % | Zombie Y-MAD | Zombie FG (`px/f`) | Zombie Static % | Zombie Narrative Role |
|---:|---:|---:|---:|---:|---:|---:|---|
| `0–1s` | `3.1946` | `0.4967` | `13.79%` | `2.6313` | `0.7162` | `6.90%` | `shot_01_hook`: sneaky closeup push + claw wiggle |
| `1–2s` | `2.0116` | `0.2637` | `3.33%` | `4.1080` | `0.8290` | `0.00%` | `shot_02_stalk`: wide puddle stealth walk |
| `2–3s` | `10.4589` | `1.0181` | `13.79%` | `1.9724` | `0.4854` | `3.45%` | `shot_03_mirror_insert`: shopper tilts vanity mirror |
| `3–4s` | `12.1081` | `1.4599` | `0.00%` | `3.6879` | `0.9847` | `0.00%` | `shot_04_mirror_shock`: ECU eye-pop starburst + head shake |
| `4–5s` | `5.6545` | `0.5748` | `0.00%` | `3.6606` | `0.8443` | `0.00%` | `shot_05_panic_chase`: wide 2-bone IK dash + speed streaks |
| `5–6s` | `2.7701` | `0.4831` | `0.00%` | `5.1474` | `1.0093` | `0.00%` | `shot_05_panic_chase`: sustained high-cadence sprint |
| `6–7s` | `1.1729` | `0.2343` | `37.93%` | **`6.9402`** | **`1.8263`** | **`0.00%`** | `shot_06_cone_trip`: cone spin impact + zombie stumble |
| `7–8s` | `0.8486` | `0.1136` | `56.67%` | `2.8628` | `0.8138` | `31.03%` | Transition from cone trip to Shot 7 deadpan setup |
| `8–9s` | `0.9279` | `0.0958` | `41.38%` | `1.7986` | `0.5328` | `72.41%` | **Intentional `hold_payoff`** (human blink) -> Shot 8 cut |
| `9–10s` | `1.2868` | `0.1546` | `17.24%` | **`4.6759`** | **`0.9504`** | **`0.00%`** | `shot_08_sign_payoff`: 24H open sign slide + shiver payoff |

---

## 4. Per-Shot Breakdown & Consecutive Shot Diversity (Zombie `B6-04`)

| Shot | Window | Editorial Role / Size | `ce_ymad` | `fg_rel` | Next-Shot `coarse_ssim` | Next-Shot `hist_dist` | Verdict |
|---|---|---|---:|---:|---:|---:|---|
| `shot_01_hook` | `0.0–1.0s` | `hook` · `close` | `2.6313` | `0.7162` | `0.3703` | `0.1374` | Distinct |
| `shot_02_stalk` | `1.0–2.2s` | `anticipation` · `wide` | `3.7560` | `0.7892` | `0.2827` | `0.1992` | Distinct |
| `shot_03_mirror_insert` | `2.2–3.2s` | `prop_insert` · `insert` | `1.8292` | `0.4513` | `0.2026` | `0.2615` | Distinct |
| `shot_04_mirror_shock` | `3.2–4.5s` | `reveal` · `extreme_close` | `3.5885` | `0.9901` | `0.2527` | `0.1600` | Distinct |
| `shot_05_panic_chase` | `4.5–6.2s` | `chase` · `wide` | `4.7901` | `0.9431` | `0.3352` | `0.1192` | Distinct |
| `shot_06_cone_trip` | `6.2–7.5s` | `impact` · `insert` | `6.8991` | `1.8040` | `0.2521` | `0.2942` | Distinct |
| `shot_07_human_deadpan` | `7.5–8.8s` | `reaction` · `close` | `0.5024` | `0.2697` | `0.2669` | `0.1950` | Distinct (intentional hold) |
| `shot_08_sign_payoff` | `8.8–10.0s` | `payoff` · `medium` | `5.0966` | `1.0731` | — | — | Clean payoff |

---

## 5. Chart Artifacts

- Samurai baseline pacing chart: [`baselines/samurai-pacing-chart.svg`](./baselines/samurai-pacing-chart.svg)
- Zombie B6-04 pacing chart: [`evidence/zombie-editorial-pacing-chart.svg`](./evidence/zombie-editorial-pacing-chart.svg)
