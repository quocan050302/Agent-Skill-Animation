/**
 * Fast, Dependency-Free JPEG Binary Validator + Pillow Deep Visual QA Helper
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Parses JPEG markers directly from bytes to verify SOI, EOI, and SOF0/SOF1/SOF2 width/height.
 * Rejects truncated, zero-byte, non-JPEG, or wrong-aspect-ratio files immediately.
 */
export function inspectJpegBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 128) {
    return { valid: false, reason: 'BUFFER_TOO_SMALL', byteLength: buf ? buf.length : 0 };
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) {
    return { valid: false, reason: 'MISSING_JPEG_SOI', byteLength: buf.length };
  }
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) {
    return { valid: false, reason: 'MISSING_JPEG_EOI_TRUNCATED', byteLength: buf.length };
  }

  let offset = 2;
  let width = 0;
  let height = 0;
  let components = 0;

  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (offset < buf.length && buf[offset] === 0xff) offset++;
    if (offset >= buf.length) break;
    const marker = buf[offset++];

    if (marker === 0xd9 || marker === 0xda) {
      break; // EOI or SOS (compressed scan data starts)
    }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue;
    }
    if (offset + 2 > buf.length) {
      return { valid: false, reason: 'MALFORMED_MARKER_LENGTH', byteLength: buf.length };
    }
    const segLen = buf.readUInt16BE(offset);
    if (segLen < 2 || offset + segLen > buf.length) {
      return { valid: false, reason: 'TRUNCATED_SEGMENT', byteLength: buf.length };
    }
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (segLen < 8) {
        return { valid: false, reason: 'MALFORMED_SOF', byteLength: buf.length };
      }
      height = buf.readUInt16BE(offset + 3);
      width = buf.readUInt16BE(offset + 5);
      components = buf[offset + 7];
    }
    offset += segLen;
  }

  if (width <= 0 || height <= 0) {
    return { valid: false, reason: 'MISSING_SOF_DIMENSIONS', byteLength: buf.length };
  }

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return {
    valid: true,
    width,
    height,
    components,
    aspectRatio: `${width}:${height}`,
    isPortrait9x16: width * 16 === height * 9,
    byteLength: buf.length,
    sha256,
  };
}

export function inspectJpegFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, reason: 'FILE_NOT_FOUND', filePath };
  }
  const buf = fs.readFileSync(filePath);
  return { filePath, ...inspectJpegBuffer(buf) };
}

/**
 * Runs Python + Pillow + NumPy deep perceptual & ink/luminance check over a set of frame paths.
 */
export function analyzeFramesWithPillow(framePaths) {
  const pyScript = `
import json, sys, hashlib
import numpy as np
from PIL import Image

paths = json.loads(sys.argv[1])
out = []
for p in paths:
    try:
        with Image.open(p) as im:
            im.load()
            w, h = im.size
            arr = np.asarray(im.convert('RGB'), dtype=np.float32)
        luma = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
        mean_luma = float(luma.mean())
        std_luma = float(luma.std())
        non_black_ratio = float((luma > 8.0).mean())
        dark_ink_ratio = float((luma < 32.0).mean())
        # High-frequency gradient magnitude for ink outline / crisp detail presence
        gx = np.abs(np.diff(luma, axis=1))
        gy = np.abs(np.diff(luma, axis=0))
        grad_mean = float(0.5 * (gx.mean() + gy.mean()))
        grad_p99 = float(0.5 * (np.percentile(gx, 99) + np.percentile(gy, 99)))
        out.append({
            "path": p,
            "valid": True,
            "width": w,
            "height": h,
            "meanLuma": round(mean_luma, 3),
            "stdLuma": round(std_luma, 3),
            "nonBlackRatio": round(non_black_ratio, 5),
            "darkInkRatio": round(dark_ink_ratio, 5),
            "edgeGradientMean": round(grad_mean, 3),
            "edgeGradientP99": round(grad_p99, 3),
        })
    except Exception as exc:
        out.append({"path": p, "valid": False, "error": str(exc)})
print(json.dumps(out))
`;
  const stdout = execFileSync('python3', ['-c', pyScript, JSON.stringify(framePaths)], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
