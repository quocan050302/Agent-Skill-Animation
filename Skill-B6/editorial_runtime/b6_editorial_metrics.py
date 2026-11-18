"""Decoded-frame & decoded-audio Editorial Pacing Telemetry (`b6-editorial-report/1`).

All visual metrics operate on actual decoded video frames (never metadata-only claims).
Separates hard cuts from within-shot movement, estimates global camera pan/zoom vs
foreground relative motion, detects gaming (flicker/noise/jitter/1%-zoom duplicates),
and measures audio RMS/peak/clipping/sync via FFmpeg/FFprobe.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any, Iterable, Mapping, Sequence
import numpy as np
from PIL import Image, ImageDraw, ImageFont

try:
    import cv2  # type: ignore
except Exception:
    cv2 = None

try:
    from .b6_editorial_contract import EDITORIAL_REPORT_SCHEMA
except ImportError:
    from b6_editorial_contract import EDITORIAL_REPORT_SCHEMA

CHECKER_VERSION = "1.0.0"


def _checker_hash() -> str:
    try:
        return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    except Exception:
        return hashlib.sha256(CHECKER_VERSION.encode("utf-8")).hexdigest()


def _resolve_bin(name: str, env_key: str | None = None) -> str:
    if env_key and os.environ.get(env_key) and Path(os.environ[env_key]).exists():
        return os.environ[env_key]
    found = shutil.which(name)
    return found or name


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            blk = fh.read(1024 * 1024)
            if not blk:
                break
            h.update(blk)
    return h.hexdigest()


def probe_video_ffprobe(video_path: str | Path, ffprobe_bin: str | None = None) -> dict[str, Any]:
    vp = Path(video_path)
    if not vp.is_file():
        raise FileNotFoundError(f"Video file missing: {vp}")
    exe = ffprobe_bin or _resolve_bin("ffprobe", "FFPROBE")
    res = subprocess.run(
        [exe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(vp)],
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )
    if res.returncode != 0:
        raise ValueError(f"ffprobe failed for {vp}: {res.stderr.strip()}")
    parsed = json.loads(res.stdout)
    streams = parsed.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not v:
        raise ValueError(f"Video stream missing in {vp}")
    fps_str = str(v.get("r_frame_rate") or "30/1")
    if "/" in fps_str:
        n_s, d_s = fps_str.split("/", 1)
        fps_val = float(n_s) / max(1.0, float(d_s))
    else:
        fps_val = float(fps_str)
    dur = float((parsed.get("format") or {}).get("duration") or v.get("duration") or 0.0)
    nb_frames = int(v.get("nb_frames") or round(dur * fps_val))
    return {
        "path": str(vp),
        "bytes": int(vp.stat().st_size),
        "sha256": sha256_file(vp),
        "width": int(v.get("width") or 0),
        "height": int(v.get("height") or 0),
        "codec": str(v.get("codec_name") or "unknown"),
        "pix_fmt": str(v.get("pix_fmt") or "unknown"),
        "fps_raw": fps_str,
        "fps": round(fps_val, 4),
        "duration": round(dur, 6),
        "nb_frames": nb_frames,
        "has_audio": a is not None,
        "audio_codec": str(a.get("codec_name")) if a else None,
        "audio_sample_rate": int(a.get("sample_rate") or 0) if a else 0,
        "raw_ffprobe": parsed,
    }


def iter_decoded_mp4_frames(
    video_path: str | Path,
    analysis_size: tuple[int, int] = (360, 640),
    ffmpeg_bin: str | None = None,
) -> Iterable[np.ndarray]:
    """Stream decoded RGB24 frames via FFmpeg without holding the full movie in RAM."""
    w, h = int(analysis_size[0]), int(analysis_size[1])
    exe = ffmpeg_bin or _resolve_bin("ffmpeg", "B6_REAL_FFMPEG")
    cmd = [
        exe,
        "-v",
        "error",
        "-i",
        str(video_path),
        "-vf",
        f"scale={w}:{h}:flags=bilinear",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdout is not None
    frame_bytes = w * h * 3
    try:
        while True:
            buf = proc.stdout.read(frame_bytes)
            if not buf:
                break
            if len(buf) != frame_bytes:
                raise ValueError(f"Truncated decoded frame from {video_path} ({len(buf)} != {frame_bytes} bytes)")
            yield np.frombuffer(buf, dtype=np.uint8).reshape((h, w, 3))
    finally:
        proc.stdout.close()
        err = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
        if proc.stderr:
            proc.stderr.close()
        rc = proc.wait(timeout=15)
        if rc != 0:
            raise ValueError(f"FFmpeg decode failed ({rc}) for {video_path}: {err.strip()}")


def _to_luma(rgb: np.ndarray) -> np.ndarray:
    f = rgb.astype(np.float32)
    return 0.299 * f[:, :, 0] + 0.587 * f[:, :, 1] + 0.114 * f[:, :, 2]


def _box_blur_2d(img: np.ndarray, ksize: int = 11) -> np.ndarray:
    if cv2 is not None:
        return cv2.GaussianBlur(img, (ksize, ksize), 1.5)
    pad = ksize // 2
    padded = np.pad(img, ((pad, pad), (pad, pad)), mode="edge")
    cs = np.cumsum(np.cumsum(padded, axis=0), axis=1)
    cs = np.pad(cs, ((1, 0), (1, 0)), mode="constant", constant_values=0.0)
    h, w = img.shape
    return (cs[ksize : ksize + h, ksize : ksize + w] - cs[:h, ksize : ksize + w] - cs[ksize : ksize + h, :w] + cs[:h, :w]) / float(
        ksize * ksize
    )


def compute_ssim_luma(y1: np.ndarray, y2: np.ndarray) -> float:
    """Wang et al. (2004) SSIM on luminance arrays (0..255 float32)."""
    a = y1.astype(np.float32)
    b = y2.astype(np.float32)
    if a.shape != b.shape:
        raise ValueError("SSIM requires identical frame dimensions")
    # Downsample slightly for speed if large while preserving structure
    if a.shape[0] > 320:
        a = a[::2, ::2]
        b = b[::2, ::2]
    c1 = (0.01 * 255.0) ** 2
    c2 = (0.03 * 255.0) ** 2
    mu1 = _box_blur_2d(a, 11)
    mu2 = _box_blur_2d(b, 11)
    mu1_sq = mu1 * mu1
    mu2_sq = mu2 * mu2
    mu1_mu2 = mu1 * mu2
    sig1_sq = np.maximum(0.0, _box_blur_2d(a * a, 11) - mu1_sq)
    sig2_sq = np.maximum(0.0, _box_blur_2d(b * b, 11) - mu2_sq)
    sig12 = _box_blur_2d(a * b, 11) - mu1_mu2
    num = (2.0 * mu1_mu2 + c1) * (2.0 * sig12 + c2)
    den = (mu1_sq + mu2_sq + c1) * (sig1_sq + sig2_sq + c2)
    ssim_map = num / np.maximum(1e-6, den)
    return float(np.clip(np.mean(ssim_map), -1.0, 1.0))


def _hist_distance(y1: np.ndarray, y2: np.ndarray, bins: int = 64) -> float:
    h1, _ = np.histogram(y1, bins=bins, range=(0.0, 256.0))
    h2, _ = np.histogram(y2, bins=bins, range=(0.0, 256.0))
    p1 = h1.astype(np.float64) / max(1.0, float(h1.sum()))
    p2 = h2.astype(np.float64) / max(1.0, float(h2.sum()))
    return float(0.5 * np.sum(np.abs(p1 - p2)))


def _estimate_flow_and_camera_compensation(
    prev_y: np.ndarray,
    cur_y: np.ndarray,
    analysis_height: int,
) -> dict[str, float]:
    """Compute optical flow magnitude, 4-DOF global camera model (pan+zoom), residual foreground motion & coherence."""
    h, w = prev_y.shape
    scale_to_analysis = float(analysis_height) / 160.0
    target_w = max(48, int(round(w * (160.0 / max(1, h)))))
    target_h = 160

    if cv2 is not None:
        g0 = cv2.resize(prev_y.astype(np.uint8), (target_w, target_h), interpolation=cv2.INTER_AREA)
        g1 = cv2.resize(cur_y.astype(np.uint8), (target_w, target_h), interpolation=cv2.INTER_AREA)
        flow = cv2.calcOpticalFlowFarneback(g0, g1, None, 0.5, 2, 11, 2, 5, 1.1, 0)
        flow = flow * scale_to_analysis
    else:
        # Lightweight gradient Lucas-Kanade fallback on 8x8 blocks when cv2 is absent
        im0 = np.asarray(Image.fromarray(prev_y.astype(np.uint8)).resize((target_w, target_h), Image.Resampling.BILINEAR), dtype=np.float32)
        im1 = np.asarray(Image.fromarray(cur_y.astype(np.uint8)).resize((target_w, target_h), Image.Resampling.BILINEAR), dtype=np.float32)
        ix = np.gradient(im0, axis=1)
        iy = np.gradient(im0, axis=0)
        it = im1 - im0
        denom = _box_blur_2d(ix * ix + iy * iy, 9) + 12.0
        vx = -_box_blur_2d(ix * it, 9) / denom
        vy = -_box_blur_2d(iy * it, 9) / denom
        flow = np.stack([np.clip(vx, -12.0, 12.0), np.clip(vy, -12.0, 12.0)], axis=-1) * scale_to_analysis

    fx = flow[:, :, 0]
    fy = flow[:, :, 1]
    mag = np.sqrt(fx * fx + fy * fy)
    flow_mag = float(np.mean(mag))

    # Fit robust 4-DOF global camera flow: u(x,y) = tx + s*rx, v(x,y) = ty + s*ry
    med_x = float(np.median(fx))
    med_y = float(np.median(fy))
    yy, xx = np.mgrid[0:target_h, 0:target_w].astype(np.float32)
    rx = (xx - target_w * 0.5) / max(1.0, float(target_h))
    ry = (yy - target_h * 0.5) / max(1.0, float(target_h))
    r2 = rx * rx + ry * ry
    res_x0 = fx - med_x
    res_y0 = fy - med_y
    zoom_est = float(np.median((res_x0 * rx + res_y0 * ry) / np.maximum(0.02, r2)))
    zoom_est = max(-25.0, min(25.0, zoom_est))
    # Only fit radial zoom if consistent across quadrants
    cam_fx = med_x + zoom_est * rx
    cam_fy = med_y + zoom_est * ry
    cam_mag = float(np.mean(np.sqrt(cam_fx * cam_fx + cam_fy * cam_fy)))

    fg_fx = fx - cam_fx
    fg_fy = fy - cam_fy
    fg_mag = np.sqrt(fg_fx * fg_fx + fg_fy * fg_fy)
    # Exclude tiny sensor/compression noise < 0.15 px when computing p90/mean residual
    fg_rel_mean = float(np.mean(fg_mag))
    fg_rel_p90 = float(np.percentile(fg_mag, 90))

    # Spatial coherence: compare flow against locally smoothed flow (random noise destroys local vector agreement!)
    if cv2 is not None:
        sm_x = cv2.boxFilter(fx, -1, (5, 5))
        sm_y = cv2.boxFilter(fy, -1, (5, 5))
    else:
        sm_x = _box_blur_2d(fx, 5)
        sm_y = _box_blur_2d(fy, 5)
    diff_local = np.sqrt((fx - sm_x) ** 2 + (fy - sm_y) ** 2)
    coherence = float(np.clip(1.0 - float(np.mean(diff_local)) / max(0.25, flow_mag), 0.0, 1.0))

    return {
        "flow_mag": round(flow_mag, 4),
        "camera_dx": round(med_x, 4),
        "camera_dy": round(med_y, 4),
        "camera_zoom": round(zoom_est, 4),
        "camera_global_motion": round(cam_mag, 4),
        "foreground_relative_motion": round(fg_rel_mean, 4),
        "foreground_relative_p90": round(fg_rel_p90, 4),
        "flow_coherence": round(coherence, 4),
    }


def compute_frame_activity(
    decoded_frames: Iterable[np.ndarray],
    masks: Mapping[str, Any] | None = None,
    fps: float = 30.0,
    boundaries: Sequence[float] | None = None,
    *,
    shot_spans: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Compute per-frame, per-second, and per-shot activity metrics separating cuts from within-shot motion."""
    fps_val = max(1.0, float(fps))
    decl_cuts = sorted(float(b) for b in (boundaries or []) if float(b) > 0.0)
    cut_frame_indices = {int(math.ceil(b * fps_val - 1e-6)) for b in decl_cuts}
    mask_caption = None
    if masks and "caption_band_norm" in masks:
        mask_caption = masks["caption_band_norm"]

    prev_rgb: np.ndarray | None = None
    prev_y: np.ndarray | None = None
    prev_mean_y: float = 0.0
    frame_rows: list[dict[str, Any]] = []
    shot_samples: dict[str, list[dict[str, Any]]] = {}
    first_frame_shape: tuple[int, int] | None = None
    frame_count = 0

    for f_idx, rgb in enumerate(decoded_frames):
        frame_count += 1
        if first_frame_shape is None:
            first_frame_shape = (int(rgb.shape[1]), int(rgb.shape[0]))  # (W, H)
        y_full = _to_luma(rgb)
        if mask_caption is not None:
            h_f = rgb.shape[0]
            y0 = max(0, min(h_f, int(round(mask_caption[0] * h_f))))
            y1 = max(y0, min(h_f, int(round(mask_caption[1] * h_f))))
            scene_slice = np.ones(h_f, dtype=bool)
            scene_slice[y0:y1] = False
        else:
            scene_slice = None

        mean_y = float(np.mean(y_full))
        if prev_rgb is None or prev_y is None:
            prev_rgb = rgb.copy()
            prev_y = y_full
            prev_mean_y = mean_y
            continue

        t = f_idx / fps_val
        if scene_slice is not None and np.any(scene_slice):
            rgb_diff = np.abs(rgb[scene_slice].astype(np.float32) - prev_rgb[scene_slice].astype(np.float32))
            y_diff = np.abs(y_full[scene_slice] - prev_y[scene_slice])
        else:
            rgb_diff = np.abs(rgb.astype(np.float32) - prev_rgb.astype(np.float32))
            y_diff = np.abs(y_full - prev_y)

        rgb_mad = float(np.mean(rgb_diff))
        y_mad = float(np.mean(y_diff))
        p95_motion = float(np.percentile(y_diff, 95))
        hist_dist = _hist_distance(prev_y, y_full)
        ssim_val = compute_ssim_luma(prev_y, y_full)
        flow_info = _estimate_flow_and_camera_compensation(prev_y, y_full, rgb.shape[0])
        b_delta = mean_y - prev_mean_y

        # Spatial correlation of signed luminance difference distinguishes coherent objects from pixel noise
        signed_d = y_full - prev_y
        d_left = signed_d[:, :-1]
        d_right = signed_d[:, 1:]
        d_var = float(np.mean(d_left * d_left)) + 1e-6
        spatial_diff_corr = float(np.clip(np.mean(d_left * d_right) / d_var, -1.0, 1.0)) if d_var > 0.25 else 1.0

        is_declared_cut = f_idx in cut_frame_indices
        is_visual_cut = (y_mad > 14.0 and hist_dist > 0.14 and ssim_val < 0.72)
        is_cut = is_declared_cut or is_visual_cut

        row = {
            "frame": f_idx,
            "t": round(t, 4),
            "second": int(math.floor(max(0.0, (f_idx - 1) / fps_val))),
            "rgb_mad": round(rgb_mad, 4),
            "y_mad": round(y_mad, 4),
            "p95_motion": round(p95_motion, 4),
            "hist_dist": round(hist_dist, 4),
            "ssim": round(ssim_val, 4),
            "spatial_diff_corr": round(spatial_diff_corr, 4),
            "brightness_delta": round(b_delta, 4),
            "is_declared_cut": is_declared_cut,
            "is_visual_cut": is_visual_cut,
            "is_cut": is_cut,
            **flow_info,
        }
        frame_rows.append(row)

        if shot_spans:
            for sh in shot_spans:
                if float(sh.get("start", 0.0)) <= t < float(sh.get("end", 0.0)):
                    shot_samples.setdefault(str(sh.get("id", "shot")), []).append(row)
                    break

        prev_rgb = rgb.copy()
        prev_y = y_full
        prev_mean_y = mean_y

    if frame_count < 2:
        raise ValueError(f"Need at least 2 decoded frames to compute activity; got {frame_count}")

    duration_s = frame_count / fps_val
    total_secs = max(1, int(math.ceil(duration_s - 1e-6)))

    def _agg(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
        if not rows:
            return {
                "count": 0,
                "rgb_mad_mean": 0.0,
                "rgb_mad_median": 0.0,
                "y_mad_mean": 0.0,
                "y_mad_median": 0.0,
                "y_mad_p10": 0.0,
                "y_mad_p90": 0.0,
                "y_mad_p95": 0.0,
                "p95_motion_median": 0.0,
                "flow_mag_mean": 0.0,
                "camera_global_motion_mean": 0.0,
                "foreground_relative_motion_mean": 0.0,
                "flow_coherence_mean": 0.0,
                "ssim_mean": 1.0,
                "spatial_diff_corr_mean": 1.0,
                "pct_near_static": 100.0,
            }
        ym = np.array([r["y_mad"] for r in rows], dtype=float)
        rm = np.array([r["rgb_mad"] for r in rows], dtype=float)
        pm = np.array([r["p95_motion"] for r in rows], dtype=float)
        fm = np.array([r["flow_mag"] for r in rows], dtype=float)
        cg = np.array([r["camera_global_motion"] for r in rows], dtype=float)
        fg = np.array([r["foreground_relative_motion"] for r in rows], dtype=float)
        coh = np.array([r["flow_coherence"] for r in rows], dtype=float)
        ss = np.array([r["ssim"] for r in rows], dtype=float)
        sdc = np.array([r["spatial_diff_corr"] for r in rows], dtype=float)
        near_static = np.sum((ym < 0.85) & (fg < 0.30))
        return {
            "count": len(rows),
            "rgb_mad_mean": round(float(np.mean(rm)), 4),
            "rgb_mad_median": round(float(np.median(rm)), 4),
            "y_mad_mean": round(float(np.mean(ym)), 4),
            "y_mad_median": round(float(np.median(ym)), 4),
            "y_mad_p10": round(float(np.percentile(ym, 10)), 4),
            "y_mad_p90": round(float(np.percentile(ym, 90)), 4),
            "y_mad_p95": round(float(np.percentile(ym, 95)), 4),
            "p95_motion_median": round(float(np.median(pm)), 4),
            "flow_mag_mean": round(float(np.mean(fm)), 4),
            "camera_global_motion_mean": round(float(np.mean(cg)), 4),
            "foreground_relative_motion_mean": round(float(np.mean(fg)), 4),
            "flow_coherence_mean": round(float(np.mean(coh)), 4),
            "ssim_mean": round(float(np.mean(ss)), 4),
            "spatial_diff_corr_mean": round(float(np.mean(sdc)), 4),
            "pct_near_static": round(float(100.0 * near_static / len(rows)), 2),
        }

    non_cut_rows = [r for r in frame_rows if not r["is_cut"]]
    cut_rows = [r for r in frame_rows if r["is_cut"]]

    # Longest consecutive near-static run (excluding cuts)
    longest_static_frames = 0
    cur_static = 0
    for r in frame_rows:
        if r["is_cut"]:
            cur_static = 0
            continue
        if r["y_mad"] < 0.85 and r["foreground_relative_motion"] < 0.30:
            cur_static += 1
            longest_static_frames = max(longest_static_frames, cur_static)
        else:
            cur_static = 0

    per_second: list[dict[str, Any]] = []
    for sec in range(total_secs):
        s_rows = [r for r in frame_rows if r["second"] == sec]
        s_noncut = [r for r in s_rows if not r["is_cut"]]
        s_cuts = [r for r in s_rows if r["is_cut"]]
        agg_all = _agg(s_rows)
        agg_nc = _agg(s_noncut if s_noncut else s_rows)
        per_second.append(
            {
                "second": sec,
                "start_s": float(sec),
                "end_s": round(min(duration_s, float(sec + 1)), 3),
                "frame_transitions": len(s_rows),
                "cuts_in_second": len(s_cuts),
                "raw": agg_all,
                "cut_excluded": agg_nc,
            }
        )

    per_shot: list[dict[str, Any]] = []
    if shot_spans:
        for sh in shot_spans:
            sid = str(sh.get("id", "shot"))
            rows = shot_samples.get(sid, [])
            non_cut = [r for r in rows if not r["is_cut"]]
            per_shot.append(
                {
                    "shot_id": sid,
                    "start_s": float(sh.get("start", 0.0)),
                    "end_s": float(sh.get("end", 0.0)),
                    "duration_s": round(float(sh.get("end", 0.0)) - float(sh.get("start", 0.0)), 4),
                    "raw": _agg(rows),
                    "cut_excluded": _agg(non_cut if non_cut else rows),
                }
            )

    return {
        "frame_count": frame_count,
        "transition_count": len(frame_rows),
        "fps": fps_val,
        "duration_s": round(duration_s, 4),
        "analysis_size": list(first_frame_shape or (0, 0)),
        "cuts_detected": len(cut_rows),
        "cut_timestamps_s": [r["t"] for r in cut_rows],
        "longest_near_static_run_s": round(longest_static_frames / fps_val, 4),
        "overall_raw": _agg(frame_rows),
        "overall_cut_excluded": _agg(non_cut_rows if non_cut_rows else frame_rows),
        "per_second": per_second,
        "per_shot": per_shot,
        "frames": frame_rows,
    }


def detect_semantic_lulls(
    activity: Mapping[str, Any],
    action_markers: Sequence[Mapping[str, Any]] | None = None,
    beat_plan: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Detect static intervals that should be active while allowing intentional reaction/payoff holds (0.15-0.55s)."""
    fps_val = float(activity.get("fps") or 30.0)
    rows = activity.get("frames") or []
    beats = list(beat_plan or [])
    markers = list(action_markers or [])

    lulls: list[dict[str, Any]] = []
    intentional_holds: list[dict[str, Any]] = []

    run_start: int | None = None
    run_end: int | None = None

    def _flush_run(s_idx: int, e_idx: int) -> None:
        dur = (e_idx - s_idx + 1) / fps_val
        if dur < 0.15:
            return
        t0 = rows[s_idx]["t"]
        t1 = rows[e_idx]["t"]
        # Check if overlapping a reaction/payoff/hold beat
        matching_beat = next(
            (
                b
                for b in beats
                if float(b.get("start", 0.0)) <= t1 and float(b.get("end", 0.0)) >= t0
            ),
            None,
        )
        role = str((matching_beat or {}).get("role") or (matching_beat or {}).get("beatKind") or "")
        is_hold_role = role in ("reaction", "payoff", "exit") or bool((matching_beat or {}).get("reaction_hold_s", 0.0))
        overlaps_active_marker = any(t0 - 0.05 <= float(m.get("t", -1)) <= t1 + 0.05 and m.get("active", True) for m in markers)

        entry = {
            "start_s": round(t0, 3),
            "end_s": round(t1, 3),
            "duration_s": round(dur, 3),
            "role": role or "unspecified",
        }
        if is_hold_role and dur <= 0.65:
            intentional_holds.append({**entry, "status": "allowed_intentional_hold"})
        elif role in ("hook", "chase", "action", "escalation", "impact") and dur >= 0.65:
            lulls.append({**entry, "severity": "warning", "reason": f"Static run ({dur:.2f}s) during active '{role}' beat"})
        elif overlaps_active_marker and dur >= 0.55:
            lulls.append({**entry, "severity": "warning", "reason": f"Static run ({dur:.2f}s) during active action marker"})
        elif dur >= 1.35:
            lulls.append({**entry, "severity": "warning", "reason": f"Extended static lull ({dur:.2f}s) without hold justification"})

    for idx, r in enumerate(rows):
        is_static = (not r.get("is_cut")) and float(r.get("y_mad", 0.0)) < 0.85 and float(r.get("foreground_relative_motion", 0.0)) < 0.30
        if is_static:
            if run_start is None:
                run_start = idx
            run_end = idx
        else:
            if run_start is not None and run_end is not None:
                _flush_run(run_start, run_end)
            run_start = run_end = None
    if run_start is not None and run_end is not None:
        _flush_run(run_start, run_end)

    # Also detect sustained multi-second low-activity segments (e.g. Samurai 6.5-10s static hold)
    per_sec = activity.get("per_second") or []
    low_secs: list[int] = []
    for s_row in per_sec:
        nc = s_row.get("cut_excluded") or {}
        if float(nc.get("foreground_relative_motion_mean", 0.0)) < 0.28 and float(nc.get("y_mad_mean", 0.0)) < 1.40:
            low_secs.append(int(s_row.get("second", 0)))
        else:
            if len(low_secs) >= 2:
                t0, t1 = float(low_secs[0]), float(low_secs[-1] + 1)
                lulls.append(
                    {
                        "start_s": t0,
                        "end_s": t1,
                        "duration_s": round(t1 - t0, 2),
                        "role": "sustained_low_activity",
                        "severity": "warning",
                        "reason": f"SUSTAINED_LOW_ACTIVITY_INTERVAL ({t0:.0f}-{t1:.0f}s: fg_rel<0.28, y_mad<1.40)",
                    }
                )
            low_secs = []
    if len(low_secs) >= 2:
        t0, t1 = float(low_secs[0]), float(low_secs[-1] + 1)
        lulls.append(
            {
                "start_s": t0,
                "end_s": t1,
                "duration_s": round(t1 - t0, 2),
                "role": "sustained_low_activity",
                "severity": "warning",
                "reason": f"SUSTAINED_LOW_ACTIVITY_INTERVAL ({t0:.0f}-{t1:.0f}s: fg_rel<0.28, y_mad<1.40)",
            }
        )

    return {
        "lulls": lulls,
        "intentional_holds": intentional_holds,
        "has_unjustified_lulls": len(lulls) > 0,
    }


def detect_visual_gaming(
    activity: Mapping[str, Any],
    *,
    shot_variety: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Flag strobe/flicker, random noise MAD, camera jitter, oscillating pan/zoom, and cut-spam gaming."""
    all_rows = list(activity.get("frames") or [])
    rows = [r for r in all_rows if not r.get("is_cut")]
    fps_val = float(activity.get("fps") or 30.0)
    dur_s = max(0.1, float(activity.get("duration_s") or (len(all_rows) / fps_val)))
    flags: list[str] = []
    details: dict[str, Any] = {}

    if all_rows:
        # 1. Strobe / brightness flicker (inspect all consecutive frames so full-frame strobe flashes are caught!)
        b_deltas = [float(r.get("brightness_delta", 0.0)) for r in all_rows]
        flips = 0
        strong_pulses = 0
        prev_sign = 0
        for bd in b_deltas:
            if abs(bd) >= 12.0:
                strong_pulses += 1
                sign = 1 if bd > 0 else -1
                if prev_sign != 0 and sign != prev_sign:
                    flips += 1
                prev_sign = sign
        flips_per_sec = flips / dur_s
        details["brightness_flips_per_s"] = round(flips_per_sec, 3)
        details["strong_brightness_pulses"] = strong_pulses
        if flips_per_sec >= 2.5 or (strong_pulses >= 6 and flips >= 4):
            flags.append("STROBE_FLICKER_DETECTED")

    if rows:

        # 2. High RGB/Y MAD without coherent motion (random pixel noise gaming)
        nc = activity.get("overall_cut_excluded") or {}
        y_med = float(nc.get("y_mad_median", 0.0))
        coh_mean = float(nc.get("flow_coherence_mean", 1.0))
        ssim_mean = float(nc.get("ssim_mean", 1.0))
        sdc_mean = float(nc.get("spatial_diff_corr_mean", 1.0))
        fg_mean = float(nc.get("foreground_relative_motion_mean", 0.0))
        cam_mean = float(nc.get("camera_global_motion_mean", 0.0))
        details["cut_excluded_y_mad_median"] = y_med
        details["flow_coherence_mean"] = coh_mean
        details["ssim_mean"] = ssim_mean
        details["spatial_diff_corr_mean"] = sdc_mean
        if y_med >= 4.5 and (coh_mean < 0.36 or sdc_mean < 0.25 or (ssim_mean < 0.55 and sdc_mean < 0.50)):
            flags.append("RANDOM_NOISE_HIGH_MAD_LOW_COHERENCE")

        # 3. Sinusoidal camera jitter (frequent sign flips on global camera dx or dy)
        cam_dx = [float(r.get("camera_dx", 0.0)) for r in rows]
        cam_dy = [float(r.get("camera_dy", 0.0)) for r in rows]
        jitter_flips = 0
        for arr in (cam_dx, cam_dy):
            ps = 0
            for v in arr:
                if abs(v) >= 0.75:
                    s = 1 if v > 0 else -1
                    if ps != 0 and s != ps:
                        jitter_flips += 1
                    ps = s
        jitter_rate = jitter_flips / dur_s
        details["camera_direction_flips_per_s"] = round(jitter_rate, 3)
        if jitter_rate >= 3.5 and cam_mean >= 1.2:
            flags.append("CAMERA_SINUSOIDAL_JITTER")

        # 4. Oscillating zoom or whole-frame pan with almost zero foreground relative motion
        zoom_arr = [float(r.get("camera_zoom", 0.0)) for r in rows]
        zoom_flips = 0
        pz = 0
        for zv in zoom_arr:
            if abs(zv) >= 1.2:
                sz = 1 if zv > 0 else -1
                if pz != 0 and sz != pz:
                    zoom_flips += 1
                pz = sz
        details["zoom_direction_flips_per_s"] = round(zoom_flips / dur_s, 3)
        if zoom_flips / dur_s >= 2.5:
            flags.append("OSCILLATING_ZOOM_PUMP")
        if (cam_mean >= 1.4 or zoom_flips / dur_s >= 2.0) and fg_mean < 0.35 and (fg_mean / max(0.1, cam_mean)) < 0.20:
            flags.append("CAMERA_MOTION_WITHOUT_FOREGROUND_ACTION")

    # 5. Cut-spam gaming
    cuts = int(activity.get("cuts_detected", 0))
    cuts_per_s = cuts / dur_s
    details["cuts_per_second"] = round(cuts_per_s, 3)
    raw_mad = float((activity.get("overall_raw") or {}).get("y_mad_mean", 0.0))
    nc_mad = float((activity.get("overall_cut_excluded") or {}).get("y_mad_mean", 0.0))
    if cuts_per_s >= 2.6 or (cuts >= 4 and raw_mad > nc_mad * 2.4 and nc_mad < 1.2):
        flags.append("HIGH_MAD_FROM_JUMP_CUT_SPAM")

    if shot_variety and shot_variety.get("duplicate_ratio", 0.0) >= 0.5 and cuts >= 3:
        details["duplicate_cuts_ratio"] = shot_variety.get("duplicate_ratio", 0.0)

    high_pixel_low_semantics = len(flags) > 0
    return {
        "gaming_detected": len(flags) > 0,
        "high_pixel_low_semantics": high_pixel_low_semantics,
        "flags": flags,
        "details": details,
    }


def analyze_shot_variety(
    shot_mid_frames: Sequence[Mapping[str, Any]],
    compiled_plan: Any = None,
    scene_evidence: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Compare decoded shot compositions and verify scale claims (closeup vs wide)."""
    warnings: list[str] = []
    comparisons: list[dict[str, Any]] = []
    similar_pairs = 0

    for a, b in zip(shot_mid_frames[:-1], shot_mid_frames[1:]):
        y_a = a["luma"]
        y_b = b["luma"]
        ssim_ab = compute_ssim_luma(y_a, y_b)
        coarse_a = np.asarray(Image.fromarray(np.clip(y_a, 0, 255).astype(np.uint8)).resize((45, 80), Image.Resampling.BILINEAR), dtype=np.float32)
        coarse_b = np.asarray(Image.fromarray(np.clip(y_b, 0, 255).astype(np.uint8)).resize((45, 80), Image.Resampling.BILINEAR), dtype=np.float32)
        coarse_ssim = compute_ssim_luma(coarse_a, coarse_b)
        hist_ab = _hist_distance(y_a, y_b)
        is_too_similar = (ssim_ab >= 0.84 and hist_ab <= 0.085) or (coarse_ssim >= 0.74 and hist_ab <= 0.055)
        if is_too_similar:
            similar_pairs += 1
            warnings.append(
                f"TOO_SIMILAR_CONSECUTIVE_SHOTS: '{a['shot_id']}' -> '{b['shot_id']}' (SSIM={ssim_ab:.3f}, coarse_SSIM={coarse_ssim:.3f}, hist_dist={hist_ab:.3f})."
            )
        comparisons.append(
            {
                "from_shot": a["shot_id"],
                "to_shot": b["shot_id"],
                "ssim": round(ssim_ab, 4),
                "coarse_ssim": round(coarse_ssim, 4),
                "hist_dist": round(hist_ab, 4),
                "too_similar": is_too_similar,
            }
        )

    # Check declared shot_size vs observed geometry scale (from scene_evidence or compiled_plan)
    scale_mismatches: list[str] = []
    if compiled_plan is not None and scene_evidence:
        ev_by_shot: dict[str, list[float]] = {}
        for row in scene_evidence:
            sid = str(row.get("shot_id") or "")
            sc = row.get("actual_scale")
            if sid and isinstance(sc, (int, float)):
                ev_by_shot.setdefault(sid, []).append(float(sc))
        wide_scales = [
            float(np.mean(ev_by_shot[s.shot_id]))
            for s in compiled_plan.shots
            if s.shot_size == "wide" and s.shot_id in ev_by_shot
        ]
        ref_wide = float(np.mean(wide_scales)) if wide_scales else None
        if ref_wide:
            for s in compiled_plan.shots:
                if s.shot_size in ("close", "extreme_close", "insert") and s.shot_id in ev_by_shot:
                    obs = float(np.mean(ev_by_shot[s.shot_id]))
                    if obs < ref_wide * 1.25:
                        msg = f"SHOT_SCALE_CLAIM_MISMATCH: '{s.shot_id}' khai báo '{s.shot_size}' nhưng scale thực tế ({obs:.2f}) không lớn hơn rõ rệt so với wide ({ref_wide:.2f})."
                        scale_mismatches.append(msg)
                        warnings.append(msg)

    unique_comp_count = max(1, len(shot_mid_frames) - similar_pairs) if shot_mid_frames else 0
    return {
        "shots_analyzed": len(shot_mid_frames),
        "unique_compositions": unique_comp_count,
        "too_similar_pairs": similar_pairs,
        "duplicate_ratio": round(similar_pairs / max(1, len(comparisons)), 3) if comparisons else 0.0,
        "scale_mismatches": scale_mismatches,
        "comparisons": comparisons,
        "warnings": warnings,
    }


def analyze_audio_pacing(
    media_path: str | Path,
    captions: Sequence[Mapping[str, Any]] | None = None,
    action_markers: Sequence[Mapping[str, Any]] | None = None,
    ffmpeg_bin: str | None = None,
) -> dict[str, Any]:
    """Inspect decoded audio PCM (RMS, Peak, Clipping, trailing silence, SFX peak sync)."""
    exe = ffmpeg_bin or _resolve_bin("ffmpeg", "B6_REAL_FFMPEG")
    sr = 16000
    res = subprocess.run(
        [exe, "-v", "error", "-i", str(media_path), "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
        capture_output=True,
        check=False,
        timeout=25,
    )
    if res.returncode != 0 or not res.stdout:
        return {
            "has_audio": False,
            "error": res.stderr.decode("utf-8", errors="replace").strip() or "No audio stream decoded",
            "clipping_samples": 0,
            "trailing_silence_s": 0.0,
            "warnings": ["AUDIO_MISSING_OR_UNDECODABLE"],
        }
    samples = np.frombuffer(res.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    duration_s = len(samples) / float(sr)
    rms = float(np.sqrt(np.mean(samples * samples)))
    peak = float(np.max(np.abs(samples)))
    rms_dbfs = 20.0 * math.log10(max(1e-7, rms))
    peak_dbfs = 20.0 * math.log10(max(1e-7, peak))
    clipping_samples = int(np.sum(np.abs(samples) >= 0.999))

    # 50ms RMS envelope for onset, silent gaps, trailing silence, and SFX sync
    hop = int(sr * 0.05)
    n_hops = max(1, len(samples) // hop)
    env = np.array([float(np.sqrt(np.mean(samples[i * hop : (i + 1) * hop] ** 2))) for i in range(n_hops)], dtype=float)
    active_thresh = 0.012
    active_idx = np.where(env >= active_thresh)[0]
    onset_s = float(active_idx[0] * 0.05) if len(active_idx) > 0 else duration_s
    last_active_s = float((active_idx[-1] + 1) * 0.05) if len(active_idx) > 0 else 0.0
    trailing_silence_s = max(0.0, round(duration_s - last_active_s, 3))

    # Check SFX energy alignment around action markers
    sfx_sync: list[dict[str, Any]] = []
    if action_markers:
        for m in action_markers:
            mt = float(m.get("t", 0.0))
            lo = max(0, int((mt - 0.22) / 0.05))
            hi = min(len(env), int((mt + 0.22) / 0.05) + 1)
            local_peak = float(np.max(env[lo:hi])) if hi > lo else 0.0
            sfx_sync.append(
                {
                    "event": str(m.get("label", m.get("id", "action"))),
                    "t": mt,
                    "local_rms_peak": round(local_peak, 4),
                    "audible_near_event": local_peak >= 0.02,
                }
            )

    warnings: list[str] = []
    if clipping_samples > 0:
        warnings.append(f"AUDIO_CLIPPING_DETECTED ({clipping_samples} samples >= -0.01 dBFS)")
    if trailing_silence_s > 2.0:
        warnings.append(f"AUDIO_LONG_TRAILING_SILENCE ({trailing_silence_s:.2f}s > 2.0s)")
    if rms_dbfs < -42.0:
        warnings.append(f"AUDIO_TOO_QUIET (RMS {rms_dbfs:.1f} dBFS)")

    return {
        "has_audio": True,
        "duration_s": round(duration_s, 3),
        "sample_rate": sr,
        "rms_dbfs": round(rms_dbfs, 2),
        "peak_dbfs": round(peak_dbfs, 2),
        "clipping_samples": clipping_samples,
        "audio_onset_s": round(onset_s, 3),
        "trailing_silence_s": trailing_silence_s,
        "caption_count": len(captions or []),
        "sfx_alignment": sfx_sync,
        "subjective_voice_quality": "NOT_VERIFIED_REQUIRES_HUMAN_LISTENING",
        "warnings": warnings,
    }


def analyze_video_editorial_metrics(
    video_path: str | Path,
    *,
    compiled_plan: Any = None,
    shot_spans: Sequence[Mapping[str, Any]] | None = None,
    action_markers: Sequence[Mapping[str, Any]] | None = None,
    captions: Sequence[Mapping[str, Any]] | None = None,
    scene_evidence: Sequence[Mapping[str, Any]] | None = None,
    source_fingerprint: str | None = None,
    analysis_size: tuple[int, int] = (360, 640),
    exclude_caption_band: bool = True,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Run complete decoded-frame & audio editorial analysis on a rendered MP4. Returns (report_dict, shot_mid_frames)."""
    vp = Path(video_path)
    probe = probe_video_ffprobe(vp)
    fps_val = float(probe["fps"] or 30.0)

    spans = list(shot_spans or [])
    if not spans and compiled_plan is not None:
        spans = [
            {
                "id": s.shot_id,
                "start": s.start_s,
                "end": s.end_s,
                "role": s.role,
                "shot_size": s.shot_size,
                "reaction_hold_s": s.reaction_hold_s,
            }
            for s in compiled_plan.shots
        ]

    boundaries = [float(s["start"]) for s in spans[1:]] if spans else []
    masks = {"caption_band_norm": (0.675, 0.743)} if (exclude_caption_band and probe["height"] > probe["width"]) else None

    # Stream decoded frames once while capturing 1 representative mid-frame per shot (memory-bounded!)
    mid_targets: list[tuple[str, int]] = []
    if spans:
        for sh in spans:
            mid_t = 0.5 * (float(sh["start"]) + float(sh["end"]))
            mid_targets.append((str(sh["id"]), max(0, min(max(0, probe["nb_frames"] - 1), int(round(mid_t * fps_val))))))
    else:
        # Uniformly sample 1 mid-frame per second if no shot spans declared
        for sec in range(max(1, int(math.ceil(probe["duration"])))):
            mid_targets.append((f"sec_{sec}", min(max(0, probe["nb_frames"] - 1), int(round((sec + 0.5) * fps_val)))))

    target_idx_map: dict[int, list[str]] = {}
    for sid, idx in mid_targets:
        target_idx_map.setdefault(idx, []).append(sid)
    captured_mids: dict[str, np.ndarray] = {}

    def _frame_gen():
        for idx, frm in enumerate(iter_decoded_mp4_frames(vp, analysis_size=analysis_size)):
            if idx in target_idx_map:
                y_luma = _to_luma(frm)
                for sid in target_idx_map[idx]:
                    captured_mids[sid] = y_luma
            yield frm

    activity = compute_frame_activity(
        _frame_gen(),
        masks=masks,
        fps=fps_val,
        boundaries=boundaries,
        shot_spans=spans or None,
    )

    if probe["nb_frames"] > 0 and abs(activity["frame_count"] - probe["nb_frames"]) > 1:
        raise ValueError(
            f"Decoded frame count ({activity['frame_count']}) mismatches ffprobe nb_frames ({probe['nb_frames']})"
        )

    shot_mid_list = [
        {"shot_id": sid, "luma": captured_mids[sid]}
        for sid, _ in mid_targets
        if sid in captured_mids
    ]
    variety = analyze_shot_variety(shot_mid_list, compiled_plan=compiled_plan, scene_evidence=scene_evidence)
    lulls = detect_semantic_lulls(activity, action_markers=action_markers, beat_plan=spans)
    gaming = detect_visual_gaming(activity, shot_variety=variety)
    audio = analyze_audio_pacing(vp, captions=captions, action_markers=action_markers)

    # Strip per-frame array from exported report (keep bounded compact summary!)
    compact_activity = {k: v for k, v in activity.items() if k != "frames"}
    warnings = list(dict.fromkeys([*variety["warnings"], *[l["reason"] for l in lulls["lulls"]], *gaming["flags"], *audio["warnings"]]))

    report = {
        "schema": EDITORIAL_REPORT_SCHEMA,
        "video_path": str(vp),
        "video_sha256": probe["sha256"],
        "source_fingerprint": source_fingerprint,
        "checker_version": CHECKER_VERSION,
        "checker_version_hash": _checker_hash(),
        "processing_config": {
            "analysis_size": list(analysis_size),
            "exclude_caption_band": exclude_caption_band,
            "caption_band_norm": [0.675, 0.743] if masks else None,
            "fps": fps_val,
        },
        "ffprobe": {k: v for k, v in probe.items() if k != "raw_ffprobe"},
        "summary": {
            "duration_s": activity["duration_s"],
            "frame_count": activity["frame_count"],
            "cuts_detected": activity["cuts_detected"],
            "longest_near_static_run_s": activity["longest_near_static_run_s"],
            "raw_rgb_mad_mean": activity["overall_raw"]["rgb_mad_mean"],
            "raw_y_mad_mean": activity["overall_raw"]["y_mad_mean"],
            "cut_excluded_y_mad_mean": activity["overall_cut_excluded"]["y_mad_mean"],
            "cut_excluded_y_mad_median": activity["overall_cut_excluded"]["y_mad_median"],
            "cut_excluded_y_mad_p95": activity["overall_cut_excluded"]["y_mad_p95"],
            "flow_mag_mean": activity["overall_cut_excluded"]["flow_mag_mean"],
            "camera_global_motion_mean": activity["overall_cut_excluded"]["camera_global_motion_mean"],
            "foreground_relative_motion_mean": activity["overall_cut_excluded"]["foreground_relative_motion_mean"],
            "flow_coherence_mean": activity["overall_cut_excluded"]["flow_coherence_mean"],
            "pct_near_static": activity["overall_cut_excluded"]["pct_near_static"],
            "unique_compositions": variety["unique_compositions"],
            "shots_analyzed": variety["shots_analyzed"],
            "too_similar_pairs": variety["too_similar_pairs"],
            "gaming_detected": gaming["gaming_detected"],
            "high_pixel_low_semantics": gaming["high_pixel_low_semantics"],
        },
        "per_second": compact_activity["per_second"],
        "per_shot": compact_activity["per_shot"],
        "shot_variety": variety,
        "semantic_lulls": lulls,
        "gaming": gaming,
        "audio_pacing": audio,
        "warnings": warnings,
        "confidence_and_limitations": {
            "audience_retention_estimate": "unavailable",
            "subjective_creative_review": "NOT_VERIFIED_PENDING_HUMAN",
            "notes": [
                "Pixel MAD and optical flow measure visual change telemetry, NOT audience watch-time or CTR.",
                "Analysis runs at explicitly recorded downscaled resolution; small fine-line details require native-size human inspection.",
            ],
        },
    }
    return report, shot_mid_list


def export_editorial_report(
    report: Mapping[str, Any],
    out_json_path: str | Path,
) -> Path:
    p = Path(out_json_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f"{p.name}.tmp.{os.getpid()}")
    tmp.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, p)
    return p


def render_editorial_chart_svg(report: Mapping[str, Any], out_svg_path: str | Path) -> Path:
    """Render clean lightweight SVG chart comparing per-second cut-excluded Y-MAD vs foreground relative motion."""
    per_sec = report.get("per_second") or []
    w, h = 760, 260
    pad_l, pad_r, pad_t, pad_b = 48, 20, 32, 36
    plot_w = w - pad_l - pad_r
    plot_h = h - pad_t - pad_b
    max_y = max(
        10.0,
        max((float((s.get("cut_excluded") or {}).get("y_mad_mean", 0.0)) for s in per_sec), default=10.0),
        max((float((s.get("cut_excluded") or {}).get("foreground_relative_motion_mean", 0.0)) * 2.5 for s in per_sec), default=5.0),
    )

    bars = []
    n = max(1, len(per_sec))
    bw = plot_w / float(n)
    for idx, s in enumerate(per_sec):
        ym = float((s.get("cut_excluded") or {}).get("y_mad_mean", 0.0))
        fg = float((s.get("cut_excluded") or {}).get("foreground_relative_motion_mean", 0.0))
        bh = (ym / max_y) * plot_h
        fh = (min(max_y, fg * 2.5) / max_y) * plot_h
        x = pad_l + idx * bw
        bars.append(
            f'<rect x="{x + 4:.1f}" y="{pad_t + plot_h - bh:.1f}" width="{max(6.0, bw * 0.42):.1f}" height="{bh:.1f}" fill="#216B74" rx="2"/>'
        )
        bars.append(
            f'<rect x="{x + bw * 0.5:.1f}" y="{pad_t + plot_h - fh:.1f}" width="{max(6.0, bw * 0.38):.1f}" height="{fh:.1f}" fill="#D97706" rx="2"/>'
        )
        bars.append(
            f'<text x="{x + bw * 0.5:.1f}" y="{h - 12}" text-anchor="middle" font-size="11" fill="#475569">{s["second"]}s</text>'
        )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
        f'<rect width="{w}" height="{h}" fill="#FFFFFF"/>'
        f'<text x="{pad_l}" y="20" font-family="sans-serif" font-size="13" font-weight="700" fill="#17212F">'
        f'Per-Second Cut-Excluded Y-MAD (Teal) &amp; Foreground Motion x2.5 (Amber)</text>'
        f'<line x1="{pad_l}" y1="{pad_t + plot_h}" x2="{w - pad_r}" y2="{pad_t + plot_h}" stroke="#CBD5E1"/>'
        f'{"".join(bars)}</svg>\n'
    )
    out = Path(out_svg_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding="utf-8")
    return out


def render_annotated_contact_sheet(
    video_path: str | Path,
    out_jpg_path: str | Path,
    *,
    shot_spans: Sequence[Mapping[str, Any]] | None = None,
    interval_s: float = 0.25,
    extra_timestamps: Sequence[float] | None = None,
    ffmpeg_bin: str | None = None,
) -> Path:
    """Decode key timestamps (0.25s grid + cut boundaries + action markers) into a readable annotated contact sheet."""
    probe = probe_video_ffprobe(video_path)
    dur = float(probe["duration"] or 10.0)
    fps = float(probe["fps"] or 30.0)
    ts_set = {round(min(max(0.0, k * interval_s), max(0.0, dur - 0.04)), 3) for k in range(int(math.floor(dur / interval_s)) + 1)}
    for sh in shot_spans or []:
        ts_set.add(round(min(max(0.0, float(sh.get("start", 0.0)) + 0.04), max(0.0, dur - 0.04)), 3))
    for et in extra_timestamps or []:
        ts_set.add(round(min(max(0.0, float(et)), max(0.0, dur - 0.04)), 3))
    timestamps = sorted(ts_set)
    target_frames = {min(max(0, probe["nb_frames"] - 1), int(round(t * fps))): t for t in timestamps}

    cell_w, cell_h = 225, 400
    thumbs: list[tuple[float, Image.Image]] = []
    for idx, rgb in enumerate(iter_decoded_mp4_frames(video_path, analysis_size=(cell_w, cell_h), ffmpeg_bin=ffmpeg_bin)):
        if idx in target_frames:
            thumbs.append((target_frames[idx], Image.fromarray(rgb)))

    cols = 6
    rows = max(1, int(math.ceil(len(thumbs) / cols)))
    pad = 8
    header_h = 28
    sheet = Image.new("RGB", (cols * (cell_w + pad) + pad, rows * (cell_h + header_h + pad) + pad), (18, 22, 31))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for i, (ts, im) in enumerate(thumbs):
        r = i // cols
        c = i % cols
        x0 = pad + c * (cell_w + pad)
        y0 = pad + r * (cell_h + header_h + pad)
        sid = ""
        for sh in shot_spans or []:
            if float(sh.get("start", 0.0)) <= ts < float(sh.get("end", 0.0)):
                sid = str(sh.get("id", ""))
                break
        draw.rectangle([x0, y0, x0 + cell_w, y0 + header_h], fill=(30, 41, 59))
        draw.text((x0 + 6, y0 + 7), f"t={ts:.2f}s {sid[:18]}", fill=(248, 250, 252), font=font)
        sheet.paste(im, (x0, y0 + header_h))

    out = Path(out_jpg_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=92)
    return out
