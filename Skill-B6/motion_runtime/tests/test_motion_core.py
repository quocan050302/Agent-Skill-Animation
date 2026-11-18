"""Unit, determinism, pixel, and negative mutation tests for Skill-B6/motion_runtime."""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
import sys
import unittest
import numpy as np

RUNTIME_PARENT = str(Path(__file__).resolve().parents[2])
if RUNTIME_PARENT not in sys.path:
    sys.path.insert(0, RUNTIME_PARENT)

from motion_runtime import (  # noqa: E402
    MotionProfile,
    ShotMotion,
    motion_evidence_at,
    render_articulated_legs,
    resolve_foot_contacts,
    sample_gait,
    sample_upper_body_motion,
    solve_pelvis_root,
    solve_two_bone_ik,
    validate_motion_contract,
)


class MotionCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.profile = MotionProfile(upper_leg_len=46.0, lower_leg_len=46.0, ink_width=5.4, foot_style="tabi")

    def test_two_bone_ik_preserves_lengths_and_forward_knee_polarity(self) -> None:
        for facing in (1.0, -1.0):
            hip = (0.0, -88.0)
            for ankle_x in (-28.0, 0.0, 28.0):
                for ankle_y in (-18.0, 0.0, 12.0):
                    pose = solve_two_bone_ik(
                        hip,
                        (ankle_x, ankle_y),
                        46.0,
                        46.0,
                        knee_hint=facing,
                        bounds={"ground_y": 0.0},
                        side="left",
                    )
                    self.assertTrue(abs(pose.actual_upper_len - 46.0) < 1e-4)
                    self.assertTrue(abs(pose.actual_lower_len - 46.0) < 1e-4)
                    self.assertLessEqual(pose.ankle_xy[1], 1e-5)
                    # Check knee points strictly forward relative to hip->ankle chord
                    mid_x = 0.5 * (pose.hip_xy[0] + pose.ankle_xy[0])
                    if pose.bend_angle_deg > 1.5:
                        self.assertGreater((pose.knee_xy[0] - mid_x) * facing, -1e-4)

    def test_idle_stays_planted_without_hopping(self) -> None:
        shot = ShotMotion("idle-1", 0.0, 1.5, 0.0, 0.0, state="idle", facing=1.0)
        rows = []
        for f in range(45):
            t = f / 30.0
            gait = sample_gait(self.profile, t, shot)
            self.assertEqual(gait.contact_plan.left.state, "stance")
            self.assertEqual(gait.contact_plan.right.state, "stance")
            self.assertFalse(gait.contact_plan.is_moving)
            rows.append(motion_evidence_at(t, gait, frame_idx=f, shot_id=shot.shot_id))
        qc = validate_motion_contract(rows)
        self.assertEqual(qc["status"], "pass", qc["errors"])
        self.assertEqual(qc["summary"]["locomotion_frames"], 0)
        self.assertLess(qc["summary"]["max_stance_drift_world"], 1e-3)

    def test_dash_and_run_have_real_bent_knees_world_lock_and_counter_swing(self) -> None:
        shot = ShotMotion("dash-1", 0.0, 2.4, -40.0, 210.0, state="dash", facing=1.0, cadence_hz=2.5, stride_len=120.0, foot_lift=30.0)
        rows = []
        max_bend = 0.0
        for f in range(72):
            t = f / 30.0
            gait = sample_gait(self.profile, t, shot)
            max_bend = max(max_bend, gait.left_leg.bend_angle_deg, gait.right_leg.bend_angle_deg)
            rows.append(motion_evidence_at(t, gait, frame_idx=f, shot_id=shot.shot_id))
        qc = validate_motion_contract(rows)
        self.assertEqual(qc["status"], "pass", qc["errors"])
        self.assertGreater(max_bend, 22.0)
        self.assertIn("left", qc["summary"]["supports_observed"])
        self.assertIn("right", qc["summary"]["supports_observed"])
        self.assertLess(qc["summary"]["max_stance_drift_world"], 1e-3)
        self.assertLessEqual(qc["summary"]["max_ground_penetration_world"], 1e-4)
        self.assertGreater(qc["summary"]["max_locomotion_knee_deviation_px"], 5.0)

    def test_reverse_walk_and_stop_brake_preserve_facing_and_lengths(self) -> None:
        shot = ShotMotion("rev-1", 0.0, 1.8, 120.0, -40.0, state="walk", facing=-1.0, cadence_hz=1.8, foot_lift=20.0)
        rows = [motion_evidence_at(f / 30.0, sample_gait(self.profile, f / 30.0, shot), frame_idx=f, shot_id="rev-1") for f in range(54)]
        qc = validate_motion_contract(rows)
        self.assertEqual(qc["status"], "pass", qc["errors"])
        for r in rows:
            self.assertEqual(r["facing"], -1.0)

    def test_upper_body_counter_swing_yields_to_locked_prop_arm(self) -> None:
        shot = ShotMotion("prop-hold", 0.0, 2.0, 0.0, 160.0, state="run", facing=1.0)
        cp = resolve_foot_contacts(shot, 0.75, self.profile)
        upper_free = sample_upper_body_motion(cp, {"left_arm": ("rest", 0.5), "right_arm": ("rest", 0.5)}, {}, self.profile, 0.75)
        upper_hold = sample_upper_body_motion(cp, {"left_arm": ("rest", 0.5), "right_arm": ("offer", 0.88)}, {"right": [100.0, -120.0]}, self.profile, 0.75)
        self.assertEqual(upper_hold.right_arm, ("offer", 0.88))
        self.assertIn("right", upper_hold.locked_arms)
        # Left arm remains free to counter-swing
        self.assertNotEqual(upper_free.left_arm[1], 0.5)

    def test_random_seek_and_out_of_order_frames_produce_identical_poses_and_pixels(self) -> None:
        shot = ShotMotion("seek-test", 0.0, 3.0, -60.0, 220.0, state="dash", facing=1.0)
        seq = {}
        seq_sha = {}
        for f in range(90):
            t = f / 30.0
            g = sample_gait(self.profile, t, shot)
            seq[f] = g
            if f in (0, 35, 58, 89):
                ren = render_articulated_legs(
                    None,
                    {"left": g.left_leg, "right": g.right_leg},
                    self.profile,
                    size=(360, 400),
                    world_to_screen_fn=lambda p: (p[0] + 100.0, p[1] + 300.0),
                )
                seq_sha[f] = hashlib.sha256(np.asarray(ren["image"]).tobytes()).hexdigest()

        for f in [89, 0, 58, 35, 58, 0]:
            t = f / 30.0
            g2 = sample_gait(self.profile, t, shot)
            self.assertEqual(g2.left_leg.knee_xy, seq[f].left_leg.knee_xy)
            self.assertEqual(g2.right_leg.ankle_xy, seq[f].right_leg.ankle_xy)
            self.assertEqual(g2.root.world_x, seq[f].root.world_x)
            ren2 = render_articulated_legs(
                None,
                {"left": g2.left_leg, "right": g2.right_leg},
                self.profile,
                size=(360, 400),
                world_to_screen_fn=lambda p: (p[0] + 100.0, p[1] + 300.0),
            )
            sha2 = hashlib.sha256(np.asarray(ren2["image"]).tobytes()).hexdigest()
            self.assertEqual(sha2, seq_sha[f])

    def test_render_articulated_legs_draws_nonempty_bent_silhouette(self) -> None:
        shot = ShotMotion("pix", 0.0, 1.5, 0.0, 140.0, state="dash", facing=1.0)
        g = sample_gait(self.profile, 0.65, shot)
        res = render_articulated_legs(
            None,
            {"left": g.left_leg, "right": g.right_leg},
            self.profile,
            size=(400, 400),
            world_to_screen_fn=lambda p: (p[0] + 120.0, p[1] + 320.0),
        )
        rgba = np.asarray(res["image"])
        self.assertGreater(int(np.count_nonzero(rgba[:, :, 3] > 32)), 500)
        self.assertGreater(int(np.count_nonzero(res["masks"]["left:shaft"] > 32)), 100)
        self.assertGreater(int(np.count_nonzero(res["masks"]["left:foot"] > 32)), 60)

    def test_validate_motion_contract_rejects_negative_mutations(self) -> None:
        shot = ShotMotion("mut", 0.0, 1.5, 0.0, 120.0, state="run", facing=1.0)
        base_rows = [motion_evidence_at(f / 30.0, sample_gait(self.profile, f / 30.0, shot), frame_idx=f, shot_id="mut") for f in range(45)]
        self.assertEqual(validate_motion_contract(base_rows)["status"], "pass")

        # 1. Mutation: straight-leg fake run (collinear knees, bend=0)
        straight_rows = []
        for r in base_rows:
            r2 = {**r, "left": {**r["left"], "bend_angle_deg": 0.5, "knee_deviation": 0.1}, "right": {**r["right"], "bend_angle_deg": 0.4, "knee_deviation": 0.2}}
            straight_rows.append(r2)
        self.assertEqual(validate_motion_contract(straight_rows)["status"], "fail")

        # 2. Mutation: inverse knee
        inv_rows = [dict(r) for r in base_rows]
        inv_rows[10] = {**inv_rows[10], "left": {**inv_rows[10]["left"], "knee_forward_ok": False, "forward_offset": -9.0}}
        self.assertEqual(validate_motion_contract(inv_rows)["status"], "fail")

        # 3. Mutation: ground penetration
        pen_rows = [dict(r) for r in base_rows]
        pen_rows[12] = {**pen_rows[12], "right": {**pen_rows[12]["right"], "ground_penetration": 6.5}}
        self.assertEqual(validate_motion_contract(pen_rows)["status"], "fail")

        # 4. Mutation: stance foot drift / sliding
        slide_rows = [dict(r) for r in base_rows]
        slide_rows[15] = {**slide_rows[15], "left": {**slide_rows[15]["left"], "world_drift": 4.2}}
        self.assertEqual(validate_motion_contract(slide_rows)["status"], "fail")

        # 5. Mutation: non-finite joint
        nan_rows = [dict(r) for r in base_rows]
        nan_rows[5] = {**nan_rows[5], "left": {**nan_rows[5]["left"], "finite": False}}
        self.assertEqual(validate_motion_contract(nan_rows)["status"], "fail")

        # 6. Mutation: prop contact error > 0.75
        prop_rows = [dict(r) for r in base_rows]
        prop_rows[8] = {**prop_rows[8], "max_prop_contact_error_px": 2.1}
        self.assertEqual(validate_motion_contract(prop_rows)["status"], "fail")

        # 7. Mutation: unannotated teleport within same shot
        jump_rows = [dict(r) for r in base_rows]
        jump_rows[20] = {**jump_rows[20], "root_x": float(jump_rows[19]["root_x"]) + 90.0}
        self.assertEqual(validate_motion_contract(jump_rows)["status"], "fail")


if __name__ == "__main__":
    unittest.main()
