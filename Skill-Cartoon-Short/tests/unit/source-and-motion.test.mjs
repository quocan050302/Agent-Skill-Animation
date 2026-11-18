import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  loadSourceManifest,
  PROJECT_ROOT,
  sha256File,
  verifyVendorSnapshot,
} from '../../tools/setup/hydrate.mjs';
import { parseFrameSpec } from '../../engine/adapters/renderer-adapter.mjs';
import { validateProjectRenderRequest } from '../../app/shared/contract.mjs';

test('G01/G02: source manifest inventory and byte-identical SHA-256 verification', () => {
  const manifest = loadSourceManifest();
  assert.equal(manifest.entries.length, 14, 'Expected all 14 files from cartoon-short-kit.zip');
  const vendorKitDir = path.join(PROJECT_ROOT, 'vendor', 'cartoon-short-kit');
  const check = verifyVendorSnapshot({ vendorKitDir, manifest });
  assert.equal(check.allMatched, true, `Mismatches: ${JSON.stringify(check.mismatches)}`);

  // Hydrated engine/web files must also be byte-identical to original kit files
  for (const rel of ['index.html', 'main.js', 'motion.js', 'paint.js', 'roman.js']) {
    const srcSha = sha256File(path.join(vendorKitDir, 'engine', rel));
    const dstSha = sha256File(path.join(PROJECT_ROOT, 'engine', 'web', rel));
    assert.equal(dstSha, srcSha, `Hydrated engine/web/${rel} diverged from vendor snapshot`);
  }
  assert.equal(
    sha256File(path.join(vendorKitDir, 'example/soldier/story.js')),
    sha256File(path.join(PROJECT_ROOT, 'engine/web/story.js'))
  );
});

test('Frame range parser handles singles, ranges, steps, and rejects malformed inputs', () => {
  assert.deepEqual(parseFrameSpec('0,5,10'), [0, 5, 10]);
  assert.deepEqual(parseFrameSpec('0-6', 2), [0, 2, 4, 6]);
  assert.deepEqual(parseFrameSpec('0,2-4,3'), [0, 2, 3, 4]);

  assert.throws(() => parseFrameSpec(''), /INVALID_FRAME_SPEC/);
  assert.throws(() => parseFrameSpec('10-4'), /INVALID_FRAME_RANGE/);
  assert.throws(() => parseFrameSpec('0-5', 0), /INVALID_FRAME_STEP/);
  assert.throws(() => parseFrameSpec('abc'), /INVALID_FRAME_INDEX/);
  assert.throws(() => parseFrameSpec('-3'), /INVALID_FRAME_RANGE/);
});

test('Motion module determinism, camera interpolation, spline finiteness, walk & quantization', async () => {
  const motionMod = await import(path.join(PROJECT_ROOT, 'engine', 'web', 'motion.js'));
  const keys = [
    { f: 0, pos: [0, 2, 5], look: [0, 1, 0], fov: 40 },
    { f: 30, pos: [2, 3, 2], look: [0, 1.2, -1], fov: 36, path: [[1, 2.8, 3.8]], ease: 'smooth' },
    { f: 60, pos: [2, 3, 1], look: [0, 1.2, -1], fov: 34, roll: -3 },
  ];

  for (let f = -5; f <= 70; f++) {
    const c1 = motionMod.camFromKeys(keys, f, { kicks: [{ f: 20, a: 0.04 }] });
    const c2 = motionMod.camFromKeys(keys, f, { kicks: [{ f: 20, a: 0.04 }] });
    assert.deepEqual(c1, c2, `Non-deterministic camera at frame ${f}`);
    assert.equal(c1.pos.every(Number.isFinite), true);
    assert.equal(c1.look.every(Number.isFinite), true);
    assert.equal(Number.isFinite(c1.fov) && c1.fov > 5 && c1.fov < 120, true);
  }

  // Idle & blink determinism + variation across frames
  const id0a = motionMod.idle(0, 7);
  const id0b = motionMod.idle(0, 7);
  const id15 = motionMod.idle(15, 7);
  assert.deepEqual(id0a, id0b);
  assert.notDeepEqual(id0a, id15, 'Idle state must evolve with frame index');

  const blinks = Array.from({ length: 80 }, (_, f) => motionMod.blinkAt(f, 3));
  assert.equal(blinks.includes(0) && blinks.includes(0.5) && blinks.includes(1), true);

  const w0 = motionMod.walk(10, 10, 1.2, 0.8);
  const w30 = motionMod.walk(40, 10, 1.2, 0.8);
  assert.equal(w0.dist, 0);
  assert.equal(Math.abs(w30.dist - 1.2) < 1e-9, true);
  assert.equal(w30.phase >= 0 && w30.phase < 1, true);
  assert.equal(motionMod.q(1.23456, 2), 1.23);
});

test('Original Soldier story.js shot continuity, camera, DOF, lighting, and world state', async () => {
  const story = await import(path.join(PROJECT_ROOT, 'engine', 'web', 'story.js'));
  assert.equal(story.FPS, 30);
  assert.equal(story.TOTAL, 592);
  assert.equal(story.SHOTS.length, 8);
  assert.equal(story.SHOTS[0].a, 0);
  assert.equal(story.SHOTS[story.SHOTS.length - 1].b, 591);

  for (let i = 1; i < story.SHOTS.length; i++) {
    assert.equal(story.SHOTS[i].a, story.SHOTS[i - 1].b + 1, 'Shots must cover 0..591 without gaps');
  }

  for (let f = 0; f < story.TOTAL; f += 13) {
    const s = story.shotAt(f);
    const c = story.camAt(f);
    const d = story.dofAt(f);
    const l = story.lightFor(s, f);
    const w = story.worldAt(f);
    assert.ok(s && s.id);
    assert.equal(c.pos.every(Number.isFinite), true);
    assert.equal(c.look.every(Number.isFinite), true);
    assert.equal(Number.isFinite(d.focus) && d.focus > 0, true);
    assert.equal(Number.isFinite(l.sunI) && l.sunI > 0, true);
    assert.equal(typeof w.old, 'boolean');
  }
});

test('Timing math & manifest validator enforce frame math, ordering, and missing-word checks', () => {
  const pyCheck = `
import json, os, sys
sys.path.insert(0, os.path.abspath('tools/timing'))
import timing_validator as tv

mod = tv.load_kit_timing_module('.')
assert mod.syll('bridge') == 1
assert mod.syll('centuries') >= 2
assert mod.syll('30') == 1 or mod.syll('30') == 2

segs = [[0.1, 1.5], [1.8, 3.2]]
words, phr, cost = mod.align('The bridge is old, do not cross.', segs)
doc = {'duration': 3.4, 'frames30': round(3.4 * 30), 'source': 'silence-align', 'segments': segs, 'phrases': phr}
res_ok = tv.validate_timing_manifest(words, doc, script_text='The bridge is old, do not cross.')
assert res_ok['valid'] is True, res_ok
assert res_ok['alignmentPrecision'] == 'approximate-silence-dp'

# Negative / corrupt manifest checks
bad_doc = dict(doc, frames30=999)
assert tv.validate_timing_manifest(words, bad_doc)['valid'] is False

bad_words = [{'w': 'The', 's': -0.2, 'e': 0.3}]
assert tv.validate_timing_manifest(bad_words, doc)['valid'] is False

beyond_words = [{'w': 'The', 's': 3.1, 'e': 4.5}]
assert tv.validate_timing_manifest(beyond_words, doc)['valid'] is False
print('TIMING_UNIT_OK')
`;
  const out = execFileSync('python3', ['-c', pyCheck], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  assert.match(out, /TIMING_UNIT_OK/);
});

test('UI format contract strictly locks 9:16 1080x1920 @ 30 FPS and rejects Skia/Remotion/16:9', () => {
  const ok = validateProjectRenderRequest({ projectId: 'soldier-baseline', startFrame: 0, endFrame: 10 });
  assert.equal(ok.format.aspectRatio, '9:16');
  assert.throws(() => validateProjectRenderRequest({ aspectRatio: '16:9' }), /UNSUPPORTED_ASPECT_RATIO/);
  assert.throws(() => validateProjectRenderRequest({ width: 1920, height: 1080 }), /UNSUPPORTED_WIDTH/);
  assert.throws(() => validateProjectRenderRequest({ fps: 60 }), /UNSUPPORTED_FPS/);
  assert.throws(() => validateProjectRenderRequest({ engine: 'skia' }), /PROHIBITED_ENGINE/);
  assert.throws(() => validateProjectRenderRequest({ engine: 'remotion' }), /PROHIBITED_ENGINE/);
});
