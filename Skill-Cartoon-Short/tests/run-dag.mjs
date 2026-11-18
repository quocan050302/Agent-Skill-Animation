#!/usr/bin/env node
/**
 * Explicit Dependency-Aware Asynchronous Test DAG Runner (SHORT-01 Section 12.2)
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
import { evaluateAllGates } from '../tools/qa/verify-gates.mjs';

const DEFAULT_TIMEOUT_MS = Number(process.env.SHORT_JOB_TIMEOUT_MS || 180000);

function runCommandAsync(cmd, args, { cwd = PROJECT_ROOT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(cmd, args, { cwd, env: { ...process.env, SHORT_MAX_RENDER_WORKERS: '1' } });
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

export async function runTestDag() {
  const dagStartedAt = Date.now();
  const freeDiskMb = checkFreeDiskMb(PROJECT_ROOT, 512);
  const cpuCount = os.cpus().length;
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
  const results = new Map();

  // Stage 1: Parallel independent lightweight checks
  await Promise.all([
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
    executeNode(
      'dependency-checks',
      [],
      async () => {
        const ff = await runCommandAsync('ffmpeg', ['-version'], { timeoutMs: 15000 });
        const fp = await runCommandAsync('ffprobe', ['-version'], { timeoutMs: 15000 });
        const py = await runCommandAsync(
          'python3',
          ['-c', 'import numpy, PIL; print(numpy.__version__, PIL.__version__)'],
          { timeoutMs: 15000 }
        );
        return {
          ffmpegFirstLine: ff.stdout.split('\n')[0],
          ffprobeFirstLine: fp.stdout.split('\n')[0],
          pythonPackages: py.stdout.trim(),
        };
      },
      results
    ),
    executeNode(
      'unit-tests',
      [],
      async () => {
        const res = await runCommandAsync('node', ['--test', 'tests/unit/source-and-motion.test.mjs']);
        return { durationMs: res.durationMs };
      },
      results
    ),
  ]);

  // Stage 2: Engine setup verification
  await executeNode(
    'engine-setup',
    ['source-audit', 'hash-verification', 'dependency-checks', 'unit-tests'],
    async () => hydrateAll(),
    results
  );

  // Stage 3: Browser smoke + integration + visual + audio + mux tests (WebGL concurrency = 1)
  await executeNode(
    'browser-smoke-and-integration',
    ['engine-setup'],
    async () => {
      const res = await runCommandAsync('node', ['--test', 'tests/integration/pipeline.test.mjs']);
      return { durationMs: res.durationMs };
    },
    results
  );

  // Stage 4: Regression, determinism, backtest, and 12 negative tests (WebGL concurrency = 1)
  await executeNode(
    'regression-backtest-negative',
    ['browser-smoke-and-integration'],
    async () => {
      const res = await runCommandAsync('node', ['--test', 'tests/regression/parity-and-negative.test.mjs']);
      return { durationMs: res.durationMs };
    },
    results
  );

  // Stage 5: E2E viewer + full render QA check (WebGL concurrency = 1)
  await executeNode(
    'e2e-viewer-and-full-render-qa',
    ['regression-backtest-negative'],
    async () => {
      const e2e = await runCommandAsync('node', ['--test', 'tests/e2e/viewer.test.mjs']);
      return { e2eDurationMs: e2e.durationMs };
    },
    results
  );

  const allNodes = [...results.values()];
  const allPassed = allNodes.every((n) => n.status === 'PASS');

  const gateReport = evaluateAllGates({ dagTestsPassed: allPassed });

  const soldierManifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'workspace/projects/soldier-baseline/work/render-manifest.json'), 'utf8')
  );
  const zombieManifest = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, 'workspace/projects/zombie-supermarket-10s/work/render-manifest.json'),
      'utf8'
    )
  );
  const stillsParity = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'workspace/projects/soldier-baseline/work/stills-parity.json'), 'utf8')
  );
  const soldierAudio = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'workspace/projects/soldier-baseline/work/audio-modes-report.json'), 'utf8')
  );
  const zombieAudio = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'workspace/projects/zombie-supermarket-10s/work/audio_report.json'), 'utf8')
  );

  const renderMetadata = {
    generatedAt: new Date().toISOString(),
    soldierBaseline: {
      metadata: soldierManifest.metadata,
      summary: soldierManifest.summary,
      sampleFrameHashes: soldierManifest.frames
        .filter((f) => [0, 44, 87, 88, 160, 215, 278, 340, 401, 470, 520, 591].includes(f.frameIndex))
        .map((f) => ({ frame: f.frameIndex, sha256: f.sha256, meanLuma: f.meanLuma })),
      stillsReferenceComparison: stillsParity,
      mp4: gateReport.soldierMp4Probe,
    },
    zombieSupermarket10s: {
      metadata: zombieManifest.metadata,
      summary: zombieManifest.summary,
      sampleFrameHashes: zombieManifest.frames
        .filter((f) => [0, 36, 70, 90, 108, 146, 175, 218, 262, 299].includes(f.frameIndex))
        .map((f) => ({ frame: f.frameIndex, sha256: f.sha256, meanLuma: f.meanLuma })),
      mp4: gateReport.zombieMp4Probe,
    },
  };

  const dagSummary = {
    ok: allPassed,
    totalDurationMs: Date.now() - dagStartedAt,
    resourcesPreflight: {
      cpuCores: cpuCount,
      freeMemMb,
      freeDiskMb,
      maxWebglWorkers: 1,
    },
    nodes: allNodes,
    gates: gateReport.gates,
    audioSummary: {
      soldier: soldierAudio,
      zombie10s: zombieAudio,
    },
  };

  fs.mkdirSync(path.join(PROJECT_ROOT, 'out'), { recursive: true });
  fs.writeFileSync(path.join(PROJECT_ROOT, 'out', 'technical-qa.json'), JSON.stringify(dagSummary, null, 2));
  fs.writeFileSync(path.join(PROJECT_ROOT, 'out', 'render-metadata.json'), JSON.stringify(renderMetadata, null, 2));

  if (!allPassed) {
    console.error(JSON.stringify(dagSummary, null, 2));
    process.exit(1);
  }
  return dagSummary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTestDag().then((summary) => {
    console.log(
      `DAG PASS (${summary.nodes.length}/${summary.nodes.length} nodes in ${summary.totalDurationMs} ms)`
    );
    for (const g of summary.gates) {
      console.log(`  ${g.gate}: ${g.status} — ${g.title}`);
    }
  });
}
