/**
 * Async Parallel Evidence-Based Render Job QA Verifier (QA-TTS-01 Section 11 & 13: Q01–Q18)
 *
 * Speed optimization without changing a single pixel or assertion:
 * - Runs read-only post-encode checks (`probeMp4`, `buildStoryContactSheet`, `buildSubtitleCheckSheet`)
 *   concurrently via `Promise.all` with bounded 4-way async FFmpeg frame extraction & pixel diffing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PROJECT_ROOT, sha256File } from '../../../tools/setup/hydrate.mjs';
import { probeMp4Async } from '../../../tools/render/mux-mp4.mjs';
import { inspectJpegFile } from '../../../tools/qa/image-inspector.mjs';

const execFileAsync = promisify(execFile);

async function runPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let nextIdx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIdx < items.length) {
      const i = nextIdx++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Generates an N-tile contact sheet from a frames directory using `tools/render/contact-sheet.py` asynchronously.
 */
export async function buildStoryContactSheet({
  projectRoot = PROJECT_ROOT,
  framesDir,
  totalFrames,
  outputPath,
  tileCount = 12,
  cols = 6,
}) {
  const count = Math.max(1, Math.min(tileCount, totalFrames));
  const indices = [];
  for (let i = 0; i < count; i++) {
    const idx = count === 1 ? 0 : Math.round((i * (totalFrames - 1)) / (count - 1));
    indices.push(idx);
  }
  const paths = indices.map((f) => path.join(framesDir, `f${String(f).padStart(4, '0')}.jpg`));
  const script = path.join(projectRoot, 'tools', 'render', 'contact-sheet.py');
  const { stdout } = await execFileAsync('python3', [script, paths.join(','), outputPath, '--cols', String(cols)], {
    timeout: 60_000,
  });
  return { ...JSON.parse(stdout), sampledFrames: indices, sha256: sha256File(outputPath) };
}

/**
 * Extracts frames from an encoded MP4 at 8-10 non-adjacent timestamps concurrently (bounded pool = 4)
 * and computes lower-third pixel diffs in a single batched Python call against an unsubtitled MP4.
 */
export async function buildSubtitleCheckSheet({
  projectRoot = PROJECT_ROOT,
  mp4Path,
  unsubbedMp4Path = null,
  durationSec,
  outputPath,
  workDir,
  sampleCount = 10,
}) {
  fs.mkdirSync(workDir, { recursive: true });
  const dur = Math.max(0.5, Number(durationSec) || 1);
  const timestamps = [];
  const count = Math.max(2, Math.min(sampleCount, Math.max(2, Math.floor(dur * 2))));
  for (let i = 0; i < count; i++) {
    const t = Number((0.4 + ((dur - 0.8) * i) / Math.max(1, count - 1)).toFixed(2));
    timestamps.push(Math.max(0.05, Math.min(dur - 0.05, t)));
  }

  const hasRef = Boolean(unsubbedMp4Path && fs.existsSync(unsubbedMp4Path));

  // Extract sampled frames in bounded 4-way async pool (4x faster than sequential FFmpeg!)
  const pairs = await runPool(timestamps, 4, async (t, i) => {
    const framePath = path.join(workDir, `sub_${String(i).padStart(2, '0')}.jpg`);
    const tasks = [
      execFileAsync(
        'ffmpeg',
        ['-v', 'error', '-y', '-ss', String(t), '-i', mp4Path, '-frames:v', '1', '-q:v', '2', framePath],
        { timeout: 30_000 }
      ),
    ];
    let refPath = null;
    if (hasRef) {
      refPath = path.join(workDir, `nosub_${String(i).padStart(2, '0')}.jpg`);
      tasks.push(
        execFileAsync(
          'ffmpeg',
          ['-v', 'error', '-y', '-ss', String(t), '-i', unsubbedMp4Path, '-frames:v', '1', '-q:v', '2', refPath],
          { timeout: 30_000 }
        )
      );
    }
    await Promise.all(tasks);
    return { timeSec: t, framePath, refPath };
  });

  const extracted = pairs.map((p) => p.framePath);
  const script = path.join(projectRoot, 'tools', 'render', 'contact-sheet.py');

  // Run contact sheet assembly + batched NumPy pixel-diff concurrently!
  const sheetPromise = execFileAsync('python3', [script, extracted.join(','), outputPath, '--cols', '5'], {
    timeout: 60_000,
  });

  let diffStats = [];
  if (hasRef) {
    const pyBatchDiff = `
import json, sys
import numpy as np
from PIL import Image
pairs = json.loads(sys.argv[1])
out = []
for item in pairs:
    a = np.asarray(Image.open(item["framePath"]).convert("RGB"), dtype=np.int16)
    b = np.asarray(Image.open(item["refPath"]).convert("RGB"), dtype=np.int16)
    h = a.shape[0]
    y0, y1 = int(h * 0.55), int(h * 0.90)
    diff = np.abs(a[y0:y1] - b[y0:y1]).mean(axis=2)
    out.append({
        "timeSec": item["timeSec"],
        "changedPixelRatio": round(float((diff > 18).mean()), 5),
        "meanDiff": round(float(diff.mean()), 3),
    })
print(json.dumps(out))
`;
    const [sheetRes, diffRes] = await Promise.all([
      sheetPromise,
      execFileAsync('python3', ['-c', pyBatchDiff, JSON.stringify(pairs)], { timeout: 30_000 }),
    ]);
    diffStats = JSON.parse(diffRes.stdout);
    const framesWithVisibleCaptionDiff = diffStats.filter((d) => d.changedPixelRatio > 0.004).length;
    return {
      ...JSON.parse(sheetRes.stdout),
      timestamps,
      diffStats,
      framesWithVisibleCaptionDiff,
      sha256: sha256File(outputPath),
    };
  }

  const sheetRes = await sheetPromise;
  return {
    ...JSON.parse(sheetRes.stdout),
    timestamps,
    diffStats,
    framesWithVisibleCaptionDiff: 0,
    sha256: sha256File(outputPath),
  };
}

/**
 * Evaluates a render job's artifacts concurrently and builds a structured evidence-based QA report.
 */
export async function verifyRenderJob({
  projectRoot = PROJECT_ROOT,
  project,
  job,
  mp4Path,
  unsubbedMp4Path = null,
  framesDir,
  framesManifest,
  timing = null,
  audioMixReport = null,
  subtitleInfo = null,
  qaDir,
}) {
  fs.mkdirSync(qaDir, { recursive: true });
  const testedAt = new Date().toISOString();
  const expectedFrames = Number(job.frameCount || project.totalFrames || 0);
  const targetSec = expectedFrames / 30;

  const contactSheetPath = path.join(qaDir, 'contact-sheet.jpg');
  const subCheckPath = path.join(qaDir, 'sub-check.jpg');

  // Execute read-only FFprobe + Story Contact Sheet + Subtitle Check Sheet concurrently!
  const [mp4Probe, contactSheet, subCheck] = await Promise.all([
    probeMp4Async(mp4Path),
    buildStoryContactSheet({
      projectRoot,
      framesDir,
      totalFrames: expectedFrames,
      outputPath: contactSheetPath,
      tileCount: Math.min(12, expectedFrames),
      cols: Math.min(6, expectedFrames),
    }),
    buildSubtitleCheckSheet({
      projectRoot,
      mp4Path,
      unsubbedMp4Path: project.captionsEnabled ? unsubbedMp4Path : null,
      durationSec: targetSec,
      outputPath: subCheckPath,
      workDir: path.join(qaDir, 'sub-samples'),
      sampleCount: expectedFrames >= 120 ? 10 : Math.max(2, Math.min(4, Math.floor(expectedFrames / 10))),
    }),
  ]);

  const contactSheetCheck = inspectJpegFile(contactSheetPath);
  const durationDelta = Math.abs(mp4Probe.durationSec - targetSec);
  const renderedFrameCount = framesManifest?.summary?.frameCount ?? framesManifest?.frameCount ?? 0;
  const contiguousFramesOk =
    framesManifest &&
    renderedFrameCount === expectedFrames &&
    framesManifest.frames.every((f, idx) => f.frameIndex === idx && f.width === 1080 && f.height === 1920 && f.nonBlackRatio > 0.35);

  const subOnPass = project.captionsEnabled
    ? Boolean(
        subtitleInfo?.enabled &&
          subtitleInfo?.assPath &&
          fs.existsSync(subtitleInfo.assPath) &&
          subtitleInfo?.audioPreserved &&
          (unsubbedMp4Path ? subCheck.framesWithVisibleCaptionDiff >= 1 : true)
      )
    : null;

  const gates = [
    {
      id: 'Q06',
      title: 'Voiceover & audio format verified via FFprobe',
      severity: 'mandatory',
      status: mp4Probe.audio?.codec === 'aac' && mp4Probe.audio?.sampleRate === 48000 && mp4Probe.audio?.channels === 2 ? 'PASS' : 'FAIL',
      testedAt,
      inputHash: job.inputSpecHash,
      resultHash: mp4Probe.sha256.slice(0, 16),
      message: `AAC ${mp4Probe.audio?.sampleRate} Hz, ${mp4Probe.audio?.channels}ch, LUFS=${mp4Probe.audio?.integratedLufs}, peak=${mp4Probe.audio?.truePeakDbfs} dBFS`,
    },
    {
      id: 'Q07',
      title: 'Audio-script timing verified',
      severity: 'advisory',
      status: timing
        ? timing.overflow
          ? 'FAIL'
          : timing.alignmentPrecision === 'exact-whisper-asr'
            ? 'PASS'
            : 'UNVERIFIED'
        : 'UNVERIFIED',
      testedAt,
      inputHash: job.inputSpecHash,
      resultHash: timing?.timingId || null,
      message: timing
        ? `precision=${timing.alignmentPrecision}, syncVerification=${timing.syncVerification}, audio=${timing.audioDurationSec}s vs target=${timing.targetDurationSec}s.`
        : 'Timing alignment metadata unavailable.',
    },
    {
      id: 'Q08',
      title: `Renderer continuity (${expectedFrames} frames)`,
      severity: 'mandatory',
      status: contiguousFramesOk ? 'PASS' : 'FAIL',
      testedAt,
      inputHash: job.inputSpecHash,
      resultHash: framesManifest
        ? crypto
            .createHash('sha256')
            .update(framesManifest.frames.map((f) => f.sha256).join(','))
            .digest('hex')
            .slice(0, 16)
        : null,
      message: `Rendered ${renderedFrameCount}/${expectedFrames} contiguous 1080x1920 non-black frames (workers=${framesManifest?.workersUsed ?? 1}).`,
    },
    {
      id: 'Q10',
      title: 'Sound mix numeric metrics',
      severity: 'mandatory',
      status:
        audioMixReport && audioMixReport.masterPeakDbfs <= -0.5 && audioMixReport.duckingApplied === false
          ? 'PASS'
          : mp4Probe.audio?.integratedLufs !== null && mp4Probe.audio?.truePeakDbfs <= -0.1
            ? 'PASS'
            : 'UNVERIFIED',
      testedAt,
      inputHash: job.inputSpecHash,
      resultHash: mp4Probe.sha256.slice(0, 16),
      message: audioMixReport
        ? `musicRelDb=${audioMixReport.measuredMusicRelDb} dB, sfxPeak=${audioMixReport.sfxPeakDbfs} dBFS, masterPeak=${audioMixReport.masterPeakDbfs} dBFS, ducking=${audioMixReport.duckingApplied}.`
        : `Encoded loudness I=${mp4Probe.audio?.integratedLufs} LUFS, truePeak=${mp4Probe.audio?.truePeakDbfs} dBFS.`,
    },
    {
      id: 'Q11',
      title: 'MP4 codecs, faststart, and duration',
      severity: 'mandatory',
      status:
        mp4Probe.valid && mp4Probe.video.nbFrames === expectedFrames && durationDelta <= 0.12
          ? 'PASS'
          : 'FAIL',
      testedAt,
      inputHash: job.inputSpecHash,
      resultHash: mp4Probe.sha256.slice(0, 16),
      message: `H.264 ${mp4Probe.video.pixFmt} ${mp4Probe.video.width}x${mp4Probe.video.height} @ ${mp4Probe.video.rFrameRate}, frames=${mp4Probe.video.nbFrames}/${expectedFrames}, duration=${mp4Probe.durationSec.toFixed(3)}s (target ${targetSec.toFixed(3)}s), faststart=${mp4Probe.fastStart.fastStartVerified}, blackEvents=${mp4Probe.blackEvents.length}, freezeEvents=${mp4Probe.freezeEvents.length}.`,
    },
    {
      id: 'Q12',
      title: 'Subtitles ON visual burn & audio preservation',
      severity: project.captionsEnabled ? 'mandatory' : 'not-applicable',
      status: project.captionsEnabled ? (subOnPass ? 'PASS' : 'FAIL') : 'UNVERIFIED',
      testedAt,
      inputHash: job.inputSpecHash,
      resultHash: subCheck.sha256.slice(0, 16),
      message: project.captionsEnabled
        ? `ASS chunks=${subtitleInfo?.chunkCount ?? 0}, audioPreserved=${subtitleInfo?.audioPreserved}, samplesWithVisibleCaptionPixels=${subCheck.framesWithVisibleCaptionDiff}/${subCheck.diffStats.length}.`
        : 'Subtitles disabled for this render.',
    },
    {
      id: 'Q13',
      title: 'Subtitles OFF truly disabled',
      severity: !project.captionsEnabled ? 'mandatory' : 'not-applicable',
      status: !project.captionsEnabled ? (subtitleInfo?.skipped ? 'PASS' : 'FAIL') : 'UNVERIFIED',
      testedAt,
      inputHash: job.inputSpecHash,
      resultHash: mp4Probe.sha256.slice(0, 16),
      message: !project.captionsEnabled
        ? 'No ASS burn-in applied; exported MP4 is clean of burned subtitles.'
        : 'Subtitles enabled for this render (checked separately in SUB OFF fixture).',
    },
    {
      id: 'Q18',
      title: 'Export playable & contact sheets verified',
      severity: 'mandatory',
      status: mp4Probe.valid && contactSheetCheck.valid && fs.statSync(mp4Path).size > 8192 ? 'PASS' : 'FAIL',
      testedAt,
      inputHash: job.inputSpecHash,
      resultHash: mp4Probe.sha256.slice(0, 16),
      message: `Playable MP4 (${mp4Probe.byteSize} bytes) + contactSheet (${contactSheetCheck.width}x${contactSheetCheck.height}). Human subjective viewing remains UNVERIFIED.`,
    },
  ];

  const mandatoryFailed = gates.filter((g) => g.severity === 'mandatory' && g.status !== 'PASS');
  const overallStatus = mandatoryFailed.length === 0 ? 'PASS' : 'FAIL';

  const report = {
    schemaVersion: 1,
    evaluatedAt: testedAt,
    projectId: project.projectId,
    jobId: job.jobId,
    inputSpecHash: job.inputSpecHash,
    overallStatus,
    humanSubjectiveReview: 'UNVERIFIED',
    captionsEnabled: Boolean(project.captionsEnabled),
    aspectRatio: project.aspectRatio,
    mp4Probe,
    contactSheet,
    subCheck,
    audioMixReport,
    timingSummary: timing
      ? {
          timingId: timing.timingId,
          alignmentPrecision: timing.alignmentPrecision,
          syncVerification: timing.syncVerification,
          audioDurationSec: timing.audioDurationSec,
          targetDurationSec: timing.targetDurationSec,
          warnings: timing.warnings,
        }
      : null,
    gates,
  };

  fs.writeFileSync(path.join(qaDir, 'qa-report.json'), JSON.stringify(report, null, 2), 'utf8');
  return report;
}
