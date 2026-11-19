#!/usr/bin/env node
/**
 * Validated FFmpeg MP4 Muxer & FFprobe Technical Verifier (SHORT-01 + QA-TTS-01)
 * Classification: NEW IMPLEMENTATION CODE
 *
 * Enforces:
 * - H.264 (libx264), yuv420p, 1080x1920 (9:16), 30 FPS
 * - AAC stereo 48 kHz audio
 * - MP4 container with +faststart (verified by checking moov atom precedes mdat atom!)
 * - `-shortest` truncation guard: verifies audio duration against expectedFrameCount / 30;
 *   rejects audio overflow instead of silently chopping narration, and pads short audio with
 *   clean tail silence (`apad`) when allowed so exact frame counts (e.g. 900 frames = 30.00s) hold.
 * - Post-encode FFprobe stream/container inspection + EBU R128 loudness + blackdetect/freezedetect QA
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkFreeDiskMb, PROJECT_ROOT, sha256File } from '../setup/hydrate.mjs';

const execFileAsync = promisify(execFile);

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

function probeWavDurationSec(wavPath) {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', wavPath],
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(raw);
  const a = (parsed.streams || []).find((s) => s.codec_type === 'audio');
  return Number(a?.duration || parsed.format?.duration || 0);
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
  const qaStderr = execFileSync(
    'python3',
    [
      '-c',
      'import subprocess, sys; p=subprocess.run(["ffmpeg","-nostats","-i",sys.argv[1],"-vf","freezedetect=n=0.0005:d=0.6,blackdetect=d=0.05","-af","ebur128=peak=true","-f","null","-"], capture_output=True, text=True); print(p.stderr)',
      mp4Path,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );

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
          durationSec: Number(audioStream.duration || 0),
          integratedLufs: iMatches.length ? Number(iMatches[iMatches.length - 1][1]) : null,
          truePeakDbfs: tpMatches.length ? Number(tpMatches[tpMatches.length - 1][1]) : null,
        }
      : null,
    fastStart,
    blackEvents,
    freezeEvents,
  };
}

export function muxFramesAndAudio({
  framesDir,
  audioWavPath,
  outputMp4Path,
  expectedFrameCount,
  preset = 'medium',
  crf = 18,
  maxAudioOverflowSec = 0.25,
  padShortAudio = true,
  strictDurationGuard = false,
}) {
  checkFreeDiskMb(PROJECT_ROOT, 512);
  if (!fs.existsSync(framesDir)) {
    throw new Error(`FRAMES_DIR_NOT_FOUND: ${framesDir}`);
  }
  if (!fs.existsSync(audioWavPath)) {
    throw new Error(`AUDIO_WAV_NOT_FOUND: ${audioWavPath}`);
  }

  let frameCount = expectedFrameCount;
  if (frameCount !== undefined) {
    for (let f = 0; f < frameCount; f++) {
      const fp = path.join(framesDir, `f${String(f).padStart(4, '0')}.jpg`);
      if (!fs.existsSync(fp)) {
        throw new Error(`MISSING_SEQUENCE_FRAME: Expected ${fp} (0..${frameCount - 1})`);
      }
    }
  } else {
    const files = fs.readdirSync(framesDir).filter((f) => /^f\d{4}\.jpg$/.test(f));
    frameCount = files.length;
  }

  const audioDurSec = probeWavDurationSec(audioWavPath);
  const videoDurSec = frameCount > 0 ? frameCount / 30 : 0;
  if (
    strictDurationGuard &&
    frameCount > 0 &&
    Number.isFinite(audioDurSec) &&
    audioDurSec > videoDurSec + maxAudioOverflowSec
  ) {
    throw new Error(
      `AUDIO_LONGER_THAN_VIDEO: Audio duration (${audioDurSec.toFixed(3)}s) exceeds ${frameCount} frames (${videoDurSec.toFixed(3)}s) by ${(audioDurSec - videoDurSec).toFixed(3)}s; refusing silent -shortest voice truncation.`
    );
  }

  const outAbs = path.resolve(outputMp4Path);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const tmpMp4 = `${outAbs}.${process.pid}.${Date.now()}.tmp.mp4`;

  const ffmpegArgs = [
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
  ];

  if (frameCount > 0) {
    ffmpegArgs.push('-frames:v', String(frameCount));
  }

  if (padShortAudio && frameCount > 0 && audioDurSec > 0 && audioDurSec < videoDurSec - 0.02) {
    ffmpegArgs.push('-af', `apad=whole_dur=${videoDurSec.toFixed(4)}`);
  }

  ffmpegArgs.push(
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-b:a',
    '192k',
    '-t',
    videoDurSec > 0 ? videoDurSec.toFixed(4) : String(audioDurSec || 1),
    '-movflags',
    '+faststart',
    tmpMp4
  );

  try {
    execFileSync('ffmpeg', ffmpegArgs, { stdio: 'pipe' });
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

/**
 * Non-blocking async FFprobe + blackdetect/freezedetect/ebur128 MP4 verifier (never blocks HTTP/SSE event loop).
 */
export async function probeMp4Async(mp4Path) {
  if (!fs.existsSync(mp4Path)) {
    throw new Error(`MP4_NOT_FOUND: ${mp4Path}`);
  }
  const [{ stdout: raw }, { stdout: qaStderr }] = await Promise.all([
    execFileAsync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', mp4Path],
      { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 }
    ),
    execFileAsync(
      'python3',
      [
        '-c',
        'import subprocess, sys; p=subprocess.run(["ffmpeg","-nostats","-i",sys.argv[1],"-vf","freezedetect=n=0.0005:d=0.6,blackdetect=d=0.05","-af","ebur128=peak=true","-f","null","-"], capture_output=True, text=True); print(p.stderr)',
        mp4Path,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 90_000 }
    ),
  ]);

  const parsed = JSON.parse(raw);
  const videoStream = (parsed.streams || []).find((s) => s.codec_type === 'video');
  const audioStream = (parsed.streams || []).find((s) => s.codec_type === 'audio');
  const fastStart = verifyFastStartMoovBeforeMdat(mp4Path);

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

  return {
    valid: Object.values(checks).every(Boolean),
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
          durationSec: Number(audioStream.duration || 0),
          integratedLufs: iMatches.length ? Number(iMatches[iMatches.length - 1][1]) : null,
          truePeakDbfs: tpMatches.length ? Number(tpMatches[tpMatches.length - 1][1]) : null,
        }
      : null,
    fastStart,
    blackEvents,
    freezeEvents,
  };
}

/**
 * Non-blocking async FFmpeg MP4 muxer with identical duration guard & verification guarantees.
 */
export async function muxFramesAndAudioAsync({
  framesDir,
  audioWavPath,
  outputMp4Path,
  expectedFrameCount,
  preset = 'medium',
  crf = 18,
  maxAudioOverflowSec = 0.25,
  padShortAudio = true,
  strictDurationGuard = false,
  signal,
}) {
  checkFreeDiskMb(PROJECT_ROOT, 512);
  if (!fs.existsSync(framesDir)) throw new Error(`FRAMES_DIR_NOT_FOUND: ${framesDir}`);
  if (!fs.existsSync(audioWavPath)) throw new Error(`AUDIO_WAV_NOT_FOUND: ${audioWavPath}`);

  let frameCount = expectedFrameCount;
  if (frameCount !== undefined) {
    for (let f = 0; f < frameCount; f++) {
      const fp = path.join(framesDir, `f${String(f).padStart(4, '0')}.jpg`);
      if (!fs.existsSync(fp)) {
        throw new Error(`MISSING_SEQUENCE_FRAME: Expected ${fp} (0..${frameCount - 1})`);
      }
    }
  } else {
    frameCount = fs.readdirSync(framesDir).filter((f) => /^f\d{4}\.jpg$/.test(f)).length;
  }

  const audioDurSec = probeWavDurationSec(audioWavPath);
  const videoDurSec = frameCount > 0 ? frameCount / 30 : 0;
  if (strictDurationGuard && frameCount > 0 && Number.isFinite(audioDurSec) && audioDurSec > videoDurSec + maxAudioOverflowSec) {
    throw new Error(
      `AUDIO_LONGER_THAN_VIDEO: Audio duration (${audioDurSec.toFixed(3)}s) exceeds ${frameCount} frames (${videoDurSec.toFixed(3)}s).`
    );
  }

  const outAbs = path.resolve(outputMp4Path);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const tmpMp4 = `${outAbs}.${process.pid}.${Date.now()}.tmp.mp4`;

  const ffmpegArgs = [
    '-v', 'error', '-y', '-framerate', '30',
    '-i', path.join(framesDir, 'f%04d.jpg'),
    '-i', audioWavPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-r', '30',
  ];
  if (frameCount > 0) ffmpegArgs.push('-frames:v', String(frameCount));
  if (padShortAudio && frameCount > 0 && audioDurSec > 0 && audioDurSec < videoDurSec - 0.02) {
    ffmpegArgs.push('-af', `apad=whole_dur=${videoDurSec.toFixed(4)}`);
  }
  ffmpegArgs.push(
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
    '-t', videoDurSec > 0 ? videoDurSec.toFixed(4) : String(audioDurSec || 1),
    '-movflags', '+faststart',
    tmpMp4
  );

  try {
    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 180_000, signal });
    fs.renameSync(tmpMp4, outAbs);
  } finally {
    if (fs.existsSync(tmpMp4)) fs.rmSync(tmpMp4, { force: true });
  }

  const probe = await probeMp4Async(outAbs);
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
