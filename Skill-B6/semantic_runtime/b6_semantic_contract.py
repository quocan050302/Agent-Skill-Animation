"""Semantic Action Contract & Causality Compiler (`b6-semantic/1`).

Domain-agnostic contract compiling high-level story/action beats (walk, run, chase,
trip, fall, hide_behind, detach, roll, avoid_obstacle, reach, take, reattach,
collide, react, etc.) into machine-checkable visual evidence expectations and
causal prerequisites without hardcoding any single niche or story.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping, Sequence

SEMANTIC_CONTRACT_SCHEMA = "b6-semantic-action/1"
SEMANTIC_SCHEMA_VERSION = 1

# Reusable default evidence requirements per canonical action type.
# Custom actions not in this catalog MUST supply explicit `evidence_requirements`
# or be rejected by strict compilation (`SEMANTIC_UNKNOWN_ACTION_WITHOUT_CRITERIA`).
BUILTIN_ACTION_CATALOG: dict[str, dict[str, Any]] = {
    "idle": {
        "category": "posture",
        "min_actor_visible": 0.45,
        "requires_visibility": True,
    },
    "walk": {
        "category": "locomotion",
        "min_actor_visible": 0.45,
        "requires_visibility": True,
        "requires_trajectory": True,
        "min_displacement_px": 24.0,
    },
    "run": {
        "category": "locomotion",
        "min_actor_visible": 0.45,
        "requires_visibility": True,
        "requires_trajectory": True,
        "min_displacement_px": 50.0,
        "min_speed_px_s": 60.0,
    },
    "chase": {
        "category": "locomotion",
        "min_actor_visible": 0.45,
        "requires_visibility": True,
        "requires_trajectory": True,
        "min_displacement_px": 55.0,
        "min_speed_px_s": 70.0,
    },
    "sneeze": {
        "category": "posture_change",
        "min_actor_visible": 0.45,
        "requires_visibility": True,
        "requires_pose_change": True,
        "min_head_angle_delta_deg": 6.0,
    },
    "trip": {
        "category": "posture_change",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_pose_change": True,
        "min_centroid_y_drop_px": 10.0,
        "min_bbox_aspect_delta": 0.08,
    },
    "fall": {
        "category": "posture_change",
        "min_actor_visible": 0.35,
        "requires_visibility": True,
        "requires_pose_change": True,
        "min_centroid_y_drop_px": 18.0,
    },
    "kneel": {
        "category": "posture_change",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_pose_change": True,
        "min_centroid_y_drop_px": 12.0,
    },
    "recover": {
        "category": "posture_change",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_pose_change": True,
        "min_centroid_shift_px": 12.0,
    },
    "turn": {
        "category": "gaze_reaction",
        "min_actor_visible": 0.45,
        "requires_visibility": True,
        "requires_reaction": True,
        "min_head_angle_delta_deg": 5.0,
        "allow_facing_flip": True,
    },
    "react": {
        "category": "gaze_reaction",
        "min_actor_visible": 0.45,
        "requires_visibility": True,
        "requires_reaction": True,
        "min_head_angle_delta_deg": 5.0,
        "allow_expression_change": True,
    },
    "notice": {
        "category": "gaze_reaction",
        "min_actor_visible": 0.45,
        "requires_visibility": True,
        "requires_reaction": True,
        "min_head_angle_delta_deg": 4.0,
        "allow_expression_change": True,
    },
    "hide_behind": {
        "category": "occlusion_hide",
        "min_actor_visible": 0.08,
        "requires_visibility": True,
        "requires_occlusion": True,
        "min_occlusion_ratio": 0.35,
    },
    "avoid_obstacle": {
        "category": "avoidance",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_trajectory": True,
        "requires_avoidance": True,
        "min_displacement_px": 30.0,
        "min_clearance_arc_px": 12.0,
    },
    "detach": {
        "category": "part_state",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_prop_visibility": True,
        "requires_detach": True,
        "min_detach_separation_px": 18.0,
    },
    "drop": {
        "category": "object_motion",
        "min_actor_visible": 0.35,
        "requires_visibility": True,
        "requires_prop_visibility": True,
        "requires_prop_trajectory": True,
        "min_prop_dy_px": 20.0,
        "min_prop_displacement_px": 24.0,
    },
    "bounce": {
        "category": "object_motion",
        "min_actor_visible": 0.30,
        "requires_visibility": True,
        "requires_prop_visibility": True,
        "requires_prop_trajectory": True,
        "requires_bounce": True,
        "min_prop_displacement_px": 30.0,
    },
    "roll": {
        "category": "object_motion",
        "min_actor_visible": 0.30,
        "requires_visibility": True,
        "requires_prop_visibility": True,
        "requires_prop_trajectory": True,
        "requires_rotation": True,
        "min_prop_displacement_px": 35.0,
        "min_prop_rotation_deg": 35.0,
    },
    "reach": {
        "category": "interaction",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_prop_visibility": True,
        "requires_pose_change": True,
        "min_hand_approach_delta_px": 10.0,
    },
    "take": {
        "category": "object_interaction",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_prop_visibility": True,
        "requires_contact": True,
        "max_contact_px": 20.0,
    },
    "grab": {
        "category": "object_interaction",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_prop_visibility": True,
        "requires_contact": True,
        "max_contact_px": 20.0,
    },
    "hold": {
        "category": "object_interaction",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_prop_visibility": True,
        "requires_contact": True,
        "max_contact_px": 20.0,
    },
    "reattach": {
        "category": "part_state",
        "min_actor_visible": 0.45,
        "requires_visibility": True,
        "requires_reattach": True,
        "max_mount_gap_px": 24.0,
    },
    "collide": {
        "category": "collision",
        "min_actor_visible": 0.40,
        "requires_visibility": True,
        "requires_collision": True,
        "max_collision_gap_px": 22.0,
    },
}

ACTION_ALIASES: dict[str, str] = {
    "duck_behind": "hide_behind",
    "peek_from": "hide_behind",
    "dodge": "avoid_obstacle",
    "pick_up": "take",
    "catch": "take",
    "carry": "hold",
    "head_detach": "detach",
    "head_reattach": "reattach",
    "impact": "collide",
    "hit": "collide",
    "stumble": "trip",
    "shock": "react",
    "dash": "run",
    "sprint": "run",
}


def canonicalize_action_type(raw_type: Any) -> str:
    val = str(raw_type or "").strip().lower().replace("-", "_").replace(" ", "_")
    return ACTION_ALIASES.get(val, val)


def normalize_action_evidence_requirements(action_spec: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize explicit + built-in visual evidence criteria for one semantic action."""
    raw_type = str(action_spec.get("actionType") or action_spec.get("action_type") or "").strip()
    canonical = canonicalize_action_type(raw_type)
    explicit_req = dict(
        action_spec.get("evidenceRequirements")
        or action_spec.get("evidence_requirements")
        or {}
    )
    if canonical not in BUILTIN_ACTION_CATALOG and not explicit_req:
        raise ValueError(
            f"SEMANTIC_UNKNOWN_ACTION_WITHOUT_CRITERIA: action '{raw_type or '<empty>'}' "
            "is not in built-in catalog and declares no evidenceRequirements."
        )

    merged: dict[str, Any] = copy.deepcopy(BUILTIN_ACTION_CATALOG.get(canonical, {}))
    # Support camelCase or snake_case criteria keys cleanly
    key_map = {
        "minActorVisible": "min_actor_visible",
        "minPropVisible": "min_prop_visible",
        "requiresVisibility": "requires_visibility",
        "requiresPropVisibility": "requires_prop_visibility",
        "requiresTrajectory": "requires_trajectory",
        "requiresPropTrajectory": "requires_prop_trajectory",
        "requiresPoseChange": "requires_pose_change",
        "requiresContact": "requires_contact",
        "requiresOcclusion": "requires_occlusion",
        "requiresAvoidance": "requires_avoidance",
        "requiresBounce": "requires_bounce",
        "requiresRotation": "requires_rotation",
        "requiresDetach": "requires_detach",
        "requiresReattach": "requires_reattach",
        "requiresCollision": "requires_collision",
        "requiresReaction": "requires_reaction",
        "minDisplacementPx": "min_displacement_px",
        "minPropDisplacementPx": "min_prop_displacement_px",
        "minPropDyPx": "min_prop_dy_px",
        "minPropRotationDeg": "min_prop_rotation_deg",
        "minSpeedPxS": "min_speed_px_s",
        "maxContactPx": "max_contact_px",
        "maxCollisionGapPx": "max_collision_gap_px",
        "minOcclusionRatio": "min_occlusion_ratio",
        "minHeadAngleDeltaDeg": "min_head_angle_delta_deg",
        "minDetachSeparationPx": "min_detach_separation_px",
        "maxMountGapPx": "max_mount_gap_px",
        "minClearanceArcPx": "min_clearance_arc_px",
        "minHandApproachDeltaPx": "min_hand_approach_delta_px",
        "expectedOrientation": "expected_orientation",
        "expectedHeadVariant": "expected_head_variant",
        "expectedArm": "expected_arm",
    }
    for k, v in explicit_req.items():
        merged[key_map.get(k, k)] = v

    if "expectedOrientation" in action_spec and action_spec["expectedOrientation"]:
        merged["expected_orientation"] = str(action_spec["expectedOrientation"])
    if "expected_orientation" in action_spec and action_spec["expected_orientation"]:
        merged["expected_orientation"] = str(action_spec["expected_orientation"])
    if "expectedHeadVariant" in action_spec and action_spec["expectedHeadVariant"]:
        merged["expected_head_variant"] = str(action_spec["expectedHeadVariant"])

    # Ensure sensible visibility fallback if user supplied custom criteria without explicit threshold
    merged.setdefault("requires_visibility", True)
    merged.setdefault("min_actor_visible", 0.35)
    merged.setdefault("category", "custom")
    return merged


def _normalize_single_action(raw: Mapping[str, Any], index: int) -> dict[str, Any]:
    act_id = str(raw.get("id") or f"sem_act_{index + 1}").strip()
    raw_type = str(raw.get("actionType") or raw.get("action_type") or "").strip()
    canonical_type = canonicalize_action_type(raw_type)
    actor_id = str(raw.get("actorId") or raw.get("actor_id") or "").strip()
    target_prop_id = str(raw.get("targetPropId") or raw.get("target_prop_id") or "").strip()
    occluder_id = str(raw.get("occluderId") or raw.get("occluder_id") or "").strip()
    part_id = str(raw.get("partId") or raw.get("part_id") or ("head" if canonical_type in ("detach", "reattach") else "")).strip()
    shot_id = str(raw.get("shotId") or raw.get("shot_id") or "").strip()

    try:
        start_s = float(raw.get("startS") if raw.get("startS") is not None else raw.get("start_s", 0.0))
        end_s = float(raw.get("endS") if raw.get("endS") is not None else raw.get("end_s", 0.0))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"SEMANTIC_TIMELINE_INVALID: action '{act_id}' has non-numeric timing: {exc}") from exc

    prereqs_raw = raw.get("prerequisiteIds") if raw.get("prerequisiteIds") is not None else raw.get("prerequisite_ids", [])
    prereqs = [str(p).strip() for p in (prereqs_raw or []) if str(p).strip()]
    reqs = normalize_action_evidence_requirements(raw)

    return {
        "id": act_id,
        "shot_id": shot_id,
        "action_type": canonical_type,
        "raw_action_type": raw_type or canonical_type,
        "actor_id": actor_id,
        "target_prop_id": target_prop_id,
        "occluder_id": occluder_id,
        "part_id": part_id,
        "start_s": round(start_s, 5),
        "end_s": round(end_s, 5),
        "prerequisite_ids": prereqs,
        "initially_detached": bool(raw.get("initiallyDetached") or raw.get("initially_detached") or False),
        "initially_held": bool(raw.get("initiallyHeld") or raw.get("initially_held") or False),
        "optional_review": bool(raw.get("optionalReview") or raw.get("optional_review") or False),
        "notes": str(raw.get("notes") or "").strip(),
        "evidence_requirements": reqs,
    }


def validate_action_causality(
    actions: Sequence[Mapping[str, Any]],
    duration_s: float | None = None,
    fps: float = 30.0,
) -> dict[str, Any]:
    """Validate timing continuity and causal state progression across semantic actions."""
    errors: list[str] = []
    warnings: list[str] = []
    min_span = max(1.0 / max(1.0, float(fps)), 0.05)

    by_id: dict[str, Mapping[str, Any]] = {}
    for row in actions:
        aid = str(row.get("id") or "")
        if not aid:
            errors.append("SEMANTIC_TIMELINE_INVALID: semantic action missing non-empty id.")
            continue
        if aid in by_id:
            errors.append(f"SEMANTIC_TIMELINE_INVALID: duplicate semantic action id '{aid}'.")
            continue
        by_id[aid] = row

        s0 = float(row.get("start_s", 0.0))
        s1 = float(row.get("end_s", 0.0))
        if s0 < -1e-4 or s1 <= s0:
            errors.append(f"SEMANTIC_TIMELINE_INVALID: action '{aid}' has invalid range [{s0}, {s1}].")
        elif s1 - s0 < min_span - 1e-6:
            errors.append(f"SEMANTIC_TIMELINE_INVALID: action '{aid}' duration {(s1 - s0):.3f}s < min {min_span:.3f}s.")
        if duration_s is not None and s1 > float(duration_s) + 1e-3:
            errors.append(f"SEMANTIC_TIMELINE_INVALID: action '{aid}' end_s {s1}s exceeds duration {duration_s}s.")
        if not str(row.get("actor_id") or "").strip():
            errors.append(f"SEMANTIC_TIMELINE_INVALID: action '{aid}' missing actor_id.")

        reqs = row.get("evidence_requirements") or {}
        if (reqs.get("requires_prop_visibility") or reqs.get("requires_contact")) and not str(row.get("target_prop_id") or "").strip():
            errors.append(
                f"SEMANTIC_TIMELINE_INVALID: action '{aid}' ({row.get('action_type')}) requires target_prop_id."
            )
        if reqs.get("requires_occlusion") and not (str(row.get("occluder_id") or "").strip() or str(row.get("target_prop_id") or "").strip()):
            errors.append(
                f"SEMANTIC_TIMELINE_INVALID: hide/occlusion action '{aid}' requires occluder_id or target_prop_id."
            )

    # Check explicit prerequisite IDs exist and satisfy temporal causation
    for row in actions:
        aid = str(row.get("id") or "")
        s0 = float(row.get("start_s", 0.0))
        for pre_id in row.get("prerequisite_ids") or ():
            pre = by_id.get(str(pre_id))
            if pre is None:
                errors.append(f"SEMANTIC_CAUSALITY_BROKEN: action '{aid}' references missing prerequisite '{pre_id}'.")
            elif float(pre.get("start_s", 0.0)) > s0 + 1e-3:
                errors.append(
                    f"SEMANTIC_CAUSALITY_BROKEN: prerequisite '{pre_id}' starts at {pre.get('start_s')}s after dependent '{aid}' starts ({s0}s)."
                )

    # Track causal part state per (actor_id, part_id) across chronological time
    sorted_acts = sorted(actions, key=lambda r: (float(r.get("start_s", 0.0)), float(r.get("end_s", 0.0))))
    part_detached: dict[tuple[str, str], bool] = {}
    prop_acquired: dict[tuple[str, str], bool] = {}

    for row in sorted_acts:
        aid = str(row.get("id") or "")
        atype = str(row.get("action_type") or "")
        actor = str(row.get("actor_id") or "")
        prop = str(row.get("target_prop_id") or "")
        part = str(row.get("part_id") or "head")
        key_part = (actor, part)
        key_prop = (actor, prop)

        if row.get("initially_detached") and key_part not in part_detached:
            part_detached[key_part] = True
        if row.get("initially_held") and prop and key_prop not in prop_acquired:
            prop_acquired[key_prop] = True

        if atype == "detach":
            if part_detached.get(key_part, False):
                errors.append(f"SEMANTIC_CAUSALITY_BROKEN: duplicate detach '{aid}' while '{actor}:{part}' already detached.")
            part_detached[key_part] = True
            if prop:
                # A newly detached part prop starts unheld/airborne until grabbed
                prop_acquired[key_prop] = False
        elif atype == "reattach":
            if not part_detached.get(key_part, False):
                errors.append(
                    f"SEMANTIC_CAUSALITY_BROKEN: reattach '{aid}' cannot occur because '{actor}:{part}' was never detached."
                )
            if prop and not prop_acquired.get(key_prop, False) and not any(
                p in by_id and str(by_id[p].get("action_type")) in ("take", "grab", "detach")
                for p in (row.get("prerequisite_ids") or ())
            ):
                warnings.append(
                    f"Causal advisory: reattach '{aid}' has no explicit preceding grab/take on prop '{prop}'."
                )
            part_detached[key_part] = False
            if prop:
                prop_acquired[key_prop] = False
        elif atype in ("take", "grab"):
            if prop:
                prop_acquired[key_prop] = True
        elif atype == "hold":
            if prop and not prop_acquired.get(key_prop, False):
                errors.append(
                    f"SEMANTIC_CAUSALITY_BROKEN: hold '{aid}' references unacquired prop '{prop}' (missing preceding take/grab or initiallyHeld)."
                )
        elif atype == "drop":
            if prop:
                prop_acquired[key_prop] = False

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


def _collect_actions_from_input(plan_or_actions: Mapping[str, Any] | Sequence[Mapping[str, Any]]) -> tuple[float, float, list[dict[str, Any]]]:
    if isinstance(plan_or_actions, Sequence) and not isinstance(plan_or_actions, (str, bytes)):
        normalized = [_normalize_single_action(a, i) for i, a in enumerate(plan_or_actions)]
        max_end = max((a["end_s"] for a in normalized), default=0.0)
        return max_end, 30.0, normalized

    plan = dict(plan_or_actions)
    duration_s = float(plan.get("duration") or 0.0)
    fps = float(plan.get("fps") or 30.0)
    collected: list[dict[str, Any]] = []

    top_actions = plan.get("semanticActions") or plan.get("semantic_actions") or []
    for raw in top_actions:
        collected.append(_normalize_single_action(raw, len(collected)))

    # Also gather per-shot semanticActions seamlessly, inheriting shot bounds/actor when omitted
    for shot in plan.get("shots") or []:
        shot_id = str(shot.get("id") or "")
        s_start = float(shot.get("start", 0.0))
        s_end = float(shot.get("end", s_start))
        s_actor = str(shot.get("actor") or "")
        for raw in shot.get("semanticActions") or shot.get("semantic_actions") or []:
            merged = dict(raw)
            if not merged.get("shotId") and not merged.get("shot_id"):
                merged["shotId"] = shot_id
            if merged.get("startS") is None and merged.get("start_s") is None:
                merged["startS"] = s_start
            if merged.get("endS") is None and merged.get("end_s") is None:
                merged["endS"] = s_end
            if not merged.get("actorId") and not merged.get("actor_id") and s_actor:
                merged["actorId"] = s_actor
            collected.append(_normalize_single_action(merged, len(collected)))

    if duration_s <= 0.0 and collected:
        duration_s = max(a["end_s"] for a in collected)
    return duration_s, fps, collected


def compile_semantic_action_plan(
    plan_or_actions: Mapping[str, Any] | Sequence[Mapping[str, Any]],
    *,
    strict: bool = True,
) -> dict[str, Any]:
    """Compile a scene-control plan or semantic action list into a deterministic contract."""
    duration_s, fps, actions = _collect_actions_from_input(plan_or_actions)
    actions.sort(key=lambda a: (a["start_s"], a["end_s"], a["id"]))
    causality = validate_action_causality(actions, duration_s=duration_s if duration_s > 0 else None, fps=fps)
    if strict and not causality["valid"]:
        raise ValueError(" | ".join(causality["errors"]))

    contract_payload = {
        "schema": SEMANTIC_CONTRACT_SCHEMA,
        "version": SEMANTIC_SCHEMA_VERSION,
        "duration_s": round(duration_s, 5),
        "fps": fps,
        "action_count": len(actions),
        "actions": actions,
        "causality": causality,
    }
    digest = hashlib.sha256(
        json.dumps(
            {
                "schema": contract_payload["schema"],
                "duration_s": contract_payload["duration_s"],
                "actions": contract_payload["actions"],
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    contract_payload["contract_sha256"] = digest
    return contract_payload


def semantic_expected_state_at(compiled_plan: Mapping[str, Any], t: float) -> dict[str, Any]:
    """Deterministically query expected actor/part/prop states and active actions at time `t`."""
    tc = max(0.0, float(t))
    actions = compiled_plan.get("actions") or []
    active = [a for a in actions if float(a.get("start_s", 0.0)) <= tc < float(a.get("end_s", 0.0))]

    part_states: dict[str, str] = {}
    held_props: dict[str, list[str]] = {}
    for a in sorted(actions, key=lambda r: (float(r.get("start_s", 0.0)), float(r.get("end_s", 0.0)))):
        actor = str(a.get("actor_id") or "")
        part = str(a.get("part_id") or "head")
        prop = str(a.get("target_prop_id") or "")
        pkey = f"{actor}:{part}"
        if a.get("initially_detached") and pkey not in part_states:
            part_states[pkey] = "detached"
        if a.get("initially_held") and prop:
            held_props.setdefault(prop, [])
            if actor not in held_props[prop]:
                held_props[prop].append(actor)

        s0 = float(a.get("start_s", 0.0))
        s1 = float(a.get("end_s", 0.0))
        atype = str(a.get("action_type") or "")
        if tc < s0:
            continue
        in_window = tc < s1
        if atype == "detach":
            part_states[pkey] = "detaching" if (in_window and (tc - s0) < 0.14 * (s1 - s0)) else "detached"
            if prop and prop in held_props and actor in held_props[prop]:
                held_props[prop].remove(actor)
        elif atype == "reattach":
            if in_window and tc < s0 + 0.65 * (s1 - s0):
                part_states[pkey] = "reattaching"
            else:
                part_states[pkey] = "attached"
                if prop and prop in held_props and actor in held_props[prop]:
                    held_props[prop].remove(actor)
        elif atype in ("take", "grab", "hold") and prop:
            if atype in ("hold", "take", "grab"):
                held_props.setdefault(prop, [])
                if actor not in held_props[prop]:
                    held_props[prop].append(actor)
        elif atype in ("drop", "bounce", "roll") and prop:
            if prop in held_props and actor in held_props[prop]:
                held_props[prop].remove(actor)

    return {
        "schema": SEMANTIC_CONTRACT_SCHEMA,
        "t": round(tc, 5),
        "active_actions": [
            {
                "id": a["id"],
                "action_type": a["action_type"],
                "actor_id": a["actor_id"],
                "target_prop_id": a.get("target_prop_id") or None,
                "occluder_id": a.get("occluder_id") or None,
                "progress": round(max(0.0, min(1.0, (tc - a["start_s"]) / max(1e-6, a["end_s"] - a["start_s"]))), 4),
            }
            for a in active
        ],
        "part_mount_states": part_states,
        "held_props": {k: list(v) for k, v in held_props.items() if v},
    }


def export_semantic_contract(compiled_plan: Mapping[str, Any], out_path: str | Path) -> str:
    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.tmp")
    tmp.write_text(json.dumps(compiled_plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target)
    return str(target)
