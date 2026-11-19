# Ghost Army 30-Second Demo Dossier (`ghost-army-ww2-30s`)

- **Title**: **The Fake Army That Fooled the Nazis**
- **Historical Subject**: U.S. Army 23rd Headquarters Special Troops ("The Ghost Army", 1944 WWII deception tactics — general documented tactics, zero glorifying Nazi emblems or fabricated battle outcomes)
- **Project Source (`src/`, tracked in Git)**: `Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/src/` (`paint-ghost.js`, `ghost-cast.js`, `story.js`, `audio_stems.py`, `subtitles.json`)
- **Verified Job ID / Export ID**: `job-mwnrkwkn-1eff0c` / `exp-job-mwnrkwkn-1eff0c` (2-worker parallel WebGL render + overlapped mix/sub + non-blocking async mux + parallel QA; bit-for-bit identical 900/900 frames & final MP4 SHA-256 to serial baseline `job-mwnqyc93-689379`)
- **Format**: Native `9:16` (`1080 × 1920`, zero upscale), `30/1 FPS`, **exact `900` frames (`0..899`)**, **`30.000 s`**
- **Renderer**: Exclusively Three.js r160 + Pen 2D bean-head cards + `#241726` screen-space ink + 48-tap Golden-angle DOF (`ShortRendererSession`)

## Spoken Narration Script & Provenance

> *"During World War II, the Americans built an entire army that wasn't real. From a distance, German soldiers saw rows of tanks preparing for battle. But those tanks were made of inflatable rubber. And that was just the beginning. Hidden speakers blasted the sounds of thousands of troops and armored vehicles. Fake radio messages made the illusion even more convincing. Just 1,100 men could impersonate a force many times their size, drawing German attention away from real American troops. Their deadliest weapon wasn't a gun. It was deception."*

- **Voice Source**: Real English spoken recording supplied by the user (`uploaded_media_1795095152372.wav`, original `35.2006s`, last spoken word `34.65s`). Imported through `POST /api/projects/ghost-army-ww2-30s/import-audio`.
- **Pacing Calibration (Zero Truncated Words)**: Pitch-preserving FFmpeg `atrim=end=34.72,asetpts=PTS-STARTPTS,atempo=1.165,apad=whole_dur=30.000` -> `29.747s` spoken narration + `0.253s` clean tail silence inside exact `30.000s` (`900` frames).
- **Live Gemini TTS Status**: `BLOCKED_NO_API_KEY` (no `GEMINI_API_KEY` configured in env; mocked Gemini TTS stack tested separately).
- **Music & SFX Provenance**: 100% original procedural DSP (`src/audio_stems.py`) mixed via `tools/audio/mix.py::mix_linear_spec_compliant` (`measuredMusicRelDb = -6.0 dB`, `measuredSfxRelDb = -6.0 dB`, `duckingApplied = false`, `nonlinearWaveshapingApplied = false`, `masterPeakDbfs = -1.0 dBFS`, EBU R128 `-16.1 LUFS` / `-1.1 dBFS` true peak).

## 7-Scene Storyboard Map (`900` Frames @ `30 FPS`)

| # | Shot ID | Frames | Time (s) | Lighting Preset | Story Beat & Action |
|---|---|---|---|---|---|
| 1 | `hookSearchlight` | `0..99` | `0.00–3.30s` | `nightSearchlight` | Sweeping searchlight reveals decoy Sherman tank row with painted rubber treads; hero tank wobbles with air puff & U.S. soldier beside `GHOST ARMY` crate. |
| 2 | `scoutBinoculars` | `100..244` | `3.33–8.13s` | `blueMist` | Distant neutral scouts peer through binoculars from ridge and lower them in wide-eyed shock (zero Nazi emblems). |
| 3 | `inflateRubber` | `245..359` | `8.17–11.97s` | `crispDay` | 1944 U.S. engineers pump air compressor while winking soldier effortlessly lifts entire inflatable rubber tank overhead (`AIR` valve visible). |
| 4 | `sonicTrucks` | `360..476` | `12.00–15.87s` | `amberDusk` | Camouflaged loudspeaker truck blasts golden comic acoustic waves across sunset dusk while sound technician works controls. |
| 5 | `spoofRadio` | `477..563` | `15.90–18.77s` | `radioTwilight` | Radio operator with headset taps Morse code beside glowing `SPOOF NET · 23RD HQ` faceplate while radio arcs crackle off whip antenna. |
| 6 | `impersonateTwist` | `564..797` | `18.80–26.57s` | `goldenReveal` | Sweeping crane pullback reveals tiny crew carrying floating rubber tanks & painting stencil crates in front of decoy tank field + moving decoy convoy headlights. |
| 7 | `deceptionReveal` | `798..899` | `26.60–29.97s` | `dawnHero` | Iconic closing reveal: winking Ghost Army artist with paintbrush stands before tilted bouncing rubber tank, clean lower-third caption safe zone. |

## Serial vs 2-Worker Parallel Determinism Proof

- **Serial 1-worker baseline (`job-mwnqyc93-689379`)**: `900` frames in **`23,099 ms`** (`25.67 ms/frame` = `38.96 FPS`)
- **Parallel 2-worker accelerated (`job-mwnrkwkn-1eff0c`)**: `900` frames in **`14,181 ms`** (`15.76 ms/frame` = `63.46 FPS`, **`1.63×` faster**, peak RSS `217.28 MB`)
- **Bit-Exact Parity**: **`900 / 900` frame SHA-256 hashes matched (`0` mismatches)** AND final encoded MP4 SHA-256 matched identically (`1a4caf250c769e116800951dda4c7aa59c59b677bd6e4db6fe230002d15711e7`).
- **End-to-End Studio Pipeline Wall Time (`job-mwnrkwkn-1eff0c`)**: **`49,923 ms`** (`0` HTTP errors across `123` concurrent status polls).

## Verified Local Artifacts (Gitignored — Exact Paths, Sizes & SHA-256)

| Artifact | Absolute Path | Bytes | SHA-256 |
|---|---|---|---|
| **Final Video (`SUB ON`)** | `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-sub-on.mp4` | `16,440,125` | `1a4caf250c769e116800951dda4c7aa59c59b677bd6e4db6fe230002d15711e7` |
| **Clean Fixture (`SUB OFF`)** | `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-sub-off.mp4` | `14,188,724` | `89d671dc83d1f1910ea2f88dc15d04201ffdde8201e878f43384dd592b907296` |
| **12-Tile Contact Sheet** | `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-contact-sheet.jpg` | `229,682` | `5ba319545fb26ffe8e203cdc76e5739feb9b693717f64769d96154584dfa2cae` |
| **10-Tile Subtitle QA Sheet** | `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-sub-check.jpg` | `229,888` | `059bd89989270f1d70b82c9d10073439442e4725c779bbbe4f5efa5cebd69521` |
| **Imported Voiceover WAV** | `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-voice.wav` | `5,760,078` | `5c60c0aa0743f25c8f5f399d6c3df4186be37a0f09352cf2a3be2a21458b847d` |
| **Render & QA Manifest** | `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-manifest.json` | — | Verified on disk |
| **Raw FFprobe JSON** | `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-ffprobe.json` | — | Verified on disk |
| **900-Frame Hash Manifest** | `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-frames-hash.json` | — | Verified on disk |
| **Parallel Benchmark JSON** | `/Users/macbook/Documents/Project_Github/Skill-Animation/Agent-Skill-Animation/Skill-Cartoon-Short/workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-parallel-benchmark.json` | — | Verified on disk |

## Technical QA Highlights (`ghost-army-ww2-30s-sub-on.mp4`)

- **Video**: `h264 (High)`, `yuv420p`, `1080×1920`, `30/1 FPS`, `nb_frames = 900`, `duration = 30.000s`
- **Audio**: `aac`, `48000 Hz`, `2 ch`, `duration = 30.000s`, `-16.1 LUFS`, `-1.1 dBFS` true peak, bitstream preserved (`-c:a copy`) across subtitle burn-in
- **Container**: `+faststart` verified (`moovOffset < mdatOffset`)
- **Anomalies**: `0` black events, `0` freeze events, `0` WebGL errors
- **Subtitles (`cartoon_subs.py`)**: `19` curated chunks, `punchWords` glowing `#FF6347` + active word `#FFE055` + `#241726` dark-plum ink outline, `8/10` sampled non-adjacent timestamps confirmed lower-third pixel diff vs `sub-off.mp4` (remaining 2 timestamps landed in natural pauses between sentences), visually verified via `ghost-army-ww2-30s-sub-check.jpg`.
- **Human Subjective Playback Review**: `UNVERIFIED` (automated visual/audio/FFprobe QA passed).
