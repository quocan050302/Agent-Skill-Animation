"""A Roman Gladiator's Last-Second Reaction — 10s 9:16 B6 Code-Animated Scene.

Uses B6's painted puppet runtime (b6_puppet.py), 2.5D camera space (b6_space.py),
action timing helpers (b6_actions.py), and true draft viewport scaling (b6_iteration.py).
"""
from __future__ import annotations
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

_CACHE = {}


def _smooth(x: float) -> float:
    x = max(0.0, min(1.0, float(x)))
    return x * x * (3.0 - 2.0 * x)


def _mix(a, b, u: float):
    u = _smooth(u)
    return a * (1.0 - u) + b * u


def _native_camera(c, t: float):
    """Authored 9:16 camera path across the 5 Roman arena beats."""
    Cam = c.space.Camera
    base = Cam(width=720, height=1280, focal=1140.0, x=-180.0, y=-200.0, z=0.0, principal_y=700.0)
    if t < 1.5:
        return c.space.camera_move(base, t, 0.0, 1.5, x=-25.0, z=55.0)
    cam1 = c.space.camera_move(base, 1.5, 0.0, 1.5, x=-25.0, z=55.0)
    if t < 3.5:
        return c.space.camera_move(cam1, t, 1.5, 3.5, x=15.0, z=125.0)
    cam2 = c.space.camera_move(cam1, 3.5, 1.5, 3.5, x=15.0, z=125.0)
    if t < 5.3:
        cam = c.space.camera_move(cam2, t, 3.5, 5.3, x=25.0, y=-190.0, z=210.0, principal_y=660.0)
        if 3.95 <= t < 4.18:
            shake = math.sin((t - 3.95) * 45.0) * (1.0 - (t - 3.95) / 0.23) * 4.5
            cam = c.space.Camera(
                width=cam.width, height=cam.height, focal=cam.focal,
                x=cam.x + shake, y=cam.y + abs(shake) * 0.6, z=cam.z,
                principal_y=cam.principal_y,
            )
        return cam
    cam3 = c.space.camera_move(cam2, 5.3, 3.5, 5.3, x=25.0, y=-190.0, z=210.0, principal_y=660.0)
    if t < 7.5:
        return c.space.camera_move(cam3, t, 5.3, 6.7, x=16.0, y=-185.0, z=305.0, principal_y=600.0)
    cam4 = c.space.camera_move(cam3, 6.7, 5.3, 6.7, x=16.0, y=-185.0, z=305.0, principal_y=600.0)
    return c.space.camera_move(cam4, t, 7.5, 8.2, x=16.0, y=-185.0, z=335.0, principal_y=585.0)


def _setup(c):
    rt = c.puppet_runtime
    bg_raw = Image.open(c.base / "assets/production/arena_wide_bg.png").convert("RGBA")
    fg_raw = Image.open(c.base / "assets/production/arena_foreground.png").convert("RGBA")
    shield_raw = Image.open(c.base / "assets/production/roman_shield.png").convert("RGBA")
    pilum_raw = Image.open(c.base / "assets/production/roman_pilum.png").convert("RGBA")

    shield_timeline = rt.ContactTimeline([
        {
            "t0": 0.0, "t1": 3.5, "state": "owner",
            "holders": [{"actor_id": "marcus", "arm": "right", "grip": [0.22, 0.50]}],
            "paper_start": [6.0, -144.0, -6.0],
            "paper_end": [10.0, -146.0, -4.0],
        },
        {
            "t0": 3.5, "t1": 5.3, "state": "owner",
            "holders": [{"actor_id": "marcus", "arm": "right", "grip": [0.22, 0.50]}],
            "paper_start": [10.0, -146.0, -4.0],
            "paper_end": [4.0, -150.0, -8.0],
        },
        {
            "t0": 5.3, "t1": 6.05, "state": "owner",
            "holders": [{"actor_id": "marcus", "arm": "right", "grip": [0.22, 0.50]}],
            "paper_start": [4.0, -150.0, -8.0],
            "paper_end": [16.0, -172.0, 5.0],
        },
        {
            "t0": 6.05, "t1": 7.5, "state": "owner",
            "holders": [{"actor_id": "marcus", "arm": "right", "grip": [0.22, 0.50]}],
            "paper_start": [16.0, -172.0, 5.0],
            "paper_end": [18.0, -174.0, 3.0],
        },
        {
            "t0": 7.5, "t1": 10.05, "state": "owner",
            "holders": [{"actor_id": "marcus", "arm": "right", "grip": [0.22, 0.50]}],
            "paper_start": [18.0, -174.0, 3.0],
            "paper_end": [16.0, -173.0, 2.0],
        },
    ], paper_size=(80.0, 108.0))

    # Left arm action track (counter-balance -> startled recoil -> bracing ready)
    left_arm = c.puppet_runtime.ACTIONS
    marcus_pkg = c.character_packages["marcus"]
    left_spec = marcus_pkg.views["three_quarter"].arms["left"]
    left_track = c.actions.ArmTrack(rt, left_spec, [
        c.actions.ArmSegment("rest", 0.0, 1.5, 0.0, 0.5),
        c.actions.ArmSegment("rest", 1.5, 3.5, 0.5, 1.0),
        c.actions.ArmSegment("reach", 3.5, 4.3, 0.0, 0.8),
        c.actions.ArmSegment("reach", 4.3, 5.5, 0.8, 1.0),
        c.actions.ArmSegment("offer", 5.5, 6.3, 0.0, 0.9),
        c.actions.ArmSegment("offer", 6.3, 10.05, 0.9, 0.9),
    ])

    return {
        "rt": rt,
        "bg_raw": bg_raw,
        "fg_raw": fg_raw,
        "shield_raw": shield_raw,
        "pilum_raw": pilum_raw,
        "shield_timeline": shield_timeline,
        "left_track": left_track,
        "puppets": {},
    }


def _draw_scene(t: float, c, cam, size):
    key = (str(c.base), c.fingerprint)
    if key not in _CACHE:
        _CACHE[key] = _setup(c)
    s = _CACHE[key]
    rt = s["rt"]
    w, h = size
    i = round(t * 30)

    puppet_key = (w, h)
    if puppet_key not in s["puppets"]:
        s["puppets"][puppet_key] = rt.Puppet(c.character_packages["marcus"], "three_quarter", "marcus")
    marcus = s["puppets"][puppet_key]

    # 1. Render wide panoramic background responding to camera x/z parallax
    bg_raw = s["bg_raw"]
    bg_scale_base = h / bg_raw.height * 1.18
    zoom_k = cam.z / 345.0
    bg_scale = bg_scale_base * (1.0 + 0.14 * zoom_k)
    nw = max(w + 40, round(bg_raw.width * bg_scale))
    nh = max(h + 40, round(bg_raw.height * bg_scale))
    bg_scaled = bg_raw.resize((nw, nh), Image.Resampling.BILINEAR)
    # Pan offset tied smoothly to camera.x
    pan_x = (nw - w) * 0.5 + (cam.x + 100.0) * 0.45 * (w / 720.0)
    pan_y = (nh - h) * 0.48 + (cam.y + 220.0) * 0.35 * (h / 1280.0)
    px = max(0, min(nw - w, int(round(pan_x))))
    py = max(0, min(nh - h, int(round(pan_y))))
    bg = bg_scaled.crop((px, py, px + w, py + h)).convert("RGBA")

    # 2. Compute Marcus world position (grounded advance from x=-42, z=960 -> x=0, z=910)
    if t < 1.5:
        mx, mz = -42.0, 960.0
    elif t < 3.5:
        u = _smooth((t - 1.5) / 2.0)
        mx = -42.0 + 42.0 * u
        mz = 960.0 - 50.0 * u
    else:
        mx, mz = 0.0, 910.0

    # Ground shadow under Marcus
    foot_world = (mx, 0.0, mz)
    fx, fy, depth = cam.project(foot_world)
    k = cam.focal / depth
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    srx, sry = max(8, 56 * k), max(4, 14 * k)
    sd.ellipse((fx - srx, fy - sry, fx + srx, fy + sry), fill=(52, 36, 26, 78))

    # 3. Stray Roman Pilum drop (Shot 3 -> stays planted in sand)
    if t >= 3.55:
        pilum_x, pilum_z = 118.0, 888.0
        if t < 3.95:
            drop_u = (t - 3.55) / 0.40
            pilum_y = -620.0 * (1.0 - drop_u * drop_u)
        else:
            pilum_y = 0.0
        px_s, py_s, p_depth = cam.project((pilum_x, pilum_y, pilum_z))
        pk = cam.focal / p_depth
        # Spear shadow on sand shrinks as spear approaches ground
        sh_alpha = int(80 * max(0.15, 1.0 - abs(pilum_y) / 650.0))
        gx_s, gy_s, _ = cam.project((pilum_x, 0.0, pilum_z))
        sd.ellipse((gx_s - 20 * pk, gy_s - 6 * pk, gx_s + 20 * pk, gy_s + 6 * pk), fill=(52, 36, 26, sh_alpha))
        bg = Image.alpha_composite(bg, shadow)

        pilum_raw = s["pilum_raw"]
        ph = max(24, int(round(270 * pk)))
        pw = max(6, int(round(pilum_raw.width * (ph / pilum_raw.height))))
        pilum_img = pilum_raw.resize((pw, ph), Image.Resampling.BILINEAR).rotate(-7.0, expand=True, resample=Image.Resampling.BILINEAR)
        # Tip sits near bottom of pilum sprite
        bg.alpha_composite(pilum_img, (int(round(px_s - pilum_img.width * 0.5)), int(round(py_s - pilum_img.height + 10 * pk))))
    else:
        bg = Image.alpha_composite(bg, shadow)

    # 4. Actor billboard matrix & grounded stance ankle targets
    # units_per_pixel=0.88 gives balanced B6 portrait height
    actor_mat = np.asarray(cam.billboard_matrix(foot_world, units_per_pixel=0.88), dtype=float)

    # Grounded ankle planting during advance (within bounded ±25% stance envelope)
    ankle_targets = None
    if 1.5 <= t < 3.5:
        step_phase = (t - 1.5) / 2.0
        # Two smooth weight-shift strides keeping feet anchored without exceeding 20 local units
        l_off_x = -22.0 + math.sin(step_phase * math.pi * 2.0) * 14.0
        r_off_x = 24.0 - math.sin(step_phase * math.pi * 2.0) * 14.0
        l_off_y = -4.0 - max(0.0, math.sin(step_phase * math.pi * 2.0)) * 7.0
        r_off_y = -4.0 - max(0.0, -math.sin(step_phase * math.pi * 2.0)) * 7.0
        l_scr = (actor_mat @ np.array([l_off_x, l_off_y, 1.0]))[:2]
        r_scr = (actor_mat @ np.array([r_off_x, r_off_y, 1.0]))[:2]
        ankle_targets = {"left": l_scr.tolist(), "right": r_scr.tolist()}

    # 5. Expression, head reaction nod & shield ContactState
    if t < 3.92:
        head_variant = "neutral"
    elif t < 5.45:
        head_variant = "alert"
    else:
        head_variant = "bracing"

    head_angle = c.actions.reaction_nod(t, start=3.92, attack=0.14, settle=0.45, angle=11.0)
    if t >= 5.50:
        head_angle += c.actions.reaction_nod(t, start=5.50, attack=0.16, settle=0.45, angle=-7.0)

    local_contact = s["shield_timeline"].sample(t)
    world_contact = rt.transform_contact(local_contact, actor_mat)

    r_action = "offer" if t >= 5.3 else "rest"
    r_phase = _smooth((t - 5.3) / 0.75) if 5.3 <= t < 6.05 else 1.0
    if t < 5.3:
        r_phase = 0.0

    pose = marcus.pose(
        action="rest",
        phase=1.0,
        placement=actor_mat,
        wrist_targets=world_contact.targets.get("marcus", {}),
        arm_actions={
            "left": s["left_track"].sample(t),
            "right": {"action": r_action, "phase": r_phase},
        },
        head_variant=head_variant,
        head_angle_deg=head_angle,
        ankle_targets=ankle_targets,
        frame_index=i,
    )

    # 6. Foreground stone arch parallax layer (wipes out cleanly leftwards after Shot 1-2)
    fg_raw = s["fg_raw"]
    fg_scale = (h / fg_raw.height) * 1.06
    fg_w = max(w, round(fg_raw.width * fg_scale))
    fg_h = max(h, round(fg_raw.height * fg_scale))
    fg_scaled = fg_raw.resize((fg_w, fg_h), Image.Resampling.BILINEAR)
    # Pan cleanly from left arch into empty clear middle
    fg_shift = int(round((cam.x + 180.0) * 2.1 * (w / 720.0)))
    fg_crop_x = max(0, min(fg_w - w - 120, fg_shift))
    fg_crop = fg_scaled.crop((fg_crop_x, 0, fg_crop_x + w, h))
    fg_mask = np.asarray(fg_crop)[:, :, 3]

    props = [rt.PropFrame("roman_shield", world_contact, s["shield_raw"], front_limb_parts=("marcus:arm:right:forearm",))]
    return rt.render_scene(
        size,
        [pose],
        props=props,
        background=bg,
        foreground=fg_crop,
        foreground_occlusion_mask=fg_mask,
        frame_index=i,
    )


def frame(t, context):
    cam = _native_camera(context, t)
    return _draw_scene(t, context, cam, (720, 1280))


def draft_frame(t, context):
    view = context.viewport
    cam = view.camera(_native_camera(context, t))
    return _draw_scene(t, context, cam, view.size)
