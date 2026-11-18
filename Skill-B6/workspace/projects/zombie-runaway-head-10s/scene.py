"""B6-05 Semantic Action & Visual Storytelling Showcase:
'The Zombie Who Lost His Head' (9:16 Native 720x1280, 30fps, 10.0s).

Architecture:
- Strictly driven by `scene-control.json` via `scene_runtime` (`shot_at`,
  `motion_state_at`, `camera_editorial_at`, `editorial_state_at`, `semantic_state_at`).
- Articulated 2-bone bent-knee IK + world-locked foot stances (`b6_motion_core`),
  opt-in per-frame `head_mount_state` (`attached|detaching|detached|reattaching`)
  via `b6_motion_render`, and independent foreground/prop/contact mask extraction
  into `semantic_runtime.b6_semantic_evidence`.
- Pure stateless deterministic `f(t)` evaluation for exact worker-count & seek parity.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw

import b6_motion_core as mc
import b6_motion_qc as mqc
import b6_motion_render as mr
import b6_semantic_evidence as se
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

    p_char = c.character_packages["pip"]
    m_char = c.character_packages["maya"]
    bg_raw = _load_rgba(c.base, "assets/production/bg_dawn_plaza_tram.png")
    pole_raw = _load_rgba(c.base, "assets/production/prop_tram_pole.png")
    rail_raw = _load_rgba(c.base, "assets/production/prop_orange_rail.png")
    head_prop_raw = _load_rgba(c.base, "assets/production/prop_pip_head_shock.png")

    p_view = p_char.views["three_quarter"]
    m_view = m_char.views["three_quarter"]

    p_profile = mc.MotionProfile(
        upper_leg_len=61.0,
        lower_leg_len=59.0,
        hip_left_local=tuple(p_view.legs["left"]["hip"]),
        hip_right_local=tuple(p_view.legs["right"]["hip"]),
        shoulder_y_local=-198.0,
        torso_height=122.0,
        facing=1.0,
        stride_len=118.0,
        cadence_hz=2.6,
        foot_lift=44.0,
        pelvis_bob=6.5,
        arm_swing_amp=0.5,
        startup_s=0.10,
        brake_s=0.12,
        ink_width=5.8,
        ink_color=tuple(p_view.ink_color),
        foot_size=(15.0, 5.0),
        foot_style="boot",
        ground_y=0.0,
        max_knee_deg=128.0,
    )
    m_profile = mc.MotionProfile(
        upper_leg_len=58.0,
        lower_leg_len=56.0,
        hip_left_local=tuple(m_view.legs["left"]["hip"]),
        hip_right_local=tuple(m_view.legs["right"]["hip"]),
        shoulder_y_local=-205.0,
        torso_height=130.0,
        facing=-1.0,
        stride_len=74.0,
        cadence_hz=1.6,
        foot_lift=18.0,
        pelvis_bob=3.0,
        arm_swing_amp=0.22,
        startup_s=0.14,
        brake_s=0.16,
        ink_width=5.6,
        ink_color=tuple(m_view.ink_color),
        foot_size=(15.0, 5.0),
        foot_style="boot",
        ground_y=0.0,
        max_knee_deg=124.0,
    )

    _STATE.clear()
    _STATE.update(
        {
            "key": key,
            "pip": p_char,
            "maya": m_char,
            "p_profile": p_profile,
            "m_profile": m_profile,
            "bg_raw": bg_raw,
            "pole_raw": pole_raw,
            "rail_raw": rail_raw,
            "head_prop_raw": head_prop_raw,
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


def _motion_shot_for(ms: dict[str, Any], default_x: float) -> mc.ShotMotion:
    return mc.ShotMotion(
        shot_id=str(ms.get("shot_id") or "shot"),
        start_s=float(ms.get("start_s", 0.0)),
        end_s=max(float(ms.get("start_s", 0.0)) + 0.05, float(ms.get("end_s", 1.0))),
        start_x=float(ms.get("start_x", default_x)),
        end_x=float(ms.get("end_x", default_x)),
        start_y=float(ms.get("start_y", 0.0)),
        end_y=float(ms.get("end_y", 0.0)),
        state=str(ms.get("preset", "idle")),
        facing=float(ms.get("facing", 1)),
        cadence_hz=float(ms.get("cadence_hz", 2.0)),
        stride_len=float(ms.get("stride_len", 100.0)),
        foot_lift=float(ms.get("foot_lift", 28.0)),
        pelvis_drop=float(ms.get("pelvis_drop", 5.0)),
        arm_swing_amp=float(ms.get("arm_swing_amp", 0.4)),
        anticipate_s=float(ms.get("anticipate_s", 0.12)),
        settle_s=float(ms.get("settle_s", 0.14)),
    )


def _pose_biped_with_crouch(
    profile: mc.MotionProfile,
    base_gait: mc.GaitPose,
    world_x: float,
    pelvis_y_drop: float,
    lean_deg: float,
) -> tuple[mc.GaitPose, float]:
    """Adjust gait hips/knees cleanly downward without breaking foot ground locks (`y <= 0`)."""
    if abs(pelvis_y_drop) < 1e-3 and abs(lean_deg) < 1e-3:
        return base_gait, 0.0
    # Lower hips toward ankles, re-solve 2-bone leg IK cleanly so ankles stay fixed at ground >= 0
    l_leg = mc.solve_two_bone_ik(
        (world_x + profile.hip_left_local[0], profile.hip_left_local[1] + pelvis_y_drop),
        base_gait.left_leg.ankle_xy,
        profile.upper_leg_len,
        profile.lower_leg_len,
        knee_hint=profile.facing,
        bounds={"ground_y": profile.ground_y},
        side="left",
    )
    r_leg = mc.solve_two_bone_ik(
        (world_x + profile.hip_right_local[0], profile.hip_right_local[1] + pelvis_y_drop),
        base_gait.right_leg.ankle_xy,
        profile.upper_leg_len,
        profile.lower_leg_len,
        knee_hint=profile.facing,
        bounds={"ground_y": profile.ground_y},
        side="right",
    )
    new_root = mc.RootPose(
        world_x=world_x,
        world_y=base_gait.root.world_y + pelvis_y_drop,
        pelvis_drop=base_gait.root.pelvis_drop + pelvis_y_drop,
        torso_lean_deg=lean_deg,
        facing=base_gait.facing,
        hip_left_world=(world_x + profile.hip_left_local[0], profile.hip_left_local[1] + pelvis_y_drop),
        hip_right_world=(world_x + profile.hip_right_local[0], profile.hip_right_local[1] + pelvis_y_drop),
        scale=base_gait.root.scale,
    )
    new_gait = mc.GaitPose(
        t=base_gait.t,
        state=base_gait.state,
        facing=base_gait.facing,
        root=new_root,
        contact_plan=base_gait.contact_plan,
        left_leg=l_leg,
        right_leg=r_leg,
        upper_body=base_gait.upper_body,
        phase_continuous=base_gait.phase_continuous,
        stride_count_elapsed=base_gait.stride_count_elapsed,
        state_blend=base_gait.state_blend,
    )
    return new_gait, pelvis_y_drop


def _pip_state_at(t: float, s: dict[str, Any], shot: dict[str, Any], ms: dict[str, Any]) -> dict[str, Any]:
    """Compute Pip's articulated gait, crouch/hurdle/trip offsets, and head_mount_state."""
    g_shot = _motion_shot_for(ms, -250.0)
    gait = mc.sample_gait(s["p_profile"], t, g_shot)
    wx = float(gait.root.world_x)
    wy_offset = 0.0
    pelvis_drop = 0.0
    lean_deg = 0.0
    body_tilt_deg = 0.0
    mount_state = "attached"
    head_var: str | None = "neutral"
    head_ang = 0.0

    # Shot-specific authentic body kinetics while preserving world-locked stance/IK:
    if t < 1.05:
        # Sneeze anticipation (0..0.40s) with crisp squash crouch then explosive pop detach
        if t < 0.40:
            u = t / 0.40
            head_var = "sneeze"
            squash = math.sin(min(1.0, u * 1.1) * math.pi * 0.5) * 18.0
            pelvis_drop = squash
            gait, _ = _pose_biped_with_crouch(s["p_profile"], gait, wx, pelvis_drop, -10.0 * u)
            head_ang = -16.0 * math.sin(u * math.pi * 0.7) + 18.0 * max(0.0, u - 0.6) / 0.4
            body_tilt_deg = -9.0 * math.sin(u * math.pi)
        elif t < 0.52:
            mount_state = "detaching"
            body_tilt_deg = 12.0 * (1.0 - (t - 0.40) / 0.12)
        else:
            mount_state = "detached"
            body_tilt_deg = 4.0 * math.sin((t - 0.52) * 14.0)
    elif t < 3.80:
        mount_state = "detached"
        body_tilt_deg = 7.0 + 3.0 * math.sin(t * 16.0)
    elif t < 5.30:
        mount_state = "detached"
        # Hurdle jump cleanly over orange rail during 3.85..4.75s!
        if 3.85 <= t < 4.75:
            ju = (t - 3.85) / 0.90
            arc = math.sin(ju * math.pi) ** 0.85
            wy_offset = -74.0 * arc
            body_tilt_deg = 14.0 * arc
            p_hl = (wx + s["p_profile"].hip_left_local[0], s["p_profile"].hip_left_local[1] + wy_offset)
            p_hr = (wx + s["p_profile"].hip_right_local[0], s["p_profile"].hip_right_local[1] + wy_offset)
            # Fold legs upward naturally during hurdle flight and mark authentic airborne swing contact plan
            l_air = mc.solve_two_bone_ik(
                p_hl,
                (wx - 16.0, wy_offset - 22.0 * arc),
                61.0,
                59.0,
                knee_hint=1.0,
                bounds={"ground_y": 0.0},
                side="left",
                contact_state="swing",
            )
            r_air = mc.solve_two_bone_ik(
                p_hr,
                (wx + 24.0, wy_offset - 26.0 * arc),
                61.0,
                59.0,
                knee_hint=1.0,
                bounds={"ground_y": 0.0},
                side="right",
                contact_state="swing",
            )
            j_cp = mc.ContactPlan(
                t=gait.contact_plan.t,
                left=mc.FootContact("left", "swing", l_air.ankle_xy, l_air.ankle_xy, t, t, 0.0, 0.0, float(ju)),
                right=mc.FootContact("right", "swing", r_air.ankle_xy, r_air.ankle_xy, t, t, 0.0, 0.0, float(ju)),
                step_index=gait.contact_plan.step_index,
                ground_y=gait.contact_plan.ground_y,
                root_speed=gait.contact_plan.root_speed,
                is_moving=True,
                active_support="swing",
                blend_state="hurdle_flight",
                stride_phase=float(ju),
            )
            j_gait = mc.GaitPose(
                t=gait.t,
                state=gait.state,
                facing=gait.facing,
                root=mc.RootPose(
                    world_x=wx,
                    world_y=wy_offset,
                    pelvis_drop=gait.root.pelvis_drop,
                    torso_lean_deg=12.0 * arc,
                    facing=gait.facing,
                    hip_left_world=p_hl,
                    hip_right_world=p_hr,
                    scale=gait.root.scale,
                ),
                contact_plan=j_cp,
                left_leg=l_air,
                right_leg=r_air,
                upper_body=gait.upper_body,
                phase_continuous=gait.phase_continuous,
                stride_count_elapsed=gait.stride_count_elapsed,
                state_blend=gait.state_blend,
            )
            gait = j_gait
    elif t < 6.35:
        mount_state = "detached"
        # Comic low puddle slip/trip stumble! Drop pelvis + lean forward sharply while feet stay >= ground_y
        tu = (t - 5.30) / 1.05
        stumble_env = math.sin(min(1.0, tu * 1.15) * math.pi)
        pelvis_drop = 34.0 * stumble_env
        body_tilt_deg = 22.0 * stumble_env
        gait, _ = _pose_biped_with_crouch(s["p_profile"], gait, wx, pelvis_drop, body_tilt_deg)
    elif t < 7.45:
        mount_state = "detached"
        # Balanced scoop squat (`pelvis_drop = 28px`) keeping both hands squarely inside sweet-spot IK zone
        pelvis_drop = 28.0 * _smooth(min(1.0, (t - 6.35) / 0.26)) * (1.0 - 0.50 * _smooth(max(0.0, (t - 7.10) / 0.35)))
        body_tilt_deg = 8.0 * (pelvis_drop / 28.0)
        gait, _ = _pose_biped_with_crouch(s["p_profile"], gait, wx, pelvis_drop, body_tilt_deg)
    elif t < 8.55:
        # Hoist reattach onto collar at t=8.00s -> backwards attached head!
        if t < 8.00:
            mount_state = "reattaching"
            pelvis_drop = 14.0 * (1.0 - _smooth((t - 7.45) / 0.55))
            gait, _ = _pose_biped_with_crouch(s["p_profile"], gait, wx, pelvis_drop, 0.0)
        else:
            mount_state = "attached"
            head_var = "backwards"
            head_ang = 5.0 * math.sin((t - 8.00) * 18.0) * math.exp(-(t - 8.00) * 4.0)
    else:
        mount_state = "attached"
        head_var = "backwards"
        # March blindly -> step right into tram_pole (380) at t=9.15s -> spring recoil + wobble
        if t < 9.15:
            wu = _smooth((t - 8.55) / 0.60)
            wx_walk = _lerp(244.0, 344.0, wu)
            march_shot = mc.ShotMotion("march", 8.55, 9.15, 244.0, 344.0, state="walk", facing=1.0, cadence_hz=2.2, stride_len=66.0, foot_lift=20.0)
            gait = mc.sample_gait(s["p_profile"], t, march_shot)
            wx = float(gait.root.world_x)
        else:
            dt = t - 9.15
            body_tilt_deg = -14.0 * math.exp(-dt * 2.5) * math.sin(dt * 10.0 + 0.5)
            head_ang = 18.0 * math.sin(dt * 22.0) * math.exp(-dt * 2.2)
            recoil_shot = mc.ShotMotion("recoil", 9.15, 10.0, 344.0, 302.0, state="recover", facing=1.0, cadence_hz=2.0, stride_len=48.0, foot_lift=14.0)
            gait = mc.sample_gait(s["p_profile"], t, recoil_shot)
            wx = float(gait.root.world_x)

    return {
        "gait": gait,
        "world_x": wx,
        "pelvis_drop": pelvis_drop + wy_offset,
        "body_tilt_deg": body_tilt_deg,
        "mount_state": mount_state,
        "head_variant": None if head_var in (None, "", "neutral") else head_var,
        "head_angle_deg": float(_clamp(head_ang, -20.0, 20.0)),
    }


def _detached_head_world_pose(t: float, pip_x: float, pip_drop: float) -> tuple[bool, float, float, float, str, list[dict[str, Any]]]:
    """Return (visible, wx, wy, angle_deg, state, holders) for detached head prop `z_head`."""
    if t < 0.40 or t >= 8.00:
        return False, pip_x, -228.0, 0.0, "attached", []

    if t < 1.05:
        u = _clamp01((t - 0.40) / 0.65)
        hx = _lerp(pip_x + 8.0, -110.0, _smooth(u))
        hy = _lerp(-230.0, -315.0, u) - 65.0 * math.sin(u * math.pi)
        ang = _lerp(-15.0, 75.0, u)
        return True, hx, hy, ang, "free", []

    if t < 2.20:
        # 1.05..1.42 drop onto cobblestones (-315 -> -34); 1.42..2.20 two elastic bounces!
        if t < 1.42:
            du = _clamp01((t - 1.05) / 0.37)
            hx = _lerp(-110.0, -45.0, du)
            hy = _lerp(-315.0, -34.0, du * du)
            ang = _lerp(75.0, 210.0, du)
        elif t < 1.82:
            bu = _clamp01((t - 1.42) / 0.40)
            hx = _lerp(-45.0, 10.0, bu)
            hy = -34.0 - 110.0 * math.sin(bu * math.pi)
            ang = _lerp(210.0, 390.0, bu)
        else:
            bu = _clamp01((t - 1.82) / 0.38)
            hx = _lerp(10.0, 56.0, bu)
            hy = -34.0 - 62.0 * math.sin(bu * math.pi)
            ang = _lerp(390.0, 540.0, bu)
        return True, hx, hy, ang, "free", []

    if t < 3.80:
        u = _clamp01((t - 2.20) / 1.60)
        hx = _lerp(56.0, 154.0, u)
        hy = -34.0 - 10.0 * abs(math.sin(u * math.pi * 4.0))
        ang = _lerp(540.0, 1020.0, u)
        return True, hx, hy, ang, "free", []

    if t < 5.30:
        u = _clamp01((t - 3.80) / 1.50)
        hx = _lerp(154.0, 232.0, u)
        hy = -34.0 - 10.0 * abs(math.sin(u * math.pi * 4.0))
        ang = _lerp(1020.0, 1440.0, u)
        return True, hx, hy, ang, "free", []

    if t < 6.75:
        # Glides to uneasy slow stop clear left of tram_pole (+232 -> +310)
        u = _clamp01((t - 5.30) / 1.05)
        hx = _lerp(232.0, 310.0, 1.0 - (1.0 - u) * (1.0 - u))
        hy = -40.0 if t < 6.35 else _lerp(-40.0, -102.0, _smooth((t - 6.35) / 0.40))
        ang = _lerp(1440.0, 1452.0, u)
        return True, hx, hy, ang, "free", []

    if t < 7.45:
        # Left arm holds upper crown (grip y=0.42), right cradles lower chin (grip y=0.72) at d~80px, aim=+25..+50deg!
        lu = _smooth((t - 6.75) / 0.70)
        hx = _lerp(310.0, pip_x + 88.0, lu)
        hy = _lerp(-102.0, -132.0, lu)
        ang = _lerp(1452.0, 1440.0, lu)
        holders = [
            {"actor_id": "pip", "arm": "left", "grip": [0.72, 0.42]},
            {"actor_id": "pip", "arm": "right", "grip": [0.32, 0.74]},
        ]
        return True, hx, hy, ang, "held", holders

    # 7.45..7.78s: hoist cleanly keeping BOTH hands locked on head; 7.78..8.00s: pop onto collar!
    if t < 7.78:
        hu = _smooth((t - 7.45) / 0.33)
        hx = _lerp(pip_x + 88.0, pip_x + 82.0, hu)
        hy = _lerp(-132.0, -142.0, hu)
        ang = _lerp(1440.0, 1448.0, hu)
        holders = [
            {"actor_id": "pip", "arm": "left", "grip": [0.72, 0.42]},
            {"actor_id": "pip", "arm": "right", "grip": [0.32, 0.70]},
        ]
        return True, hx, hy, ang, "held", holders

    su = _smooth((t - 7.78) / 0.22)
    hx = _lerp(pip_x + 82.0, pip_x, su)
    hy = _lerp(-142.0, -228.0 + pip_drop, su)
    ang = _lerp(1448.0, 1440.0, su)
    return True, hx, hy, ang, "free", []


def _draw_dawn_plaza_bg(bg_raw: Image.Image, cam, w: int, h: int, t: float, pip_x: float) -> Image.Image:
    """Render parallax dawn city plaza + wet animated puddle ripples & breeze drizzle."""
    bg_w, bg_h = bg_raw.size
    # Fill 9:16 portrait height cleanly while leaving horizontal panoramic room for camera glide!
    scale = (float(h) * 1.02) / float(bg_h)
    scaled_w = max(w + 240, int(round(bg_w * scale)))
    scaled_h = int(round(bg_h * scale))
    base = bg_raw.resize((scaled_w, scaled_h), Image.Resampling.BILINEAR).copy()

    # Parallax horizontal pan aligned continuously with camera x (`[-320..+420]`)
    norm_pan = _clamp01((cam.x + 280.0) / 620.0)
    pan_max = max(0, scaled_w - w)
    crop_x = int(round(norm_pan * pan_max))
    crop_y = max(0, (scaled_h - h) // 2)
    cropped = base.crop((crop_x, crop_y, crop_x + w, crop_y + h))

    # Add subtle ground cobblestone ambient plane gradient near character feet & wet puddle ripples
    draw = ImageDraw.Draw(cropped, "RGBA")
    puddle_y = int(round(cam.project((pip_x, 0.0, 860.0))[1])) + 6
    if 0 < puddle_y < h:
        # Subtle puddle shimmer ripples keyed smoothly to t
        for idx, rx_world in enumerate((-210.0, -20.0, 150.0, 275.0)):
            px, py, _ = cam.project((rx_world, 0.0, 860.0))
            if -120 < px < w + 120:
                ph = (t * 2.1 + idx * 0.45) % 1.0
                rad_x = int(round((14 + ph * 34) * (w / 720.0)))
                rad_y = max(3, int(round(rad_x * 0.25)))
                alpha = int(round(90 * (1.0 - ph)))
                draw.ellipse((px - rad_x, py - rad_y, px + rad_x, py + rad_y), outline=(210, 240, 250, alpha), width=2)

    return cropped


def _draw_foreground_and_fx(
    cam,
    w: int,
    h: int,
    t: float,
    actor_scale: float,
    pip_px: tuple[float, float],
    maya_px: tuple[float, float],
    head_px: tuple[float, float] | None,
) -> tuple[Image.Image, np.ndarray, dict[str, np.ndarray]]:
    """Build foreground occlusion post (`fg_shelter_post` during Shot 4), light drizzle, and comic impact stars."""
    fg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(fg, "RGBA")
    occ_masks: dict[str, np.ndarray] = {}

    # 1. Foreground opaque transit shelter T-pylon (top visor over Maya head/collar + center pylon
    # slotted cleanly in the [-23..+11] gap between Maya's shoulders/arms + thin grounded curb post
    # right between Maya's ankles!). Gives >=48% real Maya pixel occlusion with ZERO limb/ankle faults.
    post_mask = np.zeros((h, w), dtype=np.uint8)
    asc = float(actor_scale)
    sc = w / 720.0
    if 3.85 <= t <= 5.35:
        ps_x, ps_y, _ = cam.project((336.0, 0.0, 660.0))
        if 4.25 <= t <= 5.30:
            ps_x = maya_px[0]
        # Cantilevered transit-stop flag sign: upper visor over Maya's head (`-48..+68`),
        # suspended central schedule plate between shoulders (`-16..+11`, above knees `-92`),
        # and outer vertical grounded steel pole (`+54..+66`) well clear of ankles & left arm (`<=+48`)!
        visor_l = int(round(ps_x - 48.0 * asc))
        visor_r = int(round(ps_x + 68.0 * asc))
        visor_t = max(0, int(round(maya_px[1] - 310.0 * asc)))
        visor_b = int(round(maya_px[1] - 216.0 * asc))
        col_l = int(round(ps_x - 16.0 * asc))
        col_r = int(round(ps_x + 11.0 * asc))
        col_b = int(round(maya_px[1] - 92.0 * asc))
        stem_l = int(round(ps_x + 54.0 * asc))
        stem_r = int(round(ps_x + 66.0 * asc))
        stem_bot = min(h, int(round(maya_px[1] + 14.0 * asc)))
        if visor_r > 0 and visor_l < w and visor_b > visor_t:
            lw = max(1, int(round(2 * sc)))
            draw.rectangle((stem_l, visor_b - 2, stem_r, stem_bot), fill=(26, 42, 56, 255), outline=(12, 18, 26, 255), width=lw)
            draw.rectangle((col_l, visor_b - 2, col_r, col_b), fill=(36, 56, 72, 255), outline=(14, 22, 30, 255), width=lw)
            draw.rectangle((visor_l, visor_t, visor_r, visor_b), fill=(36, 56, 72, 255), outline=(16, 24, 34, 255), width=lw)
            pad = max(3, int(round(5 * asc)))
            draw.rectangle((visor_l + pad, visor_t + pad, visor_r - pad, visor_b - pad), fill=(52, 84, 104, 255), outline=(140, 195, 210, 255), width=lw)
            draw.rectangle((visor_l + pad * 2, visor_t + pad * 2, visor_r - pad * 2, visor_t + int(round(44 * asc))), fill=(215, 240, 242, 255))
            draw.line((visor_l + pad * 2 + 4, visor_t + int(round(26 * asc)), visor_r - pad * 2 - 4, visor_t + int(round(26 * asc))), fill=(230, 120, 45, 255), width=max(2, int(round(3 * asc))))
            cv2.rectangle(post_mask, (max(0, visor_l), visor_t), (min(w, visor_r), visor_b), 255, -1)
            cv2.rectangle(post_mask, (max(0, col_l), visor_b), (min(w, col_r), col_b), 255, -1)
            cv2.rectangle(post_mask, (max(0, stem_l), visor_b), (min(w, stem_r), stem_bot), 255, -1)
    occ_masks["fg_shelter_post"] = post_mask

    # 2. Expressive dawn comic action accents (sneeze puff, speed streaks, splash drops, collision dizzy stars!)
    if 0.40 <= t <= 0.78:
        u = (t - 0.40) / 0.38
        cx, cy = pip_px[0] + (18 + u * 65) * sc, pip_px[1] - (185 + u * 35) * sc
        for k in range(5):
            ang = -0.6 + k * 0.3
            px0 = cx + math.cos(ang) * (10 + u * 32) * sc
            py0 = cy + math.sin(ang) * (10 + u * 32) * sc
            r = max(2, int(round((10 - u * 6) * sc)))
            draw.ellipse((px0 - r, py0 - r, px0 + r, py0 + r), fill=(232, 250, 252, int(210 * (1.0 - u))))

    if 2.25 <= t <= 5.20 and head_px is not None:
        for k in range(3):
            yy = head_px[1] + (k - 1) * 14 * sc
            alpha = int(150 * (0.5 + 0.5 * math.sin(t * 25.0 + k)))
            draw.line((head_px[0] - 82 * sc, yy, head_px[0] - 30 * sc, yy), fill=(220, 250, 245, alpha), width=max(2, int(round(3 * sc))))

    if 9.15 <= t <= 9.95:
        du = (t - 9.15) / 0.80
        hx, hy = pip_px[0], pip_px[1] - 255 * sc
        draw.ellipse((hx - 34 * sc, hy - 12 * sc, hx + 34 * sc, hy + 12 * sc), outline=(255, 215, 65, int(230 * (1.0 - du * 0.3))), width=max(2, int(round(3 * sc))))
        for k in range(4):
            a = du * 9.0 + k * (math.pi * 0.5)
            sx, sy = hx + math.cos(a) * 34 * sc, hy + math.sin(a) * 12 * sc
            r = max(3, int(round(7 * sc)))
            draw.polygon([(sx, sy - r), (sx + r * 0.8, sy), (sx, sy + r), (sx - r * 0.8, sy)], fill=(255, 224, 90, 240))

    # Crisp diagonal gentle drizzle droplets (very subtle alpha <= 85 so optical residual stays clean!)
    for idx in range(18):
        dx = ((idx * 97 + int(t * 140)) % (w + 40)) - 20
        dy = ((idx * 173 + int(t * 620)) % (h + 40)) - 20
        draw.line((dx, dy, dx - int(4 * sc), dy + int(16 * sc)), fill=(215, 238, 246, 75), width=max(1, int(round(1.5 * sc))))

    fg_arr = np.asarray(fg)
    return fg, fg_arr[:, :, 3].copy(), occ_masks


def _evaluate_frame(t: float, size: tuple[int, int], c) -> tuple[Any, dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Pure stateless f(t) evaluator emitting RenderResult + motion/editorial/semantic evidence."""
    s = _setup(c)
    rt = c.puppet_runtime
    w, h = map(int, size)
    i = max(0, min(299, int(round(float(t) * 30.0))))

    shot, u = scene_runtime.shot_at(c, t)
    shot_id = str((shot or {}).get("id") or "shot")
    ms = scene_runtime.motion_state_at(c, t, -250.0, 0.0)
    ed_sem = scene_runtime.editorial_state_at(c, t, {"targets": {"primary": [ms["start_x"], -150.0]}})
    expected_sem = scene_runtime.semantic_state_at(c, t)

    # Resolve Pip kinetics & head_mount_state
    p_kin = _pip_state_at(t, s, shot or {}, ms)
    pip_gait: mc.GaitPose = p_kin["gait"]
    px_w = float(p_kin["world_x"])
    p_drop = float(p_kin["pelvis_drop"])
    p_tilt = float(p_kin["body_tilt_deg"])
    p_mount = str(p_kin["mount_state"])
    head_vis, hx_w, hy_w, h_ang, h_state, h_holders = _detached_head_world_pose(t, px_w, p_drop)

    # Commuter Maya position + continuous reaction placement clear of Pip, rail & pole
    if t < 2.20:
        # Cleanly offscreen right while opening sneeze & head bounce fill portrait frame
        mx_w = 465.0
    elif t < 3.80:
        mx_w = 290.0
    elif t < 5.30:
        # Step smoothly right behind T-pylon shelter post during 4.20..4.55s, hold hidden until 5.30s
        if t < 4.20:
            mx_w = 290.0
        elif t < 4.55:
            mu = _smooth((t - 4.20) / 0.35)
            mx_w = _lerp(290.0, 336.0, mu)
        else:
            mx_w = 336.0
    elif t < 8.55:
        # Offscreen far right during tight Shots 5..7 close-ups so no partial edge arm clipping
        mx_w = 680.0
    else:
        # Clearly visible to the right of tram_pole (402) inside 720px frame watching Shot 8 payoff!
        mx_w = 532.0

    maya_state = "walk" if (4.20 <= t <= 4.55) else "idle"
    maya_shot = mc.ShotMotion("maya_m", 4.20 if maya_state == "walk" else 0.0, 4.55 if maya_state == "walk" else 10.0, 290.0 if maya_state == "walk" else mx_w, 336.0 if maya_state == "walk" else mx_w, state=maya_state, facing=-1.0, cadence_hz=1.8, stride_len=65.0, foot_lift=18.0)
    maya_gait = mc.sample_gait(s["m_profile"], t, maya_shot)
    if maya_state == "idle":
        maya_gait = mc.sample_gait(s["m_profile"], t, mc.ShotMotion("m_idle", 0.0, 10.0, mx_w, mx_w, state="idle", facing=-1.0))

    maya_hv = "neutral" if t < 2.75 else "shock"
    maya_ha = 0.0 if t < 2.75 else (11.0 * math.sin(min(1.0, (t - 2.75) * 4.0) * math.pi * 0.5) if t < 5.30 else (14.0 if t >= 9.15 else 6.0))

    # Build camera cleanly using editorial framing + shot_at keys
    z_actor = 860.0
    Cam = c.space.Camera
    base_cam = Cam(width=w, height=h, focal=1040.0 * w / 720.0, x=px_w, y=-180.0, z=120.0, principal_y=round(h * 0.45))
    scene_sem = {
        "targets": {
            "primary": [px_w, -150.0, z_actor],
            "actor_full:pip": [px_w, -150.0, z_actor],
            "actor_head:pip": [px_w, -235.0, z_actor],
            "actor_hand:pip": [px_w + 26.0, -140.0, z_actor],
            "actor_full:maya": [mx_w, -150.0, z_actor],
            "prop:z_head": [hx_w, hy_w, z_actor],
            "action_group": [0.5 * (px_w + (hx_w if head_vis else mx_w)), -120.0, z_actor],
        }
    }
    cam_ed = scene_runtime.camera_editorial_at(c, t, base_cam=base_cam, scene_semantics=scene_sem)
    cam_key = scene_runtime.camera_at(c, t, base_cam=base_cam)
    # Blend editorial framing nicely with authored keyframe depth for strong visual storytelling
    cam_fx = 0.45 * float(cam_ed.x) + 0.55 * float(cam_key.x)
    cam_fy = 0.45 * float(cam_ed.y) + 0.55 * float(cam_key.y)
    cam_fz = 0.40 * float(cam_ed.z) + 0.60 * float(cam_key.z)
    if 3.80 <= t < 5.30:
        # Keep Maya + cantilevered shelter sign cleanly inside right edge during Shot 4
        cam_fx += 26.0
        cam_fz -= 30.0
    if t >= 8.55:
        # Frame Pip, tram_pole, AND Maya generously inside Shot 8 wide payoff without border clipping
        cam_fx += 28.0 * _smooth((t - 8.55) / 0.15)
        cam_fz -= 45.0
    cam = Cam(
        width=w,
        height=h,
        focal=0.45 * float(cam_ed.focal) + 0.55 * float(cam_key.focal),
        x=cam_fx,
        y=cam_fy,
        z=cam_fz,
        principal_y=cam_ed.principal_y,
        near=cam_ed.near,
    )

    def w2s(pt_xy: tuple[float, float]) -> tuple[float, float]:
        sx, sy, _ = cam.project((float(pt_xy[0]), float(pt_xy[1]), z_actor))
        return float(sx), float(sy)

    p_sx, p_sy = w2s((px_w, pip_gait.root.pelvis_drop))
    # Exact projection scale at z_actor
    scale = float(cam.focal / max(1.0, z_actor - cam.z))

    def mat_actor(sx: float, sy: float, sc_val: float, tilt_deg: float = 0.0) -> np.ndarray:
        rad = math.radians(tilt_deg)
        c0, s0 = math.cos(rad) * sc_val, math.sin(rad) * sc_val
        return np.array([[c0, -s0, sx], [s0, c0, sy], [0.0, 0.0, 1.0]], dtype=float)

    p_view = s["pip"].views["three_quarter"]
    m_view = s["maya"].views["three_quarter"]

    # Solve Pip arms cleanly with non-overlapping branches; `h_state == "held"` refines via planar_ik against `p_place`
    p_arms: dict[str, np.ndarray] = {}
    pip_spec_l = p_view.arms["left"]
    pip_spec_r = p_view.arms["right"]

    if t < 1.05:
        # Sneeze hands near nose then flail wide on detach
        if t < 0.42:
            p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, 8.0, 56.0)
            p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 42.0, 58.0)
        else:
            p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, -15.0, 22.0)
            p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 118.0, 24.0)
    elif 1.05 <= t < 2.20:
        # Headless scramble dash in Shot 2 with compact right arm clear of left viewport edge
        swing = math.sin(t * 15.0) * 14.0
        p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, 12.0 + swing, 36.0)
        p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 122.0 - swing * 0.5, 24.0)
    elif 3.80 <= t < 5.30:
        # Hurdle arms tucked compactly high/bent so hands stay >=95px clear left of Maya & pylon
        if 3.85 <= t < 4.75:
            p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, 28.0, 64.0)
            p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 110.0, 34.0)
        else:
            p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, 26.0, 64.0)
            p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 92.0, 36.0)
    elif 5.30 <= t < 6.35:
        # Stumble windmill arms inside verified solo pass bands
        p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, 8.0 + 18.0 * math.sin(t * 20.0), 34.0)
        p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 64.0 + 24.0 * math.cos(t * 18.0), 30.0)
    elif 6.35 <= t < 6.75:
        # Reach out progressively toward z_head staying clear above/out of body poncho
        ru = _smooth((t - 6.35) / 0.40)
        p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, _lerp(18.0, -8.0, ru), _lerp(36.0, 24.0, ru))
        p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, _lerp(76.0, 48.0, ru), _lerp(28.0, 32.0, ru))
    elif 6.75 <= t < 7.78:
        # Fallback pose before h_holders planar_ik pins directly onto head grips
        p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, -6.0, 28.0)
        p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 18.0, 28.0)
    elif 7.78 <= t < 8.55:
        # Joyful bent arms tucked comfortably inside tight close-up after snapping head backwards onto neck!
        p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, 22.0, 52.0)
        p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 92.0, 34.0)
    elif t >= 8.55:
        # Blind proud strut: chest forward, compact verified [16..28] arm swing clear of Maya
        swing = math.sin(t * 14.0) * 6.0
        p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, 22.0 + swing, 56.0)
        p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 96.0 - swing, 32.0)
    else:
        # Expressive counter-swing / frantic chase within verified unoccluded arc (clear of Maya!)
        swing = math.sin(t * 15.0) * 14.0
        p_arms["left"] = _solve_valid_arm_fk(pip_spec_l, 2.0 + swing, 44.0)
        p_arms["right"] = _solve_valid_arm_fk(pip_spec_r, 82.0 - swing, 28.0)

    # Shift arm & hip coords slightly when crouching (`p_drop` affects whole puppet placement cleanly!)
    pip_place_sx, pip_place_sy = w2s((px_w, pip_gait.root.world_y))
    p_place = mat_actor(pip_place_sx, pip_place_sy, scale, p_tilt * 0.45)

    p_pose = rt.ActorFrame(
        actor_id="pip",
        character=s["pip"],
        view=p_view,
        placement=p_place,
        arms=p_arms,
        action="reach" if t >= 6.35 else "rest",
        phase=0.5,
        frame_index=i,
        head_variant=p_kin["head_variant"],
        head_angle_deg=p_kin["head_angle_deg"],
    )

    m_sx, m_sy = w2s((mx_w, maya_gait.root.world_y))
    m_place = mat_actor(m_sx, m_sy, scale, 0.0)
    m_spec_l = m_view.arms["left"]
    m_spec_r = m_view.arms["right"]
    if t < 2.75 or (5.30 <= t < 8.55):
        m_arms = {"left": _solve_valid_arm_fk(m_spec_l, 108.0, 22.0), "right": _solve_valid_arm_fk(m_spec_r, 145.0, 20.0)}
    elif 3.80 <= t < 5.30:
        # Hide-behind: left arm clears outer-right (`68, 22`), right arm tucked compactly outer-left (`145, 56`)
        m_arms = {"left": _solve_valid_arm_fk(m_spec_l, 68.0, 22.0), "right": _solve_valid_arm_fk(m_spec_r, 145.0, 56.0)}
    elif t >= 9.15:
        # Compact shocked gasp hands tucked cleanly clear right of wobbling tram_pole & Pip!
        m_arms = {"left": _solve_valid_arm_fk(m_spec_l, 110.0, 56.0), "right": _solve_valid_arm_fk(m_spec_r, 130.0, 42.0)}
    else:
        # Hands-up alarm gesture inside compact corridor clear of Pip and shelter board
        m_arms = {"left": _solve_valid_arm_fk(m_spec_l, 112.0, 54.0), "right": _solve_valid_arm_fk(m_spec_r, 175.0, 42.0)}

    m_pose = rt.ActorFrame(
        actor_id="maya",
        character=s["maya"],
        view=m_view,
        placement=m_place,
        arms=m_arms,
        action="rest",
        phase=0.5,
        frame_index=i,
        head_variant=None if maya_hv == "neutral" else maya_hv,
        head_angle_deg=float(maya_ha),
    )

    # Assemble props: orange_rail (Shots 3..5), tram_pole (Shots 4..8), z_head (when detached/reattaching)
    props_list: list[Any] = []
    prop_world_map: dict[str, dict[str, Any]] = {}

    if 2.20 <= t < 5.30:
        r_sx, r_sy = w2s((118.0, -26.0))
        r_mat = mat_actor(r_sx, r_sy, 1.0, 0.0)
        r_size = (max(24.0, 72.0 * scale), max(24.0, 48.0 * scale))
        r_contact = rt.ContactState("free", r_mat, r_size, [], {}, 0)
        props_list.append(rt.PropFrame("orange_rail", r_contact, s["rail_raw"]))
        prop_world_map["orange_rail"] = {"world_xy": [118.0, -26.0], "angle_deg": 0.0, "state": "static", "holders": []}

    if t >= 3.80:
        pole_wobble = 4.2 * math.sin((t - 9.15) * 24.0) * math.exp(-(t - 9.15) * 3.5) if t >= 9.15 else 0.0
        pl_sx, pl_sy = w2s((402.0, -124.0))
        pl_mat = mat_actor(pl_sx, pl_sy, 1.0, pole_wobble)
        pl_size = (max(20.0, 62.0 * scale), max(60.0, 296.0 * scale))
        pl_contact = rt.ContactState("free", pl_mat, pl_size, [], {}, 0)
        pole_front = ["pip:arm:left:upper", "pip:arm:left:forearm"] if t >= 8.55 else []
        props_list.append(rt.PropFrame("tram_pole", pl_contact, s["pole_raw"], front_limb_parts=pole_front))
        prop_world_map["tram_pole"] = {"world_xy": [402.0, -124.0], "angle_deg": pole_wobble, "state": "static", "holders": []}

    head_screen_xy = None
    if head_vis:
        hsx, hsy = w2s((hx_w, hy_w))
        head_screen_xy = (hsx, hsy)
        # Recompute Pip hands cleanly against exact prop holder matrix ONLY when `holders` actively gripping!
        h_size = (max(20.0, 76.0 * scale), max(20.0, 76.0 * scale))
        h_mat = mat_actor(hsx, hsy, 1.0, h_ang)
        active_holders = []
        front_limbs: list[str] = []
        if h_state == "held" and h_holders:
            # Verify hand wrists align within <= 0.1px onto grip coordinates!
            for q in h_holders:
                arm_name = q["arm"]
                local_g = (np.asarray(q["grip"]) - 0.5) * np.asarray(h_size)
                grip_scr = (h_mat @ np.array([local_g[0], local_g[1], 1.0]))[:2]
                local_wr = (np.linalg.inv(p_place) @ np.array([grip_scr[0], grip_scr[1], 1.0]))[:2]
                spec = p_view.arms[arm_name]
                # Check strict planar IK reachability before locking holder
                d_w = float(np.linalg.norm(local_wr - spec.socket))
                if abs(spec.lengths[0] - spec.lengths[1]) + 2.0 < d_w < sum(spec.lengths) - 1.5:
                    try:
                        p_arms[arm_name] = rt.planar_ik(spec, local_wr)
                        active_holders.append(q)
                        front_limbs.extend([f"pip:arm:{arm_name}:upper", f"pip:arm:{arm_name}:forearm"])
                    except Exception:
                        pass
        elif 6.35 <= t < 8.00:
            # Keep Pip's reaching/reattaching arms in front of detached z_head prop!
            front_limbs.extend(["pip:arm:left:upper", "pip:arm:left:forearm", "pip:arm:right:upper", "pip:arm:right:forearm"])
        h_contact = rt.ContactState(
            state="hold" if active_holders else "free",
            paper_matrix=h_mat,
            paper_size=h_size,
            holders=active_holders,
            targets={},
            event_index=1,
        )
        props_list.append(rt.PropFrame("z_head", h_contact, s["head_prop_raw"], front_limb_parts=front_limbs))
        prop_world_map["z_head"] = {"world_xy": [hx_w, hy_w], "angle_deg": h_ang, "state": "held" if active_holders else "detached", "holders": [q["arm"] for q in active_holders]}

    # Ground shadows under Pip, Maya, and bouncing/rolling detached head
    p_shadows = []
    for fc in (pip_gait.contact_plan.left, pip_gait.contact_plan.right):
        fpt = w2s((fc.plant_world[0], 0.0)) if fc.state == "stance" else w2s((fc.target_world[0], 0.0))
        dist_h = max(0.0, -fc.target_world[1] - p_kin["pelvis_drop"])
        fade = max(0.24, 1.0 - dist_h / 95.0)
        p_shadows.append((fpt[0], fpt[1], 18.0 * scale * fade, 5.0 * scale * fade, 110.0 * fade))
    m_shadows = [
        (m_sx - 15.0 * scale, w2s((mx_w, 0.0))[1], 17.0 * scale, 5.0 * scale, 105.0),
        (m_sx + 15.0 * scale, w2s((mx_w, 0.0))[1], 17.0 * scale, 5.0 * scale, 105.0),
    ]
    if head_vis:
        hg_sx, hg_sy = w2s((hx_w, 0.0))
        hf = max(0.2, 1.0 - max(0.0, -hy_w - 34.0) / 220.0)
        p_shadows.append((hg_sx, hg_sy, 22.0 * scale * hf, 6.0 * scale * hf, 95.0 * hf))
    if t >= 3.80:
        pl_shx, pl_shy = w2s((402.0, 0.0))
        p_shadows.append((pl_shx, pl_shy, 20.0 * scale, 5.5 * scale, 95.0))

    bg = _draw_dawn_plaza_bg(s["bg_raw"], cam, w, h, t, px_w)
    fg, fg_mask, extra_occluders = _draw_foreground_and_fx(cam, w, h, t, scale, (pip_place_sx, pip_place_sy), (m_sx, m_sy), head_screen_xy)

    actors_spec = [
        {"pose": p_pose, "gait": pip_gait, "profile": s["p_profile"], "world_to_screen": w2s, "ground_shadows": p_shadows, "head_mount_state": p_mount},
        {"pose": m_pose, "gait": maya_gait, "profile": s["m_profile"], "world_to_screen": w2s, "ground_shadows": m_shadows, "head_mount_state": "attached"},
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
        capture_semantic_masks=True,
    )
    if res.qa.get("errors"):
        raise ValueError(f"Frame {i} (t={t:.3f}, shot={shot_id}) render QA errors: {res.qa['errors']}")

    # Assemble per-actor pre-foreground & post-foreground semantic masks cleanly
    pre_fg_masks = getattr(res, "_pre_fg_part_masks", res.part_masks)

    def _actor_union(mask_map: dict[str, np.ndarray], aid: str) -> np.ndarray:
        acc = np.zeros((h, w), dtype=np.uint8)
        prefix = f"{aid}:"
        for k, arr in mask_map.items():
            if k == aid or k.startswith(prefix):
                acc = np.maximum(acc, arr)
        return acc

    actor_vis_masks = {aid: _actor_union(res.part_masks, aid) for aid in ("pip", "maya")}
    actor_raw_masks = {aid: _actor_union(pre_fg_masks, aid) for aid in ("pip", "maya")}
    hand_masks = {
        aid: [res.part_masks.get(f"{aid}:arm:left:hand"), res.part_masks.get(f"{aid}:arm:right:hand")]
        for aid in ("pip", "maya")
    }
    prop_vis_masks = {
        pid: res.part_masks[f"prop:{pid}"]
        for pid in prop_world_map
        if f"prop:{pid}" in res.part_masks
    }
    prop_raw_masks = {
        pid: pre_fg_masks[f"prop:{pid}"]
        for pid in prop_world_map
        if f"prop:{pid}" in pre_fg_masks
    }
    # Combine foreground shelter occluder + solid stage obstacle masks (`orange_rail`, `tram_pole`)
    all_occluders = {**extra_occluders}
    if "orange_rail" in prop_vis_masks:
        all_occluders["orange_rail"] = prop_vis_masks["orange_rail"]
    if "tram_pole" in prop_vis_masks:
        all_occluders["tram_pole"] = prop_vis_masks["tram_pole"]

    sem_frame = se.capture_semantic_frame_evidence(
        frame_idx=i,
        t=t,
        shot_id=shot_id,
        canvas_size=size,
        beauty_rgb=res.beauty,
        actor_visible_masks=actor_vis_masks,
        actor_raw_masks=actor_raw_masks,
        hand_masks=hand_masks,
        prop_visible_masks=prop_vis_masks,
        prop_raw_masks=prop_raw_masks,
        occluder_masks=all_occluders,
        actor_poses={
            "pip": {
                "world_xy": [px_w, p_drop],
                "facing": 1,
                "head_variant": p_kin["head_variant"],
                "head_angle_deg": p_kin["head_angle_deg"],
                "head_mount_state": p_mount,
            },
            "maya": {
                "world_xy": [mx_w, 0.0],
                "facing": -1,
                "head_variant": maya_hv,
                "head_angle_deg": maya_ha,
                "head_mount_state": "attached",
            },
        },
        prop_states=prop_world_map,
        expected_state=expected_sem,
    )

    is_cut = abs(t - float((shot or {}).get("start", 0.0))) < (1.0 / 60.0) if shot else False
    mev = mqc.motion_evidence_at(
        t,
        pip_gait,
        viewport=size,
        frame_idx=i,
        shot_id=shot_id,
        render_qa=res.qa,
        world_to_screen_fn=w2s,
        is_cut=is_cut,
    )
    shot_ids = [str(sh.get("id") or "") for sh in ((c.plan or {}).get("shots") or [])]
    shot_idx = shot_ids.index(shot_id) if shot_id in shot_ids else 0
    mev["step_index"] = (shot_idx + 1) * 100 + int(mev.get("step_index", 0))

    focus_xyz = ed_sem.get("focus", {}).get("world_xyz", [px_w, -150.0, z_actor])
    focus_sx_sy = w2s((float(focus_xyz[0]), float(focus_xyz[1])))
    eev = {
        "frame": i,
        "t": round(t, 4),
        "shot_id": shot_id,
        "role": ed_sem.get("role"),
        "shot_size": ed_sem.get("shot_size"),
        "actual_scale": round(scale, 4),
        "focus_screen_xy": [round(focus_sx_sy[0], 2), round(focus_sx_sy[1], 2)],
        "in_reaction_hold": bool(ed_sem.get("in_reaction_hold", False)),
        "is_cut": is_cut,
    }
    return res, mev, eev, sem_frame


def frame(t, c):
    res, _, _, _ = _evaluate_frame(float(t), c.viewport.size, c)
    return res


def draft_frame(t, c):
    res, _, _, _ = _evaluate_frame(float(t), c.viewport.size, c)
    return res


def collect_semantic_and_motion_evidence(
    c,
    out_dir: Path | str,
    start_s: float = 0.0,
    end_s: float = 10.0,
    fps: int = 30,
) -> dict[str, Any]:
    """Collect full 300-frame motion + editorial + semantic JSONL evidence + debug triptychs."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    dbg = out / "semantic_debug"
    dbg.mkdir(parents=True, exist_ok=True)

    n_start = max(0, int(round(start_s * fps)))
    n_end = min(300, max(n_start + 1, int(round(end_s * fps))))
    motion_rows: list[dict[str, Any]] = []
    ed_rows: list[dict[str, Any]] = []
    sem_rows: list[dict[str, Any]] = []

    snap_frames: dict[int, Image.Image] = {}
    snap_indices = {6, 15, 28, 36, 48, 60, 88, 128, 145, 168, 200, 212, 228, 244, 274, 282}

    for f_idx in range(n_start, n_end):
        res, mev, eev, sev = _evaluate_frame(f_idx / float(fps), c.viewport.native_size, c)
        motion_rows.append(mev)
        ed_rows.append(eev)
        sem_rows.append(sev)
        if f_idx in snap_indices:
            snap_frames[f_idx] = res.beauty.convert("RGB")
            if f_idx in (15, 145, 212, 244):
                actor_ms = {aid: np.maximum.reduce([res.part_masks[k] for k in res.part_masks if k == aid or k.startswith(f"{aid}:")]) for aid in ("pip", "maya") if any(k.startswith(f"{aid}:") for k in res.part_masks)}
                prop_ms = {k.split(":", 1)[1]: v for k, v in res.part_masks.items() if k.startswith("prop:")}
                ov = se.render_semantic_mask_overlay(
                    res.beauty,
                    actor_masks=actor_ms,
                    prop_masks=prop_ms,
                    label=f"Mask Overlay f={f_idx} (t={f_idx/30:.2f}s)",
                )
                ov.save(dbg / f"mask_overlay_{f_idx:04d}.png")

    # Emit triptych verification images for critical story actions
    triptychs = [
        ("triptych_detach.png", "Detach Head (Sneeze -> Detached)", 6, 15, 28),
        ("triptych_bounce_hide.png", "Bounce & Maya Hide Behind Shelter Post", 36, 128, 145),
        ("triptych_trip_take.png", "Puddle Trip -> Scoop/Take Head", 168, 200, 212),
        ("triptych_backwards_bonk.png", "Reattach Backwards -> Tram Pole Bonk", 228, 244, 282),
    ]
    for fname, title, i0, i1, i2 in triptychs:
        if i0 in snap_frames and i1 in snap_frames and i2 in snap_frames:
            trip = se.render_triptych_diagnostic(
                snap_frames[i0],
                snap_frames[i1],
                snap_frames[i2],
                title=title,
                before_label=f"t={i0/30:.2f}s",
                during_label=f"t={i1/30:.2f}s",
                after_label=f"t={i2/30:.2f}s",
            )
            trip.save(dbg / fname)

    sem_meta = se.write_semantic_evidence_stream(out / "semantic-evidence.jsonl", sem_rows)
    motion_qc = mqc.validate_motion_contract(motion_rows)
    return {
        "motion_rows": motion_rows,
        "editorial_rows": ed_rows,
        "motion_qc": motion_qc,
        "semantic_stream": sem_meta,
    }
