"""CLI runner for B6 Semantic Action Validation (`b6-semantic-report/1` + `b6-semantic-qc/1`)."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any
import cv2
import numpy as np
from PIL import Image

RUNTIME_PARENT = str(Path(__file__).resolve().parents[1])
if RUNTIME_PARENT not in sys.path:
    sys.path.insert(0, RUNTIME_PARENT)

from semantic_runtime.b6_semantic_contract import compile_semantic_action_plan  # noqa: E402
from semantic_runtime.b6_semantic_evidence import (  # noqa: E402
    load_semantic_evidence_jsonl,
    verify_decoded_frame_binding,
)
from semantic_runtime.b6_semantic_qc import (  # noqa: E402
    evaluate_semantic_qc,
    write_semantic_qc_atomic,
)


def _sha256_file(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def _decode_video_frames(video_path: Path) -> tuple[list[np.ndarray], float]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open MP4 video for semantic decoding: {video_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    frames: list[np.ndarray] = []
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            frames.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    finally:
        cap.release()
    return frames, fps


def _bbox_luma_std(rgb: np.ndarray, bbox: list[int] | None) -> float:
    if not bbox or len(bbox) != 4:
        return 0.0
    h, w = rgb.shape[:2]
    x0 = max(0, min(w - 1, int(bbox[0])))
    y0 = max(0, min(h - 1, int(bbox[1])))
    x1 = max(x0 + 1, min(w, int(bbox[2])))
    y1 = max(y0 + 1, min(h, int(bbox[3])))
    crop = rgb[y0:y1, x0:x1]
    if crop.size == 0:
        return 0.0
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY).astype(np.float32)
    return float(gray.std())


def _cross_verify_decoded_frames(
    decoded_frames: list[np.ndarray],
    evidence_rows: list[dict[str, Any]],
    out_dir: Path,
) -> list[dict[str, Any]]:
    """Verify semantic evidence against actual decoded MP4 frames and PNG keyframes."""
    results: list[dict[str, Any]] = []
    if not decoded_frames:
        return [{"binding_ok": False, "decoded_luma_std": 0.0, "reason": "no_decoded_frames"}]

    # Check matching frame-XXXX.png tiles when present in out_dir (tolerance handles libx264 CRF 18 compression)
    keyframe_paths = sorted(out_dir.glob("frame-*.png"))
    keyframe_by_idx: dict[int, Path] = {}
    for kp in keyframe_paths:
        stem = kp.stem.split("-")[-1]
        if stem.isdigit():
            keyframe_by_idx[int(stem)] = kp

    # Sample evenly across evidence rows + verify all keyframes
    n_ev = len(evidence_rows)
    if n_ev == 0:
        return [{"binding_ok": False, "decoded_luma_std": float(decoded_frames[0].std()), "reason": "no_evidence_rows"}]

    indices = sorted(set(list(range(0, n_ev, max(1, n_ev // 30))) + [n_ev - 1]))
    for idx in indices:
        rec = evidence_rows[idx]
        f_idx = int(rec.get("frame", idx))
        if f_idx < 0 or f_idx >= len(decoded_frames):
            results.append({"frame": f_idx, "binding_ok": False, "decoded_luma_std": 0.0, "reason": "frame_index_out_of_range"})
            continue

        dec_rgb = decoded_frames[f_idx]
        exp_rgb = None
        if f_idx in keyframe_by_idx:
            with Image.open(keyframe_by_idx[f_idx]) as im:
                exp_rgb = np.asarray(im.convert("RGB"))

        chk = verify_decoded_frame_binding(dec_rgb, exp_rgb, max_mad_tolerance=16.0)
        # Verify visible entities actually occupy textured decoded image content (not empty canvas)
        for aid, ainfo in (rec.get("actors") or {}).items():
            if ainfo.get("in_frame") and int(ainfo.get("visible_pixels", 0)) >= 64:
                bstd = _bbox_luma_std(dec_rgb, ainfo.get("bbox"))
                if bstd < 2.0:
                    chk["binding_ok"] = False
                    chk["reason"] = f"empty_decoded_actor_bbox:{aid}"
        for pid, pinfo in (rec.get("props") or {}).items():
            if pinfo.get("in_frame") and int(pinfo.get("visible_pixels", 0)) >= 48:
                bstd = _bbox_luma_std(dec_rgb, pinfo.get("bbox"))
                if bstd < 1.5:
                    chk["binding_ok"] = False
                    chk["reason"] = f"empty_decoded_prop_bbox:{pid}"
        results.append({"frame": f_idx, **chk})

    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate B6 semantic action evidence & emit semantic_qc.json.")
    parser.add_argument("--video", required=True, help="Path to rendered MP4")
    parser.add_argument("--out-dir", required=True, help="Directory containing/receiving semantic QC outputs")
    parser.add_argument("--scene-control", required=True, help="Path to scene-control.json")
    parser.add_argument("--evidence", default=None, help="Path to semantic-evidence.jsonl (defaults to <out-dir>/semantic-evidence.jsonl)")
    parser.add_argument("--report", default=None, help="Optional path to preview report.json for source_fingerprint")
    parser.add_argument("--source-fingerprint", default=None)
    parser.add_argument("--strict-exit", action="store_true", help="Exit 1 when semantic_qc.json status is fail")
    args = parser.parse_args(argv)

    video_path = Path(args.video)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    sc_path = Path(args.scene_control)
    ev_path = Path(args.evidence) if args.evidence else (out_dir / "semantic-evidence.jsonl")

    fp = args.source_fingerprint
    if args.report and Path(args.report).is_file() and not fp:
        rep_doc = json.loads(Path(args.report).read_text(encoding="utf-8"))
        if isinstance(rep_doc.get("fingerprint"), str):
            fp = rep_doc["fingerprint"]

    sc_doc = json.loads(sc_path.read_text(encoding="utf-8")) if sc_path.is_file() else {"shots": [], "semanticActions": []}
    compiled = compile_semantic_action_plan(sc_doc, strict=False)
    vid_sha = _sha256_file(video_path)

    ev_rows: list[dict[str, Any]] = []
    ev_sha: str | None = None
    load_error: str | None = None
    try:
        ev_rows, ev_sha = load_semantic_evidence_jsonl(ev_path)
    except Exception as exc:
        load_error = str(exc)

    decoded_frames, dec_fps = _decode_video_frames(video_path) if video_path.is_file() else ([], 30.0)
    dec_bindings = _cross_verify_decoded_frames(decoded_frames, ev_rows, out_dir)

    qc_doc, rep_doc = evaluate_semantic_qc(
        compiled,
        ev_rows,
        video_path=video_path,
        video_sha256=vid_sha,
        source_fingerprint=fp,
        evidence_sha256=ev_sha,
        decoded_binding_rows=dec_bindings,
    )
    if load_error:
        qc_doc["errors"] = [load_error, *qc_doc.get("errors", [])]
        qc_doc["reason_codes"] = sorted(set([*qc_doc.get("reason_codes", []), "SEMANTIC_EVIDENCE_MISSING"]))
        qc_doc["status"] = "fail"
        qc_doc["pass"] = False
        rep_doc["errors"] = list(qc_doc["errors"])
        rep_doc["reason_codes"] = list(qc_doc["reason_codes"])
        rep_doc["summary"]["status"] = "fail"
        rep_doc["summary"]["pass"] = False
    rep_doc["decoded_video_fps"] = round(dec_fps, 3)
    rep_doc["decoded_video_frames"] = len(decoded_frames)

    qc_path, rep_path = write_semantic_qc_atomic(out_dir, qc_doc, rep_doc)
    print(
        json.dumps(
            {
                "ok": True,
                "semanticReportPath": rep_path,
                "semanticQcPath": qc_path,
                "qcStatus": qc_doc["status"],
                "summary": rep_doc["summary"],
            },
            ensure_ascii=False,
        )
    )
    if args.strict_exit and qc_doc["status"] != "pass":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
