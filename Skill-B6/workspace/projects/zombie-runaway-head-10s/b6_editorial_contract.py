"""Pure data contract, validation, and O(log N) timeline compiler for B6 Editorial Director (`b6-studio-editorial/1`).

All structures are immutable and deterministic. Legacy projects without `editorialMode: "editorial_v1"`
are unaffected.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
from typing import Any, Mapping, Sequence

EDITORIAL_SCHEMA_VERSION = "b6-studio-editorial/1"
EDITORIAL_REPORT_SCHEMA = "b6-editorial-report/1"
EDITORIAL_QC_SCHEMA = "b6-editorial-qc/1"

SEMANTIC_ROLES = (
    "hook",
    "anticipation",
    "escalation",
    "reveal",
    "threat",
    "prop_insert",
    "chase",
    "impact",
    "reaction",
    "reversal",
    "payoff",
    "exit",
)

SHOT_SIZES = (
    "extreme_close",
    "close",
    "medium",
    "wide",
    "insert",
)

CAMERA_MOVEMENTS = (
    "hold",
    "track",
    "push",
    "pull",
    "whip_with_subject",
    "follow_prop",
)

TRANSITION_KINDS = (
    "hard_cut",
    "match_action_cut",
    "motivated_whip",
    "hold",
)

FOCUS_TARGET_KINDS = (
    "actor_head",
    "actor_eyes",
    "actor_hand",
    "actor_full",
    "prop",
    "action_group",
    "world_point",
)

INTENSITY_LEVELS = ("low", "normal", "high")

PACING_ADVICE_KINDS = (
    "auto",
    "snappy",
    "hold_payoff",
    "tighten_cut",
    "contrast_angle",
    "keep",
)

# Relative framing scale multipliers & vertical framing bias for 9:16 portrait safety above captions
SHOT_SIZE_SCALE_TABLE: dict[str, float] = {
    "extreme_close": 2.45,
    "close": 1.85,
    "insert": 2.15,
    "medium": 1.32,
    "wide": 0.92,
}

# Desired screen Y fraction where the focal target lands (720x1280 caption band is y=864..951 -> 0.675..0.743)
SHOT_SIZE_SCREEN_Y_FRAC: dict[str, float] = {
    "extreme_close": 0.42,
    "close": 0.43,
    "insert": 0.45,
    "medium": 0.48,
    "wide": 0.50,
}


def _finite(val: Any, name: str) -> float:
    try:
        f = float(val)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name}: numeric value required") from exc
    if not math.isfinite(f):
        raise ValueError(f"{name}: finite value required")
    return f


@dataclass(frozen=True)
class SubjectFocus:
    target_kind: str = "actor_full"
    actor_id: str = ""
    prop_id: str = ""
    offset_xy: tuple[float, float] = (0.0, 0.0)
    scale_hint: float = 1.0
    safe_margin: float = 0.08


@dataclass(frozen=True)
class CameraTransition:
    kind: str = "hard_cut"
    duration_s: float = 0.0
    reason: str = ""
    preserve_eyeline: bool = True
    match_action: bool = False


@dataclass(frozen=True)
class EditorialRule:
    min_hold_s: float = 0.35
    max_angular_vel_deg_s: float = 90.0
    max_cam_speed_px_s: float = 1150.0
    max_cam_accel_px_s2: float = 4800.0
    allow_strobe: bool = False
    protect_caption_band: bool = True


@dataclass(frozen=True)
class EditorialBeat:
    beat_id: str
    start_s: float
    end_s: float
    role: str
    intensity: str = "normal"
    action_onset_s: float | None = None
    payoff_hold_s: float = 0.0
    label: str = ""


@dataclass(frozen=True)
class ShotIntent:
    shot_id: str
    start_s: float
    end_s: float
    role: str = "reveal"
    shot_size: str = "medium"
    focus: SubjectFocus = field(default_factory=SubjectFocus)
    camera_movement: str = "hold"
    transition: CameraTransition = field(default_factory=CameraTransition)
    intensity: str = "normal"
    pacing_advice: str = "auto"
    action_onset_s: float | None = None
    reaction_hold_s: float = 0.0
    short_cut_reason: str = ""
    notes: str = ""
    easing: str = "smooth"
    base_camera_keys: tuple[dict[str, float], ...] = ()
    actor: str = ""
    props: tuple[str, ...] = ()
    motion_preset: str | None = None


@dataclass(frozen=True)
class EditorialProfile:
    schema: str = EDITORIAL_SCHEMA_VERSION
    mode: str = "editorial_v1"
    rules: EditorialRule = field(default_factory=EditorialRule)
    target_duration: float = 10.0
    fps: int = 30


@dataclass(frozen=True)
class CompiledShot:
    shot_id: str
    index: int
    start_s: float
    end_s: float
    duration_s: float
    role: str
    shot_size: str
    focus: SubjectFocus
    camera_movement: str
    transition: CameraTransition
    intensity: str
    pacing_advice: str
    action_onset_s: float | None
    reaction_hold_s: float
    target_scale_mult: float
    target_screen_y_frac: float
    zoom_span: float
    easing: str
    base_camera_keys: tuple[dict[str, float], ...]
    actor: str
    props: tuple[str, ...]
    motion_preset: str | None


@dataclass(frozen=True)
class EditorialTimeline:
    schema: str
    profile: EditorialProfile
    duration_s: float
    fps: int
    shots: tuple[CompiledShot, ...]
    beats: tuple[EditorialBeat, ...]
    boundaries: tuple[float, ...]
    plan_sha256: str
    errors: tuple[str, ...]
    warnings: tuple[str, ...]

    @property
    def valid(self) -> bool:
        return len(self.errors) == 0


def _parse_focus(raw: Any, fallback_actor: str = "", fallback_props: Sequence[str] = ()) -> SubjectFocus:
    if isinstance(raw, SubjectFocus):
        return raw
    if not isinstance(raw, Mapping):
        return SubjectFocus(
            target_kind="actor_full" if fallback_actor else "world_point",
            actor_id=fallback_actor,
            prop_id=fallback_props[0] if fallback_props else "",
        )
    off = raw.get("offsetXy", raw.get("offset_xy", (0.0, 0.0)))
    if not isinstance(off, (list, tuple)) or len(off) != 2:
        off_xy = (0.0, 0.0)
    else:
        off_xy = (_finite(off[0], "focus.offset_xy[0]"), _finite(off[1], "focus.offset_xy[1]"))
    return SubjectFocus(
        target_kind=str(raw.get("targetKind", raw.get("target_kind", "actor_full"))),
        actor_id=str(raw.get("actorId", raw.get("actor_id", fallback_actor))),
        prop_id=str(raw.get("propId", raw.get("prop_id", fallback_props[0] if fallback_props else ""))),
        offset_xy=off_xy,
        scale_hint=max(0.4, min(3.5, _finite(raw.get("scaleHint", raw.get("scale_hint", 1.0)), "focus.scale_hint"))),
        safe_margin=max(0.02, min(0.3, _finite(raw.get("safeMargin", raw.get("safe_margin", 0.08)), "focus.safe_margin"))),
    )


def _parse_transition(raw: Any, short_reason: str = "") -> CameraTransition:
    if isinstance(raw, CameraTransition):
        return raw
    if not isinstance(raw, Mapping):
        kind = str(raw) if isinstance(raw, str) and raw in TRANSITION_KINDS else "hard_cut"
        return CameraTransition(kind=kind, reason=short_reason)
    return CameraTransition(
        kind=str(raw.get("kind", "hard_cut")),
        duration_s=max(0.0, _finite(raw.get("durationS", raw.get("duration_s", 0.0)), "transition.duration_s")),
        reason=str(raw.get("reason", short_reason or "")),
        preserve_eyeline=bool(raw.get("preserveEyeline", raw.get("preserve_eyeline", True))),
        match_action=bool(raw.get("matchAction", raw.get("match_action", False))),
    )


def _infer_role_from_legacy_shot(sh: Mapping[str, Any]) -> str:
    vb = str(sh.get("visualBeat") or (sh.get("motion") or {}).get("visualBeat") or "").strip()
    if vb in SEMANTIC_ROLES:
        return vb
    if vb == "surprise":
        return "reveal"
    cp = str(sh.get("cameraPreset") or (sh.get("motion") or {}).get("cameraPreset") or "").strip()
    if cp == "object_insert":
        return "prop_insert"
    if cp == "reaction_closeup":
        return "reaction"
    if cp == "impact":
        return "impact"
    return "reveal"


def _infer_shot_size_from_legacy(sh: Mapping[str, Any]) -> str:
    cp = str(sh.get("cameraPreset") or (sh.get("motion") or {}).get("cameraPreset") or "").strip()
    if cp == "reaction_closeup":
        return "close"
    if cp == "object_insert":
        return "insert"
    if cp == "establish":
        return "wide"
    if cp == "impact":
        return "medium"
    return "medium"


def _infer_movement_from_legacy(sh: Mapping[str, Any]) -> str:
    cp = str(sh.get("cameraPreset") or (sh.get("motion") or {}).get("cameraPreset") or "").strip()
    if cp == "follow":
        return "track"
    if cp == "object_insert":
        return "follow_prop"
    if cp == "impact":
        return "push"
    if cp == "settle":
        return "pull"
    return "hold"


def _normalize_intent(raw: ShotIntent | Mapping[str, Any]) -> ShotIntent:
    if isinstance(raw, ShotIntent):
        return raw
    ed = raw.get("editorial") if isinstance(raw.get("editorial"), Mapping) else raw
    shot_id = str(raw.get("id", raw.get("shot_id", ed.get("shotId", "shot"))))
    start_s = _finite(raw.get("start", raw.get("start_s", 0.0)), f"{shot_id}.start")
    end_s = _finite(raw.get("end", raw.get("end_s", 0.0)), f"{shot_id}.end")
    actor = str(raw.get("actor", ""))
    props = tuple(str(p) for p in (raw.get("props") or []))
    short_reason = str(raw.get("short_cut_reason", ed.get("shortCutReason", ed.get("short_cut_reason", ""))) or "")

    role = str(ed.get("role") or _infer_role_from_legacy_shot(raw))
    shot_size = str(ed.get("shotSize", ed.get("shot_size")) or _infer_shot_size_from_legacy(raw))
    camera_movement = str(ed.get("cameraMovement", ed.get("camera_movement")) or _infer_movement_from_legacy(raw))
    focus = _parse_focus(ed.get("focus"), fallback_actor=actor, fallback_props=props)
    tr_raw = ed.get("transition") if "transition" in ed else raw.get("transition")
    transition = _parse_transition(tr_raw, short_reason=str(ed.get("transitionReason", short_reason)))
    intensity = str(ed.get("intensity", "normal"))
    pacing_advice = str(ed.get("pacingAdvice", ed.get("pacing_advice", "auto")))
    onset_raw = ed.get("actionOnsetS", ed.get("action_onset_s"))
    action_onset = _finite(onset_raw, f"{shot_id}.action_onset_s") if onset_raw is not None else None
    reaction_hold = max(0.0, _finite(ed.get("reactionHoldS", ed.get("reaction_hold_s", 0.0)), f"{shot_id}.reaction_hold_s"))
    easing = str(raw.get("easing", ed.get("easing", "smooth")) or "smooth")

    raw_keys = raw.get("cameraKeys") or raw.get("camera_keys") or ed.get("base_camera_keys") or ()
    keys_clean: list[dict[str, float]] = []
    for k in raw_keys:
        if isinstance(k, Mapping):
            keys_clean.append(
                {
                    "t": _finite(k.get("t", 0.0), f"{shot_id}.cameraKey.t"),
                    "x": _finite(k.get("x", 0.0), f"{shot_id}.cameraKey.x"),
                    "y": _finite(k.get("y", -210.0), f"{shot_id}.cameraKey.y"),
                    "z": _finite(k.get("z", 0.0), f"{shot_id}.cameraKey.z"),
                    "fov": _finite(k.get("fov", 55.0), f"{shot_id}.cameraKey.fov"),
                }
            )
    keys_clean.sort(key=lambda item: item["t"])
    motion_preset = None
    if isinstance(raw.get("motion"), Mapping):
        motion_preset = str(raw["motion"].get("preset") or "") or None
    elif raw.get("motion_preset"):
        motion_preset = str(raw["motion_preset"])

    return ShotIntent(
        shot_id=shot_id,
        start_s=start_s,
        end_s=end_s,
        role=role,
        shot_size=shot_size,
        focus=focus,
        camera_movement=camera_movement,
        transition=transition,
        intensity=intensity,
        pacing_advice=pacing_advice,
        action_onset_s=action_onset,
        reaction_hold_s=reaction_hold,
        short_cut_reason=short_reason,
        notes=str(ed.get("notes", "")),
        easing=easing,
        base_camera_keys=tuple(keys_clean),
        actor=actor,
        props=props,
        motion_preset=motion_preset,
    )


def _parse_rules(raw: Any) -> EditorialRule:
    if isinstance(raw, EditorialRule):
        return raw
    if not isinstance(raw, Mapping):
        return EditorialRule()
    return EditorialRule(
        min_hold_s=max(0.1, _finite(raw.get("minHoldS", raw.get("min_hold_s", 0.35)), "rules.min_hold_s")),
        max_angular_vel_deg_s=max(5.0, _finite(raw.get("maxAngularVelDegS", raw.get("max_angular_vel_deg_s", 90.0)), "rules.max_angular_vel_deg_s")),
        max_cam_speed_px_s=max(50.0, _finite(raw.get("maxCamSpeedPxS", raw.get("max_cam_speed_px_s", 1150.0)), "rules.max_cam_speed_px_s")),
        max_cam_accel_px_s2=max(100.0, _finite(raw.get("maxCamAccelPxS2", raw.get("max_cam_accel_px_s2", 4800.0)), "rules.max_cam_accel_px_s2")),
        allow_strobe=bool(raw.get("allowStrobe", raw.get("allow_strobe", False))),
        protect_caption_band=bool(raw.get("protectCaptionBand", raw.get("protect_caption_band", True))),
    )


def _zoom_span_for_shot(intent: ShotIntent) -> float:
    base = 0.0
    if intent.camera_movement == "push":
        base = 0.14
    elif intent.camera_movement == "pull":
        base = -0.14
    elif intent.camera_movement == "whip_with_subject":
        base = 0.08
    elif intent.camera_movement == "follow_prop":
        base = 0.10
    elif intent.camera_movement == "track":
        base = 0.04
    mult = {"low": 0.65, "normal": 1.0, "high": 1.35}.get(intent.intensity, 1.0)
    return round(base * mult, 4)


def compile_editorial_timeline(
    plan: Mapping[str, Any] | EditorialTimeline,
    duration: float | None = None,
    fps: int = 30,
    *,
    known_actors: Sequence[str] | None = None,
    known_props: Sequence[str] | None = None,
    strict: bool = True,
) -> EditorialTimeline:
    """Validate and compile an editorial plan into an immutable O(log N) searchable timeline."""
    if isinstance(plan, EditorialTimeline):
        return plan

    fps_val = int(plan.get("fps", fps) or fps)
    if fps_val <= 0:
        raise ValueError("fps must be positive")
    dur_val = _finite(duration if duration is not None else plan.get("duration", 10.0), "duration")
    if dur_val <= 0:
        raise ValueError("duration must be positive")

    raw_prof = plan.get("editorialProfile") or plan.get("profile") or {}
    rules = _parse_rules(raw_prof.get("rules") if isinstance(raw_prof, Mapping) else None)
    profile = EditorialProfile(
        schema=str((raw_prof.get("schema") if isinstance(raw_prof, Mapping) else None) or EDITORIAL_SCHEMA_VERSION),
        mode=str(plan.get("editorialMode") or (raw_prof.get("mode") if isinstance(raw_prof, Mapping) else None) or "editorial_v1"),
        rules=rules,
        target_duration=dur_val,
        fps=fps_val,
    )

    raw_shots = plan.get("shots") or []
    raw_beats = plan.get("directorBeats") or plan.get("beats") or []
    errors: list[str] = []
    warnings: list[str] = []

    if rules.allow_strobe:
        errors.append("EDITORIAL_STROBE_FORBIDDEN: allow_strobe=true vi phạm quy tắc an toàn thị giác.")

    if not raw_shots:
        if strict:
            errors.append("EDITORIAL_EMPTY_SHOTS: timeline không có shot nào.")
        return EditorialTimeline(
            schema=EDITORIAL_SCHEMA_VERSION,
            profile=profile,
            duration_s=dur_val,
            fps=fps_val,
            shots=(),
            beats=(),
            boundaries=(),
            plan_sha256=hashlib.sha256(json.dumps(plan, sort_keys=True, default=str).encode("utf-8")).hexdigest(),
            errors=tuple(errors),
            warnings=tuple(warnings),
        )

    intents: list[ShotIntent] = []
    for item in raw_shots:
        try:
            intents.append(_normalize_intent(item))
        except Exception as exc:
            errors.append(f"EDITORIAL_PARSE_ERROR: {exc}")

    actor_set = set(known_actors) if known_actors is not None else None
    prop_set = set(known_props) if known_props is not None else None
    compiled: list[CompiledShot] = []
    boundaries: list[float] = []
    cursor = 0.0
    seen_ids: set[str] = set()
    min_frame_span = 3.0 / float(fps_val)  # forbid 1-2 frame micro-cuts

    for idx, it in enumerate(intents):
        if it.shot_id in seen_ids:
            errors.append(f"DUPLICATE_SHOT_ID: trùng mã shot '{it.shot_id}'.")
        seen_ids.add(it.shot_id)

        if abs(it.start_s - cursor) > 0.002:
            errors.append(
                f"TIMELINE_GAP_OR_OVERLAP: shot '{it.shot_id}' bắt đầu tại {it.start_s:.3f}s nhưng mong đợi {cursor:.3f}s."
            )
        span = it.end_s - it.start_s
        if span <= 0:
            errors.append(f"INVALID_SHOT_DURATION: shot '{it.shot_id}' có thời lượng <= 0 ({span:.3f}s).")
        elif span < min_frame_span:
            errors.append(
                f"UNMOTIVATED_MICRO_CUT: shot '{it.shot_id}' dài {span:.3f}s (< 3 frames ở {fps_val}fps), dễ gây nhấp nháy."
            )
        elif span < 0.9 and not (it.short_cut_reason.strip() or it.transition.reason.strip()):
            errors.append(
                f"SHORT_CUT_MISSING_REASON: shot '{it.shot_id}' ({span:.2f}s < 0.90s) cần lý do cut rõ ràng."
            )

        if it.role not in SEMANTIC_ROLES:
            errors.append(f"INVALID_EDITORIAL_ROLE: '{it.role}' trong shot '{it.shot_id}'.")
        if it.shot_size not in SHOT_SIZES:
            errors.append(f"INVALID_SHOT_SIZE: '{it.shot_size}' trong shot '{it.shot_id}'.")
        if it.camera_movement not in CAMERA_MOVEMENTS:
            errors.append(f"INVALID_CAMERA_MOVEMENT: '{it.camera_movement}' trong shot '{it.shot_id}'.")
        if it.transition.kind not in TRANSITION_KINDS:
            errors.append(f"INVALID_TRANSITION_KIND: '{it.transition.kind}' trong shot '{it.shot_id}'.")
        if it.focus.target_kind not in FOCUS_TARGET_KINDS:
            errors.append(f"INVALID_FOCUS_TARGET_KIND: '{it.focus.target_kind}' trong shot '{it.shot_id}'.")
        if it.intensity not in INTENSITY_LEVELS:
            errors.append(f"INVALID_INTENSITY: '{it.intensity}' trong shot '{it.shot_id}'.")
        if it.pacing_advice not in PACING_ADVICE_KINDS:
            errors.append(f"INVALID_PACING_ADVICE: '{it.pacing_advice}' trong shot '{it.shot_id}'.")

        if it.focus.target_kind.startswith("actor_"):
            if not it.focus.actor_id:
                errors.append(f"FOCUS_ACTOR_MISSING: shot '{it.shot_id}' đặt target '{it.focus.target_kind}' nhưng thiếu actor_id.")
            elif actor_set is not None and it.focus.actor_id not in actor_set:
                errors.append(f"FOCUS_ACTOR_UNKNOWN: actor '{it.focus.actor_id}' trong shot '{it.shot_id}' không tồn tại.")
        if it.focus.target_kind == "prop":
            if not it.focus.prop_id:
                errors.append(f"FOCUS_PROP_MISSING: shot '{it.shot_id}' đặt target 'prop' nhưng thiếu prop_id.")
            elif prop_set is not None and it.focus.prop_id not in prop_set:
                errors.append(f"FOCUS_PROP_UNKNOWN: prop '{it.focus.prop_id}' trong shot '{it.shot_id}' không tồn tại.")

        if it.action_onset_s is not None and (it.action_onset_s < it.start_s - 0.002 or it.action_onset_s > it.end_s + 0.002):
            errors.append(
                f"ACTION_ONSET_OUT_OF_BOUNDS: shot '{it.shot_id}' có action_onset_s={it.action_onset_s:.3f}s ngoài [{it.start_s:.3f}, {it.end_s:.3f}]."
            )

        # Check camera key speed sanity if explicit keys exist
        if len(it.base_camera_keys) >= 2:
            for k0, k1 in zip(it.base_camera_keys[:-1], it.base_camera_keys[1:]):
                dt = k1["t"] - k0["t"]
                if dt <= 1e-4:
                    errors.append(f"CAMERA_KEY_NON_INCREASING: shot '{it.shot_id}' có 2 keyframe trùng hoặc ngược thời gian.")
                else:
                    spd = math.hypot(k1["x"] - k0["x"], k1["y"] - k0["y"]) / dt
                    if spd > rules.max_cam_speed_px_s * 1.8:
                        warnings.append(
                            f"CAMERA_SPEED_HIGH: shot '{it.shot_id}' tốc độ keyframe {spd:.0f} px/s > ngưỡng khuyến nghị {rules.max_cam_speed_px_s:.0f} px/s."
                        )

        scale_mult = SHOT_SIZE_SCALE_TABLE.get(it.shot_size, 1.32) * it.focus.scale_hint
        y_frac = SHOT_SIZE_SCREEN_Y_FRAC.get(it.shot_size, 0.48)
        zoom_span = _zoom_span_for_shot(it)

        cs = CompiledShot(
            shot_id=it.shot_id,
            index=idx,
            start_s=it.start_s,
            end_s=it.end_s,
            duration_s=max(1e-6, span),
            role=it.role,
            shot_size=it.shot_size,
            focus=it.focus,
            camera_movement=it.camera_movement,
            transition=it.transition,
            intensity=it.intensity,
            pacing_advice=it.pacing_advice,
            action_onset_s=it.action_onset_s,
            reaction_hold_s=it.reaction_hold_s,
            target_scale_mult=round(scale_mult, 4),
            target_screen_y_frac=y_frac,
            zoom_span=zoom_span,
            easing=it.easing,
            base_camera_keys=it.base_camera_keys,
            actor=it.actor,
            props=it.props,
            motion_preset=it.motion_preset,
        )
        compiled.append(cs)
        boundaries.append(it.end_s)
        cursor = it.end_s

    if compiled and abs(cursor - dur_val) > (1.0 / float(fps_val) + 0.002):
        errors.append(f"TOTAL_DURATION_MISMATCH: tổng thời lượng các shot ({cursor:.3f}s) != duration ({dur_val:.3f}s).")

    # Shot variety & continuity analysis (warnings, not hard errors unless duplicated)
    for prev_s, cur_s in zip(compiled[:-1], compiled[1:]):
        same_size = prev_s.shot_size == cur_s.shot_size
        same_target = (
            prev_s.focus.target_kind == cur_s.focus.target_kind
            and prev_s.focus.actor_id == cur_s.focus.actor_id
            and prev_s.focus.prop_id == cur_s.focus.prop_id
        )
        same_move = prev_s.camera_movement == cur_s.camera_movement
        if same_size and same_target and same_move and cur_s.transition.kind == "hard_cut":
            warnings.append(
                f"CONSECUTIVE_SIMILAR_COMPOSITION: '{prev_s.shot_id}' -> '{cur_s.shot_id}' lặp cùng cỡ cảnh ({cur_s.shot_size}), mục tiêu focus và chuyển động máy; cân nhắc đổi góc/tỉ lệ để cắt cảnh có thông tin mới."
            )

    if len(compiled) >= 3:
        unique_sizes = {s.shot_size for s in compiled}
        if len(unique_sizes) < 2:
            warnings.append(
                f"LOW_SHOT_SIZE_VARIETY: toàn bộ {len(compiled)} shots dùng duy nhất cỡ cảnh '{next(iter(unique_sizes))}'."
            )

    beats: list[EditorialBeat] = []
    for b_idx, rb in enumerate(raw_beats):
        if isinstance(rb, EditorialBeat):
            beats.append(rb)
        elif isinstance(rb, Mapping):
            beats.append(
                EditorialBeat(
                    beat_id=str(rb.get("id", rb.get("beat_id", f"beat_{b_idx+1}"))),
                    start_s=_finite(rb.get("start", rb.get("start_s", 0.0)), "beat.start"),
                    end_s=_finite(rb.get("end", rb.get("end_s", 1.0)), "beat.end"),
                    role=str(rb.get("beatKind", rb.get("role", "reveal"))),
                    intensity=str(rb.get("intensity", "normal")),
                    label=str(rb.get("purpose", rb.get("label", ""))),
                )
            )

    canonical_digest = hashlib.sha256(
        json.dumps(
            {
                "schema": EDITORIAL_SCHEMA_VERSION,
                "duration": dur_val,
                "fps": fps_val,
                "shots": [
                    {
                        "id": s.shot_id,
                        "start": s.start_s,
                        "end": s.end_s,
                        "role": s.role,
                        "shot_size": s.shot_size,
                        "focus": s.focus.__dict__,
                        "move": s.camera_movement,
                        "transition": s.transition.__dict__,
                    }
                    for s in compiled
                ],
            },
            sort_keys=True,
            default=str,
        ).encode("utf-8")
    ).hexdigest()

    return EditorialTimeline(
        schema=EDITORIAL_SCHEMA_VERSION,
        profile=profile,
        duration_s=dur_val,
        fps=fps_val,
        shots=tuple(compiled),
        beats=tuple(beats),
        boundaries=tuple(boundaries),
        plan_sha256=canonical_digest,
        errors=tuple(errors),
        warnings=tuple(warnings),
    )


def auto_propose_editorial_plan(
    storyboard: Sequence[Mapping[str, Any]],
    semantic_events: Sequence[Mapping[str, Any]] | None = None,
    target_duration: float = 10.0,
    style_constraints: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Deterministic heuristic proposal for shot sizes, focal targets, and transitions.

    Produces structured rationale per shot; requires explicit human/author confirmation
    before committing into canonical `scene-control.json`. Never predicts audience views/retention.
    """
    _ = style_constraints
    events = list(semantic_events or [])
    proposals: list[dict[str, Any]] = []
    n = len(storyboard)
    prev_size = ""

    role_to_default_size = {
        "hook": "extreme_close",
        "threat": "close",
        "reaction": "close",
        "prop_insert": "insert",
        "reveal": "close",
        "anticipation": "medium",
        "chase": "wide",
        "escalation": "medium",
        "impact": "insert",
        "reversal": "medium",
        "payoff": "close",
        "exit": "wide",
    }
    role_to_move = {
        "hook": "push",
        "threat": "push",
        "reaction": "hold",
        "prop_insert": "follow_prop",
        "reveal": "push",
        "anticipation": "hold",
        "chase": "track",
        "escalation": "whip_with_subject",
        "impact": "push",
        "reversal": "pull",
        "payoff": "pull",
        "exit": "hold",
    }

    for idx, sb in enumerate(storyboard):
        sid = str(sb.get("id", f"shot_{idx+1}"))
        s0 = float(sb.get("start", 0.0))
        s1 = float(sb.get("end", s0 + max(0.5, target_duration / max(1, n))))
        role = str(sb.get("role") or _infer_role_from_legacy_shot(sb))
        actor = str(sb.get("actor", ""))
        props = list(sb.get("props") or [])

        size = role_to_default_size.get(role, "medium")
        if size == prev_size:
            # Enforce visual contrast across adjacent cuts
            size = "medium" if size in ("close", "extreme_close", "insert") else "close"
        prev_size = size

        move = role_to_move.get(role, "hold")
        if role == "prop_insert" and props:
            target_kind = "prop"
        elif role in ("hook", "reaction", "reveal", "payoff") and actor:
            target_kind = "actor_eyes" if size == "extreme_close" else "actor_head"
        elif actor:
            target_kind = "actor_full"
        else:
            target_kind = "world_point"

        matching_ev = [e for e in events if s0 <= float(e.get("t", -1)) < s1]
        onset = float(matching_ev[0]["t"]) if matching_ev else round(s0 + (s1 - s0) * 0.25, 3)

        proposals.append(
            {
                "shotId": sid,
                "start": s0,
                "end": s1,
                "editorial": {
                    "role": role,
                    "shotSize": size,
                    "focus": {
                        "targetKind": target_kind,
                        "actorId": actor,
                        "propId": props[0] if props else "",
                        "offsetXy": [0.0, 0.0],
                        "scaleHint": 1.0,
                        "safeMargin": 0.08,
                    },
                    "cameraMovement": move,
                    "transition": {
                        "kind": "match_action_cut" if role in ("chase", "impact", "prop_insert") else "hard_cut",
                        "durationS": 0.0,
                        "reason": f"Contrast framing to {size} ({target_kind}) for {role} beat",
                        "preserveEyeline": True,
                        "matchAction": role in ("chase", "impact", "prop_insert"),
                    },
                    "intensity": "high" if role in ("hook", "chase", "impact", "reveal") else "normal",
                    "pacingAdvice": "hold_payoff" if role in ("reaction", "payoff") else "snappy",
                    "actionOnsetS": onset,
                    "reactionHoldS": 0.35 if role in ("reaction", "payoff", "reveal") else 0.0,
                },
                "rationale": f"Shot {sid}: role={role} -> {size} on {target_kind} via {move} to maximize visual contrast vs previous shot.",
            }
        )

    return {
        "schema": EDITORIAL_SCHEMA_VERSION,
        "requiresAuthorReview": True,
        "audienceRetentionPrediction": "unavailable",
        "proposals": proposals,
    }
