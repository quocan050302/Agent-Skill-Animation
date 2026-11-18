"""B6 Story-Driven Animated Production Scene:
'The Zombie Who Was Afraid of a Human' (9:16 Native 720x1280, 30fps, 10.0s).

Architecture:
- Strictly driven by canonical `scene-control.json` via `scene_runtime`:
  `shot_at`, `motion_state_at`, `camera_editorial_at`, `editorial_state_at`.
- Articulated 2-bone IK leg kinetics & ContactPlan from `b6_motion_core` + `b6_motion_render`
  plus `b6_editorial_director` scale/focus camera framing.
- Original rainy midnight convenience-store assets (`bg_convenience_night.png`,
  `fg_neon_sign.png`, `prop_vanity_mirror.png`, `prop_traffic_cone.png`) and
  two B6 modular characters (`zombie`, `human`), plus synced procedural 2.5D rain,
  puddle ripples, speed streaks, and shock starbursts.
- Pure stateless `f(t)` evaluation for exact worker-count and random-seek parity.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

import b6_motion_core as mc
import b6_motion_qc as mqc
import b6_motion_render as mr
import scene_runtime

_STATE: dict[str, Any] = {}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(v)))


def _clamp01(v: float) -> float:
    return _clamp(v, 0.0, 1.0)


def _lerp(a: float, b: float, u: float) -> float:
    return float(a) * (1.0 - float(u)) + float(b) * float(u)


def _smooth(u: float) -> float:
    x = _clamp01(u)
    return x * x * (3.0 - 2.0 * x)


def _load_rgba(base: Path, rel: str) -> Image.Image:
    im = Image.open(base / rel).convert("RGBA")
    im.load()
    return im


def _setup(c) -> dict[str, Any]:
    key = str(c.base)
    if _STATE.get("key") == key:
        return _STATE

    bp = c.puppet_runtime
    z_char = c.character_packages["zombie"]
    h_char = c.character_packages["human"]

    bg_raw = _load_rgba(c.base, "assets/production/bg_convenience_night.png")
    fg_raw = _load_rgba(c.base, "assets/production/fg_neon_sign.png")
    mirror_raw = _load_rgba(c.base, "assets/production/prop_vanity_mirror.png")
    cone_raw = _load_rgba(c.base, "assets/production/prop_traffic_cone.png")

    z_view = z_char.views["three_quarter"]
    h_view = h_char.views["three_quarter"]

    z_profile = mc.MotionProfile(
        upper_leg_len=64.0,
        lower_leg_len=62.0,
        hip_left_local=tuple(z_view.legs["left"]["hip"]),
        hip_right_local=tuple(z_view.legs["right"]["hip"]),
        shoulder_y_local=-205.0,
        torso_height=130.0,
        facing=1.0,
        stride_len=148.0,
        cadence_hz=2.8,
        foot_lift=48.0,
        pelvis_bob=7.0,
        arm_swing_amp=0.45,
        startup_s=0.14,
        brake_s=0.16,
        ink_width=5.8,
        ink_color=tuple(z_view.ink_color),
        foot_size=(15.0, 5.0),
        foot_style="boot",
        ground_y=0.0,
        max_knee_deg=126.0,
    )
    h_profile = mc.MotionProfile(
        upper_leg_len=64.0,
        lower_leg_len=62.0,
        hip_left_local=tuple(h_view.legs["right"]["hip"]),
        hip_right_local=tuple(h_view.legs["left"]["hip"]),
        shoulder_y_local=-205.0,
        torso_height=135.0,
        facing=-1.0,
        stride_len=80.0,
        cadence_hz=1.4,
        foot_lift=16.0,
        pelvis_bob=3.0,
        arm_swing_amp=0.18,
        startup_s=0.16,
        brake_s=0.18,
        ink_width=5.8,
        ink_color=tuple(h_view.ink_color),
        foot_size=(15.0, 5.0),
        foot_style="boot",
        ground_y=0.0,
        max_knee_deg=124.0,
    )

    _STATE.clear()
    _STATE.update(
        {
            "key": key,
            "zombie": z_char,
            "human": h_char,
            "z_profile": z_profile,
            "h_profile": h_profile,
            "bg_raw": bg_raw,
            "fg_raw": fg_raw,
            "mirror_raw": mirror_raw,
            "cone_raw": cone_raw,
        }
    )
    return _STATE


def _solve_valid_arm_fk(spec, upper_deg: float, bend_deg: float) -> np.ndarray:
    u_lo, u_hi = map(float, spec.upper_range)
    b_lo, b_hi = map(float, spec.bend_range)
    upper = _clamp(upper_deg, u_lo + 1.0, u_hi - 1.0)
    bend = _clamp(bend_deg, b_lo + 1.0, b_hi - 1.0)
    a, b = spec.lengths
    ur = math.radians(upper)
    fr = math.radians(upper - spec.pole * bend)
    sh = np.array(spec.socket, dtype=float)
    el = sh + a * np.array([math.cos(ur), math.sin(ur)], dtype=float)
    wr = el + b * np.array([math.cos(fr), math.sin(fr)], dtype=float)
    return np.array([sh, el, wr], dtype=float)


def _motion_shot_for(ms: dict[str, Any]) -> mc.ShotMotion:
    return mc.ShotMotion(
        shot_id=str(ms.get("shot_id") or "shot"),
        start_s=float(ms.get("start_s", 0.0)),
        end_s=max(float(ms.get("start_s", 0.0)) + 0.05, float(ms.get("end_s", 1.0))),
        start_x=float(ms.get("start_x", 160.0)),
        end_x=float(ms.get("end_x", 160.0)),
        start_y=float(ms.get("start_y", 0.0)),
        end_y=float(ms.get("end_y", 0.0)),
        state=str(ms.get("preset", "idle")),
        facing=float(ms.get("facing", 1)),
        cadence_hz=float(ms.get("cadence_hz", 2.0)),
        stride_len=float(ms.get("stride_len", 100.0)),
        foot_lift=float(ms.get("foot_lift", 28.0)),
        pelvis_drop=float(ms.get("pelvis_drop", 4.0)),
        easing=str(ms.get("easing", "smooth")),
        anticipate_s=float(ms.get("anticipate_s", 0.14)),
        settle_s=float(ms.get("settle_s", 0.16)),
        arm_swing_amp=float(ms.get("arm_swing_amp", 0.34)),
    )


def _zombie_arm_kinematics(view, shot_id: str, t: float, shot_u: float, gait: mc.GaitPose):
    l_spec = view.arms["left"]
    r_spec = view.arms["right"]

    if shot_id == "shot_01_hook":
        wiggle = math.sin(t * 11.0)
        l_upper, l_bend = 15.0 + wiggle * 4.0, 34.0 + math.cos(t * 9.0) * 6.0
        r_upper, r_bend = 62.0 - wiggle * 6.0, 24.0 + math.sin(t * 9.0) * 6.0
        l_act, r_act = ("offer", 0.7), ("offer", 0.7)
    elif shot_id == "shot_02_stalk":
        l_upper = 16.0 + math.sin(t * 6.5) * 4.0
        l_bend = 36.0
        r_upper = 56.0 - math.sin(t * 6.5) * 8.0
        r_bend = 26.0
        l_act, r_act = ("reach", 0.8), ("reach", 0.8)
    elif shot_id == "shot_03_mirror_insert":
        l_upper, l_bend = 20.0, 34.0
        r_upper, r_bend = 78.0, 26.0
        l_act, r_act = ("reach", 0.65), ("rest", 0.5)
    elif shot_id == "shot_04_mirror_shock":
        trem = math.sin(t * 28.0) * 4.0
        l_upper, l_bend = 16.0 + trem, 42.0
        r_upper, r_bend = 92.0 - trem, 36.0
        l_act, r_act = ("retract", 0.6), ("retract", 0.6)
    elif shot_id == "shot_05_panic_chase":
        swing_px = math.sin(gait.phase_continuous * math.pi * 2.0) * 20.0
        l_upper, l_bend = _clamp(20.0 + swing_px * 0.4, 8.0, 34.0), 40.0
        r_upper, r_bend = _clamp(74.0 - swing_px * 0.7, 52.0, 96.0), 32.0
        l_act, r_act = ("offer", 0.85), ("retract", 0.75)
    elif shot_id == "shot_06_cone_trip":
        l_upper, l_bend = 18.0 + math.sin(t * 14.0) * 5.0, 42.0
        r_upper, r_bend = 80.0 - math.sin(t * 14.0) * 10.0, 32.0
        l_act, r_act = ("retract", 0.55), ("retract", 0.65)
    elif shot_id == "shot_08_sign_payoff":
        shiver = math.sin(t * 30.0) * 3.0
        l_upper, l_bend = 16.0 + shiver, 38.0
        r_upper, r_bend = 98.0 - shiver, 34.0
        l_act, r_act = ("retract", 0.5), ("retract", 0.5)
    else:
        l_upper, l_bend = 24.0, 34.0
        r_upper, r_bend = 84.0, 24.0
        l_act, r_act = ("rest", 0.3), ("rest", 0.3)

    return (
        {
            "left": _solve_valid_arm_fk(l_spec, l_upper, l_bend),
            "right": _solve_valid_arm_fk(r_spec, r_upper, r_bend),
        },
        {
            "left": {"action": l_act[0], "phase": float(l_act[1])},
            "right": {"action": r_act[0], "phase": float(r_act[1])},
        },
    )


def _cone_world_pose(t: float) -> tuple[float, float, float]:
    """Return cone (world_x, world_y, angle_deg) standing left of zombie then tipped left clear of feet."""
    rest_x, rest_y = 38.0, -28.0
    if t < 6.24:
        return rest_x, rest_y, 0.0
    dt = _clamp01((t - 6.24) / 0.85)
    u = _smooth(dt)
    cx = _lerp(rest_x, -26.0, u)
    cy = rest_y - math.sin(u * math.pi) * 44.0 + u * 8.0
    ang = _lerp(0.0, -76.0, u) + math.sin(dt * math.pi * 2.5) * 6.0 * (1.0 - u)
    return cx, cy, ang


def _mirror_local_and_contact(t: float, shot_id: str, rt, h_mat: np.ndarray, scale: float) -> tuple[Any, float]:
    """Compute pocket vanity mirror ContactState held cleanly by Human's forward leading arm (`right`)."""
    # `human` faces LEFT (-X); right arm socket=[-60.1,-185.8], max reach=110, `offer` wrist=[-148,-163], `rest` wrist=[-91,-82].
    if shot_id == "shot_03_mirror_insert":
        u = _smooth((t - 2.20) / 0.45)
        mx_loc = _lerp(-132.0, -142.0, u)
        my_loc = _lerp(-172.0, -194.0, u)
        ang_deg = _lerp(-6.0, 8.0, u) + math.sin(t * 3.0) * 1.5
        mw, mh = 54.0, 80.0
    elif shot_id == "shot_07_human_deadpan":
        lt = t - 7.50
        tilt = math.sin(_clamp01(lt / 0.90) * math.pi) * 10.0
        mx_loc, my_loc, ang_deg = -138.0, -190.0, -6.0 - tilt
        mw, mh = 54.0, 78.0
    else:
        # Hang mirror pointed upside-down below relaxed wrist so mirror oval never overlaps right forearm
        mx_loc, my_loc, ang_deg = -94.0, -62.0, 174.0 + math.sin(t * 2.1) * 2.0
        mw, mh = 42.0, 62.0

    ar = math.radians(ang_deg)
    mat_local = np.array(
        [
            [math.cos(ar), -math.sin(ar), mx_loc],
            [math.sin(ar), math.cos(ar), my_loc],
            [0.0, 0.0, 1.0],
        ],
        dtype=float,
    )
    c_local = rt.ContactState(
        state="owner",
        paper_matrix=mat_local,
        paper_size=(mw, mh),
        holders=[{"actor_id": "human", "arm": "right", "grip": [0.50, 0.84]}],
        targets={},
        event_index=0,
    )
    return rt.transform_contact(c_local, h_mat), scale


def _draw_bg_with_midnight_fx(
    bg_raw: Image.Image,
    cam,
    w: int,
    h: int,
    t: float,
    z_gait: mc.GaitPose,
    w2s,
    shot_id: str,
    focus_sx_sy: tuple[float, float],
) -> Image.Image:
    # Parallax framing across 2048x1152 convenience store scene
    zoom = 1.0 + max(0.0, (cam.z - 140.0) * 0.00055)
    scaled_h = max(h, round(h * zoom))
    scale_f = scaled_h / bg_raw.height
    scaled_w = max(w, round(bg_raw.width * scale_f))
    pan_px = (cam.x - 245.0) * 0.85 * (w / 720.0)
    center_x = scaled_w * 0.44 + pan_px
    x0 = max(0.0, min(float(scaled_w - w), center_x - w * 0.5))
    y0 = max(0.0, (scaled_h - h) * 0.52)
    box = (x0 / scale_f, y0 / scale_f, (x0 + w) / scale_f, (y0 + h) / scale_f)
    bg_rgba = bg_raw.resize((w, h), Image.Resampling.BILINEAR, box=box).convert("RGBA")

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    sx_f = w / 720.0

    # 1. Soft breathing storefront mint/coral window shimmer & puddle glow (continuous gentle motion)
    glow_pulse = 0.5 + 0.5 * math.sin(t * 3.8)
    glow_alpha = int(round(18 + 16 * glow_pulse))
    draw.ellipse(
        [w * 0.52, h * 0.25, w * 1.08, h * 0.72],
        fill=(110, 235, 195, glow_alpha),
    )

    # 2. Wet sidewalk rain streaks (far-plane atmospheric motion, clean non-strobe alpha)
    n_drops = 38
    for idx in range(n_drops):
        # Deterministic closed-form drop position
        lane_u = ((idx * 137 + 19) % 100) / 100.0
        speed_u = 1.35 + (idx % 5) * 0.18
        phase_u = ((t * speed_u + idx * 0.173) % 1.0)
        rx = (lane_u * w * 1.15 - phase_u * w * 0.18 - pan_px * 0.15) % (w + 40) - 20
        ry = phase_u * (h + 120) - 60
        rlen = (26.0 + (idx % 4) * 10.0) * sx_f
        col = (185, 225, 240, 68 if idx % 3 else 102)
        draw.line([(rx, ry), (rx - rlen * 0.22, ry + rlen)], fill=col, width=max(1, round(1.8 * sx_f)))

    # 3. Puddle ripple rings beneath rain drops & ContactPlan touchdowns
    for k_r in range(6):
        ru = ((t * 1.1 + k_r * 0.27) % 1.0)
        rpx = ((k_r * 193 + 90) % 620) * sx_f - pan_px * 0.25
        rpy = (985 + (k_r * 37) % 140) * (h / 1280.0)
        rr = (8.0 + ru * 34.0) * sx_f
        ra = int(round(95 * (1.0 - ru)))
        draw.ellipse([rpx - rr, rpy - rr * 0.35, rpx + rr, rpy + rr * 0.35], outline=(165, 230, 220, ra), width=max(1, round(2.0 * sx_f)))

    for fc in (z_gait.contact_plan.left, z_gait.contact_plan.right):
        dt = t - fc.touchdown_t
        if 0.0 <= dt <= 0.28 and fc.state == "stance" and shot_id in ("shot_02_stalk", "shot_05_panic_chase", "shot_06_cone_trip"):
            u = dt / 0.28
            pt = w2s(fc.plant_world)
            alpha = int(round(165 * (1.0 - u)))
            for k_p, ang in enumerate((-0.4, -2.7, -1.55)):
                dx = math.cos(ang) * (12.0 + u * 34.0) * sx_f * (1 + 0.18 * k_p)
                dy = math.sin(ang) * (6.0 + u * 16.0) * sx_f
                rad = max(2.5, (5.0 + u * 5.0) * sx_f)
                draw.ellipse([pt[0] + dx - rad, pt[1] + dy - rad * 0.6, pt[0] + dx + rad, pt[1] + dy + rad * 0.6], fill=(195, 238, 245, alpha))

    # 4. Shot 4 comic jagged shock burst behind Zombie's eyes
    if shot_id == "shot_04_mirror_shock":
        lt = t - 3.20
        burst_alpha = int(round(200 * math.sin(_clamp01(lt / 0.95) * math.pi)))
        fx, fy = focus_sx_sy
        for r_idx in range(12):
            ang = r_idx * (math.pi * 2.0 / 12.0) + math.sin(t * 8.0) * 0.04
            r0 = (95.0 + (r_idx % 2) * 20.0) * sx_f
            r1 = (240.0 + (r_idx % 3) * 35.0) * sx_f
            draw.line(
                [(fx + math.cos(ang) * r0, fy + math.sin(ang) * r0), (fx + math.cos(ang) * r1, fy + math.sin(ang) * r1)],
                fill=(255, 232, 130, max(40, burst_alpha)),
                width=max(2, round(5.0 * sx_f)),
            )

    # 5. Shot 5 dynamic horizontal comedy dash streaks
    if shot_id == "shot_05_panic_chase":
        z_center = w2s((z_gait.root.world_x + 40.0, z_gait.root.world_y - 165.0))
        for k_s in range(7):
            sy_l = z_center[1] + (k_s - 3) * 32.0 * sx_f
            phase = ((t * 4.5 + k_s * 0.23) % 1.0)
            x_a = z_center[0] + (55.0 + phase * 180.0) * sx_f
            x_b = x_a + (90.0 + (k_s % 3) * 40.0) * sx_f
            draw.line([(x_a, sy_l), (x_b, sy_l)], fill=(215, 248, 255, 130), width=max(2, round(3.0 * sx_f)))

    return Image.alpha_composite(bg_rgba, overlay)


def _draw_foreground_with_rain_and_sign(
    fg_raw: Image.Image,
    cam,
    w: int,
    h: int,
    t: float,
    shot_id: str,
) -> tuple[Image.Image | None, np.ndarray | None]:
    # Shot 8 only: glowing 24H sidewalk A-frame sign enters cleanly at far bottom-left corner (clear of feet/limbs!).
    # Note: rain streaks are composited on the background plane so thin 2px streaks never fragment b6_puppet limb alpha masks.
    if shot_id != "shot_08_sign_payoff":
        return None, None
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sx_f = w / 720.0
    lt = t - 8.80
    u_in = _smooth(lt / 0.35)
    scale_h = max(64, round(h * 0.29))
    scale_w = max(64, round(fg_raw.width * (scale_h / fg_raw.height)))
    sign_scaled = fg_raw.resize((scale_w, scale_h), Image.Resampling.BILINEAR)
    dest_x = int(round(_lerp(-scale_w * 0.4, 16.0 * sx_f, u_in)))
    dest_y = int(round(h - scale_h * 0.96))
    canvas.paste(sign_scaled, (dest_x, dest_y), sign_scaled)
    arr = np.asarray(canvas)
    return canvas, arr[:, :, 3]


def _evaluate_frame(t: float, size: tuple[int, int], c) -> tuple[Any, dict[str, Any], dict[str, Any]]:
    t = max(0.0, min(10.0, float(t)))
    s = _setup(c)
    w, h = map(int, size)
    i = max(0, min(299, int(round(t * 30.0))))

    shot, shot_u = scene_runtime.shot_at(c, t)
    shot_id = str(shot.get("id") or "shot_01_hook") if shot else "shot_01_hook"

    # Sample Zombie articulated gait from canonical scene_runtime
    ms = scene_runtime.motion_state_at(c, t, default_x=160.0, default_y=0.0)
    z_shot_motion = _motion_shot_for(ms)
    z_gait = mc.sample_gait(s["z_profile"], t, z_shot_motion, state=ms["preset"])
    zx, zy = float(z_gait.root.world_x), float(z_gait.root.world_y)
    # Add comic shiver micro-tremble strictly in Shot 8 horizontal torso shake (no camera noise!)
    if shot_id == "shot_08_sign_payoff":
        zx += math.sin(t * 34.0) * 3.0

    # Calm grounded Human on right side outside storefront (100% cleanly framed in Shots 3 & 7, clear of edges elsewhere)
    hx = 615.0
    hy = 0.0
    h_shot_motion = mc.ShotMotion(
        shot_id=shot_id,
        start_s=float(shot.get("start", 0.0)) if shot else 0.0,
        end_s=float(shot.get("end", 10.0)) if shot else 10.0,
        start_x=hx,
        end_x=hx,
        start_y=hy,
        end_y=hy,
        state="idle",
        facing=-1.0,
        cadence_hz=1.4,
        stride_len=60.0,
        foot_lift=10.0,
        pelvis_drop=2.0,
        easing="smooth",
    )
    h_gait = mc.sample_gait(s["h_profile"], t, h_shot_motion, state="idle")

    cone_wx, cone_wy, cone_ang = _cone_world_pose(t)
    mirror_wx, mirror_wy = hx - 138.0, hy - 188.0

    scene_semantics = {
        "actor_z": 860.0,
        "actor_vel_xy": [float(z_gait.contact_plan.root_speed) * float(z_gait.facing), 0.0],
        "targets": {
            "actor_full:zombie": [zx + 14.0, zy - 132.0],
            "actor_head:zombie": [zx + 4.0, zy - 220.0],
            "actor_eyes:zombie": [zx + 18.0, zy - 210.0],
            "actor_full:human": [hx - 24.0, hy - 140.0],
            "actor_head:human": [hx - 28.0, hy - 210.0],
            "actor_eyes:human": [hx - 8.0, hy - 242.0],
            "prop:mirror": [mirror_wx, mirror_wy],
            "prop:cone": [cone_wx + 42.0, cone_wy - 72.0],
            "action_group": [zx + 15.0, -145.0],
        },
    }

    nw, nh = c.viewport.native_size
    base_cam = c.space.Camera(
        width=nw,
        height=nh,
        focal=1040.0 * nw / 720.0,
        x=245.0,
        y=-205.0,
        z=180.0,
        principal_y=round(nh * 0.40),
        near=60.0,
    )
    ed_state = scene_runtime.editorial_state_at(c, t, scene_semantics=scene_semantics)
    cam = scene_runtime.camera_editorial_at(c, t, base_cam=base_cam, scene_semantics=scene_semantics)
    z_actor = 860.0

    def w2s(pt_xy: tuple[float, float]) -> tuple[float, float]:
        sx_n, sy_n, _ = cam.project((float(pt_xy[0]), float(pt_xy[1]), z_actor))
        return float(sx_n) * (w / max(1.0, float(cam.width))), float(sy_n) * (h / max(1.0, float(cam.height)))

    scale = (cam.focal / max(80.0, z_actor - cam.z)) * (w / max(1.0, float(cam.width)))
    z_sx, z_sy = w2s((zx, zy))
    z_mat = np.array([[scale, 0.0, z_sx], [0.0, scale, z_sy], [0.0, 0.0, 1.0]], dtype=float)
    h_sx, h_sy = w2s((hx, hy))
    h_mat = np.array([[scale, 0.0, h_sx], [0.0, scale, h_sy], [0.0, 0.0, 1.0]], dtype=float)

    rt = c.puppet_runtime
    z_char = s["zombie"]
    z_view = z_char.views["three_quarter"]
    h_char = s["human"]
    h_view = h_char.views["three_quarter"]

    # Zombie head variant progression
    z_expr = str(ms.get("head_variant") or (shot.get("expression") if shot else "neutral"))
    if shot_id == "shot_04_mirror_shock" and t >= 3.75:
        z_expr = "panic"
    if z_expr not in z_view.heads:
        z_expr = "neutral"

    z_head_ang = float(z_gait.upper_body.head_angle_deg)
    z_head_ang += c.actions.reaction_nod(t, start=3.20, attack=0.10, settle=0.35, angle=-14.0)
    z_head_ang += c.actions.reaction_nod(t, start=8.82, attack=0.14, settle=0.45, angle=9.0)
    z_head_ang = _clamp(z_head_ang, -18.0, 18.0)

    z_arms, z_arm_acts = _zombie_arm_kinematics(z_view, shot_id, t, shot_u, z_gait)
    z_pose = rt.ActorFrame(
        actor_id="zombie",
        character=z_char,
        view=z_view,
        placement=z_mat,
        arms=z_arms,
        action="rest",
        phase=1.0,
        frame_index=i,
        allow_cut=True,
    )
    z_pose.arm_actions = z_arm_acts
    z_pose.head_angle_deg = float(z_head_ang)
    z_pose.head_pivot = np.array(z_view.head_anchor, dtype=float)
    z_pose.head_variant = z_expr
    z_pose.ankle_targets = {}

    # Human expression & mirror grip
    if shot_id in ("shot_03_mirror_insert", "shot_04_mirror_shock", "shot_08_sign_payoff"):
        h_expr = "deadpan"
    elif shot_id == "shot_07_human_deadpan":
        h_expr = "blink" if 7.88 <= t <= 8.22 else "deadpan"
    else:
        h_expr = "neutral"

    m_contact, _ = _mirror_local_and_contact(t, shot_id, rt, h_mat, scale)

    # Solve Human forward `right` arm with exact IK wrist lock to Mirror handle + relaxed `left` arm on jacket side
    is_mirror_raised = shot_id in ("shot_03_mirror_insert", "shot_07_human_deadpan")
    h_arm_l = _solve_valid_arm_fk(h_view.arms["left"], 96.0 + math.sin(t * 2.0) * 3.0, 26.0)
    h_lead_spec = h_view.arms["right"]
    h_grip_screen = np.array(m_contact.targets["human"]["right"], dtype=float)
    h_grip_local = (np.linalg.inv(h_mat) @ np.array([h_grip_screen[0], h_grip_screen[1], 1.0]))[:2]
    h_act_name = "offer" if is_mirror_raised else "rest"
    h_nominal = rt.forward_kinematics(h_lead_spec, h_lead_spec.poses[h_act_name])
    try:
        h_arm_r = rt.planar_ik(h_lead_spec, h_grip_local, h_nominal[2])
    except Exception:
        sh = np.array(h_lead_spec.socket, dtype=float)
        dvec = h_grip_local - sh
        d = max(12.0, float(np.linalg.norm(dvec)))
        r_clamped = _clamp(d, abs(h_lead_spec.lengths[0] - h_lead_spec.lengths[1]) + 4.0, sum(h_lead_spec.lengths) - 4.0)
        h_arm_r = rt.planar_ik(h_lead_spec, sh + (dvec / d) * r_clamped, h_nominal[2])

    h_pose = rt.ActorFrame(
        actor_id="human",
        character=h_char,
        view=h_view,
        placement=h_mat,
        arms={"left": h_arm_l, "right": h_arm_r},
        action=h_act_name,
        phase=0.85,
        frame_index=i,
        allow_cut=True,
    )
    h_pose.arm_actions = {
        "left": {"action": "rest", "phase": 0.4},
        "right": {"action": h_act_name, "phase": 0.85},
    }
    h_head_ang = c.actions.reaction_nod(t, start=7.65, attack=0.18, settle=0.45, angle=-5.0)
    h_pose.head_angle_deg = float(_clamp(h_head_ang, -14.0, 14.0))
    h_pose.head_pivot = np.array(h_view.head_anchor, dtype=float)
    h_pose.head_variant = h_expr
    h_pose.ankle_targets = {}

    # Props: Vanity Mirror (held in Human hand) + Traffic Cone (on sidewalk curb, tripped in Shot 6!)
    props_list: list[Any] = [rt.PropFrame("mirror", m_contact, s["mirror_raw"], front_limb_parts=())]

    c_sx, c_sy = w2s((cone_wx, cone_wy))
    car = math.radians(cone_ang)
    c_mat = np.array([[math.cos(car), -math.sin(car), c_sx], [math.sin(car), math.cos(car), c_sy], [0.0, 0.0, 1.0]], dtype=float)
    cone_contact = rt.ContactState(
        state="release",
        paper_matrix=c_mat,
        paper_size=(max(20.0, 56.0 * scale), max(20.0, 74.0 * scale)),
        holders=[],
        targets={},
        event_index=1,
    )
    props_list.append(rt.PropFrame("cone", cone_contact, s["cone_raw"]))

    # Ground contact ellipse shadows
    z_shadows = []
    for fc in (z_gait.contact_plan.left, z_gait.contact_plan.right):
        fpt = w2s((fc.plant_world[0], 0.0)) if fc.state == "stance" else w2s((fc.target_world[0], 0.0))
        dist_h = max(0.0, -fc.target_world[1]) if fc.state == "swing" else 0.0
        fade = max(0.28, 1.0 - dist_h / 65.0)
        z_shadows.append((fpt[0], fpt[1], 19.0 * scale * fade, 5.5 * scale * fade, 115.0 * fade))
    h_shadows = [
        (h_sx - 18.0 * scale, h_sy, 19.0 * scale, 5.5 * scale, 110.0),
        (h_sx + 18.0 * scale, h_sy, 19.0 * scale, 5.5 * scale, 110.0),
    ]

    focus_xyz = ed_state.get("focus", {}).get("world_xyz", [zx, -160.0, z_actor])
    focus_sx_sy = w2s((float(focus_xyz[0]), float(focus_xyz[1])))

    bg = _draw_bg_with_midnight_fx(s["bg_raw"], cam, w, h, t, z_gait, w2s, shot_id, focus_sx_sy)
    fg, fg_mask = _draw_foreground_with_rain_and_sign(s["fg_raw"], cam, w, h, t, shot_id)

    actors_spec = [
        {"pose": z_pose, "gait": z_gait, "profile": s["z_profile"], "world_to_screen": w2s, "ground_shadows": z_shadows},
        {"pose": h_pose, "gait": h_gait, "profile": s["h_profile"], "world_to_screen": w2s, "ground_shadows": h_shadows},
    ]

    res = mr.render_articulated_scene(
        size,
        actors_spec,
        props=props_list,
        background=bg,
        foreground=fg,
        foreground_occlusion_mask=fg_mask,
        frame_index=i,
        runtime=rt,
    )
    if res.qa.get("errors"):
        raise ValueError(f"Frame {i} (t={t:.3f}, shot={shot_id}) render QA errors: {res.qa['errors']}")

    is_cut = abs(t - float(shot.get("start", 0.0))) < (1.0 / 60.0) if shot else False
    ev = mqc.motion_evidence_at(
        t,
        z_gait,
        viewport=size,
        frame_idx=i,
        shot_id=shot_id,
        render_qa=res.qa,
        world_to_screen_fn=w2s,
        is_cut=is_cut,
    )
    shot_ids = [str(sh.get("id") or "") for sh in ((c.plan or {}).get("shots") or [])]
    shot_idx = shot_ids.index(shot_id) if shot_id in shot_ids else 0
    ev["step_index"] = (shot_idx + 1) * 100 + int(ev.get("step_index", 0))
    ed_ev = {
        "frame": i,
        "t": round(t, 4),
        "shot_id": shot_id,
        "role": ed_state.get("role"),
        "shot_size": ed_state.get("shot_size"),
        "focus_screen_xy": [round(focus_sx_sy[0], 2), round(focus_sx_sy[1], 2)],
        "in_reaction_hold": bool(ed_state.get("in_reaction_hold", False)),
        "is_cut": is_cut,
    }
    return res, ev, ed_ev


def frame(t, c):
    res, _, _ = _evaluate_frame(float(t), c.viewport.size, c)
    return res


def draft_frame(t, c):
    res, _, _ = _evaluate_frame(float(t), c.viewport.size, c)
    return res


def collect_motion_evidence(c, start_s: float = 0.0, end_s: float = 10.0, fps: int = 30) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    n_start = max(0, int(round(start_s * fps)))
    n_end = min(300, max(n_start + 1, int(round(end_s * fps))))
    rows: list[dict[str, Any]] = []
    for f_idx in range(n_start, n_end):
        _, ev, _ = _evaluate_frame(f_idx / float(fps), c.viewport.native_size, c)
        rows.append(ev)
    qc_report = mqc.validate_motion_contract(rows)
    return rows, qc_report


def collect_editorial_evidence(c, start_s: float = 0.0, end_s: float = 10.0, fps: int = 30) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    n_start = max(0, int(round(start_s * fps)))
    n_end = min(300, max(n_start + 1, int(round(end_s * fps))))
    motion_rows: list[dict[str, Any]] = []
    ed_rows: list[dict[str, Any]] = []
    for f_idx in range(n_start, n_end):
        _, mev, eev = _evaluate_frame(f_idx / float(fps), c.viewport.native_size, c)
        motion_rows.append(mev)
        ed_rows.append(eev)
    qc_report = mqc.validate_motion_contract(motion_rows)
    return motion_rows, ed_rows, qc_report
