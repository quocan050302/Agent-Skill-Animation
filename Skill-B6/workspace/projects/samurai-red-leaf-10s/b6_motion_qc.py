"""Motion telemetry, quantitative geometry/foot-lock validation, and shot draft helper."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import subprocess
import sys
from typing import Any, Mapping, Sequence
import numpy as np

try:
    from .b6_motion_core import ContactPlan, GaitPose, LegPose
except ImportError:
    from b6_motion_core import ContactPlan, GaitPose, LegPose

DEFAULT_THRESHOLDS = {
    "max_stance_drift_world": 0.75,
    "max_ground_penetration_world": 0.5,
    "max_bone_length_rel_err": 0.035,
    "min_locomotion_knee_bend_deg": 7.5,
    "min_locomotion_knee_deviation_px": 2.5,
    "max_unannotated_root_jump_world": 48.0,
    "max_prop_contact_err_px": 0.75,
    "max_knee_bend_deg": 136.0,
}


def _chord_deviation(lp: LegPose, proj_fn=None) -> float:
    hip = np.asarray(proj_fn(lp.hip_xy) if proj_fn else lp.hip_xy, dtype=float)[:2]
    knee = np.asarray(proj_fn(lp.knee_xy) if proj_fn else lp.knee_xy, dtype=float)[:2]
    ankle = np.asarray(proj_fn(lp.ankle_xy) if proj_fn else lp.ankle_xy, dtype=float)[:2]
    chord = ankle - hip
    clen = max(1e-6, float(np.linalg.norm(chord)))
    return abs(float((knee[0] - hip[0]) * chord[1] - (knee[1] - hip[1]) * chord[0])) / clen


def _leg_metrics(lp: LegPose, fc: Any, ground_y: float, facing: float, proj_fn=None) -> dict[str, Any]:
    hip = np.asarray(lp.hip_xy, dtype=float)
    knee = np.asarray(lp.knee_xy, dtype=float)
    ankle = np.asarray(lp.ankle_xy, dtype=float)
    toe = np.asarray(lp.toe_xy, dtype=float)
    finite = bool(np.isfinite(hip).all() and np.isfinite(knee).all() and np.isfinite(ankle).all() and np.isfinite(toe).all())

    # Knee should bend forward relative to hip->ankle line along facing direction
    mid_y_t = _safe_div(knee[1] - hip[1], ankle[1] - hip[1], 0.5)
    line_x_at_knee = hip[0] + (ankle[0] - hip[0]) * mid_y_t
    forward_offset = (knee[0] - line_x_at_knee) * (1.0 if facing >= 0 else -1.0)
    knee_forward_ok = bool(forward_offset >= -0.75 or lp.bend_angle_deg < 1.5)

    penetration = max(0.0, float(max(ankle[1], toe[1]) - ground_y))
    plant_w = np.asarray(fc.plant_world, dtype=float) if fc is not None else ankle
    drift_w = float(np.linalg.norm(ankle - plant_w)) if lp.contact_state == "stance" else 0.0

    return {
        "finite": finite,
        "hip": lp.hip_xy,
        "knee": lp.knee_xy,
        "ankle": lp.ankle_xy,
        "toe": lp.toe_xy,
        "contact_state": lp.contact_state,
        "plant_world": fc.plant_world if fc is not None else lp.ankle_xy,
        "world_drift": drift_w,
        "ground_penetration": penetration,
        "upper_len": float(lp.upper_len),
        "lower_len": float(lp.lower_len),
        "actual_upper_len": float(lp.actual_upper_len),
        "actual_lower_len": float(lp.actual_lower_len),
        "bend_angle_deg": float(lp.bend_angle_deg),
        "knee_deviation": float(_chord_deviation(lp, proj_fn)),
        "knee_forward_ok": knee_forward_ok,
        "forward_offset": float(forward_offset),
    }


def _safe_div(a: float, b: float, fallback: float) -> float:
    return float(a / b) if abs(b) > 1e-6 else float(fallback)


def motion_evidence_at(
    t: float,
    pose: GaitPose,
    contact_plan: ContactPlan | None = None,
    viewport: Any = None,
    *,
    frame_idx: int = 0,
    shot_id: str = "",
    render_qa: Mapping[str, Any] | None = None,
    world_to_screen_fn=None,
    is_cut: bool = False,
) -> dict[str, Any]:
    """Produce numeric geometry, stance-drift, knee-bend, and occlusion audit record for frame `t`."""
    cp = contact_plan or pose.contact_plan
    left_m = _leg_metrics(pose.left_leg, cp.left, cp.ground_y, pose.facing, world_to_screen_fn)
    right_m = _leg_metrics(pose.right_leg, cp.right, cp.ground_y, pose.facing, world_to_screen_fn)

    r_qa = render_qa or {}
    contact_errs = [float(x) for x in (r_qa.get("contact_errors") or [])]
    render_errors = list(r_qa.get("errors") or [])
    dims = list(getattr(viewport, "size", (720, 1280))) if viewport is not None else None

    return {
        "schema": "b6-motion-frame/1",
        "frame": int(frame_idx),
        "t": round(float(t), 5),
        "shot_id": str(shot_id),
        "is_cut": bool(is_cut),
        "state": pose.state,
        "is_moving": bool(cp.is_moving),
        "facing": float(pose.facing),
        "step_index": int(cp.step_index),
        "active_support": cp.active_support,
        "root_x": float(pose.root.world_x),
        "root_y": float(pose.root.world_y),
        "pelvis_drop": float(pose.root.pelvis_drop),
        "root_speed": float(cp.root_speed),
        "ground_y": float(cp.ground_y),
        "viewport_size": dims,
        "left": left_m,
        "right": right_m,
        "upper_body": {
            "left_arm": list(pose.upper_body.left_arm),
            "right_arm": list(pose.upper_body.right_arm),
            "head_angle_deg": float(pose.upper_body.head_angle_deg),
            "torso_lean_deg": float(pose.upper_body.torso_lean_deg),
            "locked_arms": list(pose.upper_body.locked_arms),
        },
        "max_prop_contact_error_px": max(contact_errs, default=0.0),
        "render_errors": render_errors,
    }


def validate_motion_contract(
    report: Sequence[Mapping[str, Any]] | Mapping[str, Any],
    thresholds: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Audit full-sequence motion frames; fail closed on non-finite, inverse knees, foot slide, or straight-leg running."""
    th = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    frames = list(report.get("frames", [])) if isinstance(report, Mapping) else list(report)
    errors: list[str] = []
    warnings: list[str] = []

    if not frames:
        return {
            "schema": "b6-motion-qc/1",
            "status": "fail",
            "errors": ["Empty motion telemetry frames"],
            "warnings": [],
            "thresholds": th,
            "summary": {},
        }

    max_drift = 0.0
    max_pen = 0.0
    max_len_err = 0.0
    max_knee_bend = 0.0
    max_loco_bend = 0.0
    max_loco_dev = 0.0
    max_prop_err = 0.0
    loco_count = 0
    support_seen: set[str] = set()
    stance_anchors: dict[tuple[str, int], list[tuple[float, float]]] = {}

    prev_frame = None
    for row in frames:
        fidx = row.get("frame", 0)
        root_x = float(row.get("root_x", 0.0))
        root_y = float(row.get("root_y", 0.0))
        if not (math.isfinite(root_x) and math.isfinite(root_y)):
            errors.append(f"Frame {fidx}: non-finite root position")

        if prev_frame is not None and not row.get("is_cut") and row.get("shot_id") == prev_frame.get("shot_id"):
            jump = math.hypot(root_x - float(prev_frame.get("root_x", root_x)), root_y - float(prev_frame.get("root_y", root_y)))
            if jump > float(th["max_unannotated_root_jump_world"]):
                errors.append(f"Frame {fidx}: unannotated root teleport ({jump:.2f} world units)")

        prop_err = float(row.get("max_prop_contact_error_px", 0.0))
        max_prop_err = max(max_prop_err, prop_err)
        if prop_err > float(th["max_prop_contact_err_px"]):
            errors.append(f"Frame {fidx}: prop contact error {prop_err:.3f} > {th['max_prop_contact_err_px']}")

        for r_err in row.get("render_errors") or []:
            errors.append(f"Frame {fidx}: {r_err}")

        is_loco = bool(row.get("is_moving")) or str(row.get("state")) in ("walk", "run", "dash")
        if is_loco:
            loco_count += 1
            support_seen.add(str(row.get("active_support", "")))

        step_idx = int(row.get("step_index", 0))
        for side in ("left", "right"):
            leg = row.get(side) or {}
            if not leg.get("finite", True):
                errors.append(f"Frame {fidx} {side}: non-finite joint coordinate")
                continue
            if not leg.get("knee_forward_ok", True):
                errors.append(f"Frame {fidx} {side}: inverse knee bend detected (forward_offset={leg.get('forward_offset')})")

            bend = float(leg.get("bend_angle_deg", 0.0))
            dev = float(leg.get("knee_deviation", 0.0))
            max_knee_bend = max(max_knee_bend, bend)
            if bend > float(th["max_knee_bend_deg"]):
                errors.append(f"Frame {fidx} {side}: excessive knee flexion ({bend:.1f} deg)")
            if is_loco:
                max_loco_bend = max(max_loco_bend, bend)
                max_loco_dev = max(max_loco_dev, dev)

            pen = float(leg.get("ground_penetration", 0.0))
            max_pen = max(max_pen, pen)
            if pen > float(th["max_ground_penetration_world"]):
                errors.append(f"Frame {fidx} {side}: ground penetration {pen:.2f} > {th['max_ground_penetration_world']}")

            u_nom = max(1e-4, float(leg.get("upper_len", 1.0)))
            l_nom = max(1e-4, float(leg.get("lower_len", 1.0)))
            u_err = abs(float(leg.get("actual_upper_len", u_nom)) - u_nom) / u_nom
            l_err = abs(float(leg.get("actual_lower_len", l_nom)) - l_nom) / l_nom
            len_err = max(u_err, l_err)
            max_len_err = max(max_len_err, len_err)
            if len_err > float(th["max_bone_length_rel_err"]):
                errors.append(f"Frame {fidx} {side}: limb length drift rel={len_err:.4f} > {th['max_bone_length_rel_err']}")

            drift = float(leg.get("world_drift", 0.0))
            max_drift = max(max_drift, drift)
            if drift > float(th["max_stance_drift_world"]):
                errors.append(f"Frame {fidx} {side}: stance foot drift {drift:.3f} > {th['max_stance_drift_world']}")

            if is_loco and leg.get("contact_state") == "stance":
                stance_anchors.setdefault((side, step_idx), []).append(tuple(leg.get("ankle", (0.0, 0.0))))

        prev_frame = row

    # Measure multi-frame ankle stability within each planted step anchor
    max_step_spread = 0.0
    for (_, _), pts in stance_anchors.items():
        if len(pts) >= 2:
            arr = np.asarray(pts, dtype=float)
            spread = float(np.max(np.linalg.norm(arr - arr[0], axis=1)))
            max_step_spread = max(max_step_spread, spread)
            if spread > float(th["max_stance_drift_world"]):
                errors.append(f"Multi-frame stance ankle slipped {spread:.3f} world units (> {th['max_stance_drift_world']})")

    if loco_count > 0:
        if max_loco_bend < float(th["min_locomotion_knee_bend_deg"]):
            errors.append(f"Locomotion has no real knee bend (max {max_loco_bend:.2f} deg < {th['min_locomotion_knee_bend_deg']})")
        if max_loco_dev < float(th["min_locomotion_knee_deviation_px"]):
            errors.append(f"Locomotion knees collinear with hip-ankle line (dev={max_loco_dev:.2f} < {th['min_locomotion_knee_deviation_px']})")
        if not ({"left", "right"}.issubset(support_seen)):
            errors.append(f"Locomotion failed to alternate left/right support phases: observed {sorted(support_seen)}")

    return {
        "schema": "b6-motion-qc/1",
        "status": "pass" if not errors else "fail",
        "errors": errors,
        "warnings": warnings,
        "thresholds": dict(th),
        "summary": {
            "total_frames": len(frames),
            "locomotion_frames": loco_count,
            "supports_observed": sorted(support_seen),
            "max_stance_drift_world": round(max(max_drift, max_step_spread), 5),
            "max_ground_penetration_world": round(max_pen, 5),
            "max_bone_length_rel_err": round(max_len_err, 6),
            "max_knee_bend_deg": round(max_knee_bend, 2),
            "max_locomotion_knee_deviation_px": round(max_loco_dev, 2),
            "max_prop_contact_error_px": round(max_prop_err, 6),
        },
    }


def generate_motion_preview(
    project_dir: str | Path,
    shot_id: str | None = None,
    start: float | None = None,
    seconds: float | None = None,
    draft_scale: float = 0.5,
    output_rel: str | None = None,
) -> dict[str, Any]:
    """Render a local scoped shot slice (`draft`) cleanly without running full 10s encode."""
    proj = Path(project_dir).resolve()
    run_py = proj / "run.py"
    if not run_py.is_file():
        raise FileNotFoundError(f"Missing run.py in {proj}")

    ctrl_path = proj / "scene-control.json"
    s_t = float(start if start is not None else 0.0)
    dur_t = float(seconds if seconds is not None else 1.5)
    if shot_id and ctrl_path.is_file():
        plan = json.loads(ctrl_path.read_text(encoding="utf8"))
        match = next((s for s in plan.get("shots", []) if s.get("id") == shot_id), None)
        if not match:
            raise ValueError(f"Unknown shot_id: {shot_id}")
        s_t = float(match["start"]) if start is None else s_t
        dur_t = float(match["end"]) - float(match["start"]) if seconds is None else dur_t

    out_dir_rel = output_rel or f"outputs/motion-shot-draft-{shot_id or 'slice'}"
    out_abs = (proj / out_dir_rel).resolve()
    if out_abs.exists():
        import shutil
        shutil.rmtree(out_abs, ignore_errors=True)

    env = {
        **os.environ,
        "PYTHONUTF8": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPYCACHEPREFIX": str(proj.parent.parent / "cache" / "pycache"),
    }
    cmd = [
        sys.executable,
        "-B",
        str(run_py),
        "draft",
        str(proj),
        "--ratio",
        "9:16",
        "--trusted-code",
        "--draft-scale",
        str(draft_scale),
        "--start",
        f"{s_t:.3f}",
        "--seconds",
        f"{dur_t:.3f}",
        "--output",
        out_dir_rel,
        "--report",
        f"{out_dir_rel}/report.json",
    ]
    res = subprocess.run(cmd, cwd=str(proj), env=env, capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise RuntimeError(f"Shot draft preview failed ({res.returncode}): {res.stderr or res.stdout}")
    rep_file = proj / out_dir_rel / "report.json"
    return json.loads(rep_file.read_text(encoding="utf8")) if rep_file.is_file() else {"ok": True, "output": out_dir_rel}
