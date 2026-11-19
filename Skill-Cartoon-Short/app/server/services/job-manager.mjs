/**
 * Asynchronous Bounded Render Job Orchestrator (QA-TTS-01 Section 09)
 *
 * Finite State Machine:
 * QUEUED -> PREPARING -> VALIDATING_INPUT -> GENERATING_TTS (optional) -> PROBING_AUDIO ->
 * ALIGNING -> RENDERING_FRAMES -> MIXING -> MUXING -> SUBTITLES (optional) -> VERIFYING ->
 * COMPLETED | FAILED | CANCELED | BLOCKED | INTERRUPTED
 *
 * Guarantees:
 * - Isolated per-job directory `workspace/projects/<projectId>/jobs/<jobId>/`
 * - Uses ONLY `ShortRendererSession` (`engine/adapters/renderer-adapter.mjs`), `tools/audio/mix.py`,
 *   `tools/render/mux-mp4.mjs`, and `tools/subtitles/cartoon_subs.py`.
 * - Prevents duplicate concurrent renders for the same project (409 JOB_ALREADY_RUNNING).
 * - Process-tree cancellation & cleanup of partial temp artifacts; crash recovery marks stale
 *   `RUNNING` jobs as `INTERRUPTED` on server startup.
 * - Live SSE progress events via `subscribe(jobId, listener)`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { checkFreeDiskMb, PROJECT_ROOT, sha256File } from '../../../tools/setup/hydrate.mjs';
import { ShortRendererSession } from '../../../engine/adapters/renderer-adapter.mjs';
import { muxFramesAndAudioAsync } from '../../../tools/render/mux-mp4.mjs';
import { validateAspectRatio, validateSafeId } from '../../shared/contract.mjs';
import { atomicWriteSecureSync } from './settings-store.mjs';
import { probeAudioFile } from './tts-service.mjs';
import { prepareTiming } from './timing-service.mjs';
import { burnSubtitlesOntoMp4, prepareSubtitles } from './subtitle-service.mjs';
import { verifyRenderJob } from './qa-service.mjs';

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'BLOCKED', 'INTERRUPTED']);
const ACTIVE_STATES = new Set([
  'QUEUED',
  'PREPARING',
  'VALIDATING_INPUT',
  'GENERATING_TTS',
  'PROBING_AUDIO',
  'ALIGNING',
  'RENDERING_FRAMES',
  'MIXING',
  'MUXING',
  'SUBTITLES',
  'VERIFYING',
]);

function spawnWithAbort(cmd, args, { cwd, signal, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('JOB_CANCELED'));
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const killTree = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    };

    const onAbort = () => {
      killTree();
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('JOB_CANCELED'));
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      killTree();
      if (!settled) {
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        reject(new Error(`SUBPROCESS_TIMEOUT after ${timeoutMs}ms: ${cmd}`));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 32768) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 32768) stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (code !== 0) {
          reject(new Error(`SUBPROCESS_EXIT_${code}: ${cmd} — ${(stderr || stdout).slice(0, 400)}`));
        } else {
          resolve({ stdout, stderr });
        }
      }
    });
  });
}

/**
 * Creates a bounded render JobManager instance.
 */
export function createJobManager({
  projectRoot = PROJECT_ROOT,
  projectStore,
  mediaStore,
  ttsService,
  minFreeDiskMb = Number(process.env.SHORT_MIN_FREE_DISK_MB || 1024),
} = {}) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);

  const jobs = new Map(); // jobId -> jobRecord
  const activeProjectJobs = new Map(); // projectId -> jobId
  const controllers = new Map(); // jobId -> AbortController
  const projectsRoot = path.resolve(projectRoot, 'workspace', 'projects');

  function jobDirPath(projectId, jobId) {
    const p = validateSafeId(projectId, 'projectId');
    const j = validateSafeId(jobId, 'jobId');
    const resolved = path.resolve(projectsRoot, p, 'jobs', j);
    if (!resolved.startsWith(projectsRoot + path.sep)) {
      throw new Error('PATH_CONFINEMENT_VIOLATION');
    }
    return resolved;
  }

  function persistJob(job) {
    const dir = jobDirPath(job.projectId, job.jobId);
    fs.mkdirSync(dir, { recursive: true });
    atomicWriteSecureSync(path.join(dir, 'job.json'), Buffer.from(JSON.stringify(job, null, 2), 'utf8'), {
      mode: 0o644,
    });
  }

  function emitUpdate(job, note = '') {
    job.updatedAt = new Date().toISOString();
    if (note) {
      job.logs.push({ at: job.updatedAt, stage: job.stage, message: note });
      if (job.logs.length > 80) job.logs = job.logs.slice(-80);
    }
    persistJob(job);
    emitter.emit(`job:${job.jobId}`, { ...job });
  }

  /**
   * Recovers any stale active jobs left from a prior process crash -> INTERRUPTED.
   */
  function recoverStaleJobsOnStartup() {
    if (!fs.existsSync(projectsRoot)) return 0;
    let recovered = 0;
    for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const jobsDir = path.join(projectsRoot, entry.name, 'jobs');
      if (!fs.existsSync(jobsDir)) continue;
      for (const je of fs.readdirSync(jobsDir, { withFileTypes: true })) {
        if (!je.isDirectory()) continue;
        const jf = path.join(jobsDir, je.name, 'job.json');
        if (!fs.existsSync(jf)) continue;
        try {
          const rec = JSON.parse(fs.readFileSync(jf, 'utf8'));
          if (ACTIVE_STATES.has(rec.stage)) {
            rec.stage = 'INTERRUPTED';
            rec.status = 'INTERRUPTED';
            rec.retryable = true;
            rec.error = 'Render job interrupted by server restart; safe to retry.';
            rec.updatedAt = new Date().toISOString();
            atomicWriteSecureSync(jf, Buffer.from(JSON.stringify(rec, null, 2), 'utf8'), { mode: 0o644 });
            recovered += 1;
          }
          jobs.set(rec.jobId, rec);
        } catch {
          // ignore corrupted legacy job file
        }
      }
    }
    return recovered;
  }

  function getJob(jobId) {
    const safeJobId = validateSafeId(jobId, 'jobId');
    if (jobs.has(safeJobId)) return jobs.get(safeJobId);
    // Search project job dirs on disk
    if (fs.existsSync(projectsRoot)) {
      for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const jf = path.join(projectsRoot, entry.name, 'jobs', safeJobId, 'job.json');
        if (fs.existsSync(jf)) {
          const rec = JSON.parse(fs.readFileSync(jf, 'utf8'));
          jobs.set(safeJobId, rec);
          return rec;
        }
      }
    }
    const err = new Error(`JOB_NOT_FOUND: "${safeJobId}" not found.`);
    err.code = 'JOB_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  function listJobs(projectId = null) {
    const all = Array.from(jobs.values());
    const filtered = projectId ? all.filter((j) => j.projectId === projectId) : all;
    return filtered.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  function subscribe(jobId, listener) {
    const key = `job:${validateSafeId(jobId, 'jobId')}`;
    emitter.on(key, listener);
    return () => emitter.off(key, listener);
  }

  function cancelJob(jobId) {
    const job = getJob(jobId);
    if (TERMINAL_STATES.has(job.stage)) {
      return job;
    }
    const ctrl = controllers.get(job.jobId);
    if (ctrl) ctrl.abort();
    job.stage = 'CANCELED';
    job.status = 'CANCELED';
    job.error = 'Canceled by user.';
    job.completedAt = new Date().toISOString();
    activeProjectJobs.delete(job.projectId);
    emitUpdate(job, 'Render job canceled.');
    return job;
  }

  async function executeJob(job, options = {}) {
    const ctrl = controllers.get(job.jobId);
    const signal = ctrl.signal;
    const jobDir = jobDirPath(job.projectId, job.jobId);
    const framesDir = path.join(jobDir, 'frames');
    const tempDir = path.join(jobDir, 'temp');
    const finalDir = path.join(jobDir, 'final');
    const qaDir = path.join(jobDir, 'qa');
    fs.mkdirSync(framesDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(finalDir, { recursive: true });
    fs.mkdirSync(qaDir, { recursive: true });

    const checkAbort = () => {
      if (signal.aborted) throw new Error('JOB_CANCELED');
    };

    try {
      // Stage: PREPARING
      job.stage = 'PREPARING';
      job.progressPct = 3;
      emitUpdate(job, 'Checking disk headroom and loading project contract...');
      const availMb = checkFreeDiskMb(projectRoot, minFreeDiskMb);
      job.freeDiskMbAtStart = availMb;
      checkAbort();

      const project = projectStore.getProject(job.projectId);
      validateAspectRatio(project.aspectRatio);
      if (!project.engineReady) {
        const err = new Error(`ENGINE_NOT_HYDRATED: Story "${project.storyId}" has not been hydrated. Run npm run setup.`);
        err.code = 'ENGINE_NOT_HYDRATED';
        err.blocked = true;
        throw err;
      }

      // Stage: VALIDATING_INPUT
      job.stage = 'VALIDATING_INPUT';
      job.progressPct = 6;
      emitUpdate(job, 'Validating narration source and script...');
      checkAbort();

      let activeAudioId = project.sourceAudioId;
      let activeAudioFilePath = null;

      if (project.narrationSource === 'tts' && !activeAudioId) {
        job.stage = 'GENERATING_TTS';
        job.progressPct = 10;
        emitUpdate(job, `Synthesizing Gemini TTS narration (voice=${project.voiceId})...`);
        const ttsRes = await ttsService.generateNarration({
          projectId: project.projectId,
          scriptText: project.scriptText,
          voice: project.voiceId,
          model: project.ttsModel || undefined,
          signal,
        });
        if (!ttsRes.ok) {
          const err = new Error(ttsRes.error || 'Gemini TTS failed.');
          err.code = ttsRes.reasonCategory?.toUpperCase() || 'TTS_FAILED';
          err.blocked = Boolean(ttsRes.blocked);
          throw err;
        }
        projectStore.attachAudioArtifact(project.projectId, ttsRes.artifact, { sourceType: 'tts' });
        activeAudioId = ttsRes.artifact.audioId;
      }

      if (!activeAudioId) {
        const err = new Error(
          'NO_VOICEOVER_AUDIO: Generate Gemini TTS narration or import a real WAV/MP3/M4A voiceover before rendering.'
        );
        err.code = 'NO_VOICEOVER_AUDIO';
        err.blocked = true;
        throw err;
      }

      const resolvedAudio = mediaStore.resolveAudioArtifact(project.projectId, activeAudioId, {
        preferNormalized: true,
      });
      activeAudioFilePath = resolvedAudio.filePath;
      checkAbort();

      // Stage: PROBING_AUDIO
      job.stage = 'PROBING_AUDIO';
      job.progressPct = 14;
      emitUpdate(job, `Probing audio artifact ${activeAudioId} via FFprobe...`);
      const audioProbe = probeAudioFile(activeAudioFilePath);
      job.audioMeta = {
        audioId: activeAudioId,
        provider: resolvedAudio.meta.provider,
        durationSec: audioProbe.durationSec,
        sampleRate: audioProbe.sampleRate,
        channels: audioProbe.channels,
      };
      checkAbort();

      // Stage: ALIGNING
      job.stage = 'ALIGNING';
      job.progressPct = 18;
      emitUpdate(job, 'Running FFprobe + timing_validator.py alignment...');
      const frameCount = Number(options.frameLimit || project.totalFrames || 300);
      job.frameCount = frameCount;
      const expectedSec = frameCount / 30;
      const timing = await prepareTiming({
        projectRoot,
        projectId: project.projectId,
        audioId: activeAudioId,
        audioPath: activeAudioFilePath,
        scriptText: project.scriptText || project.title,
        expectedFrames: frameCount,
        expectedDurationSec: expectedSec,
        maxOverflowSec: options.allowShortFrameTest ? 180 : 0.35,
      });
      if (timing.overflow && !options.allowShortFrameTest) {
        const err = new Error(
          `AUDIO_DURATION_OVERFLOW: Audio (${timing.audioDurationSec}s) exceeds ${frameCount} frames (${expectedSec.toFixed(2)}s). Edit script or pacing before rendering.`
        );
        err.code = 'AUDIO_DURATION_OVERFLOW';
        throw err;
      }
      projectStore.updateProjectInternal(project.projectId, (p) => ({ ...p, latestTiming: timing }));
      checkAbort();

      // Stage: RENDERING_FRAMES overlapped with independent MIXING & ASS subtitle preparation via Promise.all!
      job.stage = 'RENDERING_FRAMES';
      job.progressPct = 22;
      emitUpdate(
        job,
        `Rendering ${frameCount} native 1080×1920 frames in bounded parallel chunks while overlapping audio mastering & ASS prep...`
      );

      const mixedWavPath = path.join(tempDir, 'mixed_48k.wav');
      const customStemsPy = path.join(projectsRoot, project.storyId, 'src', 'audio_stems.py');
      const mixPy = path.join(projectRoot, 'tools', 'audio', 'mix.py');
      const curatedCuesCandidate = path.join(projectsRoot, project.storyId, 'src', 'subtitles.json');

      const renderTask = (async () => {
        const session = new ShortRendererSession();
        try {
          await session.initialize({ projectId: project.storyId });
          return await session.renderFrameRange(0, frameCount - 1, {
            outputDir: framesDir,
            quality: Number(options.quality || 0.94),
            resume: true,
            parallel: true,
            workers: options.workers,
            signal,
            onProgress: ({ completed, total }) => {
              job.framesDone = completed;
              job.progressPct = Math.min(78, 22 + Math.round((completed / Math.max(1, total)) * 56));
              if (completed === total || completed % 30 === 0) {
                emitUpdate(job, `Rendered ${completed}/${total} frames`);
              }
            },
          });
        } finally {
          await session.dispose();
        }
      })();

      const mixTask = (async () => {
        if (fs.existsSync(customStemsPy)) {
          const { stdout } = await spawnWithAbort(
            'python3',
            [customStemsPy, '--voice', activeAudioFilePath, '--duration', expectedSec.toFixed(4), '--out-wav', mixedWavPath],
            { cwd: projectRoot, signal, timeoutMs: 120_000 }
          );
          return JSON.parse(stdout);
        }
        const { stdout } = await spawnWithAbort(
          'python3',
          [mixPy, '--voice', activeAudioFilePath, '--out', mixedWavPath, '--duration', expectedSec.toFixed(4)],
          { cwd: projectRoot, signal, timeoutMs: 120_000 }
        );
        return JSON.parse(stdout);
      })();

      const subPrepTask = prepareSubtitles({
        projectRoot,
        enabled: Boolean(project.captionsEnabled),
        aspectRatio: project.aspectRatio,
        title: project.title,
        words: timing.words,
        curatedCuesPath:
          !options.allowShortFrameTest && fs.existsSync(curatedCuesCandidate) ? curatedCuesCandidate : null,
        punchWords: project.punchWords,
        outDir: tempDir,
      });

      const [renderManifest, audioMixReport, preparedSubInfo] = await Promise.all([
        renderTask,
        mixTask,
        subPrepTask,
      ]);
      fs.writeFileSync(path.join(jobDir, 'frames-manifest.json'), JSON.stringify(renderManifest, null, 2), 'utf8');
      job.stage = 'MIXING';
      job.progressPct = 82;
      emitUpdate(
        job,
        `Overlapped render (${renderManifest.workersUsed || 1} workers, ${renderManifest.msPerFrame} ms/f) + linear -6 dB audio mix complete.`
      );
      checkAbort();

      // Stage: MUXING
      job.stage = 'MUXING';
      job.progressPct = 85;
      emitUpdate(job, 'Muxing H.264 yuv420p 1080×1920 @ 30fps + AAC 48kHz stereo MP4 (+faststart)...');

      const unsubbedMp4Path = path.join(tempDir, 'video_unsubbed.mp4');
      await muxFramesAndAudioAsync({
        framesDir,
        audioWavPath: mixedWavPath,
        outputMp4Path: unsubbedMp4Path,
        expectedFrameCount: frameCount,
        preset: options.preset || 'medium',
        crf: Number(options.crf || 18),
        strictDurationGuard: !options.allowShortFrameTest,
        signal,
      });
      checkAbort();

      // Stage: SUBTITLES
      let finalMp4Path = path.join(finalDir, `${project.projectId}-${job.jobId}.mp4`);
      let subtitleInfo = preparedSubInfo;

      if (project.captionsEnabled) {
        job.stage = 'SUBTITLES';
        job.progressPct = 90;
        emitUpdate(job, 'Burning Cartoon subtitles via tools/subtitles/cartoon_subs.py (-c:a copy)...');
        const burnRes = await burnSubtitlesOntoMp4({
          projectRoot,
          cuesPath: subtitleInfo.cuesPath,
          assPath: subtitleInfo.assPath,
          inputMp4: unsubbedMp4Path,
          outputMp4: finalMp4Path,
        });
        subtitleInfo = { ...subtitleInfo, ...burnRes };
      } else {
        job.stage = 'SUBTITLES';
        job.progressPct = 90;
        emitUpdate(job, 'Subtitles OFF — preserving clean unsubtitled MP4...');
        fs.copyFileSync(unsubbedMp4Path, finalMp4Path);
      }
      checkAbort();

      // Stage: VERIFYING (async parallel FFprobe + contact sheets + pixel-diff!)
      job.stage = 'VERIFYING';
      job.progressPct = 95;
      emitUpdate(job, 'Running parallel FFprobe, contact sheets, and Q06–Q18 verification...');
      const qaReport = await verifyRenderJob({
        projectRoot,
        project,
        job,
        mp4Path: finalMp4Path,
        unsubbedMp4Path: project.captionsEnabled ? unsubbedMp4Path : null,
        framesDir,
        framesManifest: renderManifest,
        timing,
        audioMixReport,
        subtitleInfo,
        qaDir,
      });

      if (qaReport.overallStatus !== 'PASS') {
        const failedIds = qaReport.gates.filter((g) => g.status === 'FAIL').map((g) => g.id);
        const err = new Error(`QA_VERIFICATION_FAILED: Mandatory gates failed (${failedIds.join(', ')})`);
        err.code = 'QA_VERIFICATION_FAILED';
        job.qaReportPath = path.join(qaDir, 'qa-report.json');
        throw err;
      }

      // Publish verified export ONLY after QA PASS
      const exportId = `exp-${job.jobId}`;
      const exportMeta = {
        exportId,
        jobId: job.jobId,
        projectId: project.projectId,
        inputSpecHash: job.inputSpecHash,
        mp4Path: finalMp4Path,
        unsubbedMp4Path,
        sha256: sha256File(finalMp4Path),
        byteSize: fs.statSync(finalMp4Path).size,
        durationSec: qaReport.mp4Probe.durationSec,
        fps: 30,
        width: qaReport.mp4Probe.video.width,
        height: qaReport.mp4Probe.video.height,
        frameCount: qaReport.mp4Probe.video.nbFrames,
        captionsEnabled: Boolean(project.captionsEnabled),
        aspectRatio: project.aspectRatio,
        qaStatus: qaReport.overallStatus,
        qaReportPath: path.join(qaDir, 'qa-report.json'),
        contactSheetPath: qaReport.contactSheet.outputPath,
        subCheckPath: qaReport.subCheck.outputPath,
        downloadUrl: `/api/projects/${encodeURIComponent(project.projectId)}/exports/${encodeURIComponent(exportId)}/download`,
        qaUrl: `/api/projects/${encodeURIComponent(project.projectId)}/exports/${encodeURIComponent(exportId)}/qa`,
        contactSheetUrl: `/api/projects/${encodeURIComponent(project.projectId)}/exports/${encodeURIComponent(exportId)}/contact-sheet`,
        subCheckUrl: `/api/projects/${encodeURIComponent(project.projectId)}/exports/${encodeURIComponent(exportId)}/sub-check`,
        createdAt: new Date().toISOString(),
      };

      projectStore.updateProjectInternal(project.projectId, (p) => ({
        ...p,
        exports: [exportMeta, ...(p.exports || []).filter((e) => e.exportId !== exportId)].slice(0, 20),
        renderJobs: [
          {
            jobId: job.jobId,
            status: 'COMPLETED',
            stage: 'COMPLETED',
            exportId,
            startedAt: job.startedAt,
            completedAt: new Date().toISOString(),
          },
          ...(p.renderJobs || []).filter((r) => r.jobId !== job.jobId),
        ].slice(0, 20),
      }));

      job.stage = 'COMPLETED';
      job.status = 'COMPLETED';
      job.progressPct = 100;
      job.exportId = exportId;
      job.exportMeta = exportMeta;
      job.qaReportPath = exportMeta.qaReportPath;
      job.completedAt = new Date().toISOString();
      emitUpdate(job, `Export verified and published (${exportId}, ${exportMeta.byteSize} bytes).`);
    } catch (err) {
      const canceled = signal.aborted || err?.message === 'JOB_CANCELED' || err?.message?.includes('RENDER_CANCELED');
      if (canceled) {
        job.stage = 'CANCELED';
        job.status = 'CANCELED';
        job.error = 'Render job canceled.';
        // Remove any partial final MP4 on cancel
        try {
          fs.rmSync(finalDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      } else if (err?.blocked) {
        job.stage = 'BLOCKED';
        job.status = 'BLOCKED';
        job.error = err.message;
        job.errorCode = err.code || 'BLOCKED';
      } else {
        job.stage = 'FAILED';
        job.status = 'FAILED';
        job.error = err?.message || String(err);
        job.errorCode = err?.code || 'RENDER_FAILED';
      }
      job.completedAt = new Date().toISOString();
      emitUpdate(job, job.error);
      try {
        projectStore.updateProjectInternal(job.projectId, (p) => ({
          ...p,
          renderJobs: [
            {
              jobId: job.jobId,
              status: job.status,
              stage: job.stage,
              error: job.error,
              startedAt: job.startedAt,
              completedAt: job.completedAt,
            },
            ...(p.renderJobs || []).filter((r) => r.jobId !== job.jobId),
          ].slice(0, 20),
        }));
      } catch {
        // ignore if project deleted
      }
    } finally {
      activeProjectJobs.delete(job.projectId);
      controllers.delete(job.jobId);
    }
  }

  /**
   * Starts a new isolated asynchronous render job for a project. Rejects double-submit with 409.
   */
  function startProjectRender({ projectId, options = {} }) {
    const project = projectStore.getProject(projectId);
    const existingJobId = activeProjectJobs.get(project.projectId);
    if (existingJobId) {
      const err = new Error(`JOB_ALREADY_RUNNING: Render job "${existingJobId}" is already active for "${project.projectId}".`);
      err.code = 'JOB_ALREADY_RUNNING';
      err.statusCode = 409;
      err.activeJobId = existingJobId;
      throw err;
    }

    const jobId = `job-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const job = {
      jobId,
      projectId: project.projectId,
      storyId: project.storyId,
      inputSpecHash: project.inputSpecHash,
      stage: 'QUEUED',
      status: 'QUEUED',
      progressPct: 0,
      frameCount: Number(options.frameLimit || project.totalFrames || 300),
      framesDone: 0,
      captionsEnabled: Boolean(project.captionsEnabled),
      aspectRatio: project.aspectRatio,
      exportId: null,
      exportMeta: null,
      error: null,
      errorCode: null,
      logs: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };

    const ctrl = new AbortController();
    jobs.set(jobId, job);
    activeProjectJobs.set(project.projectId, jobId);
    controllers.set(jobId, ctrl);
    emitUpdate(job, 'Render job queued.');

    // Launch asynchronously without blocking HTTP response
    setImmediate(() => {
      executeJob(job, options);
    });

    return job;
  }

  function resolveExport(projectId, exportId) {
    const project = projectStore.getProject(projectId);
    const safeExp = validateSafeId(exportId, 'exportId');
    const hit = (project.exports || []).find((e) => e.exportId === safeExp);
    if (!hit) {
      const err = new Error(`EXPORT_NOT_FOUND: Export "${safeExp}" not found for project "${project.projectId}".`);
      err.code = 'EXPORT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    return hit;
  }

  return {
    recoverStaleJobsOnStartup,
    startProjectRender,
    getJob,
    listJobs,
    cancelJob,
    subscribe,
    resolveExport,
  };
}
