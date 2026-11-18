# QA & Technical Gate Report — `B6-LOCAL-STUDIO-04`

## 1. `zombie-preview-10s.mp4` Technical Inspection (`ffprobe` + `report.json`)

- **Container / Format**: MP4 (`mov,mp4,m4a,3gp,3g2,mj2`, `+faststart`), `4,211,631` bytes, `sha256: 9e1633fb8a6422183d8fce7260e03e509ea477c7ae07cd4757863f4224f44cd8`.
- **Video Stream**: `h264` (`High`), `yuv420p`, **`720x1280`** native `9:16` portrait, **`30/1 fps`**, `300` frames, `duration: 10.000000s` ([`evidence/zombie-ffprobe.json`](./evidence/zombie-ffprobe.json)).
- **Audio Stream**: `aac` (`LC`), `44100 Hz`, `mono`, `duration: 10.000000s` (local macOS `say -v Daniel` + procedural NumPy Foley SFX mixed at 0dBFS-safe normalization).
- **Captions & Sidecars**: `8` single-line `Archivo Black` cues (`47px`, `#ffffff` fill / `#171319` stroke, `3x` lanczos supersampling, bottom band `y in [864, 951]`), `captions.srt` / `captions.vtt` emitted alongside rendered output.
- **Asset Purity**: `external_media_reads: []`, `protected_inputs: []`, `purpose: "production"`.

---

## 2. Three-Layer Independent QA State (`/api/projects/zombie-mirror-10s/qa`)

| Gate | Status | Evidence / Metrics |
|---|---|---|
| **1a. Scene Technical + Preflight + Puppet Integrity** | **`PASS`** | `25/25` preflight pose probes passed (`zombie`, `human`), `300/300` rendered native frames passed continuous ink/cuff/neck/leg/prop audits (`max_prop_contact_error_px: 2.54e-13`, `0` frame errors). |
| **1b. Articulated Motion QC (`motion_qc.json`)** | **`PASS`** | [`evidence/zombie-motion-qc.json`](./evidence/zombie-motion-qc.json): `total_frames: 300`, `locomotion_frames: 121`, `max_stance_drift_world: 0.0`, `max_ground_penetration_world: 0.0`, `max_bone_length_rel_err: 0.0`, `max_knee_bend_deg: 100.85`, `max_locomotion_knee_deviation_px: 110.17`, `max_prop_contact_error_px: 0.0`. |
| **1c. Editorial & Pacing QC (`editorial_qc.json`)** | **`PASS`** | [`evidence/zombie-editorial-qc.json`](./evidence/zombie-editorial-qc.json): `frames_checked: 300`, `unique_compositions: 8/8`, `too_similar_pairs: 0`, `cut_excluded_y_mad_mean: 3.7545`, `foreground_relative_motion_mean: 0.8994`, `gaming_detected: false`, `high_pixel_low_semantics: false`. |
| **2. Visual Motion Review (`35` subchecks)** | **`PENDING`** | Review pack generated via `run.py review-pack` (`35` subchecks across `8` groups initialized cleanly to `pending`, never auto-filled). |
| **3. User Approval & Full Export Gate** | **`PENDING` / LOCKED** | `no_approval_record`; `renderUnlocked: false`; `Xuất Video Full MP4` disabled in Studio UI (`approval-9x16.json` absent). |
| **4. Audience Retention Claim Guard** | **`unavailable`** | Explicit disclaimer enforced in backend JSON and Studio UI (`"Ước lượng retention: Chưa khả dụng"`). |

---

## 3. Live UI Verification Screenshots (`Playwright` Desktop `1440px` & Mobile `375px`)

Captured automatically during `studio.spec.ts` (`0` console errors, `0` page errors, `0` horizontal overflow at `320/375/768/1024/1440`):

- Studio Player + Motion/Editorial Overlay (`1440px`): [`screenshots/desktop-1440-studio-zombie.png`](./screenshots/desktop-1440-studio-zombie.png)
- Studio Shot Tab + Editorial Director Controls (`1440px`): [`screenshots/desktop-1440-zombie-editorial-shot.png`](./screenshots/desktop-1440-zombie-editorial-shot.png)
- `Jobs & QA` Tab + Editorial Diagnostics Panel (`1440px`): [`screenshots/desktop-1440-zombie-editorial-qa.png`](./screenshots/desktop-1440-zombie-editorial-qa.png)
- Mobile Responsive Studio View (`375px`): [`screenshots/mobile-375-zombie-studio.png`](./screenshots/mobile-375-zombie-studio.png)
