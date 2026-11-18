#!/usr/bin/env node
/**
 * Safe CLI Frame Renderer (adapts original tools/render.mjs with loopback-only server,
 * readiness checks, frame validation, atomic writes, and guaranteed resource cleanup).
 *
 * Usage:
 *   node tools/render/render-cli.mjs <outdir> <frames: "a-b" or "0,44,88" or "all"> [step] [quality] [--project <id_or_webdir>] [--backend auto|swiftshader] [--resume]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrameSpec, ShortRendererSession } from '../../engine/adapters/renderer-adapter.mjs';

async function main() {
  const rawArgs = process.argv.slice(2);
  const positional = [];
  let project = process.env.WEB || null;
  let glBackend = process.env.SHORT_GL_BACKEND || 'auto';
  let resume = Boolean(process.env.RESUME);
  let debugMode = process.env.HASH === '#nd' ? 'nd' : process.env.HASH === '#e' ? 'edge' : null;
  let manifestOut = null;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--project' && rawArgs[i + 1]) {
      project = rawArgs[++i];
    } else if (arg === '--backend' && rawArgs[i + 1]) {
      glBackend = rawArgs[++i];
    } else if (arg === '--debug' && rawArgs[i + 1]) {
      debugMode = rawArgs[++i];
    } else if (arg === '--manifest' && rawArgs[i + 1]) {
      manifestOut = path.resolve(rawArgs[++i]);
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`UNKNOWN_OPTION: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  const [outDir, spec, stepArg = '1', qualArg = '0.96'] = positional;
  if (!outDir || !spec) {
    throw new Error(
      'Usage: node tools/render/render-cli.mjs <outdir> <frames|"all"> [step] [quality] [--project <id>]'
    );
  }

  const session = new ShortRendererSession();
  const ac = new AbortController();
  const onSig = () => ac.abort();
  process.once('SIGINT', onSig);
  process.once('SIGTERM', onSig);

  try {
    const meta = await session.initialize({ webDir: project ? undefined : undefined, ...(project ? { projectId: project } : {}), glBackend, debugMode });
    const step = Number(stepArg);
    const frames =
      spec === 'all'
        ? parseFrameSpec(`0-${Math.max(0, meta.totalFrames - 1)}`, step)
        : parseFrameSpec(spec, step);

    const summary = await session.renderFrameList(frames, {
      outputDir: outDir,
      quality: Number(qualArg),
      resume,
      debugMode,
      signal: ac.signal,
    });

    const payload = {
      ok: true,
      metadata: session.getMetadata(),
      summary: {
        frameCount: summary.frameCount,
        renderedCount: summary.renderedCount,
        resumedCount: summary.resumedCount,
        elapsedMs: summary.elapsedMs,
        msPerFrame: summary.msPerFrame,
        peakRssMb: summary.peakRssMb,
        outputDir: summary.outputDir,
      },
      frames: summary.frames,
    };

    if (manifestOut) {
      fs.mkdirSync(path.dirname(manifestOut), { recursive: true });
      fs.writeFileSync(manifestOut, JSON.stringify(payload, null, 2));
    }

    console.log(
      `done ${summary.frameCount} frames (${summary.msPerFrame} ms/frame, backend=${meta.glRenderer})`
    );
  } finally {
    process.removeListener('SIGINT', onSig);
    process.removeListener('SIGTERM', onSig);
    await session.dispose();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}
