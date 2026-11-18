"""Unit tests for b6_semantic_evidence (masks, distanceTransform contacts, occlusion, decoded binding)."""
from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
from PIL import Image

RUNTIME_PARENT = str(Path(__file__).resolve().parents[2])
if RUNTIME_PARENT not in sys.path:
    sys.path.insert(0, RUNTIME_PARENT)

from semantic_runtime.b6_semantic_evidence import (  # noqa: E402
    capture_semantic_frame_evidence,
    load_semantic_evidence_jsonl,
    measure_contact,
    measure_occlusion,
    render_semantic_mask_overlay,
    render_triptych_diagnostic,
    verify_decoded_frame_binding,
    write_semantic_evidence_stream,
)


class SemanticEvidenceTests(unittest.TestCase):
    def test_contact_measurement_separates_touch_from_far_prop(self) -> None:
        h, w = 200, 200
        hand = np.zeros((h, w), dtype=np.uint8)
        hand[90:105, 60:75] = 255

        prop_near = np.zeros((h, w), dtype=np.uint8)
        prop_near[88:110, 77:100] = 255
        res_near = measure_contact([hand], prop_near)
        self.assertLessEqual(res_near["min_gap_px"], 3.0)
        self.assertTrue(res_near["touching"])

        prop_far = np.zeros((h, w), dtype=np.uint8)
        prop_far[88:110, 140:170] = 255
        res_far = measure_contact([hand], prop_far)
        self.assertGreater(res_far["min_gap_px"], 60.0)
        self.assertFalse(res_far["touching"])

    def test_occlusion_distinguishes_behind_sign_from_in_front_of_sign(self) -> None:
        h, w = 240, 240
        raw_actor = np.zeros((h, w), dtype=np.uint8)
        raw_actor[60:180, 90:150] = 255  # 120 * 60 = 7200 px

        occluder = np.zeros((h, w), dtype=np.uint8)
        occluder[40:200, 110:190] = 255  # overlaps columns 110..150 (40/60 = 0.667 of actor)

        # Case A: actor genuinely BEHIND occluder -> visible excludes occluder overlap
        vis_behind = raw_actor.copy()
        vis_behind[occluder > 0] = 0
        occ_behind = measure_occlusion(raw_actor, vis_behind, occluder)
        self.assertGreater(occ_behind["occlusion_ratio"], 0.6)
        self.assertEqual(occ_behind["visible_in_front_pixels"], 0)

        # Case B: actor drawn IN FRONT of occluder -> visible equals raw
        occ_front = measure_occlusion(raw_actor, raw_actor, occluder)
        self.assertEqual(occ_front["occlusion_ratio"], 0.0)
        self.assertGreater(occ_front["in_front_leak_ratio"], 0.6)

    def test_decoded_frame_binding_ignores_caption_strip_and_catches_tamper(self) -> None:
        h, w = 320, 180
        rng = np.random.default_rng(7)
        beauty = rng.integers(30, 210, size=(h, w, 3), dtype=np.uint8)
        decoded_with_caption = beauty.copy()
        # Burn white caption block strictly inside exclusion strip 0.67..0.74
        decoded_with_caption[int(h * 0.68):int(h * 0.73), 20:160] = 255
        res_ok = verify_decoded_frame_binding(decoded_with_caption, beauty, exclude_caption_band=True)
        self.assertTrue(res_ok["binding_ok"])
        self.assertLess(res_ok["mad_vs_beauty"], 1.0)

        # Tampered black decoded frame must fail
        blank = np.zeros((h, w, 3), dtype=np.uint8)
        res_bad = verify_decoded_frame_binding(blank, beauty)
        self.assertFalse(res_bad["binding_ok"])

    def test_streaming_jsonl_overlay_and_triptych_diagnostics(self) -> None:
        h, w = 160, 120
        beauty = np.full((h, w, 3), 80, dtype=np.uint8)
        beauty[40:90, 40:80] = (40, 190, 160)
        actor_mask = np.zeros((h, w), dtype=np.uint8)
        actor_mask[40:90, 40:80] = 255
        prop_mask = np.zeros((h, w), dtype=np.uint8)
        prop_mask[70:90, 75:95] = 255
        rec = capture_semantic_frame_evidence(
            frame_idx=0,
            t=0.0,
            shot_id="s1",
            canvas_size=(w, h),
            beauty_rgb=beauty,
            actor_visible_masks={"z": actor_mask},
            prop_visible_masks={"head_prop": prop_mask},
            actor_poses={"z": {"world_xy": [10.0, 0.0], "head_mount_state": "detached"}},
            prop_states={"head_prop": {"world_xy": [35.0, -40.0], "state": "free"}},
        )
        overlay = render_semantic_mask_overlay(beauty, actor_masks={"z": actor_mask}, prop_masks={"head_prop": prop_mask}, label="f0")
        triptych = render_triptych_diagnostic(overlay, overlay, overlay, title="Test Triptych")
        self.assertEqual(triptych.mode, "RGB")

        with tempfile.TemporaryDirectory() as tmp:
            jpath = Path(tmp) / "semantic-evidence.jsonl"
            meta = write_semantic_evidence_stream(jpath, [rec])
            rows, sha = load_semantic_evidence_jsonl(jpath)
            self.assertEqual(meta["frames"], 1)
            self.assertEqual(meta["sha256"], sha)
            self.assertEqual(rows[0]["actors"]["z"]["head_mount_state"], "detached")


if __name__ == "__main__":
    unittest.main()
