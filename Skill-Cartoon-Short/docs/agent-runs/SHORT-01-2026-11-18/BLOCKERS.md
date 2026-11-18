# Blockers & Unverified Constraints (`SHORT-01-2026-11-18`)

## Hard Gate Blockers (`BLOCKED`)

1. **`G03` — Public Source Redistribution Gate (`BLOCKED`)**
   - **Cause**: Target GitHub repository `https://github.com/quocan050302/Agent-Skill-Animation` has `"visibility": "public"`, while the supplied `cartoon-short-kit.zip` contains no `LICENSE` file, no SPDX identifier, and no explicit redistribution permission from its author(s). Upstream MIT licensing of `three@0.160.0` and `mromidev/claude-animated-shorts` does not automatically cover the kit's authored `engine/*`, `example/soldier/*`, and `tools/*` files.
   - **Action Taken**: Preserved the complete unaltered source locally (`vendor/cartoon-short-kit/`) and executed all parity/rendering tests locally; blocked all unverified third-party source and Soldier derivative media from Git staging/push via `.gitignore` and pre-commit verification. Committed/pushed only independently authored, publishable code, tests, and documentation.
   - **Required to Unblock**: Written license or redistribution authorization from the copyright holder of `cartoon-short-kit.zip` (or switching to a private repository if private internal use is licensed).

2. **Missing Reference Input: `Pasted markdown.md` (`BLOCKED`)**
   - **Cause**: Referenced ChatGPT attachment `Pasted markdown.md` (Cartoon Audio Short SKILL specification) was not uploaded into the Antigravity workspace or local user directories (`/Users/macbook/Downloads`, `Desktop`, `Documents`).
   - **Action Taken**: Recorded as `BLOCKED` in `vendor/source-manifest.json` and `docs/SOURCE_AUDIT.md`; did not fabricate a substitute specification document. Addressed all specification discrepancies explicitly stated in the prompt (`mix.py` missing, `-6 dB` gated-RMS linear mixing).

---

## Explicitly Unverified Items (`UNVERIFIED`)

1. **Authentic Narrated Soldier Example Parity (`UNVERIFIED`)**: `example/soldier/voice.mp3` (`19.72 s` referenced in `story.js`) is absent from `cartoon-short-kit.zip`. Technical audio/timing/video tests used an explicitly labeled procedural speech-cadence fixture.
2. **Native Windows Host Execution (`UNVERIFIED`)**: `tools/setup/setup.ps1` and cross-platform Node/Python tools were authored without drive-letter or symlink assumptions, but verified on `darwin-arm64` rather than a Windows runner.
3. **Whisper ASR Branch (`UNVERIFIED`)**: `faster-whisper` / `openai-whisper` are not installed on the runner; the script-based `silencedetect` + DP alignment path was verified and labeled `approximate-silence-dp`.
4. **Human Subjective Playback Retention (`NOT_VERIFIED`)**: Technical `ffprobe`, `ebur128`, `blackdetect`, `freezedetect`, and visual contact-sheet checks were performed; no subjective human retention score is claimed.
