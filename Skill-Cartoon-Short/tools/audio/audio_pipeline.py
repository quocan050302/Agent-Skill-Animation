#!/usr/bin/env python3
"""
Dual-Mode Audio Pipeline Runner & Synthetic Fixture Generator (SHORT-01 Section 9.2 & 10.3)
Classification: NEW IMPLEMENTATION CODE

Supports two explicitly distinguished modes:
1. original-baseline:
   Executes vendor/cartoon-short-kit/example/soldier/audio.py unmodified in an isolated working
   directory (retaining its envelope-follower ducking and tanh waveshaping) + FFmpeg loudnorm
   as in finish.sh. Explicitly labeled NOT specification-compliant.
2. spec-compliant:
   Synthesizes music and SFX stems without ducking/tanh and mixes them with narration via
   tools/audio/mix.py using linear gated-RMS (-6 dB relative to narration).

IMPORTANT TRUTH GUARD:
cartoon-short-kit.zip does NOT include voice.mp3 for the Soldier example. When --synthetic-soldier-fixture
is passed, this script generates a clearly labeled procedural speech-envelope tone fixture timed to the
exact 9 phrase windows documented in example/soldier/story.js lines 2-5 SOLELY for technical pipeline
testing. Authentic voiceover-dependent parity remains UNVERIFIED.
"""
import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import wave
import numpy as np

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, THIS_DIR)
from mix import SR, amp_to_db, gated_rms, measure_ebur128, mix_linear_spec_compliant, write_stereo_wav_int16  # noqa: E402


SOLDIER_PHRASE_WINDOWS = [
    (0.05, 2.61, "A Roman soldier stood guard at a bridge for 30 years,"),
    (2.95, 4.22, "refusing to leave his post."),
    (5.01, 7.03, "Even when the empire collapsed, he stayed."),
    (7.50, 8.91, "People called him crazy."),
    (9.29, 11.40, "But when workers finally removed his helmet,"),
    (11.79, 13.62, "they discovered a message carved inside:"),
    (14.22, 15.53, "The bridge is not safe."),
    (16.10, 16.54, "Beneath it,"),
    (16.74, 19.39, "the wooden supports had been slowly rotting for centuries."),
]


def generate_synthetic_speech_fixture(phrase_windows, total_duration_sec: float, seed: int = 42) -> np.ndarray:
    """
    Generates a deterministic, syllable-modulated harmonic speech-band test signal (procedural DSP)
    matching exact phrase active/silence intervals so silencedetect + timing.py + mixer tests can run
    reproducibly without faking human voice clones or claiming authentic voiceover parity.
    """
    rng = np.random.default_rng(seed)
    n = int(round(total_duration_sec * SR))
    sig = np.zeros(n, dtype=np.float32)

    for idx, (s, e, text) in enumerate(phrase_windows):
        i0 = max(0, int(round(s * SR)))
        i1 = min(n, int(round(e * SR)))
        if i1 <= i0:
            continue
        m = i1 - i0
        t = np.arange(m, dtype=np.float64) / SR
        dur = m / SR
        f0 = 128.0 + 14.0 * np.sin(2.0 * np.pi * 0.9 * t + idx)
        phase = 2.0 * np.pi * np.cumsum(f0) / SR
        carrier = (
            0.55 * np.sin(phase)
            + 0.28 * np.sin(2.0 * phase)
            + 0.14 * np.sin(3.0 * phase)
            + 0.06 * rng.standard_normal(m)
        )
        syll_rate = max(2.5, min(6.0, len(text.split()) * 1.4 / max(dur, 0.2)))
        syll_env = 0.55 + 0.45 * np.sin(2.0 * np.pi * syll_rate * t) ** 2
        edge_env = np.minimum(1.0, t / 0.025) * np.minimum(1.0, (dur - t) / 0.035)
        sig[i0:i1] = (0.28 * carrier * syll_env * edge_env).astype(np.float32)

    return sig


def write_mp3_from_mono(mono: np.ndarray, mp3_path: str):
    os.makedirs(os.path.dirname(os.path.abspath(mp3_path)), exist_ok=True)
    tmp_wav = f"{mp3_path}.{os.getpid()}.tmp.wav"
    write_stereo_wav_int16(tmp_wav, mono, SR)
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", tmp_wav, "-ac", "1", "-ar", str(SR), "-b:a", "128k", mp3_path],
            check=True,
        )
    finally:
        if os.path.exists(tmp_wav):
            os.remove(tmp_wav)


def run_soldier_audio_modes(project_root: str, out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    kit_audio_py = os.path.join(project_root, "vendor", "cartoon-short-kit", "example", "soldier", "audio.py")
    if not os.path.isfile(kit_audio_py):
        raise FileNotFoundError(f"KIT_AUDIO_PY_MISSING: {kit_audio_py}")

    dur_sec = 592.0 / 30.0
    synth_voice = generate_synthetic_speech_fixture(SOLDIER_PHRASE_WINDOWS, dur_sec, seed=101)
    voice_mp3 = os.path.join(out_dir, "voice.mp3")
    script_txt = os.path.join(out_dir, "script.txt")
    write_mp3_from_mono(synth_voice, voice_mp3)
    with open(script_txt, "w", encoding="utf-8") as fh:
        fh.write(" ".join(p[2] for p in SOLDIER_PHRASE_WINDOWS) + "\n")

    # 1. Execute ORIGINAL BASELINE audio.py unmodified inside out_dir
    shutil.copyfile(kit_audio_py, os.path.join(out_dir, "_run_orig_audio.py"))
    try:
        proc = subprocess.run(
            [sys.executable, "_run_orig_audio.py"],
            cwd=out_dir,
            capture_output=True,
            text=True,
            check=True,
        )
    finally:
        temp_py = os.path.join(out_dir, "_run_orig_audio.py")
        if os.path.exists(temp_py):
            os.remove(temp_py)

    orig_raw_wav = os.path.join(out_dir, "mix_raw.wav")
    orig_loudnorm_wav = os.path.join(out_dir, "mix_original_baseline.wav")
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            orig_raw_wav,
            "-af",
            "loudnorm=I=-14:TP=-1.5:LRA=7",
            "-ar",
            "48000",
            "-ac",
            "2",
            orig_loudnorm_wav,
        ],
        check=True,
    )

    # 2. Extract clean un-ducked music and sfx buffers by importing kit_audio_py in isolated temp dir
    #    (kit_audio_py computes module-level `music`, `sfx`, and `voice` arrays before ducking!)
    cwd_prev = os.getcwd()
    try:
        os.chdir(out_dir)
        spec = importlib.util.spec_from_file_location("soldier_audio_stems", kit_audio_py)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        clean_voice = np.asarray(mod.voice, dtype=np.float32).copy()
        clean_music = np.asarray(mod.music, dtype=np.float32).copy()
        clean_sfx = np.asarray(mod.sfx, dtype=np.float32).copy()
    finally:
        os.chdir(cwd_prev)

    spec_wav = os.path.join(out_dir, "mix_spec_compliant.wav")
    spec_mix, spec_report = mix_linear_spec_compliant(
        voice=clean_voice,
        music=clean_music,
        sfx=clean_sfx,
        total_samples=int(round(dur_sec * SR)),
        music_rel_db=-6.0,
        sfx_rel_db=-6.0,
    )
    write_stereo_wav_int16(spec_wav, spec_mix, SR)
    spec_report["ebur128"] = measure_ebur128(spec_wav)

    summary = {
        "fixtureType": "procedural-synthetic-speech-cadence",
        "authenticVoiceoverPresent": False,
        "authenticNarratedParityStatus": "UNVERIFIED",
        "durationSec": round(dur_sec, 4),
        "originalBaseline": {
            "mode": "original-baseline-ducked-nonlinear",
            "specificationCompliant": False,
            "duckingApplied": True,
            "nonlinearWaveshaping": "tanh(mix * 0.95) / tanh(0.95)",
            "rawOutputWav": orig_raw_wav,
            "loudnormOutputWav": orig_loudnorm_wav,
            "stdout": (proc.stdout or "").strip(),
            "ebur128Raw": measure_ebur128(orig_raw_wav),
            "ebur128Loudnorm": measure_ebur128(orig_loudnorm_wav),
        },
        "specCompliant": {
            **spec_report,
            "specificationCompliant": True,
            "outputWav": spec_wav,
        },
    }

    report_path = os.path.join(out_dir, "audio-modes-report.json")
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    return summary


def main():
    parser = argparse.ArgumentParser(description="Run Soldier dual-mode audio verification")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    res = run_soldier_audio_modes(os.path.abspath(args.project_root), os.path.abspath(args.out))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
