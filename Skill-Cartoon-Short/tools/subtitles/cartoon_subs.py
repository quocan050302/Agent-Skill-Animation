#!/usr/bin/env python3
"""
Cartoon Short Styled Subtitle Engine (ASS + FFmpeg libass burn-in)
Classification: NEW IMPLEMENTATION CODE

Matches Skill-Cartoon-Short's visual identity:
- Display font: Arial Black (same family as roman.js / ww2-cast.js / paint-supermarket.js)
- Dark-plum comic ink outline: #241726 (&H00261724&) matching toon.ts INK
- Hard comic offset shadow + warm cream-white base (#FFFBF0)
- Discrete word-by-word golden highlight (#FFE055) and editorial punch-word accent (#FF6347)
- Snappy spring-overshoot pop-in animation (86% -> 105% -> 100%) on every new cue chunk
- Safe 9:16 Shorts placement (bottom-center MarginV=330, clear of UI chrome and character faces)
"""
import argparse
import json
import os
import re
import subprocess
import sys


def hex_to_ass_bgr(hex_col: str, alpha_hex: str = "00") -> str:
    h = hex_col.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"Expected 6-digit hex color, got {hex_col}")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha_hex.upper()}{b.upper()}{g.upper()}{r.upper()}&"


def fmt_ass_time(sec: float) -> str:
    sec = max(0.0, float(sec))
    cs = int(round(sec * 100))
    h = cs // 360000
    cs %= 360000
    m = cs // 6000
    cs %= 6000
    s = cs // 100
    c = cs % 100
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def syll_weight(word: str) -> int:
    w = re.sub(r"[^a-z0-9]", "", word.lower())
    if not w:
        return 1
    if w.isdigit():
        return max(2, len(w))
    v = re.findall(r"[aeiouy]+", w)
    n = len(v)
    if w.endswith("e") and n > 1 and not w.endswith("le"):
        n -= 1
    return max(1, n)


def escape_ass_text(text: str) -> str:
    return text.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")


def expand_chunk_word_timings(chunk: dict):
    """Computes exact per-word start/end inside a chunk (either explicit word timestamps or syllable-weighted)."""
    if "words" in chunk and isinstance(chunk["words"], list):
        return chunk["words"]

    lines = chunk.get("lines")
    if not lines:
        lines = [chunk["text"]]

    flat_tokens = []
    for li, line in enumerate(lines):
        toks = line.split()
        for ti, tok in enumerate(toks):
            flat_tokens.append({"text": tok, "line": li, "idxInLine": ti})

    s0 = float(chunk["s"])
    e0 = float(chunk["e"])
    dur = max(0.05, e0 - s0)
    weights = [syll_weight(t["text"]) for t in flat_tokens]
    total_w = max(1, sum(weights))

    cur = s0
    out = []
    for tok, w in zip(flat_tokens, weights):
        wd = dur * (w / total_w)
        out.append({**tok, "s": round(cur, 3), "e": round(cur + wd, 3)})
        cur += wd
    if out:
        out[-1]["e"] = round(e0, 3)
    return out


def build_ass_document(cues_spec: dict) -> str:
    width = int(cues_spec.get("width", 1080))
    height = int(cues_spec.get("height", 1920))
    font = cues_spec.get("font", "Arial Black")
    base_size = int(cues_spec.get("fontSize", 74))
    hero_size = int(cues_spec.get("heroFontSize", 90))
    margin_v = int(cues_spec.get("marginV", 330))

    col_base = hex_to_ass_bgr(cues_spec.get("baseColor", "#FFFBF0"))
    col_active = hex_to_ass_bgr(cues_spec.get("activeColor", "#FFE055"))
    col_punch = hex_to_ass_bgr(cues_spec.get("punchColor", "#FF6347"))
    col_ink = hex_to_ass_bgr(cues_spec.get("inkColor", "#241726"))
    col_shadow = hex_to_ass_bgr("#120A14", "50")

    header = f"""[Script Info]
Title: {cues_spec.get("title", "Cartoon Short Subtitles")}
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CartoonSub,{font},{base_size},{col_base},{col_active},{col_ink},{col_shadow},-1,0,0,0,100,100,1.5,0,1,13,6,2,54,54,{margin_v},1
Style: CartoonHero,{font},{hero_size},{col_base},{col_punch},{col_ink},{col_shadow},-1,0,0,0,100,100,2.0,0,1,15,7,2,48,48,{margin_v + 20},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    chunks = cues_spec.get("chunks", [])
    for chunk in chunks:
        words = expand_chunk_word_timings(chunk)
        if not words:
            continue
        style_name = "CartoonHero" if chunk.get("hero") else "CartoonSub"
        punch_set = {p.upper() for p in chunk.get("punchWords", [])}
        chunk_end = float(chunk.get("holdUntil", chunk["e"]))

        # Render discrete per-word active highlight slices while keeping layout 100% rock-steady
        for active_idx, active_w in enumerate(words):
            t_start = float(active_w["s"])
            if active_idx + 1 < len(words):
                t_end = float(words[active_idx + 1]["s"])
            else:
                t_end = max(float(active_w["e"]), chunk_end)
            if t_end <= t_start + 0.01:
                continue

            # Apply spring-overshoot pop ONLY on the first word slice of a new chunk
            if active_idx == 0:
                if chunk.get("hero"):
                    anim_prefix = r"{\fscx76\fscy76\t(0,90,\fscx109\fscy109)\t(90,175,\fscx100\fscy100)}"
                else:
                    anim_prefix = r"{\fscx86\fscy86\t(0,75,\fscx105\fscy105)\t(75,145,\fscx100\fscy100)}"
            else:
                anim_prefix = ""

            # Reconstruct lines preserving exact line breaks
            line_buckets = {}
            for wi, wobj in enumerate(words):
                li = int(wobj.get("line", 0))
                txt = escape_ass_text(wobj["text"].upper())
                norm = re.sub(r"[^A-Z0-9',-]", "", wobj["text"].upper())
                is_punch = norm in punch_set or wobj["text"].upper() in punch_set

                if wi == active_idx:
                    hl = col_punch if is_punch else col_active
                    piece = f"{{\\c{hl}}}{txt}{{\\c{col_base}}}"
                elif wi < active_idx and is_punch:
                    # Keep already-spoken punch words glowing in punch accent for visual impact
                    piece = f"{{\\c{col_punch}}}{txt}{{\\c{col_base}}}"
                else:
                    piece = txt

                line_buckets.setdefault(li, []).append(piece)

            rendered_lines = [" ".join(line_buckets[k]) for k in sorted(line_buckets.keys())]
            body = anim_prefix + r"\N".join(rendered_lines)
            events.append(
                f"Dialogue: 0,{fmt_ass_time(t_start)},{fmt_ass_time(t_end)},{style_name},,0,0,0,,{body}"
            )

    return header + "\n".join(events) + "\n"


def chunks_from_timing_words(words_json_path: str, max_words_per_chunk: int = 4) -> dict:
    """Fallback builder from generic tools/timing.py words.json."""
    with open(words_json_path, "r", encoding="utf-8") as fh:
        words = json.load(fh)
    chunks = []
    cur = []
    for w in words:
        cur.append(w)
        ends_sent = bool(re.search(r"[,.;:!?]$", str(w.get("w", ""))))
        if len(cur) >= max_words_per_chunk or ends_sent:
            chunks.append(
                {
                    "s": cur[0]["s"],
                    "e": cur[-1]["e"],
                    "words": [{"text": x["w"], "s": x["s"], "e": x["e"], "line": 0} for x in cur],
                }
            )
            cur = []
    if cur:
        chunks.append(
            {
                "s": cur[0]["s"],
                "e": cur[-1]["e"],
                "words": [{"text": x["w"], "s": x["s"], "e": x["e"], "line": 0} for x in cur],
            }
        )
    return {"title": "Auto Cartoon Subtitles", "chunks": chunks}


def burn_ass_onto_mp4(input_mp4: str, ass_path: str, output_mp4: str, crf: int = 17, preset: str = "medium"):
    abs_in = os.path.abspath(input_mp4)
    abs_ass = os.path.abspath(ass_path)
    abs_out = os.path.abspath(output_mp4)
    if not os.path.isfile(abs_in):
        raise FileNotFoundError(f"INPUT_MP4_NOT_FOUND: {abs_in}")
    if not os.path.isfile(abs_ass):
        raise FileNotFoundError(f"ASS_FILE_NOT_FOUND: {abs_ass}")

    os.makedirs(os.path.dirname(abs_out), exist_ok=True)
    tmp_out = f"{abs_out}.{os.getpid()}.tmp.mp4"

    # Escape colons/backslashes for FFmpeg libass filter filename syntax
    escaped_ass = abs_ass.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    vf = f"ass=filename='{escaped_ass}'"

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-i",
                abs_in,
                "-vf",
                vf,
                "-c:v",
                "libx264",
                "-preset",
                preset,
                "-crf",
                str(crf),
                "-pix_fmt",
                "yuv420p",
                "-r",
                "30",
                "-c:a",
                "copy",
                "-movflags",
                "+faststart",
                tmp_out,
            ],
            check=True,
        )
        os.replace(tmp_out, abs_out)
    finally:
        if os.path.exists(tmp_out):
            os.remove(tmp_out)
    return abs_out


def main():
    parser = argparse.ArgumentParser(description="Generate & burn Skill-Cartoon-Short styled subtitles")
    parser.add_argument("--cues", help="Curated subtitle cue JSON path")
    parser.add_argument("--words", help="Fallback timing.py words.json path")
    parser.add_argument("--ass-out", required=True, help="Output .ass file path")
    parser.add_argument("--input-mp4", default=None, help="Optional input MP4 to burn subtitles onto")
    parser.add_argument("--output-mp4", default=None, help="Optional output subtitled MP4 path")
    args = parser.parse_args()

    if args.cues:
        with open(args.cues, "r", encoding="utf-8") as fh:
            spec = json.load(fh)
    elif args.words:
        spec = chunks_from_timing_words(args.words)
    else:
        sys.stderr.write("ERROR: Pass either --cues <json> or --words <words.json>\n")
        sys.exit(2)

    ass_content = build_ass_document(spec)
    os.makedirs(os.path.dirname(os.path.abspath(args.ass_out)), exist_ok=True)
    with open(args.ass_out, "w", encoding="utf-8") as fh:
        fh.write(ass_content)

    result = {"assPath": os.path.abspath(args.ass_out), "chunkCount": len(spec.get("chunks", []))}
    if args.input_mp4 and args.output_mp4:
        result["outputMp4"] = burn_ass_onto_mp4(args.input_mp4, args.ass_out, args.output_mp4)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
