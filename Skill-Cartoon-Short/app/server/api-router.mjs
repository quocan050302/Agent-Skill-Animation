/**
 * Security-First Loopback REST & SSE API Router for Cartoon Short Studio (QA-TTS-01 Section 08)
 *
 * Security controls:
 * - Loopback Host/Origin validation (prevents DNS rebinding & cross-site CSRF)
 * - No wildcard CORS, no eval, no shell interpolation, strict JSON size caps
 * - Redacted secrets in every response and error payload
 * - Full coverage for Projects, Voice/TTS, Audio Import, Timing, Preview, Subtitles, Jobs (SSE), QA & Export
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkFreeDiskMb, loadSourceManifest, PROJECT_ROOT, verifyVendorSnapshot } from '../../tools/setup/hydrate.mjs';
import {
  ASPECT_RATIOS,
  CAPTION_STYLES,
  GEMINI_PREBUILT_VOICES,
  JOB_STAGES,
  STUDIO_FORMAT_LOCK,
  UI_CAPABILITY_MATRIX,
  validateSafeId,
} from '../shared/contract.mjs';
import { ShortRendererSession } from '../../engine/adapters/renderer-adapter.mjs';
import { MAX_UPLOAD_BYTES } from './services/media-store.mjs';
import { buildCuesSpecFromWords, checkLibassAvailable, getSubtitleCueAtTime } from './services/subtitle-service.mjs';
import { prepareTiming } from './services/timing-service.mjs';

const MAX_JSON_BODY_BYTES = 512 * 1024; // 512 KiB

function isAllowedLoopbackHost(hostHeader) {
  if (!hostHeader) return true;
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(hostHeader).trim());
}

function isAllowedLoopbackOrigin(originHeader) {
  if (!originHeader) return true;
  try {
    const u = new URL(originHeader);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1')
    );
  } catch {
    return false;
  }
}

export function securityHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(payload));
}

function sendError(res, err, traceId) {
  const status = Number(err?.statusCode || err?.status || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  sendJson(res, safeStatus, {
    ok: false,
    code: err?.code || 'INTERNAL_ERROR',
    error: String(err?.message || err || 'Internal server error'),
    ...(err?.activeJobId ? { activeJobId: err.activeJobId } : {}),
    traceId,
  });
}

function readBoundedBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      const err = new Error(`PAYLOAD_TOO_LARGE: Content-Length (${declared}) exceeds limit (${maxBytes} bytes).`);
      err.code = 'PAYLOAD_TOO_LARGE';
      err.statusCode = 413;
      return reject(err);
    }
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error(`PAYLOAD_TOO_LARGE: Stream exceeded ${maxBytes} bytes.`);
        err.code = 'PAYLOAD_TOO_LARGE';
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBoundedBuffer(req, MAX_JSON_BODY_BYTES);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    const err = new Error('INVALID_JSON_BODY: Request body must be valid JSON.');
    err.code = 'INVALID_JSON_BODY';
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Extracts a single uploaded file from `multipart/form-data` without external dependencies.
 */
function parseMultipartSingleFile(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType || '');
  if (!m) {
    const err = new Error('INVALID_MULTIPART: Missing boundary header.');
    err.code = 'INVALID_MULTIPART';
    err.statusCode = 400;
    throw err;
  }
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const headerSep = Buffer.from('\r\n\r\n');
  let pos = buf.indexOf(boundary);
  while (pos >= 0) {
    const partStart = pos + boundary.length + 2; // skip \r\n
    if (partStart >= buf.length) break;
    const nextPos = buf.indexOf(boundary, partStart);
    if (nextPos < 0) break;
    const part = buf.subarray(partStart, nextPos - 2); // trim trailing \r\n
    const sepIdx = part.indexOf(headerSep);
    if (sepIdx >= 0) {
      const headersStr = part.subarray(0, sepIdx).toString('utf8');
      if (/name="file"|filename="/i.test(headersStr)) {
        const fnMatch = /filename="([^"]+)"/i.exec(headersStr);
        return {
          filename: fnMatch ? fnMatch[1] : 'voiceover.wav',
          bytes: part.subarray(sepIdx + 4),
        };
      }
    }
    pos = nextPos;
  }
  const err = new Error('MISSING_UPLOAD_FILE: Multipart payload did not include a file part.');
  err.code = 'MISSING_UPLOAD_FILE';
  err.statusCode = 400;
  throw err;
}

/**
 * Creates the Studio API request handler.
 */
export function createApiRouter({
  projectRoot = PROJECT_ROOT,
  projectStore,
  mediaStore,
  ttsService,
  jobManager,
  listHydratedProjects,
}) {
  // Single bounded preview cache for GET /api/projects/:id/preview?frame=N
  let previewSession = null;
  let previewStoryId = null;
  let previewLock = Promise.resolve();

  async function renderPreviewStill(storyId, frameIndex) {
    const safeStory = validateSafeId(storyId, 'storyId');
    const cacheDir = path.join(projectRoot, 'workspace', 'cache', 'studio-previews', safeStory);
    const cacheFile = path.join(cacheDir, `f${String(frameIndex).padStart(4, '0')}.jpg`);
    if (fs.existsSync(cacheFile)) {
      return fs.readFileSync(cacheFile);
    }

    let resultBuf;
    previewLock = previewLock.then(async () => {
      if (fs.existsSync(cacheFile)) {
        resultBuf = fs.readFileSync(cacheFile);
        return;
      }
      if (!previewSession || previewStoryId !== safeStory) {
        if (previewSession) {
          await previewSession.dispose();
          previewSession = null;
          previewStoryId = null;
        }
        const s = new ShortRendererSession();
        await s.initialize({ projectId: safeStory });
        previewSession = s;
        previewStoryId = safeStory;
      }
      const still = await previewSession.renderStill(frameIndex, { quality: 0.88 });
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, still.buffer);
      resultBuf = still.buffer;
    });
    await previewLock;
    return resultBuf;
  }

  async function dispose() {
    if (previewSession) {
      await previewSession.dispose();
      previewSession = null;
      previewStoryId = null;
    }
  }

  async function handleApiRequest(req, res, urlObj) {
    const traceId = crypto.randomBytes(4).toString('hex');
    const method = (req.method || 'GET').toUpperCase();
    const pathname = urlObj.pathname;

    // Loopback Host & Origin validation
    if (!isAllowedLoopbackHost(req.headers.host)) {
      return sendJson(res, 403, { ok: false, code: 'FORBIDDEN_HOST', error: 'Loopback Host required.', traceId });
    }
    if (!isAllowedLoopbackOrigin(req.headers.origin)) {
      return sendJson(res, 403, { ok: false, code: 'FORBIDDEN_ORIGIN', error: 'Loopback Origin required.', traceId });
    }

    try {
      // 1. Health & Contract
      if (method === 'GET' && pathname === '/api/health') {
        const ttsSettings = ttsService.getSettings();
        const libassAvailable = await checkLibassAvailable();
        let freeDiskMb = 0;
        try {
          freeDiskMb = checkFreeDiskMb(projectRoot, 1);
        } catch {
          freeDiskMb = 0;
        }
        let kitReady = false;
        try {
          const manifest = loadSourceManifest();
          const check = verifyVendorSnapshot({
            vendorKitDir: path.join(projectRoot, 'vendor', 'cartoon-short-kit'),
            manifest,
          });
          kitReady = check.allMatched;
        } catch {
          kitReady = false;
        }
        return sendJson(res, 200, {
          ok: true,
          format: STUDIO_FORMAT_LOCK,
          nodeVersion: process.version,
          freeDiskMb,
          kitReady,
          g03RedistributionStatus: 'BLOCKED',
          ffmpegLibassAvailable: libassAvailable,
          tts: {
            provider: 'gemini',
            hasKey: ttsSettings.hasKey,
            keySource: ttsSettings.keySource,
            maskedKey: ttsSettings.maskedKey,
            defaultVoice: ttsSettings.defaultVoice,
            status: ttsSettings.hasKey ? 'KEY_CONFIGURED' : 'BLOCKED_NO_API_KEY',
          },
        });
      }

      if (method === 'GET' && pathname === '/api/contract') {
        return sendJson(res, 200, {
          format: STUDIO_FORMAT_LOCK,
          projects: listHydratedProjects(),
          capabilities: UI_CAPABILITY_MATRIX,
          aspectRatios: Object.values(ASPECT_RATIOS),
          voices: GEMINI_PREBUILT_VOICES,
          captionStyles: Object.values(CAPTION_STYLES),
          jobStages: JOB_STAGES,
        });
      }

      // 2. Projects CRUD
      if (method === 'GET' && pathname === '/api/projects') {
        return sendJson(res, 200, { ok: true, projects: projectStore.listProjects() });
      }
      if (method === 'POST' && pathname === '/api/projects') {
        const body = await readJsonBody(req);
        const created = projectStore.createProject(body);
        return sendJson(res, 201, { ok: true, project: created });
      }

      // 3. TTS Global Endpoints
      if (method === 'GET' && pathname === '/api/tts/voices') {
        return sendJson(res, 200, { ok: true, ...ttsService.listVoices() });
      }
      if (method === 'GET' && pathname === '/api/tts/models') {
        const forceRefresh = urlObj.searchParams.get('refresh') === '1';
        const data = await ttsService.discoverModels({ forceRefresh });
        return sendJson(res, data.ok ? 200 : data.blocked ? 503 : 502, data);
      }
      if (method === 'GET' && pathname === '/api/tts/settings') {
        return sendJson(res, 200, { ok: true, settings: ttsService.getSettings() });
      }
      if (method === 'PATCH' && pathname === '/api/tts/settings') {
        const body = await readJsonBody(req);
        const saved = await ttsService.saveSettings(body);
        return sendJson(res, 200, saved);
      }
      if (method === 'POST' && pathname === '/api/tts/preview') {
        const body = await readJsonBody(req);
        const ac = new AbortController();
        req.on('close', () => {
          if (!res.writableEnded) ac.abort();
        });
        const out = await ttsService.generateVoicePreview({
          projectId: body.projectId || 'preview-sandbox',
          text: body.text,
          voice: body.voice,
          model: body.model,
          signal: ac.signal,
        });
        if (!out.ok) {
          return sendJson(res, out.blocked ? 503 : 502, { ...out, traceId });
        }
        return sendJson(res, 200, out);
      }

      // 4. Jobs Global Endpoints
      if (method === 'GET' && pathname === '/api/jobs') {
        const pid = urlObj.searchParams.get('projectId') || null;
        return sendJson(res, 200, { ok: true, jobs: jobManager.listJobs(pid) });
      }

      const jobMatch = /^\/api\/jobs\/([^/]+)(?:\/(cancel|events))?$/.exec(pathname);
      if (jobMatch) {
        const jobId = decodeURIComponent(jobMatch[1]);
        const sub = jobMatch[2] || '';
        if (method === 'GET' && !sub) {
          return sendJson(res, 200, { ok: true, job: jobManager.getJob(jobId) });
        }
        if (method === 'POST' && sub === 'cancel') {
          return sendJson(res, 200, { ok: true, job: jobManager.cancelJob(jobId) });
        }
        if (method === 'GET' && sub === 'events') {
          const initial = jobManager.getJob(jobId);
          res.writeHead(
            200,
            securityHeaders({
              'Content-Type': 'text/event-stream; charset=utf-8',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            })
          );
          res.write(`data: ${JSON.stringify(initial)}\n\n`);
          const unsub = jobManager.subscribe(jobId, (update) => {
            res.write(`data: ${JSON.stringify(update)}\n\n`);
          });
          const hb = setInterval(() => {
            res.write(': heartbeat\n\n');
          }, 15_000);
          req.on('close', () => {
            clearInterval(hb);
            unsub();
          });
          return;
        }
      }

      // 5. Project-Scoped Endpoints
      const projMatch = /^\/api\/projects\/([^/]+)(?:\/(.+))?$/.exec(pathname);
      if (projMatch) {
        const projectId = decodeURIComponent(projMatch[1]);
        const tail = projMatch[2] || '';

        if (!tail) {
          if (method === 'GET') return sendJson(res, 200, { ok: true, project: projectStore.getProject(projectId) });
          if (method === 'PATCH') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, { ok: true, project: projectStore.updateProject(projectId, body) });
          }
          if (method === 'DELETE') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, { ok: true, ...projectStore.deleteProject(projectId, body) });
          }
        }

        if (method === 'POST' && tail === 'duplicate') {
          const body = await readJsonBody(req);
          return sendJson(res, 201, { ok: true, project: projectStore.duplicateProject(projectId, body) });
        }

        if (method === 'POST' && tail === 'tts') {
          const project = projectStore.getProject(projectId);
          const body = await readJsonBody(req);
          const ac = new AbortController();
          req.on('close', () => {
            if (!res.writableEnded) ac.abort();
          });
          const out = await ttsService.generateNarration({
            projectId: project.projectId,
            scriptText: body.scriptText !== undefined ? body.scriptText : project.scriptText,
            voice: body.voice || project.voiceId,
            model: body.model || project.ttsModel || undefined,
            signal: ac.signal,
          });
          if (!out.ok) {
            return sendJson(res, out.blocked ? 503 : 502, { ...out, traceId });
          }
          const updated = projectStore.attachAudioArtifact(project.projectId, out.artifact, { sourceType: 'tts' });
          return sendJson(res, 200, { ok: true, artifact: out.artifact, project: updated, attemptedModels: out.attemptedModels });
        }

        if (method === 'POST' && tail === 'import-audio') {
          const project = projectStore.getProject(projectId);
          const ct = String(req.headers['content-type'] || '').toLowerCase();
          const rawBuf = await readBoundedBuffer(req, MAX_UPLOAD_BYTES + 65536);
          let filename = String(req.headers['x-filename'] || 'voiceover.wav');
          let bytes = rawBuf;
          if (ct.includes('multipart/form-data')) {
            const parsed = parseMultipartSingleFile(rawBuf, ct);
            filename = parsed.filename;
            bytes = parsed.bytes;
          }
          const artifact = mediaStore.importVoiceover({
            projectId: project.projectId,
            originalFilename: filename,
            bytes,
          });
          const updated = projectStore.attachAudioArtifact(project.projectId, artifact, { sourceType: 'import' });
          return sendJson(res, 201, { ok: true, artifact, project: updated });
        }

        const audioMatch = /^audio\/([^/]+)$/.exec(tail);
        if (method === 'GET' && audioMatch) {
          const audioId = decodeURIComponent(audioMatch[1]);
          const { meta, filePath } = mediaStore.resolveAudioArtifact(projectId, audioId);
          return mediaStore.streamMediaFile(req, res, filePath, meta.mimeType || 'audio/wav');
        }

        if (tail === 'timing') {
          const project = projectStore.getProject(projectId);
          if (method === 'GET') {
            return sendJson(res, 200, { ok: true, timing: project.latestTiming || null });
          }
          if (method === 'POST') {
            if (!project.sourceAudioId) {
              const err = new Error('NO_AUDIO_FOR_TIMING: Generate TTS or import voiceover audio before running timing.');
              err.code = 'NO_AUDIO_FOR_TIMING';
              err.statusCode = 400;
              throw err;
            }
            const { filePath } = mediaStore.resolveAudioArtifact(project.projectId, project.sourceAudioId, {
              preferNormalized: true,
            });
            const timing = await prepareTiming({
              projectRoot,
              projectId: project.projectId,
              audioId: project.sourceAudioId,
              audioPath: filePath,
              scriptText: project.scriptText,
              expectedFrames: project.totalFrames,
              expectedDurationSec: project.expectedDurationSec,
            });
            const updated = projectStore.updateProjectInternal(project.projectId, (p) => ({
              ...p,
              latestTiming: timing,
            }));
            return sendJson(res, 200, { ok: true, timing, project: updated });
          }
        }

        if (method === 'GET' && tail === 'preview') {
          const project = projectStore.getProject(projectId);
          if (!project.engineReady) {
            const err = new Error(`ENGINE_NOT_HYDRATED: Story "${project.storyId}" is not hydrated.`);
            err.code = 'ENGINE_NOT_HYDRATED';
            err.statusCode = 503;
            throw err;
          }
          const rawF = Number.parseInt(urlObj.searchParams.get('frame') || '0', 10);
          const frameIndex = Math.max(0, Math.min(project.totalFrames - 1, Number.isFinite(rawF) ? rawF : 0));
          const jpg = await renderPreviewStill(project.storyId, frameIndex);
          res.writeHead(200, securityHeaders({ 'Content-Type': 'image/jpeg', 'Content-Length': String(jpg.length) }));
          res.end(jpg);
          return;
        }

        if (method === 'GET' && tail === 'subtitles-preview') {
          const project = projectStore.getProject(projectId);
          const timeSec = Math.max(0, Number.parseFloat(urlObj.searchParams.get('time') || '0') || 0);
          if (!project.captionsEnabled) {
            return sendJson(res, 200, { ok: true, captionsEnabled: false, cue: { active: false, words: [] } });
          }
          let cuesSpec = null;
          const curatedPath = path.join(projectRoot, 'workspace', 'projects', project.storyId, 'src', 'subtitles.json');
          if (project.latestTiming?.words?.length > 0) {
            cuesSpec = buildCuesSpecFromWords({
              title: project.title,
              words: project.latestTiming.words,
              punchWords: project.punchWords,
            });
          } else if (fs.existsSync(curatedPath)) {
            cuesSpec = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
          } else {
            // Synthesize evenly distributed preview cues from scriptText so Step 3 overlay always reflects script before timing
            const tokens = String(project.scriptText || '').trim().split(/\s+/).filter(Boolean);
            const dur = Math.max(1, project.expectedDurationSec || 10);
            const step = dur / Math.max(1, tokens.length);
            const approxWords = tokens.map((w, i) => ({ w, s: i * step, e: (i + 1) * step }));
            cuesSpec = buildCuesSpecFromWords({
              title: project.title,
              words: approxWords,
              punchWords: project.punchWords,
            });
          }
          const cue = getSubtitleCueAtTime(cuesSpec, timeSec);
          return sendJson(res, 200, {
            ok: true,
            captionsEnabled: true,
            timeSec,
            cue,
            source: project.latestTiming?.words?.length ? 'aligned-timing' : fs.existsSync(curatedPath) ? 'curated-story' : 'script-estimate',
          });
        }

        if (method === 'POST' && tail === 'render') {
          const body = await readJsonBody(req);
          const job = jobManager.startProjectRender({
            projectId,
            options: {
              preset: body.preset || 'medium',
              crf: body.crf || 18,
              quality: body.quality || 0.94,
              ...(body.frameLimit ? { frameLimit: Number(body.frameLimit), allowShortFrameTest: true } : {}),
            },
          });
          return sendJson(res, 202, { ok: true, job });
        }

        const expMatch = /^exports\/([^/]+)(?:\/(qa|download|contact-sheet|sub-check))?$/.exec(tail);
        if (method === 'GET' && expMatch) {
          const exportId = decodeURIComponent(expMatch[1]);
          const action = expMatch[2] || '';
          const exp = jobManager.resolveExport(projectId, exportId);
          if (!action) {
            return sendJson(res, 200, { ok: true, export: exp });
          }
          if (action === 'qa') {
            const qaJson = JSON.parse(fs.readFileSync(exp.qaReportPath, 'utf8'));
            return sendJson(res, 200, { ok: true, qa: qaJson });
          }
          if (action === 'download') {
            if (urlObj.searchParams.get('attachment') === '1') {
              res.setHeader('Content-Disposition', `attachment; filename="${exp.projectId}-${exp.exportId}.mp4"`);
            }
            return mediaStore.streamMediaFile(req, res, exp.mp4Path, 'video/mp4');
          }
          if (action === 'contact-sheet') {
            return mediaStore.streamMediaFile(req, res, exp.contactSheetPath, 'image/jpeg');
          }
          if (action === 'sub-check') {
            return mediaStore.streamMediaFile(req, res, exp.subCheckPath, 'image/jpeg');
          }
        }
      }

      return sendJson(res, 404, { ok: false, code: 'ROUTE_NOT_FOUND', error: `Unknown API route ${method} ${pathname}`, traceId });
    } catch (err) {
      return sendError(res, err, traceId);
    }
  }

  return { handleApiRequest, dispose };
}
