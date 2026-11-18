#!/usr/bin/env python3
"""
Contact Sheet Generator (SHORT-01 Section 10.1 & 11.1)
Classification: NEW IMPLEMENTATION CODE

Generates clean 270x480-per-tile 9:16 contact sheets (default 7 columns, matching the 1890x960
layout of example/soldier/stills.jpg) from an explicit list of frame paths or a frame directory.
"""
import argparse
import glob
import json
import os
import sys
from PIL import Image


def build_contact_sheet(frame_paths, out_path: str, cols: int = 7, tile_w: int = 270, tile_h: int = 480, quality: int = 90):
    if not frame_paths:
        raise ValueError("NO_FRAMES_FOR_CONTACT_SHEET")
    tiles = []
    for p in frame_paths:
        if not os.path.isfile(p):
            raise FileNotFoundError(f"MISSING_FRAME_FOR_SHEET: {p}")
        with Image.open(p) as im:
            im.load()
            w, h = im.size
            if w * 16 != h * 9:
                raise ValueError(f"INVALID_ASPECT_RATIO in {p}: {w}x{h} is not 9:16")
            tiles.append(im.convert("RGB").resize((tile_w, tile_h), Image.Resampling.LANCZOS))

    eff_cols = min(cols, len(tiles))
    rows = (len(tiles) + eff_cols - 1) // eff_cols
    sheet = Image.new("RGB", (tile_w * eff_cols, tile_h * rows), (0, 0, 0))
    for idx, tile in enumerate(tiles):
        x = (idx % eff_cols) * tile_w
        y = (idx // eff_cols) * tile_h
        sheet.paste(tile, (x, y))

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    tmp = f"{out_path}.{os.getpid()}.tmp.jpg"
    sheet.save(tmp, format="JPEG", quality=quality)
    os.replace(tmp, out_path)
    return {
        "outputPath": os.path.abspath(out_path),
        "tileCount": len(tiles),
        "cols": eff_cols,
        "rows": rows,
        "width": sheet.width,
        "height": sheet.height,
    }


def main():
    parser = argparse.ArgumentParser(description="Build 9:16 contact sheet")
    parser.add_argument("input", help="Directory containing f*.jpg or comma-separated frame paths")
    parser.add_argument("output", help="Output JPEG path")
    parser.add_argument("--cols", type=int, default=7)
    args = parser.parse_args()

    if os.path.isdir(args.input):
        paths = sorted(glob.glob(os.path.join(args.input, "f*.jpg")))
    else:
        paths = [p.strip() for p in args.input.split(",") if p.strip()]

    res = build_contact_sheet(paths, args.output, cols=args.cols)
    print(json.dumps(res))


if __name__ == "__main__":
    main()
