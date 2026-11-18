"""Semantic Visual Evidence Extractor & Decoded Frame Binder (`b6-semantic-evidence/1`).

Computes independent pixel, mask, contact, occlusion, trajectory, pose-delta, and
decoded MP4 binding measurements so claimed storyboard actions are backed by real
rendered geometry rather than text metadata or blind pixel MAD.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
import cv2
import numpy as np
from PIL import Image, ImageDraw

SEMANTIC_EVIDENCE_SCHEMA = "b6-semantic-frame/1"
SEMANTIC_EVIDENCE_BUNDLE_SCHEMA = "b6-semantic-evidence/1"


def _to_mask_u8(mask: Any) -> np.ndarray:
    arr = np.asarray(mask)
    if arr.ndim == 3:
        arr = arr[:, :, 3] if arr.shape[2] == 4 else arr[:, :, 0]
    if arr.dtype == np.bool_:
        return np.where(arr, np.uint8(255), np.uint8(0))
    if np.issubdtype(arr.dtype, np.floating):
        scale = 255.0 if float(np.max(arr, initial=0.0)) <= 1.0 else 1.0
        return np.uint8(np.clip(arr * scale, 0.0, 255.0))
    return np.uint8(np.clip(arr, 0, 255))


def _mask_geometry(mask_u8: np.ndarray, *, threshold: int = 32) -> dict[str, Any]:
    h, w = mask_u8.shape[:2]
    ys, xs = np.nonzero(mask_u8 > threshold)
    px = int(len(xs))
    if px == 0:
        return {
            "pixels": 0,
            "centroid_xy": None,
            "bbox": None,
            "width": 0.0,
            "height": 0.0,
            "aspect_ratio": None,
            "in_frame": False,
        }
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    cx = float(xs.mean())
    cy = float(ys.mean())
    bw = float(x1 - x0)
    bh = float(y1 - y0)
    return {
        "pixels": px,
        "centroid_xy": [round(cx, 2), round(cy, 2)],
        "bbox": [x0, y0, x1, y1],
        "width": round(bw, 2),
        "height": round(bh, 2),
        "aspect_ratio": round(bw / max(1.0, bh), 4),
        "in_frame": bool(x1 > 0 and x0 < w and y1 > 0 and y0 < h),
    }


def measure_actor_visibility(
    visible_mask: Any,
    raw_mask: Any | None = None,
    *,
    bbox_fallback: Sequence[float] | None = None,
    canvas_size: tuple[int, int] | None = None,
) -> dict[str, Any]:
    """Measure real rendered actor visibility from composited alpha masks."""
    vis_u8 = _to_mask_u8(visible_mask)
    g_vis = _mask_geometry(vis_u8)
    raw_pixels = g_vis["pixels"]
    raw_bbox = g_vis["bbox"]
    if raw_mask is not None:
        g_raw = _mask_geometry(_to_mask_u8(raw_mask))
        raw_pixels = g_raw["pixels"]
        if g_raw["bbox"] is not None:
            raw_bbox = g_raw["bbox"]
    elif bbox_fallback is not None and len(bbox_fallback) == 4 and g_vis["pixels"] > 0:
        bw = max(1.0, float(bbox_fallback[2]) - float(bbox_fallback[0]))
        bh = max(1.0, float(bbox_fallback[3]) - float(bbox_fallback[1]))
        raw_pixels = max(g_vis["pixels"], int(round(bw * bh * 0.45)))

    vis_frac = (
        round(min(1.0, float(g_vis["pixels"]) / float(raw_pixels)), 4)
        if raw_pixels > 0
        else 0.0
    )
    frame_area = float(vis_u8.shape[0] * vis_u8.shape[1]) if canvas_size is None else float(canvas_size[0] * canvas_size[1])
    area_ratio = round(float(g_vis["pixels"]) / max(1.0, frame_area), 5)
    return {
        "visible_pixels": g_vis["pixels"],
        "raw_pixels": int(raw_pixels),
        "visible_fraction": vis_frac,
        "area_fraction": area_ratio,
        "centroid_xy": g_vis["centroid_xy"],
        "bbox": g_vis["bbox"],
        "raw_bbox": raw_bbox,
        "aspect_ratio": g_vis["aspect_ratio"],
        "in_frame": g_vis["in_frame"] and g_vis["pixels"] >= 24,
    }


def measure_prop_visibility(
    visible_mask: Any,
    raw_mask: Any | None = None,
    *,
    canvas_size: tuple[int, int] | None = None,
) -> dict[str, Any]:
    """Measure rendered prop mask visibility, centroid, and bounding box."""
    vis_u8 = _to_mask_u8(visible_mask)
    g_vis = _mask_geometry(vis_u8)
    raw_px = _mask_geometry(_to_mask_u8(raw_mask))["pixels"] if raw_mask is not None else g_vis["pixels"]
    vis_frac = round(min(1.0, float(g_vis["pixels"]) / float(raw_px)), 4) if raw_px > 0 else 0.0
    _ = canvas_size
    return {
        "visible_pixels": g_vis["pixels"],
        "raw_pixels": int(raw_px),
        "visible_fraction": vis_frac,
        "centroid_xy": g_vis["centroid_xy"],
        "bbox": g_vis["bbox"],
        "aspect_ratio": g_vis["aspect_ratio"],
        "in_frame": g_vis["in_frame"] and g_vis["pixels"] >= 16,
    }


def measure_contact(
    actor_or_hand_masks: Sequence[Any] | Any | None,
    target_mask: Any,
    *,
    hand_points_xy: Sequence[Sequence[float]] | None = None,
    threshold: int = 32,
) -> dict[str, Any]:
    """Measure true minimum pixel distance & overlap between rendered masks (non-cheatable)."""
    tgt_u8 = _to_mask_u8(target_mask)
    tgt_active = tgt_u8 > threshold
    if not np.any(tgt_active):
        return {
            "contact_measured": False,
            "target_present": False,
            "min_gap_px": None,
            "overlap_pixels": 0,
            "touching": False,
        }

    # Exact Euclidean distance from every canvas pixel to nearest active pixel of target_mask
    bg_for_dt = np.where(tgt_active, np.uint8(0), np.uint8(255))
    dist_map = cv2.distanceTransform(bg_for_dt, cv2.DIST_L2, 5)

    min_gap: float | None = None
    overlap_px = 0
    masks_list: list[Any]
    if actor_or_hand_masks is None:
        masks_list = []
    elif isinstance(actor_or_hand_masks, (np.ndarray, Image.Image)):
        masks_list = [actor_or_hand_masks]
    else:
        masks_list = list(actor_or_hand_masks)

    for hm in masks_list:
        if hm is None:
            continue
        hm_u8 = _to_mask_u8(hm)
        active = hm_u8 > threshold
        if not np.any(active):
            continue
        d = float(dist_map[active].min())
        min_gap = d if min_gap is None else min(min_gap, d)
        overlap_px += int(np.count_nonzero(active & tgt_active))

    if min_gap is None and hand_points_xy:
        h, w = dist_map.shape[:2]
        for pt in hand_points_xy:
            if pt is None or len(pt) < 2:
                continue
            px = max(0, min(w - 1, int(round(float(pt[0])))))
            py = max(0, min(h - 1, int(round(float(pt[1])))))
            d = float(dist_map[py, px])
            min_gap = d if min_gap is None else min(min_gap, d)

    return {
        "contact_measured": min_gap is not None,
        "target_present": True,
        "min_gap_px": round(min_gap, 3) if min_gap is not None else None,
        "overlap_pixels": int(overlap_px),
        "touching": bool(min_gap is not None and min_gap <= 6.0),
    }


def measure_occlusion(
    actor_raw_mask: Any,
    actor_visible_mask: Any,
    occluder_mask: Any,
    *,
    threshold: int = 32,
) -> dict[str, Any]:
    """Distinguish true foreground-behind occlusion from actor drawn in front of prop."""
    raw_bin = _to_mask_u8(actor_raw_mask) > threshold
    vis_bin = _to_mask_u8(actor_visible_mask) > threshold
    occ_bin = _to_mask_u8(occluder_mask) > threshold

    raw_px = int(np.count_nonzero(raw_bin))
    vis_px = int(np.count_nonzero(vis_bin))
    occ_px = int(np.count_nonzero(occ_bin))
    if raw_px == 0 or occ_px == 0:
        return {
            "occluder_present": occ_px > 0,
            "actor_raw_pixels": raw_px,
            "actor_visible_pixels": vis_px,
            "raw_overlap_pixels": 0,
            "visible_in_front_pixels": 0,
            "occluded_behind_pixels": 0,
            "occlusion_ratio": 0.0,
            "in_front_leak_ratio": 0.0,
        }

    raw_overlap = raw_bin & occ_bin
    in_front_px = int(np.count_nonzero(vis_bin & occ_bin))
    behind_px = int(np.count_nonzero(raw_overlap & (~vis_bin)))
    return {
        "occluder_present": True,
        "actor_raw_pixels": raw_px,
        "actor_visible_pixels": vis_px,
        "raw_overlap_pixels": int(np.count_nonzero(raw_overlap)),
        "visible_in_front_pixels": in_front_px,
        "occluded_behind_pixels": behind_px,
        "occlusion_ratio": round(float(behind_px) / float(raw_px), 4),
        "in_front_leak_ratio": round(float(in_front_px) / float(raw_px), 4),
    }


def measure_pose_change(prev_actor: Mapping[str, Any] | None, cur_actor: Mapping[str, Any] | None) -> dict[str, Any]:
    """Compute per-step geometric pose delta for an actor record."""
    if not prev_actor or not cur_actor:
        return {
            "centroid_shift_px": 0.0,
            "dy_px": 0.0,
            "aspect_delta": 0.0,
            "head_angle_delta_deg": 0.0,
            "facing_changed": False,
            "expression_changed": False,
            "knee_bend_delta_deg": 0.0,
        }
    c0 = prev_actor.get("centroid_xy")
    c1 = cur_actor.get("centroid_xy")
    shift = 0.0
    dy = 0.0
    if c0 and c1:
        dx = float(c1[0]) - float(c0[0])
        dy = float(c1[1]) - float(c0[1])
        shift = math.hypot(dx, dy)
    ar0 = prev_actor.get("aspect_ratio")
    ar1 = cur_actor.get("aspect_ratio")
    ar_delta = abs(float(ar1) - float(ar0)) if (ar0 is not None and ar1 is not None) else 0.0
    ha_delta = abs(float(cur_actor.get("head_angle_deg", 0.0)) - float(prev_actor.get("head_angle_deg", 0.0)))
    kb_delta = abs(float(cur_actor.get("knee_bend_deg", 0.0)) - float(prev_actor.get("knee_bend_deg", 0.0)))
    return {
        "centroid_shift_px": round(shift, 3),
        "dy_px": round(dy, 3),
        "aspect_delta": round(ar_delta, 4),
        "head_angle_delta_deg": round(ha_delta, 3),
        "facing_changed": prev_actor.get("facing") != cur_actor.get("facing"),
        "expression_changed": str(prev_actor.get("head_variant") or "") != str(cur_actor.get("head_variant") or ""),
        "knee_bend_delta_deg": round(kb_delta, 3),
    }


def measure_action_trajectory(
    frame_records: Sequence[Mapping[str, Any]],
    entity_id: str,
    *,
    entity_kind: str = "actor",
    fps: float = 30.0,
) -> dict[str, Any]:
    """Summarize displacement, velocity, vertical bounce reversals, and spin over a window."""
    bucket_key = "actors" if entity_kind == "actor" else "props"
    pts: list[tuple[float, float, float, float | None, float | None]] = []
    for rec in frame_records:
        ent = (rec.get(bucket_key) or {}).get(entity_id)
        if not ent:
            continue
        c = ent.get("centroid_xy")
        if not c or len(c) < 2:
            continue
        t = float(rec.get("t", 0.0))
        ang = ent.get("angle_deg")
        ar = ent.get("aspect_ratio")
        pts.append((t, float(c[0]), float(c[1]), float(ang) if ang is not None else None, float(ar) if ar is not None else None))

    if len(pts) < 2:
        return {
            "samples": len(pts),
            "path_length_px": 0.0,
            "net_dx_px": 0.0,
            "net_dy_px": 0.0,
            "net_displacement_px": 0.0,
            "y_span_px": 0.0,
            "x_span_px": 0.0,
            "vertical_reversals": 0,
            "peak_speed_px_s": 0.0,
            "mean_speed_px_s": 0.0,
            "total_rotation_deg": 0.0,
            "aspect_span": 0.0,
        }

    path_len = 0.0
    speeds: list[float] = []
    vy_signs: list[int] = []
    total_rot = 0.0
    xs = [p[1] for p in pts]
    ys = [p[2] for p in pts]
    ars = [p[4] for p in pts if p[4] is not None]

    for i in range(1, len(pts)):
        t0, x0, y0, a0, _ = pts[i - 1]
        t1, x1, y1, a1, _ = pts[i]
        dt = max(1e-4, t1 - t0) if t1 > t0 else (1.0 / max(1.0, fps))
        step = math.hypot(x1 - x0, y1 - y0)
        path_len += step
        speeds.append(step / dt)
        dy_step = y1 - y0
        if abs(dy_step) >= 1.5:
            vy_signs.append(1 if dy_step > 0 else -1)
        if a0 is not None and a1 is not None:
            total_rot += abs(a1 - a0)

    reversals = 0
    for i in range(1, len(vy_signs)):
        if vy_signs[i] != vy_signs[i - 1]:
            reversals += 1

    net_dx = pts[-1][1] - pts[0][1]
    net_dy = pts[-1][2] - pts[0][2]
    total_t = max(1.0 / max(1.0, fps), pts[-1][0] - pts[0][0])
    return {
        "samples": len(pts),
        "path_length_px": round(path_len, 2),
        "net_dx_px": round(net_dx, 2),
        "net_dy_px": round(net_dy, 2),
        "net_displacement_px": round(math.hypot(net_dx, net_dy), 2),
        "y_span_px": round(max(ys) - min(ys), 2),
        "x_span_px": round(max(xs) - min(xs), 2),
        "vertical_reversals": int(reversals),
        "peak_speed_px_s": round(max(speeds, default=0.0), 2),
        "mean_speed_px_s": round(path_len / total_t, 2),
        "total_rotation_deg": round(total_rot, 2),
        "aspect_span": round(max(ars) - min(ars), 4) if len(ars) >= 2 else 0.0,
    }


def _compute_entity_luma_contrast(luma: np.ndarray, mask_u8: np.ndarray) -> float:
    active = mask_u8 > 32
    if int(np.count_nonzero(active)) < 16:
        return 0.0
    vals = luma[active]
    return round(float(np.std(vals)), 3)


def verify_decoded_frame_binding(
    decoded_rgb: np.ndarray | Image.Image,
    expected_beauty_rgb: np.ndarray | Image.Image | None = None,
    *,
    actor_masks: Mapping[str, Any] | None = None,
    prop_masks: Mapping[str, Any] | None = None,
    exclude_caption_band: bool = True,
    max_mad_tolerance: float = 16.0,
) -> dict[str, Any]:
    """Bind rendered semantic geometry against real decoded MP4 RGB pixels."""
    dec = np.asarray(decoded_rgb.convert("RGB") if isinstance(decoded_rgb, Image.Image) else decoded_rgb, dtype=np.uint8)
    if dec.ndim != 3 or dec.shape[2] < 3:
        raise ValueError("decoded_rgb must have shape (H, W, 3)")
    dec3 = np.ascontiguousarray(dec[:, :, :3])
    h, w = dec3.shape[:2]
    luma = cv2.cvtColor(dec3, cv2.COLOR_RGB2GRAY).astype(np.float32)

    valid_mask = np.ones((h, w), dtype=bool)
    if exclude_caption_band:
        # Exclude caption overlay strip [0.66h..0.77h] and optional draft top ribbon [0..28]
        y_cap0 = int(round(h * 0.65))
        y_cap1 = int(round(h * 0.77))
        valid_mask[y_cap0:y_cap1, :] = False

    actor_contrast: dict[str, float] = {}
    for aid, m in (actor_masks or {}).items():
        actor_contrast[str(aid)] = _compute_entity_luma_contrast(luma, _to_mask_u8(m))
    prop_contrast: dict[str, float] = {}
    for pid, m in (prop_masks or {}).items():
        prop_contrast[str(pid)] = _compute_entity_luma_contrast(luma, _to_mask_u8(m))

    mad_vs_beauty: float | None = None
    corr_vs_beauty: float | None = None
    binding_ok = True
    if expected_beauty_rgb is not None:
        exp = np.asarray(
            expected_beauty_rgb.convert("RGB") if isinstance(expected_beauty_rgb, Image.Image) else expected_beauty_rgb,
            dtype=np.uint8,
        )[:, :, :3]
        if exp.shape[:2] != (h, w):
            exp = cv2.resize(exp, (w, h), interpolation=cv2.INTER_AREA)
        diff = np.abs(dec3.astype(np.float32) - exp.astype(np.float32))
        masked_diff = diff[valid_mask]
        mad_vs_beauty = round(float(masked_diff.mean()), 4) if masked_diff.size else 0.0
        exp_luma = cv2.cvtColor(exp, cv2.COLOR_RGB2GRAY).astype(np.float32)
        d_vec = luma[valid_mask] - float(luma[valid_mask].mean())
        e_vec = exp_luma[valid_mask] - float(exp_luma[valid_mask].mean())
        denom = float(np.linalg.norm(d_vec) * np.linalg.norm(e_vec))
        corr_vs_beauty = round(float(np.dot(d_vec, e_vec) / denom), 5) if denom > 1e-6 else 1.0
        binding_ok = bool(mad_vs_beauty <= max_mad_tolerance and corr_vs_beauty >= 0.85)

    return {
        "decoded_luma_mean": round(float(luma.mean()), 3),
        "decoded_luma_std": round(float(luma.std()), 3),
        "mad_vs_beauty": mad_vs_beauty,
        "corr_vs_beauty": corr_vs_beauty,
        "binding_ok": binding_ok,
        "actor_luma_std": actor_contrast,
        "prop_luma_std": prop_contrast,
    }


def _union_actor_masks(part_masks: Mapping[str, Any], actor_id: str, size_hw: tuple[int, int]) -> np.ndarray:
    h, w = size_hw
    acc = np.zeros((h, w), dtype=np.uint8)
    prefix = f"{actor_id}:"
    for k, m in part_masks.items():
        if k == actor_id or k.startswith(prefix):
            acc = np.maximum(acc, _to_mask_u8(m))
    return acc


def capture_semantic_frame_evidence(
    *,
    frame_idx: int,
    t: float,
    shot_id: str,
    canvas_size: tuple[int, int],
    beauty_rgb: np.ndarray | Image.Image,
    actor_visible_masks: Mapping[str, Any],
    actor_raw_masks: Mapping[str, Any] | None = None,
    hand_masks: Mapping[str, Sequence[Any]] | None = None,
    prop_visible_masks: Mapping[str, Any] | None = None,
    prop_raw_masks: Mapping[str, Any] | None = None,
    occluder_masks: Mapping[str, Any] | None = None,
    actor_poses: Mapping[str, Mapping[str, Any]] | None = None,
    prop_states: Mapping[str, Mapping[str, Any]] | None = None,
    expected_state: Mapping[str, Any] | None = None,
    decoded_rgb: np.ndarray | Image.Image | None = None,
) -> dict[str, Any]:
    """Capture one deterministic per-frame semantic evidence record."""
    w, h = map(int, canvas_size)
    beauty_arr = np.asarray(beauty_rgb.convert("RGB") if isinstance(beauty_rgb, Image.Image) else beauty_rgb, dtype=np.uint8)[:, :, :3]
    beauty_sha = hashlib.sha256(np.ascontiguousarray(beauty_arr).tobytes()).hexdigest()

    actors_out: dict[str, Any] = {}
    vis_u8_actors: dict[str, np.ndarray] = {}
    raw_u8_actors: dict[str, np.ndarray] = {}
    for aid, vis_m in actor_visible_masks.items():
        vis_u8 = _to_mask_u8(vis_m)
        raw_u8 = _to_mask_u8((actor_raw_masks or {}).get(aid, vis_u8))
        vis_u8_actors[str(aid)] = vis_u8
        raw_u8_actors[str(aid)] = raw_u8
        apose = dict((actor_poses or {}).get(aid) or {})
        vis_m_res = measure_actor_visibility(vis_u8, raw_u8, canvas_size=(w, h))
        actors_out[str(aid)] = {
            **vis_m_res,
            "world_xy": list(apose.get("world_xy") or [0.0, 0.0]),
            "facing": int(apose.get("facing", 1)),
            "head_variant": apose.get("head_variant"),
            "head_angle_deg": round(float(apose.get("head_angle_deg", 0.0)), 3),
            "head_mount_state": str(apose.get("head_mount_state") or "attached"),
            "knee_bend_deg": round(float(apose.get("knee_bend_deg", 0.0)), 3),
            "left_hand_xy": apose.get("left_hand_xy"),
            "right_hand_xy": apose.get("right_hand_xy"),
        }

    props_out: dict[str, Any] = {}
    vis_u8_props: dict[str, np.ndarray] = {}
    for pid, pm in (prop_visible_masks or {}).items():
        p_u8 = _to_mask_u8(pm)
        p_raw = _to_mask_u8((prop_raw_masks or {}).get(pid, p_u8))
        vis_u8_props[str(pid)] = p_u8
        pstate = dict((prop_states or {}).get(pid) or {})
        pm_res = measure_prop_visibility(p_u8, p_raw, canvas_size=(w, h))
        props_out[str(pid)] = {
            **pm_res,
            "world_xy": list(pstate.get("world_xy") or [0.0, 0.0]),
            "angle_deg": round(float(pstate.get("angle_deg", 0.0)), 3),
            "state": str(pstate.get("state") or "free"),
            "holders": list(pstate.get("holders") or []),
        }

    # Measure interactions: hand/actor-to-prop contact + actor-to-occluder/prop occlusion
    contacts_out: dict[str, Any] = {}
    occlusions_out: dict[str, Any] = {}
    for aid, vis_u8 in vis_u8_actors.items():
        apose = dict((actor_poses or {}).get(aid) or {})
        h_masks = list((hand_masks or {}).get(aid) or ())
        if not h_masks:
            h_masks = [vis_u8]
        h_pts = [apose.get("left_hand_xy"), apose.get("right_hand_xy")]
        for pid, p_u8 in vis_u8_props.items():
            contacts_out[f"{aid}->{pid}"] = measure_contact(h_masks, p_u8, hand_points_xy=h_pts)
            contacts_out[f"{aid}:body->{pid}"] = measure_contact([vis_u8], p_u8)
        for oid, o_m in (occluder_masks or {}).items():
            occlusions_out[f"{aid}@{oid}"] = measure_occlusion(raw_u8_actors[aid], vis_u8, o_m)
            contacts_out[f"{aid}@{oid}"] = measure_contact([vis_u8], o_m)

    dec_binding = verify_decoded_frame_binding(
        decoded_rgb if decoded_rgb is not None else beauty_arr,
        beauty_arr if decoded_rgb is not None else None,
        actor_masks=vis_u8_actors,
        prop_masks=vis_u8_props,
    )

    return {
        "schema": SEMANTIC_EVIDENCE_SCHEMA,
        "frame": int(frame_idx),
        "t": round(float(t), 5),
        "shot_id": str(shot_id),
        "canvas_size": [w, h],
        "beauty_sha256": beauty_sha,
        "actors": actors_out,
        "props": props_out,
        "occluder_ids": sorted(str(k) for k in (occluder_masks or {}).keys()),
        "contacts": contacts_out,
        "occlusions": occlusions_out,
        "expected_state": dict(expected_state or {}),
        "decoded_binding": dec_binding,
    }


def write_semantic_evidence_stream(jsonl_path: str | Path, records_iter: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Stream per-frame semantic evidence into JSONL using O(1) memory and atomic swap."""
    target = Path(jsonl_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.tmp")
    hasher = hashlib.sha256()
    count = 0
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        for rec in records_iter:
            line = json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n"
            fh.write(line)
            hasher.update(line.encode("utf-8"))
            count += 1
        fh.flush()
    tmp.replace(target)
    return {
        "schema": SEMANTIC_EVIDENCE_BUNDLE_SCHEMA,
        "path": str(target),
        "frames": count,
        "sha256": hasher.hexdigest(),
    }


def load_semantic_evidence_jsonl(jsonl_path: str | Path) -> tuple[list[dict[str, Any]], str]:
    target = Path(jsonl_path)
    if not target.is_file():
        raise FileNotFoundError(f"Missing semantic evidence JSONL: {target}")
    raw_bytes = target.read_bytes()
    digest = hashlib.sha256(raw_bytes).hexdigest()
    rows: list[dict[str, Any]] = []
    for idx, line in enumerate(raw_bytes.decode("utf-8").splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            obj = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Corrupt JSONL at line {idx} in {target}: {exc}") from exc
        if not isinstance(obj, dict):
            raise ValueError(f"Non-object row at line {idx} in {target}")
        rows.append(obj)
    return rows, digest


def render_semantic_mask_overlay(
    beauty_rgb: np.ndarray | Image.Image,
    *,
    actor_masks: Mapping[str, Any] | None = None,
    prop_masks: Mapping[str, Any] | None = None,
    occluder_masks: Mapping[str, Any] | None = None,
    label: str = "",
) -> Image.Image:
    """Create a debug-only translucent overlay highlighting actor/prop/occluder masks."""
    base = np.asarray(beauty_rgb.convert("RGB") if isinstance(beauty_rgb, Image.Image) else beauty_rgb, dtype=np.float32)[:, :, :3].copy()

    def _tint(masks: Mapping[str, Any] | None, rgb: tuple[int, int, int], weight: float) -> None:
        col = np.array(rgb, dtype=np.float32)
        for m in (masks or {}).values():
            bin_m = _to_mask_u8(m) > 32
            if np.any(bin_m):
                base[bin_m] = base[bin_m] * (1.0 - weight) + col * weight

    _tint(actor_masks, (34, 197, 94), 0.36)      # emerald actor
    _tint(prop_masks, (250, 204, 21), 0.42)      # amber prop
    _tint(occluder_masks, (244, 63, 94), 0.32)   # rose occluder

    im = Image.fromarray(np.uint8(np.clip(base, 0.0, 255.0)))
    if label:
        draw = ImageDraw.Draw(im)
        draw.rectangle((0, 0, im.width, 28), fill=(15, 23, 42))
        draw.text((8, 7), label, fill=(248, 250, 252))
    return im


def render_triptych_diagnostic(
    before_img: Image.Image,
    during_img: Image.Image,
    after_img: Image.Image,
    *,
    title: str,
    before_label: str = "BEFORE",
    during_label: str = "DURING",
    after_label: str = "AFTER",
    tile_width: int = 360,
) -> Image.Image:
    """Render before / during / after verification triptych (internal debug only)."""
    tiles = []
    for lbl, src in ((before_label, before_img), (during_label, during_img), (after_label, after_img)):
        rgb = src.convert("RGB")
        th = max(120, int(round(tile_width * rgb.height / max(1, rgb.width))))
        tiles.append((lbl, rgb.resize((tile_width, th), Image.Resampling.LANCZOS)))

    header_h = 34
    sub_h = 26
    total_w = tile_width * 3 + 16
    total_h = header_h + sub_h + tiles[0][1].height + 8
    canvas = Image.new("RGB", (total_w, total_h), (24, 30, 44))
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 9), title, fill=(248, 250, 252))
    for i, (lbl, tile) in enumerate(tiles):
        x = 4 + i * (tile_width + 4)
        draw.text((x + 6, header_h + 5), lbl, fill=(148, 163, 184))
        canvas.paste(tile, (x, header_h + sub_h))
    return canvas
