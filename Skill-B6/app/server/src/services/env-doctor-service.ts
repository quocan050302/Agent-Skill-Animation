import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_ROOT,
  FFMPEG_COMPAT_DIR,
  MIN_FREE_BYTES_RENDER,
  PROJECTS_DIR,
  PYCACHE_DIR,
  SKILL_DIR,
  VENDOR_ROOT,
  WARN_FREE_BYTES_RENDER,
  resolvePythonExe,
  resolveRealFfmpeg,
  resolveRealFfprobe,
} from '../config.js';
import { getFreeDiskBytes } from '../utils/fs-safe.js';

export interface DoctorReport {
  checkedAt: string;
  ok: boolean;
  appRoot: string;
  vendorRoot: string;
  skillDir: string;
  projectsDir: string;
  executables: {
    node: { path: string; version: string; ok: boolean };
    python: { path: string; version: string; importsOk: boolean; numpy?: string; pillow?: string; cv2?: string; ok: boolean };
    ffmpeg: { path: string; version: string; supportsVsync: boolean; compatShimActive: boolean; ok: boolean };
    ffprobe: { path: string; version: string; ok: boolean };
  };
  upstreamDoctor: {
    ok: boolean;
    checks: Record<string, boolean>;
    rawError?: string;
  };
  disk: {
    freeBytes: number;
    freeGiB: number;
    okForRender: boolean;
    lowSpaceWarning: boolean;
  };
  capabilities: {
    imageGenerationRoute: string;
    ttsRoute: string;
    codeRenderer: string;
  };
}

export class EnvDoctorService {
  getReport(): DoctorReport {
    const pythonExe = resolvePythonExe();
    const realFfmpeg = resolveRealFfmpeg();
    const ffprobeExe = resolveRealFfprobe();
    const compatShimExe = path.join(FFMPEG_COMPAT_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const compatShimActive = fs.existsSync(compatShimExe);

    const nodeOk = Number(process.versions.node.split('.')[0]) >= 20;

    // Check Python
    const pyCheck = spawnSync(
      pythonExe,
      [
        '-c',
        'import sys, json, numpy, PIL, cv2; print(json.dumps({"version": sys.version.split()[0], "numpy": numpy.__version__, "pillow": PIL.__version__, "cv2": cv2.__version__}))',
      ],
      { encoding: 'utf8', shell: false, timeout: 10000 },
    );
    let pyInfo = { version: 'unknown', numpy: undefined as string | undefined, pillow: undefined as string | undefined, cv2: undefined as string | undefined };
    const pyImportsOk = pyCheck.status === 0;
    if (pyImportsOk) {
      try {
        pyInfo = JSON.parse(pyCheck.stdout.trim());
      } catch {
        // keep defaults
      }
    }

    // Check FFmpeg
    const ffCheck = spawnSync(realFfmpeg, ['-version'], { encoding: 'utf8', shell: false, timeout: 5000 });
    const ffOk = ffCheck.status === 0;
    const ffVersion = ffOk ? (ffCheck.stdout.split(/\r?\n/)[0] ?? 'unknown') : 'missing';
    const ffHelp = ffOk ? spawnSync(realFfmpeg, ['-h'], { encoding: 'utf8', shell: false, timeout: 5000 }) : null;
    const supportsVsync = ffHelp ? /-vsync\b/.test(ffHelp.stdout + ffHelp.stderr) : false;

    // Check FFprobe
    const fpCheck = spawnSync(ffprobeExe, ['-version'], { encoding: 'utf8', shell: false, timeout: 5000 });
    const fpOk = fpCheck.status === 0;
    const fpVersion = fpOk ? (fpCheck.stdout.split(/\r?\n/)[0] ?? 'unknown') : 'missing';

    // Run upstream doctor --style B6
    const env = {
      ...process.env,
      B6_PYTHON: pythonExe,
      PYTHONUTF8: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPYCACHEPREFIX: PYCACHE_DIR,
    };
    const upDoc = spawnSync(
      process.execPath,
      [path.join(SKILL_DIR, 'scripts', 'autopilot.mjs'), 'doctor', '--style', 'B6', '--python', pythonExe],
      { cwd: SKILL_DIR, env, encoding: 'utf8', shell: false, timeout: 20000 },
    );
    let upstreamChecks: Record<string, boolean> = {};
    let upstreamOk = upDoc.status === 0;
    let rawError: string | undefined;
    try {
      const parsed = JSON.parse(upDoc.stdout || '{}') as { checks?: Record<string, boolean> };
      upstreamChecks = parsed.checks ?? {};
      if (Object.values(upstreamChecks).some((v) => !v)) {
        upstreamOk = false;
      }
    } catch {
      upstreamOk = false;
      rawError = upDoc.stderr || upDoc.stdout || 'Failed to parse doctor output';
    }

    const freeBytes = getFreeDiskBytes(PROJECTS_DIR);
    const freeGiB = Number((freeBytes / (1024 * 1024 * 1024)).toFixed(2));
    const okForRender = freeBytes >= MIN_FREE_BYTES_RENDER;
    const lowSpaceWarning = freeBytes < WARN_FREE_BYTES_RENDER;

    const ok = nodeOk && pyImportsOk && ffOk && fpOk && upstreamOk && okForRender;

    return {
      checkedAt: new Date().toISOString(),
      ok,
      appRoot: APP_ROOT,
      vendorRoot: VENDOR_ROOT,
      skillDir: SKILL_DIR,
      projectsDir: PROJECTS_DIR,
      executables: {
        node: { path: process.execPath, version: process.version, ok: nodeOk },
        python: { path: pythonExe, version: pyInfo.version, importsOk: pyImportsOk, numpy: pyInfo.numpy, pillow: pyInfo.pillow, cv2: pyInfo.cv2, ok: pyImportsOk },
        ffmpeg: { path: realFfmpeg, version: ffVersion, supportsVsync, compatShimActive, ok: ffOk },
        ffprobe: { path: ffprobeExe, version: fpVersion, ok: fpOk },
      },
      upstreamDoctor: {
        ok: upstreamOk,
        checks: upstreamChecks,
        rawError,
      },
      disk: {
        freeBytes,
        freeGiB,
        okForRender,
        lowSpaceWarning,
      },
      capabilities: {
        imageGenerationRoute: 'agent-assisted (Anti image-generator -> assets/inbox + manual PNG upload; no paid web API auto-call)',
        ttsRoute: 'local WAV/M4A upload or Windows local SAPI / agent-assisted narration; original-speed preserved',
        codeRenderer: 'B6 Python/NumPy/Pillow/OpenCV local code engine (b6-production-v1)',
      },
    };
  }
}
