import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startViewerServer } from '../../app/server/viewer-server.mjs';
import { wavWrapPcm16 } from '../../app/server/services/gemini-transport.mjs';
import { PROJECT_ROOT } from '../../tools/setup/hydrate.mjs';

function makeTonePcm16(durationSec = 0.6, sampleRate = 24000, freq = 310) {
  const frames = Math.floor(durationSec * sampleRate);
  const buf = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    // Speech-like amplitude modulation so silencedetect finds active segments
    const env = i > frames * 0.08 && i < frames * 0.92 ? 1.0 : 0.0;
    const val = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 14000 * env);
    buf.writeInt16LE(val, i * 2);
  }
  return buf;
}

function makeMockGeminiFetch(behavior = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    if (String(url).includes('/models?')) {
      return new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-pro-preview-tts', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (behavior.mode === 'global429') {
      return new Response(
        JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Daily GenerateRequestsPerDay quota exhausted' } }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      );
    }
    if (behavior.mode === 'overloadFallback' && String(url).includes('gemini-2.5-pro-preview-tts')) {
      return new Response(
        JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'Model overloaded' } }),
        { status: 503, headers: { 'content-type': 'application/json' } }
      );
    }
    const pcm = makeTonePcm16(0.5, 24000, behavior.freq || 330);
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }],
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };
  impl.calls = calls;
  return impl;
}

function rawHttpRequest(port, pathStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathStr, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('API Security: loopback Host/Origin enforcement, path traversal rejection, and secret redaction', async () => {
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-api-sec-'));
  const srv = await startViewerServer({ port: 0, host: '127.0.0.1', settingsDir, env: {} });
  try {
    // Foreign Host rejected (DNS rebinding guard)
    const badHost = await rawHttpRequest(srv.port, '/api/health', { Host: 'evil.example:4319' });
    assert.equal(badHost.status, 403);

    // Foreign Origin rejected (CSRF guard)
    const badOrigin = await rawHttpRequest(srv.port, '/api/health', { Origin: 'https://evil.example' });
    assert.equal(badOrigin.status, 403);

    // Path traversal blocked
    const trav1 = await rawHttpRequest(srv.port, '/engine/../../.env');
    assert.equal(trav1.status, 403);
    const trav2 = await fetch(`${srv.url}/api/projects/..%2F..%2Fetc`);
    assert.equal(trav2.status >= 400, true);

    // Health reports honest BLOCKED_NO_API_KEY and zero secrets
    const health = await (await fetch(`${srv.url}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.tts.hasKey, false);
    assert.equal(health.tts.status, 'BLOCKED_NO_API_KEY');
    assert.equal(health.g03RedistributionStatus, 'BLOCKED');
  } finally {
    await srv.close();
    fs.rmSync(settingsDir, { recursive: true, force: true });
  }
});

test('API Mocked Gemini TTS: isolated concurrent per-project WAVs, global 429 halt, overload fallback, and Range playback', async () => {
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-api-tts-'));
  const mockFetch = makeMockGeminiFetch({ mode: 'overloadFallback' });
  const srv = await startViewerServer({
    port: 0,
    host: '127.0.0.1',
    settingsDir,
    env: { GEMINI_API_KEY: 'TEST_MOCK_GEMINI_KEY_000001' },
    fetchImpl: mockFetch,
  });

  const createdIds = [];
  try {
    const p1 = (
      await (
        await fetch(`${srv.url}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Concurrent TTS Alpha', storyId: 'zombie-supermarket-10s', scriptText: 'Alpha fake tanks.' }),
        })
      ).json()
    ).project;
    const p2 = (
      await (
        await fetch(`${srv.url}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Concurrent TTS Beta', storyId: 'zombie-supermarket-10s', scriptText: 'Beta spoof radio.' }),
        })
      ).json()
    ).project;
    createdIds.push(p1.projectId, p2.projectId);

    // Trigger two simultaneous TTS syntheses across two projects
    const [r1, r2] = await Promise.all([
      fetch(`${srv.url}/api/projects/${p1.projectId}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: 'Kore' }),
      }).then((r) => r.json()),
      fetch(`${srv.url}/api/projects/${p2.projectId}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: 'Charon' }),
      }).then((r) => r.json()),
    ]);

    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r1.artifact.model, 'gemini-2.5-flash-preview-tts', '503 on pro-tts should fall back cleanly to flash-tts');
    assert.notEqual(r1.artifact.rawPath, r2.artifact.rawPath, 'Concurrent projects must NEVER share global tts-output.wav');
    assert.equal(r1.artifact.rawPath.includes(p1.projectId), true);
    assert.equal(r2.artifact.rawPath.includes(p2.projectId), true);

    // Byte-range 206 streaming works for browser <audio> playback
    const rangeRes = await fetch(`${srv.url}${r1.artifact.audioUrl}`, { headers: { Range: 'bytes=0-127' } });
    assert.equal(rangeRes.status, 206);
    assert.equal((await rangeRes.arrayBuffer()).byteLength, 128);

    // Voice preview endpoint works and returns bounded ephemeral preview metadata
    const prevRes = await (
      await fetch(`${srv.url}/api/tts/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: p1.projectId, voice: 'Kore', text: 'Preview check.' }),
      })
    ).json();
    assert.equal(prevRes.ok, true);
    assert.equal(prevRes.artifact.kind, 'tts-preview');
  } finally {
    for (const id of createdIds) {
      await fetch(`${srv.url}/api/projects/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmDelete: true }),
      }).catch(() => {});
    }
    await srv.close();
    fs.rmSync(settingsDir, { recursive: true, force: true });
  }

  // Verify global 429 quota stops immediately without model hopping
  const settingsDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-api-429-'));
  const mock429 = makeMockGeminiFetch({ mode: 'global429' });
  const srv2 = await startViewerServer({
    port: 0,
    host: '127.0.0.1',
    settingsDir: settingsDir2,
    env: { GEMINI_API_KEY: 'TEST_MOCK_GEMINI_KEY_000002' },
    fetchImpl: mock429,
  });
  try {
    const res = await fetch(`${srv2.url}/api/tts/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'zombie-supermarket-10s', voice: 'Kore', text: 'Quota test.' }),
    });
    const json = await res.json();
    assert.equal(res.status, 503);
    assert.equal(json.reasonCategory, 'quota_global');
    const genCalls = mock429.calls.filter((c) => c.url.includes(':generateContent'));
    assert.equal(genCalls.length, 1, 'Global/daily 429 must HALT on first model without model-hopping');
  } finally {
    await srv2.close();
    fs.rmSync(settingsDir2, { recursive: true, force: true });
  }
});

test('API Import Audio, SUB ON vs SUB OFF render verification, duplicate-render 409, and startup crash recovery', async () => {
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-api-render-'));
  const srv = await startViewerServer({ port: 0, host: '127.0.0.1', settingsDir, env: {} });
  let testProjectId = null;

  try {
    const created = (
      await (
        await fetch(`${srv.url}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'API Render Sub Proof',
            storyId: 'zombie-supermarket-10s',
            scriptText: 'Rubber tanks fooled scouts.',
            captionsEnabled: true,
            punchWords: ['RUBBER', 'TANKS'],
          }),
        })
      ).json()
    ).project;
    testProjectId = created.projectId;

    // 1. Spoofed ZIP disguised as .wav must be rejected
    const badUpload = await fetch(`${srv.url}/api/projects/${testProjectId}/import-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'X-Filename': 'fake.wav' },
      body: Buffer.from('PK\x03\x04not-a-wav-file-at-all'),
    });
    assert.equal(badUpload.status, 400);

    // 2. Real audible WAV upload succeeds & normalizes to 48kHz stereo
    const validWav = wavWrapPcm16(makeTonePcm16(0.8, 24000, 260), 24000, 1);
    const okUpload = await fetch(`${srv.url}/api/projects/${testProjectId}/import-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'X-Filename': 'voice.wav' },
      body: validWav,
    });
    assert.equal(okUpload.status, 201);
    const upJson = await okUpload.json();
    assert.equal(upJson.artifact.normalizedSampleRate, 48000);

    // 3. Render SUB ON (18 frames fast proof) + verify double-submit 409
    const startOn = await fetch(`${srv.url}/api/projects/${testProjectId}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frameLimit: 18, preset: 'ultrafast' }),
    });
    assert.equal(startOn.status, 202);
    const jobOnId = (await startOn.json()).job.jobId;

    const dupSubmit = await fetch(`${srv.url}/api/projects/${testProjectId}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frameLimit: 18, preset: 'ultrafast' }),
    });
    assert.equal(dupSubmit.status, 409, 'Double-clicking Render must reject with 409 JOB_ALREADY_RUNNING');

    const waitTerminal = async (jid) => {
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const j = (await (await fetch(`${srv.url}/api/jobs/${jid}`)).json()).job;
        if (['COMPLETED', 'FAILED', 'CANCELED', 'BLOCKED'].includes(j.stage)) return j;
      }
      throw new Error(`Timed out waiting for job ${jid}`);
    };

    const doneOn = await waitTerminal(jobOnId);
    assert.equal(doneOn.stage, 'COMPLETED', `SUB ON job failed: ${doneOn.error}`);
    const qaOn = (await (await fetch(`${srv.url}${doneOn.exportMeta.qaUrl}`)).json()).qa;
    assert.equal(qaOn.overallStatus, 'PASS');
    assert.equal(qaOn.gates.find((g) => g.id === 'Q12').status, 'PASS');

    // 4. Switch to SUB OFF and render clean MP4 -> verify Q13 PASS and different SHA from SUB ON
    await fetch(`${srv.url}/api/projects/${testProjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captionsEnabled: false }),
    });
    const startOff = await fetch(`${srv.url}/api/projects/${testProjectId}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frameLimit: 18, preset: 'ultrafast' }),
    });
    const doneOff = await waitTerminal((await startOff.json()).job.jobId);
    assert.equal(doneOff.stage, 'COMPLETED', `SUB OFF job failed: ${doneOff.error}`);
    assert.notEqual(doneOn.exportMeta.sha256, doneOff.exportMeta.sha256);
    const qaOff = (await (await fetch(`${srv.url}${doneOff.exportMeta.qaUrl}`)).json()).qa;
    assert.equal(qaOff.gates.find((g) => g.id === 'Q13').status, 'PASS');

    // 5. Simulate stale RUNNING job on disk -> server startup must recover it to INTERRUPTED
    const staleJobDir = path.join(PROJECT_ROOT, 'workspace', 'projects', testProjectId, 'jobs', 'job-stale-crash');
    fs.mkdirSync(staleJobDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleJobDir, 'job.json'),
      JSON.stringify({ jobId: 'job-stale-crash', projectId: testProjectId, stage: 'RENDERING_FRAMES', status: 'RENDERING_FRAMES' })
    );
    const recoveredCount = srv.services.jobManager.recoverStaleJobsOnStartup();
    assert.equal(recoveredCount >= 1, true);
    const recovered = srv.services.jobManager.getJob('job-stale-crash');
    assert.equal(recovered.stage, 'INTERRUPTED');
  } finally {
    if (testProjectId) {
      await fetch(`${srv.url}/api/projects/${testProjectId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmDelete: true }),
      }).catch(() => {});
    }
    await srv.close();
    fs.rmSync(settingsDir, { recursive: true, force: true });
  }
});
