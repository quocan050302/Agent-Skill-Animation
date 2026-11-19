#!/usr/bin/env python3
"""
Original Procedural WWII Espionage Music & Synchronized SFX Generator for "ghost-army-ww2-30s"
Classification: NEW IMPLEMENTATION CODE (QA-TTS-01 Phase 6)

Provenance: 100% copyright-safe original NumPy DSP synthesis (no copyrighted recordings, no third-party stems).
Mixed strictly through `tools/audio/mix.py::mix_linear_spec_compliant` (-6.0 dB relative gated-RMS music/SFX,
zero dynamic ducking, zero tanh nonlinear distortion).
"""
import argparse
import json
import os
import sys
import numpy as np

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "audio"))
from mix import SR, decode_audio_mono_f32, measure_ebur128, mix_linear_spec_compliant, write_stereo_wav_int16  # noqa: E402


def build_ghost_army_music(total_samples: int) -> np.ndarray:
    """Original tense WWII marching-snare pulse + low pizzicato bass + warm muted brass pad."""
    t = np.arange(total_samples, dtype=np.float64) / SR
    rng = np.random.default_rng(1944)

    # Subtle minor-key espionage bassline (D minor -> Bb -> A -> D)
    notes_hz = [73.42, 73.42, 87.31, 82.41, 58.27, 58.27, 65.41, 55.00]
    beat_sec = 0.5
    music = np.zeros(total_samples, dtype=np.float64)

    for b in range(int(total_samples / (SR * beat_sec)) + 1):
        t0 = b * beat_sec
        i0 = int(t0 * SR)
        if i0 >= total_samples:
            break
        dur = min(int(beat_sec * 0.9 * SR), total_samples - i0)
        lt = np.arange(dur, dtype=np.float64) / SR
        freq = notes_hz[b % len(notes_hz)]
        env = np.exp(-lt * 5.2) * np.minimum(1.0, lt / 0.012)
        bass = 0.42 * np.sin(2 * np.pi * freq * lt) + 0.18 * np.sin(2 * np.pi * 2 * freq * lt)
        music[i0 : i0 + dur] += bass * env

        # Soft brushed military snare tick on off-beats
        if b % 2 == 1:
            sd_len = min(int(0.09 * SR), total_samples - i0)
            st = np.arange(sd_len, dtype=np.float64) / SR
            snare = rng.standard_normal(sd_len) * np.exp(-st * 36.0) * 0.14
            music[i0 : i0 + sd_len] += snare

    # Subtle cinematic drone swell (D3 + A3 + F4)
    pad = (
        0.10 * np.sin(2 * np.pi * 146.83 * t)
        + 0.07 * np.sin(2 * np.pi * 220.0 * t)
        + 0.04 * np.sin(2 * np.pi * 349.23 * t)
    )
    swell = 0.65 + 0.35 * np.sin(2 * np.pi * t / 15.0)
    music += pad * swell

    # Gentle fade in/out
    fade_in = np.minimum(1.0, t / 0.6)
    fade_out = np.minimum(1.0, np.maximum(0.0, (total_samples / SR - t) / 0.8))
    return (music * fade_in * fade_out).astype(np.float32)


def build_ghost_army_sfx(total_samples: int) -> np.ndarray:
    """Scene-synchronized original procedural SFX (air puff, rubber squeak, acoustic rumble, Morse beeps)."""
    sfx = np.zeros(total_samples, dtype=np.float64)
    rng = np.random.default_rng(2323)

    def add_at(sec: float, sig: np.ndarray):
        i0 = int(round(sec * SR))
        if i0 < 0 or i0 >= total_samples:
            return
        n = min(len(sig), total_samples - i0)
        sfx[i0 : i0 + n] += sig[:n]

    # 1. Searchlight switch + rubber wobble squeak at 2.1s (f=63)
    lt = np.arange(int(0.42 * SR), dtype=np.float64) / SR
    squeak = 0.32 * np.sin(2 * np.pi * (420 + 260 * np.sin(14 * lt)) * lt) * np.exp(-lt * 6.5)
    add_at(2.10, squeak)

    # 2. Inflatable rubber pump air puffs during Scene 3 (8.4s, 9.1s, 9.8s)
    for t_puff in (8.45, 9.15, 9.85):
        pt = np.arange(int(0.28 * SR), dtype=np.float64) / SR
        puff = rng.standard_normal(len(pt)) * np.exp(-pt * 14.0) * np.minimum(1.0, pt / 0.02) * 0.24
        add_at(t_puff, puff)

    # 3. Sound truck acoustic low-end tank engine rumble during Scene 4 (12.2s - 15.4s)
    rt = np.arange(int(3.1 * SR), dtype=np.float64) / SR
    rumble = (
        0.26 * np.sin(2 * np.pi * 56.0 * rt)
        + 0.16 * np.sin(2 * np.pi * 112.0 * rt) * (0.6 + 0.4 * np.sin(2 * np.pi * 9.0 * rt))
    ) * np.minimum(1.0, rt / 0.25) * np.minimum(1.0, (3.1 - rt) / 0.35)
    add_at(12.2, rumble)

    # 4. Spoof Morse code radio beeps during Scene 5 (16.1s - 18.2s)
    morse_pattern = [(0.0, 0.09), (0.16, 0.22), (0.46, 0.09), (0.64, 0.09), (0.82, 0.22), (1.16, 0.09), (1.36, 0.22)]
    for off, d in morse_pattern:
        mt = np.arange(int(d * SR), dtype=np.float64) / SR
        beep = 0.22 * np.sin(2 * np.pi * 760.0 * mt) * np.minimum(1.0, mt / 0.008) * np.minimum(1.0, (d - mt) / 0.01)
        add_at(16.15 + off, beep)

    # 5. Closing deception sting swell at 28.8s
    ct = np.arange(int(0.9 * SR), dtype=np.float64) / SR
    sting = (0.20 * np.sin(2 * np.pi * 293.66 * ct) + 0.14 * np.sin(2 * np.pi * 440.0 * ct)) * np.exp(-ct * 2.8)
    add_at(28.85, sting)

    return sfx.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description="Mix Ghost Army 30s voiceover with procedural music & SFX")
    parser.add_argument("--voice", required=True)
    parser.add_argument("--duration", type=float, default=30.0)
    parser.add_argument("--out-wav", required=True)
    args = parser.parse_args()

    voice = decode_audio_mono_f32(args.voice)
    total_samples = max(len(voice), int(round(args.duration * SR)))
    music = build_ghost_army_music(total_samples)
    sfx = build_ghost_army_sfx(total_samples)

    mixed, report = mix_linear_spec_compliant(
        voice=voice,
        music=music,
        sfx=sfx,
        total_samples=total_samples,
        music_rel_db=-6.0,
        sfx_rel_db=-6.0,
    )
    write_stereo_wav_int16(args.out_wav, mixed, SR)
    report["ebur128"] = measure_ebur128(args.out_wav)
    report["musicProvenance"] = "original-procedural-dsp-ww2-espionage"
    report["sfxProvenance"] = "original-procedural-dsp-ghost-army"
    report["outputWav"] = os.path.abspath(args.out_wav)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
