"""Editorial & Pacing QA Evaluator (`b6-editorial-qc/1`), separate from `motion_qc.json`.

Evaluates objective video/audio/editorial conditions without fabricating audience retention.
Fails closed on corrupt MP4, missing coverage, gaming (flicker/noise/jitter/cut-spam),
shot-scale claim mismatch, or missing audio, while allowing legitimate reaction holds.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any, Mapping, Sequence

try:
    from .b6_editorial_contract import EDITORIAL_QC_SCHEMA
    from .b6_editorial_metrics import (
        analyze_video_editorial_metrics,
        export_editorial_report,
        sha256_file,
    )
except ImportError:
    from b6_editorial_contract import EDITORIAL_QC_SCHEMA
    from b6_editorial_metrics import (
        analyze_video_editorial_metrics,
        export_editorial_report,
        sha256_file,
    )


def evaluate_editorial_qc(
    editorial_report: Mapping[str, Any],
    *,
    expected_video_path: str | Path | None = None,
    expected_source_fingerprint: str | None = None,
    compiled_plan: Any = None,
    scene_evidence: Sequence[Mapping[str, Any]] | None = None,
    expected_ratio: str = "9:16",
    report_path: str | Path | None = None,
) -> dict[str, Any]:
    """Validate an editorial report and produce objective `b6-editorial-qc/1` verdict."""
    errors: list[str] = []
    warnings: list[str] = list(editorial_report.get("warnings") or [])

    vp_raw = expected_video_path or editorial_report.get("video_path")
    vp = Path(vp_raw) if vp_raw else None
    actual_video_sha = None
    if not vp or not vp.is_file():
        errors.append("EDITORIAL_VIDEO_MISSING")
    else:
        actual_video_sha = sha256_file(vp)
        rep_sha = editorial_report.get("video_sha256")
        if rep_sha and rep_sha != actual_video_sha:
            errors.append("EDITORIAL_VIDEO_SHA256_MISMATCH")

    if expected_source_fingerprint:
        rep_fp = editorial_report.get("source_fingerprint")
        if rep_fp != expected_source_fingerprint:
            errors.append("EDITORIAL_SOURCE_FINGERPRINT_MISMATCH")

    ffp = editorial_report.get("ffprobe") or {}
    width = int(ffp.get("width") or 0)
    height = int(ffp.get("height") or 0)
    fps_val = float(ffp.get("fps") or 0.0)
    dur_val = float(ffp.get("duration") or 0.0)
    nb_frames = int(ffp.get("nb_frames") or 0)
    if width <= 0 or height <= 0 or dur_val <= 0.0 or fps_val <= 0.0 or nb_frames <= 0:
        errors.append("EDITORIAL_FFPROBE_INVALID")
    elif expected_ratio == "9:16" and height <= width:
        errors.append(f"EDITORIAL_ORIENTATION_MISMATCH (expected 9:16, got {width}x{height})")
    elif expected_ratio == "16:9" and width <= height:
        errors.append(f"EDITORIAL_ORIENTATION_MISMATCH (expected 16:9, got {width}x{height})")

    summary = editorial_report.get("summary") or {}
    decoded_count = int(summary.get("frame_count") or 0)
    if nb_frames > 0 and decoded_count > 0 and abs(decoded_count - nb_frames) > 1:
        errors.append(f"EDITORIAL_DECODED_FRAME_MISMATCH ({decoded_count} vs {nb_frames})")

    per_second = editorial_report.get("per_second") or []
    expected_secs = max(1, int(math.ceil(dur_val - 1e-6))) if dur_val > 0 else 0
    if expected_secs > 0 and len(per_second) < expected_secs:
        errors.append(f"EDITORIAL_INCOMPLETE_PER_SECOND_COVERAGE ({len(per_second)} < {expected_secs})")
    if per_second:
        seen_secs = {int(s.get("second", -1)) for s in per_second}
        missing_secs = [sec for sec in range(expected_secs) if sec not in seen_secs]
        if missing_secs:
            errors.append(f"EDITORIAL_MISSING_SECONDS: {missing_secs}")

    # Gaming gate: high MAD from noise/flicker/jitter/cut-spam MUST NOT pass
    gaming = editorial_report.get("gaming") or {}
    if gaming.get("high_pixel_low_semantics") or gaming.get("gaming_detected"):
        flags = list(gaming.get("flags") or ["HIGH_PIXEL_LOW_SEMANTICS"])
        errors.append(f"EDITORIAL_VISUAL_GAMING_DETECTED: {', '.join(flags)}")

    # Shot variety & scale claims
    variety = editorial_report.get("shot_variety") or {}
    scale_mismatches = list(variety.get("scale_mismatches") or [])
    if scale_mismatches:
        errors.extend(scale_mismatches)
    if float(variety.get("duplicate_ratio") or 0.0) >= 0.5 and int(variety.get("shots_analyzed") or 0) >= 3:
        errors.append("EDITORIAL_EXCESSIVE_DUPLICATE_SHOTS")

    # Semantic lulls (unjustified static blocks during active beats; legitimate reaction holds are permitted!)
    lulls_info = editorial_report.get("semantic_lulls") or {}
    lulls = list(lulls_info.get("lulls") or [])
    for lull in lulls:
        if float(lull.get("duration_s", 0.0)) >= 1.8:
            errors.append(f"EDITORIAL_EXTENDED_STATIC_LULL: {lull.get('reason')}")
        else:
            warnings.append(f"LULL_WARNING: {lull.get('reason')}")

    # Audio checks
    audio = editorial_report.get("audio_pacing") or {}
    if not audio.get("has_audio"):
        errors.append("EDITORIAL_AUDIO_MISSING")
    else:
        if int(audio.get("clipping_samples") or 0) > 12:
            errors.append(f"EDITORIAL_AUDIO_CLIPPING ({audio['clipping_samples']} samples)")
        if float(audio.get("trailing_silence_s") or 0.0) > 2.4:
            errors.append(f"EDITORIAL_AUDIO_TRAILING_SILENCE ({audio['trailing_silence_s']:.2f}s)")

    # Geometry-anchored legibility check when scene_evidence is provided
    focal_out_of_frame = 0
    caption_collisions = 0
    if scene_evidence and height > 0 and width > 0:
        cap_y0 = 0.675 * height
        cap_y1 = 0.743 * height
        for row in scene_evidence:
            fxy = row.get("focus_screen_xy")
            if isinstance(fxy, (list, tuple)) and len(fxy) == 2:
                fx, fy = float(fxy[0]), float(fxy[1])
                if fx < 12 or fx > width - 12 or fy < 16 or fy > height - 16:
                    focal_out_of_frame += 1
                if expected_ratio == "9:16" and cap_y0 <= fy <= cap_y1:
                    caption_collisions += 1
        if focal_out_of_frame > max(3, int(0.05 * len(scene_evidence))):
            errors.append(f"EDITORIAL_FOCUS_OUT_OF_SAFE_FRAME ({focal_out_of_frame} frames)")
        if caption_collisions > max(4, int(0.06 * len(scene_evidence))):
            errors.append(f"EDITORIAL_CAPTION_COLLISION_WITH_FOCUS ({caption_collisions} frames)")

    # Descriptive coverage summary (NOT a view/retention prediction)
    active_secs = sum(
        1
        for s in per_second
        if float((s.get("cut_excluded") or {}).get("y_mad_mean", 0.0)) >= 1.0
        or float((s.get("cut_excluded") or {}).get("foreground_relative_motion_mean", 0.0)) >= 0.4
    )
    rep_digest = sha256_file(report_path) if report_path and Path(report_path).is_file() else hashlib.sha256(
        json.dumps(editorial_report, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()

    passed = len(errors) == 0
    return {
        "schema": EDITORIAL_QC_SCHEMA,
        "status": "pass" if passed else "fail",
        "pass": passed,
        "errors": list(dict.fromkeys(errors)),
        "warnings": list(dict.fromkeys(warnings)),
        "source_fingerprint": expected_source_fingerprint or editorial_report.get("source_fingerprint"),
        "video_sha256": actual_video_sha,
        "editorial_report_sha256": rep_digest,
        "frames_checked": decoded_count,
        "descriptive_coverage": {
            "active_seconds": active_secs,
            "total_seconds": len(per_second),
            "unique_compositions": int(variety.get("unique_compositions") or 0),
            "shots_analyzed": int(variety.get("shots_analyzed") or 0),
            "intentional_holds_count": len(lulls_info.get("intentional_holds") or []),
            "cut_excluded_y_mad_mean": float(summary.get("cut_excluded_y_mad_mean") or 0.0),
            "foreground_relative_motion_mean": float(summary.get("foreground_relative_motion_mean") or 0.0),
            "focal_out_of_frame_count": focal_out_of_frame,
            "caption_collisions_count": caption_collisions,
        },
        "audience_retention_estimate": "unavailable",
        "human_visual_review": "PENDING",
        "user_approval": "PENDING",
    }


def run_editorial_qc_for_video(
    video_path: str | Path,
    out_dir: str | Path,
    *,
    compiled_plan: Any = None,
    shot_spans: Sequence[Mapping[str, Any]] | None = None,
    action_markers: Sequence[Mapping[str, Any]] | None = None,
    captions: Sequence[Mapping[str, Any]] | None = None,
    scene_evidence: Sequence[Mapping[str, Any]] | None = None,
    source_fingerprint: str | None = None,
    expected_ratio: str = "9:16",
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run metrics extraction + QC and write `editorial-report.json` + `editorial_qc.json` atomically."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    report, _ = analyze_video_editorial_metrics(
        video_path,
        compiled_plan=compiled_plan,
        shot_spans=shot_spans,
        action_markers=action_markers,
        captions=captions,
        scene_evidence=scene_evidence,
        source_fingerprint=source_fingerprint,
    )
    rep_path = export_editorial_report(report, out / "editorial-report.json")
    qc = evaluate_editorial_qc(
        report,
        expected_video_path=video_path,
        expected_source_fingerprint=source_fingerprint,
        compiled_plan=compiled_plan,
        scene_evidence=scene_evidence,
        expected_ratio=expected_ratio,
        report_path=rep_path,
    )
    qc_path = out / "editorial_qc.json"
    tmp = qc_path.with_name(f"{qc_path.name}.tmp.{os.getpid()}")
    tmp.write_text(json.dumps(qc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, qc_path)
    return report, qc
