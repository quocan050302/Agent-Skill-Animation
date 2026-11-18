"""Articulated leg & full B6 RenderResult-compatible compositor (`b6-studio-articulated/1`).

Draws bent-knee 2-bone legs (thigh -> knee cap -> shin -> stylized foot) in continuous
dark ink weight matching the B6 character package, while enforcing every upstream arm,
cuff, neck-mount, prop-grip, foreground-alpha-matte, and pixel-SHA contract.
"""
from __future__ import annotations

import hashlib
import math
from typing import Any, Mapping, Sequence
import zlib
import cv2
import numpy as np
from PIL import Image

try:
    from .b6_motion_core import GaitPose, LegPose, MotionProfile
except ImportError:
    from b6_motion_core import GaitPose, LegPose, MotionProfile


class _StandaloneRenderResult:
    def __init__(self, beauty, limb_masks, part_masks, id_image, qa):
        self.beauty = beauty
        self.limb_masks = limb_masks
        self.part_masks = part_masks
        self.id_image = id_image
        self.qa = qa


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _rgba(image: Any, size: tuple[int, int] | None = None) -> np.ndarray:
    if isinstance(image, Image.Image):
        a = np.asarray(image.convert("RGBA")).copy()
    else:
        a = np.asarray(image)
        if a.dtype != np.uint8:
            a = np.uint8(np.clip(a, 0, 1) * 255) if a.max(initial=0) <= 1 else np.uint8(np.clip(a, 0, 255))
        if a.ndim == 3 and a.shape[2] == 3:
            a = np.dstack((a, np.full(a.shape[:2], 255, np.uint8)))
        if a.ndim != 3 or a.shape[2] != 4:
            raise ValueError("RGBA or RGB image required")
    if size:
        if a.shape[:2] != (size[1], size[0]):
            raise ValueError(f"Canvas image size mismatch: {a.shape[:2]} != {(size[1], size[0])}")
    return np.ascontiguousarray(a)


def _point(m: np.ndarray, p: Sequence[float]) -> np.ndarray:
    return (m @ np.array([float(p[0]), float(p[1]), 1.0], dtype=float))[:2]


def _scale(m: np.ndarray) -> float:
    return float(np.linalg.norm(m[:2, 0]))


def _warp(image: np.ndarray, matrix: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    return cv2.warpAffine(
        np.ascontiguousarray(image),
        np.asarray(matrix[:2], dtype=float),
        size,
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )


def _inside_canvas(size: tuple[int, int], p: Sequence[float], margin: float = 0.0) -> bool:
    w, h = size
    return bool(-margin <= float(p[0]) < w + margin and -margin <= float(p[1]) < h + margin)


def _dilate(a: np.ndarray, r: float) -> np.ndarray:
    rad = max(1, int(math.ceil(r)))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rad + 1, 2 * rad + 1))
    return cv2.dilate(np.uint8(a > 32), k) > 0


def _sum(a: np.ndarray) -> float:
    return float(np.asarray(a, dtype=float).sum() / 255.0)


def _raster_bounds(size: tuple[int, int], pts: Sequence[Sequence[float]], pad: float) -> tuple[int, int, int, int]:
    w, h = size
    arr = np.asarray(pts, dtype=float)
    lo = np.floor(arr.min(axis=0) - pad).astype(int)
    hi = np.ceil(arr.max(axis=0) + pad).astype(int)
    return max(0, int(lo[0])), max(0, int(lo[1])), min(w, int(hi[0])), min(h, int(hi[1]))


def _stroke_articulated_leg_mask(
    size: tuple[int, int],
    hip: np.ndarray,
    knee: np.ndarray,
    ankle: np.ndarray,
    width: float,
    seed: str,
) -> np.ndarray:
    """3x supersampled smooth organic-ink mask along hip -> knee -> ankle with clean round knee join."""
    w, h = size
    out = np.zeros((h, w), np.uint8)
    pts = [hip, knee, ankle]
    x0, y0, x1, y1 = _raster_bounds(size, pts, width + 6.0)
    if x1 <= x0 or y1 <= y0:
        return out

    ss = 3
    off = np.array([x0, y0], dtype=float)
    im = np.zeros(((y1 - y0) * ss, (x1 - x0) * ss), np.uint8)

    # Sample smooth quadratic slight bend round the knee cap + straight anatomical segments
    p0 = (hip - off) * ss
    p1 = (knee - off) * ss
    p2 = (ankle - off) * ss
    thick = max(2, int(round(width * ss)))

    # Slight tapered thick ink capsules with smooth circular joint at knee & hip/ankle
    cv2.line(im, tuple(np.rint(p0).astype(int)), tuple(np.rint(p1).astype(int)), 255, thick, cv2.LINE_AA)
    cv2.line(im, tuple(np.rint(p1).astype(int)), tuple(np.rint(p2).astype(int)), 255, max(2, int(round(thick * 0.94))), cv2.LINE_AA)
    cv2.circle(im, tuple(np.rint(p1).astype(int)), max(1, thick // 2), 255, -1, cv2.LINE_AA)
    cv2.circle(im, tuple(np.rint(p2).astype(int)), max(1, int(round(thick * 0.45))), 255, -1, cv2.LINE_AA)

    patch = cv2.resize(im, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
    _ = seed
    out[y0:y1, x0:x1] = patch
    return out


def _draw_tabi_foot_rgba(
    size: tuple[int, int],
    ankle: np.ndarray,
    toe: np.ndarray,
    foot_size: Sequence[float],
    facing: float,
    ink_width: float,
    ink_color: tuple[int, int, int],
    scale: float,
    style: str = "tabi",
) -> tuple[np.ndarray, np.ndarray]:
    """Render crisp B6 foot/sandal (tabi + waraji or capsule boot) aligned along ankle -> toe. Returns (rgba, mask)."""
    w, h = size
    rgba_out = np.zeros((h, w, 4), np.uint8)
    mask_out = np.zeros((h, w), np.uint8)

    fw = max(12.0, float(foot_size[0]) * scale)
    fh = max(6.0, float(foot_size[1]) * scale)
    margin = max(fw, fh) + ink_width * scale + 8.0
    x0, y0, x1, y1 = _raster_bounds(size, [ankle, toe], margin)
    if x1 <= x0 or y1 <= y0:
        return rgba_out, mask_out

    ss = 3
    pw, ph = (x1 - x0) * ss, (y1 - y0) * ss
    patch_rgba = np.zeros((ph, pw, 4), np.uint8)
    off = np.array([x0, y0], dtype=float)

    a_px = (ankle - off) * ss
    t_px = (toe - off) * ss
    vec = t_px - a_px
    v_len = max(1e-4, float(np.linalg.norm(vec)))
    u = vec / v_len
    n = np.array([-u[1], u[0]], dtype=float)
    # Force normal `up` toward -y in screen space
    if n[1] > 0:
        n = -n

    heel = a_px - u * (fw * 0.28 * ss)
    tip = a_px + u * (fw * 0.78 * ss)
    top_arch = a_px + u * (fw * 0.25 * ss) + n * (fh * 0.85 * ss)
    sole_mid = a_px + u * (fw * 0.28 * ss) - n * (fh * 0.14 * ss)

    poly = np.array(
        [
            heel - n * (fh * 0.14 * ss),
            heel + n * (fh * 0.72 * ss),
            top_arch,
            tip + n * (fh * 0.36 * ss),
            tip - n * (fh * 0.14 * ss),
            sole_mid,
        ],
        dtype=np.float32,
    )
    pts_int = np.rint(poly).astype(np.int32)
    outline_px = max(2, int(round(max(2.2, ink_width * scale * 0.55) * ss)))

    if style == "tabi":
        # Clean cream/light-grey tabi sock fill + brown waraji straw sole + dark ink outline
        sock_bgr = (232, 224, 206, 255)
        sole_bgr = (118, 86, 54, 255)
        cv2.fillPoly(patch_rgba, [pts_int], sock_bgr, cv2.LINE_AA)
        sole_pts = np.rint(
            np.array(
                [
                    heel - n * (fh * 0.22 * ss),
                    heel + n * (fh * 0.16 * ss),
                    tip + n * (fh * 0.14 * ss),
                    tip - n * (fh * 0.22 * ss),
                ]
            )
        ).astype(np.int32)
        cv2.fillPoly(patch_rgba, [sole_pts], sole_bgr, cv2.LINE_AA)
        cv2.polylines(patch_rgba, [pts_int], True, (*ink_color, 255), outline_px, cv2.LINE_AA)
        cv2.polylines(patch_rgba, [sole_pts], True, (*ink_color, 255), max(1, outline_px // 2), cv2.LINE_AA)
    else:
        cv2.fillPoly(patch_rgba, [pts_int], (*ink_color, 255), cv2.LINE_AA)
        cv2.polylines(patch_rgba, [pts_int], True, (*ink_color, 255), outline_px, cv2.LINE_AA)

    _ = facing
    resized = cv2.resize(patch_rgba, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
    rgba_out[y0:y1, x0:x1] = resized
    mask_out[y0:y1, x0:x1] = resized[:, :, 3]
    return rgba_out, mask_out


def render_articulated_legs(
    base_layers: np.ndarray | Image.Image | None,
    leg_poses: Mapping[str, LegPose],
    profile: MotionProfile,
    occlusion_order: Sequence[str] = ("left", "right"),
    viewport: Any = None,
    *,
    world_to_screen_fn=None,
    actor_matrix: np.ndarray | None = None,
    size: tuple[int, int] | None = None,
    ground_y_world: float = 0.0,
) -> dict[str, Any]:
    """Render articulated legs (thigh, knee cap, shin, stylized foot, contact shadow) onto RGBA canvas/masks."""
    if size is None:
        if base_layers is not None:
            im0 = _rgba(base_layers)
            size = (im0.shape[1], im0.shape[0])
        elif viewport is not None:
            size = tuple(map(int, viewport.size))
        else:
            size = (720, 1280)
    w, h = size
    canvas = _rgba(base_layers, size).copy() if base_layers is not None else np.zeros((h, w, 4), np.uint8)
    scale = _scale(actor_matrix) if actor_matrix is not None else 1.0
    ink_color = tuple(int(c) for c in profile.ink_color)

    def to_scr(pt_w: Sequence[float]) -> np.ndarray:
        if world_to_screen_fn is not None:
            return np.asarray(world_to_screen_fn(pt_w), dtype=float)[:2]
        if actor_matrix is not None:
            return _point(actor_matrix, pt_w)
        return np.asarray(pt_w, dtype=float)[:2]

    # Subtle grounded foot contact shadows first (shrink & fade smoothly during swing lift)
    shadow_layer = np.zeros((h, w, 4), np.uint8)
    for side in occlusion_order:
        lp = leg_poses.get(side)
        if lp is None:
            continue
        air_height = max(0.0, float(ground_y_world - lp.ankle_xy[1]))
        sh_w = (lp.ankle_xy[0], ground_y_world)
        sh_s = to_scr(sh_w)
        sh_alpha = int(round(78.0 * max(0.18, 1.0 - air_height / 65.0)))
        rx = max(6, int(round(19.0 * scale * max(0.55, 1.0 - air_height / 95.0))))
        ry = max(3, int(round(6.5 * scale)))
        cv2.ellipse(
            shadow_layer,
            tuple(np.rint(sh_s).astype(int)),
            (rx, ry),
            0,
            0,
            360,
            (46, 34, 24, sh_alpha),
            -1,
            cv2.LINE_AA,
        )

    sa = shadow_layer[:, :, 3:4].astype(np.float32) / 255.0
    ca = canvas[:, :, 3:4].astype(np.float32) / 255.0
    out_a = sa + ca * (1.0 - sa)
    out_rgb = (shadow_layer[:, :, :3].astype(np.float32) * sa + canvas[:, :, :3].astype(np.float32) * ca * (1.0 - sa)) / np.maximum(out_a, 1e-6)
    canvas = np.dstack((np.uint8(np.clip(out_rgb, 0, 255)), np.uint8(np.clip(out_a * 255.0, 0, 255))))

    leg_masks: dict[str, np.ndarray] = {}
    screen_joints: dict[str, dict[str, Any]] = {}

    for side in occlusion_order:
        lp = leg_poses.get(side)
        if lp is None:
            continue
        hip_s = to_scr(lp.hip_xy)
        knee_s = to_scr(lp.knee_xy)
        ankle_s = to_scr(lp.ankle_xy)
        toe_s = to_scr(lp.toe_xy)

        shaft_mask = _stroke_articulated_leg_mask(size, hip_s, knee_s, ankle_s, profile.ink_width * scale, f"{side}_shaft")
        foot_rgba, foot_mask = _draw_tabi_foot_rgba(
            size,
            ankle_s,
            toe_s,
            profile.foot_size,
            lp.knee_forward_sign,
            profile.ink_width,
            ink_color,
            scale,
            style=profile.foot_style,
        )

        # Composite shaft then foot cleanly onto canvas
        shaft_im = np.zeros((h, w, 4), np.uint8)
        shaft_im[:, :, :3] = ink_color
        shaft_im[:, :, 3] = shaft_mask

        for lay in (shaft_im, foot_rgba):
            la = lay[:, :, 3:4].astype(np.float32) / 255.0
            da = canvas[:, :, 3:4].astype(np.float32) / 255.0
            oa = la + da * (1.0 - la)
            rgb = (lay[:, :, :3].astype(np.float32) * la + canvas[:, :, :3].astype(np.float32) * da * (1.0 - la)) / np.maximum(oa, 1e-6)
            canvas = np.dstack((np.uint8(np.clip(rgb, 0, 255)), np.uint8(np.clip(oa * 255.0, 0, 255))))

        leg_masks[f"{side}:shaft"] = shaft_mask
        leg_masks[f"{side}:foot"] = foot_mask
        screen_joints[side] = {
            "hip": hip_s.tolist(),
            "knee": knee_s.tolist(),
            "ankle": ankle_s.tolist(),
            "toe": toe_s.tolist(),
            "bend_angle_deg": float(lp.bend_angle_deg),
            "contact_state": lp.contact_state,
        }

    return {
        "image": Image.fromarray(canvas),
        "masks": leg_masks,
        "screen_joints": screen_joints,
    }


def render_articulated_scene(
    size: tuple[int, int],
    actors_specs: Sequence[Mapping[str, Any]],
    *,
    props: Sequence[Any] = (),
    background: Image.Image | np.ndarray | None = None,
    foreground: Image.Image | np.ndarray | None = None,
    foreground_occlusion_mask: np.ndarray | None = None,
    frame_index: int = 0,
    runtime: Any = None,
) -> Any:
    """B6-compliant compositor replacing static straight-line legs with 2-bone bent-knee legs.

    Preserves all upstream arm, cuff, neck-attachment, prop-contact, foreground-matte,
    visibility-minima, and SHA-256 evidence audits so `run.py` validates authentically.
    """
    w, h = map(int, size)
    if w <= 0 or h <= 0:
        raise ValueError("Invalid canvas dimensions")

    canvas = np.zeros((h, w, 4), np.float32) if background is None else _rgba(background, (w, h)).astype(np.float32) / 255.0
    visible: dict[str, np.ndarray] = {}
    raw: dict[str, np.ndarray] = {}
    arm_rows: list[dict[str, Any]] = []
    leg_rows: list[dict[str, Any]] = []
    neck_rows: list[dict[str, Any]] = []
    cuff_masks: dict[str, np.ndarray] = {}
    arm_specs: dict[str, tuple[Any, Any, np.ndarray]] = {}
    hand_layers: list[tuple[str, np.ndarray, Any]] = []
    pending: dict[str, dict[str, Any]] = {}
    layer_order = 0

    prop_frames = list(props or ())
    actual_arm_parts = {
        f"{item['pose'].actor_id}:arm:{side}:{part}"
        for item in actors_specs
        for side in ("left", "right")
        for part in ("upper", "forearm")
    }
    front_groups: dict[str, list[int]] = {}
    for index, prop in enumerate(prop_frames):
        for part in getattr(prop, "front_limb_parts", ()) or ():
            if part not in actual_arm_parts:
                raise ValueError(f"Prop front_limb_parts names absent part: {part}")
            front_groups.setdefault(part, []).append(index)

    def composite(image: np.ndarray, key: str | None = None, original_order: int | None = None, occlusion_key: str | None = None) -> None:
        nonlocal canvas, layer_order
        im = _rgba(image, (w, h))
        ys, xs = np.nonzero(im[:, :, 3])
        alpha_full = im[:, :, 3].astype(np.float32) / 255.0
        order = layer_order if original_order is None else original_order
        if original_order is None:
            layer_order += 1
        if key in front_groups and original_order is None:
            pending[key] = {"image": im, "alpha": alpha_full.copy(), "order": order}
            raw[key] = alpha_full.copy()
            return
        for part, record in pending.items():
            if record["order"] >= order:
                continue
            skipped = {f"prop:{prop_frames[idx].prop_id}" for idx in front_groups[part]}
            if (occlusion_key or key) not in skipped:
                record["alpha"] *= 1.0 - alpha_full
        if len(xs):
            roi = np.s_[int(ys.min()) : int(ys.max()) + 1, int(xs.min()) : int(xs.max()) + 1]
            patch = im[roi].astype(np.float32) / 255.0
            alpha = patch[:, :, 3]
            for k in visible:
                visible[k][roi] *= 1.0 - alpha
            dst = canvas[roi]
            dst_a = dst[:, :, 3]
            out_a = alpha + dst_a * (1.0 - alpha)
            rgb = (patch[:, :, :3] * alpha[:, :, None] + dst[:, :, :3] * dst_a[:, :, None] * (1.0 - alpha[:, :, None])) / np.maximum(out_a[:, :, None], 1e-8)
            canvas[roi] = np.dstack((rgb, out_a))
        if key is not None:
            visible[key] = alpha_full.copy()
            if key not in raw:
                raw[key] = alpha_full.copy()

    def colored(mask: np.ndarray, color: Sequence[int], key: str | None = None, occlusion_key: str | None = None) -> None:
        im = np.empty((h, w, 4), np.uint8)
        im[:, :, :3] = tuple(int(c) for c in color[:3])
        im[:, :, 3] = mask
        composite(im, key, occlusion_key=occlusion_key)

    def sprite(asset: Any, m: np.ndarray, key: str | None = None) -> None:
        composite(_warp(asset.image, m @ asset.image_to_local, (w, h)), key)

    errors: list[str] = []
    actors: list[Any] = []

    for item in actors_specs:
        a = item["pose"]
        actors.append(a)
        v = a.view
        m = a.placement
        scale = _scale(m)
        color = v.ink_color
        gait: GaitPose | None = item.get("gait")
        profile: MotionProfile = item.get("profile") or MotionProfile()
        world_to_screen = item.get("world_to_screen")
        shadow_points = item.get("ground_shadows") or ()

        # 1. Ground contact shadows under feet
        for sx, sy, srx, sry, salpha in shadow_points:
            sh = np.zeros((h, w, 4), np.uint8)
            cv2.ellipse(
                sh,
                (int(round(sx)), int(round(sy))),
                (max(4, int(round(srx))), max(2, int(round(sry)))),
                0,
                0,
                360,
                (48, 36, 26, max(10, min(180, int(round(salpha))))),
                -1,
                cv2.LINE_AA,
            )
            composite(sh)

        # 2. Articulated 2-bone bent-knee legs underneath hakama / body hem
        leg_map: dict[str, LegPose] = {}
        if gait is not None:
            leg_map = {"left": gait.left_leg, "right": gait.right_leg}
        else:
            leg_map = dict(item.get("legs") or {})

        order_sides = ("left", "right") if profile.facing_sign >= 0 else ("right", "left")
        for side in order_sides:
            lp = leg_map[side]
            key = f"{a.actor_id}:leg:{side}"
            if world_to_screen is not None:
                hip_s = np.asarray(world_to_screen(lp.hip_xy), dtype=float)[:2]
                knee_s = np.asarray(world_to_screen(lp.knee_xy), dtype=float)[:2]
                ankle_s = np.asarray(world_to_screen(lp.ankle_xy), dtype=float)[:2]
                toe_s = np.asarray(world_to_screen(lp.toe_xy), dtype=float)[:2]
            else:
                hip_s = _point(m, lp.hip_xy)
                knee_s = _point(m, lp.knee_xy)
                ankle_s = _point(m, lp.ankle_xy)
                toe_s = _point(m, lp.toe_xy)

            local_inv = np.linalg.inv(m)
            local_hip = _point(local_inv, hip_s)
            local_ankle = _point(local_inv, ankle_s)
            l_cfg = v.legs.get(side, {})
            leg_ink_w = float(l_cfg.get("ink_width", profile.ink_width))
            f_sz = l_cfg.get("foot_size", profile.foot_size)

            shaft_mask = _stroke_articulated_leg_mask((w, h), hip_s, knee_s, ankle_s, leg_ink_w * scale, key)
            colored(shaft_mask, color, f"{key}:shaft")

            foot_rgba, foot_mask = _draw_tabi_foot_rgba(
                (w, h),
                ankle_s,
                toe_s,
                f_sz,
                lp.knee_forward_sign,
                leg_ink_w,
                color,
                scale,
                style=profile.foot_style,
            )
            _ = foot_mask
            composite(foot_rgba, f"{key}:foot")

            # Compute perpendicular deviation of knee from straight hip->ankle line
            chord = ankle_s - hip_s
            chord_len = max(1e-5, float(np.linalg.norm(chord)))
            knee_dev_px = abs(float((knee_s[0] - hip_s[0]) * chord[1] - (knee_s[1] - hip_s[1]) * chord[0])) / chord_len

            leg_rows.append(
                {
                    "limb_id": key,
                    "actor_id": a.actor_id,
                    "side": side,
                    "hip": hip_s.tolist(),
                    "knee": knee_s.tolist(),
                    "ankle": ankle_s.tolist(),
                    "toe": toe_s.tolist(),
                    "local_hip": local_hip.tolist(),
                    "local_ankle": local_ankle.tolist(),
                    "upper_len": float(lp.upper_len),
                    "lower_len": float(lp.lower_len),
                    "actual_upper_len": float(lp.actual_upper_len),
                    "actual_lower_len": float(lp.actual_lower_len),
                    "bend_angle_deg": float(lp.bend_angle_deg),
                    "knee_deviation_px": float(knee_dev_px),
                    "knee_forward_sign": float(lp.knee_forward_sign),
                    "contact_state": str(lp.contact_state),
                    "planted": str(lp.contact_state) == "stance",
                    "planted_space": "world_2d_foot_lock",
                    "gait": "b6-studio-articulated/1",
                    "actor_uniform_scale": scale,
                }
            )

        # 3. Back arms -> Torso sprite -> Front arms -> Cuff sleeve restorations -> Head
        def draw_arm(side: str) -> None:
            spec = v.arms[side]
            ch = a.arms[side]
            screen = np.array([_point(m, pt) for pt in ch])
            key = f"{a.actor_id}:arm:{side}"
            arm_specs[key] = (a, spec, screen)
            ink_record: dict[str, Any] = {}
            if spec.ink_path is None:
                upper = runtime._line_mask((w, h), screen[0], screen[1], spec.ink_width * scale, f"{key}:upper")
                forearm = runtime._line_mask((w, h), screen[1], screen[2], spec.ink_width * scale, f"{key}:forearm")
            else:
                local_path, control, arclength = runtime._continuous_ink_geometry(spec, ch, scale)
                path = np.array([_point(m, pt) for pt in local_path])
                full, upper, forearm = runtime._continuous_masks((w, h), path, spec.ink_width * scale, key)
                ink_record = {
                    "ink_path_local": local_path.tolist(),
                    "ink_path_screen": path.tolist(),
                    "ink_control_local": control.tolist(),
                    "ink_arclength_local": arclength,
                    "ink_arclength_screen": arclength * scale,
                    "ink_sag_local": spec.ink_path["sag"],
                    "ink_midpoint_screen": path[len(path) // 2].tolist(),
                    "unoccluded_full_ink_sha256": _sha(full.tobytes()),
                    "part_interpretation": "semantic halves of one continuous stroke; not painted bone lengths",
                }
            colored(upper, color, f"{key}:upper")
            colored(forearm, color, f"{key}:forearm")
            if spec.hand_asset is not None:
                hm = m.copy()
                hm[:2, 2] = screen[2]
                hand_layers.append((key, _warp(spec.hand_asset.image, hm @ spec.hand_asset.image_to_local, (w, h)), None))
            else:
                hand_layers.append((key, runtime._ellipse_mask((w, h), screen[2], [spec.hand_radius * scale] * 2), color))
            cuff = _warp(spec.cuff.image, m @ spec.cuff.image_to_local, (w, h))
            cuff_masks[key] = cuff
            control_lengths = np.linalg.norm(np.diff(ch, axis=0), axis=1).tolist()
            arm_rows.append(
                {
                    "limb_id": key,
                    "actor_id": a.actor_id,
                    "character_id": a.character.character_id,
                    "package_fingerprint": a.character.fingerprint,
                    "view_id": v.view_id,
                    "side": side,
                    "screen_nodes": screen.tolist(),
                    "local_nodes": ch.tolist(),
                    "nodes_role": "internal_fixed_reach_controls" if spec.ink_path is not None else "painted_two_bone_path",
                    "fixed_lengths": list(spec.lengths) if spec.ink_path is None else None,
                    "actual_planar_lengths": control_lengths if spec.ink_path is None else None,
                    "control_fixed_lengths": list(spec.lengths),
                    "control_actual_planar_lengths": control_lengths,
                    "ink_mode": "continuous" if spec.ink_path is not None else "two_bone",
                    "pole": spec.pole,
                    "action": a.arm_actions.get(side, {}).get("action", a.action),
                    "phase": a.arm_actions.get(side, {}).get("phase", a.phase),
                    "layer": spec.layer,
                    **ink_record,
                }
            )

        for side, spec in v.arms.items():
            if spec.layer == "back":
                draw_arm(side)
        sprite(v.body, m)
        for side, spec in v.arms.items():
            if spec.layer == "front":
                draw_arm(side)

        body_warped = _warp(v.body.image, m @ v.body.image_to_local, (w, h))
        head_asset = v.head if a.head_variant is None else v.heads[a.head_variant]
        head_warped = _warp(head_asset.image, runtime._head_placement(a) @ head_asset.image_to_local, (w, h))
        composite(head_warped)
        if v.neck_attachment is not None:
            neck_rows.append(runtime._neck_screen_evidence(a, (w, h), body_warped, head_warped))

    # 4. Props + contiguous foreground arm part lifting
    prop_masks: dict[str, np.ndarray] = {}
    prop_art_hashes: dict[str, str | None] = {}
    prop_rows: list[dict[str, Any]] = []
    grip_rows: list[dict[str, Any]] = []

    for prop_index, prop in enumerate(prop_frames):
        paper = prop.contact
        paper_art = prop.art
        prop_key = f"prop:{prop.prop_id}"
        pw, ph = paper.paper_size
        corners = np.array([[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]])
        xy = np.rint(np.array([_point(paper.paper_matrix, pt) for pt in corners])).astype(np.int32)
        if paper_art is None:
            paper_mask = np.zeros((h, w), np.uint8)
            cv2.fillConvexPoly(paper_mask, xy, 255, cv2.LINE_AA)
            colored(paper_mask, paper.color, prop_key)
            paper_art_sha = None
        else:
            art = _rgba(paper_art)
            ah, aw = art.shape[:2]
            fit = min(pw / aw, ph / ah)
            to_paper = np.array([[fit, 0.0, -aw * fit / 2.0], [0.0, fit, -ah * fit / 2.0], [0.0, 0.0, 1.0]])
            painted = _warp(art, paper.paper_matrix @ to_paper, (w, h))
            paper_mask = painted[:, :, 3]
            composite(painted, prop_key)
            paper_art_sha = _sha(art.tobytes())
        prop_masks[prop.prop_id] = paper_mask
        prop_art_hashes[prop.prop_id] = paper_art_sha
        prop_rows.append(
            {
                "prop_id": prop.prop_id,
                "state": paper.state,
                "holders": paper.holders,
                "matrix": paper.paper_matrix.tolist(),
                "paper_size": list(paper.paper_size),
                "art_sha256": paper_art_sha,
                "front_limb_parts": list(prop.front_limb_parts),
            }
        )
        ready = [part for part, indices in front_groups.items() if indices[-1] == prop_index]
        for part in sorted(ready, key=lambda nm: pending[nm]["order"]):
            rec = pending.pop(part)
            layer = rec["image"].copy()
            layer[:, :, 3] = np.uint8(np.clip(rec["alpha"], 0.0, 1.0) * 255.0)
            composite(layer, part, original_order=rec["order"])

    if pending:
        raise ValueError(f"Declared foreground arm part was never composited: {sorted(pending)}")

    for key, mask, color in hand_layers:
        if color is None:
            composite(mask, f"{key}:hand")
        else:
            colored(mask, color, f"{key}:hand")

    # 5. Foreground parallax with strict occlusion matte check
    if foreground is not None:
        fg = _rgba(foreground, (w, h))
        if foreground_occlusion_mask is None:
            raise ValueError("Foreground requires explicit matching occlusion matte")
        declared = np.asarray(foreground_occlusion_mask)
        if declared.ndim == 3:
            declared = declared[:, :, 3] if declared.shape[2] == 4 else declared[:, :, 0]
        if declared.shape != (h, w) or float(np.max(np.abs(declared.astype(float) - fg[:, :, 3]))) > 1.0:
            raise ValueError("Foreground alpha differs from declared occlusion matte")
        composite(fg)

    beauty = Image.fromarray(np.uint8(np.clip(canvas, 0.0, 1.0) * 255.0))
    parts = {k: np.uint8(np.clip(a, 0.0, 1.0) * 255.0) for k, a in visible.items()}
    raw8 = {k: np.uint8(np.clip(a, 0.0, 1.0) * 255.0) for k, a in raw.items()}

    # 6. Post-composite pixel integrity audits (same rigor as b6_puppet.py)
    limb_masks: dict[str, np.ndarray] = {}
    pixel_rows: list[dict[str, Any]] = []

    for row in neck_rows:
        if row["mount_center_in_frame"] and not row["actual_main_alpha_connected"]:
            errors.append(f"{row['actor_id']}: actual rendered head/body alpha disconnected at neck mount")

    for row in arm_rows:
        key = row["limb_id"]
        a, spec, ch = arm_specs[key]
        scale = _scale(a.placement)
        keys = [f"{key}:{part}" for part in ("upper", "forearm", "hand")]
        union = np.maximum.reduce([parts[k] for k in keys])
        limb_masks[key] = union
        fractions = {
            p: (_sum(parts[f"{key}:{p}"]) / _sum(raw8[f"{key}:{p}"]) if _sum(raw8[f"{key}:{p}"]) > 1e-8 else None)
            for p in ("upper", "forearm", "hand")
        }
        clipped = {p: fractions[p] is None for p in fractions}
        for p, fval in fractions.items():
            if fval is not None and fval < spec.visibility_min[p]:
                errors.append(f"{key}: {p} not sufficiently readable after actual occlusion")
        cuff = cuff_masks[key]
        band = _dilate(cuff, max(2, spec.ink_width * scale * 1.5))
        root_touch = bool(np.any((parts[f"{key}:upper"] > 32) & band))
        socket_n = runtime._ellipse_mask((w, h), ch[0], [max(3, spec.ink_width * scale * 2)] * 2) > 0
        cuff_at_socket = bool(np.any((cuff > 32) & socket_n))
        outlet = np.array([_point(a.placement, pt) for pt in spec.outlet_segment])
        outlet_band = runtime._line_mask((w, h), outlet[0], outlet[1], max(4.0, spec.ink_width * scale * 3.0), "opening")
        outlet_touch = bool(np.any((parts[f"{key}:upper"] > 32) & (outlet_band > 32)))
        wrist_touch = bool(np.any(_dilate(parts[f"{key}:forearm"], max(1.0, spec.ink_width * scale * 0.5)) & (parts[f"{key}:hand"] > 32)))
        upper_fore = bool(np.any(_dilate(parts[f"{key}:upper"], max(1.0, spec.ink_width * scale * 0.5)) & (parts[f"{key}:forearm"] > 32)))
        root_in_frame = _inside_canvas((w, h), ch[0])
        ink_join = np.asarray(row.get("ink_midpoint_screen", ch[1]), dtype=float)
        join_in_frame = _inside_canvas((w, h), ink_join)
        wrist_in_frame = _inside_canvas((w, h), ch[2])
        if root_in_frame and not (root_touch and cuff_at_socket and outlet_touch):
            errors.append(f"{key}: visible root does not emerge through actual cuff neighborhood")
        if wrist_in_frame and not wrist_touch:
            errors.append(f"{key}: actual forearm/hand alpha disconnected")
        if join_in_frame and not upper_fore:
            errors.append(f"{key}: actual upper/forearm alpha disconnected")
        row.update(
            visible_fraction=fractions,
            viewport_clipped_parts=clipped,
            root_in_frame=root_in_frame,
            elbow_in_frame=_inside_canvas((w, h), ch[1]) if spec.ink_path is None else None,
            wrist_in_frame=wrist_in_frame,
            root_cuff_contact=root_touch,
            cuff_at_socket=cuff_at_socket,
            actual_outlet_contact=outlet_touch,
            wrist_hand_connected=wrist_touch,
            ink_halves_connected=upper_fore,
        )
        pixel_rows.append({"limb_id": key, "visible_pixels": int(np.count_nonzero(union > 32))})

    for row in leg_rows:
        key = row["limb_id"]
        limb_masks[key] = np.maximum(parts[f"{key}:shaft"], parts[f"{key}:foot"])
        connected = bool(np.any(_dilate(parts[f"{key}:shaft"], 2.5) & (parts[f"{key}:foot"] > 32)))
        row["ankle_foot_connected"] = connected
        row["ankle_in_frame"] = _inside_canvas((w, h), row["ankle"])
        row["viewport_clipped"] = not bool(np.any(raw8[f"{key}:shaft"]) or np.any(raw8[f"{key}:foot"]))
        if row["ankle_in_frame"] and not connected:
            errors.append(f"{key}: articulated leg disconnected from foot")
        pixel_rows.append({"limb_id": key, "visible_pixels": int(np.count_nonzero(limb_masks[key] > 32))})

    for prop in prop_frames:
        paper = prop.contact
        paper_mask = prop_masks[prop.prop_id]
        for q in paper.holders:
            key = f"{q['actor_id']}:arm:{q['arm']}"
            if key not in arm_specs:
                errors.append(f"Prop holder absent from cast: {key}")
                continue
            _, spec, ch = arm_specs[key]
            local = (np.asarray(q["grip"]) - 0.5) * paper.paper_size
            grip = _point(paper.paper_matrix, local)
            err_px = float(np.linalg.norm(ch[2] - grip))
            hand = parts[f"{key}:hand"]
            near = runtime._ellipse_mask((w, h), grip, [max(2.0, spec.hand_radius)] * 2) > 0
            touches = bool(np.any((hand > 32) & _dilate(paper_mask, 2)))
            actual_grip = bool(np.any((hand > 32) & near))
            grip_in_frame = _inside_canvas((w, h), grip)
            grip_rows.append(
                {
                    "prop_id": prop.prop_id,
                    "limb_id": key,
                    "state": paper.state,
                    "grip": grip.tolist(),
                    "wrist": ch[2].tolist(),
                    "error_px": err_px,
                    "actual_hand_at_grip": actual_grip,
                    "actual_hand_paper_touch": touches,
                    "grip_in_frame": grip_in_frame,
                }
            )
            if err_px > 0.75 or (grip_in_frame and (not actual_grip or not touches)):
                errors.append(f"{key}: independent rendered prop/hand contact failed")

    id_image = np.zeros((h, w), np.uint32)
    id_codes: dict[str, int] = {}
    for key, mask in parts.items():
        code = (zlib.crc32(key.encode()) & 0x7FFFFFFF) or 1
        while code in id_codes.values():
            code += 1
        id_codes[key] = code
        id_image[mask > 32] = code

    qa = {
        "schema": "b6-puppet-render/1",
        "motion_schema": "b6-studio-articulated/1",
        "frame_index": frame_index,
        "errors": errors,
        "actors": [
            {
                "actor_id": a.actor_id,
                "character_id": a.character.character_id,
                "package_fingerprint": a.character.fingerprint,
                "view_id": a.view.view_id,
                "art_hashes": dict(a.character.art_hashes),
                "head_variant": a.head_variant,
                "head_angle_deg": a.head_angle_deg,
                "head_anchor": a.view.head_anchor.tolist(),
            }
            for a in actors
        ],
        "arms": arm_rows,
        "legs": leg_rows,
        "neck_records": neck_rows,
        "contact_errors": [r["error_px"] for r in grip_rows],
        "arm_records": arm_rows,
        "leg_records": leg_rows,
        "contact_records": grip_rows,
        "limb_ids": sorted(limb_masks),
        "arm_ids": sorted(r["limb_id"] for r in arm_rows),
        "leg_ids": sorted(r["limb_id"] for r in leg_rows),
        "part_id_codes": id_codes,
        "mask_sha256": {k: _sha(v.tobytes()) for k, v in parts.items()},
        "limb_mask_sha256": {k: _sha(v.tobytes()) for k, v in limb_masks.items()},
        "beauty_sha256": _sha(np.asarray(beauty).tobytes()),
        "id_sha256": _sha(id_image.tobytes()),
        "props": prop_rows,
        "prop_art_hashes": prop_art_hashes,
        "foreground_occlusion_declared": foreground is not None,
        "visual_review_required": True,
        "pixel_evidence": pixel_rows,
    }
    if runtime is not None and hasattr(runtime, "RenderResult"):
        return runtime.RenderResult(beauty, limb_masks, parts, id_image, qa)
    return _StandaloneRenderResult(beauty, limb_masks, parts, id_image, qa)
