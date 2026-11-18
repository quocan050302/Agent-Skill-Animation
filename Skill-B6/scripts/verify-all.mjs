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
const LOG_DIR = path.join(APP_ROOT, 'docs', 'agent-runs', 'B6-LOCAL-STUDIO-04');
fs.mkdirSync(LOG_DIR, { recursive: true });

const TIER = String(getOpt('--tier', 'release')).toLowerCase();
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
    const timeoutMs = Number(opts.timeoutMs ?? 600_000);
    const useShell = IS_WIN && (cmd.endsWith('.cmd') || cmd.endsWith('.bat'));
    const child = spawn(cmd, cmdArgs, {
      cwd: opts.cwd || APP_ROOT,
      env: { ...BASE_ENV, ...(opts.env || {}) },
      shell: useShell,
      detached: !IS_WIN,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const killTree = () => {
      try {
        if (!IS_WIN && child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        } else if (IS_WIN && child.pid) {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // already exited
        }
      }
    };

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          stderr += `\n[verify-all] Timed out after ${timeoutMs}ms: ${cmd} ${cmdArgs.join(' ')}`;
          killTree();
        }, timeoutMs)
      : null;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: timedOut ? 124 : code, durationMs: Date.now() - t0, stdout, stderr });
    };

    child.stdout?.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      finish(-1);
    });
    child.on('close', (code) => {
      finish(code ?? -1);
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
      id: 'disk_space_guard',
      deps: [],
      heavy: false,
      projectLock: null,
      run: async () => {
        const st = fs.statfsSync(APP_ROOT);
        const freeBytes = Number(st.bavail) * Number(st.bsize);
        const freeGiB = Number((freeBytes / (1024 ** 3)).toFixed(2));
        if (freeBytes < 1_500_000_000) {
          return { code: 1, durationMs: 1, stdout: '', stderr: `Insufficient disk space: ${freeGiB} GiB < 1.50 GiB minimum` };
        }
        return { code: 0, durationMs: 1, stdout: `freeGiB=${freeGiB}`, stderr: '' };
      },
    },
    {
      id: 'python_motion_unit_tests',
      deps: [],
      heavy: false,
      projectLock: null,
      run: () => spawnAsync(VENV_PY, ['-B', '-W', 'error::DeprecationWarning', '-m', 'unittest', 'motion_runtime/tests/test_motion_core.py', '-v']),
    },
    {
      id: 'editorial_unit',
      deps: [],
      heavy: false,
      projectLock: null,
      run: () => spawnAsync(VENV_PY, ['-B', '-W', 'error::DeprecationWarning', '-m', 'unittest', 'discover', '-s', 'editorial_runtime/tests', '-p', 'test_*.py', '-v']),
    },
    {
      id: 'frontend_typecheck',
      deps: ['workspace_build'],
      heavy: false,
      projectLock: null,
      run: () => spawnAsync(NPM_CMD, ['--workspace=app/frontend', 'run', 'typecheck']),
    },
    {
      id: 'samurai_preflight_validate',
      deps: ['hydrate_verify_existing', 'python_motion_unit_tests'],
      heavy: false,
      projectLock: 'samurai-red-leaf-10s',
      skip: TIER === 'fast',
      run: async () => {
        const proj = path.join(APP_ROOT, 'workspace', 'projects', 'samurai-red-leaf-10s');
        const runPy = path.join(proj, 'run.py');
        const p1 = await spawnAsync(VENV_PY, [runPy, 'preflight', proj, '--ratio', '9:16'], { cwd: proj });
        if (p1.code !== 0) return p1;
        return spawnAsync(VENV_PY, [runPy, 'validate', proj, '--ratio', '9:16'], { cwd: proj });
      },
    },
    {
      id: 'server_vitest',
      deps: ['workspace_build', 'upstream_doctor_checkpack', 'samurai_preflight_validate'],
      heavy: true, // Vitest includes Cowboy + Samurai UI-edit -> short render diff tests
      projectLock: 'vitest-sandbox',
      skip: TIER === 'fast',
      run: () => spawnAsync(NPM_CMD, ['--workspace=app/server', 'run', 'test']),
    },
    {
      id: 'cowboy_preflight_validate',
      deps: ['hydrate_verify_existing'],
      heavy: false,
      projectLock: 'cowboy-hat-10s',
      skip: TIER === 'fast',
      run: async () => {
        const proj = path.join(APP_ROOT, 'workspace', 'projects', 'cowboy-hat-10s');
        const runPy = path.join(proj, 'run.py');
        const p1 = await spawnAsync(VENV_PY, [runPy, 'preflight', proj, '--ratio', '9:16'], { cwd: proj });
        if (p1.code !== 0) return p1;
        return spawnAsync(VENV_PY, [runPy, 'validate', proj, '--ratio', '9:16'], { cwd: proj });
      },
    },
    {
      id: 'samurai_motion_qc_determinism',
      deps: ['samurai_preflight_validate'],
      heavy: true,
      projectLock: 'samurai-red-leaf-10s',
      skip: TIER !== 'release',
      run: async () => {
        const t0 = Date.now();
        const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b6-samurai-det-'));
        try {
          const srcSamurai = path.join(APP_ROOT, 'workspace', 'projects', 'samurai-red-leaf-10s');
          const dstSamurai = path.join(sandboxRoot, 'samurai-red-leaf-10s');
          fs.cpSync(srcSamurai, dstSamurai, {
            recursive: true,
            filter: (src) => !src.includes(`${path.sep}outputs`),
          });
          const runPy = path.join(dstSamurai, 'run.py');
          const d1 = await spawnAsync(
            VENV_PY,
            [
              runPy,
              'draft',
              dstSamurai,
              '--ratio',
              '9:16',
              '--start',
              '2.4',
              '--seconds',
              '1.0',
              '--draft-scale',
              '0.5',
              '--trusted-code',
              '--output',
              'outputs/det-slice',
              '--report',
              'outputs/det-slice/report.json',
            ],
            { cwd: dstSamurai },
          );
          if (d1.code !== 0) return { ...d1, durationMs: Date.now() - t0 };
          // Decode raw RGB pixels via FFmpeg + verify random-seek invariance [180, 0, 299, 90, 180]
          const detPreview = path.join(dstSamurai, 'outputs', 'det-slice', 'preview.mp4');
          const detDraft = path.join(dstSamurai, 'outputs', 'det-slice', 'draft.mp4');
          const mp4Path = fs.existsSync(detPreview) ? detPreview : detDraft;
          const rawRes = spawnSync(BASE_ENV.B6_REAL_FFMPEG, ['-v', 'error', '-i', mp4Path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
            encoding: null,
            maxBuffer: 256 * 1024 * 1024,
            shell: false,
          });
          if (rawRes.status !== 0) {
            return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: `FFmpeg decode parity failed: ${rawRes.stderr?.toString()}` };
          }
          const decodedPixelsSha256 = crypto.createHash('sha256').update(rawRes.stdout).digest('hex');
          const containerMp4Sha256 = crypto.createHash('sha256').update(fs.readFileSync(mp4Path)).digest('hex');

          const pySeek = `
import hashlib, json, sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, ${JSON.stringify(dstSamurai)})
import b6_actions, b6_motion_qc as mqc, b6_puppet, b6_space, scene
ch = b6_puppet.load_character(${JSON.stringify(path.join(dstSamurai, 'characters', 'ren'))})
c = SimpleNamespace(base=Path(${JSON.stringify(dstSamurai)}), fingerprint='det', viewport=SimpleNamespace(size=(360,640), native_size=(720,1280)), space=b6_space, actions=b6_actions, puppet_runtime=b6_puppet, character_packages={'ren': ch})
seq_180, ev_180 = scene._evaluate_frame(180/30.0, (720,1280), c)
seq_0, ev_0 = scene._evaluate_frame(0.0, (720,1280), c)
# Out-of-order random seek sweep
res_map = {}
for idx in [180, 0, 299, 90, 180]:
  r, ev = scene._evaluate_frame(idx/30.0, (720,1280), c)
  res_map.setdefault(idx, []).append((r.qa['beauty_sha256'], ev))
assert len(res_map[180]) == 2 and res_map[180][0][0] == res_map[180][1][0] == seq_180.qa['beauty_sha256'], 'Frame 180 random-seek pixel mismatch'
assert res_map[0][0][0] == seq_0.qa['beauty_sha256'], 'Frame 0 random-seek pixel mismatch'
geom_sha = hashlib.sha256(json.dumps([res_map[k][0][1] for k in [0, 90, 180, 299]], sort_keys=True).encode()).hexdigest()
print(json.dumps({'randomSeekPass': True, 'geometrySha256': geom_sha}))
`;
          const s1 = await spawnAsync(VENV_PY, ['-c', pySeek], { cwd: dstSamurai });
          if (s1.code !== 0) return { ...s1, durationMs: Date.now() - t0 };
          const parsed = JSON.parse(s1.stdout.trim().split(/\r?\n/).pop());
          return {
            code: 0,
            durationMs: Date.now() - t0,
            stdout: s1.stdout,
            stderr: s1.stderr,
            parityMeta: {
              decodedPixelsSha256,
              containerMp4Sha256,
              geometrySha256: parsed.geometrySha256,
              randomSeekPass: parsed.randomSeekPass,
            },
          };
        } finally {
          fs.rmSync(sandboxRoot, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'cowboy_regression_slice',
      deps: ['cowboy_preflight_validate'],
      heavy: true,
      projectLock: 'cowboy-hat-10s',
      skip: TIER !== 'release',
      run: async () => {
        const t0 = Date.now();
        const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b6-cowboy-replay-'));
        try {
          const srcCowboy = path.join(APP_ROOT, 'workspace', 'projects', 'cowboy-hat-10s');
          const dstCowboy = path.join(sandboxRoot, 'cowboy-hat-10s');
          fs.cpSync(srcCowboy, dstCowboy, {
            recursive: true,
            filter: (src) => !src.includes(`${path.sep}outputs`),
          });
          const runPy = path.join(dstCowboy, 'run.py');
          const s1 = await spawnAsync(
            VENV_PY,
            [runPy, 'draft', dstCowboy, '--ratio', '9:16', '--start', '2.65', '--seconds', '1.0', '--draft-scale', '0.5', '--trusted-code', '--output', 'outputs/slice-a', '--report', 'outputs/slice-a/report.json'],
            { cwd: dstCowboy },
          );
          if (s1.code !== 0) return { ...s1, durationMs: Date.now() - t0 };
          const s2 = await spawnAsync(
            VENV_PY,
            [runPy, 'draft', dstCowboy, '--ratio', '9:16', '--start', '5.1', '--seconds', '1.0', '--draft-scale', '0.5', '--trusted-code', '--output', 'outputs/slice-b', '--report', 'outputs/slice-b/report.json'],
            { cwd: dstCowboy },
          );
          return { ...s2, durationMs: Date.now() - t0 };
        } finally {
          fs.rmSync(sandboxRoot, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'roman_baseline_sandbox_replay',
      deps: ['hydrate_verify_existing'],
      heavy: true,
      projectLock: 'roman-gladiator-10s',
      skip: TIER !== 'release',
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
      skip: TIER === 'fast',
      run: async () => {
        const t0 = Date.now();
        const tmpCloneBase = fs.mkdtempSync(path.join(os.tmpdir(), 'b6-clean-clone-'));
        const repoTop = path.resolve(APP_ROOT, '..');
        const cloneDir = path.join(tmpCloneBase, 'repo');
        try {
          // Real git clone --local --no-hardlinks of committed outer repo
          const gitattrsCommitted =
            spawnSync('git', ['cat-file', '-e', 'HEAD:Skill-B6/.gitattributes'], { cwd: repoTop, shell: false }).status === 0;
          const cloneArgs = gitattrsCommitted
            ? ['clone', '--local', '--no-hardlinks', repoTop, cloneDir]
            : ['clone', '--local', '--no-hardlinks', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', repoTop, cloneDir];
          const gitRes = await spawnAsync('git', cloneArgs);
          if (gitRes.code !== 0) {
            return { ...gitRes, durationMs: Date.now() - t0 };
          }
          const clonedB6 = path.join(cloneDir, 'Skill-B6');
          // Check clean-clone hydration & preflight + validate for Cowboy, Samurai, and Zombie cleanly!
          const stCheck = spawnSync(
            'git',
            [
              'status',
              '--porcelain',
              'Skill-B6/workspace/projects/samurai-red-leaf-10s',
              'Skill-B6/workspace/projects/zombie-mirror-10s',
              'Skill-B6/motion_runtime',
              'Skill-B6/editorial_runtime',
              'Skill-B6/scripts/hydrate-project.mjs',
            ],
            { cwd: repoTop, encoding: 'utf8', shell: false },
          );
          const hasUncommitted = Boolean((stCheck.stdout || '').trim());
          if (hasUncommitted) {
            const syncDirs = ['motion_runtime', 'editorial_runtime', 'scripts', 'workspace/projects/samurai-red-leaf-10s', 'workspace/projects/zombie-mirror-10s'];
            const skipSegs = new Set(['outputs', 'renders', 'engine', 'fonts', 'reference', 'cache', 'temp']);
            for (const rel of syncDirs) {
              const srcAbs = path.join(APP_ROOT, rel);
              const dstAbs = path.join(clonedB6, rel);
              if (fs.existsSync(srcAbs)) {
                fs.cpSync(srcAbs, dstAbs, {
                  recursive: true,
                  filter: (src) => !src.slice(srcAbs.length).split(path.sep).filter(Boolean).some((seg) => skipSegs.has(seg)),
                });
              }
            }
          }
          // Confirm .gitignored engine/fonts/reference are indeed absent before hydration!
          const cowboyClone = path.join(clonedB6, 'workspace', 'projects', 'cowboy-hat-10s');
          const samuraiClone = path.join(clonedB6, 'workspace', 'projects', 'samurai-red-leaf-10s');
          const zombieClone = path.join(clonedB6, 'workspace', 'projects', 'zombie-mirror-10s');
          if (
            fs.existsSync(path.join(cowboyClone, 'engine')) ||
            fs.existsSync(path.join(cowboyClone, 'fonts')) ||
            fs.existsSync(path.join(samuraiClone, 'engine')) ||
            fs.existsSync(path.join(samuraiClone, 'fonts')) ||
            fs.existsSync(path.join(zombieClone, 'engine')) ||
            fs.existsSync(path.join(zombieClone, 'fonts'))
          ) {
            return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: 'Clean git clone pre-check failed: .gitignored engine/fonts unexpectedly present before hydration.' };
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
          // Validate hydrated Cowboy AND preflight+validate hydrated Samurai & Zombie cleanly from clean git clone!
          const v1 = await spawnAsync(VENV_PY, [path.join(cowboyClone, 'run.py'), 'validate', cowboyClone, '--ratio', '9:16'], { cwd: cowboyClone });
          if (v1.code !== 0) return { ...v1, durationMs: Date.now() - t0 };
          const pSam = await spawnAsync(VENV_PY, [path.join(samuraiClone, 'run.py'), 'preflight', samuraiClone, '--ratio', '9:16'], { cwd: samuraiClone });
          if (pSam.code !== 0) return { ...pSam, durationMs: Date.now() - t0 };
          const vSam = await spawnAsync(VENV_PY, [path.join(samuraiClone, 'run.py'), 'validate', samuraiClone, '--ratio', '9:16'], { cwd: samuraiClone });
          if (vSam.code !== 0) return { ...vSam, durationMs: Date.now() - t0 };
          const pZom = await spawnAsync(VENV_PY, [path.join(zombieClone, 'run.py'), 'preflight', zombieClone, '--ratio', '9:16'], { cwd: zombieClone });
          if (pZom.code !== 0) return { ...pZom, durationMs: Date.now() - t0 };
          const vZom = await spawnAsync(VENV_PY, [path.join(zombieClone, 'run.py'), 'validate', zombieClone, '--ratio', '9:16'], { cwd: zombieClone });
          return {
            ...vZom,
            stdout: `${vSam.stdout}\n${vZom.stdout}\ncleanCloneMode=${hasUncommitted ? 'git_clone_plus_working_tree' : 'pure_committed_git_clone'}`,
            durationMs: Date.now() - t0,
          };
        } finally {
          fs.rmSync(tmpCloneBase, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'editorial_metrics_samurai_baseline',
      deps: ['editorial_unit', 'samurai_preflight_validate'],
      heavy: false,
      projectLock: 'samurai-red-leaf-10s',
      skip: TIER === 'fast',
      run: async () => {
        const t0 = Date.now();
        const baselinePath = path.join(APP_ROOT, 'docs', 'agent-runs', 'B6-LOCAL-STUDIO-04', 'baselines', 'samurai-editorial-metrics.json');
        const samuraiMp4 = path.join(APP_ROOT, 'docs', 'agent-runs', 'B6-LOCAL-STUDIO-03', 'samurai-preview-10s.mp4');
        if (!fs.existsSync(baselinePath) || !fs.existsSync(samuraiMp4)) {
          return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: 'Missing Samurai editorial baseline JSON or source MP4' };
        }
        const sandboxOut = fs.mkdtempSync(path.join(os.tmpdir(), 'b6-samurai-ed-'));
        try {
          const r = await spawnAsync(VENV_PY, [
            path.join(APP_ROOT, 'editorial_runtime', 'b6_editorial_cli.py'),
            '--video', samuraiMp4,
            '--out-dir', sandboxOut,
            '--ratio', '9:16',
          ]);
          if (r.code !== 0) return { ...r, durationMs: Date.now() - t0 };
          const qc = JSON.parse(fs.readFileSync(path.join(sandboxOut, 'editorial_qc.json'), 'utf8'));
          const rep = JSON.parse(fs.readFileSync(path.join(sandboxOut, 'editorial-report.json'), 'utf8'));
          if (rep.schema !== 'b6-editorial-report/1' || qc.audience_retention_estimate !== 'unavailable') {
            return { code: 1, durationMs: Date.now() - t0, stdout: r.stdout, stderr: 'Invalid baseline editorial report schema or retention claim' };
          }
          const hasStaticErr = Array.isArray(qc.errors) && qc.errors.some((e) => String(e).includes('EDITORIAL_EXTENDED_STATIC_LULL') || String(e).includes('EDITORIAL_EXCESSIVE_DUPLICATE_SHOTS'));
          if (qc.status !== 'fail' || !hasStaticErr || Number(rep.summary?.unique_compositions ?? 99) > 4) {
            return { code: 1, durationMs: Date.now() - t0, stdout: r.stdout, stderr: `Expected Samurai static/duplicate failure on editorial QC, got status=${qc.status} errors=${JSON.stringify(qc.errors)} unique=${rep.summary?.unique_compositions}` };
          }
          return { code: 0, durationMs: Date.now() - t0, stdout: `samurai_qc=${qc.status} unique_comp=${rep.summary?.unique_compositions} errors=${JSON.stringify(qc.errors)}`, stderr: '' };
        } finally {
          fs.rmSync(sandboxOut, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'zombie_preflight_validate',
      deps: ['hydrate_verify_existing', 'editorial_unit', 'disk_space_guard'],
      heavy: false,
      projectLock: 'zombie-mirror-10s',
      skip: TIER === 'fast',
      run: async () => {
        const proj = path.join(APP_ROOT, 'workspace', 'projects', 'zombie-mirror-10s');
        const runPy = path.join(proj, 'run.py');
        const p1 = await spawnAsync(VENV_PY, [runPy, 'preflight', proj, '--ratio', '9:16'], { cwd: proj });
        if (p1.code !== 0) return p1;
        return spawnAsync(VENV_PY, [runPy, 'validate', proj, '--ratio', '9:16'], { cwd: proj });
      },
    },
    {
      id: 'zombie_draft_smoke',
      deps: ['zombie_preflight_validate'],
      heavy: true,
      projectLock: 'zombie-mirror-10s',
      skip: TIER === 'fast',
      run: async () => {
        const t0 = Date.now();
        const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b6-zombie-draft-'));
        try {
          const srcZ = path.join(APP_ROOT, 'workspace', 'projects', 'zombie-mirror-10s');
          const dstZ = path.join(sandboxRoot, 'zombie-mirror-10s');
          fs.cpSync(srcZ, dstZ, { recursive: true, filter: (src) => !src.includes(`${path.sep}outputs`) });
          const r = await spawnAsync(VENV_PY, [
            path.join(dstZ, 'run.py'), 'draft', dstZ, '--ratio', '9:16',
            '--start', '4.5', '--seconds', '1.5', '--draft-scale', '0.5',
            '--trusted-code', '--output', 'outputs/smoke-draft',
          ], { cwd: dstZ });
          if (r.code !== 0) return { ...r, durationMs: Date.now() - t0 };
          const hasMp4 = fs.existsSync(path.join(dstZ, 'outputs', 'smoke-draft', 'preview.mp4'));
          const hasSheet = fs.existsSync(path.join(dstZ, 'outputs', 'smoke-draft', 'contact-sheet.jpg'));
          if (!hasMp4 || !hasSheet) {
            return { code: 1, durationMs: Date.now() - t0, stdout: r.stdout, stderr: 'Zombie draft smoke missing preview.mp4 or contact-sheet.jpg' };
          }
          return { code: 0, durationMs: Date.now() - t0, stdout: 'zombie_draft_smoke=ok', stderr: '' };
        } finally {
          fs.rmSync(sandboxRoot, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'zombie_native_qc',
      deps: ['zombie_preflight_validate', 'editorial_unit'],
      heavy: false,
      projectLock: 'zombie-mirror-10s',
      skip: TIER === 'fast',
      run: async () => {
        const t0 = Date.now();
        const zDir = path.join(APP_ROOT, 'workspace', 'projects', 'zombie-mirror-10s');
        const outDir = path.join(zDir, 'outputs', 'preview-01');
        const mp4 = path.join(outDir, 'preview.mp4');
        const edQcPath = path.join(outDir, 'editorial_qc.json');
        const edRepPath = path.join(outDir, 'editorial-report.json');
        const mQcPath = path.join(outDir, 'motion_qc.json');
        if (![mp4, edQcPath, edRepPath, mQcPath].every((p) => fs.existsSync(p))) {
          return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: 'Missing zombie preview-01 native artifacts (preview.mp4, editorial_qc.json, motion_qc.json)' };
        }
        const ffprobeBin = BASE_ENV.B6_REAL_FFMPEG.endsWith('ffmpeg')
          ? BASE_ENV.B6_REAL_FFMPEG.slice(0, -6) + 'ffprobe'
          : 'ffprobe';
        const pr = spawnSync(ffprobeBin, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', mp4], { encoding: 'utf8', shell: false });
        if (pr.status !== 0) {
          return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: `ffprobe failed on zombie preview: ${pr.stderr}` };
        }
        const probe = JSON.parse(pr.stdout);
        const vStream = (probe.streams || []).find((s) => s.codec_type === 'video');
        const aStream = (probe.streams || []).find((s) => s.codec_type === 'audio');
        if (!vStream || Number(vStream.width) !== 720 || Number(vStream.height) !== 1280 || !aStream) {
          return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: `Unexpected zombie ffprobe geometry/audio: w=${vStream?.width} h=${vStream?.height} audio=${Boolean(aStream)}` };
        }
        const edQc = JSON.parse(fs.readFileSync(edQcPath, 'utf8'));
        const edRep = JSON.parse(fs.readFileSync(edRepPath, 'utf8'));
        const mQc = JSON.parse(fs.readFileSync(mQcPath, 'utf8'));
        if (edQc.status !== 'pass' || mQc.status !== 'pass') {
          return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: `QC fail: editorial_qc=${edQc.status} (${JSON.stringify(edQc.errors)}) motion_qc=${mQc.status}` };
        }
        if (
          edQc.audience_retention_estimate !== 'unavailable' ||
          edQc.human_visual_review !== 'PENDING' ||
          edQc.user_approval !== 'PENDING' ||
          fs.existsSync(path.join(zDir, 'approval-9x16.json'))
        ) {
          return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: 'Factual boundary violation: synthetic retention estimate or unapproved sign-off detected' };
        }
        return {
          code: 0,
          durationMs: Date.now() - t0,
          stdout: `zombie_qc=pass cuts=${edRep.summary?.cuts_detected} unique_comp=${edRep.summary?.unique_compositions} static=${edRep.summary?.longest_near_static_run_s}s`,
          stderr: '',
        };
      },
    },
    {
      id: 'editorial_determinism_replay',
      deps: ['zombie_preflight_validate', 'editorial_unit'],
      heavy: true,
      projectLock: 'zombie-mirror-10s',
      skip: TIER !== 'release',
      run: async () => {
        const t0 = Date.now();
        const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b6-zombie-det-'));
        try {
          const srcZ = path.join(APP_ROOT, 'workspace', 'projects', 'zombie-mirror-10s');
          const dstZ = path.join(sandboxRoot, 'zombie-mirror-10s');
          fs.cpSync(srcZ, dstZ, { recursive: true, filter: (src) => !src.includes(`${path.sep}outputs`) });
          const runPy = path.join(dstZ, 'run.py');
          const d1 = await spawnAsync(VENV_PY, [
            runPy, 'draft', dstZ, '--ratio', '9:16', '--start', '3.2', '--seconds', '1.0',
            '--draft-scale', '0.5', '--trusted-code', '--output', 'outputs/det-slice',
          ], { cwd: dstZ });
          if (d1.code !== 0) return { ...d1, durationMs: Date.now() - t0 };
          const mp4Path = path.join(dstZ, 'outputs', 'det-slice', 'preview.mp4');
          const rawRes = spawnSync(BASE_ENV.B6_REAL_FFMPEG, ['-v', 'error', '-i', mp4Path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
            encoding: null,
            maxBuffer: 256 * 1024 * 1024,
            shell: false,
          });
          if (rawRes.status !== 0) {
            return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: `FFmpeg decode failed: ${rawRes.stderr?.toString()}` };
          }
          const decodedPixelsSha256 = crypto.createHash('sha256').update(rawRes.stdout).digest('hex');
          const edOut = path.join(dstZ, 'outputs', 'det-slice', 'ed');
          const edCli = await spawnAsync(VENV_PY, [
            path.join(APP_ROOT, 'editorial_runtime', 'b6_editorial_cli.py'),
            '--video', mp4Path, '--out-dir', edOut, '--ratio', '9:16',
          ], { cwd: dstZ });
          if (edCli.code !== 0) return { ...edCli, durationMs: Date.now() - t0 };
          const pySeek = `
import hashlib, json, sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, ${JSON.stringify(dstZ)})
import run, scene
base = Path(${JSON.stringify(dstZ)}).resolve()
c = run.load(base, '9:16')
it = run.workflow_helper(base, 'b6_iteration', run.TRUSTED_ITERATION_SHA256)
c.actions = run.workflow_helper(base, 'b6_actions', run.TRUSTED_ACTIONS_SHA256)
c.space = run.module('b6_project_space', run.local(base, 'b6_space.py'))
c.viewport = it.RenderViewport.from_plan(c.plan, scale=0.5)
seq_264, ev_264, ed_264 = scene._evaluate_frame(264/30.0, c.viewport.size, c)
res_map = {}
for idx in [264, 0, 299, 96, 135, 264]:
  r, ev, ed = scene._evaluate_frame(idx/30.0, c.viewport.size, c)
  res_map.setdefault(idx, []).append((r.qa['beauty_sha256'], ed))
assert len(res_map[264]) == 2 and res_map[264][0][0] == res_map[264][1][0] == seq_264.qa['beauty_sha256'], 'Frame 264 random-seek pixel mismatch'
geom_sha = hashlib.sha256(json.dumps([res_map[k][0][1] for k in [0, 96, 135, 264, 299]], sort_keys=True).encode()).hexdigest()
print(json.dumps({'randomSeekPass': True, 'editorialGeometrySha256': geom_sha}))
`;
          const s1 = await spawnAsync(VENV_PY, ['-c', pySeek], { cwd: dstZ });
          if (s1.code !== 0) return { ...s1, durationMs: Date.now() - t0 };
          const parsed = JSON.parse(s1.stdout.trim().split(/\r?\n/).pop());
          return {
            code: 0,
            durationMs: Date.now() - t0,
            stdout: s1.stdout,
            stderr: s1.stderr,
            parityMeta: {
              decodedPixelsSha256,
              geometrySha256: parsed.editorialGeometrySha256,
              randomSeekPass: parsed.randomSeekPass,
            },
          };
        } finally {
          fs.rmSync(sandboxRoot, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'legacy_regression_roman_cowboy_samurai',
      deps: ['roman_baseline_sandbox_replay', 'cowboy_regression_slice', 'samurai_motion_qc_determinism'],
      heavy: false,
      projectLock: null,
      skip: TIER !== 'release',
      run: async () => {
        const t0 = Date.now();
        const hashFile = path.join(APP_ROOT, 'docs', 'agent-runs', 'B6-LOCAL-STUDIO-04', 'baselines', 'legacy-project-hashes.json');
        const expected = JSON.parse(fs.readFileSync(hashFile, 'utf8'));
        const mismatches = [];
        for (const [projName, entries] of Object.entries(expected)) {
          if (projName.startsWith('_') || typeof entries !== 'object' || !entries) continue;
          const baseDir = path.join(APP_ROOT, 'workspace', 'projects', projName);
          for (const [rel, sha] of Object.entries(entries)) {
            const p = path.join(baseDir, rel);
            if (!fs.existsSync(p)) {
              mismatches.push(`missing:${projName}/${rel}`);
              continue;
            }
            const actual = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
            if (actual !== sha) mismatches.push(`drift:${projName}/${rel}`);
          }
        }
        if (mismatches.length > 0) {
          return { code: 1, durationMs: Date.now() - t0, stdout: '', stderr: `Legacy baseline drift detected: ${mismatches.slice(0, 10).join(', ')}` };
        }
        return { code: 0, durationMs: Date.now() - t0, stdout: 'legacy_hashes=exact_match', stderr: '' };
      },
    },
    {
      id: 'playwright_e2e',
      deps: ['workspace_build', 'cowboy_preflight_validate', 'samurai_preflight_validate', 'zombie_preflight_validate', 'zombie_native_qc'],
      heavy: true,
      projectLock: 'playwright-studio',
      skip: hasFlag('--skip-e2e') || TIER !== 'release',
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
    const line = {
      ts: new Date().toISOString(),
      pass: passLabel,
      rssMiB: Math.round(process.memoryUsage().rss / 1048576),
      ...ev,
    };
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
            ...(res.parityMeta ? { parityMeta: res.parityMeta } : {}),
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
    const seqDet = seq.tasks.find((t) => t.id === 'samurai_motion_qc_determinism')?.parityMeta;
    const parDet = par.tasks.find((t) => t.id === 'samurai_motion_qc_determinism')?.parityMeta;
    const seqEdDet = seq.tasks.find((t) => t.id === 'editorial_determinism_replay')?.parityMeta;
    const parEdDet = par.tasks.find((t) => t.id === 'editorial_determinism_replay')?.parityMeta;
    const samuraiPixelsParity = Boolean(
      !seqDet ||
        (parDet &&
          seqDet.decodedPixelsSha256 === parDet.decodedPixelsSha256 &&
          seqDet.geometrySha256 === parDet.geometrySha256),
    );
    const editorialPixelsParity = Boolean(
      !seqEdDet ||
        (parEdDet &&
          seqEdDet.decodedPixelsSha256 === parEdDet.decodedPixelsSha256 &&
          seqEdDet.geometrySha256 === parEdDet.geometrySha256),
    );
    const decodedPixelsParity = samuraiPixelsParity && editorialPixelsParity;
    const containerByteParity = Boolean(!seqDet || (parDet && seqDet.containerMp4Sha256 === parDet.containerMp4Sha256));
    const parityClassification = !decodedPixelsParity
      ? 'decoded_mismatch'
      : containerByteParity
      ? 'exact_decoded_and_container_match'
      : 'container_nonbyte_identical_decoded_pixels_match';
    const allEvents = passes.flatMap((p) => p.events).map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(jsonlPath, allEvents, 'utf8');
    const summary = {
      ok: seq.ok && par.ok && parityOk && decodedPixelsParity,
      tier: TIER,
      parityOk: parityOk && decodedPixelsParity,
      decodedPixelsParity,
      containerByteParity,
      parityClassification,
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
