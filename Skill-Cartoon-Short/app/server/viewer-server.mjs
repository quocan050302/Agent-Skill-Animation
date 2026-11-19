#!/usr/bin/env node
/**
 * Cartoon Short Studio & Real-Engine Loopback Server (SHORT-01 + QA-TTS-01)
 *
 * Security & Compatibility:
 * - Binds strictly to loopback 127.0.0.1 / localhost (never 0.0.0.0)
 * - Serves compiled React+TypeScript+Vite Studio SPA at `/` (when built at app/frontend/dist)
 * - Preserves unmodified legacy 9:16 real-engine test viewer at `/legacy` (and fallback `/` if SPA not built)
 * - Exposes full Studio REST & SSE API under `/api/*` via `api-router.mjs`
 * - Serves hydrated Three.js engine modules under `/engine/:project/*` with strict path confinement
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT } from '../../tools/setup/hydrate.mjs';
import { createProjectStore } from './services/project-store.mjs';
import { createMediaStore } from './services/media-store.mjs';
import { createTtsService } from './services/tts-service.mjs';
import { createJobManager } from './services/job-manager.mjs';
import { createApiRouter, securityHeaders } from './api-router.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};

export function listHydratedProjects(projectRoot = PROJECT_ROOT) {
  const projectsRoot = path.join(projectRoot, 'workspace', 'projects');
  const titles = {
    'soldier-baseline': 'The Soldier Who Never Left (Original Baseline)',
    'zombie-supermarket-10s': 'Sold Out at Fresh-Mart (New 10s Proof)',
    'ghost-army-ww2-30s': 'The Fake Army That Fooled the Nazis (30s Demo)',
  };
  if (!fs.existsSync(projectsRoot)) return [];
  const entries = fs
    .readdirSync(projectsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(projectsRoot, d.name, 'web', 'index.html')))
    .map((d) => ({
      id: d.name,
      title: titles[d.name] || d.name,
      parityBaseline: d.name === 'soldier-baseline',
      engineUrl: `/engine/${d.name}/index.html`,
    }));
  entries.sort((a, b) => (a.parityBaseline ? -1 : b.parityBaseline ? 1 : a.id.localeCompare(b.id)));
  return entries;
}

/**
 * Starts the loopback Cartoon Short Studio & legacy real-engine viewer HTTP server.
 * @param {{ port?: number, host?: string, projectRoot?: string, settingsDir?: string, env?: object, fetchImpl?: Function, legacyRoot?: boolean }} [opts]
 */
export function startViewerServer({
  port = 0,
  host = '127.0.0.1',
  projectRoot = PROJECT_ROOT,
  settingsDir,
  env = process.env,
  fetchImpl = globalThis.fetch,
  legacyRoot = false,
} = {}) {
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`SECURITY_VIOLATION: Viewer server must bind to loopback only (got "${host}").`);
  }

  const viewerHtmlPath = path.join(projectRoot, 'app', 'frontend', 'viewer.html');
  const spaDistDir = path.join(projectRoot, 'app', 'frontend', 'dist');

  const projectStore = createProjectStore({ projectRoot });
  const mediaStore = createMediaStore({ projectRoot });
  const ttsService = createTtsService({ projectRoot, settingsDir, env, fetchImpl });
  const jobManager = createJobManager({ projectRoot, projectStore, mediaStore, ttsService });
  jobManager.recoverStaleJobsOnStartup();

  const apiRouter = createApiRouter({
    projectRoot,
    projectStore,
    mediaStore,
    ttsService,
    jobManager,
    listHydratedProjects: () => listHydratedProjects(projectRoot),
  });

  const server = http.createServer((req, res) => {
    const rawReqUrl = String(req.url || '/');
    if (
      rawReqUrl.includes('\0') ||
      rawReqUrl.includes('..') ||
      /%2e%2e/i.test(rawReqUrl) ||
      /%5c/i.test(rawReqUrl)
    ) {
      res.writeHead(403, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      res.end('Forbidden');
      return;
    }

    let urlObj;
    try {
      urlObj = new URL(rawReqUrl, `http://${host}`);
    } catch {
      res.writeHead(400, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      res.end('Bad Request');
      return;
    }

    let rawPath;
    try {
      rawPath = decodeURIComponent(urlObj.pathname);
    } catch {
      res.writeHead(400, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      res.end('Bad Request');
      return;
    }

    if (
      rawPath.includes('\0') ||
      rawPath.includes('..') ||
      rawPath.split('/').some((seg) => seg.startsWith('.'))
    ) {
      res.writeHead(403, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      res.end('Forbidden');
      return;
    }

    // 1. Studio REST & SSE API
    if (rawPath.startsWith('/api/')) {
      apiRouter.handleApiRequest(req, res, urlObj);
      return;
    }

    // 2. Legacy Real-Engine Viewer (always preserved for SHORT-01 smoke compatibility)
    if (rawPath === '/legacy' || rawPath === '/legacy/' || rawPath === '/legacy-viewer.html') {
      res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      fs.createReadStream(viewerHtmlPath).pipe(res);
      return;
    }

    // 3. Hydrated Three.js Engine Static Assets (`/engine/:project/*`)
    if (rawPath.startsWith('/engine/')) {
      const parts = rawPath.slice('/engine/'.length).split('/');
      const projectId = parts.shift() || '';
      const relPath = parts.join('/') || 'index.html';
      if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(projectId)) {
        res.writeHead(400, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
        res.end('Invalid project identifier');
        return;
      }
      const baseDir = path.resolve(projectRoot, 'workspace', 'projects', projectId, 'web');
      const target = path.resolve(baseDir, relPath);
      if (!target.startsWith(baseDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        res.writeHead(404, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
        res.end('Not Found');
        return;
      }
      const realBase = fs.realpathSync(baseDir);
      const realTarget = fs.realpathSync(target);
      if (!realTarget.startsWith(realBase + path.sep)) {
        res.writeHead(403, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
        res.end('Forbidden');
        return;
      }
      const ext = path.extname(realTarget).toLowerCase();
      res.writeHead(200, securityHeaders({ 'Content-Type': MIME[ext] || 'application/octet-stream' }));
      fs.createReadStream(realTarget).pipe(res);
      return;
    }

    // 4. Built React+TS+Vite Studio SPA (fallback to legacy viewer when dist/ not yet built or legacyRoot=true)
    const spaIndex = path.join(spaDistDir, 'index.html');
    const useSpa = !legacyRoot && fs.existsSync(spaIndex);

    if (useSpa) {
      const rel = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
      const candidate = path.resolve(spaDistDir, rel);
      if (candidate.startsWith(spaDistDir + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const ext = path.extname(candidate).toLowerCase();
        res.writeHead(200, securityHeaders({ 'Content-Type': MIME[ext] || 'application/octet-stream' }));
        fs.createReadStream(candidate).pipe(res);
        return;
      }
      // SPA fallback only for non-asset navigation routes
      if (!path.extname(rawPath)) {
        res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
        fs.createReadStream(spaIndex).pipe(res);
        return;
      }
      res.writeHead(404, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      res.end('Not Found');
      return;
    }

    if (rawPath === '/' || rawPath === '/index.html') {
      res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
      fs.createReadStream(viewerHtmlPath).pipe(res);
      return;
    }

    res.writeHead(404, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
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
        services: { projectStore, mediaStore, ttsService, jobManager },
        close: async () => {
          await apiRouter.dispose();
          await new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.SHORT_VIEWER_PORT || 4319);
  startViewerServer({ port, host: '127.0.0.1' }).then((info) => {
    console.log(`Cartoon Short Studio Server listening at ${info.url} (legacy viewer at ${info.url}/legacy)`);
  });
}
