#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const mode = process.argv.includes('--prod') ? 'prod' : 'dev';
const openBrowser = process.argv.includes('--open');

const npmExecPath = process.env.npm_execpath;
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let shuttingDown = false;

function buildNpmCommand(args) {
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return { cmd: process.execPath, args: [npmExecPath, ...args], shell: false };
  }
  return { cmd: npmCmd, args, shell: process.platform === 'win32' };
}

function killChildTree(ch) {
  if (!ch || !ch.pid || ch.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
  } else {
    try {
      ch.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const ch of children) {
    killChildTree(ch);
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitForUrl(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

function prefixWrite(stream, label, chunk) {
  const text = chunk.toString('utf8');
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) {
      stream.write(`[${label}] ${line}\n`);
    }
  }
}

function launch(cmdSpec, label) {
  const ch = spawn(cmdSpec.cmd, cmdSpec.args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: cmdSpec.shell,
  });
  ch.stdout?.on('data', (d) => prefixWrite(process.stdout, label, d));
  ch.stderr?.on('data', (d) => prefixWrite(process.stderr, label, d));
  ch.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`[${label}] exited with code ${code}`);
      shutdown(code ?? 0);
    }
  });
  children.push(ch);
  return ch;
}

function ensureSharedBuilt() {
  const sharedEntry = path.join(rootDir, 'app', 'shared', 'dist', 'index.js');
  if (!fs.existsSync(sharedEntry)) {
    console.log('[shared] Building @b6-studio/shared...');
    const spec = buildNpmCommand(['--workspace=app/shared', 'run', 'build']);
    const res = spawnSync(spec.cmd, spec.args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: spec.shell,
    });
    if (res.status !== 0) {
      process.exit(res.status ?? 1);
    }
  }
}

async function main() {
  const serverEntry = path.join(rootDir, 'app', 'server', 'dist', 'index.js');
  if (mode === 'prod' && fs.existsSync(serverEntry)) {
    launch({ cmd: process.execPath, args: [serverEntry], shell: false }, 'BE');
    const ok = await waitForUrl('http://127.0.0.1:4310/api/health');
    if (ok) {
      console.log('\nB6 Local Studio (Production) ready at: http://127.0.0.1:4310');
      if (openBrowser && process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', '', 'http://127.0.0.1:4310'], { detached: true, stdio: 'ignore' }).unref();
      }
    }
    return;
  }

  ensureSharedBuilt();

  launch(buildNpmCommand(['--workspace=app/server', 'run', 'dev']), 'BE');
  launch(buildNpmCommand(['--workspace=app/frontend', 'run', 'dev']), 'FE');

  const [apiOk, uiOk] = await Promise.all([
    waitForUrl('http://127.0.0.1:4310/api/health'),
    waitForUrl('http://127.0.0.1:5176'),
  ]);
  if (apiOk && uiOk) {
    console.log('\nB6 Local Studio ready!');
    console.log('  Frontend UI : http://127.0.0.1:5176');
    console.log('  Backend API : http://127.0.0.1:4310/api/health');
    console.log('  Press Ctrl+C to stop cleanly.\n');
    if (openBrowser && process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', 'http://127.0.0.1:5176'], { detached: true, stdio: 'ignore' }).unref();
    }
  }
}

main().catch((err) => {
  console.error(err);
  shutdown(1);
});
