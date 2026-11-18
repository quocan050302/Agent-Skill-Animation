import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SKILL_DIR } from '../src/config.js';
import { EditorBindingService } from '../src/services/editor-binding-service.js';
import { ProjectService } from '../src/services/project-service.js';
import { QaEvidenceResolver } from '../src/services/qa-evidence-service.js';
import { ScriptTimelineService, validateTimelineData } from '../src/services/script-timeline-service.js';
import { assertSafeId, resolveInsideRoot } from '../src/utils/fs-safe.js';
import crypto from 'node:crypto';

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

describe('QA Truth Negative Traps, Concurrency Lock & Editor Binding Backtests', () => {
  it('blocks transactional invalid patches, enforces 409 revision lock, and marks narration edits voiceStale', async () => {
    const revRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-tx-test-'));
    const txApp = await buildApp({
      projectsDir: path.join(revRoot, 'projects'),
      jobsDir: path.join(revRoot, 'jobs'),
    });
    try {
      const createRes = await txApp.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          title: 'TX & Concurrency Smoke',
          brief: 'Test transactional validation and optimistic locking',
          ratio: '9:16',
          language: 'en',
          targetDuration: 4,
        },
      });
      expect(createRes.statusCode).toBe(200);
      const proj = createRes.json().project;
      const projId = proj.id as string;
      const rev1 = Number(proj.meta.revision ?? 1);

      // Valid patch updates to revision + 1
      const validPatch = await txApp.app.inject({
        method: 'PATCH',
        url: `/api/projects/${projId}`,
        payload: {
          expectedRevision: rev1,
          title: 'TX Updated Title',
          narration: 'Hello cowboy hat.',
          duration: 4,
          beats: [{ id: 'b1', start: 0, end: 4, action: 'Chase hat' }],
          captions: [{ start: 0.2, end: 2.5, text: 'Hello cowboy hat.' }],
          shots: [
            {
              id: 'b1',
              start: 0,
              end: 4,
              actor: '',
              composition: '9:16',
              action: 'Chase hat',
              expression: 'neutral',
              props: [],
              staging: {},
              camera: 'Pan',
              cameraKeys: [{ t: 0, x: 0, y: -200, z: 0, fov: 55 }],
              transition: 'cut',
              asset_inputs: [],
              sfx: '',
            },
          ],
        },
      });
      expect(validPatch.statusCode).toBe(200);
      const rev2 = Number(validPatch.json().detail.meta.revision);
      expect(rev2).toBe(rev1 + 1);

      // Stale expectedRevision -> 409 Conflict
      const conflictRes = await txApp.app.inject({
        method: 'PATCH',
        url: `/api/projects/${projId}`,
        payload: { expectedRevision: rev1, title: 'Should Conflict' },
      });
      expect(conflictRes.statusCode).toBe(409);

      // Invalid timeline (overlap + caption mismatch) -> 400 AND disk untouched!
      const badPatch = await txApp.app.inject({
        method: 'PATCH',
        url: `/api/projects/${projId}`,
        payload: {
          expectedRevision: rev2,
          title: 'Must Not Persist',
          narration: 'Hello cowboy hat.',
          captions: [{ start: 0.2, end: 2.0, text: 'WRONG TEXT' }],
          shots: [
            {
              id: 'b1',
              start: 0,
              end: 2.5,
              actor: '',
              composition: '9:16',
              action: 'Overlap',
              expression: 'neutral',
              props: [],
              staging: {},
              camera: 'Pan',
              cameraKeys: [{ t: 0, x: 0, y: -200, z: 0, fov: 55 }],
              transition: 'cut',
              asset_inputs: [],
              sfx: '',
            },
            {
              id: 'b2',
              start: 2.0,
              end: 4.0,
              actor: '',
              composition: '9:16',
              action: 'Overlap 2',
              expression: 'neutral',
              props: [],
              staging: {},
              camera: 'Pan',
              cameraKeys: [{ t: 0, x: 0, y: -200, z: 0, fov: 55 }],
              transition: 'cut',
              asset_inputs: [],
              sfx: '',
            },
          ],
        },
      });
      expect(badPatch.statusCode).toBe(400);
      const afterBad = await txApp.app.inject({ method: 'GET', url: `/api/projects/${projId}` });
      expect(afterBad.json().project.meta.title).toBe('TX Updated Title');
      expect(afterBad.json().project.meta.revision).toBe(rev2);

      // Invalid Python syntax in PUT /scene -> 400 and untouched
      const badScene = await txApp.app.inject({
        method: 'PUT',
        url: `/api/projects/${projId}/scene`,
        payload: { content: 'def broken(:' },
      });
      expect(badScene.statusCode).toBe(400);

      // Voice synthesis + narration change -> voiceStale = true
      if (process.platform === 'win32') {
        const synthRes = await txApp.app.inject({
          method: 'POST',
          url: `/api/projects/${projId}/voice/synthesize-local`,
          payload: { voiceHint: 'David' },
        });
        expect(synthRes.statusCode).toBe(200);
        expect(synthRes.json().qa.voiceStale).toBe(false);

        const editNarr = await txApp.app.inject({
          method: 'PATCH',
          url: `/api/projects/${projId}`,
          payload: {
            narration: 'Completely new narration words.',
            captions: [{ start: 0.2, end: 2.8, text: 'Completely new narration words.' }],
          },
        });
        expect(editNarr.statusCode).toBe(200);
        const qaAfterNarr = await txApp.app.inject({
          method: 'GET',
          url: `/api/projects/${projId}/qa?ratio=9:16`,
        });
        expect(qaAfterNarr.statusCode).toBe(200);
        expect(qaAfterNarr.json().qa.voiceStale).toBe(true);
        expect(qaAfterNarr.json().qa.reasonCodes).toContain('VOICE_NEEDS_REGENERATION');
        expect(qaAfterNarr.json().qa.technicalStatus).not.toBe('pass');
      }
    } finally {
      await txApp.app.close();
      await fsp.rm(revRoot, { recursive: true, force: true });
    }
  }, 40000);

  it('rejects all fake, missing, SHA-mismatched, wrong-ratio, tampered-35, and stale QA artifacts', async () => {
    const trapRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-qa-traps-'));
    const trapProjects = path.join(trapRoot, 'projects');
    const trapJobs = path.join(trapRoot, 'jobs');
    const srcCowboy = path.join(process.cwd(), '..', '..', 'workspace', 'projects', 'cowboy-hat-10s');
    const projDir = path.join(trapProjects, 'cowboy-trap');
    fs.mkdirSync(trapProjects, { recursive: true });
    fs.mkdirSync(trapJobs, { recursive: true });
    fs.cpSync(srcCowboy, projDir, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}outputs`),
    });

    const trapApp = await buildApp({ projectsDir: trapProjects, jobsDir: trapJobs });
    try {
      // 1) Report with missing video
      const out1 = path.join(projDir, 'outputs', 'preview-missing-vid');
      fs.mkdirSync(out1, { recursive: true });
      fs.writeFileSync(
        path.join(out1, 'report.json'),
        JSON.stringify({
          kind: 'preview',
          ratio: '9:16',
          technical_status: 'pass',
          fingerprint: 'a'.repeat(64),
          video: 'outputs/preview-missing-vid/preview.mp4',
          video_sha256: 'b'.repeat(64),
          checked_frames: 300,
        }),
      );
      let qaRes = await trapApp.app.inject({ method: 'GET', url: '/api/projects/cowboy-trap/review?ratio=9:16' });
      expect(qaRes.statusCode).toBe(200);
      expect(qaRes.json().review.technicalStatus).toBe('fail');
      expect(qaRes.json().review.reasonCodes).toContain('VIDEO_FILE_MISSING');
      expect(qaRes.json().review.renderUnlocked).toBe(false);

      // 2) Wrong SHA + corrupt MP4 bytes + fake approval JSON
      fs.writeFileSync(path.join(out1, 'preview.mp4'), 'NOT A REAL MP4');
      fs.writeFileSync(
        path.join(projDir, 'outputs', 'approval-9x16.json'),
        JSON.stringify({ note: 'fake pass', fingerprint: 'a'.repeat(64), preview_sha256: 'b'.repeat(64) }),
      );
      qaRes = await trapApp.app.inject({ method: 'GET', url: '/api/projects/cowboy-trap/review?ratio=9:16' });
      expect(qaRes.json().review.technicalStatus).toBe('fail');
      expect(qaRes.json().review.userApprovalStatus).not.toBe('approved');
      expect(qaRes.json().review.renderUnlocked).toBe(false);

      // 3) Render route stays locked when not approved/verified
      const lockedRender = await trapApp.app.inject({
        method: 'POST',
        url: '/api/projects/cowboy-trap/render',
        payload: { ratio: '9:16', trustedCode: true },
      });
      expect(lockedRender.statusCode).toBe(400);

      // 4) Wrong ratio report + tampered 34/35 visual review claiming pass
      fs.rmSync(out1, { recursive: true, force: true });
      const out2 = path.join(projDir, 'outputs', 'preview-wrong-ratio');
      fs.mkdirSync(out2, { recursive: true });
      fs.writeFileSync(
        path.join(out2, 'report.json'),
        JSON.stringify({
          kind: 'preview',
          ratio: '16:9',
          technical_status: 'pass',
          fingerprint: 'c'.repeat(64),
          video: 'outputs/preview-wrong-ratio/preview.mp4',
          video_sha256: 'd'.repeat(64),
          checked_frames: 300,
        }),
      );
      fs.writeFileSync(
        path.join(out2, 'motion-review.json'),
        JSON.stringify({
          ratio: '9:16',
          status: 'pass',
          groups: {
            reading_order_framing: { subchecks: { a1: { status: 'pass', observation: 'ok' } } },
          },
        }),
      );
      qaRes = await trapApp.app.inject({ method: 'GET', url: '/api/projects/cowboy-trap/review?ratio=9:16' });
      expect(qaRes.json().review.technicalStatus).not.toBe('pass');
      expect(qaRes.json().review.visualReviewStatus).not.toBe('pass');
      expect(qaRes.json().review.renderUnlocked).toBe(false);

      // 5) JobQueue exit-0 without artifact fails closed
      const fakeEmptyJob = await trapApp.jobQueue.enqueue({
        projectId: null,
        kind: 'preview',
        heavyEncode: false,
        spec: {
          executable: process.execPath,
          args: ['-e', 'console.log("RESULT {}")'],
          cwd: trapRoot,
          env: process.env,
          displayCommand: 'node empty-preview-trap',
          outputDir: path.join(trapRoot, 'empty-out'),
          reportPath: path.join(trapRoot, 'empty-out', 'report.json'),
        },
      });
      for (let w = 0; w < 40; w++) {
        const poll = await trapApp.app.inject({ method: 'GET', url: `/api/jobs/${fakeEmptyJob.id}` });
        if (['failed', 'succeeded', 'cancelled'].includes(poll.json().job.status)) {
          expect(poll.json().job.status).toBe('failed');
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      // 6) DiskGuard blocks heavy jobs cleanly under threshold override
      process.env.B6_MIN_FREE_BYTES = String(1024 * 1024 * 1024 * 1024 * 50); // 50 TiB
      await expect(
        trapApp.jobQueue.enqueue({
          projectId: null,
          kind: 'preview',
          heavyEncode: true,
          spec: {
            executable: process.execPath,
            args: ['-v'],
            cwd: trapRoot,
            env: process.env,
            displayCommand: 'disk-trap',
            outputDir: null,
            reportPath: null,
          },
        }),
      ).rejects.toThrow(/Không đủ dung lượng đĩa/);
      delete process.env.B6_MIN_FREE_BYTES;
    } finally {
      delete process.env.B6_MIN_FREE_BYTES;
      await trapApp.app.close();
      await fsp.rm(trapRoot, { recursive: true, force: true });
    }
  }, 40000);

  it('proves UI edits to camera/prop flow into rendered pixels and mark stale QA honestly', async () => {
    const diffRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-render-diff-'));
    const diffProjects = path.join(diffRoot, 'projects');
    const diffJobs = path.join(diffRoot, 'jobs');
    const srcCowboy = path.join(process.cwd(), '..', '..', 'workspace', 'projects', 'cowboy-hat-10s');
    const projDir = path.join(diffProjects, 'cowboy-diff');
    fs.mkdirSync(diffProjects, { recursive: true });
    fs.mkdirSync(diffJobs, { recursive: true });
    fs.cpSync(srcCowboy, projDir, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}outputs`),
    });

    const diffApp = await buildApp({ projectsDir: diffProjects, jobsDir: diffJobs });
    try {
      const waitJob = async (jobId: string) => {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          const r = await diffApp.app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
          const j = r.json().job;
          if (!['queued', 'running'].includes(j.status)) return j;
          await new Promise((res) => setTimeout(res, 200));
        }
        throw new Error(`Timed out waiting for job ${jobId}`);
      };

      // Render 0.4s draft clip BEFORE edit inside shot-3 (t=3.0..3.4s)
      const draft1Res = await diffApp.app.inject({
        method: 'POST',
        url: '/api/projects/cowboy-diff/draft',
        payload: { ratio: '9:16', draftScale: 0.5, start: 3.0, seconds: 0.4, trustedCode: true },
      });
      expect(draft1Res.statusCode).toBe(200);
      const j1 = await waitJob(draft1Res.json().job.id);
      expect(j1.status).toBe('succeeded');
      const vid1 = path.join(projDir, j1.videoPath as string);
      expect(fs.existsSync(vid1)).toBe(true);

      // Extract middle frame of draft 1 with real ffmpeg
      const { resolveRealFfmpeg } = await import('../src/config.js');
      const { spawnSync } = await import('node:child_process');
      const ffmpeg = resolveRealFfmpeg();
      const png1 = path.join(diffRoot, 'before.png');
      const png2 = path.join(diffRoot, 'after.png');
      spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', vid1, '-vf', 'select=eq(n\\,5)', '-vframes', '1', png1], { shell: false });

      // Edit shot-3 cameraKeys[0].x and propKeyframes via real PATCH endpoint
      const curProj = (await diffApp.app.inject({ method: 'GET', url: '/api/projects/cowboy-diff' })).json().project;
      const curShots = curProj.formats['9:16'].shots.map((s: Record<string, unknown>, idx: number) => {
        const keys = (s.camera_keys ?? s.cameraKeys) as Array<Record<string, number>>;
        const baseObj = {
          id: s.id,
          start: s.start,
          end: s.end,
          actor: s.actor,
          environment: s.environment,
          sceneGoal: s.sceneGoal,
          composition: s.composition,
          action: s.action,
          expression: s.expression,
          props: s.props,
          staging: s.staging,
          camera: s.camera,
          cameraKeys: idx === 2 ? keys.map((k) => ({ ...k, x: Number(k.x) + 40 })) : keys,
          easing: s.easing,
          actorStart: s.actorStart,
          actorEnd: s.actorEnd,
          propKeyframes:
            idx === 2 && Array.isArray(s.propKeyframes)
              ? (s.propKeyframes as Array<Record<string, number>>).map((pk) => ({ ...pk, y: Number(pk.y) - 55 }))
              : s.propKeyframes,
          transition: s.transition,
          asset_inputs: s.asset_inputs,
          sfx: s.sfx,
        };
        return baseObj;
      });

      const patchRes = await diffApp.app.inject({
        method: 'PATCH',
        url: '/api/projects/cowboy-diff',
        payload: { expectedRevision: curProj.meta.revision, shots: curShots },
      });
      expect(patchRes.statusCode).toBe(200);

      // Render 0.4s draft clip AFTER edit at exact same timestamp
      const draft2Res = await diffApp.app.inject({
        method: 'POST',
        url: '/api/projects/cowboy-diff/draft',
        payload: { ratio: '9:16', draftScale: 0.5, start: 3.0, seconds: 0.4, trustedCode: true },
      });
      expect(draft2Res.statusCode).toBe(200);
      const j2 = await waitJob(draft2Res.json().job.id);
      expect(j2.status).toBe('succeeded');
      const vid2 = path.join(projDir, j2.videoPath as string);
      spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', vid2, '-vf', 'select=eq(n\\,5)', '-vframes', '1', png2], { shell: false });

      const buf1 = await sharp(png1).ensureAlpha().raw().toBuffer();
      const buf2 = await sharp(png2).ensureAlpha().raw().toBuffer();
      let diffSum = 0;
      for (let i = 0; i < buf1.length; i++) diffSum += Math.abs(buf1[i] - buf2[i]);
      const mad = diffSum / buf1.length;
      expect(mad).toBeGreaterThan(2.5);
    } finally {
      await diffApp.app.close();
      await fsp.rm(diffRoot, { recursive: true, force: true });
    }
  }, 60000);
});

describe('B6-03 Articulated Motion, Multi-File Rollback & Motion-QC Truth', () => {
  it('reverts ALL target files atomically on mid-commit fault injection without incrementing revision', async () => {
    const rbRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-rollback-test-'));
    const projectsDir = path.join(rbRoot, 'projects');
    const projDir = path.join(projectsDir, 'samurai-rb');
    const srcSamurai = path.join(process.cwd(), '..', '..', 'workspace', 'projects', 'samurai-red-leaf-10s');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.cpSync(srcSamurai, projDir, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}outputs`),
    });

    try {
      const trackedFiles = [
        'formats/portrait.json',
        'scene-control.json',
        'studio.meta.json',
        'project.json',
        'story.json',
        'captions.json',
      ];
      const beforeHashes = Object.fromEntries(
        trackedFiles.map((rel) => [
          rel,
          crypto.createHash('sha256').update(fs.readFileSync(path.join(projDir, rel))).digest('hex'),
        ]),
      );

      const ps = new ProjectService(projectsDir);
      const eb = new EditorBindingService();
      const qa = new QaEvidenceResolver();
      const faultyService = new ScriptTimelineService(ps, eb, qa, (relPath) => {
        if (relPath === 'studio.meta.json') {
          throw new Error('INJECTED_DISK_FAULT');
        }
      });

      const cur = await ps.getProject('samurai-rb');
      const prevRev = cur.meta.revision;
      await expect(
        faultyService.patchProject('samurai-rb', {
          expectedRevision: prevRev,
          title: 'Rolled Back Title',
          narration: 'Should completely revert on disk.',
          captions: [{ start: 0, end: 10, text: 'Should completely revert on disk.' }],
        }),
      ).rejects.toThrow(/INJECTED_DISK_FAULT/);

      for (const rel of trackedFiles) {
        const afterHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(projDir, rel))).digest('hex');
        expect(afterHash, `Rollback parity check failed on ${rel}`).toBe(beforeHashes[rel]);
      }
      const afterProj = await ps.getProject('samurai-rb');
      expect(afterProj.meta.revision).toBe(prevRev);
    } finally {
      await fsp.rm(rbRoot, { recursive: true, force: true });
    }
  });

  it('rejects stale/failing motion_qc.json honestly and locks renderUnlocked', async () => {
    const mqRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-motion-qc-trap-'));
    const mqProjects = path.join(mqRoot, 'projects');
    const mqJobs = path.join(mqRoot, 'jobs');
    const srcSamurai = path.join(process.cwd(), '..', '..', 'workspace', 'projects', 'samurai-red-leaf-10s');
    const projDir = path.join(mqProjects, 'samurai-qc');
    fs.mkdirSync(mqProjects, { recursive: true });
    fs.mkdirSync(mqJobs, { recursive: true });
    fs.cpSync(srcSamurai, projDir, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}outputs`),
    });

    const mqApp = await buildApp({ projectsDir: mqProjects, jobsDir: mqJobs });
    try {
      const cap1 = await mqApp.app.inject({ method: 'GET', url: '/api/projects/samurai-qc/motion-capability?ratio=9:16' });
      expect(cap1.statusCode).toBe(200);
      expect(cap1.json().motionEngineMode).toBe('articulated_v1');
      expect(cap1.json().motionQcVerified).toBe(false);
      expect(cap1.json().motionQcStatus).toBe('pending');

      // Inject FAIL motion_qc.json -> server MUST block export and mark fail
      fs.mkdirSync(path.join(projDir, 'outputs', 'preview-01'), { recursive: true });
      const bind1 = (await mqApp.app.inject({ method: 'GET', url: '/api/projects/samurai-qc/editor-binding?ratio=9:16' })).json();
      const curFp = bind1.qa.currentSourceFingerprint;
      fs.writeFileSync(
        path.join(projDir, 'outputs', 'preview-01', 'motion_qc.json'),
        JSON.stringify({ schema: 'b6-motion-qc/1', status: 'fail', pass: false, source_fingerprint: curFp, errors: ['Synthetic slip error'] }),
      );
      const qaFail = (await mqApp.app.inject({ method: 'GET', url: '/api/projects/samurai-qc/qa?ratio=9:16' })).json().qa;
      expect(qaFail.motionQcStatus).toBe('fail');
      expect(qaFail.reasonCodes).toContain('MOTION_QC_FAILED');
      expect(qaFail.renderUnlocked).toBe(false);

      // Inject STALE motion_qc.json with mismatched fingerprint -> MUST mark stale
      fs.writeFileSync(
        path.join(projDir, 'outputs', 'preview-01', 'motion_qc.json'),
        JSON.stringify({ schema: 'b6-motion-qc/1', status: 'pass', pass: true, source_fingerprint: 'deadbeef_stale' }),
      );
      const qaStale = (await mqApp.app.inject({ method: 'GET', url: '/api/projects/samurai-qc/qa?ratio=9:16' })).json().qa;
      expect(qaStale.motionQcStatus).toBe('stale');
      expect(qaStale.reasonCodes).toContain('MOTION_QC_STALE');
    } finally {
      await mqApp.app.close();
      await fsp.rm(mqRoot, { recursive: true, force: true });
    }
  });

  it('proves UI motion.preset & gait edits on Samurai flow into real draft pixel output', async () => {
    const mdRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-motion-diff-'));
    const mdProjects = path.join(mdRoot, 'projects');
    const mdJobs = path.join(mdRoot, 'jobs');
    const srcSamurai = path.join(process.cwd(), '..', '..', 'workspace', 'projects', 'samurai-red-leaf-10s');
    const projDir = path.join(mdProjects, 'samurai-diff');
    fs.mkdirSync(mdProjects, { recursive: true });
    fs.mkdirSync(mdJobs, { recursive: true });
    fs.cpSync(srcSamurai, projDir, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}outputs`),
    });

    const mdApp = await buildApp({ projectsDir: mdProjects, jobsDir: mdJobs });
    try {
      const waitJob = async (jobId: string) => {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          const r = await mdApp.app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
          const j = r.json().job;
          if (!['queued', 'running'].includes(j.status)) return j;
          await new Promise((res) => setTimeout(res, 200));
        }
        throw new Error(`Timed out waiting for job ${jobId}`);
      };

      const d1 = await mdApp.app.inject({
        method: 'POST',
        url: '/api/projects/samurai-diff/draft',
        payload: { ratio: '9:16', draftScale: 0.5, start: 2.8, seconds: 0.4, trustedCode: true },
      });
      expect(d1.statusCode).toBe(200);
      const j1 = await waitJob(d1.json().job.id);
      if (j1.status !== 'succeeded') {
        const logRes = await pixApp.app.inject({ method: 'GET', url: `/api/jobs/${j1.id}` });
        throw new Error(`d1 failed: ${j1.errorMessage} | logs: ${(logRes.json().logs as string[]).slice(-10).join('\n')}`);
      }
      expect(j1.status).toBe('succeeded');

      const { resolveRealFfmpeg } = await import('../src/config.js');
      const { spawnSync } = await import('node:child_process');
      const ffmpeg = resolveRealFfmpeg();
      const png1 = path.join(mdRoot, 'before.png');
      const png2 = path.join(mdRoot, 'after.png');
      spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', path.join(projDir, j1.videoPath as string), '-vf', 'select=eq(n\\,5)', '-vframes', '1', png1], { shell: false });

      // Mutate Shot 3 articulated motion parameters (endX + footLift + cadence + cameraPreset)
      const cur = (await mdApp.app.inject({ method: 'GET', url: '/api/projects/samurai-diff' })).json().project;
      const nextShots = cur.formats['9:16'].shots.map((s: Record<string, unknown>, idx: number) => {
        const keys = (s.camera_keys ?? s.cameraKeys) as Array<Record<string, number>>;
        return {
          ...s,
          cameraKeys: keys,
          ...(idx === 2
            ? {
                cameraPreset: 'impact',
                motion: {
                  ...(s.motion as Record<string, unknown>),
                  endX: 500,
                  cameraPreset: 'impact',
                  gait: { ...((s.motion as Record<string, unknown>).gait as Record<string, unknown>), cadenceHz: 3.4, footLift: 64 },
                },
              }
            : {}),
        };
      });

      const patchRes = await mdApp.app.inject({
        method: 'PATCH',
        url: '/api/projects/samurai-diff',
        payload: { expectedRevision: cur.meta.revision, shots: nextShots },
      });
      expect(patchRes.statusCode).toBe(200);

      const d2 = await mdApp.app.inject({
        method: 'POST',
        url: '/api/projects/samurai-diff/draft',
        payload: { ratio: '9:16', draftScale: 0.5, start: 2.8, seconds: 0.4, trustedCode: true },
      });
      expect(d2.statusCode).toBe(200);
      const j2 = await waitJob(d2.json().job.id);
      if (j2.status !== 'succeeded') {
        const logRes = await pixApp.app.inject({ method: 'GET', url: `/api/jobs/${j2.id}` });
        throw new Error(`d2 failed: ${j2.errorMessage} | logs: ${(logRes.json().logs as string[]).slice(-12).join('\n')}`);
      }
      expect(j2.status).toBe('succeeded');
      spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', path.join(projDir, j2.videoPath as string), '-vf', 'select=eq(n\\,5)', '-vframes', '1', png2], { shell: false });

      const buf1 = await sharp(png1).ensureAlpha().raw().toBuffer();
      const buf2 = await sharp(png2).ensureAlpha().raw().toBuffer();
      let diffSum = 0;
      for (let i = 0; i < buf1.length; i++) diffSum += Math.abs(buf1[i] - buf2[i]);
      expect(diffSum / buf1.length).toBeGreaterThan(2.5);
    } finally {
      await mdApp.app.close();
      await fsp.rm(mdRoot, { recursive: true, force: true });
    }
  }, 60000);
});

describe('Editorial Director Contract, QC Gate & Real Render Binding (B6-04)', () => {
  it('supports opt-in editorial_v1 schema migration, emits scene_runtime bindings, and flags consecutive shot repetition', async () => {
    const edRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-ed-contract-'));
    const edProjects = path.join(edRoot, 'projects');
    const edJobs = path.join(edRoot, 'jobs');
    const srcSamurai = path.join(process.cwd(), '..', '..', 'workspace', 'projects', 'samurai-red-leaf-10s');
    const projDir = path.join(edProjects, 'ed-samurai');
    fs.mkdirSync(edProjects, { recursive: true });
    fs.mkdirSync(edJobs, { recursive: true });
    fs.cpSync(srcSamurai, projDir, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}outputs`),
    });

    const edApp = await buildApp({ projectsDir: edProjects, jobsDir: edJobs });
    try {
      const cur = (await edApp.app.inject({ method: 'GET', url: '/api/projects/ed-samurai' })).json().project;
      const shots = cur.formats['9:16'].shots.map((s: Record<string, unknown>, idx: number) => ({
        ...s,
        cameraKeys: s.camera_keys ?? s.cameraKeys,
        editorial: {
          role: idx === 0 ? 'hook' : 'reveal',
          shotSize: 'wide',
          focus: { targetKind: 'actor_full', actorId: 'ren', propId: '', offsetXy: [0, 0], scaleHint: 1, safeMargin: 0.08 },
          cameraMovement: 'hold',
          transition: { kind: 'hard_cut', durationS: 0, reason: 'Same composition negative check', preserveEyeline: true, matchAction: false },
          intensity: 'normal',
          pacingAdvice: 'auto',
          reactionHoldS: 0,
          notes: '',
        },
      }));

      const patchRes = await edApp.app.inject({
        method: 'PATCH',
        url: '/api/projects/ed-samurai',
        payload: {
          expectedRevision: cur.meta.revision,
          editorialMode: 'editorial_v1',
          shots,
        },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().detail.projectJson.editorial_mode).toBe('editorial_v1');

      const bindRes = await edApp.app.inject({ method: 'GET', url: '/api/projects/ed-samurai/editor-binding?ratio=9:16' });
      expect(bindRes.statusCode).toBe(200);
      expect(bindRes.json().binding.editorialMode).toBe('editorial_v1');
      expect(bindRes.json().binding.shotVarietyWarnings.length).toBeGreaterThan(0);

      const runtimeSrc = fs.readFileSync(path.join(projDir, 'scene_runtime.py'), 'utf8');
      expect(runtimeSrc).toContain('def camera_editorial_at(');
      expect(runtimeSrc).toContain('def editorial_state_at(');

      // Atomic rollback fault injection: reject invalid editorial field + stale expectedRevision
      const revBefore = patchRes.json().detail.meta.revision as number;
      const badEditorialPatch = await edApp.app.inject({
        method: 'PATCH',
        url: '/api/projects/ed-samurai',
        payload: {
          expectedRevision: revBefore,
          shots: [{ ...shots[0], editorial: { ...shots[0].editorial, shotSize: 'invalid_size' } }],
        },
      });
      expect(badEditorialPatch.statusCode).toBe(400);

      const conflictPatch = await edApp.app.inject({
        method: 'PATCH',
        url: '/api/projects/ed-samurai',
        payload: {
          expectedRevision: revBefore + 99,
          title: 'Should Conflict And Rollback',
        },
      });
      expect(conflictPatch.statusCode).toBe(409);

      const afterErr = (await edApp.app.inject({ method: 'GET', url: '/api/projects/ed-samurai' })).json().project;
      expect(afterErr.meta.revision).toBe(revBefore);
      expect(afterErr.projectJson.editorial_mode).toBe('editorial_v1');
    } finally {
      await edApp.app.close();
      await fsp.rm(edRoot, { recursive: true, force: true });
    }
  }, 40000);

  it('rejects tampered/stale editorial_qc.json, blocks renderUnlocked, and validates path safety', async () => {
    const qcRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-ed-qc-trap-'));
    const qcProjects = path.join(qcRoot, 'projects');
    const qcJobs = path.join(qcRoot, 'jobs');
    const srcSamurai = path.join(process.cwd(), '..', '..', 'workspace', 'projects', 'samurai-red-leaf-10s');
    const projDir = path.join(qcProjects, 'ed-qc-trap');
    fs.mkdirSync(qcProjects, { recursive: true });
    fs.mkdirSync(qcJobs, { recursive: true });
    fs.cpSync(srcSamurai, projDir, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}outputs`),
    });

    const pJsonPath = path.join(projDir, 'project.json');
    const pJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf8'));
    pJson.editorial_mode = 'editorial_v1';
    fs.writeFileSync(pJsonPath, JSON.stringify(pJson, null, 2));

    const qcApp = await buildApp({ projectsDir: qcProjects, jobsDir: qcJobs });
    try {
      // Missing editorial_qc.json -> editorialQcStatus = 'pending', renderUnlocked = false
      const qaPending = (await qcApp.app.inject({ method: 'GET', url: '/api/projects/ed-qc-trap/qa?ratio=9:16' })).json().qa;
      expect(qaPending.editorialQcStatus).toBe('pending');
      expect(qaPending.reasonCodes).toContain('EDITORIAL_QC_PENDING');
      expect(qaPending.renderUnlocked).toBe(false);

      // Fake pass editorial_qc.json with mismatched report sha or missing report -> stale / fail
      const outDir = path.join(projDir, 'outputs', 'preview-01');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'editorial-report.json'), JSON.stringify({ schema: 'b6-editorial-report/1', summary: {} }));
      fs.writeFileSync(
        path.join(outDir, 'editorial_qc.json'),
        JSON.stringify({
          schema: 'b6-editorial-qc/1',
          status: 'pass',
          pass: true,
          source_fingerprint: 'deadbeef_fake',
          editorial_report_sha256: '0'.repeat(64),
          frames_checked: 300,
        }),
      );
      const qaStale = (await qcApp.app.inject({ method: 'GET', url: '/api/projects/ed-qc-trap/qa?ratio=9:16' })).json().qa;
      expect(qaStale.editorialQcStatus).toBe('stale');
      expect(qaStale.reasonCodes).toContain('EDITORIAL_QC_STALE');
      expect(qaStale.renderUnlocked).toBe(false);

      // Path traversal trap on POST /analyze-editorial & GET /editorial-report
      const travPost = await qcApp.app.inject({
        method: 'POST',
        url: '/api/projects/ed-qc-trap/analyze-editorial',
        payload: { ratio: '9:16', reportRel: '../../etc/passwd' },
      });
      expect(travPost.statusCode).toBe(400);

      const travGet = await qcApp.app.inject({
        method: 'GET',
        url: '/api/projects/ed-qc-trap/editorial-report?ratio=9:16&reportRel=../../etc/passwd',
      });
      expect(travGet.statusCode).toBe(400);
    } finally {
      await qcApp.app.close();
      await fsp.rm(qcRoot, { recursive: true, force: true });
    }
  });

  it('proves editorial.shotSize UI edit alters rendered pixels and analyze-editorial writes real report', async () => {
    const pixRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'b6-ed-pix-'));
    const pixProjects = path.join(pixRoot, 'projects');
    const pixJobs = path.join(pixRoot, 'jobs');
    const srcSamurai = path.join(process.cwd(), '..', '..', 'workspace', 'projects', 'samurai-red-leaf-10s');
    const projDir = path.join(pixProjects, 'ed-pix');
    fs.mkdirSync(pixProjects, { recursive: true });
    fs.mkdirSync(pixJobs, { recursive: true });
    fs.cpSync(srcSamurai, projDir, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}outputs`),
    });

    // Hydrate editorial_runtime helpers into sandbox project
    const edRuntimeDir = path.join(process.cwd(), '..', '..', 'editorial_runtime');
    for (const f of ['b6_editorial_contract.py', 'b6_editorial_director.py']) {
      fs.copyFileSync(path.join(edRuntimeDir, f), path.join(projDir, f));
    }

    const pixApp = await buildApp({ projectsDir: pixProjects, jobsDir: pixJobs });
    try {
      const waitJob = async (jobId: string) => {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          const r = await pixApp.app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
          const j = r.json().job;
          if (!['queued', 'running'].includes(j.status)) return j;
          await new Promise((res) => setTimeout(res, 200));
        }
        throw new Error(`Timed out waiting for job ${jobId}`);
      };

      const cur = (await pixApp.app.inject({ method: 'GET', url: '/api/projects/ed-pix' })).json().project;
      const makeShots = (shotSize: 'wide' | 'close') =>
        cur.formats['9:16'].shots.map((s: Record<string, unknown>, idx: number) => ({
          ...s,
          cameraKeys: s.camera_keys ?? s.cameraKeys,
          ...(idx === 1
            ? {
                editorial: {
                  role: shotSize === 'wide' ? 'reveal' : 'reaction',
                  shotSize,
                  focus: { targetKind: 'actor_head', actorId: 'ren', propId: '', offsetXy: [0, 0], scaleHint: 1, safeMargin: 0.08 },
                  cameraMovement: 'hold',
                  transition: { kind: 'hard_cut', durationS: 0, reason: 'Scale test', preserveEyeline: true, matchAction: false },
                  intensity: 'high',
                  pacingAdvice: 'auto',
                  reactionHoldS: 0,
                  notes: '',
                },
              }
            : {}),
        }));

      const p1 = await pixApp.app.inject({
        method: 'PATCH',
        url: '/api/projects/ed-pix',
        payload: { expectedRevision: cur.meta.revision, editorialMode: 'editorial_v1', shots: makeShots('wide') },
      });
      expect(p1.statusCode).toBe(200);

      const d1 = await pixApp.app.inject({
        method: 'POST',
        url: '/api/projects/ed-pix/draft',
        payload: { ratio: '9:16', draftScale: 0.5, start: 1.0, seconds: 0.4, trustedCode: true },
      });
      expect(d1.statusCode).toBe(200);
      const j1 = await waitJob(d1.json().job.id);
      if (j1.status !== 'succeeded') {
        const logRes = await pixApp.app.inject({ method: 'GET', url: `/api/jobs/${j1.id}` });
        throw new Error(`d1 failed: ${j1.errorMessage} | logs: ${(logRes.json().logs as string[]).slice(-10).join('\n')}`);
      }
      expect(j1.status).toBe('succeeded');

      const p2 = await pixApp.app.inject({
        method: 'PATCH',
        url: '/api/projects/ed-pix',
        payload: { expectedRevision: p1.json().detail.meta.revision, editorialMode: 'editorial_v1', shots: makeShots('close') },
      });
      expect(p2.statusCode).toBe(200);

      const d2 = await pixApp.app.inject({
        method: 'POST',
        url: '/api/projects/ed-pix/draft',
        payload: { ratio: '9:16', draftScale: 0.5, start: 1.0, seconds: 0.4, trustedCode: true },
      });
      expect(d2.statusCode).toBe(200);
      const j2 = await waitJob(d2.json().job.id);
      if (j2.status !== 'succeeded') {
        const logRes = await pixApp.app.inject({ method: 'GET', url: `/api/jobs/${j2.id}` });
        throw new Error(`d2 failed: ${j2.errorMessage} | logs: ${(logRes.json().logs as string[]).slice(-12).join('\n')}`);
      }
      expect(j2.status).toBe('succeeded');

      const { resolveRealFfmpeg } = await import('../src/config.js');
      const { spawnSync } = await import('node:child_process');
      const ffmpeg = resolveRealFfmpeg();
      const png1 = path.join(pixRoot, 'wide.png');
      const png2 = path.join(pixRoot, 'ecu.png');
      spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', path.join(projDir, j1.videoPath as string), '-vf', 'select=eq(n\\,5)', '-vframes', '1', png1], { shell: false });
      spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', path.join(projDir, j2.videoPath as string), '-vf', 'select=eq(n\\,5)', '-vframes', '1', png2], { shell: false });

      const buf1 = await sharp(png1).ensureAlpha().raw().toBuffer();
      const buf2 = await sharp(png2).ensureAlpha().raw().toBuffer();
      let diffSum = 0;
      for (let i = 0; i < buf1.length; i++) diffSum += Math.abs(buf1[i] - buf2[i]);
      expect(diffSum / buf1.length).toBeGreaterThan(5.0);

      // Trigger async analyze-editorial on draft-02 video
      const reportRel = path.relative(fs.realpathSync(projDir), fs.realpathSync(j2.reportPath as string)).replace(/\\/g, '/');
      const anRes = await pixApp.app.inject({
        method: 'POST',
        url: '/api/projects/ed-pix/analyze-editorial',
        payload: { ratio: '9:16', reportRel },
      });
      if (anRes.statusCode !== 200) {
        throw new Error(`analyze-editorial ${anRes.statusCode}: ${anRes.body} (reportRel=${reportRel}, j2.reportPath=${String(j2.reportPath)})`);
      }
      expect(anRes.statusCode).toBe(200);
      const jAn = await waitJob(anRes.json().job.id);
      expect(jAn.status).toBe('succeeded');

      const edRep = await pixApp.app.inject({ method: 'GET', url: '/api/projects/ed-pix/editorial-report?ratio=9:16' });
      expect(edRep.statusCode).toBe(200);
      expect(edRep.json().available).toBe(true);
      expect(edRep.json().report.schema).toBe('b6-editorial-report/1');
      expect(Array.isArray(edRep.json().report.per_second)).toBe(true);
    } finally {
      await pixApp.app.close();
      await fsp.rm(pixRoot, { recursive: true, force: true });
    }
  }, 60000);
});
