# Run Source Audit Summary (`SHORT-01-2026-11-18`)

Full audit table and SHA-256 inventory are stored in [../../SOURCE_AUDIT.md](../../SOURCE_AUDIT.md) and [../../SOURCE_FIDELITY_MANIFEST.json](../../SOURCE_FIDELITY_MANIFEST.json).

## Key Forensic Findings

1. **`cartoon-short-kit.zip` Verified (`14` files, `444,936` bytes, SHA-256 `784c07e36df5e91ddf93c78a1dde6b98b3aa3e3c37cadff03c5603d3971ce788`)**:
   - Extracted byte-for-byte into `vendor/cartoon-short-kit/` (`14/14` SHA-256 matches).
   - Contains **no `LICENSE` file** -> Gate `G03` is `BLOCKED` for public GitHub redistribution (`quocan050302/Agent-Skill-Animation` is public).
2. **Missing Inputs & Archive Omissions**:
   - `Pasted markdown.md` (SKILL specification): Absent from workspace (`BLOCKED`).
   - `example/soldier/voice.mp3` & `script.txt`: Absent from `cartoon-short-kit.zip` (authentic narrated Soldier parity marked `UNVERIFIED`; without `voice.mp3`, original `audio.py` L174 produces `0/0 = NaN` and silent PCM).
   - `tools/mix.py`: Absent from `cartoon-short-kit.zip` (implemented as NEW CODE in `tools/audio/mix.py`).
3. **Engine Coupling & Unsafe Shell Operations Identified**:
   - `engine/main.js` L90–245 & L338–365 hardcode the Roman river, rotting bridge, SPQR banner, collapsing temple, and 3D helmet.
   - `example/soldier/story.js` reimplements local `smooth`/`lerp3`/`camAt` without importing `engine/motion.js`.
   - `tools/setup.sh` mutates `/tmp/_three`, `/tmp/_t3`, `/tmp/_cas`, writes into `$KIT/vendor/toon.ts`, clones unpinned `HEAD`, suppresses TS-stripping errors, and uses global Playwright symlinks.
   - `tools/render.mjs` binds `http.createServer` on all interfaces (`listen(0)`) without WebGL/black-frame/JPEG validation.
