import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import {
  AssetBriefInputSchema,
  AssetRoleSchema,
  CreateProjectInputSchema,
  PatchProjectInputSchema,
  RatioSchema,
} from '@b6-studio/shared';
import {
  ALLOWED_ORIGINS,
  APP_ROOT,
  CACHE_DIR,
  JOBS_DIR,
  MAX_UPLOAD_BYTES,
  PROJECTS_DIR,
  TEMP_DIR,
} from './config.js';
import { ensureDirectories, readJsonFile, resolveInsideRoot } from './utils/fs-safe.js';
import { EnvDoctorService } from './services/env-doctor-service.js';
import { UpstreamService } from './services/upstream-service.js';
import { ProjectService } from './services/project-service.js';
import { ScriptTimelineService } from './services/script-timeline-service.js';
import { AssetService } from './services/asset-service.js';
import { CharacterBindingService } from './services/character-binding-service.js';
import { B6CommandAdapter } from './services/b6-command-adapter.js';
import { JobQueue } from './services/job-queue.js';
import { MediaService } from './services/media-service.js';
import { ReviewService } from './services/review-service.js';
import { OutputService } from './services/output-service.js';
import { QaEvidenceResolver } from './services/qa-evidence-service.js';
import { EditorBindingService } from './services/editor-binding-service.js';

export interface ServerDependencies {
  projectsDir?: string;
  jobsDir?: string;
}

export async function buildApp(deps: ServerDependencies = {}): Promise<{
  app: FastifyInstance;
  jobQueue: JobQueue;
  projectService: ProjectService;
}> {
  const projectsDir = deps.projectsDir ?? PROJECTS_DIR;
  const jobsDir = deps.jobsDir ?? JOBS_DIR;
  ensureDirectories([projectsDir, jobsDir, CACHE_DIR, TEMP_DIR]);

  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.has(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Origin not allowed by localhost policy'), false);
      }
    },
    credentials: false,
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
    },
  });

  const qaResolver = new QaEvidenceResolver();
  const editorBindingService = new EditorBindingService();
  const doctorService = new EnvDoctorService();
  const upstreamService = new UpstreamService();
  const projectService = new ProjectService(projectsDir);
  const timelineService = new ScriptTimelineService(projectService, editorBindingService, qaResolver);
  const assetService = new AssetService(projectService, qaResolver);
  const characterService = new CharacterBindingService(projectService, qaResolver);
  const commandAdapter = new B6CommandAdapter();
  const jobQueue = new JobQueue(jobsDir, projectsDir, qaResolver);
  app.addHook('onClose', async () => {
    await jobQueue.shutdown();
  });
  const mediaService = new MediaService(projectService);
  const reviewService = new ReviewService(projectService, qaResolver);
  const outputService = new OutputService(projectService, qaResolver);

  app.setErrorHandler((err, _req, reply) => {
    const message = err instanceof Error ? err.message : 'Lỗi không xác định';
    const explicitCode = (err as { statusCode?: number }).statusCode;
    const statusCode =
      typeof explicitCode === 'number' && explicitCode >= 400
        ? explicitCode
        : message.includes('Không tìm thấy')
        ? 404
        : message.includes('không hợp lệ') || message.includes('bị chặn') || message.includes('Bị chặn') || message.includes('Zod')
        ? 400
        : 400;
    reply.code(statusCode).send({ error: message });
  });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'b6-local-studio',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/doctor', async () => doctorService.getReport());
  app.get('/api/upstream', async () => upstreamService.getInfo());

  // Projects
  app.get('/api/projects', async () => {
    const projects = await projectService.listProjects();
    const allJobs = await jobQueue.listJobs();
    for (const p of projects) {
      const latest = allJobs.find((j) => j.projectId === p.id);
      if (latest) {
        p.lastJob = {
          id: latest.id,
          kind: latest.kind,
          status: latest.status,
          updatedAt: latest.completedAt ?? latest.startedAt ?? latest.createdAt,
        };
      }
    }
    return { projects };
  });

  app.post('/api/projects', async (req) => {
    const input = CreateProjectInputSchema.parse(req.body);
    const project = await projectService.createProject(input);
    return { project };
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const project = await projectService.getProject(id);
    return { project };
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const patch = PatchProjectInputSchema.parse(req.body);
    const res = await timelineService.patchProject(id, patch);
    return res;
  });

  app.put('/api/projects/:id/scene', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ content: z.string().min(1) }).parse(req.body);
    const res = await timelineService.saveScenePy(id, body.content);
    return res;
  });

  app.post('/api/projects/:id/duplicate', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ title: z.string().min(1).max(120).optional() }).parse(req.body ?? {});
    const project = await projectService.duplicateProject(id, body.title);
    return { project };
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    return projectService.deleteProject(id);
  });

  // Assets
  app.get('/api/projects/:id/assets', async (req) => {
    const { id } = req.params as { id: string };
    return assetService.listAssets(id);
  });

  app.post('/api/projects/:id/assets/import', async (req) => {
    const { id } = req.params as { id: string };

    if (req.isMultipart()) {
      const part = await req.file();
      if (!part) throw new Error('Không tìm thấy tệp upload.');
      const buf = await part.toBuffer();
      const fields = part.fields as Record<string, { value?: string } | undefined>;
      const role = AssetRoleSchema.parse(fields.role?.value ?? 'prop');
      const classification = fields.classification?.value === 'REFERENCE ONLY' ? 'REFERENCE ONLY' : 'PRODUCTION ASSET';
      const actorId = fields.actorId?.value || undefined;
      const viewId = fields.viewId?.value || undefined;
      const expressionId = fields.expressionId?.value || undefined;
      const notes = fields.notes?.value || undefined;
      const asset = await assetService.importBuffer(id, {
        filename: part.filename,
        buffer: buf,
        role,
        classification,
        source: 'user_upload',
        tool: 'B6 Studio Upload',
        actorId,
        viewId,
        expressionId,
        notes,
      });
      return { asset };
    }

    // Inbox import via JSON body
    const body = z
      .object({
        inboxFilename: z.string().min(1),
        role: AssetRoleSchema,
        actorId: z.string().optional(),
        viewId: z.string().optional(),
        expressionId: z.string().optional(),
      })
      .parse(req.body);
    const asset = await assetService.importFromInbox(
      id,
      body.inboxFilename,
      body.role,
      body.actorId,
      body.viewId,
      body.expressionId,
    );
    return { asset };
  });

  app.post('/api/projects/:id/assets/brief', async (req) => {
    const { id } = req.params as { id: string };
    const brief = AssetBriefInputSchema.parse(req.body);
    return assetService.createAssetBrief(id, brief);
  });

  // Characters & Rig
  app.get('/api/projects/:id/characters', async (req) => {
    const { id } = req.params as { id: string };
    return characterService.getCharacters(id);
  });

  app.patch('/api/projects/:id/characters/:actorId/views/:viewId', async (req) => {
    const { id, actorId, viewId } = req.params as { id: string; actorId: string; viewId: string };
    const body = z.record(z.string(), z.unknown()).parse(req.body);
    const updated = await characterService.updateViewRig(id, actorId, viewId, body as never);
    return { viewPackage: updated };
  });

  // Engine Jobs
  app.post('/api/projects/:id/preflight', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const body = z.object({ requiredViewsRel: z.string().optional() }).parse(req.body ?? {});
    const spec = commandAdapter.buildPreflight(dir, body.requiredViewsRel);
    const job = await jobQueue.enqueue({ projectId: id, kind: 'preflight', spec, heavyEncode: false });
    return { job };
  });

  app.post('/api/projects/:id/validate', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const { ratio } = z.object({ ratio: RatioSchema.default('9:16') }).parse(req.body ?? {});
    const spec = commandAdapter.buildValidate(dir, ratio);
    const job = await jobQueue.enqueue({ projectId: id, kind: 'validate', ratio, spec, heavyEncode: false });
    return { job };
  });

  app.post('/api/projects/:id/draft', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const body = z
      .object({
        ratio: RatioSchema.default('9:16'),
        draftScale: z.union([z.literal(0.5), z.literal(0.75)]).default(0.5),
        start: z.number().finite().min(0).default(0),
        seconds: z.number().finite().positive().max(60).optional(),
        trustedCode: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const spec = commandAdapter.buildDraft(dir, body.ratio, body.draftScale, body.start, body.seconds, body.trustedCode);
    const job = await jobQueue.enqueue({ projectId: id, kind: 'draft', ratio: body.ratio, spec, heavyEncode: true });
    return { job };
  });

  app.post('/api/projects/:id/preview', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const body = z
      .object({
        ratio: RatioSchema.default('9:16'),
        start: z.number().finite().min(0).default(0),
        seconds: z.number().finite().positive().max(60).optional(),
        trustedCode: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const spec = commandAdapter.buildPreview(dir, body.ratio, body.start, body.seconds, body.trustedCode);
    const job = await jobQueue.enqueue({ projectId: id, kind: 'preview', ratio: body.ratio, spec, heavyEncode: true });
    return { job };
  });

  app.post('/api/projects/:id/review-pack', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const body = z
      .object({
        ratio: RatioSchema.default('9:16'),
        reportRel: z.string().min(1),
        previousReviewRel: z.string().optional(),
      })
      .parse(req.body);
    const spec = commandAdapter.buildReviewPack(dir, body.ratio, body.reportRel, body.previousReviewRel);
    const job = await jobQueue.enqueue({ projectId: id, kind: 'review-pack', ratio: body.ratio, spec, heavyEncode: true });
    return { job };
  });

  app.post('/api/projects/:id/check-review', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const body = z
      .object({
        ratio: RatioSchema.default('9:16'),
        reviewRel: z.string().min(1),
        reportRel: z.string().optional(),
      })
      .parse(req.body);
    const spec = commandAdapter.buildCheckReview(dir, body.ratio, body.reviewRel, body.reportRel);
    const job = await jobQueue.enqueue({ projectId: id, kind: 'check-review', ratio: body.ratio, spec, heavyEncode: false });
    return { job };
  });

  app.post('/api/projects/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const body = z
      .object({
        ratio: RatioSchema.default('9:16'),
        reportRel: z.string().min(1),
        reviewRel: z.string().min(1),
        note: z.string().min(3),
      })
      .parse(req.body);
    const spec = commandAdapter.buildApprove(dir, body.ratio, body.reportRel, body.reviewRel, body.note);
    const job = await jobQueue.enqueue({ projectId: id, kind: 'approve', ratio: body.ratio, spec, heavyEncode: false });
    return { job };
  });

  app.post('/api/projects/:id/render', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const body = z
      .object({
        ratio: RatioSchema.default('9:16'),
        trustedCode: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const qa = await qaResolver.resolveQaState(dir, body.ratio);
    if (!qa.summary.renderUnlocked) {
      throw new Error(
        `Chưa đủ điều kiện Full Export: ${qa.summary.blockingReasons.join(' | ') || 'Cần preview PASS hiện hành, visual review 35 mục PASS và phê duyệt người dùng hợp lệ.'}`,
      );
    }
    const spec = commandAdapter.buildRender(dir, body.ratio, body.trustedCode);
    const job = await jobQueue.enqueue({ projectId: id, kind: 'render', ratio: body.ratio, spec, heavyEncode: true });
    return { job };
  });

  app.get('/api/projects/:id/editor-binding', async (req) => {
    const { id } = req.params as { id: string };
    const { ratio } = z.object({ ratio: RatioSchema.default('9:16') }).parse(req.query ?? {});
    const dir = projectService.getProjectDir(id);
    const detail = await projectService.getProject(id);
    const qa = await qaResolver.resolveQaState(dir, ratio);
    const binding = await editorBindingService.resolveBindingStatus(dir, detail, {
      voiceStale: qa.summary.voiceStale,
      technicalStatus: qa.summary.technicalStatus,
      editorSyncState: qa.summary.editorSyncState,
      motionQcStatus: qa.summary.motionQcStatus,
      editorialQcStatus: qa.summary.editorialQcStatus,
      semanticQcStatus: qa.summary.semanticQcStatus,
    });
    return { binding, qa: qa.summary };
  });

  app.get('/api/projects/:id/motion-capability', async (req) => {
    const { id } = req.params as { id: string };
    const { ratio } = z.object({ ratio: RatioSchema.default('9:16') }).parse(req.query ?? {});
    const dir = projectService.getProjectDir(id);
    const detail = await projectService.getProject(id);
    const qa = await qaResolver.resolveQaState(dir, ratio);
    const binding = await editorBindingService.resolveBindingStatus(dir, detail, {
      voiceStale: qa.summary.voiceStale,
      technicalStatus: qa.summary.technicalStatus,
      editorSyncState: qa.summary.editorSyncState,
      motionQcStatus: qa.summary.motionQcStatus,
      editorialQcStatus: qa.summary.editorialQcStatus,
      semanticQcStatus: qa.summary.semanticQcStatus,
    });
    const manifestPath = path.join(APP_ROOT, 'motion_runtime', 'manifest.json');
    const manifest = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      : null;
    return {
      projectId: id,
      ratio,
      engineVersion: manifest?.version ?? '1.0.0',
      motionSchema: manifest?.motion_schema ?? 'b6-studio-articulated/1',
      motionEngineMode: binding.motionEngineMode,
      motionQcVerified: binding.motionQcVerified,
      motionQcStatus: qa.summary.motionQcStatus ?? 'pending',
      motionQcSummary: qa.summary.motionQcSummary ?? null,
      supportedPresets: ['none', 'idle', 'anticipate', 'walk', 'run', 'dash', 'stop', 'turn', 'react', 'recover'],
      supportedCameraPresets: ['establish', 'follow', 'reaction_closeup', 'object_insert', 'impact', 'settle'],
      supportedVisualBeats: ['hook', 'surprise', 'action', 'escalation', 'payoff'],
    };
  });

  app.post('/api/projects/:id/voice/synthesize-local', async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        voiceHint: z.string().max(80).optional(),
        rate: z.number().int().min(-10).max(10).optional(),
        filename: z.string().max(100).optional(),
      })
      .parse(req.body ?? {});
    const voice = await timelineService.synthesizeLocalVoiceWav(id, body);
    const detail = await projectService.getProject(id);
    const qa = await qaResolver.resolveQaState(projectService.getProjectDir(id), detail.meta.activeRatio);
    return { voice, qa: qa.summary, project: detail };
  });

  app.get('/api/projects/:id/qa', async (req) => {
    const { id } = req.params as { id: string };
    const { ratio } = z.object({ ratio: RatioSchema.default('9:16') }).parse(req.query ?? {});
    const review = await reviewService.getReviewState(id, ratio);
    return { qa: review };
  });

  app.get('/api/projects/:id/editorial-report', async (req) => {
    const { id } = req.params as { id: string };
    const query = z
      .object({
        ratio: RatioSchema.default('9:16'),
        includePerSecond: z.coerce.boolean().default(true),
        includePerShot: z.coerce.boolean().default(true),
        reportRel: z.string().optional(),
      })
      .parse(req.query ?? {});
    const dir = projectService.getProjectDir(id);
    const qa = await qaResolver.resolveQaState(dir, query.ratio);
    const edSummary = qa.summary.editorialQcSummary as Record<string, unknown> | undefined;

    let reportAbs: string | null = null;
    if (query.reportRel) {
      reportAbs = resolveInsideRoot(dir, query.reportRel, true);
    } else if (edSummary && typeof edSummary.reportPath === 'string') {
      const candidate = resolveInsideRoot(dir, edSummary.reportPath, false);
      if (fs.existsSync(candidate)) reportAbs = candidate;
    }
    if (!reportAbs && qa.latestReport?.reportRel) {
      const candidate = path.join(dir, path.dirname(qa.latestReport.reportRel), 'editorial-report.json');
      if (fs.existsSync(candidate)) reportAbs = candidate;
    }
    if (!reportAbs) {
      const outputsDir = path.join(dir, 'outputs');
      if (fs.existsSync(outputsDir)) {
        const candidates: Array<{ abs: string; mtimeMs: number }> = [];
        for (const entry of fs.readdirSync(outputsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const p = path.join(outputsDir, entry.name, 'editorial-report.json');
          if (fs.existsSync(p)) {
            candidates.push({ abs: p, mtimeMs: fs.statSync(p).mtimeMs });
          }
        }
        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
        if (candidates[0]) reportAbs = candidates[0].abs;
      }
    }
    if (!reportAbs && fs.existsSync(path.join(dir, 'editorial-report.json'))) {
      reportAbs = path.join(dir, 'editorial-report.json');
    }

    if (!reportAbs) {
      return {
        projectId: id,
        ratio: query.ratio,
        available: false,
        stale: true,
        reportPath: null,
        qcPath: null,
        qcStatus: qa.summary.editorialQcStatus ?? 'pending',
        qc: qa.summary.editorialQcSummary ?? null,
        report: null,
        evidenceLinks: qa.summary.evidenceLinks,
        statusNote: 'Chưa có editorial-report.json; hãy render preview hoặc nhấn Phân tích Editorial.',
      };
    }

    const rawReport = await readJsonFile<Record<string, unknown>>(reportAbs);
    const qcAbs = path.join(path.dirname(reportAbs), 'editorial_qc.json');
    const rawQc = fs.existsSync(qcAbs) ? await readJsonFile<Record<string, unknown>>(qcAbs) : null;
    const reportRel = path.relative(dir, reportAbs).replace(/\\/g, '/');
    const qcRel = fs.existsSync(qcAbs) ? path.relative(dir, qcAbs).replace(/\\/g, '/') : null;
    const stale =
      qa.summary.editorialQcStatus === 'stale' ||
      Boolean(
        qa.summary.previewSha256 &&
          rawQc &&
          typeof rawQc.video_sha256 === 'string' &&
          rawQc.video_sha256 !== qa.summary.previewSha256,
      ) ||
      Boolean(
        qa.summary.currentSourceFingerprint &&
          rawQc &&
          typeof rawQc.source_fingerprint === 'string' &&
          rawQc.source_fingerprint !== qa.summary.currentSourceFingerprint,
      );

    const trimmedReport: Record<string, unknown> = { ...rawReport };
    if (!query.includePerSecond && Array.isArray(trimmedReport.per_second)) {
      trimmedReport.per_second_count = trimmedReport.per_second.length;
      delete trimmedReport.per_second;
    }
    if (!query.includePerShot && Array.isArray(trimmedReport.per_shot)) {
      trimmedReport.per_shot_count = trimmedReport.per_shot.length;
      delete trimmedReport.per_shot;
    }

    return {
      projectId: id,
      ratio: query.ratio,
      available: true,
      stale,
      reportPath: reportRel,
      qcPath: qcRel,
      qcStatus: qa.summary.editorialQcStatus ?? (rawQc?.status as string | undefined) ?? 'pending',
      qc: rawQc ?? qa.summary.editorialQcSummary ?? null,
      report: trimmedReport,
      evidenceLinks: qa.summary.evidenceLinks,
    };
  });

  app.post('/api/projects/:id/analyze-editorial', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const body = z
      .object({
        ratio: RatioSchema.default('9:16'),
        reportRel: z.string().min(1).optional(),
        videoRel: z.string().min(1).optional(),
        evidenceRel: z.string().min(1).optional(),
      })
      .parse(req.body ?? {});

    let reportRel = body.reportRel;
    if (!reportRel && !body.videoRel) {
      const qa = await qaResolver.resolveQaState(dir, body.ratio);
      if (qa.latestReport?.reportRel && fs.existsSync(path.join(dir, qa.latestReport.reportRel))) {
        reportRel = qa.latestReport.reportRel;
      } else {
        const outputsDir = path.join(dir, 'outputs');
        if (fs.existsSync(outputsDir)) {
          const candidates: Array<{ rel: string; mtimeMs: number }> = [];
          for (const entry of fs.readdirSync(outputsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const rp = path.join(outputsDir, entry.name, 'report.json');
            if (fs.existsSync(rp)) {
              candidates.push({ rel: `outputs/${entry.name}/report.json`, mtimeMs: fs.statSync(rp).mtimeMs });
            }
          }
          candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
          if (candidates[0]) reportRel = candidates[0].rel;
        }
      }
    }

    const spec = commandAdapter.buildAnalyzeEditorial(dir, body.ratio, {
      reportRel,
      videoRel: body.videoRel,
      evidenceRel: body.evidenceRel,
    });
    const job = await jobQueue.enqueue({
      projectId: id,
      kind: 'analyze-editorial',
      ratio: body.ratio,
      spec,
      heavyEncode: false,
    });
    return { job };
  });

  app.get('/api/projects/:id/semantic-report', async (req) => {
    const { id } = req.params as { id: string };
    const query = z
      .object({
        ratio: RatioSchema.default('9:16'),
        includeActions: z.coerce.boolean().default(true),
        reportRel: z.string().optional(),
      })
      .parse(req.query ?? {});
    const dir = projectService.getProjectDir(id);
    const qa = await qaResolver.resolveQaState(dir, query.ratio);
    const semSummary = qa.summary.semanticQcSummary as Record<string, unknown> | undefined;

    let reportAbs: string | null = null;
    if (query.reportRel) {
      reportAbs = resolveInsideRoot(dir, query.reportRel, true);
    } else if (semSummary && typeof semSummary.reportPath === 'string') {
      const candidate = resolveInsideRoot(dir, semSummary.reportPath, false);
      if (fs.existsSync(candidate)) reportAbs = candidate;
    }
    if (!reportAbs && qa.latestReport?.reportRel) {
      const candidate = path.join(dir, path.dirname(qa.latestReport.reportRel), 'semantic-report.json');
      if (fs.existsSync(candidate)) reportAbs = candidate;
    }
    if (!reportAbs) {
      const outputsDir = path.join(dir, 'outputs');
      if (fs.existsSync(outputsDir)) {
        const candidates: Array<{ abs: string; mtimeMs: number }> = [];
        for (const entry of fs.readdirSync(outputsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const p = path.join(outputsDir, entry.name, 'semantic-report.json');
          if (fs.existsSync(p)) {
            candidates.push({ abs: p, mtimeMs: fs.statSync(p).mtimeMs });
          }
        }
        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
        if (candidates[0]) reportAbs = candidates[0].abs;
      }
    }

    if (!reportAbs) {
      return {
        projectId: id,
        ratio: query.ratio,
        available: false,
        stale: true,
        reportPath: null,
        qcPath: null,
        evidencePath: null,
        qcStatus: qa.summary.semanticQcStatus ?? 'pending',
        qc: qa.summary.semanticQcSummary ?? null,
        report: null,
        debugLinks: [],
        evidenceLinks: qa.summary.evidenceLinks,
        statusNote: 'Chưa có semantic-report.json; hãy render preview (với semantic_v1) hoặc bấm Phân tích Semantic.',
      };
    }

    const rawReport = await readJsonFile<Record<string, unknown>>(reportAbs);
    const outSubDir = path.dirname(reportAbs);
    const qcAbs = path.join(outSubDir, 'semantic_qc.json');
    const evAbs = path.join(outSubDir, 'semantic-evidence.jsonl');
    const rawQc = fs.existsSync(qcAbs) ? await readJsonFile<Record<string, unknown>>(qcAbs) : null;
    const reportRel = path.relative(dir, reportAbs).replace(/\\/g, '/');
    const qcRel = fs.existsSync(qcAbs) ? path.relative(dir, qcAbs).replace(/\\/g, '/') : null;
    const evRel = fs.existsSync(evAbs) ? path.relative(dir, evAbs).replace(/\\/g, '/') : null;
    const stale =
      qa.summary.semanticQcStatus === 'stale' ||
      Boolean(
        qa.summary.previewSha256 &&
          rawQc &&
          typeof rawQc.video_sha256 === 'string' &&
          rawQc.video_sha256 !== qa.summary.previewSha256,
      ) ||
      Boolean(
        qa.summary.currentSourceFingerprint &&
          rawQc &&
          typeof rawQc.source_fingerprint === 'string' &&
          rawQc.source_fingerprint !== qa.summary.currentSourceFingerprint,
      );

    const debugLinks: Array<{ label: string; url: string; relPath: string }> = [];
    const semDbgDir = path.join(outSubDir, 'semantic_debug');
    if (fs.existsSync(semDbgDir)) {
      for (const fname of fs.readdirSync(semDbgDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).sort()) {
        const rel = path.relative(dir, path.join(semDbgDir, fname)).replace(/\\/g, '/');
        debugLinks.push({
          label: fname,
          relPath: rel,
          url: `/api/media/${encodeURIComponent(id)}/${rel.split('/').map(encodeURIComponent).join('/')}`,
        });
      }
    }

    const trimmedReport: Record<string, unknown> = { ...rawReport };
    if (!query.includeActions && Array.isArray(trimmedReport.action_results)) {
      trimmedReport.action_count = trimmedReport.action_results.length;
      delete trimmedReport.action_results;
    }

    return {
      projectId: id,
      ratio: query.ratio,
      available: true,
      stale,
      reportPath: reportRel,
      qcPath: qcRel,
      evidencePath: evRel,
      qcStatus: qa.summary.semanticQcStatus ?? (rawQc?.status as string | undefined) ?? 'pending',
      qc: rawQc ?? qa.summary.semanticQcSummary ?? null,
      report: trimmedReport,
      debugLinks,
      evidenceLinks: qa.summary.evidenceLinks,
    };
  });

  app.post('/api/projects/:id/analyze-semantic', async (req) => {
    const { id } = req.params as { id: string };
    const dir = projectService.getProjectDir(id);
    const body = z
      .object({
        ratio: RatioSchema.default('9:16'),
        reportRel: z.string().min(1).optional(),
        videoRel: z.string().min(1).optional(),
        evidenceRel: z.string().min(1).optional(),
      })
      .parse(req.body ?? {});

    let reportRel = body.reportRel;
    if (!reportRel && !body.videoRel) {
      const qa = await qaResolver.resolveQaState(dir, body.ratio);
      if (qa.latestReport?.reportRel && fs.existsSync(path.join(dir, qa.latestReport.reportRel))) {
        reportRel = qa.latestReport.reportRel;
      } else {
        const outputsDir = path.join(dir, 'outputs');
        if (fs.existsSync(outputsDir)) {
          const candidates: Array<{ rel: string; mtimeMs: number }> = [];
          for (const entry of fs.readdirSync(outputsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const rp = path.join(outputsDir, entry.name, 'report.json');
            if (fs.existsSync(rp)) {
              candidates.push({ rel: `outputs/${entry.name}/report.json`, mtimeMs: fs.statSync(rp).mtimeMs });
            }
          }
          candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
          if (candidates[0]) reportRel = candidates[0].rel;
        }
      }
    }

    const spec = commandAdapter.buildAnalyzeSemantic(dir, body.ratio, {
      reportRel,
      videoRel: body.videoRel,
      evidenceRel: body.evidenceRel,
    });
    const job = await jobQueue.enqueue({
      projectId: id,
      kind: 'analyze-semantic',
      ratio: body.ratio,
      spec,
      heavyEncode: false,
    });
    return { job };
  });

  // Outputs & Reviews
  app.get('/api/projects/:id/outputs', async (req) => {
    const { id } = req.params as { id: string };
    const outputs = await outputService.listOutputs(id);
    return { outputs };
  });

  app.post('/api/projects/:id/outputs/open-folder', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ relTarget: z.string().default('outputs') }).parse(req.body ?? {});
    return outputService.openOutputFolder(id, body.relTarget);
  });

  app.get('/api/projects/:id/review', async (req) => {
    const { id } = req.params as { id: string };
    const { ratio } = z.object({ ratio: RatioSchema.default('9:16') }).parse(req.query ?? {});
    const review = await reviewService.getReviewState(id, ratio);
    return { review };
  });

  // Jobs & SSE
  app.get('/api/jobs', async (req) => {
    const { projectId } = z.object({ projectId: z.string().optional() }).parse(req.query ?? {});
    const jobs = await jobQueue.listJobs(projectId);
    return { jobs };
  });

  app.get('/api/jobs/:jobId', async (req) => {
    const { jobId } = req.params as { jobId: string };
    const job = await jobQueue.getJob(jobId);
    const logs = await jobQueue.readLogs(jobId, 400);
    return { job, logs };
  });

  app.post('/api/jobs/:jobId/cancel', async (req) => {
    const { jobId } = req.params as { jobId: string };
    const job = await jobQueue.cancelJob(jobId);
    return { job };
  });

  app.get('/api/jobs/:jobId/events', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await jobQueue.getJob(jobId);
    const pastLogs = await jobQueue.readLogs(jobId, 200);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const sendEvent = (event: string, data: unknown) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    for (const line of pastLogs) {
      sendEvent('log', { line });
    }
    sendEvent('status', job);

    const terminal = (s: string) => s === 'succeeded' || s === 'failed' || s === 'cancelled' || s === 'interrupted';
    if (terminal(job.status)) {
      reply.raw.end();
      return reply;
    }

    const cleanup = () => {
      clearInterval(heartbeat);
      jobQueue.off(`job:${jobId}`, listener);
      if (!reply.raw.writableEnded) reply.raw.end();
    };

    const listener = (payload: { event: string; data: unknown }) => {
      sendEvent(payload.event, payload.data);
      if (payload.event === 'status' && payload.data && typeof payload.data === 'object') {
        const st = String((payload.data as { status?: string }).status ?? '');
        if (terminal(st)) cleanup();
      }
    };
    jobQueue.on(`job:${jobId}`, listener);

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': keepalive\n\n');
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      jobQueue.off(`job:${jobId}`, listener);
    });

    return reply;
  });

  // Media streaming with HTTP Range support
  app.get('/api/media/:projectId/*', async (req, reply) => {
    const { projectId, '*': wildcard } = req.params as { projectId: string; '*': string };
    return mediaService.streamProjectMedia(projectId, wildcard ?? '', req, reply);
  });

  // Serve built frontend in production if dist exists
  const frontendDist = path.join(APP_ROOT, 'app', 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.code(404).send({ error: `API route không tồn tại: ${req.url}` });
        return;
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, jobQueue, projectService };
}

