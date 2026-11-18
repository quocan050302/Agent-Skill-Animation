"""Cowboy slapstick retention short: 'The Cowboy Who Couldn't Catch His Hat' (9:16, 10s, 30fps).

Drives camera, actor staging/expression/arm-actions, stride-envelope legs, and hat
prop keyframes directly through `scene_runtime.py` (`scene-control.json`), layered with
2.5D frontier street parallax, foreground hitching-post/cactus occlusion, dust puffs,
and wind gust ribbons on the B6 Sample-1-calibrated `jesse` puppet rig.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import scene_runtime

_STATE: dict[str, object] = {}


def _smooth(x: float) -> float:
    x = max(0.0, min(1.0, float(x)))
    return x * x * (3.0 - 2.0 * x)


def _setup(c) -> dict[str, object]:
    base = Path(c.base) if getattr(c, "base", None) else Path(__file__).resolve().parent
    key = str(base)
    if _STATE.get("key") == key:
        return _STATE

    bg_raw = Image.open(base / "assets/production/western_wide_bg.png").convert("RGB")
    fg_raw = Image.open(base / "assets/production/western_fg_frame.png").convert("RGBA")
    hat_raw = Image.open(base / "assets/production/cowboy_hat.png").convert("RGBA")
    jesse_puppet = c.puppet_runtime.Puppet(c.character_packages["jesse"], "three_quarter", "jesse")

    _STATE.clear()
    _STATE.update(
        {
            "key": key,
            "bg_raw": bg_raw,
            "fg_raw": fg_raw,
            "hat_raw": hat_raw,
            "jesse": jesse_puppet,
            "prev_shot_id": None,
            "prev_hat_held": False,
        }
    )
    return _STATE


def _native_camera(t: float, c):
    nw, nh = c.viewport.native_size
    base_cam = c.space.Camera(
        width=nw,
        height=nh,
        focal=920.0 * nw / 720.0,
        x=-45.0,
        y=-205.0,
        z=115.0,
        principal_y=round(nh * 0.495),
        near=60.0,
    )
    return scene_runtime.camera_at(c, t, base_cam)


def _norm_arm_action(act: str) -> str:
    if act == "point":
        return "offer"
    if act in ("rest", "reach", "offer", "receive", "retract"):
        return act
    return "rest"


def _draw_wind_streaks(overlay: Image.Image, cam, w: int, h: int, t: float, gust_strength: float, jx: float) -> None:
    if gust_strength <= 0.02:
        return
    draw = ImageDraw.Draw(overlay, "RGBA")
    alpha = int(round(190 * min(1.0, gust_strength)))
    streak_specs = [
        (jx - 110.0, -390.0, 145.0, 0.0),
        (jx - 60.0, -330.0, 170.0, 1.3),
        (jx - 95.0, -250.0, 120.0, 2.7),
    ]
    for sx0, sy0, slen, ph in streak_specs:
        progress = ((t * 2.8 + ph) % 1.0)
        wx0 = sx0 + progress * 220.0
        pts = []
        for step in range(9):
            u = step / 8.0
            px_w = wx0 + u * slen
            py_w = sy0 + math.sin(u * math.pi * 2.0 + t * 8.0 + ph) * 14.0
            sx, sy, _ = cam.project((px_w, py_w, 892.0))
            pts.append((sx, sy))
        if len(pts) >= 2:
            lw = max(2, int(round(3.5 * w / 720.0)))
            draw.line(pts, fill=(252, 245, 224, alpha), width=lw, joint="curve")
            draw.line([(x, y + 2) for x, y in pts], fill=(95, 72, 54, alpha // 2), width=max(1, lw // 2))


def _draw_dust_puffs(overlay: Image.Image, cam, w: int, t: float, puffs: list[tuple[float, float, float, float, float]]) -> None:
    """Draw warm cartoon sand dust puffs (wx, wy, wz, radius_local, alpha01) in 2.5D projected coords."""
    if not puffs:
        return
    draw = ImageDraw.Draw(overlay, "RGBA")
    for wx, wy, wz, rad_local, a01 in puffs:
        if a01 <= 0.02:
            continue
        sx, sy, depth = cam.project((wx, wy, wz))
        k = cam.focal / max(60.0, depth)
        r = max(5.0, rad_local * k)
        alpha = int(round(205 * min(1.0, a01)))
        outline_alpha = int(round(170 * min(1.0, a01)))
        bbox = (sx - r * 1.18, sy - r * 0.86, sx + r * 1.18, sy + r * 0.86)
        draw.ellipse(bbox, fill=(246, 228, 198, alpha), outline=(74, 54, 38, outline_alpha), width=max(1, int(round(2.4 * w / 720.0))))


def _draw_scene(t: float, size: tuple[int, int], c, i: int | None = None):
    if i is None:
        i = int(round(float(t) * 30.0))
    s = _setup(c)
    w, h = size
    cam = c.viewport.camera(_native_camera(t, c))
    jesse = s["jesse"]
    last_i = s.get("last_i")
    if i == 0 or last_i is None or i != last_i + 1:
        jesse._previous = None
        s["prev_hat_held"] = False
    s["last_i"] = i
    rt = c.puppet_runtime

    shot, shot_u = scene_runtime.shot_at(c, t)
    act = scene_runtime.actor_state_at(c, t)
    prop_st = scene_runtime.prop_state_at(c, "hat", t)

    # 1. Background desert street parallax plane (crop+bilinear in one C pass for crispness & speed)
    bg_raw = s["bg_raw"]
    bg_scale_base = (h / bg_raw.height) * 1.56
    zoom_k = (cam.z - 55.0) / 300.0
    bg_scale = bg_scale_base * (1.0 + 0.14 * zoom_k)
    nw = max(w + 48, round(bg_raw.width * bg_scale))
    nh = max(h + 48, round(bg_raw.height * bg_scale))
    scale_x = nw / bg_raw.width
    scale_y = nh / bg_raw.height

    pan_x = (nw - w) * 0.36 + (cam.x + 65.0) * 1.65 * (w / 720.0)
    pan_y = (nh - h) * 0.98 + (cam.y + 205.0) * 0.30 * (h / 1280.0)
    px = max(0.0, min(float(nw - w), pan_x))
    py = max(0.0, min(float(nh - h), pan_y))
    bg_box = (px / scale_x, py / scale_y, (px + w) / scale_x, (py + h) / scale_y)
    bg = bg_raw.resize((w, h), Image.Resampling.BILINEAR, box=bg_box).convert("RGBA")

    # 2. Actor world placement & stride bounce
    jx = -55.0 + float(act["x"])
    jy = float(act["y"])
    jz = 920.0
    stride_cycles = float(act["stride_cycles"])
    is_running = stride_cycles > 0.05
    step_theta = shot_u * max(1.0, stride_cycles) * math.pi * 2.0
    bob_y = -abs(math.sin(step_theta)) * 7.5 if is_running else 0.0

    foot_world = (jx, jy, jz)
    actor_world = (jx, jy + bob_y, jz)

    # Hat local state from scene-control.json (falls back cleanly if edited out)
    if prop_st:
        hx = float(prop_st["x"])
        hy = float(prop_st["y"])
        h_ang = float(prop_st["angle_deg"])
        h_scale = float(prop_st["scale"])
        holder_actor = prop_st.get("holder_actor")
        holder_arm = str(prop_st.get("holder_arm") or "right")
        grip_uv = prop_st.get("grip_uv") or [0.20, 0.72]
    else:
        hx, hy, h_ang, h_scale = 14.0, -370.0, -4.0, 1.0
        holder_actor = None
        holder_arm = "right"
        grip_uv = [0.20, 0.72]

    # Gentle organic air wobble only while unheld and moving through wind
    if not holder_actor and 0.75 <= t <= 7.45:
        h_ang += math.sin(t * 10.5) * 4.5
        hy += math.cos(t * 9.0) * 4.0

    # 3. Ground shadows (Jesse + Hat ground shadow projected onto road y=0)
    fx, fy, depth = cam.project(foot_world)
    k = cam.focal / depth
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    srx, sry = max(8.0, 52.0 * k), max(4.0, 13.0 * k)
    od.ellipse((fx - srx, fy - sry, fx + srx, fy + sry), fill=(58, 40, 26, 82))

    # Hat shadow on sandy ground underneath (hx, 0, jz-4)
    hsx, hsy, hdepth = cam.project((jx + hx * 0.88, 0.0, jz - 4.0))
    hk = cam.focal / hdepth
    height_above_ground = max(0.0, -hy)
    hat_sh_alpha = int(round(70.0 * max(0.22, 1.0 - height_above_ground / 520.0)))
    hat_rx = max(6.0, 48.0 * hk * max(0.45, 1.0 - height_above_ground / 720.0))
    hat_ry = max(3.0, 11.0 * hk)
    od.ellipse((hsx - hat_rx, hsy - hat_ry, hsx + hat_rx, hsy + hat_ry), fill=(58, 40, 26, hat_sh_alpha))

    # 4. Atmospheric Wind & Dust Particles (pure code overlays behind character / around feet)
    gust_strength = 0.0
    if 0.72 <= t <= 2.35:
        gust_strength = math.sin(_smooth((t - 0.72) / 1.63) * math.pi)
    elif 6.15 <= t <= 7.55:
        gust_strength = math.sin(_smooth((t - 6.15) / 1.40) * math.pi)
    _draw_wind_streaks(overlay, cam, w, h, t, gust_strength, jx)

    puffs: list[tuple[float, float, float, float, float]] = []
    if is_running:
        for pk in range(3):
            p_phase = ((t * 3.0 + pk * 0.33) % 1.0)
            puffs.append(
                (
                    jx - 38.0 - p_phase * 72.0,
                    -22.0 - p_phase * 42.0,
                    jz + 6.0,
                    16.0 + p_phase * 22.0,
                    (1.0 - p_phase) * 0.92,
                )
            )
    if 7.35 <= t <= 9.45:
        du = _smooth((t - 7.35) / 2.10)
        for pk, dx, dy0, sp in [
            (0, -44.0, -325.0, -1.0),
            (1, 58.0, -310.0, 1.0),
            (2, 10.0, -270.0, 0.3),
            (3, -18.0, -360.0, -0.5),
            (4, -52.0, -24.0, -0.8),
            (5, 50.0, -24.0, 0.8),
        ]:
            puffs.append(
                (
                    jx + dx + sp * du * 46.0,
                    dy0 - du * 30.0 + math.sin(pk + t * 4.0) * 6.0,
                    jz - 10.0,
                    16.0 + du * 24.0,
                    (1.0 - du) * 0.92,
                )
            )
    _draw_dust_puffs(overlay, cam, w, t, puffs)
    bg = Image.alpha_composite(bg, overlay)

    # 5. Actor Billboard Transform & Bounded Stance Stride
    actor_scale = max(0.5, min(1.8, float(act["scale"])))
    actor_mat = np.asarray(cam.billboard_matrix(actor_world, units_per_pixel=1.02 * actor_scale), dtype=float)

    ankle_targets = None
    if is_running:
        # Alternate ankle targets strictly inside <=24% of 92.0 leg length (<= 22 local units)
        l_off_x = -22.0 + math.sin(step_theta) * 16.0
        r_off_x = 24.0 - math.sin(step_theta) * 16.0
        l_off_y = -4.0 - max(0.0, math.sin(step_theta)) * 8.0
        r_off_y = -4.0 - max(0.0, -math.sin(step_theta)) * 8.0
        l_scr = (actor_mat @ np.array([l_off_x, l_off_y, 1.0]))[:2]
        r_scr = (actor_mat @ np.array([r_off_x, r_off_y, 1.0]))[:2]
        ankle_targets = {"left": l_scr.tolist(), "right": r_scr.tolist()}

    # 6. Hat ContactState (either free/worn prop or held tightly at brim during Shot 4 catch)
    pw, ph = 156.0 * h_scale, 82.0 * h_scale
    rad = math.radians(h_ang)
    paper_mat = np.array(
        [
            [math.cos(rad), -math.sin(rad), hx],
            [math.sin(rad), math.cos(rad), hy],
            [0.0, 0.0, 1.0],
        ],
        dtype=float,
    )
    if holder_actor == "jesse":
        gx, gy = (np.asarray(grip_uv, dtype=float) - 0.5) * np.array([pw, ph])
        grip_local = [
            float(paper_mat[0, 0] * gx + paper_mat[0, 1] * gy + paper_mat[0, 2]),
            float(paper_mat[1, 0] * gx + paper_mat[1, 1] * gy + paper_mat[1, 2]),
        ]
        holders = [{"actor_id": "jesse", "arm": holder_arm, "grip": [float(grip_uv[0]), float(grip_uv[1])]}]
        local_contact = rt.ContactState(
            state="owner",
            paper_matrix=paper_mat,
            paper_size=(pw, ph),
            holders=holders,
            targets={"jesse": {holder_arm: grip_local}},
            event_index=0,
        )
    else:
        local_contact = rt.ContactState(
            state="release",
            paper_matrix=paper_mat,
            paper_size=(pw, ph),
            holders=[],
            targets={},
            event_index=0,
        )
    world_contact = rt.transform_contact(local_contact, actor_mat)

    # 7. Arm Action Choreography + Head Variant & Smooth Nod
    l_act_name, l_ph = act["left_arm"]
    r_act_name, r_ph = act["right_arm"]
    l_act_name = _norm_arm_action(str(l_act_name))
    r_act_name = _norm_arm_action(str(r_act_name))

    if is_running and not holder_actor:
        # Smoothly ramp energetic pumping oscillation inside sprint window so joins at shot_u=0/1 have zero jump
        ramp_in = min(1.0, shot_u / 0.16)
        ramp_out = min(1.0, (1.0 - shot_u) / 0.16)
        env = _smooth(ramp_in) * _smooth(ramp_out)
        base_l = float(l_ph)
        base_r = float(r_ph)
        l_ph = max(0.0, min(1.0, base_l + env * 0.14 * math.sin(step_theta)))
        r_ph = max(0.0, min(1.0, base_r - env * 0.16 * math.sin(step_theta)))

    if holder_actor == "jesse":
        if holder_arm == "right":
            r_act_name, r_ph = "receive", 0.5
        else:
            l_act_name, l_ph = "offer", 1.0

    raw_expr = act["expression"]
    head_variant = str(raw_expr) if raw_expr else None
    heads_map = jesse.character.views[jesse.view_id].heads
    if head_variant is not None and head_variant not in heads_map:
        head_variant = None

    # Subtle comedic head accents on hat blow-off, hand grab & brim thud
    head_angle = float(act["head_angle_deg"])
    head_angle += c.actions.reaction_nod(t, start=0.92, attack=0.18, settle=0.45, angle=7.5)
    head_angle += c.actions.reaction_nod(t, start=7.30, attack=0.16, settle=0.42, angle=-6.5)
    head_angle = max(-20.0, min(20.0, head_angle))

    # Avoid sharp IK teleport across catch onset/release transitions
    cur_held = bool(holder_actor)
    allow_cut = cur_held != bool(s.get("prev_hat_held"))
    s["prev_hat_held"] = cur_held

    pose = jesse.pose(
        action="rest",
        phase=1.0,
        placement=actor_mat,
        wrist_targets=world_contact.targets.get("jesse", {}),
        arm_actions={
            "left": {"action": l_act_name, "phase": float(l_ph)},
            "right": {"action": r_act_name, "phase": float(r_ph)},
        },
        head_variant=head_variant,
        head_angle_deg=head_angle,
        ankle_targets=ankle_targets,
        frame_index=i,
        allow_cut=allow_cut,
    )

    # 8. Foreground hitching post & cactus parallax layer (sweeps cleanly across lower-right corner during chase)
    fg_raw = s["fg_raw"]
    fg_scale = h / fg_raw.height
    fg_w = max(w, round(fg_raw.width * fg_scale))
    fg_sx = fg_w / fg_raw.width
    fg_shift = (cam.x + 70.0) * 5.6 * (w / 720.0)
    fg_crop_x = max(0.0, min(float(fg_w - w), fg_shift))
    fg_crop = fg_raw.resize(
        (w, h),
        Image.Resampling.BILINEAR,
        box=(fg_crop_x / fg_sx, 0.0, (fg_crop_x + w) / fg_sx, float(fg_raw.height)),
    )
    fg_mask = np.asarray(fg_crop)[:, :, 3]

    in_catch_shot = bool(shot and shot.get("id") == "shot-4-near-catch-slip")
    front_parts = (
        ("jesse:arm:left:forearm", "jesse:arm:right:forearm")
        if (holder_actor == "jesse" or in_catch_shot)
        else ()
    )
    props = [rt.PropFrame("cowboy_hat", world_contact, s["hat_raw"], front_limb_parts=front_parts)]

    return rt.render_scene(
        size,
        [pose],
        props=props,
        background=bg,
        foreground=fg_crop,
        foreground_occlusion_mask=fg_mask,
        frame_index=i,
    )


def frame(t, c):
    return _draw_scene(float(t), c.viewport.size, c, None)


def draft_frame(t, c):
    return _draw_scene(float(t), c.viewport.size, c, None)
