import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve Skill-B6 root whether running via tsx (src/) or compiled (dist/)
function findAppRoot(): string {
  let cur = path.resolve(__dirname);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(cur, 'vendor', 'stickman-video-director'))) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(__dirname, '..', '..', '..');
}

export const APP_ROOT = findAppRoot();
export const VENDOR_ROOT = path.join(APP_ROOT, 'vendor', 'stickman-video-director');
export const SKILL_DIR = path.join(VENDOR_ROOT, 'skills', 'directing-stickman-videos');
export const WORKSPACE_ROOT = path.join(APP_ROOT, 'workspace');
export const PROJECTS_DIR = path.join(WORKSPACE_ROOT, 'projects');
export const JOBS_DIR = path.join(WORKSPACE_ROOT, 'jobs');
export const CACHE_DIR = path.join(WORKSPACE_ROOT, 'cache');
export const PYCACHE_DIR = path.join(CACHE_DIR, 'pycache');
export const TEMP_DIR = path.join(WORKSPACE_ROOT, 'temp');
export const FFMPEG_COMPAT_DIR = path.join(APP_ROOT, 'scripts', 'ffmpeg-compat');

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.B6_STUDIO_PORT ?? 4310);

export const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5176',
  'http://localhost:5176',
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
]);

export function resolvePythonExe(): string {
  if (process.env.B6_PYTHON && fs.existsSync(process.env.B6_PYTHON)) {
    return process.env.B6_PYTHON;
  }
  const winVenv = path.join(APP_ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(winVenv)) return winVenv;
  const unixVenv = path.join(APP_ROOT, '.venv', 'bin', 'python3');
  if (fs.existsSync(unixVenv)) return unixVenv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

export function resolveRealFfmpeg(): string {
  if (process.env.B6_REAL_FFMPEG && fs.existsSync(process.env.B6_REAL_FFMPEG)) {
    return process.env.B6_REAL_FFMPEG;
  }
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const dir of pathEntries) {
    if (path.resolve(dir) === path.resolve(FFMPEG_COMPAT_DIR)) continue;
    const candidate = path.join(dir, exeName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'ffmpeg';
}

export function resolveRealFfprobe(): string {
  if (process.env.FFPROBE && fs.existsSync(process.env.FFPROBE)) {
    return process.env.FFPROBE;
  }
  const realFfmpeg = resolveRealFfmpeg();
  if (path.isAbsolute(realFfmpeg)) {
    const dir = path.dirname(realFfmpeg);
    const probeExe = path.join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(probeExe)) return probeExe;
  }
  return 'ffprobe';
}

export const MIN_FREE_BYTES_CLONE = 6 * 1024 * 1024 * 1024;
export const WARN_FREE_BYTES_RENDER = 10 * 1024 * 1024 * 1024;
export const MIN_FREE_BYTES_RENDER = 1024 * 1024 * 1024; // Hard block under 1 GiB
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MiB upload limit per asset

export function resolveMinFreeBytesRender(estimatedTempBytes = 0): number {
  const envVal = process.env.B6_MIN_FREE_BYTES ? Number(process.env.B6_MIN_FREE_BYTES) : NaN;
  const floorBytes = Number.isFinite(envVal) && envVal >= 0 ? envVal : MIN_FREE_BYTES_RENDER;
  return Math.max(floorBytes, Math.max(0, estimatedTempBytes) * 2);
}
