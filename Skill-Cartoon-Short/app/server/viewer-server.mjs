#!/usr/bin/env node
/**
 * Minimal Loopback Real-Engine Test Viewer Server (SHORT-01 Section 14)
 * Binds strictly to 127.0.0.1. Serves the real hydrated Three.js engine in an iframe
 * and exposes the read-only capability contract for future Studio UI integration.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_FORMAT_LOCK, UI_CAPABILITY_MATRIX } from '../shared/contract.mjs';
import { PROJECT_ROOT } from '../../tools/setup/hydrate.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

export function listHydratedProjects() {
  const candidates = [
    {
      id: 'soldier-baseline',
      title: 'The Soldier Who Never Left (Original Baseline)',
      webDir: path.join(PROJECT_ROOT, 'workspace', 'projects', 'soldier-baseline', 'web'),
      parityBaseline: true,
    },
    {
      id: 'zombie-supermarket-10s',
      title: 'Sold Out at Fresh-Mart (New 10s Proof)',
      webDir: path.join(PROJECT_ROOT, 'workspace', 'projects', 'zombie-supermarket-10s', 'web'),
      parityBaseline: false,
    },
  ];
  return candidates
    .filter((c) => fs.existsSync(path.join(c.webDir, 'index.html')))
    .map((c) => ({
      id: c.id,
      title: c.title,
      parityBaseline: c.parityBaseline,
      engineUrl: `/engine/${c.id}/index.html`,
    }));
}

export function startViewerServer({ port = 0, host = '127.0.0.1' } = {}) {
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`SECURITY_VIOLATION: Viewer server must bind to loopback only (got "${host}").`);
  }
  const viewerHtmlPath = path.join(PROJECT_ROOT, 'app', 'frontend', 'viewer.html');

  const server = http.createServer((req, res) => {
    const rawUrl = decodeURIComponent((req.url || '/').split('?')[0]);

    if (rawUrl === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, format: STUDIO_FORMAT_LOCK }));
      return;
    }

    if (rawUrl === '/api/contract') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          format: STUDIO_FORMAT_LOCK,
          projects: listHydratedProjects(),
          capabilities: UI_CAPABILITY_MATRIX,
        })
      );
      return;
    }

    if (rawUrl === '/' || rawUrl === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(viewerHtmlPath).pipe(res);
      return;
    }

    if (rawUrl.startsWith('/engine/')) {
      const parts = rawUrl.slice('/engine/'.length).split('/');
      const projectId = parts.shift();
      const relPath = parts.join('/') || 'index.html';
      const baseDir = path.resolve(PROJECT_ROOT, 'workspace', 'projects', projectId, 'web');
      const target = path.resolve(baseDir, relPath);
      if (!target.startsWith(baseDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(target).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        host,
        port: addr.port,
        url: `http://${host}:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.SHORT_VIEWER_PORT || 4319);
  startViewerServer({ port, host: '127.0.0.1' }).then((info) => {
    console.log(`Cartoon Short Real-Engine Test Viewer listening at ${info.url}`);
  });
}
