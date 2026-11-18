import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  disposeRenderer,
  getRenderMetadata,
  initializeRenderer,
  renderFrame,
  renderFrameRange,
  renderStill,
} from '../../engine/adapters/renderer-adapter.mjs';
import { analyzeFramesWithPillow, inspectJpegFile } from '../../tools/qa/image-inspector.mjs';
import { muxFramesAndAudio, probeMp4 } from '../../tools/render/mux-mp4.mjs';
import { PROJECT_ROOT } from '../../tools/setup/hydrate.mjs';

test('G05-G10: Renderer adapter initializes WebGL, renders final + #nd + #e passes, and validates 9:16 frames', async () => {
  const outDir = path.join(PROJECT_ROOT, 'workspace', 'cache', 'test-integration-frames');
  fs.rmSync(outDir, { recursive: true, force: true });

  try {
    const meta = await initializeRenderer({ projectId: 'soldier-baseline' });
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1920);
    assert.equal(meta.totalFrames, 592);
    assert.match(meta.glVersion, /WebGL/i);

    // Single still render
    const still0 = await renderStill(0);
    assert.equal(still0.width, 1080);
    assert.equal(still0.height, 1920);
    assert.equal(still0.nonBlackRatio > 0.95, true);
    assert.ok(Buffer.isBuffer(still0.buffer) && still0.buffer.length > 50000);

    // Normal+Depth (#nd) pass check: confirms depth/normal buffer is populated
    const ndPath = path.join(outDir, 'debug_nd.jpg');
    const ndFrame = await renderFrame(0, { debugMode: 'nd', outputPath: ndPath, allowBlack: true });
    assert.equal(inspectJpegFile(ndPath).valid, true);
    assert.equal(ndFrame.meanLuma > 5, true, 'Normal+depth pass should contain non-empty geometry normals');

    // Ink Edge (#e) pass check: confirms screen-space ink outlines exist
    const edgePath = path.join(outDir, 'debug_edge.jpg');
    const edgeFrame = await renderFrame(68, { debugMode: 'edge', outputPath: edgePath, allowBlack: true });
    assert.equal(inspectJpegFile(edgePath).valid, true);
    assert.equal(edgeFrame.meanLuma > 0.5, true, 'Screen-space ink edge pass must produce visible edge pixels');

    // Contiguous short range (0..14) for MP4 muxing integration test
    const seqDir = path.join(outDir, 'seq');
    const rangeRes = await renderFrameRange(0, 14, { outputDir: seqDir, quality: 0.92 });
    assert.equal(rangeRes.frameCount, 15);

    const samplePaths = [0, 7, 14].map((f) => path.join(seqDir, `f${String(f).padStart(4, '0')}.jpg`));
    const pillowStats = analyzeFramesWithPillow(samplePaths);
    for (const st of pillowStats) {
      assert.equal(st.valid, true);
      assert.equal(st.width, 1080);
      assert.equal(st.height, 1920);
      assert.equal(st.nonBlackRatio > 0.95, true);
      assert.equal(st.darkInkRatio > 0.01, true, 'Character dark-plum ink outlines must be present');
      assert.equal(st.edgeGradientMean > 0.8 && st.edgeGradientP99 > 20, true, 'Crisp toon/ink edges expected');
    }

    const liveMeta = getRenderMetadata();
    assert.equal(liveMeta.pageErrors.length, 0);
    assert.equal(liveMeta.httpErrors.length, 0);
  } finally {
    await disposeRenderer();
  }
});

test('G11-G13: Spec-compliant linear gated-RMS mixer (-6 dB) and H.264/AAC faststart MP4 export', () => {
  const workDir = path.join(PROJECT_ROOT, 'workspace', 'cache', 'test-integration-audio');
  fs.mkdirSync(workDir, { recursive: true });

  // Verify spec-compliant mixer against synthetic stems
  const pyMixTest = `
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.abspath('tools/audio'))
import mix

sr = mix.SR
t = np.arange(sr * 2) / sr
voice = (0.25 * np.sin(2 * np.pi * 180 * t) * (np.sin(2 * np.pi * 3 * t) > -0.2)).astype(np.float32)
music = (0.4 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
sfx = np.zeros_like(voice)
sfx[12000:24000] = (0.85 * np.sin(2 * np.pi * 660 * np.arange(12000) / sr)).astype(np.float32)

out_wav = os.path.join(${JSON.stringify(workDir)}, 'short_mix.wav')
mixed, rep = mix.mix_linear_spec_compliant(voice, music, sfx, music_rel_db=-6.0, sfx_rel_db=-6.0)
mix.write_stereo_wav_int16(out_wav, mixed, sr)
print(json.dumps(rep))
`;
  const repRaw = execFileSync('python3', ['-c', pyMixTest], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  const rep = JSON.parse(repRaw);
  assert.equal(rep.duckingApplied, false);
  assert.equal(rep.narrationUntouchedBeforeMaster, true);
  assert.equal(Math.abs(rep.measuredMusicRelDb - -6.0) < 0.15, true, `Got ${rep.measuredMusicRelDb}`);
  assert.equal(rep.sfxPeakDbfs <= -2.8, true, `SFX peak ceiling exceeded: ${rep.sfxPeakDbfs}`);
  assert.equal(rep.masterPeakDbfs <= -0.95, true, `Master peak ceiling exceeded: ${rep.masterPeakDbfs}`);

  // Mux the 15 frames rendered in previous test with short_mix.wav
  const seqDir = path.join(PROJECT_ROOT, 'workspace', 'cache', 'test-integration-frames', 'seq');
  const outMp4 = path.join(workDir, 'integration-out.mp4');
  const probe = muxFramesAndAudio({
    framesDir: seqDir,
    audioWavPath: path.join(workDir, 'short_mix.wav'),
    outputMp4Path: outMp4,
    expectedFrameCount: 15,
    preset: 'ultrafast',
  });

  assert.equal(probe.valid, true);
  assert.equal(probe.video.codec, 'h264');
  assert.equal(probe.video.width, 1080);
  assert.equal(probe.video.height, 1920);
  assert.equal(probe.video.pixFmt, 'yuv420p');
  assert.equal(probe.video.nbFrames, 15);
  assert.equal(probe.audio.codec, 'aac');
  assert.equal(probe.fastStart.fastStartVerified, true);
  assert.equal(probe.blackEvents.length, 0);
  assert.equal(probeMp4(outMp4).valid, true);
});
