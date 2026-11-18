# Zombie Preview Storyboard — `zombie-mirror-10s`

**Title**: *The Zombie Who Was Afraid of a Human*
**Format**: Portrait `9:16` native (`720x1280`, `30fps`, `10.0s`, `300` frames)
**Audio**: Local macOS `say -v Daniel` (`10.000s` 44.1kHz mono) + procedural rain ambience, dark comedy bass pluck, mirror glint ping, cartoon shock boing, wet footstep taps, cone rattle, and neon hum ([`audio/narration_mixed.wav`](../../../workspace/projects/zombie-mirror-10s/audio/narration_mixed.wav))
**Captions**: Single-line `Archivo Black` `47px` with `#171319` stroke at bottom band (`[864, 951]`), zero overlap over characters/props, verbatim word-aligned with narration ([`captions.json`](../../../workspace/projects/zombie-mirror-10s/captions.json))

---

## 1. Original Production Assets (No Legacy Media Reuse)

Generated freshly for `B6-LOCAL-STUDIO-04` using Antigravity `image-generator` and floodfill-isolated to crisp zero-halo RGBA PNGs:

- **Background Layer**: `assets/production/bg_convenience_night.png` (`2048x1152`, midnight rainy convenience-store storefront + streetlamp + reflections) + procedural closed-form rain streaks, window shimmer, puddle ripples, ContactPlan foot splashes, Shot 4 comic starburst, and Shot 5 comedy speed streaks rendered in `scene.py`.
- **Foreground Layer**: `assets/production/fg_neon_sign.png` (`24H` A-frame sidewalk sign, staged exclusively in Shot 8 clear of zombie leg/ankle alpha masks).
- **Props**:
  - `assets/production/prop_vanity_mirror.png` — Pocket vanity mirror attached to Human's leading `right` IK wrist with `0.0px` contact drift across all `300` frames.
  - `assets/production/prop_traffic_cone.png` — Bright orange street traffic cone standing beside the curb, kicked spinning leftward at `t >= 6.24s`.
- **Characters (`characters.json`)**:
  - `zombie`: 2-bone continuous ink limbs + purple tattered tunic + stitched green head variants (`neutral`, `grin`, `shock`, `panic`), `25/25` preflight pose probes passed.
  - `human`: 2-bone continuous ink limbs + charcoal beanie & teal utility jacket + calm head variants (`neutral`, `deadpan`, `blink`), `25/25` preflight pose probes passed.

---

## 2. 8-Shot Editorial & Motion Plan (`formats/portrait.json`)

| # | Shot ID | Time (`s`) | Editorial Role & Scale | Camera Move & Focus Target | Motion State (`b6_motion_core`) | Audio / Caption Beat |
|---:|---|---|---|---|---|---|
| 1 | `shot_01_hook` | `0.0–1.0` | `hook` · `close` | `push` -> `actor_eyes:zombie` | `anticipate` (stationary sneaky bend + creeping claws, `grin`) | *"He crept up behind"* (`0.14–1.09s`) |
| 2 | `shot_02_stalk` | `1.0–2.2` | `anticipation` · `wide` | `track` -> `actor_full:zombie` | `walk` (`x: 122 -> 176`, `2.2Hz`, knee bend + puddle splashes, `neutral`) | *"a midnight shopper,"* (`1.09–1.80s`) |
| 3 | `shot_03_mirror_insert` | `2.2–3.2` | `prop_insert` · `insert` | `follow_prop` -> `prop:mirror` | Human raises mirror via IK wrist lock (`idle`, `deadpan`) | *"caught one glimpse"* (`2.30–2.90s`) / *"in the mirror,"* (`2.90–3.51s`) |
| 4 | `shot_04_mirror_shock` | `3.2–4.5` | `reveal` · `extreme_close` | `whip_with_subject` -> `actor_eyes:zombie` | `react` (`shock` -> `panic` at `3.75s`, nod jolt + comic starburst) | Mirror shock chord + *"in the mirror,"* tail |
| 5 | `shot_05_panic_chase` | `4.5–6.2` | `chase` · `wide` | `track` -> `action_group` | `dash` (`x: 212 -> 108`, `2.6Hz`, bent-knee sprint + speed lines, `panic`) | *"screamed faster than"* / *"any human,"* (`4.55–5.99s`) |
| 6 | `shot_06_cone_trip` | `6.2–7.5` | `impact` · `insert` | `follow_prop` -> `prop:cone` | `walk` (`x: 114 -> 68`, kicks cone spinning across curb, `panic`) | Wet footstep & cone spin SFX |
| 7 | `shot_07_human_deadpan` | `7.5–8.8` | `reaction` · `close` | `hold` -> `actor_head:human` | Intentional `hold_payoff`: calm `blink` (`7.88–8.22s`) + slight mirror tilt | *"and hid behind"* (`7.62–8.36s`) |
| 8 | `shot_08_sign_payoff` | `8.8–10.0` | `payoff` · `medium` | `pull` -> `actor_full:zombie` | `react` (`x: 158`, shivering behind `24H` A-frame sign entering left) | *"the open sign!"* (`8.36–9.11s`) + neon payoff |

---

## 3. Visual Verification Artifacts

- **54-Frame Editorial Contact Sheet**: [`zombie-contact-sheet.jpg`](./zombie-contact-sheet.jpg) (annotated with timestamps, `shot_id`, and caption placement).
- **12-Tile Native Render Contact Sheet**: [`zombie-puppet-contact-sheet.jpg`](./zombie-puppet-contact-sheet.jpg).
- **Sample Native Keyframes (`720x1280` PNG)**: [`sample-frames/`](./sample-frames/) (`frame-0000.png` through `frame-0299.png`).
