import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  checkFreeDiskMb,
  loadSourceManifest,
  PROJECT_ROOT,
  verifyVendorSnapshot,
} from '../../tools/setup/hydrate.mjs';
import { parseFrameSpec, ShortRendererSession } from '../../engine/adapters/renderer-adapter.mjs';
import { inspectJpegBuffer, inspectJpegFile } from '../../tools/qa/image-inspector.mjs';
import { muxFramesAndAudio } from '../../tools/render/mux-mp4.mjs';

test('G14: Repeatability & determinism across two independent Chromium WebGL sessions', async () => {
  const renderOnce = async (tag) => {
    const outDir = path.join(PROJECT_ROOT, 'workspace', 'cache', `det-${tag}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    const session = new ShortRendererSession();
    try {
      await session.initialize({ projectId: 'soldier-baseline' });
      return await session.renderFrameList([0, 160, 401], { outputDir: outDir, quality: 0.96 });
    } finally {
      await session.dispose();
    }
  };

  const runA = await renderOnce('a');
  const runB = await renderOnce('b');
  for (let i = 0; i < 3; i++) {
    assert.equal(
      runA.frames[i].sha256,
      runB.frames[i].sha256,
      `Frame ${runA.frames[i].frameIndex} differed across repeated controlled runs`
    );
  }
});

test('Backtest: vendor snapshot immutable after modular-world hydration & Zombie render', () => {
  const manifest = loadSourceManifest();
  const vendorKitDir = path.join(PROJECT_ROOT, 'vendor', 'cartoon-short-kit');
  const check = verifyVendorSnapshot({ vendorKitDir, manifest });
  assert.equal(check.allMatched, true);
});

test('Negative tests (1-4): missing Three.js, missing toon.js, invalid frame ranges, corrupted/16:9 images', async () => {
  const brokenBase = path.join(PROJECT_ROOT, 'workspace', 'cache', 'neg-web');
  fs.rmSync(brokenBase, { recursive: true, force: true });
  fs.mkdirSync(path.join(brokenBase, 'lib'), { recursive: true });
  for (const f of ['index.html', 'main.js', 'paint.js', 'story.js', 'toon.js']) {
    fs.writeFileSync(path.join(brokenBase, f), '// stub');
  }

  // 1. Missing Three.js
  {
    const s = new ShortRendererSession();
    await assert.rejects(() => s.initialize({ webDir: brokenBase }), /MISSING_ENGINE_DEPENDENCIES.*three\.module\.js/);
  }

  // 2. Missing toon.js
  fs.writeFileSync(path.join(brokenBase, 'lib', 'three.module.js'), '// stub');
  fs.rmSync(path.join(brokenBase, 'toon.js'));
  {
    const s = new ShortRendererSession();
    await assert.rejects(() => s.initialize({ webDir: brokenBase }), /MISSING_ENGINE_DEPENDENCIES.*toon\.js/);
  }

  // 3. Invalid frame range & step
  assert.throws(() => parseFrameSpec('50-10'), /INVALID_FRAME_RANGE/);
  assert.throws(() => parseFrameSpec('0-10', -1), /INVALID_FRAME_STEP/);

  // 4. Corrupted JPEG & wrong aspect ratio (16:9 rejected)
  const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assert.equal(inspectJpegBuffer(truncated).valid, false);

  const landscape16x9 = path.join(brokenBase, 'bad16x9.jpg');
  execFileSync('python3', [
    '-c',
    `from PIL import Image; Image.new('RGB', (1920, 1080), (100, 120, 140)).save(${JSON.stringify(landscape16x9)})`,
  ]);
  const sheetRes = spawnSync(
    'python3',
    [path.join(PROJECT_ROOT, 'tools/render/contact-sheet.py'), landscape16x9, path.join(brokenBase, 'out.jpg')],
    { encoding: 'utf8' }
  );
  assert.notEqual(sheetRes.status, 0, '16:9 image must be rejected by contact-sheet.py');
  assert.match(sheetRes.stderr, /INVALID_ASPECT_RATIO/);
});

test('Negative tests (5-8): invalid audio, missing script without ASR, browser startup failure, FFmpeg failure', async () => {
  const negDir = path.join(PROJECT_ROOT, 'workspace', 'cache', 'neg-proc');
  fs.rmSync(negDir, { recursive: true, force: true });
  fs.mkdirSync(negDir, { recursive: true });

  const corruptAudio = path.join(negDir, 'corrupt.mp3');
  fs.writeFileSync(corruptAudio, 'NOT_AN_AUDIO_FILE_BYTES');

  // 5. Invalid audio input in timing_validator.py and mix.py
  const tRes = spawnSync(
    'python3',
    [path.join(PROJECT_ROOT, 'tools/timing/timing_validator.py'), corruptAudio, 'Hello world.', '--out', negDir],
    { encoding: 'utf8' }
  );
  assert.notEqual(tRes.status, 0);
  assert.match(tRes.stderr, /INVALID_AUDIO_INPUT/);

  const mRes = spawnSync(
    'python3',
    [path.join(PROJECT_ROOT, 'tools/audio/mix.py'), '--voice', corruptAudio, '--out', path.join(negDir, 'm.wav')],
    { encoding: 'utf8' }
  );
  assert.notEqual(mRes.status, 0);
  assert.match(mRes.stderr, /AUDIO_DECODE_FAILED/);

  // 6. Missing script during required alignment (no Whisper installed)
  let validVoice = path.join(PROJECT_ROOT, 'workspace/projects/soldier-baseline/work/voice.mp3');
  if (!fs.existsSync(validVoice)) {
    validVoice = path.join(negDir, 'valid-sample.wav');
    execFileSync('python3', [
      '-c',
      `import math, struct, wave, sys
sr = 24000
frames = [int(math.sin(2*math.pi*260*i/sr)*10000) for i in range(sr)]
with wave.open(sys.argv[1], 'wb') as wf:
    wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
    wf.writeframes(struct.pack('<' + 'h'*len(frames), *frames))`,
      validVoice,
    ]);
  }
  const noScriptRes = spawnSync(
    'python3',
    [path.join(PROJECT_ROOT, 'tools/timing/timing_validator.py'), validVoice, '--out', negDir],
    { encoding: 'utf8' }
  );
  assert.notEqual(noScriptRes.status, 0);
  assert.match(noScriptRes.stderr, /MISSING_SCRIPT_AND_ASR/);

  // 7. Browser startup failure cleans up loopback server & concurrency slot
  {
    const s = new ShortRendererSession();
    await assert.rejects(
      () => s.initialize({ projectId: 'soldier-baseline', executablePath: '/nonexistent/chromium-binary-xyz' }),
      /executable doesn't exist|ENOENT|Failed to launch/i
    );
    assert.equal(s.disposed, true);
  }

  // 8. FFmpeg process failure (missing frame in sequence / corrupt WAV)
  const emptyFramesDir = path.join(negDir, 'frames');
  fs.mkdirSync(emptyFramesDir, { recursive: true });
  assert.throws(
    () =>
      muxFramesAndAudio({
        framesDir: emptyFramesDir,
        audioWavPath: corruptAudio,
        outputMp4Path: path.join(negDir, 'fail.mp4'),
        expectedFrameCount: 3,
      }),
    /MISSING_SEQUENCE_FRAME/
  );
});

test('Negative tests (9-12): insufficient disk space, canceled render, interrupted/stale cache recovery', async () => {
  // 9. Insufficient disk space preflight
  assert.throws(() => checkFreeDiskMb(PROJECT_ROOT, 999_999_999), /DISK_PREFLIGHT_FAILED/);

  const cacheDir = path.join(PROJECT_ROOT, 'workspace', 'cache', 'neg-cancel-stale');
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  // Plant a stale/truncated partial f0000.jpg from a simulated interrupted render
  const staleFrame0 = path.join(cacheDir, 'f0000.jpg');
  fs.writeFileSync(staleFrame0, Buffer.from([0xff, 0xd8, 0x00, 0x11, 0x22]));
  assert.equal(inspectJpegFile(staleFrame0).valid, false);

  const session = new ShortRendererSession();
  try {
    await session.initialize({ projectId: 'soldier-baseline' });

    // 10. Canceled render via AbortController
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => session.renderFrameRange(0, 5, { outputDir: cacheDir, signal: ac.signal }),
      /RENDER_CANCELED/
    );

    // 11 & 12. Resume with stale/corrupted f0000.jpg detects corruption, purges stale file, and re-renders valid frame
    const rec = await session.renderFrameList([0, 1], { outputDir: cacheDir, resume: true });
    assert.equal(rec.resumedCount, 0, 'Corrupted f0000.jpg must NOT be treated as valid resumed cache');
    assert.equal(rec.renderedCount, 2);
    const fixedCheck = inspectJpegFile(staleFrame0);
    assert.equal(fixedCheck.valid, true);
    assert.equal(fixedCheck.width, 1080);
    assert.equal(fixedCheck.height, 1920);
  } finally {
    await session.dispose();
  }
});
