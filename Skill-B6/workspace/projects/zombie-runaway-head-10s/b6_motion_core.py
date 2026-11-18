"""Pure deterministic articulated 2D gait, two-bone knee IK, and world-locked foot contact solver.

Evaluates purely from `(profile, shot/state, t)` with zero frame-order mutable state so random seek,
0.5x draft, and 1.0x native playback produce identical world-space trajectories and foot plants.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Any, Mapping, Sequence
import numpy as np

MOTION_SCHEMA_VERSION = "b6-studio-articulated/1"
VALID_MOTION_STATES = (
    "idle",
    "anticipate",
    "walk",
    "run",
    "dash",
    "stop",
    "turn",
    "react",
    "recover",
)
LOCOMOTION_STATES = ("walk", "run", "dash")


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(v)))


def _smooth(u: float) -> float:
    u = _clamp(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


def _ease_val(u: float, mode: str) -> float:
    u = _clamp(u, 0.0, 1.0)
    if mode == "linear":
        return u
    if mode == "ease_in":
        return u * u
    if mode == "ease_out":
        return 1.0 - (1.0 - u) * (1.0 - u)
    if mode == "hold":
        return 0.0 if u < 1.0 else 1.0
    return _smooth(u)


def _lerp(a: float, b: float, u: float) -> float:
    return float(a) * (1.0 - u) + float(b) * u


def _finite_xy(pt: Sequence[float] | np.ndarray, name: str) -> np.ndarray:
    arr = np.asarray(pt, dtype=float)
    if arr.shape != (2,) or not np.isfinite(arr).all():
        raise ValueError(f"{name}: finite (2,) coordinate required")
    return arr


@dataclass(frozen=True)
class MotionProfile:
    """Rig and biomechanical tuning profile matching a B6 character package."""

    upper_leg_len: float = 47.0
    lower_leg_len: float = 47.0
    hip_left_local: tuple[float, float] = (-21.0, -88.0)
    hip_right_local: tuple[float, float] = (23.0, -88.0)
    shoulder_y_local: float = -165.0
    torso_height: float = 112.0
    facing: float = 1.0
    stride_len: float = 110.0
    cadence_hz: float = 2.0
    foot_lift: float = 28.0
    pelvis_bob: float = 7.5
    arm_swing_amp: float = 0.34
    startup_s: float = 0.16
    brake_s: float = 0.18
    easing: str = "smooth"
    overshoot_deg: float = 7.0
    ink_width: float = 5.4
    ink_color: tuple[int, int, int] = (26, 20, 20)
    foot_size: tuple[float, float] = (26.0, 11.0)
    foot_style: str = "tabi"
    ground_y: float = 0.0
    coordinate_space: str = "world_2d"
    max_knee_deg: float = 128.0

    @property
    def leg_total_len(self) -> float:
        return float(self.upper_leg_len + self.lower_leg_len)

    @property
    def facing_sign(self) -> float:
        return -1.0 if float(self.facing) < 0.0 else 1.0


@dataclass(frozen=True)
class ShotMotion:
    """Shot-level deterministic motion contract parsed from scene-control.json or unit fixtures."""

    shot_id: str
    start_s: float
    end_s: float
    start_x: float
    end_x: float
    start_y: float = 0.0
    end_y: float = 0.0
    state: str = "idle"
    facing: float = 1.0
    cadence_hz: float = 2.0
    stride_len: float = 110.0
    foot_lift: float = 28.0
    pelvis_drop: float = 4.0
    easing: str = "smooth"
    anticipate_s: float = 0.16
    settle_s: float = 0.18
    arm_swing_amp: float = 0.32
    step_count_override: int | None = None
    phase_origin: float = 0.0
    seed: int = 1


@dataclass(frozen=True)
class FootContact:
    side: str
    state: str  # 'stance' | 'swing'
    plant_world: tuple[float, float]
    target_world: tuple[float, float]
    touchdown_t: float
    toe_off_t: float
    stance_fraction: float
    drift_world: float = 0.0
    swing_u: float = 0.0


@dataclass(frozen=True)
class ContactPlan:
    t: float
    left: FootContact
    right: FootContact
    step_index: int
    ground_y: float
    root_speed: float
    is_moving: bool
    active_support: str  # 'both' | 'left' | 'right'
    blend_state: str
    stride_phase: float


@dataclass(frozen=True)
class LegPose:
    side: str
    hip_xy: tuple[float, float]
    knee_xy: tuple[float, float]
    ankle_xy: tuple[float, float]
    toe_xy: tuple[float, float]
    foot_angle_deg: float
    upper_len: float
    lower_len: float
    actual_upper_len: float
    actual_lower_len: float
    bend_angle_deg: float
    knee_forward_sign: float
    ground_normal: tuple[float, float] = (0.0, -1.0)
    contact_state: str = "stance"
    clamped_reach: bool = False


@dataclass(frozen=True)
class RootPose:
    world_x: float
    world_y: float
    pelvis_drop: float
    torso_lean_deg: float
    facing: float
    hip_left_world: tuple[float, float]
    hip_right_world: tuple[float, float]
    scale: float = 1.0


@dataclass(frozen=True)
class ArmHeadTorsoPose:
    left_arm: tuple[str, float]
    right_arm: tuple[str, float]
    head_angle_deg: float
    torso_lean_deg: float
    pelvis_y_offset: float
    locked_arms: tuple[str, ...] = ()


@dataclass(frozen=True)
class GaitPose:
    t: float
    state: str
    facing: float
    root: RootPose
    contact_plan: ContactPlan
    left_leg: LegPose
    right_leg: LegPose
    upper_body: ArmHeadTorsoPose
    phase_continuous: float
    stride_count_elapsed: float
    state_blend: dict[str, Any] = field(default_factory=dict)


def solve_two_bone_ik(
    hip_xy: Sequence[float],
    target_ankle_xy: Sequence[float],
    upper_len: float,
    lower_len: float,
    knee_hint: float | Sequence[float] = 1.0,
    bounds: Mapping[str, float] | None = None,
    *,
    side: str = "left",
    foot_size: float = 26.0,
    contact_state: str = "stance",
    foot_angle_deg: float = 0.0,
) -> LegPose:
    """Analytical two-bone planar IK keeping bone lengths constant and continuous knee forward polarity."""
    hip = _finite_xy(hip_xy, "hip_xy")
    target = _finite_xy(target_ankle_xy, "target_ankle_xy")
    u_len = float(upper_len)
    l_len = float(lower_len)
    if not (math.isfinite(u_len) and math.isfinite(l_len) and u_len > 2.0 and l_len > 2.0):
        raise ValueError("upper_len and lower_len must be finite positive lengths > 2")

    bnd = bounds or {}
    ground_y = bnd.get("ground_y")
    clamped = False
    if ground_y is not None and math.isfinite(float(ground_y)) and target[1] > float(ground_y):
        target = np.array([target[0], float(ground_y)], dtype=float)
        clamped = True

    delta = target - hip
    raw_dist = float(np.linalg.norm(delta))
    min_reach = max(4.0, abs(u_len - l_len) + 2.0)
    max_reach = 0.996 * (u_len + l_len)
    if raw_dist < 1e-6:
        unit_dir = np.array([0.0, 1.0], dtype=float)
        dist = min_reach
        clamped = True
    else:
        unit_dir = delta / raw_dist
        dist = _clamp(raw_dist, min_reach, max_reach)
        if abs(dist - raw_dist) > 1e-6:
            clamped = True

    # Ensure knee bend always protrudes forward along knee_hint rather than snapping/inverting backward
    if isinstance(knee_hint, (int, float)):
        hint_vec = np.array([-1.0 if float(knee_hint) < 0.0 else 1.0, 0.0], dtype=float)
    else:
        hv = _finite_xy(knee_hint, "knee_hint")
        norm_h = float(np.linalg.norm(hv))
        hint_vec = hv / norm_h if norm_h > 1e-6 else np.array([1.0, 0.0], dtype=float)

    facing_sign = -1.0 if hint_vec[0] < 0.0 else 1.0
    ankle = hip + unit_dir * dist
    if ground_y is not None and ankle[1] > float(ground_y):
        ankle[1] = float(ground_y)
        delta2 = ankle - hip
        d2 = float(np.linalg.norm(delta2))
        if d2 > 1e-6:
            dist = _clamp(d2, min_reach, max_reach)
            unit_dir = delta2 / d2
            ankle = hip + unit_dir * dist
        clamped = True

    cos_a = _clamp((u_len * u_len + dist * dist - l_len * l_len) / (2.0 * u_len * dist), -1.0, 1.0)
    sin_a = math.sqrt(max(0.0, 1.0 - cos_a * cos_a))

    n_a = np.array([unit_dir[1], -unit_dir[0]], dtype=float)
    n_b = np.array([-unit_dir[1], unit_dir[0]], dtype=float)
    normal = n_a if float(np.dot(n_a, hint_vec)) >= float(np.dot(n_b, hint_vec)) else n_b

    knee = hip + unit_dir * (u_len * cos_a) + normal * (u_len * sin_a)

    # Interior flexion angle in degrees (0 = full straight extension, >0 = bent knee)
    v_hu = (hip - knee) / max(1e-6, float(np.linalg.norm(hip - knee)))
    v_hl = (ankle - knee) / max(1e-6, float(np.linalg.norm(ankle - knee)))
    cos_knee = _clamp(float(np.dot(v_hu, v_hl)), -1.0, 1.0)
    interior_deg = math.degrees(math.acos(cos_knee))
    bend_deg = max(0.0, 180.0 - interior_deg)
    max_knee_deg = float(bnd.get("max_knee_deg", 132.0))
    if bend_deg > max_knee_deg:
        clamped = True

    toe_rad = math.radians(foot_angle_deg)
    toe = np.array(
        [
            ankle[0] + facing_sign * math.cos(toe_rad) * (foot_size * 0.72),
            ankle[1] + math.sin(toe_rad) * (foot_size * 0.72),
        ],
        dtype=float,
    )
    if ground_y is not None and toe[1] > float(ground_y):
        toe[1] = float(ground_y)

    actual_u = float(np.linalg.norm(knee - hip))
    actual_l = float(np.linalg.norm(ankle - knee))

    return LegPose(
        side=side,
        hip_xy=(float(hip[0]), float(hip[1])),
        knee_xy=(float(knee[0]), float(knee[1])),
        ankle_xy=(float(ankle[0]), float(ankle[1])),
        toe_xy=(float(toe[0]), float(toe[1])),
        foot_angle_deg=float(foot_angle_deg),
        upper_len=u_len,
        lower_len=l_len,
        actual_upper_len=actual_u,
        actual_lower_len=actual_l,
        bend_angle_deg=float(bend_deg),
        knee_forward_sign=facing_sign,
        ground_normal=(0.0, -1.0),
        contact_state=contact_state,
        clamped_reach=clamped,
    )


def _normalize_shot(state_or_shot: ShotMotion | Mapping[str, Any] | str, t: float, root_path: Sequence[tuple[float, float]] | None = None) -> ShotMotion:
    if isinstance(state_or_shot, ShotMotion):
        return state_or_shot
    if isinstance(state_or_shot, Mapping):
        return ShotMotion(
            shot_id=str(state_or_shot.get("shot_id", state_or_shot.get("id", "shot"))),
            start_s=float(state_or_shot.get("start_s", state_or_shot.get("start", 0.0))),
            end_s=float(state_or_shot.get("end_s", state_or_shot.get("end", max(0.1, t + 1.0)))),
            start_x=float(state_or_shot.get("start_x", 0.0)),
            end_x=float(state_or_shot.get("end_x", 0.0)),
            start_y=float(state_or_shot.get("start_y", 0.0)),
            end_y=float(state_or_shot.get("end_y", 0.0)),
            state=str(state_or_shot.get("state", "idle")),
            facing=float(state_or_shot.get("facing", 1.0)),
            cadence_hz=float(state_or_shot.get("cadence_hz", 2.0)),
            stride_len=float(state_or_shot.get("stride_len", 110.0)),
            foot_lift=float(state_or_shot.get("foot_lift", 28.0)),
            pelvis_drop=float(state_or_shot.get("pelvis_drop", 4.0)),
            easing=str(state_or_shot.get("easing", "smooth")),
            anticipate_s=float(state_or_shot.get("anticipate_s", 0.16)),
            settle_s=float(state_or_shot.get("settle_s", 0.18)),
            arm_swing_amp=float(state_or_shot.get("arm_swing_amp", 0.32)),
            step_count_override=state_or_shot.get("step_count_override"),
            phase_origin=float(state_or_shot.get("phase_origin", 0.0)),
            seed=int(state_or_shot.get("seed", 1)),
        )
    st_name = str(state_or_shot)
    if st_name not in VALID_MOTION_STATES:
        raise ValueError(f"Unsupported motion state: {st_name}")
    sx, ex = (0.0, 0.0)
    t0, t1 = (0.0, max(1.0, float(t) + 0.5))
    if root_path and len(root_path) >= 2:
        t0, sx = float(root_path[0][0]), float(root_path[0][1])
        t1, ex = float(root_path[-1][0]), float(root_path[-1][1])
    return ShotMotion(
        shot_id="fixture",
        start_s=t0,
        end_s=t1,
        start_x=sx,
        end_x=ex,
        state=st_name,
        facing=-1.0 if ex < sx - 1e-3 else 1.0,
    )


def _compute_step_schedule(shot: ShotMotion, profile: MotionProfile) -> dict[str, Any]:
    """Build a purely analytical, seek-invariant step schedule over [start_s, end_s]."""
    t0 = float(shot.start_s)
    t1 = max(t0 + 1e-4, float(shot.end_s))
    dur = t1 - t0
    sx, ex = float(shot.start_x), float(shot.end_x)
    travel = abs(ex - sx)
    facing = -1.0 if (ex - sx) < -1e-3 else (1.0 if (ex - sx) > 1e-3 else (-1.0 if shot.facing < 0 else 1.0))

    if shot.state not in LOCOMOTION_STATES or travel < 4.0:
        return {
            "is_loco": False,
            "t0": t0,
            "t1": t1,
            "dur": dur,
            "t_move0": t0,
            "t_move1": t1,
            "facing": facing,
            "n_half": 0,
            "anchors": [],
            "times": [t0, t1],
        }

    ant = min(dur * 0.22, max(0.0, float(shot.anticipate_s)))
    stl = min(dur * 0.24, max(0.0, float(shot.settle_s)))
    if ant + stl >= dur * 0.72:
        ant = dur * 0.12
        stl = dur * 0.14
    t_move0 = t0 + ant
    t_move1 = t1 - stl
    move_dur = max(0.15, t_move1 - t_move0)

    # Bound half-step reach within <= 78% of full leg extension so planted foot never forces impossible stretch
    max_half_stride = max(24.0, profile.leg_total_len * 0.78)
    target_half_stride = _clamp(shot.stride_len * 0.55, 22.0, max_half_stride)
    min_half_for_reach = int(math.ceil(travel / max_half_stride))
    desired_half = max(4, round(move_dur * max(1.0, shot.cadence_hz) * 1.4), round(travel / target_half_stride))
    if shot.step_count_override is not None and int(shot.step_count_override) >= 2:
        n_half = max(min_half_for_reach, int(shot.step_count_override))
    else:
        n_half = max(4, min_half_for_reach, desired_half)
    # Keep even half-steps so left/right finish balanced in natural two-foot stance
    if n_half % 2 == 1:
        n_half += 1
    while travel / max(1, n_half) > max_half_stride:
        n_half += 2

    times = [t_move0 + move_dur * (k / n_half) for k in range(n_half + 1)]

    def root_during_move(tau: float) -> float:
        u = _clamp((tau - t_move0) / move_dur, 0.0, 1.0)
        return _lerp(sx, ex, _ease_val(u, shot.easing))

    # Each half-step k plants one foot cleanly near the root midpoint of [times[k], times[k+1]]
    anchors: list[tuple[float, float]] = []
    half_stance_sep = 16.0
    for k in range(n_half + 1):
        side = "left" if (k % 2 == 0) else "right"
        lateral = -facing * half_stance_sep if side == "left" else facing * half_stance_sep
        if k == 0:
            anchors.append((sx + lateral * 0.9, profile.ground_y))
        elif k == n_half:
            anchors.append((ex + lateral * 0.9, profile.ground_y))
        else:
            t_mid = 0.5 * (times[k] + times[k + 1])
            px = root_during_move(t_mid) + facing * 4.0
            anchors.append((px, profile.ground_y))

    return {
        "is_loco": True,
        "t0": t0,
        "t1": t1,
        "dur": dur,
        "t_move0": t_move0,
        "t_move1": t_move1,
        "move_dur": move_dur,
        "facing": facing,
        "n_half": n_half,
        "times": times,
        "anchors": anchors,
        "sx": sx,
        "ex": ex,
    }


def _desired_root_x(shot: ShotMotion, sched: dict[str, Any], t: float) -> tuple[float, float, str]:
    t0, t1 = sched["t0"], sched["t1"]
    tc = _clamp(t, t0, t1)
    dur = sched["dur"]
    sx, ex = float(shot.start_x), float(shot.end_x)

    if not sched["is_loco"]:
        u = _clamp((tc - t0) / max(1e-4, dur), 0.0, 1.0)
        eu = _ease_val(u, shot.easing)
        x = _lerp(sx, ex, eu)
        speed = abs(ex - sx) / max(1e-4, dur)
        return x, speed, shot.state

    t_m0, t_m1 = sched["t_move0"], sched["t_move1"]
    facing = sched["facing"]
    if tc < t_m0:
        # Anticipation crouch / subtle weight shift back before explosion forward
        au = _clamp((tc - t0) / max(1e-4, t_m0 - t0), 0.0, 1.0)
        recoil = math.sin(au * math.pi) * min(8.0, abs(ex - sx) * 0.04) * (-facing)
        return sx + recoil, 0.0, "anticipate"
    if tc > t_m1:
        # Braking overshoot settle onto final planted stance
        su = _clamp((tc - t_m1) / max(1e-4, t1 - t_m1), 0.0, 1.0)
        overshoot = math.sin(su * math.pi) * (1.0 - su) * min(10.0, abs(ex - sx) * 0.05) * facing
        return ex + overshoot, 0.0, "stop" if su < 0.7 else "recover"

    mu = _clamp((tc - t_m0) / max(1e-4, sched["move_dur"]), 0.0, 1.0)
    eu = _ease_val(mu, shot.easing)
    x = _lerp(sx, ex, eu)
    eps = 0.005
    u2 = _clamp(mu + eps, 0.0, 1.0)
    dx = abs(_lerp(sx, ex, _ease_val(u2, shot.easing)) - x)
    speed = dx / (eps * max(1e-4, sched["move_dur"]))
    return x, speed, shot.state


def resolve_foot_contacts(
    state: ShotMotion | Mapping[str, Any] | str,
    t: float,
    contact_plan_or_profile: MotionProfile | ShotMotion | Mapping[str, Any] | None = None,
) -> ContactPlan:
    """Resolve world-locked left/right foot contacts cleanly without frame-order mutable dependency."""
    profile = contact_plan_or_profile if isinstance(contact_plan_or_profile, MotionProfile) else MotionProfile()
    shot = _normalize_shot(state, float(t))
    sched = _compute_step_schedule(shot, profile)
    tc = _clamp(float(t), sched["t0"], sched["t1"])
    rx, speed, substate = _desired_root_x(shot, sched, tc)
    facing = sched["facing"]
    gy = float(profile.ground_y)

    if not sched["is_loco"]:
        # Natural two-foot stance grounded cleanly with facing offset
        l_x = rx - facing * 19.0
        r_x = rx + facing * 21.0
        left_fc = FootContact("left", "stance", (l_x, gy), (l_x, gy), sched["t0"], sched["t1"], 1.0, 0.0, 0.0)
        right_fc = FootContact("right", "stance", (r_x, gy), (r_x, gy), sched["t0"], sched["t1"], 1.0, 0.0, 0.0)
        return ContactPlan(
            t=float(t),
            left=left_fc,
            right=right_fc,
            step_index=0,
            ground_y=gy,
            root_speed=speed,
            is_moving=False,
            active_support="both",
            blend_state=substate,
            stride_phase=0.0,
        )

    times = sched["times"]
    anchors = sched["anchors"]
    n_half = sched["n_half"]
    lift = float(shot.foot_lift if shot.foot_lift > 0 else profile.foot_lift)

    # Pre-takeoff anticipate & post-brake recover: both feet securely planted on world anchors!
    if tc < sched["t_move0"]:
        lx, ly = anchors[0]
        rx_a, ry_a = (anchors[0][0] + facing * 34.0, gy)
        left_fc = FootContact("left", "stance", (lx, ly), (lx, ly), sched["t0"], sched["t_move0"], 1.0, 0.0, 0.0)
        right_fc = FootContact("right", "stance", (rx_a, ry_a), (rx_a, ry_a), sched["t0"], sched["t_move0"], 1.0, 0.0, 0.0)
        return ContactPlan(float(t), left_fc, right_fc, 0, gy, speed, False, "both", "anticipate", 0.0)

    if tc >= sched["t_move1"]:
        last_side = "left" if ((n_half - 1) % 2 == 0) else "right"
        lx = anchors[-1][0] if last_side == "left" else anchors[-2][0]
        rx_f = anchors[-2][0] if last_side == "left" else anchors[-1][0]
        # Ensure clean shoulder-width stance after landing
        if abs(rx_f - lx) < 22.0:
            lx = shot.end_x - facing * 19.0
            rx_f = shot.end_x + facing * 21.0
        left_fc = FootContact("left", "stance", (lx, gy), (lx, gy), sched["t_move1"], sched["t1"], 1.0, 0.0, 0.0)
        right_fc = FootContact("right", "stance", (rx_f, gy), (rx_f, gy), sched["t_move1"], sched["t1"], 1.0, 0.0, 0.0)
        return ContactPlan(float(t), left_fc, right_fc, n_half, gy, speed, False, "both", substate, float(n_half) * 0.5)

    # Locate half-step index k in [0, n_half - 1]
    k = 0
    for idx in range(n_half):
        if times[idx] <= tc <= times[idx + 1]:
            k = idx
            break
    t_s = times[k]
    t_e = times[k + 1]
    swing_u = _clamp((tc - t_s) / max(1e-5, t_e - t_s), 0.0, 1.0)

    stance_side = "left" if (k % 2 == 0) else "right"
    swing_side = "right" if stance_side == "left" else "left"

    # Stance leg locks 100% immovably on anchors[k] for entire [t_s, t_e]
    st_x, st_y = anchors[k]
    stance_fc = FootContact(
        side=stance_side,
        state="stance",
        plant_world=(st_x, st_y),
        target_world=(st_x, st_y),
        touchdown_t=t_s,
        toe_off_t=t_e,
        stance_fraction=1.0,
        drift_world=0.0,
        swing_u=0.0,
    )

    # Swing leg smoothly leaves previous planted anchor and touches down on anchors[k + 1]
    prev_anchor = (st_x + facing * 34.0, gy) if k == 0 else anchors[k - 1]
    next_anchor = anchors[k + 1]
    sw_x = _lerp(prev_anchor[0], next_anchor[0], _smooth(swing_u))
    # Arc peak in mid-swing; subtle asymmetric lift gives weighty kick-off & crisp heel landing
    arc = math.sin(swing_u * math.pi) ** 0.82
    sw_y = gy - arc * lift
    swing_fc = FootContact(
        side=swing_side,
        state="swing",
        plant_world=next_anchor,
        target_world=(sw_x, sw_y),
        touchdown_t=t_e,
        toe_off_t=t_s,
        stance_fraction=0.0,
        drift_world=0.0,
        swing_u=swing_u,
    )

    left_fc = stance_fc if stance_side == "left" else swing_fc
    right_fc = stance_fc if stance_side == "right" else swing_fc
    return ContactPlan(
        t=float(t),
        left=left_fc,
        right=right_fc,
        step_index=k,
        ground_y=gy,
        root_speed=speed,
        is_moving=True,
        active_support=stance_side,
        blend_state=shot.state,
        stride_phase=(k + swing_u) * 0.5 + shot.phase_origin,
    )


def solve_pelvis_root(
    contact_plan: ContactPlan,
    desired_root: ShotMotion | Sequence[float] | tuple[float, float],
    profile: MotionProfile,
) -> RootPose:
    """Solve pelvis root position & lean respecting world foot lock (no impossible leg over-extension)."""
    facing = profile.facing_sign
    if isinstance(desired_root, ShotMotion):
        sched = _compute_step_schedule(desired_root, profile)
        base_x, _, substate = _desired_root_x(desired_root, sched, contact_plan.t)
        base_y = _lerp(desired_root.start_y, desired_root.end_y, _clamp((contact_plan.t - desired_root.start_s) / max(1e-4, desired_root.end_s - desired_root.start_s), 0.0, 1.0))
        facing = sched["facing"]
        bob_amp = profile.pelvis_bob
        state_name = desired_root.state
        drop_extra = float(desired_root.pelvis_drop)
    else:
        pt = _finite_xy(desired_root, "desired_root")
        base_x, base_y = float(pt[0]), float(pt[1])
        substate = contact_plan.blend_state
        bob_amp = profile.pelvis_bob
        state_name = contact_plan.blend_state
        drop_extra = 4.0

    # Natural gait bob & anticipation/brake crouch
    pelvis_drop = 0.0
    torso_lean = 0.0
    if contact_plan.is_moving:
        # Two drops per full stride cycle: lowest at mid-stance absorption, peak upward at passing/pushoff
        phase_rad = contact_plan.stride_phase * math.pi * 2.0
        pelvis_drop = drop_extra + (0.5 - 0.5 * math.cos(phase_rad * 2.0)) * bob_amp
        speed_factor = _clamp(contact_plan.root_speed / 160.0, 0.2, 1.35)
        base_lean = 12.0 if state_name == "dash" else (8.5 if state_name == "run" else 4.0)
        torso_lean = facing * base_lean * speed_factor
    elif substate == "anticipate":
        pelvis_drop = 12.0
        torso_lean = facing * 7.5
    elif substate == "stop":
        pelvis_drop = 9.0
        torso_lean = -facing * 4.5
    elif substate in ("react", "recover"):
        pelvis_drop = 3.5

    # Clamp root so the locked stance leg never stretches beyond 97% of leg_total_len!
    hip_y_nominal = 0.5 * (profile.hip_left_local[1] + profile.hip_right_local[1])
    max_reach = 0.965 * profile.leg_total_len

    for fc, hip_off in ((contact_plan.left, profile.hip_left_local), (contact_plan.right, profile.hip_right_local)):
        if fc.state != "stance":
            continue
        hx = base_x + hip_off[0]
        hy = base_y + pelvis_drop + hip_off[1]
        dx = fc.plant_world[0] - hx
        dy = fc.plant_world[1] - hy
        dist = math.hypot(dx, dy)
        if dist > max_reach:
            # Drop pelvis vertically or pull horizontal slightly only after max drop to keep foot locked
            allowed_v = math.sqrt(max(64.0, max_reach * max_reach - dx * dx)) if abs(dx) < max_reach * 0.92 else max_reach * 0.45
            needed_hy = fc.plant_world[1] - allowed_v
            if needed_hy > hy:
                pelvis_drop += (needed_hy - hy)
                hy = needed_hy
            # If horizontal spread exceeds reach cone, ease root toward stance foot (foot lock wins!)
            dx2 = fc.plant_world[0] - hx
            dy2 = fc.plant_world[1] - hy
            d2 = math.hypot(dx2, dy2)
            if d2 > max_reach:
                max_dx = math.sqrt(max(4.0, max_reach * max_reach - dy2 * dy2))
                base_x = fc.plant_world[0] - math.copysign(max_dx, dx2) - hip_off[0]

    hip_l = (base_x + profile.hip_left_local[0], base_y + pelvis_drop + profile.hip_left_local[1])
    hip_r = (base_x + profile.hip_right_local[0], base_y + pelvis_drop + profile.hip_right_local[1])

    _ = hip_y_nominal
    return RootPose(
        world_x=float(base_x),
        world_y=float(base_y + pelvis_drop),
        pelvis_drop=float(pelvis_drop),
        torso_lean_deg=float(_clamp(torso_lean, -22.0, 22.0)),
        facing=float(facing),
        hip_left_world=hip_l,
        hip_right_world=hip_r,
        scale=1.0,
    )


def sample_upper_body_motion(
    gait: ContactPlan | GaitPose,
    action: str | Mapping[str, Any] | None,
    contact_targets: Mapping[str, Any] | None,
    profile: MotionProfile,
    t: float,
) -> ArmHeadTorsoPose:
    """Generate counter-swinging arms + follow-through nod, always yielding to active prop wrist_targets."""
    plan = gait.contact_plan if isinstance(gait, GaitPose) else gait
    locked = tuple(sorted((contact_targets or {}).keys()))

    action_dict = action if isinstance(action, Mapping) else {}
    def_l = tuple(action_dict.get("left_arm", ("rest", 0.5))) if action_dict else ("rest", 0.5)
    def_r = tuple(action_dict.get("right_arm", ("rest", 0.5))) if action_dict else ("rest", 0.5)
    base_head = float(action_dict.get("head_angle_deg", 0.0)) if action_dict else 0.0

    l_name, l_ph = str(def_l[0]), float(def_l[1])
    r_name, r_ph = str(def_r[0]), float(def_r[1])

    if plan.is_moving:
        # Left foot forward (phase ~ 0.25) -> RIGHT arm reaches forward; opposite counter-swing!
        swing_wave = math.sin(plan.stride_phase * math.pi * 2.0)
        amp = float(profile.arm_swing_amp)
        if "left" not in locked:
            l_name = str(action_dict.get("gait_left_action", "reach" if l_name == "rest" else l_name))
            l_ph = _clamp(l_ph - amp * swing_wave, 0.05, 0.95)
        if "right" not in locked:
            r_name = str(action_dict.get("gait_right_action", "reach" if r_name == "rest" else r_name))
            r_ph = _clamp(r_ph + amp * swing_wave, 0.05, 0.95)
        head_nod = base_head + math.sin(plan.stride_phase * math.pi * 4.0) * 2.2
        lean = plan.root_speed / 45.0 * profile.facing_sign
    else:
        head_nod = base_head + math.sin(float(t) * 2.1) * 0.9
        lean = 0.0

    return ArmHeadTorsoPose(
        left_arm=(l_name, float(l_ph)),
        right_arm=(r_name, float(r_ph)),
        head_angle_deg=float(_clamp(head_nod, -20.0, 20.0)),
        torso_lean_deg=float(_clamp(lean, -18.0, 18.0)),
        pelvis_y_offset=0.0,
        locked_arms=locked,
    )


def sample_gait(
    profile: MotionProfile,
    t: float,
    root_path: ShotMotion | Sequence[tuple[float, float]] | Mapping[str, Any],
    state: str | None = None,
    phase_origin: float = 0.0,
    *,
    action: Mapping[str, Any] | None = None,
    contact_targets: Mapping[str, Any] | None = None,
) -> GaitPose:
    """Full deterministic sample at time `t` combining foot contacts, pelvis drop, 2-bone knee IK, and arms."""
    if isinstance(root_path, ShotMotion):
        shot = root_path
    elif isinstance(state, ShotMotion):
        shot = state
    elif isinstance(root_path, Mapping):
        shot = _normalize_shot(root_path, t)
    else:
        shot = _normalize_shot(state or "walk", t, root_path=root_path)

    if isinstance(state, str) and state != shot.state:
        shot = ShotMotion(**{**shot.__dict__, "state": state, "phase_origin": phase_origin})
    elif abs(phase_origin - shot.phase_origin) > 1e-6:
        shot = ShotMotion(**{**shot.__dict__, "phase_origin": phase_origin})

    plan = resolve_foot_contacts(shot, t, profile)
    root = solve_pelvis_root(plan, shot, profile)
    bounds = {"ground_y": profile.ground_y, "max_knee_deg": profile.max_knee_deg}

    # Natural foot pitch: toe rises gently during swing, sits flat horizontal (0 deg) in stance
    def leg_from_contact(fc: FootContact, hip_w: tuple[float, float]) -> LegPose:
        if fc.state == "swing":
            # Back-kick toe down early in swing, dorsiflex slightly before heel-strike
            foot_ang = _lerp(18.0, -10.0, _smooth(fc.swing_u)) * root.facing
        else:
            foot_ang = 0.0
        target_ankle = fc.plant_world if fc.state == "stance" else fc.target_world
        return solve_two_bone_ik(
            hip_w,
            target_ankle,
            profile.upper_leg_len,
            profile.lower_leg_len,
            knee_hint=root.facing,
            bounds=bounds,
            side=fc.side,
            foot_size=profile.foot_size[0],
            contact_state=fc.state,
            foot_angle_deg=foot_ang,
        )

    left_leg = leg_from_contact(plan.left, root.hip_left_world)
    right_leg = leg_from_contact(plan.right, root.hip_right_world)
    upper = sample_upper_body_motion(plan, action, contact_targets, profile, t)

    return GaitPose(
        t=float(t),
        state=plan.blend_state,
        facing=root.facing,
        root=root,
        contact_plan=plan,
        left_leg=left_leg,
        right_leg=right_leg,
        upper_body=upper,
        phase_continuous=float(plan.stride_phase),
        stride_count_elapsed=float(plan.stride_phase),
        state_blend={"substate": plan.blend_state, "support": plan.active_support, "step_index": plan.step_index},
    )
