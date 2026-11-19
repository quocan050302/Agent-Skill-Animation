# QA-TTS-01 UI & Visual Verification Screenshots

All screenshots below were captured live via Playwright (`tests/e2e/studio-ui.test.mjs`) against the compiled React + TypeScript + Vite Dark Studio served from loopback `127.0.0.1`, paired with the real Three.js WebGL `9:16` renderer and verified `ghost-army-ww2-30s` export.

## Captured Studio UI Screenshots (`screenshots/`)

| Viewport / Surface | File | Verified Checks |
|---|---|---|
| **Desktop 1440×900 — Studio Workspace (Steps 1–5 + Live 9:16 Stage)** | [desktop-1440x900-studio.png](./screenshots/desktop-1440x900-studio.png) | Dark slate/navy `#0D1119` palette, single `#38BDF8` accent, live Three.js 3D+2D WebGL render + `9:16 SHORTS SAFE ZONE` + live timed Cartoon subtitle overlay (`MADE OF INFLATABLE RUBBER.`), 0 horizontal overflow, all buttons >= 44px. |
| **Desktop 1440×900 — Step 5 QA & Export** | [desktop-1440x900-qa-export.png](./screenshots/desktop-1440x900-qa-export.png) | Q06–Q18 semantic QA table (`PASS`/`UNVERIFIED`), contact sheet & subtitle QA thumbnails, Download MP4 & Verified MP4 player unlocked post-QA. |
| **Desktop 1440×900 — Minimal Project Library** | [desktop-1440x900-library.png](./screenshots/desktop-1440x900-library.png) | Template creation cards (`Ghost Army 30s`, `Zombie Supermarket 10s`), live search filter, Open Studio / Duplicate / guarded Delete controls. |
| **Tablet 768×1024 — Responsive Studio** | [tablet-768x1024.png](./screenshots/tablet-768x1024.png) | Stacked stage-first layout, 0 horizontal overflow, >= 44px touch targets. |
| **Mobile 390×844 — Responsive Studio** | [mobile-390x844.png](./screenshots/mobile-390x844.png) | Centered 9:16 stage, readable typography, 0 horizontal overflow, >= 44px touch targets. |
| **Compact Mobile 320×720 — Stress Layout** | [mobile-320x720.png](./screenshots/mobile-320x720.png) | Zero clipping, zero horizontal overflow, clean button stacking, >= 44px hit targets. |

## Ghost Army 30s Local Visual QA Sheets (Gitignored)

- **12-Tile Story Contact Sheet**: `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-contact-sheet.jpg` (`1620×960`, 12 tiles across all 7 scenes)
- **10-Tile Post-Burn Subtitle Check Sheet**: `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-sub-check.jpg` (`1350×960`, 10 non-adjacent post-burn MP4 captures confirming `#241726` ink outline, `#FFE055` active gold, `#FF6347` `punchWords`, and 9:16 safe-zone placement)
