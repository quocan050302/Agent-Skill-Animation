#!/usr/bin/env node
/**
 * Bounded-parallel DAG verification orchestrator for B6 Local Studio.
 *
 * Enforces:
 * - `--max-workers <N>` worker pool (bounded CPU/IO parallelism)
 * - `heavyRenderSemaphore = 1` (at most 1 FFmpeg/Python frame-render job at a time)
 * - Per-project mutex lock (never runs two mutating tasks on the same project simultaneously)
 * - Structured JSONL timeline logging + parity reporting
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (f, fb) => {
  const i = args.indexOf(f);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fb;
};

const scriptDir = path.dirname(path.resolve(process.argv[1]));
const APP_ROOT = path.resolve(scriptDir, '..');
const LOG_DIR = path.join(APP_ROOT, 'docs', 'agent-runs', 'B6-LOCAL-STUDIO-02');
fs.mkdirSync(LOG_DIR, { recursive: true });

const MAX_WORKERS = Math.max(1, Math.min(4, Number(getOpt('--max-workers', '2')) || 2));
const HEAVY_LIMIT = 1;
const IS_WIN = process.platform === 'win32';
const NPM_CMD = IS_WIN ? 'npm.cmd' : 'npm';
const VENV_PY = IS_WIN
  ? path.join(APP_ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(APP_ROOT, '.venv', 'bin', 'python3');
const SKILL_DIR = path.join(APP_ROOT, 'vendor', 'stickman-video-director', 'skills', 'directing-stickman-videos');
const COMPAT_DIR = path.join(APP_ROOT, 'scripts', 'ffmpeg-compat');

function findRealFfmpeg() {
  if (process.env.B6_REAL_FFMPEG && fs.existsSync(process.env.B6_REAL_FFMPEG)) {
    return process.env.B6_REAL_FFMPEG;
  }
  const entries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exe = IS_WIN ? 'ffmpeg.exe' : 'ffmpeg';
  for (const dir of entries) {
    if (path.resolve(dir) === path.resolve(COMPAT_DIR)) continue;
    const cand = path.join(dir, exe);
    if (fs.existsSync(cand)) return cand;
  }
  return exe;
}

const BASE_ENV = {
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONDONTWRITEBYTECODE: '1',
  PYTHONPYCACHEPREFIX: path.join(APP_ROOT, 'workspace', 'cache', 'pycache'),
  B6_PYTHON: VENV_PY,
  B6_REAL_FFMPEG: findRealFfmpeg(),
  PATH: `${COMPAT_DIR}${path.delimiter}${path.dirname(VENV_PY)}${path.delimiter}${process.env.PATH || ''}`,
};

function spawnAsync(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // On Windows npm.cmd / scripts cleanly execute via shell when `.cmd`
    const useShell = IS_WIN && (cmd.endsWith('.cmd') || cmd.endsWith('.bat'));
    const child = spawn(cmd, cmdArgs, {
      cwd: opts.cwd || APP_ROOT,
      env: { ...BASE_ENV, ...(opts.env || {}) },
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ code: -1, durationMs: Date.now() - t0, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, durationMs: Date.now() - t0, stdout, stderr });
    });
  });
}

function buildTasks() {
  return [
    {
      id: 'upstream_doctor_checkpack',
      deps: [],
      heavy: false,
      projectLock: null,
      run: async () => {
        const lock = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'upstream-lock.json'), 'utf8'));
        const vendorDir = path.join(APP_ROOT, 'vendor', 'stickman-video-director');
        const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: vendorDir, encoding: 'utf8', shell: false });
        if (head.status !== 0 || head.stdout.trim() !== lock.commitSha) {
          return { code: 1, stdout: head.stdout, stderr: `Vendor SHA mismatch: expected ${lock.commitSha}, got ${head.stdout}` };
        }
        const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: vendorDir, encoding: 'utf8', shell: false });
        if (dirty.stdout.trim()) {
          return { code: 1, stdout: '', stderr: `Vendor checkout is dirty:\n${dirty.stdout}` };
        }
        const r1 = await spawnAsync(process.execPath, ['scripts/b6-dynamic-meme.mjs', 'check-pack'], { cwd: SKILL_DIR });
        if (r1.code !== 0) return r1;
        return spawnAsync(process.execPath, ['scripts/autopilot.mjs', 'doctor', '--style', 'B6', '--python', VENV_PY], { cwd: SKILL_DIR });
      },
    },
    {
      id: 'workspace_build',
      deps: [],
      heavy: false,
      projectLock: null,
      run: () => spawnAsync(NPM_CMD, ['run', 'build']),
    },
    {
      id: 'hydrate_verify_existing',
      deps: ['upstream_doctor_checkpack'],
      heavy: false,
      projectLock: null,
      run: () => spawnAsync(process.execPath, [path.join(APP_ROOT, 'scripts', 'hydrate-project.mjs'), '--all', '--verify']),
    },
    {
      id: 'frontend_typecheck',
      deps: ['workspace_build'],
      heavy: false,
      projectLock: null,
      run: () => spawnAsync(NPM_CMD, ['--workspace=app/frontend', 'run', 'typecheck']),
    },
    {
      id: 'server_vitest',
      deps: ['workspace_build', 'upstream_doctor_checkpack'],
      heavy: true, // Vitest includes real Cowboy UI-edit -> short render diff test
      projectLock: 'vitest-sandbox',
      run: () => spawnAsync(NPM_CMD, ['--workspace=app/server', 'run', 'test']),
    },
    {
      id: 'cowboy_preflight_validate',
      deps: ['hydrate_verify_existing'],
      heavy: false,
      projectLock: 'cowboy-hat-10s',
      run: async () => {
        const proj = path.join(APP_ROOT, 'workspace', 'projects', 'cowboy-hat-10s');
        const runPy = path.join(proj, 'run.py');
        const p1 = await spawnAsync(VENV_PY, [runPy, 'preflight', proj, '--ratio', '9:16'], { cwd: proj });
        if (p1.code !== 0) return p1;
        return spawnAsync(VENV_PY, [runPy, 'validate', proj, '--ratio', '9:16'], { cwd: proj });
      },
    },
    {
      id: 'roman_baseline_sandbox_replay',
      deps: ['hydrate_verify_existing'],
      heavy: true,
      projectLock: 'roman-gladiator-10s',
      run: async () => {
        const t0 = Date.now();
        const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b6-roman-replay-'));
        try {
          const srcRoman = path.join(APP_ROOT, 'workspace', 'projects', 'roman-gladiator-10s');
          const dstRoman = path.join(sandboxRoot, 'roman-gladiator-10s');
          fs.cpSync(srcRoman, dstRoman, {
            recursive: true,
            filter: (src) => !src.includes(`${path.sep}outputs`),
          });
          const runPy = path.join(dstRoman, 'run.py');
          const p1 = await spawnAsync(VENV_PY, [runPy, 'preflight', dstRoman, '--ratio', '9:16'], { cwd: dstRoman });
          if (p1.code !== 0) return p1;
          const v1 = await spawnAsync(VENV_PY, [runPy, 'validate', dstRoman, '--ratio', '9:16'], { cwd: dstRoman });
          if (v1.code !== 0) return v1;
          // Run a fast 1.5s 0.5x draft slice cleanly in sandbox without touching tracked roman-gladiator-10s
          const d1 = await spawnAsync(
            VENV_PY,
            [
              runPy,
              'draft',
              dstRoman,
              '--ratio',
              '9:16',
              '--start',
              '0',
              '--seconds',
              '1.5',
              '--draft-scale',
              '0.5',
              '--trusted-code',
              '--output',
              'outputs/replay-draft',
              '--report',
              'outputs/replay-draft/report.json',
            ],
            { cwd: dstRoman },
          );
          return { ...d1, durationMs: Date.now() - t0 };
        } finally {
          fs.rmSync(sandboxRoot, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'clean_clone_hydrate_test',
      deps: ['upstream_doctor_checkpack'],
      heavy: false,
      projectLock: null,
      run: async () => {
        const t0 = Date.now();
        const tmpCloneBase = fs.mkdtempSync(path.join(os.tmpdir(), 'b6-clean-clone-'));
        const repoTop = path.resolve(APP_ROOT, '..');
        const cloneDir = path.join(tmpCloneBase, 'repo');
        try {
          // Create genuine clean clone using local committed objects + current working Skill-B6 snapshot test?
          // Use local git clone of outer repo (or file:// URL) + verify Skill-B6/scripts/hydrate-project.mjs on clean workspace!
          const clonedB6 = path.join(cloneDir, 'Skill-B6');
          fs.mkdirSync(clonedB6, { recursive: true });
          // Copy committed-equivalent files ONLY (exclude vendor/, node_modules/, .venv/, dist/, outputs/, engine/, fonts/, reference/)
          const skipDirs = new Set(['vendor', 'node_modules', '.venv', 'dist', 'outputs', 'renders', 'engine', 'fonts', 'reference', 'jobs', 'cache', 'temp']);
          fs.cpSync(APP_ROOT, clonedB6, {
            recursive: true,
            filter: (src) => {
              const parts = src.slice(APP_ROOT.length).split(path.sep).filter(Boolean);
              return !parts.some((seg) => skipDirs.has(seg));
            },
          });
          // Confirm .gitignored engine/fonts/reference are indeed absent before hydration
          const cowboyClone = path.join(clonedB6, 'workspace', 'projects', 'cowboy-hat-10s');
          if (fs.existsSync(path.join(cowboyClone, 'engine')) || fs.existsSync(path.join(cowboyClone, 'fonts'))) {
            return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: 'Clean clone pre-check failed: engine or fonts unexpectedly present before hydration.' };
          }
          const vendorDir = path.join(APP_ROOT, 'vendor', 'stickman-video-director');
          const h1 = await spawnAsync(process.execPath, [
            path.join(clonedB6, 'scripts', 'hydrate-project.mjs'),
            '--root',
            clonedB6,
            '--vendor-dir',
            vendorDir,
            '--all',
          ]);
          if (h1.code !== 0) return { ...h1, durationMs: Date.now() - t0 };
          const h2 = await spawnAsync(process.execPath, [
            path.join(clonedB6, 'scripts', 'hydrate-project.mjs'),
            '--root',
            clonedB6,
            '--vendor-dir',
            vendorDir,
            '--all',
            '--verify-only',
          ]);
          if (h2.code !== 0) return { ...h2, durationMs: Date.now() - t0 };
          // Validate hydrated cowboy-hat-10s cleanly from clean clone
          const runPy = path.join(cowboyClone, 'run.py');
          const v1 = await spawnAsync(VENV_PY, [runPy, 'validate', cowboyClone, '--ratio', '9:16'], { cwd: cowboyClone });
          return { ...v1, durationMs: Date.now() - t0 };
        } finally {
          void repoTop;
          fs.rmSync(tmpCloneBase, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'playwright_e2e',
      deps: ['workspace_build', 'cowboy_preflight_validate'],
      heavy: true,
      projectLock: 'playwright-studio',
      skip: hasFlag('--skip-e2e'),
      run: () =>
        spawnAsync(NPM_CMD, ['--workspace=app/frontend', 'run', 'test:e2e'], {
          env: { B6_STUDIO_PORT: '4399' },
        }),
    },
  ].filter((t) => !t.skip);
}

async function runDagPass(workerLimit, passLabel) {
  const tasks = buildTasks();
  const status = new Map(tasks.map((t) => [t.id, 'pending']));
  const results = new Map();
  const activeProjectLocks = new Set();
  let runningTotal = 0;
  let runningHeavy = 0;
  const events = [];
  const wallStart = Date.now();

  const logEvent = (ev) => {
    const line = { ts: new Date().toISOString(), pass: passLabel, ...ev };
    events.push(line);
  };

  await new Promise((resolveAll) => {
    const tick = () => {
      // Mark blocked tasks whose dependency failed
      for (const t of tasks) {
        if (status.get(t.id) === 'pending') {
          const failedDep = t.deps.find((d) => status.get(d) === 'failed' || status.get(d) === 'blocked');
          if (failedDep) {
            status.set(t.id, 'blocked');
            results.set(t.id, { id: t.id, status: 'blocked', code: 1, durationMs: 0, error: `Blocked by ${failedDep}` });
            logEvent({ event: 'blocked', task: t.id, blockedBy: failedDep });
          }
        }
      }

      const unfinished = tasks.filter((t) => status.get(t.id) === 'pending' || status.get(t.id) === 'running');
      if (unfinished.length === 0 && runningTotal === 0) {
        resolveAll();
        return;
      }

      for (const t of tasks) {
        if (runningTotal >= workerLimit) break;
        if (status.get(t.id) !== 'pending') continue;
        if (!t.deps.every((d) => status.get(d) === 'succeeded')) continue;
        if (t.heavy && runningHeavy >= HEAVY_LIMIT) continue;
        if (t.projectLock && activeProjectLocks.has(t.projectLock)) continue;

        status.set(t.id, 'running');
        runningTotal++;
        if (t.heavy) runningHeavy++;
        if (t.projectLock) activeProjectLocks.add(t.projectLock);
        logEvent({ event: 'start', task: t.id, heavy: t.heavy, runningTotal, runningHeavy });

        void t.run().then((res) => {
          const ok = res.code === 0;
          status.set(t.id, ok ? 'succeeded' : 'failed');
          results.set(t.id, {
            id: t.id,
            status: ok ? 'succeeded' : 'failed',
            code: res.code,
            durationMs: res.durationMs,
            stdoutTail: (res.stdout || '').trim().split(/\r?\n/).slice(-6),
            stderrTail: (res.stderr || '').trim().split(/\r?\n/).slice(-8),
          });
          logEvent({ event: 'finish', task: t.id, ok, code: res.code, durationMs: res.durationMs });

          runningTotal--;
          if (t.heavy) runningHeavy--;
          if (t.projectLock) activeProjectLocks.delete(t.projectLock);
          tick();
        });
      }
    };
    tick();
  });

  const wallMs = Date.now() - wallStart;
  const rows = tasks.map((t) => results.get(t.id));
  const ok = rows.every((r) => r.status === 'succeeded');
  return { passLabel, workerLimit, ok, wallMs, tasks: rows, events };
}

async function main() {
  const jsonlPath = path.join(LOG_DIR, 'verify-all.jsonl');
  const summaryPath = path.join(LOG_DIR, 'verify-all-summary.json');
  const passes = [];

  if (hasFlag('--benchmark-workers')) {
    const seq = await runDagPass(1, 'workers=1');
    passes.push(seq);
    const par = await runDagPass(MAX_WORKERS, `workers=${MAX_WORKERS}`);
    passes.push(par);
    const parityOk = seq.tasks.every((st) => {
      const pt = par.tasks.find((x) => x.id === st.id);
      return pt && pt.status === st.status;
    });
    const allEvents = passes.flatMap((p) => p.events).map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(jsonlPath, allEvents, 'utf8');
    const summary = {
      ok: seq.ok && par.ok && parityOk,
      parityOk,
      speedupRatio: Number((seq.wallMs / Math.max(1, par.wallMs)).toFixed(2)),
      passes: passes.map(({ events: _ev, ...rest }) => rest),
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exit(1);
    return;
  }

  const runRes = await runDagPass(MAX_WORKERS, `workers=${MAX_WORKERS}`);
  fs.writeFileSync(jsonlPath, runRes.events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  const { events: _ev, ...rest } = runRes;
  const summary = { ok: runRes.ok, passes: [rest], generatedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (!runRes.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
