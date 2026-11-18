import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CanonicalScenePlan,
  CaptionCue,
  DirectorBeat,
  EditorialMode,
  EditorialProfile,
  EditorSyncState,
  MotionMode,
  Ratio,
  ShotEasing,
  ShotItem,
} from '@b6-studio/shared';
import { CanonicalScenePlanSchema } from '@b6-studio/shared';
import { readJsonFile, resolveInsideRoot } from '../utils/fs-safe.js';
import type { ProjectDetail } from './project-service.js';

export interface FieldRuntimeBindingRow {
  uiField: string;
  jsonPath: string;
  pythonFunction: string;
  affectedRegion: string;
  verificationMethod: string;
  liveBound: boolean;
}

export interface EditorBindingStatus {
  mode: 'bound_canonical' | 'authored_custom_scene';
  syncState: EditorSyncState;
  revision: number;
  lastRenderedRevision: number | null;
  voiceStale: boolean;
  canSynthesizeLocalVoice: boolean;
  motionEngineMode: 'legacy_stance' | 'articulated_v1' | 'articulated_verified';
  motionQcVerified: boolean;
  gaitHonestyNote: string;
  editorialMode: 'none' | 'editorial_v1' | 'editorial_verified';
  editorialQcVerified: boolean;
  shotVarietyWarnings: string[];
  mappings: FieldRuntimeBindingRow[];
}

export const FIELD_RUNTIME_MAPPINGS: Omit<FieldRuntimeBindingRow, 'liveBound'>[] = [
  {
    uiField: 'Camera Keyframes (t, x, y, z, fov, easing)',
    jsonPath: 'scene-control.json -> shots[].cameraKeys[]',
    pythonFunction: 'scene_runtime.camera_at(context, t, base_cam)',
    affectedRegion: 'Toàn khung hình (chiếu 2.5D background, foreground, nhân vật & prop)',
    verificationMethod: 'Sửa cameraKeys[i].x/z -> preview đoạn shot -> kiểm tra decoded frame pixel MAD & dời tọa độ chủ thể',
  },
  {
    uiField: 'Shot Actor Staging & Arm/Head Pose (actorStart/actorEnd)',
    jsonPath: 'scene-control.json -> shots[].{actorStart, actorEnd}',
    pythonFunction: 'scene_runtime.actor_state_at(context, t)',
    affectedRegion: 'Vị trí cơ thể, góc gật đầu (<=±20°) & biên độ tay (ArmTrack)',
    verificationMethod: 'Sửa actorStart.x / headAngleDeg / armAction -> so sánh screen placement & armature limb_masks',
  },
  {
    uiField: 'Biểu cảm nhân vật (Shot.expression)',
    jsonPath: 'scene-control.json -> shots[].expression',
    pythonFunction: 'scene_runtime.actor_state_at(context, t)["expression"]',
    affectedRegion: 'Head sprite crop (head_variant) bên trên neck_attachment',
    verificationMethod: 'Đổi neutral/shocked/determined/deadpan -> kiểm tra head_variant trong report & decoded crop',
  },
  {
    uiField: 'Đạo cụ & tiếp xúc tay (propKeyframes)',
    jsonPath: 'scene-control.json -> shots[].propKeyframes[]',
    pythonFunction: 'scene_runtime.prop_state_at(context, prop_id, t)',
    affectedRegion: 'Vùng đạo cụ + grip hand target (<0.5px error)',
    verificationMethod: 'Dịch x/y/t propKeyframes -> chạy preflight/frames -> đo contact error & pixel shift',
  },
  {
    uiField: 'Phụ đề đồng bộ (captions.json)',
    jsonPath: 'captions.json + scene-control.json -> captions[]',
    pythonFunction: 'caption_renderer.CaptionRenderer (b6_production.py)',
    affectedRegion: 'Vùng band portrait [864..951] (Archivo Black 47px)',
    verificationMethod: 'Đổi start/end/text khớp narration -> review-pack caption-*.png',
  },
  {
    uiField: 'Lời thoại & Âm thanh (story.narration + project.voice)',
    jsonPath: 'story.json.narration + project.json.voice',
    pythonFunction: 'b6_production.load() (ffprobe + voice SHA check) + Local SAPI TTS',
    affectedRegion: 'Audio stream MP4 & narration alignment',
    verificationMethod: 'Đổi narration làm voiceStale=true (chặn technical PASS) cho tới khi tạo lại hoặc import WAV khớp',
  },
  {
    uiField: 'Articulated Motion & Gait (preset, cadenceHz, strideLen, footLift, world X)',
    jsonPath: 'scene-control.json -> shots[].motion.{preset, startX, endX, gait}',
    pythonFunction: 'scene_runtime.motion_state_at(context, t) + b6_motion_core.sample_gait()',
    affectedRegion: 'Chuyển động 2-bone bent-knee IK, foot world-lock, pelvis drop & counter-swing',
    verificationMethod: 'Sửa motion.preset/strideLen/footLift -> draft/preview -> kiểm tra motion_evidence.json & decoded limb masks',
  },
  {
    uiField: 'Camera & Visual Beats Director (cameraPreset, visualBeat, directorBeats)',
    jsonPath: 'scene-control.json -> {shots[].cameraPreset, directorBeats[]}',
    pythonFunction: 'scene_runtime.camera_director_at(context, t) + director_beat_at(context, t)',
    affectedRegion: 'Khung hình có chủ đích theo nhịp kể chuyện (hook/action/escalation/payoff)',
    verificationMethod: 'Đổi cameraPreset / visualBeat -> kiểm tra shot trace & contact sheet framing',
  },
  {
    uiField: 'Editorial Director (role, shotSize, focus, cameraMovement, transition, intensity, pacingAdvice)',
    jsonPath: 'scene-control.json -> {editorialMode, editorialProfile, shots[].editorial}',
    pythonFunction: 'scene_runtime.editorial_state_at(context, t, sem) + camera_editorial_at(...)',
    affectedRegion: 'Cỡ cảnh (extreme_close/close/insert/medium/wide), mục tiêu focus (actor/eyes/prop), look-ahead & bảo vệ vùng phụ đề',
    verificationMethod: 'Đổi shotSize / focus.targetKind / transition / cameraMovement -> preview -> kiểm tra pixel MAD & decoded shot scale',
  },
];

export const SCENE_RUNTIME_PY_SOURCE = `"""Canonical editor-to-renderer runtime adapter for B6 Local Studio.

Pure deterministic evaluator over project-local \`scene-control.json\`.
Zero eval/exec; works identically for full native \`frame(t, c)\` and \`draft_frame(t, c)\`.
"""
from __future__ import annotations
import json
import math
from typing import Any

_PLAN_CACHE: dict[tuple[str, str], dict[str, Any]] = {}
_EDITORIAL_CACHE: dict[tuple[str, str], Any] = {}


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


def motion_state_at(context, t: float, default_x: float = 0.0, default_y: float = 0.0) -> dict[str, Any]:
    plan = load_scene_plan(context)
    shot, u = shot_at(context, t)
    default_mode = str(plan.get("motionMode") or "legacy_stance")
    if not shot:
        return {
            "shot_id": "",
            "mode": default_mode,
            "preset": "idle",
            "start_s": 0.0,
            "end_s": 0.0,
            "start_x": float(default_x),
            "end_x": float(default_x),
            "start_y": float(default_y),
            "end_y": float(default_y),
            "easing": "smooth",
            "cadence_hz": 2.0,
            "stride_len": 110.0,
            "foot_lift": 28.0,
            "target_speed": 0.0,
            "pelvis_drop": 4.0,
            "arm_swing_amp": 0.32,
            "anticipate_s": 0.16,
            "settle_s": 0.18,
            "step_count_override": None,
            "facing": 1,
            "contacts": [],
            "head_variant": None,
            "visual_beat": None,
            "camera_preset": "establish",
            "u": 0.0,
        }
    m = shot.get("motion") or {}
    g = m.get("gait") or {}
    st = shot.get("actorStart") or {}
    en = shot.get("actorEnd") or st
    actor_name = str(shot.get("actor") or "")
    staging_entry = (shot.get("staging") or {}).get(actor_name) or {}
    sx = float(m.get("startX", st.get("x", staging_entry.get("x", default_x))))
    ex = float(m.get("endX", en.get("x", sx)))
    sy = float(m.get("startY", st.get("y", staging_entry.get("y", default_y))))
    ey = float(m.get("endY", en.get("y", sy)))
    facing = int(-1 if int(g.get("facing", 1 if ex >= sx else -1)) < 0 else 1)
    head_var = m.get("headVariant") or shot.get("expression") or None
    if head_var in ("", "neutral", "default"):
        head_var = None
    return {
        "shot_id": str(shot.get("id") or ""),
        "mode": str(m.get("mode") or shot.get("motionMode") or default_mode),
        "preset": str(m.get("preset") or ("walk" if abs(ex - sx) > 8.0 and (en.get("strideCycles", 0) or st.get("strideCycles", 0)) else "idle")),
        "start_s": float(shot.get("start", 0.0)),
        "end_s": float(shot.get("end", 0.0)),
        "start_x": sx,
        "end_x": ex,
        "start_y": sy,
        "end_y": ey,
        "easing": str(shot.get("easing") or "smooth"),
        "cadence_hz": float(g.get("cadenceHz", 2.0)),
        "stride_len": float(g.get("strideLen", 110.0)),
        "foot_lift": float(g.get("footLift", 28.0)),
        "target_speed": float(g.get("targetSpeed", 0.0)),
        "pelvis_drop": float(g.get("pelvisDrop", 4.0)),
        "arm_swing_amp": float(g.get("armSwingAmp", 0.32)),
        "anticipate_s": float(g.get("anticipateS", 0.16)),
        "settle_s": float(g.get("settleS", 0.18)),
        "step_count_override": g.get("stepCountOverride"),
        "facing": facing,
        "contacts": list(m.get("contacts") or []),
        "head_variant": head_var,
        "visual_beat": m.get("visualBeat") or shot.get("visualBeat"),
        "camera_preset": m.get("cameraPreset") or shot.get("cameraPreset") or "establish",
        "u": u,
    }


def director_beat_at(context, t: float) -> dict[str, Any] | None:
    plan = load_scene_plan(context)
    beats = plan.get("directorBeats") or []
    tc = max(0.0, float(t))
    for b in beats:
        b0 = float(b.get("start", 0.0))
        b1 = float(b.get("end", 0.0))
        if b0 <= tc < b1:
            return dict(b)
    return dict(beats[-1]) if beats else None


def camera_director_at(context, t: float, base_cam=None, focus_world_xy: tuple[float, float] | None = None):
    compiled = _get_compiled_editorial(context)
    if compiled is not None:
        try:
            import b6_editorial_director as ed
            Cam = context.space.Camera
            plan = load_scene_plan(context)
            w = int(plan.get("width", 720))
            h = int(plan.get("height", 1280))
            b_cam = base_cam if base_cam is not None else Cam(
                width=w, height=h, focal=1040.0 * w / 720.0, x=0.0, y=-210.0, z=180.0, principal_y=round(h * 0.44)
            )
            sem = None
            if focus_world_xy is not None:
                sem = {
                    "targets": {
                        "primary": [float(focus_world_xy[0]), float(focus_world_xy[1])],
                        "actor_head:default": [float(focus_world_xy[0]), float(focus_world_xy[1]) - 240.0],
                        "actor_eyes:default": [float(focus_world_xy[0]), float(focus_world_xy[1]) - 265.0],
                    }
                }
            return ed.resolve_editorial_camera(compiled, t, b_cam, scene_semantics=sem, camera_cls=Cam)
        except Exception:
            pass
    cam = camera_at(context, t, base_cam=base_cam)
    ms = motion_state_at(context, t)
    preset = str(ms.get("camera_preset") or "establish")
    if focus_world_xy is None or preset == "establish":
        return cam
    Cam = context.space.Camera
    fx, fy = float(focus_world_xy[0]), float(focus_world_xy[1])
    focal = float(cam.focal)
    cx, cy, cz = float(cam.x), float(cam.y), float(cam.z)
    if preset == "follow":
        cx = _lerp(cx, fx, 0.55)
    elif preset == "reaction_closeup":
        cx = _lerp(cx, fx, 0.72)
        cy = _lerp(cy, fy - 245.0, 0.55)
        focal = focal * 1.12
    elif preset == "object_insert":
        cx = _lerp(cx, fx, 0.78)
        focal = focal * 1.18
    elif preset == "impact":
        cx = _lerp(cx, fx, 0.65)
        focal = focal * 1.08
    return Cam(
        width=cam.width,
        height=cam.height,
        focal=float(focal),
        x=float(cx),
        y=float(cy),
        z=float(cz),
        principal_y=cam.principal_y,
        near=getattr(cam, "near", 1.0),
    )


def _get_compiled_editorial(context):
    key = (str(context.base), str(getattr(context, "fingerprint", "")))
    if key in _EDITORIAL_CACHE:
        return _EDITORIAL_CACHE[key]
    plan = load_scene_plan(context)
    if str(plan.get("editorialMode") or "none") != "editorial_v1":
        _EDITORIAL_CACHE[key] = None
        return None
    try:
        import b6_editorial_contract as ec
        compiled = ec.compile_editorial_timeline(plan, strict=False)
        _EDITORIAL_CACHE[key] = compiled
        return compiled
    except Exception:
        _EDITORIAL_CACHE[key] = None
        return None


def editorial_state_at(context, t: float, scene_semantics: dict[str, Any] | None = None) -> dict[str, Any]:
    compiled = _get_compiled_editorial(context)
    plan = load_scene_plan(context)
    w = int(plan.get("width", 720))
    h = int(plan.get("height", 1280))
    if compiled is not None:
        try:
            import b6_editorial_director as ed
            return ed.editorial_state_at(compiled, t, scene_semantics, width=w, height=h)
        except Exception:
            pass
    shot, u = shot_at(context, t)
    cam = camera_director_at(context, t)
    ed_cfg = (shot or {}).get("editorial") or {}
    return {
        "schema": "b6-studio-editorial/legacy-fallback",
        "t": round(float(t), 5),
        "shot_id": (shot or {}).get("id", ""),
        "role": ed_cfg.get("role", "reveal"),
        "shot_size": ed_cfg.get("shotSize", "medium"),
        "camera_movement": ed_cfg.get("cameraMovement", "hold"),
        "intensity": ed_cfg.get("intensity", "normal"),
        "pacing_advice": ed_cfg.get("pacingAdvice", "auto"),
        "shot_u": round(u, 5),
        "camera": {"width": cam.width, "height": cam.height, "x": cam.x, "y": cam.y, "z": cam.z, "focal": cam.focal, "principal_y": cam.principal_y},
    }


def camera_editorial_at(context, t: float, base_cam=None, scene_semantics: dict[str, Any] | None = None):
    Cam = context.space.Camera
    plan = load_scene_plan(context)
    w = int(plan.get("width", 720))
    h = int(plan.get("height", 1280))
    if base_cam is None:
        base_cam = Cam(width=w, height=h, focal=1040.0 * w / 720.0, x=0.0, y=-210.0, z=180.0, principal_y=round(h * 0.44))
    compiled = _get_compiled_editorial(context)
    if compiled is not None:
        try:
            import b6_editorial_director as ed
            return ed.resolve_editorial_camera(compiled, t, base_cam, scene_semantics=scene_semantics, camera_cls=Cam)
        except Exception:
            pass
    focus_xy = None
    if scene_semantics and isinstance(scene_semantics.get("targets"), dict):
        first_pt = next(iter(scene_semantics["targets"].values()), None)
        if first_pt and len(first_pt) >= 2:
            focus_xy = (float(first_pt[0]), float(first_pt[1]))
    return camera_director_at(context, t, base_cam=base_cam, focus_world_xy=focus_xy)


def qa_trace_at(context, t: float) -> dict[str, Any]:
    shot, u = shot_at(context, t)
    cam = camera_at(context, t)
    actor = actor_state_at(context, t)
    ms = motion_state_at(context, t)
    beat = director_beat_at(context, t)
    ed = editorial_state_at(context, t)
    return {
        "t": round(float(t), 4),
        "shot_id": shot.get("id") if shot else None,
        "u": round(u, 4),
        "camera": {"x": round(cam.x, 2), "y": round(cam.y, 2), "z": round(cam.z, 2), "focal": round(cam.focal, 2)},
        "actor": {"x": round(actor["x"], 2), "y": round(actor["y"], 2), "head_angle_deg": round(actor["head_angle_deg"], 2), "expression": actor["expression"]},
        "motion": {"mode": ms["mode"], "preset": ms["preset"], "camera_preset": ms["camera_preset"], "visual_beat": ms["visual_beat"]},
        "editorial": {"shot_size": ed.get("shot_size"), "role": ed.get("role"), "camera_movement": ed.get("camera_movement")},
        "director_beat": beat.get("beatKind") if beat else None,
    }
`;

export class EditorBindingService {
  buildCanonicalScenePlan(params: {
    revision: number;
    ratio: Ratio;
    width: number;
    height: number;
    duration: number;
    narration: string;
    voiceSha256: string | null;
    voiceTextSha256: string | null;
    motionMode?: MotionMode;
    editorialMode?: EditorialMode;
    editorialProfile?: EditorialProfile;
    directorBeats?: DirectorBeat[];
    shots: ShotItem[];
    captions: CaptionCue[];
  }): CanonicalScenePlan {
    const narrationSha = crypto.createHash('sha256').update(params.narration.trim(), 'utf8').digest('hex');
    const voiceStale = Boolean(
      params.voiceSha256 &&
        params.voiceTextSha256 &&
        narrationSha !== params.voiceTextSha256,
    );

    const plan: CanonicalScenePlan = {
      schema: 'b6-studio-scene-control/1',
      revision: params.revision,
      ratio: params.ratio,
      width: params.width,
      height: params.height,
      fps: 30,
      duration: params.duration,
      narration: params.narration,
      voice_sha256: params.voiceSha256,
      narration_sha256: narrationSha,
      voice_stale: voiceStale,
      ...(params.motionMode ? { motionMode: params.motionMode } : {}),
      ...(params.editorialMode ? { editorialMode: params.editorialMode } : {}),
      ...(params.editorialProfile ? { editorialProfile: params.editorialProfile } : {}),
      ...(params.directorBeats?.length ? { directorBeats: params.directorBeats } : {}),
      shots: params.shots,
      captions: params.captions,
      updatedAt: new Date().toISOString(),
    };
    return CanonicalScenePlanSchema.parse(plan);
  }

  async validateCanonicalScenePlan(
    plan: CanonicalScenePlan,
    projectDir: string,
  ): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const regPath = path.join(projectDir, 'characters.json');
    const knownActors = new Set<string>();
    const actorExpressions = new Map<string, Set<string>>();

    if (fs.existsSync(regPath)) {
      try {
        const reg = await readJsonFile<{ actors?: Array<{ id: string; package: string; views: string[] }> }>(regPath);
        for (const a of reg.actors ?? []) {
          knownActors.add(a.id);
          const pkgPath = resolveInsideRoot(projectDir, `${a.package.replace(/\/+$/, '')}/package.json`, false);
          if (fs.existsSync(pkgPath)) {
            const pkg = await readJsonFile<{ views?: Record<string, { sprites?: { heads?: Record<string, unknown> } }> }>(pkgPath);
            const exprSet = new Set<string>(['', 'neutral', 'default']);
            for (const v of Object.values(pkg.views ?? {})) {
              for (const k of Object.keys(v.sprites?.heads ?? {})) {
                exprSet.add(k);
              }
            }
            actorExpressions.set(a.id, exprSet);
          }
        }
      } catch {
        errors.push('Không đọc được characters.json để đối chiếu nhân vật.');
      }
    }

    let cursor = 0;
    for (const sh of plan.shots) {
      if (Math.abs(sh.start - cursor) > 0.001) {
        errors.push(`Canonical plan: shot "${sh.id}" không liên tục (${sh.start}s vs ${cursor.toFixed(3)}s).`);
      }
      if (!Number.isFinite(sh.end) || sh.end <= sh.start) {
        errors.push(`Canonical plan: thời lượng shot "${sh.id}" không hợp lệ.`);
      }
      if (knownActors.size > 0 && sh.actor && !knownActors.has(sh.actor)) {
        errors.push(`Canonical plan: nhân vật "${sh.actor}" trong shot "${sh.id}" chưa đăng ký trong characters.json.`);
      }
      const validExpr = actorExpressions.get(sh.actor);
      if (validExpr && sh.expression && !validExpr.has(sh.expression)) {
        errors.push(`Canonical plan: biểu cảm "${sh.expression}" chưa có trong sprites.heads của "${sh.actor}".`);
      }
      const shotUsesArticulated = (sh.motion?.mode ?? sh.motionMode ?? plan.motionMode) === 'articulated_v1';
      if (!shotUsesArticulated && ((sh.actorStart?.strideCycles ?? 0) > 0 || (sh.actorEnd?.strideCycles ?? 0) > 0)) {
        warnings.push(`Shot "${sh.id}": stride dùng stance-envelope ±25% (không thay thế full walk/run gait PASS).`);
      }
      if (sh.motion?.contacts) {
        const seenContactIds = new Set<string>();
        const span = sh.end - sh.start + 0.001;
        for (const c of sh.motion.contacts) {
          if (seenContactIds.has(c.id)) {
            errors.push(`Canonical plan: trùng contact id "${c.id}" trong shot "${sh.id}".`);
          }
          seenContactIds.add(c.id);
          if (c.t1 > span) {
            errors.push(`Canonical plan: contact "${c.id}" (${c.t1}s) vượt quá thời lượng shot "${sh.id}".`);
          }
        }
      }
      for (const pk of sh.propKeyframes ?? []) {
        if (pk.t > sh.end - sh.start + 0.001) {
          errors.push(`Canonical plan: propKeyframe "${pk.propId}" tại t=${pk.t}s vượt quá shot "${sh.id}".`);
        }
      }
      for (const aRef of sh.asset_inputs ?? []) {
        try {
          resolveInsideRoot(projectDir, aRef, true);
        } catch {
          errors.push(`Canonical plan: asset_inputs "${aRef}" không tồn tại hoặc vượt phạm vi dự án.`);
        }
      }

      // Editorial Director validation when editorialMode === 'editorial_v1' or shot.editorial is set
      if (plan.editorialMode === 'editorial_v1' || sh.editorial) {
        const span = sh.end - sh.start;
        if (span > 0 && span < 3 / 30) {
          errors.push(`Canonical plan: shot "${sh.id}" quá ngắn (${span.toFixed(3)}s < 3 frames), vi phạm quy tắc chống nhấp nháy.`);
        }
        const ed = sh.editorial;
        if (ed) {
          const reason = (sh.short_cut_reason ?? '').trim() || (ed.transition?.reason ?? '').trim();
          if (span < 0.9 && !reason) {
            errors.push(`Canonical plan: shot "${sh.id}" (<0.9s) thiếu lý do chuyển cảnh (transition.reason / short_cut_reason).`);
          }
          if (ed.actionOnsetS !== undefined && (ed.actionOnsetS < sh.start - 0.002 || ed.actionOnsetS > sh.end + 0.002)) {
            errors.push(`Canonical plan: actionOnsetS (${ed.actionOnsetS}s) nằm ngoài khoảng shot "${sh.id}".`);
          }
          if (ed.focus.targetKind.startsWith('actor_')) {
            const targetActor = (ed.focus.actorId || sh.actor || '').trim();
            if (!targetActor) {
              errors.push(`Canonical plan: shot "${sh.id}" đặt focus "${ed.focus.targetKind}" nhưng thiếu actorId.`);
            } else if (knownActors.size > 0 && !knownActors.has(targetActor)) {
              errors.push(`Canonical plan: focus actor "${targetActor}" trong shot "${sh.id}" không tồn tại trong characters.json.`);
            }
          }
          if (ed.focus.targetKind === 'prop') {
            const targetProp = (ed.focus.propId || '').trim();
            if (!targetProp) {
              errors.push(`Canonical plan: shot "${sh.id}" đặt focus "prop" nhưng thiếu propId.`);
            } else {
              const knownInShot =
                (sh.props ?? []).some((p) => p === targetProp || p.includes(targetProp)) ||
                (sh.propKeyframes ?? []).some((pk) => pk.propId === targetProp) ||
                (sh.asset_inputs ?? []).some((a) => a.includes(targetProp));
              if (!knownInShot) {
                errors.push(`Canonical plan: prop focus "${targetProp}" trong shot "${sh.id}" chưa có trong props/propKeyframes/asset_inputs.`);
              }
            }
          }
        }
      }
      cursor = sh.end;
    }

    if (plan.shots.length > 0 && Math.abs(cursor - plan.duration) > 1 / 30) {
      errors.push(`Canonical plan: tổng shot (${cursor.toFixed(3)}s) lệch duration (${plan.duration}s).`);
    }

    if (plan.editorialMode === 'editorial_v1' && plan.shots.length >= 2) {
      const sizes = new Set<string>();
      for (let i = 0; i < plan.shots.length; i++) {
        const curEd = plan.shots[i].editorial;
        if (curEd) sizes.add(curEd.shotSize);
        if (i > 0 && curEd && plan.shots[i - 1].editorial) {
          const prevEd = plan.shots[i - 1].editorial!;
          if (
            prevEd.shotSize === curEd.shotSize &&
            prevEd.focus.targetKind === curEd.focus.targetKind &&
            prevEd.focus.actorId === curEd.focus.actorId &&
            prevEd.focus.propId === curEd.focus.propId &&
            prevEd.cameraMovement === curEd.cameraMovement &&
            curEd.transition.kind === 'hard_cut'
          ) {
            warnings.push(
              `Shot "${plan.shots[i - 1].id}" -> "${plan.shots[i].id}" lặp cùng cỡ cảnh (${curEd.shotSize}) và mục tiêu focus.`,
            );
          }
        }
      }
      if (plan.shots.length >= 3 && sizes.size === 1) {
        warnings.push(`Toàn bộ ${plan.shots.length} shots chỉ dùng một cỡ cảnh (${Array.from(sizes)[0]}).`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async resolveBindingStatus(
    projectDir: string,
    detail: ProjectDetail,
    qaState: {
      voiceStale: boolean;
      technicalStatus: string;
      editorSyncState: EditorSyncState;
      motionQcStatus?: string;
      editorialQcStatus?: string;
    },
  ): Promise<EditorBindingStatus> {
    const hasRuntimeFile = fs.existsSync(path.join(projectDir, 'scene_runtime.py'));
    const hasControlFile = fs.existsSync(path.join(projectDir, 'scene-control.json'));
    const sceneImportsRuntime = detail.scenePy.includes('scene_runtime');
    const isBound = hasRuntimeFile && hasControlFile && sceneImportsRuntime;

    let optsArticulated = detail.projectJson?.motion_mode === 'articulated_v1';
    let optsEditorial = detail.projectJson?.editorial_mode === 'editorial_v1';
    const shotVarietyWarnings: string[] = [];
    if (hasControlFile) {
      try {
        const ctrl = await readJsonFile<{
          motionMode?: string;
          editorialMode?: string;
          shots?: Array<{
            id?: string;
            motion?: { mode?: string };
            motionMode?: string;
            editorial?: {
              shotSize?: string;
              cameraMovement?: string;
              focus?: { targetKind?: string; actorId?: string; propId?: string };
            };
          }>;
        }>(path.join(projectDir, 'scene-control.json'));
        if (!optsArticulated) {
          optsArticulated =
            ctrl?.motionMode === 'articulated_v1' ||
            Boolean(ctrl?.shots?.some((s) => (s.motion?.mode ?? s.motionMode) === 'articulated_v1'));
        }
        if (!optsEditorial) {
          optsEditorial = ctrl?.editorialMode === 'editorial_v1';
        }
        const shots = ctrl?.shots ?? [];
        for (let i = 1; i < shots.length; i++) {
          const prev = shots[i - 1]?.editorial;
          const cur = shots[i]?.editorial;
          if (
            prev &&
            cur &&
            prev.shotSize === cur.shotSize &&
            prev.focus?.targetKind === cur.focus?.targetKind &&
            prev.focus?.actorId === cur.focus?.actorId &&
            prev.cameraMovement === cur.cameraMovement
          ) {
            shotVarietyWarnings.push(
              `Shot "${shots[i - 1].id ?? i}" -> "${shots[i].id ?? i + 1}" lặp cỡ cảnh (${cur.shotSize}) và focus.`,
            );
          }
        }
      } catch {
        // preserve projectJson defaults
      }
    }
    const hasArticulatedFiles =
      fs.existsSync(path.join(projectDir, 'b6_motion_core.py')) &&
      fs.existsSync(path.join(projectDir, 'b6_motion_render.py')) &&
      fs.existsSync(path.join(projectDir, 'b6_motion_qc.py'));
    const hasEditorialFiles =
      fs.existsSync(path.join(projectDir, 'b6_editorial_contract.py')) &&
      fs.existsSync(path.join(projectDir, 'b6_editorial_director.py'));
    const qcPassed = qaState.motionQcStatus === 'pass' && qaState.technicalStatus === 'pass';
    const edQcPassed = qaState.editorialQcStatus === 'pass' && qaState.technicalStatus === 'pass';
    const motionEngineMode: EditorBindingStatus['motionEngineMode'] = !optsArticulated
      ? 'legacy_stance'
      : qcPassed && hasArticulatedFiles
      ? 'articulated_verified'
      : 'articulated_v1';
    const editorialMode: EditorBindingStatus['editorialMode'] = !optsEditorial
      ? 'none'
      : edQcPassed && hasEditorialFiles
      ? 'editorial_verified'
      : 'editorial_v1';

    const revision = Number(detail.meta.revision ?? 1);
    const lastRenderedRevision =
      typeof detail.meta.lastRenderedRevision === 'number' ? detail.meta.lastRenderedRevision : null;

    const gaitHonestyNote =
      motionEngineMode === 'legacy_stance'
        ? 'Dự án legacy dùng stance-envelope ±25% (b6_puppet.py gốc) — chưa bật Articulated 2D Motion Engine.'
        : motionEngineMode === 'articulated_verified'
        ? 'Articulated 2D Motion Engine (2-bone bent-knee IK + world foot-lock + counter-swing) ĐÃ KIỂM CHỨNG theo preview & motion_qc.json hiện hành.'
        : hasArticulatedFiles
        ? 'Đã bật Articulated 2D Motion Engine (b6-studio-articulated/1); cần render preview + motion_qc.json khớp revision để xác nhận QA.'
        : 'Dự án cấu hình articulated_v1 nhưng thiếu file b6_motion_*.py — hãy chạy scripts/hydrate-project.mjs.';

    return {
      mode: isBound ? 'bound_canonical' : 'authored_custom_scene',
      syncState: qaState.editorSyncState,
      revision,
      lastRenderedRevision,
      voiceStale: qaState.voiceStale,
      canSynthesizeLocalVoice: process.platform === 'win32',
      motionEngineMode,
      motionQcVerified: motionEngineMode === 'articulated_verified',
      gaitHonestyNote,
      editorialMode,
      editorialQcVerified: editorialMode === 'editorial_verified',
      shotVarietyWarnings,
      mappings: FIELD_RUNTIME_MAPPINGS.map((m) => ({
        ...m,
        liveBound: isBound || m.uiField.includes('Phụ đề') || m.uiField.includes('Lời thoại'),
      })),
    };
  }
}
