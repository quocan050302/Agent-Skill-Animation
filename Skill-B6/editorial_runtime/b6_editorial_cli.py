"""CLI runner for B6 Editorial Metrics & Editorial QC (`b6-editorial-report/1` + `b6-editorial-qc/1`)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

RUNTIME_PARENT = str(Path(__file__).resolve().parents[1])
if RUNTIME_PARENT not in sys.path:
    sys.path.insert(0, RUNTIME_PARENT)

from editorial_runtime.b6_editorial_contract import compile_editorial_timeline  # noqa: E402
from editorial_runtime.b6_editorial_metrics import (  # noqa: E402
    render_annotated_contact_sheet,
    render_editorial_chart_svg,
)
from editorial_runtime.b6_editorial_qc import run_editorial_qc_for_video  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze decoded MP4 editorial pacing and emit QC report.")
    parser.add_argument("--video", required=True, help="Path to MP4 video file")
    parser.add_argument("--out-dir", required=True, help="Directory to write editorial-report.json and editorial_qc.json")
    parser.add_argument("--scene-control", default=None, help="Optional path to scene-control.json")
    parser.add_argument("--report", default=None, help="Optional path to preview report.json for source_fingerprint")
    parser.add_argument("--evidence", default=None, help="Optional path to motion_evidence / editorial_evidence JSON")
    parser.add_argument("--ratio", default="9:16", choices=["9:16", "16:9"])
    parser.add_argument("--source-fingerprint", default=None)
    parser.add_argument("--contact-sheet", action="store_true", help="Also write annotated editorial-contact-sheet.jpg")
    parser.add_argument("--chart", action="store_true", help="Also write editorial-pacing-chart.svg")
    args = parser.parse_args(argv)

    compiled_plan = None
    shot_spans = None
    captions = None
    action_markers: list[dict[str, Any]] = []
    fp = args.source_fingerprint

    if args.report and Path(args.report).is_file():
        rep_doc = json.loads(Path(args.report).read_text(encoding="utf-8"))
        if not fp and isinstance(rep_doc.get("fingerprint"), str):
            fp = rep_doc["fingerprint"]

    if args.scene_control and Path(args.scene_control).is_file():
        sc_doc = json.loads(Path(args.scene_control).read_text(encoding="utf-8"))
        shot_spans = sc_doc.get("shots") or []
        captions = sc_doc.get("captions") or []
        if sc_doc.get("editorialMode") == "editorial_v1":
            compiled_plan = compile_editorial_timeline(sc_doc, strict=False)
            for s in compiled_plan.shots:
                if s.action_onset_s is not None:
                    action_markers.append({"id": s.shot_id, "t": s.action_onset_s, "label": s.role, "active": True})
        else:
            for sh in shot_spans:
                action_markers.append({"id": sh.get("id", "shot"), "t": float(sh.get("start", 0.0)) + 0.25, "label": sh.get("sfx", "action"), "active": True})

    scene_evidence = None
    if args.evidence and Path(args.evidence).is_file():
        ev_doc = json.loads(Path(args.evidence).read_text(encoding="utf-8"))
        scene_evidence = ev_doc.get("frames") if isinstance(ev_doc, dict) else ev_doc

    out_dir = Path(args.out_dir)
    report, qc = run_editorial_qc_for_video(
        args.video,
        out_dir,
        compiled_plan=compiled_plan,
        shot_spans=shot_spans,
        action_markers=action_markers,
        captions=captions,
        scene_evidence=scene_evidence,
        source_fingerprint=fp,
        expected_ratio=args.ratio,
    )

    if args.chart:
        render_editorial_chart_svg(report, out_dir / "editorial-pacing-chart.svg")
    if args.contact_sheet:
        render_annotated_contact_sheet(
            args.video,
            out_dir / "editorial-contact-sheet.jpg",
            shot_spans=shot_spans,
            extra_timestamps=[m["t"] for m in action_markers],
        )

    print(
        json.dumps(
            {
                "ok": True,
                "editorialReportPath": str(out_dir / "editorial-report.json"),
                "editorialQcPath": str(out_dir / "editorial_qc.json"),
                "qcStatus": qc["status"],
                "summary": report["summary"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
