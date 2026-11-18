"""Adversarial negative-injection & end-to-end QC tests for b6_semantic_qc & b6_semantic_cli."""
from __future__ import annotations

import copy
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
import cv2
import numpy as np

RUNTIME_PARENT = str(Path(__file__).resolve().parents[2])
if RUNTIME_PARENT not in sys.path:
    sys.path.insert(0, RUNTIME_PARENT)

from semantic_runtime.b6_semantic_cli import main as semantic_cli_main  # noqa: E402
from semantic_runtime.b6_semantic_contract import compile_semantic_action_plan  # noqa: E402
from semantic_runtime.b6_semantic_evidence import (  # noqa: E402
    capture_semantic_frame_evidence,
    write_semantic_evidence_stream,
)
from semantic_runtime.b6_semantic_qc import (  # noqa: E402
    SEMANTIC_QC_SCHEMA,
    evaluate_semantic_qc,
    write_semantic_qc_atomic,
)


def _synth_rich_bg(w: int, h: int, idx: int) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.uint8(np.clip(35 + 25 * np.sin(xx * 0.04 + idx * 0.05), 0, 255))
    g = np.uint8(np.clip(55 + 30 * np.cos(yy * 0.03), 0, 255))
    b = np.uint8(np.clip(80 + 20 * np.sin((xx + yy) * 0.025), 0, 255))
    return np.dstack([r, g, b])


def _draw_actor(img: np.ndarray, cx: float, cy: float, *, head_attached: bool = True, crouch: float = 0.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    h, w = img.shape[:2]
    vis = np.zeros((h, w), dtype=np.uint8)
    raw = np.zeros((h, w), dtype=np.uint8)
    hand = np.zeros((h, w), dtype=np.uint8)
    body_top = int(round(cy - 68 + crouch))
    body_bot = int(round(cy))
    x0, x1 = int(round(cx - 22)), int(round(cx + 22))
    cv2.rectangle(img, (x0, body_top), (x1, body_bot), (225, 185, 55), -1)
    cv2.rectangle(raw, (x0, body_top), (x1, body_bot), 255, -1)
    hx, hy = int(round(cx + 26)), int(round(body_top + 18))
    cv2.circle(img, (hx, hy), 9, (60, 200, 170), -1)
    cv2.circle(hand, (hx, hy), 9, 255, -1)
    cv2.circle(raw, (hx, hy), 9, 255, -1)
    if head_attached:
        cv2.circle(img, (int(round(cx)), body_top - 16), 16, (65, 210, 180), -1)
        cv2.circle(raw, (int(round(cx)), body_top - 16), 16, 255, -1)
    vis[:] = raw
    return vis, raw, hand


class SemanticQcTests(unittest.TestCase):
    def _build_detach_reattach_sequence(
        self,
        *,
        omit_detach: bool = False,
        flat_trip: bool = False,
        far_prop_despite_held_meta: bool = False,
        normal_orient_instead_of_backwards: bool = False,
        hide_unoccluded: bool = False,
        orphan_prop_after_reattach: bool = False,
    ) -> tuple[dict, list[dict], list[np.ndarray]]:
        w, h, fps = 240, 420, 30
        plan = {
            "duration": 3.0,
            "fps": fps,
            "semanticActions": [
                {"id": "a_sneeze_detach", "actionType": "detach", "actorId": "z", "targetPropId": "z_head", "startS": 0.0, "endS": 0.5},
                {"id": "a_bounce", "actionType": "bounce", "actorId": "z", "targetPropId": "z_head", "startS": 0.5, "endS": 1.1, "prerequisiteIds": ["a_sneeze_detach"]},
                {"id": "a_chase", "actionType": "chase", "actorId": "z", "startS": 0.5, "endS": 1.6},
                {"id": "a_hide", "actionType": "hide_behind", "actorId": "h", "occluderId": "tram_post", "startS": 1.1, "endS": 1.8},
                {"id": "a_take", "actionType": "take", "actorId": "z", "targetPropId": "z_head", "startS": 1.6, "endS": 2.1, "prerequisiteIds": ["a_bounce"]},
                {
                    "id": "a_reattach",
                    "actionType": "reattach",
                    "actorId": "z",
                    "targetPropId": "z_head",
                    "expectedOrientation": "backwards",
                    "startS": 2.1,
                    "endS": 2.5,
                    "prerequisiteIds": ["a_take"],
                },
                {"id": "a_collide", "actionType": "collide", "actorId": "z", "occluderId": "tram_post", "startS": 2.5, "endS": 3.0, "prerequisiteIds": ["a_reattach"]},
            ],
        }
        if flat_trip:
            plan["semanticActions"].append({"id": "a_trip", "actionType": "trip", "actorId": "z", "startS": 1.2, "endS": 1.6})

        compiled = compile_semantic_action_plan(plan, strict=True)
        frames_rgb: list[np.ndarray] = []
        records: list[dict] = []

        for idx in range(90):
            t = idx / float(fps)
            img = _synth_rich_bg(w, h, idx)

            # Tram post occluder on right side x=[155..205], y=[130..330]
            occ_mask = np.zeros((h, w), dtype=np.uint8)
            occ_mask[130:330, 155:205] = 255

            # Zombie path across 0..3.0s
            if t < 0.5:
                zx = 55.0
            elif t < 1.6:
                zx = 55.0 + ((t - 0.5) / 1.1) * 85.0
            elif t < 2.5:
                zx = 140.0
            else:
                zx = 140.0 + ((t - 2.5) / 0.5) * 28.0

            crouch = 0.0 if flat_trip else (18.0 if (1.6 <= t < 2.1) else 0.0)
            detached_flag = (not omit_detach) and (0.15 <= t < 2.35)
            z_mount = "attached" if not detached_flag else ("detaching" if t < 0.25 else ("reattaching" if t >= 2.2 else "detached"))
            if not omit_detach and t >= 0.45 and t < 2.35:
                z_mount = "detached" if t < 2.2 else "reattaching"

            z_vis, z_raw, z_hand = _draw_actor(img, zx, 320.0, head_attached=(z_mount == "attached"), crouch=crouch)

            # Human hiding behind tram post during [1.1..1.8)
            hx = 180.0 if (1.1 <= t < 1.8) else 210.0
            h_vis, h_raw, h_hand = _draw_actor(img, hx, 320.0, head_attached=True)
            if not hide_unoccluded:
                # Composite occluder OVER human & z overlap so hide_behind truly occludes!
                h_vis[occ_mask > 0] = 0
                z_vis[occ_mask > 0] = 0
            cv2.rectangle(img, (155, 130), (205, 330), (210, 85, 40), -1)

            # Detached head prop
            head_prop_mask = np.zeros((h, w), dtype=np.uint8)
            prop_x, prop_y, prop_ang, prop_state = zx, 240.0, 0.0, "attached"
            if (detached_flag or orphan_prop_after_reattach) and t >= 0.15:
                prop_state = "detached"
                if t < 0.5:
                    prop_x = zx + (t - 0.15) * 90.0
                    prop_y = 240.0 + (t - 0.15) * 140.0
                elif t < 1.1:
                    u = (t - 0.5) / 0.6
                    prop_x = zx + 35.0 + u * 85.0
                    # Bounce arc (goes down, hits ground, goes up, comes down)
                    prop_y = 305.0 - abs(math.sin(u * math.pi * 2.0)) * 55.0
                    prop_ang = u * 220.0
                elif t < 1.6:
                    prop_x = 165.0
                    prop_y = 305.0
                    prop_ang = 220.0
                elif t < 2.1:
                    if far_prop_despite_held_meta:
                        prop_x, prop_y = 30.0, 310.0
                    else:
                        # Hand moves to reach & touch prop!
                        prop_x, prop_y = zx + 26.0, 320.0 - 50.0 + crouch
                    prop_state = "held"
                elif orphan_prop_after_reattach:
                    prop_x, prop_y, prop_state = 95.0, 305.0, "detached"
                else:
                    prop_x, prop_y = zx, 240.0

                if t < 2.35 or orphan_prop_after_reattach:
                    cv2.circle(img, (int(round(prop_x)), int(round(prop_y))), 15, (65, 210, 180), -1)
                    cv2.circle(head_prop_mask, (int(round(prop_x)), int(round(prop_y))), 15, 255, -1)

            hv = "neutral" if (normal_orient_instead_of_backwards or t < 2.35) else "backwards"
            rec = capture_semantic_frame_evidence(
                frame_idx=idx,
                t=t,
                shot_id="s1",
                canvas_size=(w, h),
                beauty_rgb=img,
                actor_visible_masks={"z": z_vis, "h": h_vis},
                actor_raw_masks={"z": z_raw, "h": h_raw},
                hand_masks={"z": [z_hand], "h": [h_hand]},
                prop_visible_masks={"z_head": head_prop_mask},
                occluder_masks={"tram_post": occ_mask},
                actor_poses={
                    "z": {"world_xy": [zx, 0.0], "facing": 1, "head_variant": hv, "head_angle_deg": 0.0, "head_mount_state": z_mount},
                    "h": {"world_xy": [hx, 0.0], "facing": -1, "head_variant": "shock", "head_angle_deg": 8.0, "head_mount_state": "attached"},
                },
                prop_states={"z_head": {"world_xy": [prop_x, prop_y - 320.0], "angle_deg": prop_ang, "state": prop_state}},
            )
            frames_rgb.append(img)
            records.append(rec)

        return compiled, records, frames_rgb

    def test_positive_and_cli_decoded_mp4_validation_pass(self) -> None:
        compiled, records, frames_rgb = self._build_detach_reattach_sequence()
        with tempfile.TemporaryDirectory() as tmp:
            td = Path(tmp)
            sc_path = td / "scene-control.json"
            sc_path.write_text(json.dumps({"duration": 3.0, "fps": 30, "semanticActions": [
                {"id": "a_sneeze_detach", "actionType": "detach", "actorId": "z", "targetPropId": "z_head", "startS": 0.0, "endS": 0.5},
                {"id": "a_bounce", "actionType": "bounce", "actorId": "z", "targetPropId": "z_head", "startS": 0.5, "endS": 1.1, "prerequisiteIds": ["a_sneeze_detach"]},
                {"id": "a_chase", "actionType": "chase", "actorId": "z", "startS": 0.5, "endS": 1.6},
                {"id": "a_hide", "actionType": "hide_behind", "actorId": "h", "occluderId": "tram_post", "startS": 1.1, "endS": 1.8},
                {"id": "a_take", "actionType": "take", "actorId": "z", "targetPropId": "z_head", "startS": 1.6, "endS": 2.1, "prerequisiteIds": ["a_bounce"]},
                {"id": "a_reattach", "actionType": "reattach", "actorId": "z", "targetPropId": "z_head", "expectedOrientation": "backwards", "startS": 2.1, "endS": 2.5, "prerequisiteIds": ["a_take"]},
                {"id": "a_collide", "actionType": "collide", "actorId": "z", "occluderId": "tram_post", "startS": 2.5, "endS": 3.0, "prerequisiteIds": ["a_reattach"]},
            ]}), encoding="utf-8")

            out_dir = td / "out"
            out_dir.mkdir()
            ev_path = out_dir / "semantic-evidence.jsonl"
            write_semantic_evidence_stream(ev_path, records)

            # Write real decoded MP4 using cv2 VideoWriter + sample keyframe
            mp4 = out_dir / "preview.mp4"
            vw = cv2.VideoWriter(str(mp4), cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (240, 420))
            for fr in frames_rgb:
                vw.write(cv2.cvtColor(fr, cv2.COLOR_RGB2BGR))
            vw.release()
            cv2.imwrite(str(out_dir / "frame-0000.png"), cv2.cvtColor(frames_rgb[0], cv2.COLOR_RGB2BGR))

            rc = semantic_cli_main([
                "--video", str(mp4),
                "--out-dir", str(out_dir),
                "--scene-control", str(sc_path),
                "--evidence", str(ev_path),
                "--source-fingerprint", "a" * 64,
                "--strict-exit",
            ])
            self.assertEqual(rc, 0)
            qc = json.loads((out_dir / "semantic_qc.json").read_text(encoding="utf-8"))
            self.assertEqual(qc["schema"], SEMANTIC_QC_SCHEMA)
            self.assertEqual(qc["status"], "pass")
            self.assertTrue(qc["pass"])
            self.assertEqual(qc["verified_action_count"], qc["action_count"])
            self.assertTrue(qc["decoded_frame_verified"])

    def test_negative_injections_fail_with_exact_reason_codes(self) -> None:
        # 1. hide_behind drawn IN FRONT / unoccluded
        c_hide, r_hide, _ = self._build_detach_reattach_sequence(hide_unoccluded=True)
        qc_hide, _ = evaluate_semantic_qc(c_hide, r_hide, video_sha256="b" * 64, source_fingerprint="a" * 64, evidence_sha256="c" * 64)
        self.assertEqual(qc_hide["status"], "fail")
        self.assertIn("SEMANTIC_HIDE_OCCLUSION_INSUFFICIENT", qc_hide["reason_codes"])

        # 2. take/grab claimed in prop metadata ("held") while prop stays >45px away
        c_take, r_take, _ = self._build_detach_reattach_sequence(far_prop_despite_held_meta=True)
        qc_take, _ = evaluate_semantic_qc(c_take, r_take, video_sha256="b" * 64, source_fingerprint="a" * 64, evidence_sha256="c" * 64)
        self.assertEqual(qc_take["status"], "fail")
        self.assertIn("SEMANTIC_CONTACT_MISSING", qc_take["reason_codes"])

        # 3. detach claimed while head never detaches
        c_det, r_det, _ = self._build_detach_reattach_sequence(omit_detach=True)
        qc_det, _ = evaluate_semantic_qc(c_det, r_det, video_sha256="b" * 64, source_fingerprint="a" * 64, evidence_sha256="c" * 64)
        self.assertEqual(qc_det["status"], "fail")
        self.assertIn("SEMANTIC_DETACH_NOT_OBSERVED", qc_det["reason_codes"])

        # 4. reattach backwards orientation wrong
        c_ori, r_ori, _ = self._build_detach_reattach_sequence(normal_orient_instead_of_backwards=True)
        qc_ori, _ = evaluate_semantic_qc(c_ori, r_ori, video_sha256="b" * 64, source_fingerprint="a" * 64, evidence_sha256="c" * 64)
        self.assertEqual(qc_ori["status"], "fail")
        self.assertIn("SEMANTIC_ORIENTATION_MISMATCH", qc_ori["reason_codes"])

        # 5. orphan detached prop still visible after reattach
        c_orp, r_orp, _ = self._build_detach_reattach_sequence(orphan_prop_after_reattach=True)
        qc_orp, _ = evaluate_semantic_qc(c_orp, r_orp, video_sha256="b" * 64, source_fingerprint="a" * 64, evidence_sha256="c" * 64)
        self.assertEqual(qc_orp["status"], "fail")
        self.assertIn("SEMANTIC_REATTACH_NOT_OBSERVED", qc_orp["reason_codes"])

        # 6. flat trip missing pose change
        c_trp, r_trp, _ = self._build_detach_reattach_sequence(flat_trip=True)
        qc_trp, _ = evaluate_semantic_qc(c_trp, r_trp, video_sha256="b" * 64, source_fingerprint="a" * 64, evidence_sha256="c" * 64)
        self.assertEqual(qc_trp["status"], "fail")
        self.assertIn("SEMANTIC_POSE_CHANGE_MISSING", qc_trp["reason_codes"])

        # 7. Missing evidence frames fail-closed
        qc_empty, _ = evaluate_semantic_qc(c_hide, [], video_sha256="b" * 64, source_fingerprint="a" * 64, evidence_sha256=None)
        self.assertEqual(qc_empty["status"], "fail")
        self.assertIn("SEMANTIC_EVIDENCE_MISSING", qc_empty["reason_codes"])

        # 8. Decoded frame mismatch fails-closed
        r_bad_dec = copy.deepcopy(r_hide)
        for rr in r_bad_dec[:10]:
            rr["decoded_binding"]["binding_ok"] = False
        qc_dec, _ = evaluate_semantic_qc(c_hide, r_bad_dec, video_sha256="b" * 64, source_fingerprint="a" * 64, evidence_sha256="c" * 64)
        self.assertIn("SEMANTIC_DECODED_FRAME_MISMATCH", qc_dec["reason_codes"])

    def test_zombie_mirror_hide_behind_negative_backtest_fixture(self) -> None:
        """Backtest reproducing the B6-04 partial-edge sign occlusion gap: fails unless genuine occlusion >=35%."""
        compiled = compile_semantic_action_plan(
            {
                "duration": 1.0,
                "fps": 30,
                "semanticActions": [
                    {
                        "id": "shot_08_hide",
                        "actionType": "hide_behind",
                        "actorId": "zombie",
                        "occluderId": "fg_open_sign",
                        "startS": 0.0,
                        "endS": 1.0,
                    }
                ],
            }
        )
        h, w = 320, 180
        bg = _synth_rich_bg(w, h, 0)
        sign_mask = np.zeros((h, w), dtype=np.uint8)
        sign_mask[110:250, 95:165] = 255
        frames_partial: list[dict] = []
        frames_hidden: list[dict] = []

        for idx in range(30):
            # Partial fixture: zombie stands mostly beside sign, only ~12% overlapped
            raw = np.zeros((h, w), dtype=np.uint8)
            raw[120:260, 50:102] = 255
            vis_partial = raw.copy()
            vis_partial[sign_mask > 0] = 0
            frames_partial.append(
                capture_semantic_frame_evidence(
                    frame_idx=idx, t=idx / 30.0, shot_id="shot_08_hide", canvas_size=(w, h),
                    beauty_rgb=bg, actor_visible_masks={"zombie": vis_partial}, actor_raw_masks={"zombie": raw},
                    occluder_masks={"fg_open_sign": sign_mask}, actor_poses={"zombie": {"world_xy": [-60, 0]}},
                )
            )

            # Fixed fixture: zombie tucked behind sign (~65% behind fg_open_sign)
            raw2 = np.zeros((h, w), dtype=np.uint8)
            raw2[120:260, 82:134] = 255
            vis_hidden = raw2.copy()
            vis_hidden[sign_mask > 0] = 0
            frames_hidden.append(
                capture_semantic_frame_evidence(
                    frame_idx=idx, t=idx / 30.0, shot_id="shot_08_hide", canvas_size=(w, h),
                    beauty_rgb=bg, actor_visible_masks={"zombie": vis_hidden}, actor_raw_masks={"zombie": raw2},
                    occluder_masks={"fg_open_sign": sign_mask}, actor_poses={"zombie": {"world_xy": [-10, 0]}},
                )
            )

        qc_fail, _ = evaluate_semantic_qc(compiled, frames_partial, video_sha256="1" * 64, source_fingerprint="2" * 64, evidence_sha256="3" * 64)
        self.assertEqual(qc_fail["status"], "fail")
        self.assertIn("SEMANTIC_HIDE_OCCLUSION_INSUFFICIENT", qc_fail["reason_codes"])

        qc_pass, _ = evaluate_semantic_qc(compiled, frames_hidden, video_sha256="1" * 64, source_fingerprint="2" * 64, evidence_sha256="3" * 64)
        self.assertEqual(qc_pass["status"], "pass")
        self.assertTrue(qc_pass["pass"])

    def test_atomic_writer_binds_report_sha_accurately(self) -> None:
        c, r, _ = self._build_detach_reattach_sequence()
        qc, rep = evaluate_semantic_qc(c, r, video_sha256="b" * 64, source_fingerprint="a" * 64, evidence_sha256="c" * 64)
        with tempfile.TemporaryDirectory() as tmp:
            qc_p, rep_p = write_semantic_qc_atomic(tmp, qc, rep)
            qc_loaded = json.loads(Path(qc_p).read_text(encoding="utf-8"))
            self.assertEqual(qc_loaded["status"], "pass")
            self.assertTrue(qc_loaded["semantic_report_sha256"])
            self.assertTrue(Path(rep_p).is_file())


if __name__ == "__main__":
    unittest.main()
