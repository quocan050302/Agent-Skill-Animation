#!/usr/bin/env python3
"""
Procedural Audio Generator for New 10-Second Proof ("Sold Out at Fresh-Mart")
Classification: NEW IMPLEMENTATION CODE (SHORT-01 Phase G)

Generates 100% procedural DSP narration fixture, quirky supermarket organ bed, and foley SFX
(automatic door chime/slide, shambling footsteps, tin can clatter/roll, record-stop sting,
shock chord, sad trombone slide), then mixes linearly via tools/audio/mix.py (-6.0 dB gated RMS).
"""
import argparse
import json
import os
import sys
import numpy as np

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "audio"))
from audio_pipeline import generate_synthetic_speech_fixture  # noqa: E402
from mix import SR, measure_ebur128, mix_linear_spec_compliant, write_stereo_wav_int16  # noqa: E402

DUR = 10.0
N = int(DUR * SR)

ZOMBIE_PHRASES = [
    (0.18, 2.28, "Midnight at Fresh Mart, one hungry zombie shambles down Aisle Four."),
    (2.58, 4.55, "He reaches for the organic brains shelf, and knocks the last tin can away."),
    (4.90, 6.32, "Wait a second: completely sold out?!"),
    (6.58, 8.18, "Pure undead devastation under flickering aisle lights!"),
    (8.42, 9.76, "Guess tonight it is tofu in Aisle Nine."),
]


def midi_hz(m: float) -> float:
    return 440.0 * (2.0 ** ((m - 69.0) / 12.0))


def place(buf: np.ndarray, sig: np.ndarray, t0: float, gain: float = 1.0):
    i = max(0, int(round(t0 * SR)))
    j = min(len(buf), i + len(sig))
    if j > i:
        buf[i:j] += sig[: j - i].astype(np.float32) * gain


def build_zombie_stems():
    rng = np.random.default_rng(2026)
    voice = generate_synthetic_speech_fixture(ZOMBIE_PHRASES, DUR, seed=2026)

    # Supermarket cheesy organ muzak (stops abruptly at 4.83s on SOLD OUT reveal!)
    music = np.zeros(N, dtype=np.float32)
    beat = 60.0 / 116.0
    chords = [[60, 64, 67, 71], [62, 65, 69, 72], [67, 71, 74, 77], [60, 64, 67, 72]]
    tt = 0.0
    step_idx = 0
    while tt < 4.82:
        ch = chords[step_idx % len(chords)]
        dur = min(beat * 2.0, 4.82 - tt)
        m = int(dur * SR)
        t = np.arange(m) / SR
        tone = sum(
            0.5 * np.sin(2 * np.pi * midi_hz(note) * t) + 0.2 * np.sin(4 * np.pi * midi_hz(note) * t)
            for note in ch
        ) / len(ch)
        env = np.minimum(1.0, t / 0.02) * np.minimum(1.0, (dur - t) / 0.04)
        place(music, (tone * env).astype(np.float32), tt, 0.32)
        tt += beat * 2.0
        step_idx += 1

    # Suspense / melancholy low pad after 6.5s
    pad_dur = DUR - 6.5
    mp = int(pad_dur * SR)
    tp = np.arange(mp) / SR
    pad = (
        0.5 * np.sin(2 * np.pi * midi_hz(48) * tp)
        + 0.35 * np.sin(2 * np.pi * midi_hz(51) * tp)
        + 0.25 * np.sin(2 * np.pi * midi_hz(55) * tp)
    ) * np.minimum(1.0, tp / 0.3) * np.minimum(1.0, (pad_dur - tp) / 0.35)
    place(music, pad.astype(np.float32), 6.5, 0.24)

    # Procedural Foley SFX
    sfx = np.zeros(N, dtype=np.float32)

    # 1) Store ding-dong chime + sliding glass whoosh (f=2..30)
    for idx, note in enumerate([76, 72]):
        mc = int(0.38 * SR)
        tc = np.arange(mc) / SR
        ding = np.sin(2 * np.pi * midi_hz(note) * tc) * np.exp(-tc * 6.5)
        place(sfx, ding, 0.08 + idx * 0.24, 0.45)

    mw = int(0.65 * SR)
    tw = np.arange(mw) / SR
    door_whoosh = rng.standard_normal(mw) * np.sin(np.pi * tw / 0.65) ** 2 * 0.18
    place(sfx, door_whoosh, 0.15, 0.6)

    # 2) Shambling footsteps (0.4s .. 2.3s)
    for k in range(5):
        ms = int(0.14 * SR)
        ts = np.arange(ms) / SR
        step_snd = np.sin(2 * np.pi * (95 - 35 * ts / 0.14) * ts) * np.exp(-ts * 22)
        place(sfx, step_snd, 0.42 + k * 0.42, 0.42)

    # 3) Tin can clatter & floor bounce (f=100..125 -> 3.33s..4.15s)
    for dt, gain in [(3.58, 0.65), (3.76, 0.42), (3.90, 0.26)]:
        mc = int(0.22 * SR)
        tc = np.arange(mc) / SR
        can_hit = (
            0.5 * np.sin(2 * np.pi * 890 * tc) * np.exp(-tc * 18)
            + 0.4 * np.sin(2 * np.pi * 1340 * tc) * np.exp(-tc * 24)
            + 0.25 * rng.standard_normal(mc) * np.exp(-tc * 35)
        )
        place(sfx, can_hit, dt, gain)

    # 4) Whip reveal sting at f=145 (4.83s) + close-up shock stab at f=195 (6.50s)
    for t_sting, base_note in [(4.83, 55), (6.50, 61)]:
        mst = int(0.55 * SR)
        tst = np.arange(mst) / SR
        stab = (
            np.sin(2 * np.pi * midi_hz(base_note) * tst)
            + 0.8 * np.sin(2 * np.pi * midi_hz(base_note + 6) * tst)
        ) * np.exp(-tst * 5.0)
        place(sfx, stab, t_sting, 0.5)

    # 5) Sad downward slide at slump ending (f=254 -> 8.47s)
    msl = int(1.1 * SR)
    tsl = np.arange(msl) / SR
    f_slide = np.linspace(midi_hz(62), midi_hz(50), msl)
    ph = 2 * np.pi * np.cumsum(f_slide) / SR
    sad_slide = (0.6 * np.sin(ph) + 0.3 * np.sin(2 * ph)) * np.minimum(1.0, tsl / 0.05) * np.exp(-tsl * 1.8)
    place(sfx, sad_slide, 8.47, 0.55)

    return voice, music, sfx


def generate_zombie_audio(out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    voice, music, sfx = build_zombie_stems()
    voice_wav = os.path.join(out_dir, "voice_procedural.wav")
    music_wav = os.path.join(out_dir, "music_procedural.wav")
    sfx_wav = os.path.join(out_dir, "sfx_procedural.wav")
    mix_wav = os.path.join(out_dir, "mix_spec_compliant.wav")
    script_txt = os.path.join(out_dir, "script.txt")

    write_stereo_wav_int16(voice_wav, voice, SR)
    write_stereo_wav_int16(music_wav, music, SR)
    write_stereo_wav_int16(sfx_wav, sfx, SR)
    with open(script_txt, "w", encoding="utf-8") as fh:
        fh.write(" ".join(p[2] for p in ZOMBIE_PHRASES) + "\n")

    mixed, report = mix_linear_spec_compliant(
        voice=voice,
        music=music,
        sfx=sfx,
        total_samples=N,
        music_rel_db=-6.0,
        sfx_rel_db=-6.0,
    )
    write_stereo_wav_int16(mix_wav, mixed, SR)
    report["ebur128"] = measure_ebur128(mix_wav)
    report["audioSourceOrigin"] = "procedural"
    report["outputWav"] = os.path.abspath(mix_wav)

    with open(os.path.join(out_dir, "audio_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    print(json.dumps(generate_zombie_audio(os.path.abspath(args.out)), indent=2))
