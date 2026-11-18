#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const mode = process.argv.includes('--prod') ? 'prod' : 'dev';
const openBrowser = process.argv.includes('--open');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function shutdown() {
  for (const ch of children) {
    if (ch && ch.exitCode === null) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
      } else {
        ch.kill('SIGTERM');
      }
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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

function launch(cmd, args, label) {
  const ch = spawn(cmd, args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && cmd.endsWith('.cmd'),
  });
  ch.stdout?.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  ch.stderr?.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  ch.on('exit', (code) => {
    console.log(`[${label}] exited with code ${code}`);
    shutdown();
  });
  children.push(ch);
  return ch;
}

async function main() {
  const serverEntry = path.join(rootDir, 'app', 'server', 'dist', 'index.js');
  if (mode === 'prod' && fs.existsSync(serverEntry)) {
    launch(process.execPath, [serverEntry], 'server');
    const ok = await waitForUrl('http://127.0.0.1:4310/api/health');
    if (ok) {
      console.log('\nB6 Local Studio ready at: http://127.0.0.1:4310');
      if (openBrowser && process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', '', 'http://127.0.0.1:4310'], { detached: true, stdio: 'ignore' }).unref();
      }
    }
    return;
  }

  launch(npmCmd, ['--workspace=app/server', 'run', 'dev'], 'server');
  launch(npmCmd, ['--workspace=app/frontend', 'run', 'dev'], 'frontend');

  const apiOk = await waitForUrl('http://127.0.0.1:4310/api/health');
  const uiOk = await waitForUrl('http://127.0.0.1:5176');
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
  shutdown();
});
