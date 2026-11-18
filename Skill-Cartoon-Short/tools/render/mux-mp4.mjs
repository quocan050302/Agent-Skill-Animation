#!/usr/bin/env node
/**
 * Validated FFmpeg MP4 Muxer & FFprobe Technical Verifier (SHORT-01 Section 9.4)
 * Classification: NEW IMPLEMENTATION CODE
 *
 * Enforces:
 * - H.264 (libx264), yuv420p, 1080x1920 (9:16), 30 FPS
 * - AAC stereo 48 kHz audio
 * - MP4 container with +faststart (verified by checking moov atom precedes mdat atom!)
 * - Post-encode FFprobe stream/container inspection + EBU R128 loudness + blackdetect/freezedetect QA
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFreeDiskMb, PROJECT_ROOT, sha256File } from '../setup/hydrate.mjs';

function verifyFastStartMoovBeforeMdat(mp4Path) {
  const fd = fs.openSync(mp4Path, 'r');
  try {
    const stat = fs.fstatSync(fd);
    let pos = 0;
    let moovOffset = -1;
    let mdatOffset = -1;
    const header = Buffer.alloc(16);
    while (pos + 8 <= stat.size) {
      const readBytes = fs.readSync(fd, header, 0, Math.min(16, stat.size - pos), pos);
      if (readBytes < 8) break;
      let boxSize = header.readUInt32BE(0);
      const boxType = header.subarray(4, 8).toString('ascii');
      if (boxType === 'moov' && moovOffset < 0) moovOffset = pos;
      if (boxType === 'mdat' && mdatOffset < 0) mdatOffset = pos;
      if (boxSize === 1) {
        if (readBytes < 16) break;
        boxSize = Number(header.readBigUInt64BE(8));
      } else if (boxSize === 0) {
        break;
      }
      if (boxSize < 8) break;
      pos += boxSize;
    }
    return {
      moovOffset,
      mdatOffset,
      fastStartVerified: moovOffset >= 0 && mdatOffset >= 0 && moovOffset < mdatOffset,
    };
  } finally {
    fs.closeSync(fd);
  }
}

export function probeMp4(mp4Path) {
  if (!fs.existsSync(mp4Path)) {
    throw new Error(`MP4_NOT_FOUND: ${mp4Path}`);
  }
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', mp4Path],
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(raw);
  const videoStream = (parsed.streams || []).find((s) => s.codec_type === 'video');
  const audioStream = (parsed.streams || []).find((s) => s.codec_type === 'audio');
  const fastStart = verifyFastStartMoovBeforeMdat(mp4Path);

  // Measure blackdetect / freezedetect / ebur128
  let qaStderr = '';
  try {
    execFileSync(
      'ffmpeg',
      [
        '-nostats',
        '-i',
        mp4Path,
        '-vf',
        'freezedetect=n=0.0005:d=0.6,blackdetect=d=0.05',
        '-af',
        'ebur128=peak=true',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    qaStderr = String(err.stderr || '');
  }
  if (!qaStderr) {
    // execFileSync succeeded: capture stderr via spawnSync style
    const res = execFileSync(
      'python3',
      [
        '-c',
        `import subprocess, sys; p=subprocess.run(["ffmpeg","-nostats","-i",sys.argv[1],"-vf","freezedetect=n=0.0005:d=0.6,blackdetect=d=0.05","-af","ebur128=peak=true","-f","null","-"], capture_output=True, text=True); print(p.stderr)`,
        mp4Path,
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    qaStderr = res;
  }

  const blackEvents = [...qaStderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
  }));
  const freezeEvents = [...qaStderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const iMatches = [...qaStderr.matchAll(/I:\s*([-\d.]+)\s*LUFS/g)];
  const tpMatches = [...qaStderr.matchAll(/Peak:\s*([-\d.]+)\s*dBFS/g)];

  const checks = {
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(audioStream),
    codecVideoH264: videoStream?.codec_name === 'h264',
    codecAudioAac: audioStream?.codec_name === 'aac',
    width1080: Number(videoStream?.width) === 1080,
    height1920: Number(videoStream?.height) === 1920,
    pixFmtYuv420p: videoStream?.pix_fmt === 'yuv420p',
    fps30: videoStream?.r_frame_rate === '30/1' || videoStream?.avg_frame_rate === '30/1',
    fastStart: fastStart.fastStartVerified,
    noBlackSpans: blackEvents.length === 0,
  };

  const allPassed = Object.values(checks).every(Boolean);
  return {
    valid: allPassed,
    checks,
    sha256: sha256File(mp4Path),
    byteSize: fs.statSync(mp4Path).size,
    durationSec: Number(parsed.format?.duration || 0),
    formatName: parsed.format?.format_name,
    video: {
      codec: videoStream?.codec_name,
      profile: videoStream?.profile,
      width: Number(videoStream?.width || 0),
      height: Number(videoStream?.height || 0),
      pixFmt: videoStream?.pix_fmt,
      rFrameRate: videoStream?.r_frame_rate,
      nbFrames: Number(videoStream?.nb_frames || 0),
    },
    audio: audioStream
      ? {
          codec: audioStream.codec_name,
          sampleRate: Number(audioStream.sample_rate || 0),
          channels: Number(audioStream.channels || 0),
          integratedLufs: iMatches.length ? Number(iMatches[iMatches.length - 1][1]) : null,
          truePeakDbfs: tpMatches.length ? Number(tpMatches[tpMatches.length - 1][1]) : null,
        }
      : null,
    fastStart,
    blackEvents,
    freezeEvents,
  };
}

export function muxFramesAndAudio({ framesDir, audioWavPath, outputMp4Path, expectedFrameCount, preset = 'medium', crf = 18 }) {
  checkFreeDiskMb(PROJECT_ROOT, 512);
  if (!fs.existsSync(framesDir)) {
    throw new Error(`FRAMES_DIR_NOT_FOUND: ${framesDir}`);
  }
  if (!fs.existsSync(audioWavPath)) {
    throw new Error(`AUDIO_WAV_NOT_FOUND: ${audioWavPath}`);
  }

  if (expectedFrameCount !== undefined) {
    for (let f = 0; f < expectedFrameCount; f++) {
      const fp = path.join(framesDir, `f${String(f).padStart(4, '0')}.jpg`);
      if (!fs.existsSync(fp)) {
        throw new Error(`MISSING_SEQUENCE_FRAME: Expected ${fp} (0..${expectedFrameCount - 1})`);
      }
    }
  }

  const outAbs = path.resolve(outputMp4Path);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const tmpMp4 = `${outAbs}.${process.pid}.${Date.now()}.tmp.mp4`;

  try {
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-framerate',
        '30',
        '-i',
        path.join(framesDir, 'f%04d.jpg'),
        '-i',
        audioWavPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'libx264',
        '-preset',
        preset,
        '-crf',
        String(crf),
        '-pix_fmt',
        'yuv420p',
        '-r',
        '30',
        '-c:a',
        'aac',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-b:a',
        '192k',
        '-shortest',
        '-movflags',
        '+faststart',
        tmpMp4,
      ],
      { stdio: 'pipe' }
    );
    fs.renameSync(tmpMp4, outAbs);
  } finally {
    if (fs.existsSync(tmpMp4)) fs.rmSync(tmpMp4, { force: true });
  }

  const probe = probeMp4(outAbs);
  if (!probe.valid) {
    throw new Error(`MP4_VERIFICATION_FAILED for ${outAbs}: ${JSON.stringify(probe.checks)}`);
  }
  return probe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [framesDir, audioWavPath, outputMp4Path, expectedCount] = process.argv.slice(2);
  if (!framesDir || !audioWavPath || !outputMp4Path) {
    console.error('Usage: node tools/render/mux-mp4.mjs <framesDir> <audioWav> <outputMp4> [expectedFrameCount]');
    process.exit(2);
  }
  const res = muxFramesAndAudio({
    framesDir,
    audioWavPath,
    outputMp4Path,
    expectedFrameCount: expectedCount ? Number(expectedCount) : undefined,
  });
  console.log(JSON.stringify(res, null, 2));
}
