/**
 * Timing & Alignment Service (QA-TTS-01)
 *
 * Wraps `tools/timing/timing_validator.py::run_timing_pipeline` via bounded child_process spawn
 * and uses FFprobe as the source of truth for actual audio duration.
 *
 * Truthfulness rules:
 * - Never labels `approximate-silence-dp` as exact word-level ASR synchronization;
 *   explicitly tags `syncVerification: 'UNVERIFIED_WORD_SYNC'`.
 * - Detects and reports duration overflow against fixed story frame budgets (`expectedDurationSec`).
 * - Flags script-vs-speech mismatches when word counts or durations diverge materially.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PROJECT_ROOT } from '../../../tools/setup/hydrate.mjs';
import { validateSafeId } from '../../shared/contract.mjs';
import { probeAudioFile } from './tts-service.mjs';

const execFileAsync = promisify(execFile);

/**
 * Normalizes script text to word tokens for duration & correspondence sanity checks.
 * @param {string} scriptText
 * @returns {string[]}
 */
export function tokenizeScript(scriptText) {
  return String(scriptText || '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, ''))
    .filter(Boolean);
}

/**
 * Runs real FFprobe + `tools/timing/timing_validator.py` on an audio file and script.
 * @param {{ projectRoot?: string, projectId: string, audioId: string, audioPath: string, scriptText: string, expectedFrames?: number, expectedDurationSec?: number, maxOverflowSec?: number }} params
 */
export async function prepareTiming({
  projectRoot = PROJECT_ROOT,
  projectId,
  audioId,
  audioPath,
  scriptText,
  expectedFrames = 900,
  expectedDurationSec,
  maxOverflowSec = 0.25,
}) {
  const safeProject = validateSafeId(projectId, 'projectId');
  const cleanScript = String(scriptText || '').trim();
  if (!cleanScript) {
    const err = new Error('MISSING_SCRIPT: Script text is required before running timing alignment.');
    err.code = 'MISSING_SCRIPT';
    err.statusCode = 400;
    throw err;
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    const err = new Error(`AUDIO_FILE_NOT_FOUND: "${audioPath || '(missing)'}" does not exist.`);
    err.code = 'AUDIO_FILE_NOT_FOUND';
    err.statusCode = 400;
    throw err;
  }

  const probe = probeAudioFile(audioPath);
  const targetDuration = Number.isFinite(Number(expectedDurationSec))
    ? Number(expectedDurationSec)
    : Number((expectedFrames / 30).toFixed(4));

  const timingKey = crypto
    .createHash('sha256')
    .update(JSON.stringify({ audioId, durationSec: probe.durationSec, scriptText: cleanScript }))
    .digest('hex')
    .slice(0, 12);
  const timingId = `tm-${timingKey}`;
  const timingDir = path.resolve(projectRoot, 'workspace', 'projects', safeProject, 'timing', timingId);
  fs.mkdirSync(timingDir, { recursive: true });

  const scriptFile = path.join(timingDir, 'script.txt');
  fs.writeFileSync(scriptFile, cleanScript + '\n', 'utf8');

  const validatorPy = path.join(projectRoot, 'tools', 'timing', 'timing_validator.py');
  let stdout = '';
  try {
    const res = await execFileAsync(
      'python3',
      [validatorPy, audioPath, cleanScript, '--out', timingDir],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }
    );
    stdout = res.stdout;
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err);
    const wrapped = new Error(`TIMING_ALIGNMENT_FAILED: ${detail.slice(0, 400)}`);
    wrapped.code = 'TIMING_ALIGNMENT_FAILED';
    wrapped.statusCode = 422;
    throw wrapped;
  }

  const validation = JSON.parse(stdout);
  const words = JSON.parse(fs.readFileSync(path.join(timingDir, 'words.json'), 'utf8'));
  const phrases = JSON.parse(fs.readFileSync(path.join(timingDir, 'phrases.json'), 'utf8'));

  const warnings = [];
  const durationDeltaSec = Number((probe.durationSec - targetDuration).toFixed(4));
  const overflow = probe.durationSec > targetDuration + maxOverflowSec;
  if (overflow) {
    warnings.push({
      code: 'AUDIO_DURATION_OVERFLOW',
      severity: 'error',
      message: `Audio duration (${probe.durationSec.toFixed(2)}s) exceeds target story duration (${targetDuration.toFixed(2)}s / ${expectedFrames} frames) by +${durationDeltaSec.toFixed(2)}s. Edit script or adjust audio pacing before rendering.`,
    });
  } else if (targetDuration - probe.durationSec > 2.5) {
    warnings.push({
      code: 'AUDIO_SHORTER_THAN_STORY',
      severity: 'warning',
      message: `Audio (${probe.durationSec.toFixed(2)}s) is ${(targetDuration - probe.durationSec).toFixed(2)}s shorter than the ${targetDuration.toFixed(2)}s story; tail silence will pad the end without truncating frames.`,
    });
  }

  const scriptTokens = tokenizeScript(cleanScript);
  const wordsPerSec = scriptTokens.length / Math.max(0.1, probe.durationSec);
  if (wordsPerSec < 1.1 || wordsPerSec > 4.6) {
    warnings.push({
      code: 'SCRIPT_SPEECH_RATE_MISMATCH',
      severity: 'warning',
      message: `Script length (${scriptTokens.length} words) vs audio length (${probe.durationSec.toFixed(2)}s) yields ${wordsPerSec.toFixed(2)} words/sec; verify the imported audio matches this script.`,
    });
  }

  const isExactAsr = validation.alignmentPrecision === 'exact-whisper-asr';
  const syncVerification = isExactAsr ? 'ASR_ALIGNED_REVIEW_RECOMMENDED' : 'UNVERIFIED_WORD_SYNC';
  if (!isExactAsr) {
    warnings.push({
      code: 'UNVERIFIED_WORD_SYNC',
      severity: 'info',
      message:
        'Whisper ASR is not installed locally; timestamps use approximate silence-DP phrase alignment (UNVERIFIED_WORD_SYNC). Do not treat per-word timings as exact ASR ground truth.',
    });
  }

  const summary = {
    timingId,
    projectId: safeProject,
    audioId,
    timingDir,
    wordsPath: path.join(timingDir, 'words.json'),
    phrasesPath: path.join(timingDir, 'phrases.json'),
    audioDurationSec: probe.durationSec,
    audioSampleRate: probe.sampleRate,
    audioChannels: probe.channels,
    targetDurationSec: targetDuration,
    expectedFrames,
    durationDeltaSec,
    overflow,
    alignmentPrecision: validation.alignmentPrecision,
    syncVerification,
    wordCount: validation.wordCount,
    phraseCount: validation.phraseCount,
    segmentCount: validation.segmentCount,
    wordsPerSec: Number(wordsPerSec.toFixed(2)),
    valid: Boolean(validation.valid) && !overflow,
    warnings,
    words,
    phrases,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(timingDir, 'timing-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}
