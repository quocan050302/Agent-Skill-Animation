"""Independent Semantic Visual QA Evaluator (`b6-semantic-qc/1`).

Audits per-frame semantic evidence + decoded MP4 verification against compiled
`b6-semantic-action/1` contracts, classifying every action as verified pass,
verified fail (with machine-readable reason codes), or uncertain (flagged for
human visual inspection without fabricating PASS).
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence

try:
    from .b6_semantic_contract import SEMANTIC_CONTRACT_SCHEMA, compile_semantic_action_plan
    from .b6_semantic_evidence import measure_action_trajectory, measure_pose_change
except ImportError:
    from b6_semantic_contract import SEMANTIC_CONTRACT_SCHEMA, compile_semantic_action_plan
    from b6_semantic_evidence import measure_action_trajectory, measure_pose_change

SEMANTIC_QC_SCHEMA = "b6-semantic-qc/1"
SEMANTIC_REPORT_SCHEMA = "b6-semantic-report/1"

REASON_CODES = (
    "SEMANTIC_TIMELINE_INVALID",
    "SEMANTIC_CAUSALITY_BROKEN",
    "SEMANTIC_UNKNOWN_ACTION_WITHOUT_CRITERIA",
    "SEMANTIC_EVIDENCE_MISSING",
    "SEMANTIC_EVIDENCE_COVERAGE_INCOMPLETE",
    "SEMANTIC_DECODED_FRAME_MISMATCH",
    "SEMANTIC_ACTOR_MISSING_OR_INVISIBLE",
    "SEMANTIC_PROP_MISSING_OR_INVISIBLE",
    "SEMANTIC_ACTION_NO_TRAJECTORY",
    "SEMANTIC_POSE_CHANGE_MISSING",
    "SEMANTIC_CONTACT_MISSING",
    "SEMANTIC_HIDE_OCCLUSION_INSUFFICIENT",
    "SEMANTIC_AVOIDANCE_FAILED",
    "SEMANTIC_DETACH_NOT_OBSERVED",
    "SEMANTIC_REATTACH_NOT_OBSERVED",
    "SEMANTIC_ORIENTATION_MISMATCH",
    "SEMANTIC_REACTION_NOT_OBSERVED",
    "SEMANTIC_STALE_BINDING",
    "SEMANTIC_HASH_TAMPERED",
)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: str | Path) -> str | None:
    p = Path(path)
    return _sha256_bytes(p.read_bytes()) if p.is_file() else None


def _select_window(
    frame_records: Sequence[Mapping[str, Any]],
    start_s: float,
    end_s: float,
    *,
    pad_before_s: float = 0.0,
    pad_after_s: float = 0.0,
) -> list[Mapping[str, Any]]:
    lo = float(start_s) - pad_before_s
    hi = float(end_s) + pad_after_s
    return [r for r in frame_records if lo - 1e-4 <= float(r.get("t", -1.0)) <= hi + 1e-4]


def validate_evidence_coverage(
    compiled_plan: Mapping[str, Any],
    frame_records: Sequence[Mapping[str, Any]],
    *,
    expected_fps: float | None = None,
) -> dict[str, Any]:
    """Verify monotonic frame evidence covers every semantic action window without gaps."""
    errors: list[str] = []
    reason_codes: list[str] = []
    fps = float(expected_fps or compiled_plan.get("fps") or 30.0)
    actions = compiled_plan.get("actions") or []

    if not frame_records:
        return {
            "ok": False,
            "frames_checked": 0,
            "coverage_ratio": 0.0,
            "errors": ["SEMANTIC_EVIDENCE_MISSING: zero semantic evidence frames supplied."],
            "reason_codes": ["SEMANTIC_EVIDENCE_MISSING"],
            "per_action_coverage": {},
        }

    # Verify strictly ascending frames without duplicates or NaN timestamps
    seen_frames: set[int] = set()
    prev_t = -1.0
    for idx, rec in enumerate(frame_records):
        fr = rec.get("frame")
        t_val = rec.get("t")
        if fr is None or t_val is None or not math.isfinite(float(t_val)):
            errors.append(f"SEMANTIC_EVIDENCE_MISSING: malformed frame/t at record {idx}.")
            reason_codes.append("SEMANTIC_EVIDENCE_MISSING")
            continue
        fi = int(fr)
        ft = float(t_val)
        if fi in seen_frames or ft < prev_t - 1e-4:
            errors.append(f"SEMANTIC_EVIDENCE_COVERAGE_INCOMPLETE: non-monotonic or duplicate frame {fi} (t={ft}).")
            reason_codes.append("SEMANTIC_EVIDENCE_COVERAGE_INCOMPLETE")
        seen_frames.add(fi)
        prev_t = ft

    per_action: dict[str, dict[str, Any]] = {}
    cov_scores: list[float] = []
    for act in actions:
        aid = str(act.get("id") or "")
        s0 = float(act.get("start_s", 0.0))
        s1 = float(act.get("end_s", 0.0))
        expected_n = max(1, int(round((s1 - s0) * fps)))
        # Strictly inside half-open [s0, s1)
        win = [r for r in frame_records if s0 - 1e-4 <= float(r.get("t", -1.0)) < s1 - 1e-4]
        actual_n = len(win)
        ratio = round(min(1.0, float(actual_n) / float(expected_n)), 4)
        cov_scores.append(ratio)
        per_action[aid] = {"expected_frames": expected_n, "actual_frames": actual_n, "coverage_ratio": ratio}
        if ratio < 0.9:
            errors.append(
                f"SEMANTIC_EVIDENCE_COVERAGE_INCOMPLETE: action '{aid}' [{s0:.2f}s..{s1:.2f}s] has only {actual_n}/{expected_n} frames."
            )
            reason_codes.append("SEMANTIC_EVIDENCE_COVERAGE_INCOMPLETE")

    overall_cov = round(sum(cov_scores) / len(cov_scores), 4) if cov_scores else 1.0
    return {
        "ok": len(errors) == 0,
        "frames_checked": len(frame_records),
        "coverage_ratio": overall_cov,
        "errors": errors,
        "reason_codes": sorted(set(reason_codes)),
        "per_action_coverage": per_action,
    }


def classify_semantic_uncertainty(action_eval: Mapping[str, Any]) -> str:
    """Classify evaluated semantic action cleanly without fabricating confidence."""
    if not action_eval.get("passed", False):
        return "verified_fail"
    if action_eval.get("uncertain", False):
        return "uncertain_needs_human_review"
    margins = [float(m) for m in (action_eval.get("margins") or []) if math.isfinite(float(m))]
    if margins and min(margins) < 1.12:
        return "uncertain_needs_human_review"
    return "verified_pass"


def _evaluate_single_action(
    act: Mapping[str, Any],
    frame_records: Sequence[Mapping[str, Any]],
    fps: float,
) -> dict[str, Any]:
    aid = str(act.get("id") or "")
    atype = str(act.get("action_type") or "")
    actor_id = str(act.get("actor_id") or "")
    prop_id = str(act.get("target_prop_id") or "")
    occ_id = str(act.get("occluder_id") or prop_id or "")
    s0 = float(act.get("start_s", 0.0))
    s1 = float(act.get("end_s", 0.0))
    reqs = dict(act.get("evidence_requirements") or {})

    win = [r for r in frame_records if s0 - 1e-4 <= float(r.get("t", -1.0)) < s1 + 1e-4]
    before_win = [r for r in frame_records if (s0 - 0.25) <= float(r.get("t", -1.0)) < s0 - 1e-4]
    after_win = [r for r in frame_records if s1 - 1e-4 <= float(r.get("t", -1.0)) <= (s1 + 0.25)]
    if not win:
        return {
            "id": aid,
            "action_type": atype,
            "actor_id": actor_id,
            "passed": False,
            "uncertain": False,
            "classification": "verified_fail",
            "reason_codes": ["SEMANTIC_EVIDENCE_MISSING"],
            "errors": [f"SEMANTIC_EVIDENCE_MISSING: no frames observed for action '{aid}'."],
            "metrics": {},
            "margins": [],
        }

    errors: list[str] = []
    reasons: list[str] = []
    margins: list[float] = []
    metrics: dict[str, Any] = {
        "window_frames": len(win),
        "start_s": s0,
        "end_s": s1,
    }

    # 1. Actor visibility audit
    actor_rows = [(r, (r.get("actors") or {}).get(actor_id)) for r in win]
    valid_actor_rows = [(r, a) for r, a in actor_rows if a is not None]
    min_vis = float(reqs.get("min_actor_visible", 0.35))
    occ_req = bool(reqs.get("requires_occlusion", False))
    vis_ok_count = 0
    for r, a in valid_actor_rows:
        in_f = bool(a.get("in_frame")) and int(a.get("visible_pixels", 0)) >= 24
        vf = float(a.get("visible_fraction", 0.0))
        occ_info = (r.get("occlusions") or {}).get(f"{actor_id}@{occ_id}") or {}
        occ_r = float(occ_info.get("occlusion_ratio", 0.0))
        if in_f and (vf >= min_vis or (occ_req and occ_r >= 0.2)):
            vis_ok_count += 1
        elif occ_req and int(a.get("raw_pixels", 0)) >= 24 and occ_r >= 0.3:
            vis_ok_count += 1

    vis_ratio = float(vis_ok_count) / float(max(1, len(win)))
    metrics["actor_visible_frame_ratio"] = round(vis_ratio, 4)
    if reqs.get("requires_visibility", True):
        if not valid_actor_rows or vis_ratio < 0.65:
            errors.append(
                f"SEMANTIC_ACTOR_MISSING_OR_INVISIBLE: '{aid}' actor '{actor_id}' visible only {vis_ratio:.2f} of window."
            )
            reasons.append("SEMANTIC_ACTOR_MISSING_OR_INVISIBLE")
        else:
            margins.append(vis_ratio / 0.65)

    # 2. Prop visibility audit
    prop_rows = [(r, (r.get("props") or {}).get(prop_id)) for r in win] if prop_id else []
    if reqs.get("requires_prop_visibility", False):
        min_p_vis = float(reqs.get("min_prop_visible", 0.25))
        p_ok = sum(
            1
            for _, p in prop_rows
            if p is not None and bool(p.get("in_frame")) and int(p.get("visible_pixels", 0)) >= 16 and float(p.get("visible_fraction", 0.0)) >= min_p_vis
        )
        p_ratio = float(p_ok) / float(max(1, len(win)))
        metrics["prop_visible_frame_ratio"] = round(p_ratio, 4)
        # Allow detach action early frames before prop splits onto stage
        min_req_p_ratio = 0.45 if atype in ("detach", "reattach") else 0.65
        if p_ratio < min_req_p_ratio:
            errors.append(
                f"SEMANTIC_PROP_MISSING_OR_INVISIBLE: '{aid}' prop '{prop_id}' visible only {p_ratio:.2f} (< {min_req_p_ratio})."
            )
            reasons.append("SEMANTIC_PROP_MISSING_OR_INVISIBLE")
        else:
            margins.append(p_ratio / min_req_p_ratio)

    # 3. Actor trajectory audit (walk, run, chase, avoid_obstacle)
    traj_a = measure_action_trajectory(win, actor_id, entity_kind="actor", fps=fps)
    metrics["actor_trajectory"] = traj_a
    if reqs.get("requires_trajectory", False):
        min_disp = float(reqs.get("min_displacement_px", 20.0))
        min_spd = float(reqs.get("min_speed_px_s", 0.0))
        # Use path_length or x/y span so back-and-forth chase or dodge is also counted
        observed_motion = max(float(traj_a["path_length_px"]), float(traj_a["net_displacement_px"]))
        if observed_motion < min_disp or (min_spd > 0.0 and float(traj_a["peak_speed_px_s"]) < min_spd):
            errors.append(
                f"SEMANTIC_ACTION_NO_TRAJECTORY: '{aid}' ({atype}) actor '{actor_id}' path={observed_motion:.1f}px < {min_disp}px (peak {traj_a['peak_speed_px_s']:.1f}px/s)."
            )
            reasons.append("SEMANTIC_ACTION_NO_TRAJECTORY")
        else:
            margins.append(observed_motion / max(1e-3, min_disp))

    # 4. Prop trajectory / drop / bounce / roll audit
    if prop_id and (
        reqs.get("requires_prop_trajectory", False)
        or reqs.get("requires_bounce", False)
        or reqs.get("requires_rotation", False)
    ):
        traj_p = measure_action_trajectory(win, prop_id, entity_kind="prop", fps=fps)
        metrics["prop_trajectory"] = traj_p
        min_pd = float(reqs.get("min_prop_displacement_px", 20.0))
        observed_pm = max(float(traj_p["path_length_px"]), float(traj_p["net_displacement_px"]))
        if observed_pm < min_pd:
            errors.append(
                f"SEMANTIC_ACTION_NO_TRAJECTORY: '{aid}' ({atype}) prop '{prop_id}' path={observed_pm:.1f}px < {min_pd}px."
            )
            reasons.append("SEMANTIC_ACTION_NO_TRAJECTORY")
        else:
            margins.append(observed_pm / max(1e-3, min_pd))
        if reqs.get("min_prop_dy_px") is not None:
            min_dy = float(reqs["min_prop_dy_px"])
            # Positive screen y is downward
            dy_down = max(float(traj_p["net_dy_px"]), float(traj_p["y_span_px"]))
            if dy_down < min_dy:
                errors.append(
                    f"SEMANTIC_ACTION_NO_TRAJECTORY: '{aid}' drop prop '{prop_id}' dy={dy_down:.1f}px < {min_dy}px."
                )
                reasons.append("SEMANTIC_ACTION_NO_TRAJECTORY")
        if reqs.get("requires_bounce", False):
            if int(traj_p["vertical_reversals"]) < 1 or float(traj_p["y_span_px"]) < 10.0:
                errors.append(
                    f"SEMANTIC_ACTION_NO_TRAJECTORY: '{aid}' bounce prop '{prop_id}' reversals={traj_p['vertical_reversals']}, y_span={traj_p['y_span_px']:.1f}px."
                )
                reasons.append("SEMANTIC_ACTION_NO_TRAJECTORY")
        if reqs.get("requires_rotation", False):
            min_rot = float(reqs.get("min_prop_rotation_deg", 30.0))
            if float(traj_p["total_rotation_deg"]) < min_rot:
                errors.append(
                    f"SEMANTIC_ACTION_NO_TRAJECTORY: '{aid}' roll prop '{prop_id}' rotation={traj_p['total_rotation_deg']:.1f}deg < {min_rot}deg."
                )
                reasons.append("SEMANTIC_ACTION_NO_TRAJECTORY")
            else:
                margins.append(float(traj_p["total_rotation_deg"]) / max(1e-3, min_rot))

    # 5. Pose change audit (trip, fall, sneeze, kneel, recover, reach)
    if reqs.get("requires_pose_change", False):
        seq_for_pose = list(before_win[-1:]) + list(win)
        max_shift = 0.0
        max_head_d = 0.0
        max_aspect_d = 0.0
        min_cy = float("inf")
        max_cy = float("-inf")
        max_hand_approach = 0.0
        best_start_gap = None
        min_end_gap = None

        for i in range(1, len(seq_for_pose)):
            a0 = (seq_for_pose[i - 1].get("actors") or {}).get(actor_id)
            a1 = (seq_for_pose[i].get("actors") or {}).get(actor_id)
            pc = measure_pose_change(a0, a1)
            max_shift = max(max_shift, pc["centroid_shift_px"])
            max_head_d = max(max_head_d, pc["head_angle_delta_deg"])
            max_aspect_d = max(max_aspect_d, pc["aspect_delta"])
            if a1 and a1.get("centroid_xy"):
                cy = float(a1["centroid_xy"][1])
                min_cy = min(min_cy, cy)
                max_cy = max(max_cy, cy)

        # Also compare earliest vs extreme pose across whole window for gradual sneeze/trip/fall
        a_first = ((before_win[-1] if before_win else win[0]).get("actors") or {}).get(actor_id)
        for r in win:
            ar = (r.get("actors") or {}).get(actor_id)
            if a_first and ar:
                pc_w = measure_pose_change(a_first, ar)
                max_shift = max(max_shift, pc_w["centroid_shift_px"])
                max_head_d = max(max_head_d, pc_w["head_angle_delta_deg"])
                max_aspect_d = max(max_aspect_d, pc_w["aspect_delta"])
            if prop_id:
                cinfo = (r.get("contacts") or {}).get(f"{actor_id}->{prop_id}") or {}
                if cinfo.get("min_gap_px") is not None:
                    g = float(cinfo["min_gap_px"])
                    if best_start_gap is None:
                        best_start_gap = g
                    min_end_gap = g if min_end_gap is None else min(min_end_gap, g)
        if best_start_gap is not None and min_end_gap is not None:
            max_hand_approach = max(0.0, best_start_gap - min_end_gap)

        y_drop = (max_cy - min_cy) if (math.isfinite(min_cy) and math.isfinite(max_cy)) else 0.0
        metrics["pose_change"] = {
            "max_centroid_shift_px": round(max_shift, 2),
            "y_drop_px": round(y_drop, 2),
            "max_aspect_delta": round(max_aspect_d, 4),
            "max_head_angle_delta_deg": round(max_head_d, 2),
            "hand_approach_delta_px": round(max_hand_approach, 2),
        }

        pose_ok = True
        if reqs.get("min_head_angle_delta_deg") is not None and max_head_d < float(reqs["min_head_angle_delta_deg"]):
            pose_ok = False
        if reqs.get("min_centroid_shift_px") is not None and max_shift < float(reqs["min_centroid_shift_px"]):
            pose_ok = False
        if reqs.get("min_centroid_y_drop_px") is not None and y_drop < float(reqs["min_centroid_y_drop_px"]):
            pose_ok = False
        if reqs.get("min_bbox_aspect_delta") is not None and max_aspect_d < float(reqs["min_bbox_aspect_delta"]):
            pose_ok = False
        if reqs.get("min_hand_approach_delta_px") is not None and max_hand_approach < float(reqs["min_hand_approach_delta_px"]):
            pose_ok = False
        if not pose_ok:
            errors.append(
                f"SEMANTIC_POSE_CHANGE_MISSING: '{aid}' ({atype}) shift={max_shift:.1f}px y_drop={y_drop:.1f}px aspect_d={max_aspect_d:.3f} head_d={max_head_d:.1f}deg hand_app={max_hand_approach:.1f}px."
            )
            reasons.append("SEMANTIC_POSE_CHANGE_MISSING")

    # 6. Contact audit (take, grab, hold)
    if reqs.get("requires_contact", False) and prop_id:
        max_gap = float(reqs.get("max_contact_px", 20.0))
        gaps = [
            float(c["min_gap_px"])
            for r in win
            for c in [(r.get("contacts") or {}).get(f"{actor_id}->{prop_id}") or {}]
            if c.get("min_gap_px") is not None
        ]
        min_gap_obs = min(gaps) if gaps else None
        contact_frames = sum(1 for g in gaps if g <= max_gap)
        metrics["contact"] = {
            "target_prop_id": prop_id,
            "min_gap_px": min_gap_obs,
            "contact_frames": contact_frames,
            "max_allowed_gap_px": max_gap,
        }
        required_frames = 2 if atype in ("take", "grab") else max(2, int(round(0.45 * len(win))))
        if min_gap_obs is None or min_gap_obs > max_gap or contact_frames < min(len(win), required_frames):
            errors.append(
                f"SEMANTIC_CONTACT_MISSING: '{aid}' ({atype}) actor '{actor_id}' -> prop '{prop_id}' min_gap={min_gap_obs}px (allowed <= {max_gap}px, contact_frames={contact_frames})."
            )
            reasons.append("SEMANTIC_CONTACT_MISSING")
        else:
            margins.append(max_gap / max(0.5, min_gap_obs))

    # 7. Collision audit
    if reqs.get("requires_collision", False) and occ_id:
        max_c_gap = float(reqs.get("max_collision_gap_px", 22.0))
        c_gaps: list[float] = []
        for r in win:
            c = (r.get("contacts") or {}).get(f"{actor_id}@{occ_id}") or (r.get("contacts") or {}).get(f"{actor_id}:body->{occ_id}") or {}
            if c.get("min_gap_px") is not None:
                c_gaps.append(float(c["min_gap_px"]))
        min_c_gap = min(c_gaps) if c_gaps else None
        metrics["collision"] = {"target_id": occ_id, "min_gap_px": min_c_gap, "max_allowed_px": max_c_gap}
        if min_c_gap is None or min_c_gap > max_c_gap:
            errors.append(
                f"SEMANTIC_CONTACT_MISSING: '{aid}' collision '{actor_id}' @ '{occ_id}' min_gap={min_c_gap}px > {max_c_gap}px."
            )
            reasons.append("SEMANTIC_CONTACT_MISSING")
        else:
            margins.append(max_c_gap / max(0.5, min_c_gap))

    # 8. Occlusion / hide_behind audit
    if occ_req:
        min_occ = float(reqs.get("min_occlusion_ratio", 0.35))
        occ_ratios: list[float] = []
        in_front_leaks: list[float] = []
        for r in win:
            o = (r.get("occlusions") or {}).get(f"{actor_id}@{occ_id}")
            if o is None:
                # Try matching any occluder id containing occ_id
                for k, val in (r.get("occlusions") or {}).items():
                    if k.startswith(f"{actor_id}@") and occ_id in k:
                        o = val
                        break
            if o:
                occ_ratios.append(float(o.get("occlusion_ratio", 0.0)))
                in_front_leaks.append(float(o.get("in_front_leak_ratio", 0.0)))
        peak_occ = max(occ_ratios, default=0.0)
        sustained_occ = sum(1 for x in occ_ratios if x >= min_occ)
        mean_leak = (sum(in_front_leaks) / len(in_front_leaks)) if in_front_leaks else 0.0
        metrics["occlusion"] = {
            "occluder_id": occ_id,
            "peak_occlusion_ratio": round(peak_occ, 4),
            "sustained_frames": sustained_occ,
            "mean_in_front_leak_ratio": round(mean_leak, 4),
            "required_ratio": min_occ,
        }
        if peak_occ < min_occ or sustained_occ < min(len(win), 3) or (mean_leak > peak_occ * 1.35 and peak_occ < 0.5):
            errors.append(
                f"SEMANTIC_HIDE_OCCLUSION_INSUFFICIENT: '{aid}' hide_behind '{occ_id}' peak_occlusion={peak_occ:.3f} < {min_occ}, sustained={sustained_occ}, in_front_leak={mean_leak:.3f}."
            )
            reasons.append("SEMANTIC_HIDE_OCCLUSION_INSUFFICIENT")
        else:
            margins.append(peak_occ / max(1e-3, min_occ))

    # 9. Avoid obstacle audit
    if reqs.get("requires_avoidance", False) and occ_id:
        # Must move across/around obstacle AND have clean clearance height / lateral displacement
        min_arc = float(reqs.get("min_clearance_arc_px", 12.0))
        ys = [
            float(a["centroid_xy"][1])
            for _, a in valid_actor_rows
            if a.get("centroid_xy")
        ]
        xs = [
            float(a["centroid_xy"][0])
            for _, a in valid_actor_rows
            if a.get("centroid_xy")
        ]
        y_arc = (max(ys) - min(ys)) if len(ys) >= 2 else 0.0
        x_span = (max(xs) - min(xs)) if len(xs) >= 2 else 0.0
        # Also verify actor didn't stop dead overlapped with obstacle
        end_gaps = []
        for r in win[-max(1, len(win) // 3):]:
            c = (r.get("contacts") or {}).get(f"{actor_id}@{occ_id}") or {}
            if c.get("min_gap_px") is not None:
                end_gaps.append(float(c["min_gap_px"]))
        end_overlap = (
            (win[-1].get("contacts") or {}).get(f"{actor_id}@{occ_id}", {}).get("overlap_pixels", 0)
            if win
            else 0
        )
        metrics["avoidance"] = {
            "occluder_id": occ_id,
            "y_clearance_arc_px": round(y_arc, 2),
            "x_span_px": round(x_span, 2),
            "end_overlap_pixels": int(end_overlap),
        }
        if max(y_arc, x_span) < float(reqs.get("min_displacement_px", 30.0)) or (y_arc < min_arc and x_span < 40.0):
            errors.append(
                f"SEMANTIC_AVOIDANCE_FAILED: '{aid}' avoid '{occ_id}' insufficient clearance (y_arc={y_arc:.1f}px, x_span={x_span:.1f}px)."
            )
            reasons.append("SEMANTIC_AVOIDANCE_FAILED")

    # 10. Detach state transition + visible separation audit
    if reqs.get("requires_detach", False):
        before_states = [
            str((r.get("actors") or {}).get(actor_id, {}).get("head_mount_state") or "attached")
            for r in before_win
        ]
        win_states = [
            str((r.get("actors") or {}).get(actor_id, {}).get("head_mount_state") or "attached")
            for r in win
        ]
        saw_detached = any(st in ("detaching", "detached") for st in win_states)
        ended_detached = bool(win_states and win_states[-1] == "detached")
        min_sep = float(reqs.get("min_detach_separation_px", 18.0))
        max_sep = 0.0
        if prop_id:
            for r in win:
                a_r = (r.get("actors") or {}).get(actor_id)
                p_r = (r.get("props") or {}).get(prop_id)
                if a_r and p_r and a_r.get("bbox") and p_r.get("centroid_xy"):
                    # Estimate actor top-collar anchor near upper 20% of body bbox
                    ab = a_r["bbox"]
                    neck_x = 0.5 * (float(ab[0]) + float(ab[2]))
                    neck_y = float(ab[1]) + 0.12 * (float(ab[3]) - float(ab[1]))
                    pc = p_r["centroid_xy"]
                    max_sep = max(max_sep, math.hypot(float(pc[0]) - neck_x, float(pc[1]) - neck_y))
        metrics["detach"] = {
            "before_states": before_states[-2:],
            "end_state": win_states[-1] if win_states else None,
            "saw_detached": saw_detached,
            "ended_detached": ended_detached,
            "max_separation_px": round(max_sep, 2),
        }
        if not saw_detached or not ended_detached or (prop_id and max_sep < min_sep):
            errors.append(
                f"SEMANTIC_DETACH_NOT_OBSERVED: '{aid}' detached={ended_detached}, max_sep={max_sep:.1f}px < {min_sep}px."
            )
            reasons.append("SEMANTIC_DETACH_NOT_OBSERVED")
        elif prop_id:
            margins.append(max_sep / max(1.0, min_sep))

    # 11. Reattach + optional backwards orientation audit
    if reqs.get("requires_reattach", False):
        prev_states = [
            str((r.get("actors") or {}).get(actor_id, {}).get("head_mount_state") or "attached")
            for r in before_win[-3:]
        ]
        win_states = [
            str((r.get("actors") or {}).get(actor_id, {}).get("head_mount_state") or "attached")
            for r in win
        ]
        after_states = [
            str((r.get("actors") or {}).get(actor_id, {}).get("head_mount_state") or "attached")
            for r in after_win[:3]
        ]
        entered_detached = any(st in ("detached", "reattaching") for st in (prev_states + win_states[:2]))
        ended_attached = bool((after_states[-1:] or win_states[-1:]) == ["attached"])
        orphan_prop_at_end = False
        if prop_id and win:
            last_p = (win[-1].get("props") or {}).get(prop_id)
            if last_p and int(last_p.get("visible_pixels", 0)) >= 32 and str(last_p.get("state")) == "detached":
                orphan_prop_at_end = True
        expected_ori = str(reqs.get("expected_orientation") or "").strip().lower()
        expected_hv = str(reqs.get("expected_head_variant") or "").strip().lower()
        last_hv = str(((after_win[0] if after_win else win[-1]).get("actors") or {}).get(actor_id, {}).get("head_variant") or "").lower()

        metrics["reattach"] = {
            "entered_detached": entered_detached,
            "ended_attached": ended_attached,
            "orphan_prop_at_end": orphan_prop_at_end,
            "observed_head_variant": last_hv,
            "expected_orientation": expected_ori or None,
        }
        if not entered_detached or not ended_attached or orphan_prop_at_end:
            errors.append(
                f"SEMANTIC_REATTACH_NOT_OBSERVED: '{aid}' entered_detached={entered_detached} ended_attached={ended_attached} orphan={orphan_prop_at_end}."
            )
            reasons.append("SEMANTIC_REATTACH_NOT_OBSERVED")
        if expected_ori and expected_ori not in last_hv and expected_hv and expected_hv != last_hv:
            errors.append(
                f"SEMANTIC_ORIENTATION_MISMATCH: '{aid}' expected orientation '{expected_ori}', got head_variant='{last_hv}'."
            )
            reasons.append("SEMANTIC_ORIENTATION_MISMATCH")
        elif expected_ori and not expected_hv and expected_ori not in last_hv:
            errors.append(
                f"SEMANTIC_ORIENTATION_MISMATCH: '{aid}' expected orientation '{expected_ori}', got head_variant='{last_hv}'."
            )
            reasons.append("SEMANTIC_ORIENTATION_MISMATCH")

    # 12. Gaze / Reaction / Turn audit
    if reqs.get("requires_reaction", False):
        seq = list(before_win[-2:]) + list(win) + list(after_win[:2])
        expr_changed = False
        facing_changed = False
        max_ha_delta = 0.0
        max_shift_r = 0.0
        base_a = (seq[0].get("actors") or {}).get(actor_id) if seq else None
        for r in seq[1:]:
            cur_a = (r.get("actors") or {}).get(actor_id)
            pc = measure_pose_change(base_a, cur_a)
            expr_changed = expr_changed or bool(pc["expression_changed"])
            facing_changed = facing_changed or bool(pc["facing_changed"])
            max_ha_delta = max(max_ha_delta, float(pc["head_angle_delta_deg"]))
            max_shift_r = max(max_shift_r, float(pc["centroid_shift_px"]))
        min_ha = float(reqs.get("min_head_angle_delta_deg", 4.0))
        reacted = bool(
            (reqs.get("allow_expression_change", True) and expr_changed)
            or (reqs.get("allow_facing_flip", True) and facing_changed)
            or max_ha_delta >= min_ha
            or max_shift_r >= 10.0
        )
        metrics["reaction"] = {
            "expression_changed": expr_changed,
            "facing_changed": facing_changed,
            "max_head_angle_delta_deg": round(max_ha_delta, 2),
            "max_recoil_shift_px": round(max_shift_r, 2),
        }
        if not reacted:
            errors.append(
                f"SEMANTIC_REACTION_NOT_OBSERVED: '{aid}' ({atype}) no expression, facing, head-angle (>= {min_ha}deg), or recoil change observed."
            )
            reasons.append("SEMANTIC_REACTION_NOT_OBSERVED")

    row_out = {
        "id": aid,
        "shot_id": act.get("shot_id", ""),
        "action_type": atype,
        "actor_id": actor_id,
        "target_prop_id": prop_id or None,
        "occluder_id": occ_id or None,
        "start_s": s0,
        "end_s": s1,
        "passed": len(errors) == 0,
        "uncertain": False,
        "errors": errors,
        "reason_codes": sorted(set(reasons)),
        "margins": [round(m, 3) for m in margins],
        "metrics": metrics,
    }
    row_out["classification"] = classify_semantic_uncertainty(row_out)
    row_out["uncertain"] = row_out["classification"] == "uncertain_needs_human_review"
    return row_out


def detect_semantic_mismatch(
    compiled_plan: Mapping[str, Any],
    frame_records: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Audit all declared semantic actions against per-frame geometric & pixel evidence."""
    fps = float(compiled_plan.get("fps") or 30.0)
    actions = compiled_plan.get("actions") or []
    action_results: list[dict[str, Any]] = []
    errors: list[str] = []
    warnings: list[str] = []
    reason_codes: list[str] = []
    uncertain_actions: list[str] = []

    for act in actions:
        res = _evaluate_single_action(act, frame_records, fps)
        action_results.append(res)
        errors.extend(res["errors"])
        reason_codes.extend(res["reason_codes"])
        if res["classification"] == "uncertain_needs_human_review":
            uncertain_actions.append(res["id"])
            warnings.append(
                f"Action '{res['id']}' ({res['action_type']}) passed near boundary and requires human visual confirmation."
            )

    return {
        "action_count": len(actions),
        "verified_action_count": sum(1 for r in action_results if r["passed"]),
        "uncertain_actions": uncertain_actions,
        "action_results": action_results,
        "errors": errors,
        "warnings": warnings,
        "reason_codes": sorted(set(reason_codes)),
    }


def evaluate_semantic_qc(
    plan_or_compiled: Mapping[str, Any],
    frame_records: Sequence[Mapping[str, Any]],
    *,
    video_path: str | Path | None = None,
    video_sha256: str | None = None,
    source_fingerprint: str | None = None,
    evidence_sha256: str | None = None,
    decoded_binding_rows: Sequence[Mapping[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run full independent Semantic QC & emit (semantic_qc, semantic_report)."""
    if plan_or_compiled.get("schema") == SEMANTIC_CONTRACT_SCHEMA:
        compiled = dict(plan_or_compiled)
    else:
        compiled = compile_semantic_action_plan(plan_or_compiled, strict=False)

    errors: list[str] = []
    warnings: list[str] = []
    reason_codes: list[str] = []

    causality = compiled.get("causality") or {}
    if not causality.get("valid", True):
        errors.extend(causality.get("errors") or [])
        reason_codes.append("SEMANTIC_CAUSALITY_BROKEN")
    warnings.extend(causality.get("warnings") or [])

    coverage = validate_evidence_coverage(compiled, frame_records)
    if not coverage["ok"]:
        errors.extend(coverage["errors"])
        reason_codes.extend(coverage["reason_codes"])

    mismatch = detect_semantic_mismatch(compiled, frame_records)
    errors.extend(mismatch["errors"])
    warnings.extend(mismatch["warnings"])
    reason_codes.extend(mismatch["reason_codes"])

    # Verify decoded frame binding if supplied OR recorded per frame
    dec_rows = list(decoded_binding_rows or [r.get("decoded_binding") or {} for r in frame_records])
    dec_checked = 0
    dec_failures = 0
    max_mad = 0.0
    min_corr = 1.0
    for idx, drow in enumerate(dec_rows):
        if not drow:
            continue
        dec_checked += 1
        if drow.get("mad_vs_beauty") is not None:
            max_mad = max(max_mad, float(drow["mad_vs_beauty"]))
        if drow.get("corr_vs_beauty") is not None:
            min_corr = min(min_corr, float(drow["corr_vs_beauty"]))
        if drow.get("binding_ok") is False or float(drow.get("decoded_luma_std", 1.0)) <= 0.15:
            dec_failures += 1
            if dec_failures <= 3:
                errors.append(
                    f"SEMANTIC_DECODED_FRAME_MISMATCH: decoded MP4 binding failed at sample #{idx} (mad={drow.get('mad_vs_beauty')}, corr={drow.get('corr_vs_beauty')})."
                )
    decoded_frame_verified = dec_checked > 0 and dec_failures == 0
    if not decoded_frame_verified:
        if dec_checked == 0:
            errors.append("SEMANTIC_DECODED_FRAME_MISMATCH: no decoded MP4 binding checks executed.")
        reason_codes.append("SEMANTIC_DECODED_FRAME_MISMATCH")

    resolved_vid_sha = video_sha256 or (_sha256_file(video_path) if video_path else None)
    if not source_fingerprint or not str(source_fingerprint).strip():
        errors.append("SEMANTIC_STALE_BINDING: missing non-empty source_fingerprint binding.")
        reason_codes.append("SEMANTIC_STALE_BINDING")
    if not resolved_vid_sha:
        errors.append("SEMANTIC_STALE_BINDING: missing rendered video_sha256 binding.")
        reason_codes.append("SEMANTIC_STALE_BINDING")

    passed = len(errors) == 0
    reason_codes = sorted(set(reason_codes))
    status_str = "pass" if passed else "fail"

    report_doc = {
        "schema": SEMANTIC_REPORT_SCHEMA,
        "contract_schema": SEMANTIC_CONTRACT_SCHEMA,
        "contract_sha256": compiled.get("contract_sha256"),
        "source_fingerprint": source_fingerprint,
        "video_sha256": resolved_vid_sha,
        "evidence_sha256": evidence_sha256,
        "duration_s": compiled.get("duration_s", 0.0),
        "fps": compiled.get("fps", 30.0),
        "frames_checked": coverage["frames_checked"],
        "coverage_ratio": coverage["coverage_ratio"],
        "decoded_binding": {
            "samples_checked": dec_checked,
            "failures": dec_failures,
            "verified": decoded_frame_verified,
            "max_mad_vs_beauty": round(max_mad, 4),
            "min_corr_vs_beauty": round(min_corr, 5),
        },
        "summary": {
            "action_count": mismatch["action_count"],
            "verified_action_count": mismatch["verified_action_count"],
            "uncertain_count": len(mismatch["uncertain_actions"]),
            "status": status_str,
            "pass": passed,
            "coverage_ratio": coverage["coverage_ratio"],
            "frames_checked": coverage["frames_checked"],
        },
        "uncertain_actions": mismatch["uncertain_actions"],
        "action_results": mismatch["action_results"],
        "errors": errors,
        "warnings": warnings,
        "reason_codes": reason_codes,
        "human_visual_review": "PENDING",
    }

    qc_doc = {
        "schema": SEMANTIC_QC_SCHEMA,
        "status": status_str,
        "pass": passed,
        "source_fingerprint": source_fingerprint,
        "video_sha256": resolved_vid_sha,
        "semantic_evidence_sha256": evidence_sha256,
        "contract_sha256": compiled.get("contract_sha256"),
        "semantic_report_sha256": None,
        "action_count": mismatch["action_count"],
        "verified_action_count": mismatch["verified_action_count"],
        "uncertain_actions": mismatch["uncertain_actions"],
        "frames_checked": coverage["frames_checked"],
        "coverage_ratio": coverage["coverage_ratio"],
        "decoded_frame_verified": decoded_frame_verified,
        "errors": errors,
        "warnings": warnings,
        "reason_codes": reason_codes,
        "human_visual_review": "PENDING",
        "user_approval": "PENDING",
    }
    return qc_doc, report_doc


def write_semantic_qc_atomic(
    out_dir: str | Path,
    qc_doc: Mapping[str, Any],
    report_doc: Mapping[str, Any],
) -> tuple[str, str]:
    """Write `semantic-report.json` then bind its exact SHA-256 into `semantic_qc.json` atomically."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rep_path = out / "semantic-report.json"
    qc_path = out / "semantic_qc.json"

    rep_bytes = (json.dumps(report_doc, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    rep_tmp = out / ".semantic-report.json.tmp"
    rep_tmp.write_bytes(rep_bytes)
    rep_tmp.replace(rep_path)

    bound_qc = dict(qc_doc)
    bound_qc["semantic_report_sha256"] = _sha256_bytes(rep_bytes)
    qc_bytes = (json.dumps(bound_qc, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    qc_tmp = out / ".semantic_qc.json.tmp"
    qc_tmp.write_bytes(qc_bytes)
    qc_tmp.replace(qc_path)
    return str(qc_path), str(rep_path)
