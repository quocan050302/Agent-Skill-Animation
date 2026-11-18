"""Canonical editor-to-renderer runtime adapter for B6 Local Studio.

Pure deterministic evaluator over project-local `scene-control.json`.
Zero eval/exec; works identically for full native `frame(t, c)` and `draft_frame(t, c)`.
"""
from __future__ import annotations
import json
import math
from typing import Any

_PLAN_CACHE: dict[tuple[str, str], dict[str, Any]] = {}


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def apply_easing(u: float, mode: str = "smooth") -> float:
    u = _clamp01(u)
    if mode == "linear":
        return u
    if mode == "ease_in":
        return u * u
    if mode == "ease_out":
        return 1.0 - (1.0 - u) * (1.0 - u)
    if mode == "hold":
        return 0.0 if u < 1.0 else 1.0
    return u * u * (3.0 - 2.0 * u)


def _lerp(a: float, b: float, u: float) -> float:
    return float(a) * (1.0 - u) + float(b) * u


def _interpolate_arm(st_act: str, st_ph: float, en_act: str, en_ph: float, eu: float) -> tuple[str, float]:
    """Interpolate cleanly along B6 PoseLibrary joins so UI start->end choices never teleport."""
    def norm(a: str) -> str:
        if a == "point":
            return "offer"
        return a if a in ("rest", "reach", "offer", "receive", "retract") else "rest"

    a0, a1 = norm(st_act), norm(en_act)
    p0, p1 = _clamp01(st_ph), _clamp01(en_ph)
    eu = _clamp01(eu)
    if a0 == a1:
        return a0, _lerp(p0, p1, eu)

    # Canonical acyclic segment path builder (every join guarantees matching endpoint poses)
    chain_idx = {"rest": 0, "reach": 1, "offer": 2, "retract": 3}
    segs: list[tuple[str, float, float]] = []

    if a0 == "receive":
        segs.append(("receive", p0, 0.0))
        a0, p0 = "reach", 1.0
    if a1 == "receive":
        # walk a0 -> reach(1.0) -> receive(0..p1)
        if a0 == "rest":
            segs.extend([("rest", p0, 1.0), ("reach", 0.0, 1.0)])
        elif a0 == "reach":
            segs.append(("reach", p0, 1.0))
        elif a0 == "offer":
            segs.append(("offer", p0, 0.0))
        else:  # retract
            segs.extend([("retract", p0, 1.0), ("rest", 0.0, 1.0), ("reach", 0.0, 1.0)])
        segs.append(("receive", 0.0, p1))
    else:
        # Short direct reverse for reach -> rest instead of swinging forward through offer + retract
        if a0 == "reach" and a1 == "rest":
            segs.extend([("reach", p0, 0.0), ("rest", 1.0, p1)])
        else:
            i0 = chain_idx[a0]
            i1 = chain_idx[a1]
            steps = (i1 - i0) % 4
            cur_name, cur_p = a0, p0
            order = ["rest", "reach", "offer", "retract"]
            for k in range(steps):
                segs.append((cur_name, cur_p, 1.0))
                idx = (chain_idx[cur_name] + 1) % 4
                cur_name = order[idx]
                cur_p = 0.0
            segs.append((a1, cur_p, p1))

    # Drop zero-span no-op segments except if only one
    nonempty = [(s, sp, ep) for (s, sp, ep) in segs if abs(ep - sp) > 1e-6 or s == a1]
    if not nonempty:
        return a1, p1
    weights = [max(0.08, abs(ep - sp)) for (_, sp, ep) in nonempty]
    total_w = sum(weights)
    target = eu * total_w
    acc = 0.0
    for (s, sp, ep), w in zip(nonempty, weights):
        if target <= acc + w + 1e-9:
            local_u = _clamp01((target - acc) / max(1e-9, w))
            return s, _lerp(sp, ep, local_u)
        acc += w
    last_s, _, last_ep = nonempty[-1]
    return last_s, last_ep


def load_scene_plan(context) -> dict[str, Any]:
    key = (str(context.base), str(getattr(context, "fingerprint", "")))
    if key in _PLAN_CACHE:
        return _PLAN_CACHE[key]
    plan_path = context.base / "scene-control.json"
    if not plan_path.is_file():
        return {}
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    _PLAN_CACHE[key] = plan
    return plan


def shot_at(context, t: float) -> tuple[dict[str, Any] | None, float]:
    plan = load_scene_plan(context)
    shots = plan.get("shots") or []
    if not shots:
        return None, 0.0
    t = max(0.0, float(t))
    for sh in shots:
        s0 = float(sh.get("start", 0.0))
        s1 = float(sh.get("end", 0.0))
        if s0 <= t < s1:
            span = max(1e-6, s1 - s0)
            return sh, _clamp01((t - s0) / span)
    last = shots[-1]
    return last, 1.0


def camera_at(context, t: float, base_cam=None):
    Cam = context.space.Camera
    plan = load_scene_plan(context)
    w = int(plan.get("width", 720))
    h = int(plan.get("height", 1280))
    if base_cam is None:
        base_cam = Cam(width=w, height=h, focal=1140.0, x=0.0, y=-200.0, z=0.0, principal_y=round(h * 0.54))
    shot, _ = shot_at(context, t)
    if not shot:
        return base_cam
    keys = sorted(shot.get("cameraKeys") or [], key=lambda k: float(k.get("t", 0.0)))
    if not keys:
        return base_cam

    local_t = max(0.0, float(t) - float(shot.get("start", 0.0)))
    easing = str(shot.get("easing") or "smooth")

    k0 = keys[0]
    k1 = keys[-1]
    for idx in range(len(keys) - 1):
        a = keys[idx]
        b = keys[idx + 1]
        if float(a.get("t", 0.0)) <= local_t <= float(b.get("t", 0.0)):
            k0, k1 = a, b
            break
    if local_t >= float(keys[-1].get("t", 0.0)):
        k0 = k1 = keys[-1]

    t0 = float(k0.get("t", 0.0))
    t1 = float(k1.get("t", t0))
    if t1 <= t0 + 1e-6:
        eu = 1.0
    else:
        eu = apply_easing((local_t - t0) / (t1 - t0), easing)

    fov = _lerp(k0.get("fov", 55.0), k1.get("fov", 55.0), eu)
    # Match native B6 portrait/landscape viewport scale (scales proportionally for 0.5x/0.75x drafts too)
    focal = (float(base_cam.width) * 0.5) / math.tan(math.radians(max(20.0, min(100.0, fov)) * 0.5)) * 1.33
    return Cam(
        width=base_cam.width,
        height=base_cam.height,
        focal=float(focal),
        x=_lerp(k0.get("x", base_cam.x), k1.get("x", base_cam.x), eu),
        y=_lerp(k0.get("y", base_cam.y), k1.get("y", base_cam.y), eu),
        z=_lerp(k0.get("z", base_cam.z), k1.get("z", base_cam.z), eu),
        principal_y=base_cam.principal_y,
        near=getattr(base_cam, "near", 1.0),
    )


def actor_state_at(
    context,
    t: float,
    default_x: float = 0.0,
    default_y: float = 0.0,
    default_scale: float = 1.0,
) -> dict[str, Any]:
    shot, u = shot_at(context, t)
    if not shot:
        return {
            "x": default_x,
            "y": default_y,
            "scale": default_scale,
            "head_angle_deg": 0.0,
            "expression": None,
            "left_arm": ("rest", 0.5),
            "right_arm": ("rest", 0.5),
            "stride_cycles": 0.0,
            "u": 0.0,
            "eu": 0.0,
        }
    easing = str(shot.get("easing") or "smooth")
    eu = apply_easing(u, easing)
    st = shot.get("actorStart") or {}
    en = shot.get("actorEnd") or st
    actor_name = str(shot.get("actor") or "")
    staging_entry = (shot.get("staging") or {}).get(actor_name) or {}

    sx = float(st.get("x", staging_entry.get("x", default_x)))
    ex = float(en.get("x", sx))
    sy = float(st.get("y", staging_entry.get("y", default_y)))
    ey = float(en.get("y", sy))
    ss = float(st.get("scale", default_scale))
    es = float(en.get("scale", ss))
    ha0 = float(st.get("headAngleDeg", 0.0))
    ha1 = float(en.get("headAngleDeg", ha0))

    expr = str(shot.get("expression") or "neutral").strip()
    head_variant = None if expr in ("", "neutral", "default") else expr

    l_act0 = str(st.get("leftArmAction", "rest"))
    l_act1 = str(en.get("leftArmAction", l_act0))
    r_act0 = str(st.get("rightArmAction", "rest"))
    r_act1 = str(en.get("rightArmAction", r_act0))
    l_res = _interpolate_arm(l_act0, float(st.get("leftArmPhase", 0.5)), l_act1, float(en.get("leftArmPhase", st.get("leftArmPhase", 0.5))), eu)
    r_res = _interpolate_arm(r_act0, float(st.get("rightArmPhase", 0.5)), r_act1, float(en.get("rightArmPhase", st.get("rightArmPhase", 0.5))), eu)
    strides = float(en.get("strideCycles", st.get("strideCycles", 0.0)))

    return {
        "shot_id": shot.get("id", ""),
        "x": _lerp(sx, ex, eu),
        "y": _lerp(sy, ey, eu),
        "scale": _lerp(ss, es, eu),
        "head_angle_deg": max(-20.0, min(20.0, _lerp(ha0, ha1, eu))),
        "expression": head_variant,
        "left_arm": l_res,
        "right_arm": r_res,
        "stride_cycles": max(0.0, strides),
        "u": u,
        "eu": eu,
    }


def prop_state_at(context, prop_id: str, t: float) -> dict[str, Any] | None:
    shot, _ = shot_at(context, t)
    if not shot:
        return None
    keys = [
        k for k in (shot.get("propKeyframes") or [])
        if str(k.get("propId")) == str(prop_id)
    ]
    if not keys:
        return None
    keys.sort(key=lambda k: float(k.get("t", 0.0)))
    local_t = max(0.0, float(t) - float(shot.get("start", 0.0)))
    easing = str(shot.get("easing") or "smooth")

    k0, k1 = keys[0], keys[-1]
    for idx in range(len(keys) - 1):
        if float(keys[idx].get("t", 0.0)) <= local_t <= float(keys[idx + 1].get("t", 0.0)):
            k0, k1 = keys[idx], keys[idx + 1]
            break
    if local_t >= float(keys[-1].get("t", 0.0)):
        k0 = k1 = keys[-1]

    t0 = float(k0.get("t", 0.0))
    t1 = float(k1.get("t", t0))
    eu = 1.0 if t1 <= t0 + 1e-6 else apply_easing((local_t - t0) / (t1 - t0), easing)

    return {
        "prop_id": prop_id,
        "x": _lerp(k0.get("x", 0.0), k1.get("x", 0.0), eu),
        "y": _lerp(k0.get("y", 0.0), k1.get("y", 0.0), eu),
        "angle_deg": _lerp(k0.get("angleDeg", 0.0), k1.get("angleDeg", 0.0), eu),
        "scale": _lerp(k0.get("scale", 1.0), k1.get("scale", 1.0), eu),
        "holder_actor": k0.get("holderActor"),
        "holder_arm": k0.get("holderArm"),
        "grip_uv": k0.get("gripUv"),
    }


def qa_trace_at(context, t: float) -> dict[str, Any]:
    shot, u = shot_at(context, t)
    cam = camera_at(context, t)
    actor = actor_state_at(context, t)
    return {
        "t": round(float(t), 4),
        "shot_id": shot.get("id") if shot else None,
        "u": round(u, 4),
        "camera": {"x": round(cam.x, 2), "y": round(cam.y, 2), "z": round(cam.z, 2), "focal": round(cam.focal, 2)},
        "actor": {"x": round(actor["x"], 2), "y": round(actor["y"], 2), "head_angle_deg": round(actor["head_angle_deg"], 2), "expression": actor["expression"]},
    }
