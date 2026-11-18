#!/usr/bin/env python3
"""
Timing Pipeline Validator & Controlled Runner (SHORT-01 Section 9.1)
Classification: NEW IMPLEMENTATION CODE

Wraps local hydrated vendor/cartoon-short-kit/tools/timing.py when present (preserving exact
duration(), speech_segments(), whisper_words(), and align() behavior) and enforces strict
post-alignment validation checks that original timing.py omits:
- Expected frame count = round(audio_duration_seconds * 30)
- Leading and trailing silence measurement
- Missing word detection against input script
- Zero-duration segment rejection
- Negative timestamp rejection
- Out-of-order timestamp rejection
- Timestamp beyond audio duration rejection
- Unaligned/dropped phrase detection (DP INF cost)
- Honest labeling of approximate silence-DP alignment vs exact Whisper ASR
"""
import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys


def load_kit_timing_module(project_root: str):
    kit_timing = os.path.join(project_root, "vendor", "cartoon-short-kit", "tools", "timing.py")
    if not os.path.isfile(kit_timing):
        raise FileNotFoundError(f"KIT_TIMING_MISSING: {kit_timing} not found. Run npm run setup first.")
    spec = importlib.util.spec_from_file_location("kit_timing", kit_timing)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def probe_audio_duration(audio_path: str) -> float:
    if not os.path.isfile(audio_path):
        raise ValueError(f"AUDIO_FILE_NOT_FOUND: {audio_path}")
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio_path],
        capture_output=True,
        text=True,
    )
    raw = (proc.stdout or "").strip()
    if proc.returncode != 0 or not raw:
        raise ValueError(f"INVALID_AUDIO_INPUT: ffprobe failed on {audio_path}: {proc.stderr.strip()}")
    dur = float(raw)
    if not (dur > 0.0):
        raise ValueError(f"ZERO_DURATION_AUDIO: {audio_path} reported duration={dur}")
    return dur


def normalize_tokens(text: str):
    return [t for t in re.sub(r"[^a-z0-9']+", " ", text.lower()).split() if t]


def validate_timing_manifest(words, phrases_doc, script_text=None, tolerance_sec=0.02):
    errors = []
    if not isinstance(phrases_doc, dict):
        return {"valid": False, "errors": ["PHRASES_DOC_NOT_OBJECT"]}

    dur = float(phrases_doc.get("duration", -1))
    frames30 = phrases_doc.get("frames30")
    segs = phrases_doc.get("segments", [])
    phrases = phrases_doc.get("phrases", [])
    source = str(phrases_doc.get("source", "unknown"))

    if dur <= 0:
        errors.append(f"INVALID_DURATION: {dur}")
    expected_frames = int(round(dur * 30)) if dur > 0 else 0
    if frames30 != expected_frames:
        errors.append(f"FRAME_COUNT_MISMATCH: got {frames30}, expected {expected_frames}")

    leading_silence = float(segs[0][0]) if segs else max(0.0, dur)
    trailing_silence = max(0.0, dur - float(segs[-1][1])) if segs else max(0.0, dur)

    prev_seg_end = 0.0
    for idx, seg in enumerate(segs):
        if not isinstance(seg, (list, tuple)) or len(seg) != 2:
            errors.append(f"MALFORMED_SEGMENT[{idx}]")
            continue
        s, e = float(seg[0]), float(seg[1])
        if s < 0 or e < 0:
            errors.append(f"NEGATIVE_SEGMENT_TIMESTAMP[{idx}]: {s}..{e}")
        if e <= s:
            errors.append(f"ZERO_OR_NEGATIVE_SEGMENT_DURATION[{idx}]: {s}..{e}")
        if s < prev_seg_end - 1e-4:
            errors.append(f"OUT_OF_ORDER_SEGMENT[{idx}]: {s} < {prev_seg_end}")
        if dur > 0 and e > dur + tolerance_sec:
            errors.append(f"SEGMENT_BEYOND_DURATION[{idx}]: {e} > {dur}")
        prev_seg_end = e

    if not isinstance(words, list) or len(words) == 0:
        errors.append("EMPTY_WORDS_LIST")
    else:
        prev_s = 0.0
        for idx, w in enumerate(words):
            s = float(w.get("s", -1))
            e = float(w.get("e", -1))
            tok = str(w.get("w", "")).strip()
            if not tok:
                errors.append(f"EMPTY_WORD_TOKEN[{idx}]")
            if s < 0 or e < 0:
                errors.append(f"NEGATIVE_WORD_TIMESTAMP[{idx}]: {s}..{e}")
            if e <= s:
                errors.append(f"ZERO_DURATION_WORD[{idx}] ({tok}): {s}..{e}")
            if idx > 0 and s < prev_s - 1e-3:
                errors.append(f"OUT_OF_ORDER_WORD[{idx}] ({tok}): {s} < {prev_s}")
            if dur > 0 and e > dur + tolerance_sec:
                errors.append(f"WORD_BEYOND_DURATION[{idx}] ({tok}): {e} > {dur}")
            prev_s = s

    if not isinstance(phrases, list) or len(phrases) == 0:
        errors.append("EMPTY_PHRASES_LIST")
    else:
        prev_ps = 0.0
        for idx, p in enumerate(phrases):
            ps = float(p.get("s", -1))
            pe = float(p.get("e", -1))
            txt = str(p.get("text", "")).strip()
            if not txt:
                errors.append(f"EMPTY_PHRASE_TEXT[{idx}]")
            if ps < 0 or pe < 0:
                errors.append(f"NEGATIVE_PHRASE_TIMESTAMP[{idx}]: {ps}..{pe}")
            if pe <= ps:
                errors.append(f"ZERO_DURATION_PHRASE[{idx}]: {ps}..{pe}")
            if idx > 0 and ps < prev_ps - 1e-3:
                errors.append(f"OUT_OF_ORDER_PHRASE[{idx}]: {ps} < {prev_ps}")
            if dur > 0 and pe > dur + tolerance_sec:
                errors.append(f"PHRASE_BEYOND_DURATION[{idx}]: {pe} > {dur}")
            # Verify phrase overlaps at least one detected speech segment
            if segs and not any(min(pe, float(sg[1])) - max(ps, float(sg[0])) > 1e-3 for sg in segs):
                errors.append(f"PHRASE_MISSING_SPEECH_SEGMENT[{idx}]: {ps}..{pe}")
            prev_ps = ps

    if script_text is not None:
        expected_tokens = normalize_tokens(script_text)
        actual_tokens = normalize_tokens(" ".join(str(w.get("w", "")) for w in (words or [])))
        if not expected_tokens:
            errors.append("EMPTY_SCRIPT_TEXT")
        elif actual_tokens != expected_tokens:
            missing_count = abs(len(expected_tokens) - len(actual_tokens))
            errors.append(
                f"SCRIPT_WORD_MISMATCH: expected {len(expected_tokens)} tokens, aligned {len(actual_tokens)} (delta={missing_count})"
            )
        raw_phrases = [
            p.strip()
            for p in re.findall(r"[^,.;:!?]+[,.;:!?\"”']*", script_text.replace("\n", " "))
            if p.strip()
        ]
        if len(raw_phrases) > 0 and len(phrases) == 0:
            errors.append("ALL_PHRASES_DROPPED")

    alignment_precision = "exact-whisper-asr" if source == "whisper" else "approximate-silence-dp"
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "duration": dur,
        "expectedFrames30": expected_frames,
        "leadingSilenceSec": round(leading_silence, 4),
        "trailingSilenceSec": round(trailing_silence, 4),
        "segmentCount": len(segs),
        "phraseCount": len(phrases) if isinstance(phrases, list) else 0,
        "wordCount": len(words) if isinstance(words, list) else 0,
        "source": source,
        "alignmentPrecision": alignment_precision,
    }


def run_timing_pipeline(project_root: str, audio_path: str, script_input: str | None, out_dir: str):
    dur = probe_audio_duration(audio_path)
    mod = load_kit_timing_module(project_root)

    script_text = None
    if script_input:
        if os.path.isfile(script_input):
            with open(script_input, "r", encoding="utf-8") as fh:
                script_text = fh.read()
        else:
            script_text = script_input
        if not script_text.strip():
            raise ValueError("EMPTY_SCRIPT_INPUT: Script text is empty.")

    words = mod.whisper_words(audio_path)
    segs, detected_dur = mod.speech_segments(audio_path)

    if words:
        phr = []
        cur = []
        for w in words:
            cur.append(w)
            if re.search(r"[,.;:!?]$", w["w"]):
                phr.append({"text": " ".join(x["w"] for x in cur), "s": cur[0]["s"], "e": cur[-1]["e"]})
                cur = []
        if cur:
            phr.append({"text": " ".join(x["w"] for x in cur), "s": cur[0]["s"], "e": cur[-1]["e"]})
        src = "whisper"
        script_for_check = None
    elif script_text:
        if not segs:
            raise ValueError("NO_SPEECH_SEGMENTS_DETECTED: Audio contains only silence.")
        words, phr, cost = mod.align(script_text, segs)
        if cost >= 1e8 or not words or not phr:
            raise ValueError(f"ALIGNMENT_DP_FAILED: Could not align {len(segs)} segments (cost={cost}).")
        src = f"silence-align (cost {cost:.2f})"
        script_for_check = script_text
    else:
        raise ValueError("MISSING_SCRIPT_AND_ASR: Neither Whisper ASR nor script text is available.")

    phrases_doc = {
        "duration": detected_dur,
        "frames30": int(round(detected_dur * 30)),
        "source": src,
        "alignmentPrecision": "exact-whisper-asr" if src == "whisper" else "approximate-silence-dp",
        "segments": segs,
        "phrases": phr,
    }

    validation = validate_timing_manifest(words, phrases_doc, script_text=script_for_check)
    if not validation["valid"]:
        raise ValueError(f"TIMING_VALIDATION_FAILED: {'; '.join(validation['errors'])}")

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "words.json"), "w", encoding="utf-8") as fh:
        json.dump(words, fh, indent=2)
    with open(os.path.join(out_dir, "phrases.json"), "w", encoding="utf-8") as fh:
        json.dump(phrases_doc, fh, indent=2)
    with open(os.path.join(out_dir, "timing-validation.json"), "w", encoding="utf-8") as fh:
        json.dump(validation, fh, indent=2)

    return {"words": words, "phrases": phrases_doc, "validation": validation, "probedDuration": dur}


def main():
    parser = argparse.ArgumentParser(description="Validated timing runner for Cartoon Short Renderer")
    parser.add_argument("audio", help="Input voiceover audio file")
    parser.add_argument("script", nargs="?", default=None, help="Optional script file or text")
    parser.add_argument("--out", default=".", help="Output directory for words.json and phrases.json")
    parser.add_argument(
        "--project-root",
        default=os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")),
        help="Skill-Cartoon-Short root",
    )
    args = parser.parse_args()
    try:
        res = run_timing_pipeline(args.project_root, args.audio, args.script, args.out)
        print(json.dumps(res["validation"], indent=2))
    except Exception as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        sys.exit(2)


if __name__ == "__main__":
    main()
