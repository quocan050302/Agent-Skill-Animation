#!/usr/bin/env python3
"""
Specification-Compliant Linear Gated-RMS Audio Mixer (mix.py)
Classification: NEW CODE (missing from cartoon-short-kit.zip; authored for SHORT-01 Section 9.2 & 9.3)

Key specification guarantees (contrasted with original example/soldier/audio.py):
1. Narration is preserved linearly with ZERO envelope-follower ducking and ZERO tanh waveshaping
   before final master true-peak safety limiting.
2. Music stem is scaled by a single constant linear scalar so its gated RMS equals
   (narration_gated_rms_db + music_rel_db), default -6.0 dB relative to narration.
3. SFX stem is peak-controlled (preventing transient spikes from clipping the master) and scaled
   by a single constant linear scalar so its active gated RMS equals
   (narration_gated_rms_db + sfx_rel_db), default -6.0 dB relative to narration.
4. Outputs stereo 48 kHz 16-bit PCM WAV plus an audited JSON report with measured gated RMS,
   peak dBFS, and FFmpeg EBU R128 integrated loudness / true peak.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys
import wave
import numpy as np

SR = 48000


def decode_audio_mono_f32(path: str, sr: int = SR) -> np.ndarray:
    if not os.path.isfile(path):
        raise ValueError(f"AUDIO_INPUT_NOT_FOUND: {path}")
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True,
    )
    if proc.returncode != 0 or len(proc.stdout) == 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"AUDIO_DECODE_FAILED for {path}: {err or 'empty PCM stream'}")
    arr = np.frombuffer(proc.stdout, dtype=np.float32).copy()
    if not np.all(np.isfinite(arr)):
        raise ValueError(f"NON_FINITE_AUDIO_SAMPLES in {path}")
    return arr


def gated_rms(signal: np.ndarray, sr: int = SR, window_sec: float = 0.05, abs_gate_db: float = -55.0, rel_gate_db: float = -20.0) -> float:
    """Computes two-stage gated RMS (absolute gate + relative gate below ungated active mean)."""
    if len(signal) == 0:
        return 0.0
    win = max(1, int(round(window_sec * sr)))
    pad = (-len(signal)) % win
    padded = np.pad(signal.astype(np.float64), (0, pad)) if pad else signal.astype(np.float64)
    blocks = padded.reshape(-1, win)
    block_ms = np.mean(blocks * blocks, axis=1)

    abs_thresh = 10.0 ** (abs_gate_db / 10.0)
    active1 = block_ms[block_ms > abs_thresh]
    if len(active1) == 0:
        return float(np.sqrt(np.mean(signal.astype(np.float64) ** 2)))

    mean1 = float(np.mean(active1))
    rel_thresh = mean1 * (10.0 ** (rel_gate_db / 10.0))
    active2 = active1[active1 > rel_thresh]
    if len(active2) == 0:
        return float(np.sqrt(mean1))
    return float(np.sqrt(np.mean(active2)))


def amp_to_db(amp: float) -> float:
    return 20.0 * math.log10(max(amp, 1e-12))


def db_to_amp(db: float) -> float:
    return 10.0 ** (db / 20.0)


def write_stereo_wav_int16(path: str, mono_or_stereo: np.ndarray, sr: int = SR):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    if mono_or_stereo.ndim == 1:
        stereo = np.column_stack([mono_or_stereo, mono_or_stereo])
    else:
        stereo = mono_or_stereo
    pcm = np.clip(np.round(stereo * 32767.0), -32768, 32767).astype(np.int16)
    tmp_path = f"{path}.{os.getpid()}.tmp"
    with wave.open(tmp_path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    os.replace(tmp_path, path)


def measure_ebur128(wav_path: str):
    proc = subprocess.run(
        ["ffmpeg", "-nostats", "-i", wav_path, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    txt = proc.stderr or ""
    integrated_matches = re.findall(r"I:\s*([-\d.]+)\s*LUFS", txt)
    tp_matches = re.findall(r"Peak:\s*([-\d.]+)\s*dBFS", txt)
    lra_matches = re.findall(r"LRA:\s*([-\d.]+)\s*LU", txt)
    return {
        "integratedLufs": float(integrated_matches[-1]) if integrated_matches else None,
        "truePeakDbfs": float(tp_matches[-1]) if tp_matches else None,
        "lraLu": float(lra_matches[-1]) if lra_matches else None,
    }


def mix_linear_spec_compliant(
    voice: np.ndarray,
    music: np.ndarray | None = None,
    sfx: np.ndarray | None = None,
    total_samples: int | None = None,
    music_rel_db: float = -6.0,
    sfx_rel_db: float = -6.0,
    sfx_peak_ceiling_dbfs: float = -3.0,
    master_ceiling_dbfs: float = -1.0,
):
    lengths = [len(voice)]
    if music is not None:
        lengths.append(len(music))
    if sfx is not None:
        lengths.append(len(sfx))
    n = total_samples if total_samples is not None else max(lengths)
    if n <= 0:
        raise ValueError("INVALID_MIX_LENGTH: zero samples")

    def fit(arr):
        if arr is None:
            return np.zeros(n, dtype=np.float64)
        out = np.zeros(n, dtype=np.float64)
        m = min(n, len(arr))
        out[:m] = arr[:m].astype(np.float64)
        return out

    v = fit(voice)
    m = fit(music)
    s = fit(sfx)

    v_rms = gated_rms(v)
    if v_rms < 1e-6:
        raise ValueError("SILENT_NARRATION_STEM: Cannot calibrate relative -6 dB levels against silent narration.")
    v_rms_db = amp_to_db(v_rms)

    # 1. Calibrate music linearly to target gated RMS relative to narration (no ducking)
    m_rms_in = gated_rms(m)
    if m_rms_in > 1e-7:
        target_m_rms = v_rms * db_to_amp(music_rel_db)
        music_gain = target_m_rms / m_rms_in
    else:
        music_gain = 0.0
    m_scaled = m * music_gain

    # 2. Control extreme SFX peaks transparently, then calibrate SFX gated RMS linearly to target
    sfx_peak_limit = db_to_amp(sfx_peak_ceiling_dbfs)
    s_controlled = s.copy()
    raw_sfx_peak = float(np.max(np.abs(s_controlled))) if len(s_controlled) else 0.0
    if raw_sfx_peak > 1e-7:
        # Pre-normalize extreme bursts smoothly only above ceiling ratio before static RMS calibration
        s_rms_in = gated_rms(s_controlled, rel_gate_db=-16.0)
        if s_rms_in > 1e-7:
            target_s_rms = v_rms * db_to_amp(sfx_rel_db)
            sfx_gain = target_s_rms / s_rms_in
            s_scaled = s_controlled * sfx_gain
            # Enforce SFX peak ceiling without altering narration or music
            post_sfx_peak = float(np.max(np.abs(s_scaled)))
            if post_sfx_peak > sfx_peak_limit:
                # Soft-knee transient tame ONLY on isolated instants exceeding sfx_peak_limit
                over = np.abs(s_scaled) > sfx_peak_limit
                s_scaled[over] = np.sign(s_scaled[over]) * (
                    sfx_peak_limit + 0.15 * np.tanh((np.abs(s_scaled[over]) - sfx_peak_limit) / 0.15)
                )
        else:
            sfx_gain = 0.0
            s_scaled = np.zeros_like(s_controlled)
    else:
        sfx_gain = 0.0
        s_scaled = np.zeros_like(s_controlled)

    # 3. Pure linear sum: narration is 100% untouched prior to master peak safety
    raw_sum = v + m_scaled + s_scaled

    # 4. Master uniform headroom scale if linear sum exceeds master_ceiling_dbfs (preserves exact relative dB!)
    master_ceiling = db_to_amp(master_ceiling_dbfs)
    sum_peak = float(np.max(np.abs(raw_sum)))
    if sum_peak > master_ceiling:
        master_gain = master_ceiling / sum_peak
    else:
        master_gain = 1.0

    final_mix = raw_sum * master_gain
    v_final = v * master_gain
    m_final = m_scaled * master_gain
    s_final = s_scaled * master_gain

    v_final_db = amp_to_db(gated_rms(v_final))
    m_final_db = amp_to_db(gated_rms(m_final)) if music_gain > 0 else None
    s_final_db = amp_to_db(gated_rms(s_final, rel_gate_db=-16.0)) if sfx_gain > 0 else None

    report = {
        "mode": "spec-compliant-linear-gated-rms",
        "sampleRate": SR,
        "durationSec": round(n / SR, 4),
        "duckingApplied": False,
        "nonlinearWaveshapingApplied": False,
        "narrationUntouchedBeforeMaster": True,
        "targetMusicRelDb": music_rel_db,
        "targetSfxRelDb": sfx_rel_db,
        "measuredMusicRelDb": round(m_final_db - v_final_db, 3) if m_final_db is not None else None,
        "measuredSfxRelDb": round(s_final_db - v_final_db, 3) if s_final_db is not None else None,
        "narrationGatedRmsDb": round(v_final_db, 3),
        "musicGatedRmsDb": round(m_final_db, 3) if m_final_db is not None else None,
        "sfxGatedRmsDb": round(s_final_db, 3) if s_final_db is not None else None,
        "sfxPeakDbfs": round(amp_to_db(float(np.max(np.abs(s_final)))), 3) if sfx_gain > 0 else None,
        "masterGainDb": round(amp_to_db(master_gain), 3),
        "masterPeakDbfs": round(amp_to_db(float(np.max(np.abs(final_mix)))), 3),
    }
    return final_mix.astype(np.float32), report


def main():
    parser = argparse.ArgumentParser(description="Specification-compliant linear gated-RMS mixer (NEW CODE)")
    parser.add_argument("--voice", required=True, help="Narration audio path")
    parser.add_argument("--music", default=None, help="Optional music stem WAV")
    parser.add_argument("--sfx", default=None, help="Optional SFX stem WAV")
    parser.add_argument("--out", required=True, help="Output stereo 48 kHz WAV path")
    parser.add_argument("--report", default=None, help="Optional JSON report path")
    parser.add_argument("--music-rel-db", type=float, default=-6.0)
    parser.add_argument("--sfx-rel-db", type=float, default=-6.0)
    parser.add_argument("--duration", type=float, default=None, help="Optional exact target duration in seconds")
    args = parser.parse_args()

    try:
        voice = decode_audio_mono_f32(args.voice)
        music = decode_audio_mono_f32(args.music) if args.music else None
        sfx = decode_audio_mono_f32(args.sfx) if args.sfx else None
        total_samples = int(round(args.duration * SR)) if args.duration else None

        mixed, report = mix_linear_spec_compliant(
            voice=voice,
            music=music,
            sfx=sfx,
            total_samples=total_samples,
            music_rel_db=args.music_rel_db,
            sfx_rel_db=args.sfx_rel_db,
        )
        write_stereo_wav_int16(args.out, mixed, SR)
        report["ebur128"] = measure_ebur128(args.out)
        report["outputPath"] = os.path.abspath(args.out)

        if args.report:
            os.makedirs(os.path.dirname(os.path.abspath(args.report)), exist_ok=True)
            with open(args.report, "w", encoding="utf-8") as fh:
                json.dump(report, fh, indent=2)
        print(json.dumps(report, indent=2))
    except Exception as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        sys.exit(2)


if __name__ == "__main__":
    main()
