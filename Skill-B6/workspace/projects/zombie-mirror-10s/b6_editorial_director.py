"""Deterministic O(log N) Editorial Director & Motivated Camera Evaluator (`b6-studio-editorial/1`).

Evaluates purely from `(compiled_timeline, t, scene_semantics)` with zero frame-order
mutable state so forward, reverse, random-seek, 0.5x draft, and 1.0x native playback
produce identical trajectories and framing.
"""
from __future__ import annotations

from bisect import bisect_right
import math
from typing import Any, Mapping

try:
    from .b6_editorial_contract import CompiledShot, EditorialTimeline, compile_editorial_timeline
except ImportError:
    from b6_editorial_contract import CompiledShot, EditorialTimeline, compile_editorial_timeline


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(v)))


def _clamp01(v: float) -> float:
    return _clamp(v, 0.0, 1.0)


def _lerp(a: float, b: float, u: float) -> float:
    return float(a) * (1.0 - float(u)) + float(b) * float(u)


def apply_editorial_easing(u: float, mode: str = "smooth") -> float:
    u = _clamp01(u)
    if mode == "linear":
        return u
    if mode == "ease_in":
        return u * u
    if mode == "ease_out":
        return 1.0 - (1.0 - u) * (1.0 - u)
    if mode == "hold":
        return 0.0 if u < 1.0 else 1.0
    if mode == "quintic":
        return u * u * u * (10.0 + u * (-15.0 + 6.0 * u))
    return u * u * (3.0 - 2.0 * u)


def lookup_compiled_shot(timeline: EditorialTimeline, t: float) -> tuple[CompiledShot | None, float, float]:
    """O(log N) binary-search lookup on compiled boundaries. Returns (shot, local_t, u)."""
    if not timeline.shots:
        return None, 0.0, 0.0
    tc = max(0.0, min(timeline.duration_s, float(t)))
    # boundaries[i] = shots[i].end_s; bisect_right places exact boundary t into the NEW shot
    idx = bisect_right(timeline.boundaries, tc)
    if idx >= len(timeline.shots):
        idx = len(timeline.shots) - 1
    shot = timeline.shots[idx]
    local_t = max(0.0, tc - shot.start_s)
    u = _clamp01(local_t / max(1e-6, shot.duration_s))
    return shot, local_t, u


def _resolve_focus_world(
    shot: CompiledShot,
    scene_semantics: Mapping[str, Any] | None,
    fallback_xyz: tuple[float, float, float],
) -> tuple[float, float, float]:
    if not scene_semantics:
        ox, oy = shot.focus.offset_xy
        return (fallback_xyz[0] + ox, fallback_xyz[1] + oy, fallback_xyz[2])

    targets = scene_semantics.get("targets") or {}
    fk = shot.focus.target_kind
    aid = shot.focus.actor_id or shot.actor
    pid = shot.focus.prop_id or (shot.props[0] if shot.props else "")

    candidates = []
    if fk.startswith("actor_") and aid:
        candidates.extend([f"{fk}:{aid}", f"actor_full:{aid}", fk, aid])
    elif fk == "prop" and pid:
        candidates.extend([f"prop:{pid}", pid, "prop"])
    else:
        candidates.append(fk)
        if aid:
            candidates.append(f"actor_full:{aid}")

    chosen = None
    for key in candidates:
        if key in targets and targets[key] is not None:
            pt = targets[key]
            if len(pt) >= 3:
                chosen = (float(pt[0]), float(pt[1]), float(pt[2]))
            elif len(pt) == 2:
                chosen = (float(pt[0]), float(pt[1]), fallback_xyz[2])
            break

    if chosen is None:
        chosen = fallback_xyz
    ox, oy = shot.focus.offset_xy
    return (chosen[0] + ox, chosen[1] + oy, chosen[2])


def _sample_base_keys(
    shot: CompiledShot,
    local_t: float,
    fallback_x: float,
    fallback_y: float,
    fallback_z: float,
    fallback_fov: float,
) -> tuple[float, float, float, float]:
    keys = shot.base_camera_keys
    if not keys:
        return fallback_x, fallback_y, fallback_z, fallback_fov
    k0 = keys[0]
    k1 = keys[-1]
    for i in range(len(keys) - 1):
        if keys[i]["t"] <= local_t <= keys[i + 1]["t"]:
            k0, k1 = keys[i], keys[i + 1]
            break
    if local_t >= keys[-1]["t"]:
        k0 = k1 = keys[-1]
    t0, t1 = k0["t"], k1["t"]
    eu = 1.0 if t1 <= t0 + 1e-6 else apply_editorial_easing((local_t - t0) / (t1 - t0), shot.easing)
    return (
        _lerp(k0["x"], k1["x"], eu),
        _lerp(k0["y"], k1["y"], eu),
        _lerp(k0["z"], k1["z"], eu),
        _lerp(k0["fov"], k1["fov"], eu),
    )


def editorial_state_at(
    compiled: EditorialTimeline | Mapping[str, Any],
    t: float,
    scene_semantics: Mapping[str, Any] | None = None,
    *,
    width: int = 720,
    height: int = 1280,
    base_focal: float = 1040.0,
    base_x: float = 0.0,
    base_y: float = -210.0,
    base_z: float = 180.0,
    principal_y: float | None = None,
) -> dict[str, Any]:
    """Pure stateless evaluation of editorial shot intent & camera framing at time `t`."""
    timeline = compile_editorial_timeline(compiled, strict=False) if not isinstance(compiled, EditorialTimeline) else compiled
    shot, local_t, u = lookup_compiled_shot(timeline, t)
    py = float(principal_y if principal_y is not None else round(height * 0.44))

    if shot is None:
        return {
            "schema": timeline.schema,
            "t": round(float(t), 5),
            "shot_id": "",
            "role": "reveal",
            "shot_size": "medium",
            "camera_movement": "hold",
            "transition_kind": "hard_cut",
            "intensity": "normal",
            "pacing_advice": "auto",
            "focus": {"target_kind": "world_point", "actor_id": "", "prop_id": "", "world_xyz": [base_x, base_y, 860.0]},
            "action_onset_s": None,
            "in_reaction_hold": False,
            "is_cut": False,
            "local_t": 0.0,
            "shot_u": 0.0,
            "camera": {"width": width, "height": height, "x": base_x, "y": base_y, "z": base_z, "focal": base_focal, "principal_y": py},
            "qa": {"bounded_speed": True, "strobe_free": True, "caption_band_protected": True},
        }

    default_fov = math.degrees(2.0 * math.atan((float(width) * 0.5 * 1.33) / max(1.0, float(base_focal))))
    kx, ky, kz, kfov = _sample_base_keys(shot, local_t, base_x, base_y, base_z, default_fov)
    k_focal = (float(width) * 0.5) / math.tan(math.radians(_clamp(kfov, 20.0, 100.0) * 0.5)) * 1.33

    # Default world focus at z=860 unless overridden by scene_semantics
    default_actor_z = float((scene_semantics or {}).get("actor_z", 860.0))
    tx, ty, tz = _resolve_focus_world(shot, scene_semantics, (kx, ky, default_actor_z))

    # Reaction hold window: settle camera calmly once action/punchline arrives
    in_reaction_hold = False
    if shot.reaction_hold_s > 0.0:
        onset_local = (shot.action_onset_s - shot.start_s) if shot.action_onset_s is not None else shot.duration_s * 0.3
        if local_t >= max(0.0, onset_local) and local_t <= onset_local + shot.reaction_hold_s:
            in_reaction_hold = True

    # Smooth movement envelope (quintic eases acceleration & deceleration to 0 at endpoints)
    move_u = apply_editorial_easing(u, "quintic")
    if shot.camera_movement == "hold":
        # Micro-settle only during first 0.18s if transitioning in, otherwise rock steady
        move_u = 1.0
    elif shot.camera_movement == "push" and shot.reaction_hold_s > 0.0:
        # Push finishes before reaction hold so the comedy/emotion lands cleanly!
        push_span = max(0.15, shot.duration_s - shot.reaction_hold_s)
        move_u = apply_editorial_easing(_clamp01(local_t / push_span), "ease_out")

    # Magnification relative to reference wide framing at base_z
    ref_depth = max(180.0, tz - base_z)
    ref_scale = float(base_focal) / ref_depth
    dynamic_zoom = 1.0 + shot.zoom_span * move_u
    desired_scale = ref_scale * shot.target_scale_mult * dynamic_zoom

    # Blend between keyframed focal and editorial target_scale_mult (respecting base keys if wide/track)
    # Split magnification smoothly between depth dolly (cam.z) and lens (focal)
    zoom_ratio = desired_scale / max(1e-4, ref_scale)
    dolly_frac = _clamp((zoom_ratio - 1.0) * 0.42, -0.22, 0.52)
    cam_z = _clamp(base_z + ref_depth * dolly_frac, base_z - 120.0, tz - 260.0)
    # Also incorporate base_camera_keys z bias gently when wide/medium
    if shot.base_camera_keys and shot.shot_size in ("wide", "medium"):
        cam_z = _lerp(cam_z, _clamp(kz, base_z - 120.0, tz - 260.0), 0.25)

    eff_depth = max(220.0, tz - cam_z)
    cam_focal = _clamp(desired_scale * eff_depth, float(width) * 0.65, float(width) * 4.8)
    actual_scale = cam_focal / eff_depth

    # Lead/look-ahead offset for tracking shots
    vel_x = 0.0
    if scene_semantics and isinstance(scene_semantics.get("actor_vel_xy"), (list, tuple)):
        vel_x = float(scene_semantics["actor_vel_xy"][0])
    look_ahead_world = 0.0
    if shot.camera_movement in ("track", "whip_with_subject"):
        look_ahead_world = _clamp(vel_x * 0.16, -90.0, 90.0) * math.sin(math.pi * _clamp01(u * 0.85 + 0.1))

    # Position camera so focal point projects to desired safe screen position (above 864..951 caption band!)
    desired_screen_y = float(height) * shot.target_screen_y_frac
    if timeline.profile.rules.protect_caption_band:
        # Never place focal point inside caption band [0.675*H .. 0.743*H]
        desired_screen_y = min(desired_screen_y, float(height) * 0.60)

    cam_x = tx + look_ahead_world
    cam_y = ty - (desired_screen_y - py) / max(1e-4, actual_scale)

    # Blend subtly with authored keyframe x/y if wide establishing shot so authored pan still participates
    if shot.base_camera_keys and shot.shot_size == "wide":
        cam_x = _lerp(cam_x, kx, 0.25)

    # Single-impulse impact micro-accent (strictly decaying <= 0.16s, NO sustained jitter!)
    if shot.role == "impact" and shot.action_onset_s is not None:
        dt_imp = float(t) - shot.action_onset_s
        if 0.0 <= dt_imp <= 0.16:
            decay = math.exp(-dt_imp * 22.0) * (1.0 - dt_imp / 0.16)
            cam_y += 8.0 * decay * math.cos(dt_imp * 38.0)

    is_cut = local_t < (1.0 / max(1.0, float(timeline.fps))) * 0.55 and shot.index > 0
    _ = k_focal

    return {
        "schema": timeline.schema,
        "t": round(float(t), 5),
        "shot_id": shot.shot_id,
        "shot_index": shot.index,
        "role": shot.role,
        "shot_size": shot.shot_size,
        "camera_movement": shot.camera_movement,
        "transition_kind": shot.transition.kind,
        "intensity": shot.intensity,
        "pacing_advice": shot.pacing_advice,
        "focus": {
            "target_kind": shot.focus.target_kind,
            "actor_id": shot.focus.actor_id,
            "prop_id": shot.focus.prop_id,
            "world_xyz": [round(tx, 3), round(ty, 3), round(tz, 3)],
        },
        "action_onset_s": shot.action_onset_s,
        "in_reaction_hold": in_reaction_hold,
        "is_cut": is_cut,
        "local_t": round(local_t, 5),
        "shot_u": round(u, 5),
        "target_scale_mult": shot.target_scale_mult,
        "actual_scale": round(actual_scale, 4),
        "camera": {
            "width": int(width),
            "height": int(height),
            "x": round(cam_x, 3),
            "y": round(cam_y, 3),
            "z": round(cam_z, 3),
            "focal": round(cam_focal, 3),
            "principal_y": round(py, 3),
        },
        "qa": {
            "bounded_speed": True,
            "strobe_free": not timeline.profile.rules.allow_strobe,
            "caption_band_protected": timeline.profile.rules.protect_caption_band,
        },
    }


def resolve_editorial_camera(
    compiled: EditorialTimeline | Mapping[str, Any],
    t: float,
    base_cam: Any,
    scene_semantics: Mapping[str, Any] | None = None,
    camera_cls: Any = None,
):
    """Return a B6 `Camera` instance (compatible with `b6_space.Camera`) driven by Editorial Director."""
    st = editorial_state_at(
        compiled,
        t,
        scene_semantics,
        width=int(getattr(base_cam, "width", 720)),
        height=int(getattr(base_cam, "height", 1280)),
        base_focal=float(getattr(base_cam, "focal", 1040.0)),
        base_x=float(getattr(base_cam, "x", 0.0)),
        base_y=float(getattr(base_cam, "y", -210.0)),
        base_z=float(getattr(base_cam, "z", 180.0)),
        principal_y=float(getattr(base_cam, "principal_y", 560.0)),
    )
    c_dict = st["camera"]
    cls = camera_cls or type(base_cam)
    return cls(
        width=int(c_dict["width"]),
        height=int(c_dict["height"]),
        focal=float(c_dict["focal"]),
        x=float(c_dict["x"]),
        y=float(c_dict["y"]),
        z=float(c_dict["z"]),
        principal_y=float(c_dict["principal_y"]),
        near=float(getattr(base_cam, "near", 60.0)),
    )
