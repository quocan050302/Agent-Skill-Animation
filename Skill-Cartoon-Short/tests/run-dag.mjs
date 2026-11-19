#!/usr/bin/env node
/**
 * High-Throughput Resource-Aware Bounded Async Test DAG Runner (SHORT-01 + QA-TTS-01 Section 11)
 *
 * Parallel scheduling rules (strictly deterministic & resource-bounded):
 * - Stage 1 (bounded parallel <= min(4, cpuCores)): source-audit, hash-verification,
 *   dependency-checks, frontend-typecheck-build, unit-source-motion, unit-tts-studio.
 * - Stage 2: engine-setup (hydrates soldier-baseline, zombie-supermarket-10s, ghost-army-ww2-30s).
 * - Stage 3 (bounded 2-way parallel over isolated dirs, WebGL workers <= 2):
 *   `tests/integration/pipeline.test.mjs` || `tests/integration/studio-api.test.mjs`
 * - Stage 4 (bounded 2-way parallel):
 *   Ghost Army 10-frame **serial vs parallel 2-worker SHA-256 bit-exact parity** check ||
 *   `tests/regression/parity-and-negative.test.mjs`
 * - Stage 5 (bounded 2-way parallel on ephemeral loopback ports):
 *   `tests/e2e/viewer.test.mjs` (/legacy) || `tests/e2e/studio-ui.test.mjs` (1440/768/390/320)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  checkFreeDiskMb,
  hydrateAll,
  loadSourceManifest,
  PROJECT_ROOT,
  verifyVendorSnapshot,
} from '../tools/setup/hydrate.mjs';
import { ShortRendererSession } from '../engine/adapters/renderer-adapter.mjs';
import { evaluateAllGates } from '../tools/qa/verify-gates.mjs';

const DEFAULT_TIMEOUT_MS = Number(process.env.SHORT_JOB_TIMEOUT_MS || 240000);

function runCommandAsync(cmd, args, { cwd = PROJECT_ROOT, timeoutMs = DEFAULT_TIMEOUT_MS, envExtra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, SHORT_MAX_RENDER_WORKERS: '2', ...envExtra },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        reject(new Error(`TIMEOUT after ${timeoutMs}ms: ${cmd} ${args.join(' ')}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`EXIT_${code}: ${cmd} ${args.join(' ')}\n${stderr || stdout}`));
        return;
      }
      resolve({ code, durationMs, stdout, stderr });
    });
  });
}

async function runPoolBounded(tasks, maxConcurrent) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(maxConcurrent, tasks.length) }, async () => {
    while (idx < tasks.length) {
      const current = idx++;
      results[current] = await tasks[current]();
    }
  });
  await Promise.all(workers);
  return results;
}

async function executeNode(id, deps, fn, resultsMap) {
  for (const dep of deps) {
    const parent = resultsMap.get(dep);
    if (!parent || parent.status !== 'PASS') {
      const blocked = {
        id,
        deps,
        status: 'BLOCKED',
        durationMs: 0,
        error: `Blocked by failed dependency "${dep}"`,
      };
      resultsMap.set(id, blocked);
      return blocked;
    }
  }

  const t0 = Date.now();
  try {
    const detail = await fn();
    const rec = { id, deps, status: 'PASS', durationMs: Date.now() - t0, detail };
    resultsMap.set(id, rec);
    return rec;
  } catch (err) {
    const rec = {
      id,
      deps,
      status: 'FAIL',
      durationMs: Date.now() - t0,
      error: err?.message || String(err),
    };
    resultsMap.set(id, rec);
    return rec;
  }
}

function readJsonIfExists(relPath) {
  const abs = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

export async function runTestDag({ expectedBranch = 'QA' } = {}) {
  const dagStartedAt = Date.now();
  const freeDiskMb = checkFreeDiskMb(PROJECT_ROOT, 512);
  const cpuCount = os.cpus().length;
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
  const lightConcurrency = Math.min(4, Math.max(2, totalMemMb >= 8192 ? cpuCount : 2));
  const webglConcurrency = totalMemMb >= 8192 && cpuCount >= 4 ? 2 : 1;
  const results = new Map();

  // Stage 1: True 4-way bounded parallel lightweight checks, split unit suites, and SPA build
  await runPoolBounded(
    [
      () =>
        executeNode(
          'source-audit',
          [],
          async () => {
            const m = loadSourceManifest();
            if (m.entries.length !== 14) throw new Error('Expected 14 kit entries');
            return { archiveEntries: m.entries.length, missingInputsRecorded: m.missingInputs.length };
          },
          results
        ),
      () =>
        executeNode(
          'hash-verification',
          [],
          async () => {
            const m = loadSourceManifest();
            const v = verifyVendorSnapshot({
              vendorKitDir: path.join(PROJECT_ROOT, 'vendor', 'cartoon-short-kit'),
              manifest: m,
            });
            if (!v.allMatched) throw new Error(`Hash mismatch: ${JSON.stringify(v.mismatches)}`);
            return { verifiedFiles: v.checkedCount };
          },
          results
        ),
      () =>
        executeNode(
          'dependency-checks',
          [],
          async () => {
            const [ff, fp, py] = await Promise.all([
              runCommandAsync('ffmpeg', ['-version'], { timeoutMs: 15000 }),
              runCommandAsync('ffprobe', ['-version'], { timeoutMs: 15000 }),
              runCommandAsync('python3', ['-c', 'import numpy, PIL; print(numpy.__version__, PIL.__version__)'], {
                timeoutMs: 15000,
              }),
            ]);
            return {
              ffmpegFirstLine: ff.stdout.split('\n')[0],
              ffprobeFirstLine: fp.stdout.split('\n')[0],
              pythonPackages: py.stdout.trim(),
            };
          },
          results
        ),
      () =>
        executeNode(
          'frontend-typecheck-build',
          [],
          async () => {
            const res = await runCommandAsync('npm', ['run', 'build'], { timeoutMs: 90000 });
            return { durationMs: res.durationMs };
          },
          results
        ),
      () =>
        executeNode(
          'unit-source-motion',
          [],
          async () => {
            const res = await runCommandAsync('node', ['--test', 'tests/unit/source-and-motion.test.mjs']);
            return { durationMs: res.durationMs };
          },
          results
        ),
      () =>
        executeNode(
          'unit-tts-studio',
          [],
          async () => {
            const res = await runCommandAsync('node', ['--test', 'tests/unit/tts-and-studio.test.mjs']);
            return { durationMs: res.durationMs };
          },
          results
        ),
    ],
    lightConcurrency
  );

  // Stage 2: Engine hydration (depends on audit/hash/deps/unit)
  await executeNode(
    'engine-setup',
    ['source-audit', 'hash-verification', 'dependency-checks', 'unit-source-motion', 'unit-tts-studio'],
    async () => hydrateAll(),
    results
  );

  // Stage 3: Bounded 2-way parallel integration tests over isolated directories
  await runPoolBounded(
    [
      () =>
        executeNode(
          'integration-pipeline',
          ['engine-setup'],
          async () => {
            const res = await runCommandAsync('node', ['--test', 'tests/integration/pipeline.test.mjs']);
            return { durationMs: res.durationMs };
          },
          results
        ),
      () =>
        executeNode(
          'integration-studio-api',
          ['engine-setup'],
          async () => {
            const res = await runCommandAsync('node', ['--test', 'tests/integration/studio-api.test.mjs']);
            return { durationMs: res.durationMs };
          },
          results
        ),
    ],
    webglConcurrency
  );

  // Stage 4: Bounded 2-way parallel Ghost Army serial-vs-parallel parity & regression/negative suite
  await runPoolBounded(
    [
      () =>
        executeNode(
          'ghost-army-parallel-parity',
          ['integration-pipeline', 'integration-studio-api'],
          async () => {
            const sampleFrames = [0, 68, 120, 190, 260, 315, 410, 510, 680, 860];
            const outSerial = path.join(PROJECT_ROOT, 'workspace', 'cache', 'ghost-det-serial');
            const outParallel = path.join(PROJECT_ROOT, 'workspace', 'cache', 'ghost-det-parallel');
            fs.rmSync(outSerial, { recursive: true, force: true });
            fs.rmSync(outParallel, { recursive: true, force: true });

            const renderOnce = async (outDir, workers) => {
              const s = new ShortRendererSession();
              try {
                await s.initialize({ projectId: 'ghost-army-ww2-30s' });
                return await s.renderFrameList(sampleFrames, {
                  outputDir: outDir,
                  quality: 0.94,
                  parallel: workers > 1,
                  workers,
                });
              } finally {
                await s.dispose();
              }
            };

            const [serialRes, parallelRes] = await Promise.all([
              renderOnce(outSerial, 1),
              renderOnce(outParallel, 2),
            ]);
            for (let i = 0; i < sampleFrames.length; i++) {
              if (serialRes.frames[i].sha256 !== parallelRes.frames[i].sha256) {
                throw new Error(`SERIAL_VS_PARALLEL_HASH_MISMATCH at frame ${sampleFrames[i]}`);
              }
            }
            return {
              verifiedFrames: sampleFrames.length,
              serialWorkers: serialRes.workersUsed,
              parallelWorkers: parallelRes.workersUsed,
              serialMs: serialRes.elapsedMs,
              parallelMs: parallelRes.elapsedMs,
              bitExactMatch: true,
            };
          },
          results
        ),
      () =>
        executeNode(
          'regression-backtest-negative',
          ['integration-pipeline', 'integration-studio-api'],
          async () => {
            const res = await runCommandAsync('node', ['--test', 'tests/regression/parity-and-negative.test.mjs']);
            return { durationMs: res.durationMs };
          },
          results
        ),
    ],
    webglConcurrency
  );

  // Stage 5: Bounded 2-way parallel E2E tests (Legacy /legacy viewer || Dark Studio React SPA)
  await runPoolBounded(
    [
      () =>
        executeNode(
          'e2e-legacy-viewer',
          ['frontend-typecheck-build', 'ghost-army-parallel-parity', 'regression-backtest-negative'],
          async () => {
            const res = await runCommandAsync('node', ['--test', 'tests/e2e/viewer.test.mjs']);
            return { durationMs: res.durationMs };
          },
          results
        ),
      () =>
        executeNode(
          'e2e-studio-ui',
          ['frontend-typecheck-build', 'ghost-army-parallel-parity', 'regression-backtest-negative'],
          async () => {
            const res = await runCommandAsync('node', ['--test', 'tests/e2e/studio-ui.test.mjs']);
            return { durationMs: res.durationMs };
          },
          results
        ),
    ],
    webglConcurrency
  );

  const allNodes = [...results.values()];
  const allPassed = allNodes.every((n) => n.status === 'PASS');

  const gateReport = evaluateAllGates({ dagTestsPassed: allPassed, expectedBranch });

  const soldierManifest = readJsonIfExists('workspace/projects/soldier-baseline/work/render-manifest.json');
  const zombieManifest = readJsonIfExists('workspace/projects/zombie-supermarket-10s/work/render-manifest.json');
  const stillsParity = readJsonIfExists('workspace/projects/soldier-baseline/work/stills-parity.json');
  const soldierAudio = readJsonIfExists('workspace/projects/soldier-baseline/work/audio-modes-report.json');
  const zombieAudio = readJsonIfExists('workspace/projects/zombie-supermarket-10s/work/audio_report.json');
  const ghostManifest = readJsonIfExists('workspace/projects/ghost-army-ww2-30s/out/ghost-army-ww2-30s-manifest.json');

  const dagSummary = {
    ok: allPassed,
    ranAt: new Date().toISOString(),
    totalDurationMs: Date.now() - dagStartedAt,
    resourcesPreflight: {
      cpuCores: cpuCount,
      freeMemMb,
      totalMemMb,
      freeDiskMb,
      lightConcurrency,
      maxWebglWorkers: webglConcurrency,
    },
    nodes: allNodes,
    gates: gateReport.gates,
    ghostArmyDemoSummary: ghostManifest
      ? {
          title: ghostManifest.title,
          qaStatus: ghostManifest.qaStatus,
          subOnSha256: ghostManifest.artifacts?.subOnMp4?.sha256,
          durationSec: ghostManifest.mp4Probe?.durationSec,
          frames: ghostManifest.mp4Probe?.video?.nbFrames,
        }
      : null,
    audioSummary: {
      soldier: soldierAudio,
      zombie10s: zombieAudio,
    },
  };

  fs.mkdirSync(path.join(PROJECT_ROOT, 'out'), { recursive: true });
  fs.writeFileSync(path.join(PROJECT_ROOT, 'out', 'technical-qa.json'), JSON.stringify(dagSummary, null, 2));
  if (soldierManifest && zombieManifest) {
    const renderMetadata = {
      generatedAt: new Date().toISOString(),
      soldierBaseline: {
        metadata: soldierManifest.metadata,
        summary: soldierManifest.summary,
        stillsReferenceComparison: stillsParity,
        mp4: gateReport.soldierMp4Probe,
      },
      zombieSupermarket10s: {
        metadata: zombieManifest.metadata,
        summary: zombieManifest.summary,
        mp4: gateReport.zombieMp4Probe,
      },
      ghostArmy30s: ghostManifest,
    };
    fs.writeFileSync(path.join(PROJECT_ROOT, 'out', 'render-metadata.json'), JSON.stringify(renderMetadata, null, 2));
  }

  if (!allPassed) {
    console.error(JSON.stringify(dagSummary, null, 2));
    process.exit(1);
  }
  return dagSummary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTestDag().then((summary) => {
    console.log(
      `DAG PASS (${summary.nodes.length}/${summary.nodes.length} nodes in ${summary.totalDurationMs} ms, lightConcurrency=${summary.resourcesPreflight.lightConcurrency}, webglWorkers=${summary.resourcesPreflight.maxWebglWorkers})`
    );
    for (const g of summary.gates) {
      console.log(`  ${g.gate}: ${g.status} — ${g.title}`);
    }
  });
}
