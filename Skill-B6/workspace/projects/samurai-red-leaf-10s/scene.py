"""Samurai slapstick motion short: 'The Samurai Who Challenged a Leaf' (9:16, 10s, 30fps).

Drives all 6 shots through `scene_runtime.py` (`scene-control.json`) and shared
`b6_motion_core` / `b6_motion_render` / `b6_motion_qc` modules:
- True analytical 2-bone bent-knee IK & world-locked tabi footsteps (zero foot slide)
- Pelvis drop + upper-body counter-swing yielding cleanly to katana ContactState grip
- 2.5D shrine courtyard parallax + stone lantern foreground occlusion matte
- 100% stateless seek-invariant evaluation across parallel workers and random seeks
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


def _smooth(x: float) -> float:
    x = max(0.0, min(1.0, float(x)))
    return x * x * (3.0 - 2.0 * x)


def _lerp(a: float, b: float, u: float) -> float:
    return float(a) * (1.0 - float(u)) + float(b) * float(u)


def _setup(c) -> dict[str, Any]:
    base = Path(c.base) if getattr(c, "base", None) else Path(__file__).resolve().parent
    key = str(base)
    if _STATE.get("key") == key:
        return _STATE

    bg_raw = Image.open(base / "assets/production/samurai_courtyard_bg.png").convert("RGB")
    fg_raw = Image.open(base / "assets/production/samurai_fg_lantern.png").convert("RGBA")
    leaf_raw = Image.open(base / "assets/production/red_maple_leaf.png").convert("RGBA")
    sword_raw = Image.open(base / "assets/production/katana_sword.png").convert("RGBA")
    saya_raw = Image.open(base / "assets/production/katana_saya.png").convert("RGBA")
    ch = c.character_packages["ren"]
    v = ch.views["three_quarter"]

    profile = mc.MotionProfile(
        upper_leg_len=56.0,
        lower_leg_len=54.0,
        hip_left_local=tuple(v.legs["left"]["hip"]),
        hip_right_local=tuple(v.legs["right"]["hip"]),
        shoulder_y_local=-200.0,
        torso_height=120.0,
        facing=1.0,
        stride_len=148.0,
        cadence_hz=2.6,
        foot_lift=46.0,
        pelvis_bob=8.0,
        arm_swing_amp=0.38,
        startup_s=0.16,
        brake_s=0.18,
        ink_width=5.6,
        ink_color=tuple(v.ink_color),
        foot_size=(24.0, 9.0),
        foot_style="tabi",
        ground_y=0.0,
        max_knee_deg=128.0,
    )

    _STATE.clear()
    _STATE.update(
        {
            "key": key,
            "bg_raw": bg_raw,
            "fg_raw": fg_raw,
            "leaf_raw": leaf_raw,
            "sword_raw": sword_raw,
            "saya_raw": saya_raw,
            "character": ch,
            "profile": profile,
        }
    )
    return _STATE


def _native_camera(t: float, c, focus_world_xy: tuple[float, float] | None = None):
    nw, nh = c.viewport.native_size
    base_cam = c.space.Camera(
        width=nw,
        height=nh,
        focal=1040.0 * nw / 720.0,
        x=255.0,
        y=-220.0,
        z=200.0,
        principal_y=round(nh * 0.365),
        near=60.0,
    )
    return scene_runtime.camera_director_at(c, t, base_cam, focus_world_xy=focus_world_xy)


def _motion_shot_for(ms: dict[str, Any]) -> mc.ShotMotion:
    return mc.ShotMotion(
        shot_id=str(ms.get("shot_id") or "shot"),
        start_s=float(ms.get("start_s", 0.0)),
        end_s=max(float(ms.get("start_s", 0.0)) + 0.05, float(ms.get("end_s", 1.0))),
        start_x=float(ms.get("start_x", 250.0)),
        end_x=float(ms.get("end_x", 250.0)),
        start_y=float(ms.get("start_y", 0.0)),
        end_y=float(ms.get("end_y", 0.0)),
        state=str(ms.get("preset", "idle")),
        facing=float(ms.get("facing", 1)),
        cadence_hz=float(ms.get("cadence_hz", 2.0)),
        stride_len=float(ms.get("stride_len", 110.0)),
        foot_lift=float(ms.get("foot_lift", 28.0)),
        pelvis_drop=float(ms.get("pelvis_drop", 4.0)),
        easing=str(ms.get("easing", "smooth")),
        anticipate_s=float(ms.get("anticipate_s", 0.16)),
        settle_s=float(ms.get("settle_s", 0.18)),
        arm_swing_amp=float(ms.get("arm_swing_amp", 0.32)),
        step_count_override=ms.get("step_count_override"),
    )


def _solve_valid_arm_fk(arm_spec, upper_deg: float, bend_deg: float) -> np.ndarray:
    """Clamp FK angles strictly within arm joint limits and return (3,2) local nodes."""
    u_lo, u_hi = arm_spec.upper_range
    b_lo, b_hi = arm_spec.bend_range
    u_clamped = max(u_lo + 1.0, min(u_hi - 1.0, float(upper_deg)))
    b_clamped = max(b_lo + 1.0, min(b_hi - 1.0, float(bend_deg)))
    a, b = arm_spec.lengths
    ur = math.radians(u_clamped)
    fr = math.radians(u_clamped - arm_spec.pole * b_clamped)
    sh = arm_spec.socket
    el = sh + a * np.array([math.cos(ur), math.sin(ur)])
    wr = el + b * np.array([math.cos(fr), math.sin(fr)])
    return np.array([sh, el, wr], dtype=float)


def _choose_arm_kinematics(
    view, shot_id: str, t: float, shot_u: float, gait: mc.GaitPose
) -> tuple[dict[str, np.ndarray], dict[str, dict[str, Any]], dict[str, Any]]:
    """Compute crisp FK right/left arm poses and katana state purely from (t, gait)."""
    # Right arm (front layer): holds katana from draw onset (shot_02) through end!
    # Left arm (back layer): stabilizes saya in draw, counter-swings hard during dash!
    l_spec = view.arms["left"]
    r_spec = view.arms["right"]
    sw_l_act, sw_l_ph = gait.upper_body.left_arm

    has_katana_in_hand = True
    sword_angle_deg = -18.0
    slash_fx = 0.0

    if shot_id == "shot_01_hook":
        has_katana_in_hand = False
        shock_u = _smooth(min(1.0, max(0.0, (t - 0.16) / 0.25)))
        l_upper = _lerp(66.0, 62.0, shock_u)
        l_bend = _lerp(24.0, 38.0, shock_u)
        r_upper = _lerp(94.0, 118.0, shock_u)
        r_bend = _lerp(20.0, 52.0, shock_u)
        l_name, l_ph = ("offer" if shock_u > 0.5 else "rest"), shock_u
        r_name, r_ph = ("retract" if shock_u > 0.5 else "rest"), shock_u

    elif shot_id == "shot_02_anticipate":
        draw_u = _smooth(shot_u)
        lift_u = _smooth(min(1.0, shot_u * 1.45))
        # Left arm stays stably through back sleeve center [64..66 deg];
        # Right hand draws sword in steep hero guard in front-left x<=+20 (-82 deg) — zero overlap with back arm (+50..+75)!
        l_upper = _lerp(66.0, 64.0, draw_u)
        l_bend = _lerp(24.0, 28.0, draw_u)
        r_upper = _lerp(88.0, 114.0, lift_u)
        r_bend = _lerp(20.0, 108.0, lift_u)
        sword_angle_deg = _lerp(-88.0, -82.0, draw_u)
        l_name, l_ph = "reach", draw_u
        r_name, r_ph = "offer", draw_u

    elif shot_id == "shot_03_dash":
        # Back arm pumps calmly down-back [64..70 deg]; front hand holds upright blade (-82..-78 deg) cleanly left of x=+24!
        pump = (float(sw_l_ph) - 0.5) * 2.0  # [-1..+1] synced anti-phase with legs
        l_upper = 67.0 + pump * 3.0
        l_bend = 28.0 - pump * 6.0
        r_upper = 114.0 - pump * 6.0
        r_bend = 108.0 + pump * 6.0
        sword_angle_deg = -82.0 - pump * 4.0
        l_name, l_ph = sw_l_act, float(sw_l_ph)
        r_name, r_ph = "offer", 0.7

    elif shot_id == "shot_04_slash_miss":
        # Wind up steep overhead (-88 deg) -> fast diagonal strike across lower foreground -> recoil hold!
        lt = max(0.0, t - 4.45)
        if lt < 0.35:
            wu = _smooth(lt / 0.35)
            r_upper = _lerp(114.0, 104.0, wu)
            r_bend = _lerp(108.0, 118.0, wu)
            l_upper = _lerp(67.0, 64.0, wu)
            l_bend = _lerp(28.0, 32.0, wu)
            sword_angle_deg = _lerp(-82.0, -90.0, wu)
        elif lt < 0.80:
            su = _smooth((lt - 0.35) / 0.45)
            r_upper = _lerp(104.0, 82.0, su)
            r_bend = _lerp(118.0, 26.0, su)
            l_upper = _lerp(64.0, 72.0, su)
            l_bend = _lerp(32.0, 14.0, su)
            sword_angle_deg = _lerp(-90.0, 32.0, su)
            slash_fx = math.sin(su * math.pi)
        else:
            ru = _smooth((lt - 0.80) / 1.30)
            r_upper = _lerp(82.0, 68.0, ru)
            r_bend = _lerp(26.0, 36.0, ru)
            l_upper = _lerp(72.0, 64.0, ru)
            l_bend = _lerp(14.0, 28.0, ru)
            sword_angle_deg = _lerp(32.0, 26.0, ru)
        l_name, l_ph = "retract", 0.5
        r_name, r_ph = "reach", 0.8

    elif shot_id == "shot_05_leaf_nose":
        u_rel = _smooth(shot_u)
        l_upper = _lerp(64.0, 64.0, u_rel)
        l_bend = _lerp(28.0, 26.0, u_rel)
        r_upper = _lerp(68.0, 74.0, u_rel)
        r_bend = _lerp(36.0, 30.0, u_rel)
        sword_angle_deg = _lerp(26.0, 24.0, u_rel)
        l_name, l_ph = "rest", 0.4
        r_name, r_ph = "rest", 0.4

    else:  # shot_06_deadpan — blade lowers peacefully sideways above knee level (clear of feet!)
        u_rel = _smooth(shot_u)
        l_upper = _lerp(64.0, 65.0, u_rel)
        l_bend = _lerp(26.0, 24.0, u_rel)
        r_upper = _lerp(74.0, 76.0, u_rel)
        r_bend = _lerp(30.0, 32.0, u_rel)
        sword_angle_deg = _lerp(24.0, 18.0, u_rel)
        l_name, l_ph = "rest", 0.2
        r_name, r_ph = "rest", 0.2

    l_nodes = _solve_valid_arm_fk(l_spec, l_upper, l_bend)
    r_nodes = _solve_valid_arm_fk(r_spec, r_upper, r_bend)
    return (
        {"left": l_nodes, "right": r_nodes},
        {"left": {"action": l_name, "phase": float(l_ph)}, "right": {"action": r_name, "phase": float(r_ph)}},
        {
            "has_katana_in_hand": has_katana_in_hand,
            "sword_angle_deg": float(sword_angle_deg),
            "slash_fx": float(slash_fx),
        },
    )


def _leaf_trajectory_world(t: float, actor_wx: float, actor_wy: float) -> tuple[float, float, float, float]:
    """Return red maple leaf (world_x, world_y, angle_deg, scale) purely from t."""
    # Starts whipping past Ren's face at 0.20s -> mocks ahead -> loops over slash -> lands on nose!
    if t < 0.80:
        u = _smooth(t / 0.80)
        wx = _lerp(130.0, 395.0, u)
        wy = -295.0 + math.sin(u * math.pi) * 26.0
        ang = _lerp(-35.0, 42.0, u) + math.sin(t * 24.0) * 14.0
        return wx, wy, ang, 0.22
    if t < 2.15:
        u = _smooth((t - 0.80) / 1.35)
        wx = _lerp(395.0, 445.0, u) + math.sin(t * 4.5) * 14.0
        wy = -270.0 + math.cos(t * 3.8) * 18.0
        ang = math.sin(t * 4.2) * 22.0
        return wx, wy, ang, 0.21
    if t < 4.45:
        wx = actor_wx + 178.0 + math.sin(t * 5.0) * 16.0
        wy = -238.0 + math.sin(t * 6.0) * 28.0
        ang = math.sin(t * 7.2) * 26.0
        return wx, wy, ang, 0.21
    if t < 6.55:
        lt = t - 4.45
        if lt < 0.45:
            wx = 768.0
            wy = -235.0 + math.sin(t * 5.0) * 14.0
            ang = math.sin(t * 6.0) * 16.0
        elif lt < 1.35:
            u = _smooth((lt - 0.45) / 0.90)
            wx = _lerp(768.0, 705.0, u) + math.sin(u * math.pi) * 44.0
            wy = _lerp(-235.0, -455.0, u) - math.sin(u * math.pi) * 60.0
            ang = _lerp(0.0, 290.0, u)
        else:
            u = _smooth((lt - 1.35) / 0.75)
            wx = _lerp(705.0, 686.0, u) + math.sin(u * math.pi * 2.0) * 24.0
            wy = _lerp(-455.0, -405.0, u)
            ang = _lerp(290.0, 348.0, u)
        return wx, wy, ang, 0.21
    if t < 8.15:
        lt = t - 6.55
        if lt < 0.43:
            # Gentle maple flutter straight down onto lower nose tip (actor_wx + 8, -274) keeping both wide eyes visible!
            u = _smooth(lt / 0.43)
            wx = _lerp(686.0, actor_wx + 8.0, u) + math.sin(u * math.pi * 2.0) * 18.0 * (1.0 - u)
            wy = _lerp(-405.0, -274.0 + actor_wy, u)
            ang = _lerp(-22.0, 26.0, u)
            sc = _lerp(0.20, 0.125, u)
        else:
            # Sits lightly on lower nose tip with subtle micro settle; eyes stay crisp above leaf!
            wx = actor_wx + 8.0
            wy = -274.0 + actor_wy
            ang = 26.0 + math.sin(lt * 4.0) * 1.5
            sc = 0.125
        return wx, wy, ang, sc
    # shot_06_deadpan: rests smugly on lower nose until 8.85s, then victorious breeze floats clean right-upward clear of actor
    lt = t - 8.15
    if lt < 0.70:
        return actor_wx + 8.0, -274.0 + actor_wy, 26.0, 0.125
    u = _smooth((lt - 0.70) / 1.15)
    wx = (actor_wx + 8.0) + _lerp(0.0, 148.0, u)
    wy = (-274.0 + actor_wy) + _lerp(0.0, 24.0, u) - math.sin(u * math.pi) * 34.0
    ang = _lerp(26.0, 58.0, u)
    return wx, wy, ang, _lerp(0.125, 0.28, u)


def _draw_bg_with_vfx(
    bg_raw: Image.Image, cam, w: int, h: int, t: float, gait: mc.GaitPose, w2s, shot_id: str, cx_base: float = 255.0
) -> Image.Image:
    # Horizontal parallax across wide 2560x1440 painted autumn shrine courtyard
    zoom = 1.0 + max(0.0, (cam.z - 140.0) * 0.00055)
    scaled_h = max(h, round(h * zoom))
    scale_f = scaled_h / bg_raw.height
    scaled_w = max(w, round(bg_raw.width * scale_f))
    pan_px = (cam.x - cx_base) * 0.95 * (w / 720.0)
    center_x = scaled_w * 0.38 + pan_px
    x0 = max(0.0, min(float(scaled_w - w), center_x - w * 0.5))
    y0 = max(0.0, (scaled_h - h) * 0.55)
    box = (x0 / scale_f, y0 / scale_f, (x0 + w) / scale_f, (y0 + h) / scale_f)
    bg_rgba = bg_raw.resize((w, h), Image.Resampling.BILINEAR, box=box).convert("RGBA")

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")
    sx_factor = w / 720.0

    # 1. Analytical touchdown gravel dust puffs from ContactPlan timestamps
    for fc in (gait.contact_plan.left, gait.contact_plan.right):
        dt = t - fc.touchdown_t
        if 0.0 <= dt <= 0.26 and fc.state == "stance" and shot_id in ("shot_03_dash", "shot_04_slash_miss"):
            u = dt / 0.26
            pt = w2s(fc.plant_world)
            alpha = int(round(145 * (1.0 - u)))
            for k_puff, ang in enumerate((-0.45, -2.6, -1.5)):
                dx = math.cos(ang) * (10.0 + u * 28.0) * sx_factor * (1 + 0.2 * k_puff)
                dy = math.sin(ang) * (4.0 + u * 12.0) * sx_factor
                rad = max(3.0, (7.0 + u * 8.0) * sx_factor)
                cx_p, cy_p = pt[0] + dx, pt[1] + dy
                draw.ellipse([cx_p - rad, cy_p - rad * 0.7, cx_p + rad, cy_p + rad * 0.7], fill=(224, 198, 152, alpha))

    # 2. Wind speed streaks in Hook & Dash behind character
    if shot_id in ("shot_01_hook", "shot_03_dash"):
        strength = 0.85 if shot_id == "shot_01_hook" else 0.55
        alpha_w = int(round(170 * strength))
        for idx_s in range(3):
            prog = (t * 2.4 + idx_s * 0.37) % 1.0
            wy = -330.0 + idx_s * 65.0
            wx0 = gait.root.world_x - 220.0 + prog * 340.0
            p0 = w2s((wx0, wy))
            p1 = w2s((wx0 + 110.0, wy + math.sin(t * 9.0 + idx_s) * 8.0))
            draw.line([p0, p1], fill=(255, 250, 236, alpha_w), width=max(2, int(round(3.5 * sx_factor))))

    return Image.alpha_composite(bg_rgba, overlay)


def _draw_foreground_with_vfx(
    fg_raw: Image.Image, cam, w: int, h: int, gait: mc.GaitPose, w2s, slash_fx: float
) -> tuple[Image.Image, np.ndarray]:
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    scale_h = max(64, round(h * 0.27))
    scale_w = max(64, round(fg_raw.width * (scale_h / fg_raw.height)))
    fg_scaled = fg_raw.resize((scale_w, scale_h), Image.Resampling.BILINEAR)
    px_shift = (48.0 - (cam.x - 255.0) * 1.85) * (w / 720.0)
    dest_x = int(round(px_shift - scale_w * 0.45))
    dest_y = int(round(h - scale_h * 0.96))
    if dest_x + scale_w > 0 and dest_x < w:
        canvas.paste(fg_scaled, (dest_x, dest_y), fg_scaled)

    # Katana anime slash arc on foreground layer (pre-composite so occlusion mask matches 100%)
    if slash_fx > 0.05:
        draw = ImageDraw.Draw(canvas, "RGBA")
        sx_factor = w / 720.0
        alpha_s = int(round(220 * min(1.0, slash_fx)))
        center_s = w2s((gait.root.world_x + 30.0, gait.root.world_y - 185.0))
        rx_a, ry_a = 175.0 * sx_factor, 145.0 * sx_factor
        bbox = [center_s[0] - rx_a, center_s[1] - ry_a, center_s[0] + rx_a, center_s[1] + ry_a]
        draw.arc(bbox, start=-70, end=50, fill=(255, 248, 220, alpha_s), width=max(3, int(round(10.0 * sx_factor))))
        draw.arc(bbox, start=-58, end=38, fill=(255, 255, 255, alpha_s), width=max(2, int(round(4.0 * sx_factor))))

    arr = np.asarray(canvas)
    return canvas, arr[:, :, 3]


def _evaluate_frame(t: float, size: tuple[int, int], c) -> tuple[Any, dict[str, Any]]:
    t = max(0.0, min(10.0, float(t)))
    s = _setup(c)
    ch = s["character"]
    v = ch.views["three_quarter"]
    prof: mc.MotionProfile = s["profile"]
    w, h = map(int, size)
    i = max(0, min(299, int(round(t * 30.0))))

    shot, shot_u = scene_runtime.shot_at(c, t)
    shot_id = str(shot.get("id") or "shot_01_hook") if shot else "shot_01_hook"
    ms = scene_runtime.motion_state_at(c, t, default_x=250.0, default_y=0.0)
    shot_motion = _motion_shot_for(ms)
    gait = mc.sample_gait(prof, t, shot_motion, state=ms["preset"])

    # Camera director tracks Ren dynamically with shot-purpose offsets (ground-referenced focus Y)
    cam = _native_camera(t, c, focus_world_xy=(gait.root.world_x + 28.0, gait.root.world_y))
    z_actor = 860.0

    def w2s(pt_xy: tuple[float, float]) -> tuple[float, float]:
        sx_n, sy_n, _ = cam.project((float(pt_xy[0]), float(pt_xy[1]), z_actor))
        return float(sx_n) * (w / max(1.0, float(cam.width))), float(sy_n) * (h / max(1.0, float(cam.height)))

    root_sx, root_sy = w2s((gait.root.world_x, gait.root.world_y))
    scale_native = cam.focal / max(80.0, z_actor - cam.z)
    scale = scale_native * (w / max(1.0, float(cam.width)))
    actor_mat = np.array(
        [
            [scale, 0.0, root_sx],
            [0.0, scale, root_sy],
            [0.0, 0.0, 1.0],
        ],
        dtype=float,
    )

    arm_nodes, arm_actions, weapon_state = _choose_arm_kinematics(v, shot_id, t, shot_u, gait)
    rt = c.puppet_runtime

    # Comedic head angle & expression timed cleanly to beats (zero mutable history)
    raw_expr = ms.get("head_variant") or (shot.get("expression") if shot else None)
    if shot_id == "shot_01_hook" and t < 0.18:
        raw_expr = None
    if shot_id == "shot_04_slash_miss" and (t - 4.45) < 0.72:
        raw_expr = "focused"
    head_variant = str(raw_expr) if raw_expr and str(raw_expr) in v.heads else None

    head_nod = float(gait.upper_body.head_angle_deg)
    head_nod += c.actions.reaction_nod(t, start=0.18, attack=0.12, settle=0.35, angle=-11.0)
    head_nod += c.actions.reaction_nod(t, start=4.90, attack=0.14, settle=0.45, angle=9.5)
    head_nod += c.actions.reaction_nod(t, start=6.98, attack=0.12, settle=0.38, angle=7.5)
    head_nod = max(-20.0, min(20.0, head_nod))

    # Build ActorFrame cleanly with zero continuity trap on cut boundaries
    pose = rt.ActorFrame(
        actor_id="ren",
        character=ch,
        view=v,
        placement=actor_mat,
        arms=arm_nodes,
        action="rest",
        phase=1.0,
        frame_index=i,
        allow_cut=True,
    )
    pose.arm_actions = arm_actions
    pose.head_angle_deg = float(head_nod)
    pose.head_pivot = np.array(v.head_anchor, dtype=float)
    pose.head_variant = head_variant
    pose.ankle_targets = {}

    # Build ContactState props: Saya scabbard on waist, Katana locked in right hand (when drawn), & Maple leaf!
    props_list: list[Any] = []

    # 1. Lacquered Saya scabbard worn at left hip (stays strictly left of x=+30 so back sleeve is clean)
    saya_mat_local = np.array(
        [
            [math.cos(math.radians(-24.0)), -math.sin(math.radians(-24.0)), -46.0],
            [math.sin(math.radians(-24.0)), math.cos(math.radians(-24.0)), -182.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=float,
    )
    saya_contact = rt.transform_contact(
        rt.ContactState(
            state="release",
            paper_matrix=saya_mat_local,
            paper_size=(138.0, 28.0),
            holders=[],
            targets={},
            event_index=0,
        ),
        actor_mat,
    )
    saya_front = ("ren:arm:right:upper", "ren:arm:right:forearm") if weapon_state["has_katana_in_hand"] else ()
    # 2. Curved Katana blade — tucked snugly inside saya when sheathed; pinned to right hand wrist when drawn!
    sword_size = (232.0, 42.0)
    grip_uv = [0.16, 0.50]
    if weapon_state["has_katana_in_hand"]:
        wr_local = arm_nodes["right"][2]
        ang_rad = math.radians(weapon_state["sword_angle_deg"])
        ca, sa = math.cos(ang_rad), math.sin(ang_rad)
        gx_l = (grip_uv[0] - 0.5) * sword_size[0]
        gy_l = (grip_uv[1] - 0.5) * sword_size[1]
        cx_l = wr_local[0] - (ca * gx_l - sa * gy_l)
        cy_l = wr_local[1] - (sa * gx_l + ca * gy_l)
        sw_mat_local = np.array([[ca, -sa, cx_l], [sa, ca, cy_l], [0.0, 0.0, 1.0]], dtype=float)
        sw_contact_local = rt.ContactState(
            state="owner",
            paper_matrix=sw_mat_local,
            paper_size=sword_size,
            holders=[{"actor_id": "ren", "arm": "right", "grip": grip_uv}],
            targets={"ren": {"right": wr_local.tolist()}},
            event_index=1,
        )
        sw_contact_world = rt.transform_contact(sw_contact_local, actor_mat)
        if shot_id == "shot_04_slash_miss":
            sw_front: tuple[str, ...] = (
                "ren:arm:left:upper",
                "ren:arm:left:forearm",
                "ren:arm:right:upper",
                "ren:arm:right:forearm",
            )
        else:
            sw_front = ("ren:arm:right:upper", "ren:arm:right:forearm")
        props_list.append(rt.PropFrame("katana_saya", saya_contact, s["saya_raw"], front_limb_parts=saya_front))
        props_list.append(rt.PropFrame("katana_sword", sw_contact_world, s["sword_raw"], front_limb_parts=sw_front))
    else:
        # Sheathed snugly BEFORE saya: handle protrudes cleanly forward-up out of front mouth of scabbard; blade hidden behind saya!
        ang_rad = math.radians(156.0)
        ca, sa = math.cos(ang_rad), math.sin(ang_rad)
        sw_mat_local = np.array([[ca, -sa, -36.0], [sa, ca, -186.0], [0.0, 0.0, 1.0]], dtype=float)
        sw_contact_local = rt.ContactState(
            state="release",
            paper_matrix=sw_mat_local,
            paper_size=(118.0, 22.0),
            holders=[],
            targets={},
            event_index=1,
        )
        sw_contact_world = rt.transform_contact(sw_contact_local, actor_mat)
        props_list.append(rt.PropFrame("katana_sword", sw_contact_world, s["sword_raw"]))
        props_list.append(rt.PropFrame("katana_saya", saya_contact, s["saya_raw"]))

    # 3. Red Maple Leaf in world coordinates
    l_wx, l_wy, l_ang, l_scale = _leaf_trajectory_world(t, gait.root.world_x, gait.root.world_y)
    l_sx, l_sy = w2s((l_wx, l_wy))
    la_r = math.radians(l_ang)
    l_mat_screen = np.array([[math.cos(la_r), -math.sin(la_r), l_sx], [math.sin(la_r), math.cos(la_r), l_sy], [0.0, 0.0, 1.0]], dtype=float)
    leaf_w_s = 356.0 * l_scale * scale
    leaf_h_s = 408.0 * l_scale * scale
    leaf_contact = rt.ContactState(
        state="release",
        paper_matrix=l_mat_screen,
        paper_size=(max(16.0, leaf_w_s), max(16.0, leaf_h_s)),
        holders=[],
        targets={},
        event_index=2,
    )
    props_list.append(rt.PropFrame("red_maple_leaf", leaf_contact, s["leaf_raw"]))

    # 4. Ground contact shadow points beneath Ren's tabi feet
    shadow_pts = []
    for fc in (gait.contact_plan.left, gait.contact_plan.right):
        fpt = w2s((fc.plant_world[0], prof.ground_y)) if fc.state == "stance" else w2s((fc.target_world[0], prof.ground_y))
        dist_h = max(0.0, prof.ground_y - fc.target_world[1]) if fc.state == "swing" else 0.0
        fade = max(0.28, 1.0 - dist_h / 65.0)
        shadow_pts.append((fpt[0], fpt[1], 19.0 * scale * fade, 5.5 * scale * fade, 115.0 * fade))

    bg = _draw_bg_with_vfx(s["bg_raw"], cam, w, h, t, gait, w2s, shot_id)
    fg, fg_mask = _draw_foreground_with_vfx(s["fg_raw"], cam, w, h, gait, w2s, weapon_state["slash_fx"])

    actor_spec = {
        "pose": pose,
        "gait": gait,
        "profile": prof,
        "world_to_screen": w2s,
        "ground_shadows": shadow_pts,
    }
    res = mr.render_articulated_scene(
        size,
        [actor_spec],
        props=props_list,
        background=bg,
        foreground=fg,
        foreground_occlusion_mask=fg_mask,
        frame_index=i,
        runtime=rt,
    )
    if res.qa.get("errors"):
        raise ValueError(f"Frame {i} (t={t:.3f}) render QA errors: {res.qa['errors']}")

    ev = mqc.motion_evidence_at(
        t,
        gait,
        viewport=size,
        frame_idx=i,
        shot_id=shot_id,
        render_qa=res.qa,
        world_to_screen_fn=w2s,
        is_cut=(abs(t - float(shot.get("start", 0.0))) < (1.0 / 60.0) if shot else False),
    )
    return res, ev


def frame(t, c):
    res, _ = _evaluate_frame(float(t), c.viewport.size, c)
    return res


def draft_frame(t, c):
    res, _ = _evaluate_frame(float(t), c.viewport.size, c)
    return res


def collect_motion_evidence(c, start_s: float = 0.0, end_s: float = 10.0, fps: int = 30) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Run deterministic motion contract evaluation across sampled timeline frames."""
    n_start = max(0, int(round(start_s * fps)))
    n_end = min(300, max(n_start + 1, int(round(end_s * fps))))
    rows: list[dict[str, Any]] = []
    for f_idx in range(n_start, n_end):
        _, ev = _evaluate_frame(f_idx / float(fps), c.viewport.native_size, c)
        rows.append(ev)
    qc_report = mqc.validate_motion_contract(rows)
    return rows, qc_report
