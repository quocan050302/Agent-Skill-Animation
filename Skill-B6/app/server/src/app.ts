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
import { ensureDirectories } from './utils/fs-safe.js';
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

  const doctorService = new EnvDoctorService();
  const upstreamService = new UpstreamService();
  const projectService = new ProjectService(projectsDir);
  const timelineService = new ScriptTimelineService(projectService);
  const assetService = new AssetService(projectService);
  const characterService = new CharacterBindingService(projectService);
  const commandAdapter = new B6CommandAdapter();
  const jobQueue = new JobQueue(jobsDir, projectsDir);
  app.addHook('onClose', async () => {
    await jobQueue.shutdown();
  });
  const mediaService = new MediaService(projectService);
  const reviewService = new ReviewService(projectService);
  const outputService = new OutputService(projectService);

  app.setErrorHandler((err, _req, reply) => {
    const message = err instanceof Error ? err.message : 'Lỗi không xác định';
    const statusCode =
      message.includes('Không tìm thấy') ? 404
      : message.includes('không hợp lệ') || message.includes('bị chặn') || message.includes('Bị chặn') || message.includes('Zod') ? 400
      : (err as { statusCode?: number }).statusCode ?? 400;
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
    const spec = commandAdapter.buildRender(dir, body.ratio, body.trustedCode);
    const job = await jobQueue.enqueue({ projectId: id, kind: 'render', ratio: body.ratio, spec, heavyEncode: true });
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

