import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SKILL_DIR } from '../src/config.js';
import { validateTimelineData } from '../src/services/script-timeline-service.js';
import { assertSafeId, resolveInsideRoot } from '../src/utils/fs-safe.js';

let tmpDir: string;
let appInstance: Awaited<ReturnType<typeof buildApp>>['app'];

beforeAll(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-studio-api-test-'));
  const projectsDir = path.join(tmpDir, 'projects');
  const jobsDir = path.join(tmpDir, 'jobs');
  const built = await buildApp({ projectsDir, jobsDir });
  appInstance = built.app;
});

afterAll(async () => {
  await appInstance.close();
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe('Security & Path Validation', () => {
  it('blocks path traversal, absolute paths, and null bytes', () => {
    expect(() => resolveInsideRoot(tmpDir, '../escape')).toThrow();
    expect(() => resolveInsideRoot(tmpDir, '/etc/passwd')).toThrow();
    expect(() => resolveInsideRoot(tmpDir, 'C:\\Windows\\win.ini')).toThrow();
    expect(() => resolveInsideRoot(tmpDir, 'bad\0file.png')).toThrow();
    expect(() => assertSafeId('../bad')).toThrow();
    expect(() => assertSafeId('bad/id')).toThrow();
  });

  it('rejects timeline overlaps, gaps, zero durations, and narrative mismatches', () => {
    const res = validateTimelineData(
      [
        {
          id: 'shot-1',
          start: 0,
          end: 2,
          actor: 'marcus',
          environment: 'arena',
          sceneGoal: 'establish',
          composition: 'wide',
          action: 'enter',
          expression: 'neutral',
          props: [],
          staging: { marcus: { x: 0, y: 0, z: 900 } },
          camera: 'pan',
          cameraKeys: [{ t: 0, x: 0, y: -210, z: 0, fov: 55 }],
          transition: 'cut',
          asset_inputs: [],
          sfx: '',
        },
        {
          id: 'shot-2',
          start: 2.5,
          end: 2.5,
          actor: 'marcus',
          environment: 'arena',
          sceneGoal: 'react',
          composition: 'close',
          action: 'react',
          expression: 'surprise',
          props: [],
          staging: { marcus: { x: 0, y: 0, z: 900 } },
          camera: 'hold',
          cameraKeys: [{ t: 0, x: 0, y: -210, z: 0, fov: 55 }],
          transition: 'hold',
          asset_inputs: [],
          sfx: '',
        },
      ],
      [{ start: 0, end: 1, text: 'Wrong line' }],
      'Actual narration',
      10,
    );
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('B6 Studio REST API Integration', () => {
  let createdProjectId = '';

  it('reports health, doctor, and upstream SHA cleanly', async () => {
    const health = await appInstance.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const upstream = await appInstance.inject({ method: 'GET', url: '/api/upstream' });
    expect(upstream.statusCode).toBe(200);
    expect(upstream.json().commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(upstream.json().primaryReference.verified).toBe(true);

    const doctor = await appInstance.inject({ method: 'GET', url: '/api/doctor' });
    expect(doctor.statusCode).toBe(200);
    expect(doctor.json().ok).toBe(true);
    expect(doctor.json().upstreamDoctor.ok).toBe(true);
  }, 30000);

  it('creates a real B6 production project (needs_authoring) via CLI init', async () => {
    const res = await appInstance.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        title: 'Test Gladiator Smoke',
        brief: 'A 10-second Roman arena test',
        ratio: '9:16',
        language: 'en',
        targetDuration: 10,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    createdProjectId = body.project.id;
    expect(body.project.projectJson.stage).toBe('needs_authoring');
    expect(body.project.projectJson.purpose).toBe('production');
    expect(body.project.projectJson.renderer).toBe('b6-production-v1');
    expect(body.project.completeness.readyForValidate).toBe(false);
  }, 30000);

  it('persists story, shots, captions, and scene sync requests across reads', async () => {
    const patchRes = await appInstance.inject({
      method: 'PATCH',
      url: `/api/projects/${createdProjectId}`,
      payload: {
        title: 'Gladiator Edited Title',
        narration: 'Stay sharp in the arena.',
        duration: 10,
        beats: [{ start: 0, end: 10, action: 'Enter and brace shield' }],
        captions: [{ start: 0.2, end: 3.0, text: 'Stay sharp in the arena.' }],
        shots: [
          {
            id: 'opening',
            start: 0,
            end: 10,
            actor: 'marcus',
            environment: 'arena',
            sceneGoal: 'Establish and shield reaction',
            composition: '9:16 arena framing',
            action: 'Brace shield',
            expression: 'alert',
            props: ['shield'],
            staging: { marcus: { x: 0, y: 0, z: 900 } },
            camera: 'Track left to center',
            cameraKeys: [
              { t: 0, x: -80, y: -220, z: 0, fov: 55 },
              { t: 5, x: 0, y: -220, z: 120, fov: 55 },
            ],
            transition: 'end hold',
            asset_inputs: [],
            sfx: 'crowd',
          },
        ],
        requestSceneSyncNote: 'Update shot 1 camera keyframe to z=120',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().validation.valid).toBe(true);

    const getRes = await appInstance.inject({
      method: 'GET',
      url: `/api/projects/${createdProjectId}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().project.meta.title).toBe('Gladiator Edited Title');
    expect(getRes.json().project.storyJson.narration).toBe('Stay sharp in the arena.');
    expect(getRes.json().project.sceneSyncRequests.length).toBe(1);
  });

  it('rejects upstream protected B6 media imported as PRODUCTION ASSET, and imports valid RGBA PNG from inbox', async () => {
    // 1) Create asset brief
    const briefRes = await appInstance.inject({
      method: 'POST',
      url: `/api/projects/${createdProjectId}/assets/brief`,
      payload: {
        title: 'Roman Shield',
        role: 'prop',
        eraAndSetting: 'Ancient Rome arena',
        visualDescription: 'Hand-painted bronze gladiator shield',
        requireAlpha: true,
        targetWidth: 512,
        targetHeight: 512,
      },
    });
    expect(briefRes.statusCode).toBe(200);
    expect(briefRes.json().status).toBe('prepared_awaiting_anti_or_import');

    // 2) Try importing protected upstream asset from inbox -> must block
    const protectedPng = path.join(SKILL_DIR, 'assets', 'b6', 'paint', 'letter.png');
    const inboxDir = path.join(tmpDir, 'projects', createdProjectId, 'assets', 'inbox');
    fs.copyFileSync(protectedPng, path.join(inboxDir, 'copied-letter.png'));
    const blockedRes = await appInstance.inject({
      method: 'POST',
      url: `/api/projects/${createdProjectId}/assets/import`,
      payload: { inboxFilename: 'copied-letter.png', role: 'prop' },
    });
    expect(blockedRes.statusCode).toBe(400);
    expect(blockedRes.json().error).toContain('Bị chặn bởi B6 Asset Guard');

    // 3) Create fresh original RGBA PNG in inbox -> must succeed with real SHA-256 & alpha bbox
    const freshPng = await sharp({
      create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 64, height: 64, channels: 4, background: { r: 180, g: 120, b: 60, alpha: 255 } },
          })
            .png()
            .toBuffer(),
          left: 32,
          top: 32,
        },
      ])
      .png()
      .toBuffer();

    await fsp.writeFile(path.join(inboxDir, 'fresh-shield.png'), freshPng);
    const importRes = await appInstance.inject({
      method: 'POST',
      url: `/api/projects/${createdProjectId}/assets/import`,
      payload: { inboxFilename: 'fresh-shield.png', role: 'prop' },
    });
    expect(importRes.statusCode).toBe(200);
    const asset = importRes.json().asset;
    expect(asset.transparentExterior).toBe(true);
    expect(asset.alphaBbox).toEqual([32, 32, 96, 96]);
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires --trusted-code confirmation for draft/preview/render and blocks traversal in media route', async () => {
    const noTrust = await appInstance.inject({
      method: 'POST',
      url: `/api/projects/${createdProjectId}/preview`,
      payload: { ratio: '9:16', trustedCode: false },
    });
    expect(noTrust.statusCode).toBe(400);

    const mediaEscape = await appInstance.inject({
      method: 'GET',
      url: `/api/media/${createdProjectId}/..%2F..%2Fetc%2Fpasswd`,
    });
    expect(mediaEscape.statusCode).toBe(400);
    expect(mediaEscape.json().error).toContain('bị chặn');
  });

  it('detects invalid/missing character rig failure via real Python preflight job', async () => {
    const brokenProjectId = 'broken-rig-smoke';
    const brokenDir = path.join(tmpDir, 'projects', brokenProjectId);
    fs.mkdirSync(path.join(brokenDir, 'characters', 'broken', 'three_quarter'), { recursive: true });
    const templateDir = path.join(tmpDir, 'projects', createdProjectId);
    for (const file of fs.readdirSync(templateDir)) {
      const src = path.join(templateDir, file);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(brokenDir, file));
      }
    }
    if (fs.existsSync(path.join(templateDir, 'engine'))) {
      fs.cpSync(path.join(templateDir, 'engine'), path.join(brokenDir, 'engine'), { recursive: true });
    }
    fs.writeFileSync(
      path.join(brokenDir, 'characters.json'),
      JSON.stringify({ characters: [{ id: 'broken', package: 'characters/broken/package.json' }] }, null, 2),
    );
    fs.writeFileSync(
      path.join(brokenDir, 'characters', 'broken', 'package.json'),
      JSON.stringify(
        {
          schema_version: 'b6-puppet/1',
          binding_version: 2,
          id: 'broken',
          views: {
            three_quarter: {
              body: 'three_quarter/missing-body.png',
              head: 'three_quarter/missing-head.png',
            },
          },
        },
        null,
        2,
      ),
    );

    const preflightRes = await appInstance.inject({
      method: 'POST',
      url: `/api/projects/${brokenProjectId}/preflight`,
      payload: {},
    });
    expect(preflightRes.statusCode).toBe(200);
    const jobId = preflightRes.json().job.id as string;

    let finalJob: { status: string; exitCode: number | null; errorMessage: string | null } = {
      status: 'queued',
      exitCode: null,
      errorMessage: null,
    };
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const poll = await appInstance.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
      expect(poll.statusCode).toBe(200);
      finalJob = poll.json().job;
      if (finalJob.status !== 'queued' && finalJob.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(finalJob.status).toBe('failed');
    expect(finalJob.exitCode).not.toBe(0);
  }, 30000);

  it('cancels a running child-process job via HTTP and cleans up process tree', async () => {
    const cancelRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-cancel-test-'));
    const cancelApp = await buildApp({
      projectsDir: path.join(cancelRoot, 'projects'),
      jobsDir: path.join(cancelRoot, 'jobs'),
    });
    try {
      const job = await cancelApp.jobQueue.enqueue({
        projectId: null,
        kind: 'preflight',
        heavyEncode: false,
        spec: {
          executable: process.execPath,
          args: ['-e', 'setTimeout(() => {}, 20000)'],
          cwd: cancelRoot,
          env: process.env,
          displayCommand: 'node -e sleep-for-cancel-test',
          outputDir: null,
          reportPath: null,
        },
      });

      const runDeadline = Date.now() + 5000;
      while (Date.now() < runDeadline) {
        const poll = await cancelApp.app.inject({ method: 'GET', url: `/api/jobs/${job.id}` });
        if (poll.json().job.status === 'running') break;
        await new Promise((r) => setTimeout(r, 50));
      }

      const cancelRes = await cancelApp.app.inject({
        method: 'POST',
        url: `/api/jobs/${job.id}/cancel`,
      });
      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.json().job.status).toBe('cancelled');

      const settledDeadline = Date.now() + 5000;
      let settled = cancelRes.json().job;
      while (Date.now() < settledDeadline) {
        const poll = await cancelApp.app.inject({ method: 'GET', url: `/api/jobs/${job.id}` });
        settled = poll.json().job;
        if (settled.completedAt) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(settled.status).toBe('cancelled');
      expect(settled.completedAt).toBeTruthy();
    } finally {
      await cancelApp.app.close();
      await fsp.rm(cancelRoot, { recursive: true, force: true });
    }
  }, 15000);

  it('marks previously running and queued jobs as interrupted on server startup', async () => {
    const rebootRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-reboot-test-'));
    const rebootProjects = path.join(rebootRoot, 'projects');
    const rebootJobs = path.join(rebootRoot, 'jobs');
    fs.mkdirSync(rebootProjects, { recursive: true });
    fs.mkdirSync(rebootJobs, { recursive: true });

    const makeStuckJob = (id: string, status: 'running' | 'queued') => ({
      id,
      projectId: 'roman-gladiator-10s',
      kind: 'preview',
      ratio: '9:16',
      status,
      stageLabel: 'Đang render frame 120/300',
      commandDisplay: 'python run.py preview . --ratio 9:16',
      cwd: rebootProjects,
      createdAt: '2026-11-18T00:00:00.000Z',
      startedAt: status === 'running' ? '2026-11-18T00:00:01.000Z' : null,
      completedAt: null,
      elapsedMs: 1000,
      exitCode: null,
      frameProgress: { checkedFrame: 120, totalFrames: 300 },
      outputDir: null,
      reportPath: null,
      videoPath: null,
      resultJson: null,
      errorMessage: null,
    });

    fs.writeFileSync(path.join(rebootJobs, 'job-stuck-running.json'), JSON.stringify(makeStuckJob('job-stuck-running', 'running')));
    fs.writeFileSync(path.join(rebootJobs, 'job-stuck-queued.json'), JSON.stringify(makeStuckJob('job-stuck-queued', 'queued')));

    const rebooted = await buildApp({ projectsDir: rebootProjects, jobsDir: rebootJobs });
    try {
      const runningPoll = await rebooted.app.inject({ method: 'GET', url: '/api/jobs/job-stuck-running' });
      expect(runningPoll.statusCode).toBe(200);
      expect(runningPoll.json().job.status).toBe('interrupted');
      expect(runningPoll.json().logs.some((l: string) => l.includes('Marked interrupted on server startup'))).toBe(true);

      const queuedPoll = await rebooted.app.inject({ method: 'GET', url: '/api/jobs/job-stuck-queued' });
      expect(queuedPoll.statusCode).toBe(200);
      expect(queuedPoll.json().job.status).toBe('interrupted');
    } finally {
      await rebooted.app.close();
      await fsp.rm(rebootRoot, { recursive: true, force: true });
    }
  });
});
