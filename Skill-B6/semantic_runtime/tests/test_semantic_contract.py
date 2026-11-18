"""Unit tests for b6_semantic_contract (reusable schemas, causality, and determinism)."""
from __future__ import annotations

from pathlib import Path
import sys
import unittest

RUNTIME_PARENT = str(Path(__file__).resolve().parents[2])
if RUNTIME_PARENT not in sys.path:
    sys.path.insert(0, RUNTIME_PARENT)

from semantic_runtime.b6_semantic_contract import (  # noqa: E402
    SEMANTIC_CONTRACT_SCHEMA,
    compile_semantic_action_plan,
    semantic_expected_state_at,
    validate_action_causality,
)


class SemanticContractTests(unittest.TestCase):
    def test_rejects_unknown_action_without_evidence_requirements(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            compile_semantic_action_plan(
                {
                    "duration": 4.0,
                    "shots": [
                        {
                            "id": "s1",
                            "start": 0.0,
                            "end": 2.0,
                            "actor": "hero",
                            "semanticActions": [
                                {"id": "a1", "actionType": "moonwalk_backflip_hyper", "actorId": "hero"}
                            ],
                        }
                    ],
                }
            )
        self.assertIn("SEMANTIC_UNKNOWN_ACTION_WITHOUT_CRITERIA", str(ctx.exception))

    def test_accepts_custom_action_when_explicit_evidence_criteria_supplied(self) -> None:
        compiled = compile_semantic_action_plan(
            {
                "duration": 3.0,
                "shots": [
                    {
                        "id": "s1",
                        "start": 0.0,
                        "end": 3.0,
                        "actor": "courier",
                        "semanticActions": [
                            {
                                "id": "custom_glide",
                                "actionType": "skateboard_glide",
                                "actorId": "courier",
                                "evidenceRequirements": {
                                    "requiresTrajectory": True,
                                    "minDisplacementPx": 40.0,
                                },
                            }
                        ],
                    }
                ],
            }
        )
        self.assertEqual(compiled["schema"], SEMANTIC_CONTRACT_SCHEMA)
        self.assertEqual(compiled["action_count"], 1)
        self.assertTrue(compiled["actions"][0]["evidence_requirements"]["requires_trajectory"])

    def test_causality_rejects_reattach_without_detach_or_hold_without_grab(self) -> None:
        # reattach without detach
        with self.assertRaises(ValueError) as ctx1:
            compile_semantic_action_plan(
                {
                    "duration": 4.0,
                    "semanticActions": [
                        {
                            "id": "bad_reattach",
                            "actionType": "reattach",
                            "actorId": "z",
                            "targetPropId": "z_head",
                            "startS": 1.0,
                            "endS": 2.0,
                        }
                    ],
                }
            )
        self.assertIn("SEMANTIC_CAUSALITY_BROKEN", str(ctx1.exception))

        # hold without grab/take
        res = validate_action_causality(
            [
                {
                    "id": "bad_hold",
                    "action_type": "hold",
                    "actor_id": "z",
                    "target_prop_id": "briefcase",
                    "start_s": 0.5,
                    "end_s": 1.5,
                    "evidence_requirements": {"requires_prop_visibility": True, "requires_contact": True},
                }
            ],
            duration_s=2.0,
        )
        self.assertFalse(res["valid"])
        self.assertTrue(any("SEMANTIC_CAUSALITY_BROKEN" in e for e in res["errors"]))

    def test_causality_rejects_prerequisite_later_than_dependent(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            compile_semantic_action_plan(
                {
                    "duration": 5.0,
                    "semanticActions": [
                        {"id": "step_b", "actionType": "walk", "actorId": "a", "startS": 0.5, "endS": 1.5, "prerequisiteIds": ["step_a"]},
                        {"id": "step_a", "actionType": "walk", "actorId": "a", "startS": 2.0, "endS": 3.0},
                    ],
                }
            )
        self.assertIn("SEMANTIC_CAUSALITY_BROKEN", str(ctx.exception))

    def test_valid_chain_and_deterministic_random_seek_expected_state(self) -> None:
        plan = {
            "duration": 6.0,
            "fps": 30,
            "semanticActions": [
                {"id": "act_detach", "actionType": "detach", "actorId": "z", "targetPropId": "z_head", "startS": 0.5, "endS": 1.2},
                {"id": "act_roll", "actionType": "roll", "actorId": "z", "targetPropId": "z_head", "startS": 1.2, "endS": 2.8, "prerequisiteIds": ["act_detach"]},
                {"id": "act_take", "actionType": "take", "actorId": "z", "targetPropId": "z_head", "startS": 2.8, "endS": 3.6, "prerequisiteIds": ["act_roll"]},
                {"id": "act_reattach", "actionType": "reattach", "actorId": "z", "targetPropId": "z_head", "expectedOrientation": "backwards", "startS": 3.6, "endS": 4.4, "prerequisiteIds": ["act_take"]},
            ],
        }
        compiled = compile_semantic_action_plan(plan, strict=True)
        self.assertTrue(compiled["causality"]["valid"])
        # Random seek parity test
        s_20_a = semantic_expected_state_at(compiled, 2.0)
        _ = semantic_expected_state_at(compiled, 4.1)
        _ = semantic_expected_state_at(compiled, 0.2)
        s_20_b = semantic_expected_state_at(compiled, 2.0)
        self.assertEqual(s_20_a, s_20_b)
        self.assertEqual(s_20_a["part_mount_states"]["z:head"], "detached")
        self.assertEqual(semantic_expected_state_at(compiled, 0.2)["part_mount_states"], {})
        self.assertEqual(semantic_expected_state_at(compiled, 5.0)["part_mount_states"]["z:head"], "attached")


if __name__ == "__main__":
    unittest.main()
