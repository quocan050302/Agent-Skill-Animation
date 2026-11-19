import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ASPECT_RATIOS,
  DEFAULT_VOICE_ID,
  GEMINI_PREBUILT_VOICES,
  validateAspectRatio,
  validateVoiceId,
} from '../../app/shared/contract.mjs';
import {
  getSanitizedTtsSettings,
  loadTtsSettings,
  maskKey,
  redactSecrets,
  updateTtsSettings,
} from '../../app/server/services/settings-store.mjs';
import {
  classifyGeminiModel,
  rankGeminiModels,
  resolveTtsCandidates,
} from '../../app/server/services/gemini-models.mjs';
import {
  classifyGeminiError,
  inspectWavBuffer,
  validateTtsAudioResponse,
  wavWrapPcm16,
} from '../../app/server/services/gemini-transport.mjs';
import { sniffAudioMagic } from '../../app/server/services/media-store.mjs';
import { buildCuesSpecFromWords, getSubtitleCueAtTime } from '../../app/server/services/subtitle-service.mjs';
import { evaluateAllGates } from '../../tools/qa/verify-gates.mjs';
import { muxFramesAndAudio } from '../../tools/render/mux-mp4.mjs';
import { PROJECT_ROOT } from '../../tools/setup/hydrate.mjs';

function makeTonePcm16(durationSec = 0.25, sampleRate = 24000, channels = 1) {
  const frames = Math.floor(durationSec * sampleRate);
  const buf = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * 320 * i) / sampleRate) * 12000);
    for (let ch = 0; ch < channels; ch++) {
      buf.writeInt16LE(val, (i * channels + ch) * 2);
    }
  }
  return buf;
}

test('Gemini model classification & ranking strictly filters TTS-capable generateContent models', () => {
  const catalog = [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.0-flash-live-001', supportedGenerationMethods: ['bidiGenerateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/imagen-3.0-generate-002', supportedGenerationMethods: ['generateContent'] },
    {
      name: 'models/gemini-2.0-flash-tts-old',
      description: 'Deprecated model, sunset soon.',
      supportedGenerationMethods: ['generateContent'],
    },
  ];

  const ranked = rankGeminiModels(catalog, { policy: 'quality', includePreview: true });
  assert.deepEqual(
    ranked.map((m) => m.id),
    ['gemini-2.5-pro-preview-tts', 'gemini-2.5-flash-preview-tts']
  );

  const nonTts = classifyGeminiModel(catalog[0]);
  assert.equal(nonTts.capabilities.tts, false);
  assert.equal(nonTts.exclusionReason, 'not_tts_capable');

  // Manual non-TTS model selection must fail closed
  const badManual = resolveTtsCandidates(catalog, { selectionMode: 'manual', manualModel: 'gemini-2.5-flash' });
  assert.equal(badManual.candidates.length, 0);
  assert.match(badManual.manualRejectedReason, /MODEL_NOT_TTS_CAPABLE/);
});

test('Gemini error classification halts on global/daily 429 & auth errors, allows model-specific 429/503 fallback', () => {
  const global429 = Object.assign(new Error('Quota exceeded for GenerateRequestsPerDay'), {
    status: 429,
    grpcStatus: 'RESOURCE_EXHAUSTED',
  });
  const clsGlobal = classifyGeminiError(global429);
  assert.equal(clsGlobal.category, 'quota_global');
  assert.equal(clsGlobal.fallbackEligible, false);
  assert.equal(clsGlobal.retryable, false);

  const model429 = Object.assign(new Error('Rate limit PerMinutePerProjectPerModel exceeded'), {
    status: 429,
    grpcStatus: 'RESOURCE_EXHAUSTED',
    quotaScope: 'model',
  });
  const clsModel = classifyGeminiError(model429);
  assert.equal(clsModel.category, 'rate_limited_model');
  assert.equal(clsModel.fallbackEligible, true);

  const auth401 = Object.assign(new Error('API_KEY_INVALID'), { status: 401 });
  assert.equal(classifyGeminiError(auth401).fallbackEligible, false);

  const overload503 = Object.assign(new Error('Service unavailable'), { status: 503 });
  assert.equal(classifyGeminiError(overload503).fallbackEligible, true);
});

test('WAV/PCM MIME validation wraps raw L16 once, never double-wraps audio/wav, and rejects corrupt/silent payloads', () => {
  const pcm = makeTonePcm16(0.25, 24000, 1);

  // 1. Raw PCM audio/L16 wrapped ONCE
  const resPcm = validateTtsAudioResponse({
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }],
        },
      },
    ],
  });
  assert.equal(resPcm.alreadyWrapped, false);
  assert.equal(resPcm.wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(resPcm.metadata.sampleRate, 24000);
  assert.equal(resPcm.metadata.channels, 1);

  // 2. Already RIFF audio/wav MUST NOT double-wrap!
  const preWrapped = wavWrapPcm16(pcm, 24000, 1);
  const resWav = validateTtsAudioResponse({
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: 'audio/wav', data: preWrapped.toString('base64') } }],
        },
      },
    ],
  });
  assert.equal(resWav.alreadyWrapped, true);
  assert.equal(resWav.wav.length, preWrapped.length, 'Already-RIFF WAV must never be double-wrapped');
  assert.notEqual(resWav.wav.subarray(44, 48).toString('ascii'), 'RIFF');

  // 3. Double-wrapped WAV explicitly rejected by inspectWavBuffer
  const doubleWrapped = wavWrapPcm16(preWrapped, 24000, 1);
  assert.throws(() => inspectWavBuffer(doubleWrapped), /DOUBLE_WRAPPED_WAV_DETECTED/);

  // 4. Unexpected MIME rejected
  assert.throws(
    () =>
      validateTtsAudioResponse({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'text/plain', data: pcm.toString('base64') } }] } }],
      }),
    /UNSUPPORTED_AUDIO_MIME/
  );

  // 5. Silent all-zero PCM rejected
  const silentPcm = Buffer.alloc(24000 * 2 * 0.2);
  assert.throws(
    () =>
      validateTtsAudioResponse({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: silentPcm.toString('base64') } }] } },
        ],
      }),
    /SILENT_TTS_AUDIO/
  );

  // 6. Malformed base64 & text-only response rejected
  assert.throws(
    () =>
      validateTtsAudioResponse({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: '%%%BAD%%%' } }] } }],
      }),
    /MALFORMED_BASE64_AUDIO/
  );
  assert.throws(
    () => validateTtsAudioResponse({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] }),
    /NO_AUDIO_DATA/
  );
});

test('Settings store enforces 0600 permissions, masks/redacts secrets, and never leaks raw API keys', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-settings-'));
  try {
    const fakeKey = ['AIza', 'SyFakeSecretUnitTestKey1234567890'].join('');
    await updateTtsSettings({ apiKey: fakeKey, defaultVoice: 'Charon' }, { settingsDir: tmpDir });
    const filePath = path.join(tmpDir, 'tts-settings.json');
    const mode = fs.statSync(filePath).mode & 0o777;
    assert.equal(mode, 0o600);

    const loaded = loadTtsSettings(tmpDir);
    const sanitized = getSanitizedTtsSettings(loaded, {});
    assert.equal(sanitized.hasKey, true);
    assert.equal(sanitized.keySource, 'settings');
    assert.equal(sanitized.maskedKey, maskKey(fakeKey));
    assert.equal(sanitized.maskedKey.includes('AIza'), false);
    assert.equal(redactSecrets(`Error with ${fakeKey} ?key=secret123`, [fakeKey]).includes(fakeKey), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Voice allowlist, ratio truth table, and audio magic sniffer enforce strict boundaries', () => {
  assert.equal(DEFAULT_VOICE_ID, 'Kore');
  assert.equal(GEMINI_PREBUILT_VOICES.some((v) => v.id === 'Kore' && v.isDefault), true);
  assert.equal(validateVoiceId('Kore'), 'Kore');
  assert.throws(() => validateVoiceId('FakeInventorVoice'), /UNSUPPORTED_VOICE_ID/);

  assert.equal(validateAspectRatio('9:16').width, 1080);
  assert.equal(ASPECT_RATIOS['1:1'].supported, false);
  assert.equal(ASPECT_RATIOS['16:9'].supported, false);
  assert.throws(() => validateAspectRatio('16:9'), /UNSUPPORTED_ASPECT_RATIO/);
  assert.throws(() => validateAspectRatio('1:1'), /UNSUPPORTED_ASPECT_RATIO/);

  assert.equal(sniffAudioMagic(wavWrapPcm16(makeTonePcm16(0.1), 24000, 1)).format, 'wav');
  assert.throws(() => sniffAudioMagic(Buffer.from('PK\x03\x04fakezippayload123456')), /SPOOFED_AUDIO_FILE/);
  assert.throws(
    () => sniffAudioMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])),
    /SPOOFED_AUDIO_FILE/
  );
  assert.throws(() => sniffAudioMagic(Buffer.from('<html><body>not audio</body></html>')), /SPOOFED_AUDIO_FILE/);
});

test('Subtitle service & cartoon_subs.py escape braces, preserve BGR colors & punchWords, and keep cues non-overlapping', () => {
  const words = [
    { w: 'Fake', s: 0.2, e: 0.6 },
    { w: '{rubber}', s: 0.6, e: 1.0 },
    { w: 'tanks', s: 1.0, e: 1.5 },
    { w: 'fooled', s: 1.45, e: 1.9 },
    { w: 'scouts.', s: 1.9, e: 2.4 },
  ];
  const spec = buildCuesSpecFromWords({
    title: 'Unit Sub Test',
    words,
    punchWords: ['FAKE', 'TANKS'],
    maxWordsPerChunk: 3,
  });
  assert.equal(spec.chunks.length, 2);
  assert.equal(spec.chunks[0].e <= spec.chunks[1].s, true, 'Chunks must never overlap');

  const cue = getSubtitleCueAtTime(spec, 0.35);
  assert.equal(cue.active, true);
  assert.equal(cue.words[0].text, 'FAKE');
  assert.equal(cue.words[0].isPunch, true);

  // Run real cartoon_subs.py to inspect generated ASS escaping and colors
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-sub-'));
  try {
    const cuesPath = path.join(tmpDir, 'cues.json');
    const assPath = path.join(tmpDir, 'out.ass');
    fs.writeFileSync(cuesPath, JSON.stringify(spec), 'utf8');
    execFileSync('python3', [path.join(PROJECT_ROOT, 'tools/subtitles/cartoon_subs.py'), '--cues', cuesPath, '--ass-out', assPath]);
    const ass = fs.readFileSync(assPath, 'utf8');
    assert.match(ass, /PlayResX: 1080/);
    assert.match(ass, /PlayResY: 1920/);
    assert.match(ass, /&H00261724&/, 'Dark plum ink outline #241726 must convert to ASS BGR');
    assert.match(ass, /&H0055E0FF&/, 'Golden active highlight #FFE055 must convert to ASS BGR');
    assert.match(ass, /\\\{RUBBER\\\}/, 'Curly braces in spoken words must be ASS-escaped');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('QA verify-gates.mjs eliminates G14 false PASS on undefined and preserves G03 BLOCKED', () => {
  const resUndefined = evaluateAllGates({});
  const g14Undef = resUndefined.gates.find((g) => g.gate === 'G14');
  const g03 = resUndefined.gates.find((g) => g.gate === 'G03');
  assert.equal(g14Undef.status, 'UNVERIFIED', 'G14 must NEVER return PASS when dagTestsPassed is undefined');
  assert.equal(g03.status, 'BLOCKED', 'G03 redistribution gate must remain truthfully BLOCKED');

  const resFail = evaluateAllGates({ dagTestsPassed: false });
  assert.equal(resFail.gates.find((g) => g.gate === 'G14').status, 'FAIL');

  const resPass = evaluateAllGates({ dagTestsPassed: true });
  assert.equal(resPass.gates.find((g) => g.gate === 'G14').status, 'PASS');
});

test('muxFramesAndAudio strictDurationGuard prevents silent -shortest voice truncation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-mux-guard-'));
  try {
    const framesDir = path.join(tmpDir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });
    // Create 3 dummy frame placeholders
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(framesDir, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    // 2.0 second WAV vs 3 frames (0.10s) -> must throw AUDIO_LONGER_THAN_VIDEO when strictDurationGuard: true!
    const longWav = path.join(tmpDir, 'long.wav');
    fs.writeFileSync(longWav, wavWrapPcm16(makeTonePcm16(2.0, 24000, 1), 24000, 1));
    assert.throws(
      () =>
        muxFramesAndAudio({
          framesDir,
          audioWavPath: longWav,
          outputMp4Path: path.join(tmpDir, 'out.mp4'),
          expectedFrameCount: 3,
          strictDurationGuard: true,
        }),
      /AUDIO_LONGER_THAN_VIDEO/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
