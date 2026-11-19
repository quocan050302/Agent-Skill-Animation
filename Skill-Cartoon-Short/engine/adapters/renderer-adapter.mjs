/**
 * Controlled Renderer Adapter Contract (SHORT-01 Section 8.1)
 *
 * Exposes:
 *   initializeRenderer(project)
 *   renderFrame(frameIndex)
 *   renderFrameRange(start, end, options)
 *   renderStill(frameIndex, options)
 *   getRenderMetadata()
 *   disposeRenderer()
 *
 * Executes the real Three.js + Canvas2D Pen + Ink + DOF pipeline in headless Playwright Chromium
 * over a loopback-only (127.0.0.1) static server with strict readiness, WebGL, shader, and pixel checks.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { checkFreeDiskMb, PROJECT_ROOT, sha256File, writeFileAtomic } from '../../tools/setup/hydrate.mjs';
import { inspectJpegBuffer, inspectJpegFile } from '../../tools/qa/image-inspector.mjs';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// Bounded process-wide concurrency guard to prevent simultaneous uncontrolled Chromium WebGL instances
let activeRendererCount = 0;
const maxConcurrentRenderers = () => Math.max(1, Math.min(4, Number(process.env.SHORT_MAX_RENDER_WORKERS || 2)));

export function resolveOptimalRenderWorkers({ frameCount = 1, requestedWorkers } = {}) {
  if (frameCount < 24) return 1;
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  if (totalMemMb < 4096) return 1;
  const envCap = Math.max(1, Math.min(4, Number(process.env.SHORT_MAX_RENDER_WORKERS || 2)));
  const raw = requestedWorkers !== undefined ? Number(requestedWorkers) : envCap;
  return Math.max(1, Math.min(raw, envCap, Math.max(1, Math.floor(os.cpus().length / 2)), frameCount));
}

async function writeFileAtomicAsync(destPath, data) {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const tmpDir = path.join(PROJECT_ROOT, 'workspace', 'cache', 'atomic-tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(
    tmpDir,
    `${path.basename(destPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  await fs.promises.writeFile(tmpPath, data);
  await fs.promises.rename(tmpPath, destPath);
}

function resolveProjectWebDir(project) {
  if (!project) {
    return path.join(PROJECT_ROOT, 'engine', 'web');
  }
  if (typeof project === 'string') {
    const candidateProject = path.join(PROJECT_ROOT, 'workspace', 'projects', project, 'web');
    if (fs.existsSync(candidateProject)) return candidateProject;
    const abs = path.resolve(project);
    if (fs.existsSync(path.join(abs, 'index.html'))) return abs;
    if (fs.existsSync(path.join(abs, 'web', 'index.html'))) return path.join(abs, 'web');
    throw new Error(`PROJECT_WEB_DIR_NOT_FOUND: Cannot resolve web directory for "${project}"`);
  }
  if (project.webDir) {
    return path.resolve(project.webDir);
  }
  if (project.projectId) {
    return resolveProjectWebDir(project.projectId);
  }
  return path.join(PROJECT_ROOT, 'engine', 'web');
}

function validateRequiredWebFiles(webDir) {
  const required = ['index.html', 'main.js', 'paint.js', 'story.js', 'toon.js', path.join('lib', 'three.module.js')];
  const missing = required.filter((rel) => !fs.existsSync(path.join(webDir, rel)));
  if (missing.length > 0) {
    throw new Error(`MISSING_ENGINE_DEPENDENCIES: Missing [${missing.join(', ')}] in ${webDir}`);
  }
}

function startLoopbackServer(webDir, onHttpError) {
  const resolvedRoot = path.resolve(webDir);
  const server = http.createServer((req, res) => {
    try {
      const rawPathname = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = rawPathname === '/' ? 'index.html' : rawPathname.replace(/^\/+/, '');
      const targetPath = path.resolve(resolvedRoot, rel);
      if (targetPath !== resolvedRoot && !targetPath.startsWith(resolvedRoot + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
        onHttpError?.({ status: 404, url: req.url, targetPath });
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(targetPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(targetPath).pipe(res);
    } catch (err) {
      onHttpError?.({ status: 500, url: req.url, error: String(err) });
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        host: '127.0.0.1',
        port: address.port,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

export function parseFrameSpec(spec, step = 1) {
  if (typeof spec !== 'string' || !spec.trim()) {
    throw new Error(`INVALID_FRAME_SPEC: Expected non-empty frame specification, got "${spec}"`);
  }
  const parsedStep = Number(step);
  if (!Number.isInteger(parsedStep) || parsedStep <= 0) {
    throw new Error(`INVALID_FRAME_STEP: Step must be a positive integer, got "${step}"`);
  }
  const frames = [];
  const seen = new Set();
  for (const rawPart of spec.split(',')) {
    const part = rawPart.trim();
    if (!part) throw new Error(`INVALID_FRAME_SPEC: Empty segment in "${spec}"`);
    if (part.includes('-')) {
      const pieces = part.split('-');
      if (pieces.length !== 2 || !/^\d+$/.test(pieces[0].trim()) || !/^\d+$/.test(pieces[1].trim())) {
        throw new Error(`INVALID_FRAME_RANGE: Malformed range "${part}"`);
      }
      const start = Number(pieces[0].trim());
      const end = Number(pieces[1].trim());
      if (end < start) {
        throw new Error(`INVALID_FRAME_RANGE: End (${end}) < start (${start}) in "${part}"`);
      }
      for (let f = start; f <= end; f += parsedStep) {
        if (!seen.has(f)) {
          seen.add(f);
          frames.push(f);
        }
      }
    } else {
      if (!/^\d+$/.test(part)) {
        throw new Error(`INVALID_FRAME_INDEX: Non-integer frame "${part}"`);
      }
      const f = Number(part);
      if (!seen.has(f)) {
        seen.add(f);
        frames.push(f);
      }
    }
  }
  if (frames.length === 0) {
    throw new Error(`INVALID_FRAME_SPEC: Resolved zero frames for "${spec}"`);
  }
  return frames;
}

export class ShortRendererSession {
  constructor() {
    this.initialized = false;
    this.disposed = false;
    this.serverInfo = null;
    this.browser = null;
    this.page = null;
    this.consoleLogs = [];
    this.pageErrors = [];
    this.httpErrors = [];
    this.metadata = null;
    this.webDir = null;
    this.peakRssBytes = 0;
    this.framesRendered = 0;
  }

  _trackMemory() {
    const rss = process.memoryUsage().rss;
    if (rss > this.peakRssBytes) this.peakRssBytes = rss;
  }

  async initialize(project = {}) {
    if (this.initialized) return this.metadata;
    const limit = maxConcurrentRenderers();
    if (activeRendererCount >= limit) {
      throw new Error(
        `RENDERER_CONCURRENCY_LIMIT: ${activeRendererCount} active renderer(s) already running (limit=${limit}).`
      );
    }

    const minFreeMb = Number(project?.minFreeDiskMb ?? process.env.SHORT_MIN_FREE_DISK_MB ?? 512);
    checkFreeDiskMb(PROJECT_ROOT, minFreeMb);

    const webDir = resolveProjectWebDir(project);
    validateRequiredWebFiles(webDir);
    this.webDir = webDir;

    activeRendererCount++;
    try {
      this.serverInfo = await startLoopbackServer(webDir, (err) => {
        if (!String(err.url || '').includes('favicon.ico')) {
          this.httpErrors.push(err);
        }
      });

      const backendMode = project?.glBackend || process.env.SHORT_GL_BACKEND || 'auto';
      const launchArgs =
        backendMode === 'swiftshader'
          ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
          : backendMode === 'metal' || (backendMode === 'auto' && os.platform() === 'darwin')
            ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl']
            : ['--ignore-gpu-blocklist', '--enable-webgl'];

      const executablePath = project?.executablePath || undefined;
      this.browser = await chromium.launch({
        headless: true,
        executablePath,
        args: launchArgs,
      });

      this.page = await this.browser.newPage({
        viewport: { width: 1080, height: 1920 },
        deviceScaleFactor: 1,
      });

      this.page.on('console', (msg) => {
        const entry = { type: msg.type(), text: msg.text() };
        this.consoleLogs.push(entry);
        if (msg.type() === 'error') {
          this.pageErrors.push(`CONSOLE_ERROR: ${msg.text()}`);
        }
      });
      this.page.on('pageerror', (err) => {
        this.pageErrors.push(`PAGE_ERROR: ${err.message || String(err)}`);
      });
      this.page.on('requestfailed', (req) => {
        if (!req.url().includes('favicon.ico')) {
          this.httpErrors.push({ status: 'FAILED', url: req.url(), error: req.failure()?.errorText });
        }
      });

      const hashSuffix = project?.debugMode === 'nd' ? '#nd' : project?.debugMode === 'edge' ? '#e' : '';
      const timeoutMs = Number(project?.timeoutMs ?? process.env.SHORT_JOB_TIMEOUT_MS ?? 120000);
      await this.page.goto(`${this.serverInfo.baseUrl}/index.html${hashSuffix}`, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });

      await this.page.waitForFunction(() => Boolean(window.ready || window.err), null, {
        timeout: timeoutMs,
      });

      const readiness = await this.page.evaluate(() => {
        const canvas = document.getElementById('c');
        if (window.err) {
          return { ok: false, reason: `WINDOW_ERR: ${window.err}` };
        }
        if (!canvas) {
          return { ok: false, reason: 'MISSING_CANVAS' };
        }
        if (canvas.width !== 1080 || canvas.height !== 1920) {
          return { ok: false, reason: `INVALID_CANVAS_DIMENSIONS: ${canvas.width}x${canvas.height}` };
        }
        if (typeof window.renderFrame !== 'function') {
          return { ok: false, reason: 'MISSING_RENDER_FRAME_FN' };
        }
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) {
          return { ok: false, reason: 'WEBGL_CONTEXT_UNAVAILABLE' };
        }
        if (gl.isContextLost()) {
          return { ok: false, reason: 'WEBGL_CONTEXT_LOST' };
        }
        const glErr = gl.getError();
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const glVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        const glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        const glVersion = gl.getParameter(gl.VERSION);
        return {
          ok: true,
          width: canvas.width,
          height: canvas.height,
          totalFrames: Number(window.TOTAL || 0),
          glError: glErr,
          glVendor,
          glRenderer,
          glVersion,
          userAgent: navigator.userAgent,
        };
      });

      if (this.httpErrors.length > 0) {
        throw new Error(`HTTP_ASSET_LOAD_ERROR: ${JSON.stringify(this.httpErrors)}`);
      }
      if (!readiness.ok) {
        throw new Error(`RENDERER_NOT_READY: ${readiness.reason} | errors=${this.pageErrors.join('; ')}`);
      }
      if (this.pageErrors.some((e) => /shader|webgl|syntaxerror|referenceerror|typeerror/i.test(e))) {
        throw new Error(`RENDERER_RUNTIME_ERROR: ${this.pageErrors.join(' | ')}`);
      }

      this._trackMemory();
      this.metadata = {
        webDir: this.webDir,
        mainJsSha256: sha256File(path.join(this.webDir, 'main.js')),
        storyJsSha256: sha256File(path.join(this.webDir, 'story.js')),
        toonJsSha256: sha256File(path.join(this.webDir, 'toon.js')),
        width: readiness.width,
        height: readiness.height,
        fps: 30,
        totalFrames: readiness.totalFrames,
        chromiumVersion: this.browser.version(),
        glVendor: readiness.glVendor,
        glRenderer: readiness.glRenderer,
        glVersion: readiness.glVersion,
        backendMode,
        hostPlatform: `${os.platform()}-${os.arch()}`,
        nodeVersion: process.version,
        loopbackUrl: this.serverInfo.baseUrl,
      };
      this.initialized = true;
      return this.metadata;
    } catch (err) {
      await this.dispose();
      throw err;
    }
  }

  async _renderFrameOnPage(targetPage, frameIndex, options = {}) {
    if (!this.initialized || this.disposed || !targetPage) {
      throw new Error('RENDERER_NOT_INITIALIZED: Call initializeRenderer() before renderFrame().');
    }
    if (!Number.isInteger(frameIndex) || frameIndex < 0) {
      throw new Error(`INVALID_FRAME_INDEX: Expected non-negative integer, got ${frameIndex}`);
    }
    if (options.signal?.aborted) {
      throw new Error('RENDER_CANCELED: AbortSignal already aborted.');
    }

    const quality = Number(options.quality ?? 0.96);
    if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
      throw new Error(`INVALID_JPEG_QUALITY: Expected (0, 1], got ${options.quality}`);
    }

    const debugMode = options.debugMode || null;
    const evalResult = await targetPage.evaluate(
      ([f, q, dbgMode]) => {
        window.DEBUG_ND = dbgMode === 'nd' ? 1 : 0;
        window.DEBUG_E = dbgMode === 'edge' ? 1 : 0;
        const ok = window.renderFrame(f);
        const canvas = document.getElementById('c');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl || gl.isContextLost()) {
          return { ok: false, reason: 'WEBGL_CONTEXT_LOST_DURING_RENDER' };
        }
        // Sample 108x192 probe canvas to verify frame is not blank/black
        if (!window.__probeCanvas) {
          window.__probeCanvas = document.createElement('canvas');
          window.__probeCanvas.width = 108;
          window.__probeCanvas.height = 192;
          window.__probeCtx = window.__probeCanvas.getContext('2d', { willReadFrequently: true });
        }
        const pctx = window.__probeCtx;
        pctx.clearRect(0, 0, 108, 192);
        pctx.drawImage(canvas, 0, 0, 108, 192);
        const data = pctx.getImageData(0, 0, 108, 192).data;
        let sum = 0;
        let sumSq = 0;
        let nonBlack = 0;
        let maxLuma = 0;
        const totalPx = 108 * 192;
        for (let i = 0; i < data.length; i += 4) {
          const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += l;
          sumSq += l * l;
          if (l > 8) nonBlack++;
          if (l > maxLuma) maxLuma = l;
        }
        const meanLuma = sum / totalPx;
        const variance = Math.max(0, sumSq / totalPx - meanLuma * meanLuma);
        const dataUrl = canvas.toDataURL('image/jpeg', q);
        return {
          ok: Boolean(ok),
          dataUrl,
          meanLuma,
          stdLuma: Math.sqrt(variance),
          maxLuma,
          nonBlackRatio: nonBlack / totalPx,
        };
      },
      [frameIndex, quality, debugMode]
    );

    if (!evalResult.ok || !evalResult.dataUrl?.startsWith('data:image/jpeg;base64,')) {
      throw new Error(`FRAME_RENDER_FAILED at frame ${frameIndex}: ${evalResult.reason || 'Invalid dataURL'}`);
    }

    if (options.allowBlack !== true && (evalResult.nonBlackRatio < 0.01 || evalResult.maxLuma < 10)) {
      throw new Error(
        `BLACK_FRAME_REJECTED at frame ${frameIndex}: nonBlackRatio=${evalResult.nonBlackRatio.toFixed(4)}, maxLuma=${evalResult.maxLuma.toFixed(1)}`
      );
    }

    const buffer = Buffer.from(evalResult.dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
    const jpegCheck = inspectJpegBuffer(buffer);
    if (!jpegCheck.valid || jpegCheck.width !== 1080 || jpegCheck.height !== 1920 || !jpegCheck.isPortrait9x16) {
      throw new Error(`FRAME_VALIDATION_FAILED at frame ${frameIndex}: ${JSON.stringify(jpegCheck)}`);
    }

    let outputPath = null;
    if (options.outputPath) {
      const resolvedOut = path.resolve(options.outputPath);
      if (options.asyncWrite) {
        await writeFileAtomicAsync(resolvedOut, buffer);
      } else {
        writeFileAtomic(resolvedOut, buffer);
      }
      outputPath = resolvedOut;
    }

    this.framesRendered++;
    this._trackMemory();

    return {
      frameIndex,
      width: jpegCheck.width,
      height: jpegCheck.height,
      byteLength: jpegCheck.byteLength,
      sha256: jpegCheck.sha256,
      meanLuma: Number(evalResult.meanLuma.toFixed(3)),
      stdLuma: Number(evalResult.stdLuma.toFixed(3)),
      nonBlackRatio: Number(evalResult.nonBlackRatio.toFixed(5)),
      outputPath,
      buffer: options.returnBuffer === false ? undefined : buffer,
    };
  }

  async renderFrame(frameIndex, options = {}) {
    return this._renderFrameOnPage(this.page, frameIndex, options);
  }

  async renderStill(frameIndex, options = {}) {
    return this.renderFrame(frameIndex, { ...options, returnBuffer: options.returnBuffer ?? true });
  }

  async renderFrameRange(start, end, options = {}) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new Error(`INVALID_FRAME_RANGE: Expected 0 <= start <= end integers, got [${start}, ${end}]`);
    }
    const step = Number(options.step ?? 1);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`INVALID_FRAME_STEP: Expected positive integer, got ${options.step}`);
    }
    const frames = [];
    for (let f = start; f <= end; f += step) frames.push(f);
    return this.renderFrameList(frames, options);
  }

  async _openWorkerPage() {
    const context = await this.browser.newContext({
      viewport: { width: 1080, height: 1920 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => this.pageErrors.push(`WORKER_PAGE_ERROR: ${err.message || String(err)}`));
    await page.goto(`${this.serverInfo.baseUrl}/index.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await page.waitForFunction(() => Boolean(window.ready || window.err), null, { timeout: 120000 });
    const ok = await page.evaluate(() => Boolean(window.ready && !window.err && typeof window.renderFrame === 'function'));
    if (!ok) {
      await context.close().catch(() => {});
      throw new Error('WORKER_RENDERER_NOT_READY');
    }
    return { context, page };
  }

  async renderFrameList(frames, options = {}) {
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('INVALID_FRAME_LIST: Expected non-empty array of frame indices.');
    }
    const outDir = options.outputDir ? path.resolve(options.outputDir) : null;
    if (outDir) {
      checkFreeDiskMb(PROJECT_ROOT, Number(options.minFreeDiskMb ?? 512));
      fs.mkdirSync(outDir, { recursive: true });
    }

    const startedAt = Date.now();
    const workersRequested = options.parallel
      ? resolveOptimalRenderWorkers({ frameCount: frames.length, requestedWorkers: options.workers })
      : Math.max(1, Number(options.workers || 1));
    const effectiveWorkers = Math.min(workersRequested, frames.length);

    const resultsByFrame = new Map();
    const pendingFrames = [];
    let resumedCount = 0;

    for (const f of frames) {
      if (options.signal?.aborted) {
        throw new Error(`RENDER_CANCELED at frame ${f}`);
      }
      const fileName = `f${String(f).padStart(4, '0')}.jpg`;
      const targetPath = outDir ? path.join(outDir, fileName) : null;
      if (targetPath && options.resume && fs.existsSync(targetPath)) {
        const existingCheck = inspectJpegFile(targetPath);
        if (existingCheck.valid && existingCheck.width === 1080 && existingCheck.height === 1920) {
          resumedCount++;
          resultsByFrame.set(f, {
            frameIndex: f,
            width: existingCheck.width,
            height: existingCheck.height,
            byteLength: existingCheck.byteLength,
            sha256: existingCheck.sha256,
            outputPath: targetPath,
            resumed: true,
          });
          continue;
        }
        fs.rmSync(targetPath, { force: true });
      }
      pendingFrames.push(f);
    }

    let completedCount = resumedCount;
    const extraWorkers = [];

    try {
      const workerPages = [this.page];
      if (effectiveWorkers > 1 && pendingFrames.length >= 8) {
        const created = await Promise.all(
          Array.from({ length: effectiveWorkers - 1 }, () => this._openWorkerPage())
        );
        for (const w of created) {
          extraWorkers.push(w);
          workerPages.push(w.page);
        }
      }

      const workerCount = workerPages.length;
      const chunkSize = Math.ceil(pendingFrames.length / workerCount);
      const pendingWrites = [];

      await Promise.all(
        workerPages.map(async (wPage, wi) => {
          const slice = pendingFrames.slice(wi * chunkSize, (wi + 1) * chunkSize);
          for (const f of slice) {
            if (options.signal?.aborted) {
              throw new Error(`RENDER_CANCELED at frame ${f}`);
            }
            const targetPath = outDir ? path.join(outDir, `f${String(f).padStart(4, '0')}.jpg`) : null;
            const rendered = await this._renderFrameOnPage(wPage, f, {
              quality: options.quality ?? 0.96,
              debugMode: options.debugMode,
              allowBlack: options.allowBlack,
              outputPath: null,
              returnBuffer: Boolean(targetPath),
              signal: options.signal,
            });
            if (targetPath && rendered.buffer) {
              const buf = rendered.buffer;
              rendered.buffer = undefined;
              rendered.outputPath = targetPath;
              pendingWrites.push(writeFileAtomicAsync(targetPath, buf));
              if (pendingWrites.length >= 24) {
                await Promise.all(pendingWrites.splice(0, pendingWrites.length));
              }
            }
            resultsByFrame.set(f, { ...rendered, resumed: false });
            completedCount++;
            options.onProgress?.({ completed: completedCount, total: frames.length, frameIndex: f });
          }
        })
      );

      if (pendingWrites.length > 0) {
        await Promise.all(pendingWrites);
      }

      const orderedResults = frames.map((f) => resultsByFrame.get(f));
      const elapsedMs = Date.now() - startedAt;
      return {
        frameCount: orderedResults.length,
        resumedCount,
        renderedCount: orderedResults.length - resumedCount,
        workersUsed: workerCount,
        elapsedMs,
        msPerFrame: Number((elapsedMs / Math.max(1, orderedResults.length)).toFixed(2)),
        peakRssMb: Number((this.peakRssBytes / (1024 * 1024)).toFixed(2)),
        outputDir: outDir,
        frames: orderedResults,
      };
    } finally {
      await Promise.all(extraWorkers.map((w) => w.context.close().catch(() => {})));
    }
  }

  getMetadata() {
    return {
      ...this.metadata,
      initialized: this.initialized,
      disposed: this.disposed,
      framesRendered: this.framesRendered,
      peakRssMb: Number((this.peakRssBytes / (1024 * 1024)).toFixed(2)),
      consoleCount: this.consoleLogs.length,
      pageErrors: [...this.pageErrors],
      httpErrors: [...this.httpErrors],
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.initialized = false;
    try {
      if (this.page) await this.page.close().catch(() => {});
    } finally {
      this.page = null;
      try {
        if (this.browser) await this.browser.close().catch(() => {});
      } finally {
        this.browser = null;
        try {
          if (this.serverInfo?.server) {
            await new Promise((resolve) => this.serverInfo.server.close(() => resolve()));
          }
        } finally {
          this.serverInfo = null;
          activeRendererCount = Math.max(0, activeRendererCount - 1);
        }
      }
    }
  }
}

// Singleton-capable procedural contract functions required by Section 8.1
let defaultSession = null;

export async function initializeRenderer(project = {}) {
  if (defaultSession && !defaultSession.disposed) {
    await defaultSession.dispose();
  }
  defaultSession = new ShortRendererSession();
  return defaultSession.initialize(project);
}

export async function renderFrame(frameIndex, options = {}) {
  if (!defaultSession || !defaultSession.initialized) {
    throw new Error('RENDERER_NOT_INITIALIZED: Call initializeRenderer(project) first.');
  }
  return defaultSession.renderFrame(frameIndex, options);
}

export async function renderFrameRange(start, end, options = {}) {
  if (!defaultSession || !defaultSession.initialized) {
    throw new Error('RENDERER_NOT_INITIALIZED: Call initializeRenderer(project) first.');
  }
  return defaultSession.renderFrameRange(start, end, options);
}

export async function renderStill(frameIndex, options = {}) {
  if (!defaultSession || !defaultSession.initialized) {
    throw new Error('RENDERER_NOT_INITIALIZED: Call initializeRenderer(project) first.');
  }
  return defaultSession.renderStill(frameIndex, options);
}

export function getRenderMetadata() {
  if (!defaultSession) {
    return { initialized: false, disposed: true };
  }
  return defaultSession.getMetadata();
}

export async function disposeRenderer() {
  if (defaultSession) {
    await defaultSession.dispose();
    defaultSession = null;
  }
}
