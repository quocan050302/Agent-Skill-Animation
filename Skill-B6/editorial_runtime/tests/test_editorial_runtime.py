"""Unit, determinism, and adversarial negative-fixture tests for Skill-B6/editorial_runtime."""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np

RUNTIME_PARENT = str(Path(__file__).resolve().parents[2])
if RUNTIME_PARENT not in sys.path:
    sys.path.insert(0, RUNTIME_PARENT)

from editorial_runtime import (  # noqa: E402
    EDITORIAL_QC_SCHEMA,
    EDITORIAL_SCHEMA_VERSION,
    analyze_shot_variety,
    auto_propose_editorial_plan,
    compile_editorial_timeline,
    compute_frame_activity,
    detect_semantic_lulls,
    detect_visual_gaming,
    editorial_state_at,
    evaluate_editorial_qc,
    resolve_editorial_camera,
)


@dataclass(frozen=True)
class _DummyCam:
    width: int = 720
    height: int = 1280
    focal: float = 1040.0
    x: float = 0.0
    y: float = -210.0
    z: float = 180.0
    principal_y: float = 560.0
    near: float = 60.0

    def project(self, world):
        wx, wy, wz = world
        depth = wz - self.z
        sc = self.focal / depth
        return (self.width / 2.0 + (wx - self.x) * sc, self.principal_y + (wy - self.y) * sc, depth)


def _sample_editorial_plan() -> dict:
    return {
        "editorialMode": "editorial_v1",
        "duration": 6.0,
        "fps": 30,
        "shots": [
            {
                "id": "s1_hook",
                "start": 0.0,
                "end": 0.7,
                "short_cut_reason": "Hook sudden growl under 0.9s",
                "actor": "zombie",
                "editorial": {
                    "role": "hook",
                    "shotSize": "extreme_close",
                    "focus": {"targetKind": "actor_eyes", "actorId": "zombie"},
                    "cameraMovement": "push",
                    "transition": {"kind": "hard_cut", "reason": "Hook slam"},
                    "intensity": "high",
                    "actionOnsetS": 0.15,
                    "reactionHoldS": 0.25,
                },
            },
            {
                "id": "s2_wide",
                "start": 0.7,
                "end": 2.4,
                "actor": "human",
                "editorial": {
                    "role": "reveal",
                    "shotSize": "wide",
                    "focus": {"targetKind": "actor_full", "actorId": "human"},
                    "cameraMovement": "hold",
                    "transition": {"kind": "hard_cut", "reason": "Reveal wide contrast"},
                    "intensity": "low",
                },
            },
            {
                "id": "s3_insert",
                "start": 2.4,
                "end": 3.8,
                "actor": "human",
                "props": ["mirror"],
                "editorial": {
                    "role": "prop_insert",
                    "shotSize": "insert",
                    "focus": {"targetKind": "prop", "propId": "mirror"},
                    "cameraMovement": "follow_prop",
                    "transition": {"kind": "match_action_cut", "reason": "Cut on mirror raise", "matchAction": True},
                    "intensity": "normal",
                },
            },
            {
                "id": "s4_chase",
                "start": 3.8,
                "end": 6.0,
                "actor": "zombie",
                "editorial": {
                    "role": "chase",
                    "shotSize": "medium",
                    "focus": {"targetKind": "actor_full", "actorId": "zombie"},
                    "cameraMovement": "track",
                    "transition": {"kind": "hard_cut", "reason": "Chase sprint"},
                    "intensity": "high",
                },
            },
        ],
    }


def _make_clean_motion_frames(n: int = 60, h: int = 160, w: int = 90, step_px: float = 2.0) -> list[np.ndarray]:
    """Static layered dark street background + a crisp rectangle moving horizontally across frames."""
    frames: list[np.ndarray] = []
    bg = np.zeros((h, w, 3), dtype=np.uint8)
    bg[:, :, 0] = 28
    bg[:, :, 1] = 34
    bg[:, :, 2] = 48
    # Static street stripes for texture
    bg[120:, :, :] = (45, 50, 62)
    bg[20:50, 12:30, :] = (70, 95, 130)
    for i in range(n):
        fr = bg.copy()
        cx = int(round(14 + (i * step_px) % (w - 28)))
        fr[58:118, cx : cx + 18, :] = (165, 220, 145)
        fr[64:76, cx + 4 : cx + 14, :] = (240, 245, 240)
        frames.append(fr)
    return frames


class EditorialRuntimeTests(unittest.TestCase):
    def test_compile_rejects_gaps_overlaps_bad_focus_and_micro_cuts(self) -> None:
        bad = _sample_editorial_plan()
        bad["shots"][1]["start"] = 0.85  # gap from 0.70
        bad["shots"][2]["editorial"]["focus"] = {"targetKind": "actor_eyes", "actorId": "ghost_actor"}
        bad["shots"][0]["end"] = 0.05  # < 3 frames micro-cut
        del bad["shots"][0]["short_cut_reason"]
        bad["shots"][0]["editorial"]["transition"]["reason"] = ""
        compiled = compile_editorial_timeline(bad, duration=6.0, fps=30, known_actors=["zombie", "human"], known_props=["mirror"])
        self.assertFalse(compiled.valid)
        joined = " | ".join(compiled.errors)
        self.assertIn("TIMELINE_GAP_OR_OVERLAP", joined)
        self.assertIn("UNMOTIVATED_MICRO_CUT", joined)
        self.assertIn("FOCUS_ACTOR_UNKNOWN", joined)

    def test_determinism_random_seek_and_distinct_framing(self) -> None:
        compiled = compile_editorial_timeline(_sample_editorial_plan(), duration=6.0, fps=30)
        self.assertTrue(compiled.valid, compiled.errors)
        sem = {
            "actor_z": 860.0,
            "actor_vel_xy": (180.0, 0.0),
            "targets": {
                "actor_eyes:zombie": (100.0, -275.0, 860.0),
                "actor_full:human": (360.0, -165.0, 860.0),
                "prop:mirror": (320.0, -180.0, 845.0),
                "actor_full:zombie": (240.0, -165.0, 860.0),
            },
        }
        seq = {f: editorial_state_at(compiled, f / 30.0, sem) for f in range(180)}
        # Reverse & random seek order must produce exact bit-for-bit identical dicts
        for f in [179, 0, 114, 21, 72, 21, 0, 179]:
            got = editorial_state_at(compiled, f / 30.0, sem)
            self.assertEqual(got, seq[f])

        # Verify distinct shot scale & safe framing above caption band (864..951 on 1280H)
        cam_hook = resolve_editorial_camera(compiled, 0.30, _DummyCam(), sem)
        cam_wide = resolve_editorial_camera(compiled, 1.50, _DummyCam(), sem)
        cam_ins = resolve_editorial_camera(compiled, 3.00, _DummyCam(), sem)
        sc_hook = cam_hook.focal / (860.0 - cam_hook.z)
        sc_wide = cam_wide.focal / (860.0 - cam_wide.z)
        sc_ins = cam_ins.focal / (845.0 - cam_ins.z)
        self.assertGreater(sc_hook, sc_wide * 2.1)
        self.assertGreater(sc_ins, sc_wide * 1.9)

        _, hook_eye_y, _ = cam_hook.project(sem["targets"]["actor_eyes:zombie"])
        _, mirror_y, _ = cam_ins.project(sem["targets"]["prop:mirror"])
        self.assertLess(hook_eye_y, 820.0)
        self.assertLess(mirror_y, 820.0)

    def test_negative_gaming_fixtures_all_flagged_and_fail_qc(self) -> None:
        # 1. Random RGB noise every frame -> high MAD, low coherence
        rng = np.random.default_rng(42)
        noise_frames = [rng.integers(0, 256, size=(160, 90, 3), dtype=np.uint8) for _ in range(45)]
        act_noise = compute_frame_activity(noise_frames, fps=30.0)
        g_noise = detect_visual_gaming(act_noise)
        self.assertTrue(g_noise["gaming_detected"])
        self.assertTrue(g_noise["high_pixel_low_semantics"])
        self.assertIn("RANDOM_NOISE_HIGH_MAD_LOW_COHERENCE", g_noise["flags"])

        # 2. Strobe white/black alternating flicker
        strobe_frames = [np.full((160, 90, 3), 245 if i % 2 == 0 else 10, dtype=np.uint8) for i in range(45)]
        act_strobe = compute_frame_activity(strobe_frames, fps=30.0)
        g_strobe = detect_visual_gaming(act_strobe)
        self.assertTrue(g_strobe["gaming_detected"])
        self.assertIn("STROBE_FLICKER_DETECTED", g_strobe["flags"])

        # 3. Sinusoidal camera jitter on static scene (oscillating shift every frame)
        base = np.zeros((160, 90, 3), dtype=np.uint8)
        for y in range(10, 150, 12):
            base[y : y + 4, 15:75, :] = (200, 180, 140)
        jitter_frames = []
        for i in range(45):
            dx = int(round(8.0 * math.sin(i * 1.9)))
            jitter_frames.append(np.roll(base, shift=dx, axis=1))
        act_jit = compute_frame_activity(jitter_frames, fps=30.0)
        g_jit = detect_visual_gaming(act_jit)
        self.assertTrue(g_jit["gaming_detected"], g_jit)

        # 4. 1% zoom duplicate shots mislabeled as closeup vs wide
        y_base = np.mean(base.astype(np.float32), axis=2)
        shot_mids = [
            {"shot_id": "s_wide", "luma": y_base},
            {"shot_id": "s_fake_close", "luma": y_base.copy()},
        ]
        compiled = compile_editorial_timeline(
            {
                "duration": 2.0,
                "fps": 30,
                "shots": [
                    {"id": "s_wide", "start": 0.0, "end": 1.0, "editorial": {"shotSize": "wide"}},
                    {"id": "s_fake_close", "start": 1.0, "end": 2.0, "editorial": {"shotSize": "close"}},
                ],
            }
        )
        ev = [{"shot_id": "s_wide", "actual_scale": 1.0}, {"shot_id": "s_fake_close", "actual_scale": 1.01}]
        var = analyze_shot_variety(shot_mids, compiled_plan=compiled, scene_evidence=ev)
        self.assertGreater(var["too_similar_pairs"], 0)
        self.assertTrue(len(var["scale_mismatches"]) > 0)

        # 5. Oscillating zoom on static actor (no foreground relative action)
        zoom_frames = []
        for i in range(45):
            zf = 1.0 + 0.12 * math.sin(i * 0.7)
            nh, nw = int(round(160 * zf)), int(round(90 * zf))
            from PIL import Image
            im = Image.fromarray(base).resize((nw, nh), Image.Resampling.BILINEAR)
            arr = np.asarray(im)
            if nw >= 90 and nh >= 160:
                y0, x0 = (nh - 160) // 2, (nw - 90) // 2
                crop = arr[y0 : y0 + 160, x0 : x0 + 90]
            else:
                crop = np.zeros((160, 90, 3), dtype=np.uint8)
                y0, x0 = (160 - nh) // 2, (90 - nw) // 2
                crop[y0 : y0 + nh, x0 : x0 + nw] = arr
            zoom_frames.append(crop)
        act_zoom = compute_frame_activity(zoom_frames, fps=30.0)
        g_zoom = detect_visual_gaming(act_zoom)
        self.assertTrue(g_zoom["gaming_detected"], g_zoom)

        # 6. Jump-cut spam with identical story action (cut every 0.3s alternating 2 static colors)
        cut_spam_frames = []
        for i in range(45):
            block = (i // 9) % 2
            fr = base.copy()
            fr[:, :, 0] = 40 if block == 0 else 210
            cut_spam_frames.append(fr)
        act_spam = compute_frame_activity(cut_spam_frames, fps=30.0, boundaries=[0.3, 0.6, 0.9, 1.2])
        g_spam = detect_visual_gaming(act_spam)
        self.assertTrue(g_spam["gaming_detected"], g_spam)
        self.assertIn("HIGH_MAD_FROM_JUMP_CUT_SPAM", g_spam["flags"])

    def test_intentional_reaction_hold_allowed_and_real_motion_clean(self) -> None:
        moving = _make_clean_motion_frames(n=45, step_px=2.2)
        # Append 12 frames (0.40s) of intentional reaction hold
        hold = [moving[-1].copy() for _ in range(12)]
        frames = moving + hold
        act = compute_frame_activity(frames, fps=30.0)
        g = detect_visual_gaming(act)
        self.assertFalse(g["gaming_detected"], g)
        lulls = detect_semantic_lulls(
            act,
            beat_plan=[{"start": 1.4, "end": 1.9, "role": "reaction", "reaction_hold_s": 0.40}],
        )
        self.assertFalse(lulls["has_unjustified_lulls"], lulls)
        self.assertGreaterEqual(len(lulls["intentional_holds"]), 1)

    def test_editorial_qc_fails_closed_on_missing_or_corrupt_report_and_gaming(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            fake_vid = Path(td) / "dummy.mp4"
            fake_vid.write_bytes(b"fake")
            bad_rep = {
                "schema": "b6-editorial-report/1",
                "video_path": str(fake_vid),
                "video_sha256": "0" * 64,
                "ffprobe": {"width": 720, "height": 1280, "fps": 30.0, "duration": 10.0, "nb_frames": 300},
                "summary": {"frame_count": 300},
                "per_second": [{"second": s} for s in range(5)],  # missing last 5 seconds!
                "gaming": {"gaming_detected": True, "high_pixel_low_semantics": True, "flags": ["STROBE_FLICKER_DETECTED"]},
                "audio_pacing": {"has_audio": False},
            }
            qc = evaluate_editorial_qc(bad_rep, expected_video_path=fake_vid, expected_ratio="9:16")
            self.assertEqual(qc["schema"], EDITORIAL_QC_SCHEMA)
            self.assertFalse(qc["pass"])
            self.assertEqual(qc["status"], "fail")
            self.assertEqual(qc["audience_retention_estimate"], "unavailable")
            self.assertEqual(qc["human_visual_review"], "PENDING")
            errs = " | ".join(qc["errors"])
            self.assertIn("EDITORIAL_VIDEO_SHA256_MISMATCH", errs)
            self.assertIn("EDITORIAL_INCOMPLETE_PER_SECOND_COVERAGE", errs)
            self.assertIn("EDITORIAL_VISUAL_GAMING_DETECTED", errs)
            self.assertIn("EDITORIAL_AUDIO_MISSING", errs)

    def test_auto_propose_editorial_plan_is_deterministic_and_honest(self) -> None:
        sb = [
            {"id": "s1", "start": 0.0, "end": 0.65, "role": "hook", "actor": "zombie"},
            {"id": "s2", "start": 0.65, "end": 1.6, "role": "reaction", "actor": "human"},
            {"id": "s3", "start": 1.6, "end": 2.6, "role": "prop_insert", "actor": "human", "props": ["mirror"]},
            {"id": "s4", "start": 2.6, "end": 5.0, "role": "chase", "actor": "zombie"},
        ]
        p1 = auto_propose_editorial_plan(sb, target_duration=5.0)
        p2 = auto_propose_editorial_plan(sb, target_duration=5.0)
        self.assertEqual(p1, p2)
        self.assertEqual(p1["schema"], EDITORIAL_SCHEMA_VERSION)
        self.assertEqual(p1["audienceRetentionPrediction"], "unavailable")
        self.assertTrue(p1["requiresAuthorReview"])


if __name__ == "__main__":
    unittest.main()
