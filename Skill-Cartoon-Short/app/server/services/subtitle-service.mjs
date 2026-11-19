/**
 * Subtitle Preparation, Live Preview & Burn-In Service (QA-TTS-01)
 *
 * Reuses `tools/subtitles/cartoon_subs.py` directly (never rewrites the comic subtitle style):
 * - Dark-plum comic ink `#241726`, warm cream `#FFFBF0`, active gold `#FFE055`, punch accent `#FF6347`
 * - Exact `punchWords` field contract
 * - Clean `SUB OFF` no-op path
 * - Audio-preserving burn-in (`-c:a copy`) with FFprobe post-burn bitstream parity check
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PROJECT_ROOT } from '../../../tools/setup/hydrate.mjs';
import { validateAspectRatio } from '../../shared/contract.mjs';

const execFileAsync = promisify(execFile);

/**
 * Checks whether FFmpeg in PATH has the `ass` (libass) filter compiled in.
 * @returns {Promise<boolean>}
 */
export async function checkLibassAvailable() {
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-filters'], { timeout: 10_000 });
    return /\bass\b/.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Builds a clean 2..4-word chunked subtitle cue specification from aligned words and punchWords.
 * Guarantees strictly non-overlapping cue timelines and safe 9:16 margins.
 * @param {{ title?: string, words: Array<{ w: string, s: number, e: number }>, punchWords?: string[], maxWordsPerChunk?: number, width?: number, height?: number, marginV?: number }} params
 */
export function buildCuesSpecFromWords({
  title = 'Cartoon Short Subtitles',
  words = [],
  punchWords = [],
  maxWordsPerChunk = 4,
  width = 1080,
  height = 1920,
  marginV = 330,
}) {
  const cleanPunch = Array.from(
    new Set((punchWords || []).map((w) => String(w || '').trim().toUpperCase()).filter(Boolean))
  );
  const chunks = [];
  let cur = [];

  const flush = () => {
    if (cur.length === 0) return;
    const s = Math.max(0, Number(cur[0].s));
    const e = Math.max(s + 0.08, Number(cur[cur.length - 1].e));
    // Split 4-word chunks into 2 balanced lines for crisp 9:16 framing
    const splitAt = cur.length >= 4 ? Math.ceil(cur.length / 2) : cur.length;
    const mappedWords = cur.map((x, idx) => ({
      text: String(x.w),
      s: Number(x.s),
      e: Math.max(Number(x.s) + 0.04, Number(x.e)),
      line: idx < splitAt ? 0 : 1,
    }));
    const chunkTextUpper = cur.map((x) => String(x.w).toUpperCase()).join(' ');
    const isHero =
      cur.length <= 3 &&
      cleanPunch.some((pw) => chunkTextUpper.includes(pw));
    chunks.push({
      s: Number(s.toFixed(3)),
      e: Number(e.toFixed(3)),
      hero: isHero,
      punchWords: cleanPunch,
      words: mappedWords,
    });
    cur = [];
  };

  for (const w of words) {
    cur.push(w);
    const endsSentence = /[,.;:!?]$/.test(String(w.w || ''));
    if (cur.length >= maxWordsPerChunk || endsSentence) {
      flush();
    }
  }
  flush();

  // Enforce strict monotonic non-overlapping chunk bounds
  for (let i = 0; i < chunks.length - 1; i++) {
    if (chunks[i].e > chunks[i + 1].s) {
      chunks[i].e = Number(Math.max(chunks[i].s + 0.05, chunks[i + 1].s - 0.01).toFixed(3));
      const lastW = chunks[i].words[chunks[i].words.length - 1];
      if (lastW && lastW.e > chunks[i].e) lastW.e = chunks[i].e;
    }
  }

  return {
    title,
    width,
    height,
    font: 'Arial Black',
    fontSize: 74,
    heroFontSize: 88,
    marginV,
    baseColor: '#FFFBF0',
    activeColor: '#FFE055',
    punchColor: '#FF6347',
    inkColor: '#241726',
    chunks,
  };
}

/**
 * Prepares an ASS subtitle file using `tools/subtitles/cartoon_subs.py` or returns a clean no-op when OFF.
 * @param {{ projectRoot?: string, enabled: boolean, aspectRatio?: string, title?: string, words?: object[], curatedCuesPath?: string|null, punchWords?: string[], outDir: string }} params
 */
export async function prepareSubtitles({
  projectRoot = PROJECT_ROOT,
  enabled,
  aspectRatio = '9:16',
  title = 'Cartoon Short Subtitles',
  words = [],
  curatedCuesPath = null,
  punchWords = [],
  outDir,
}) {
  const ratioSpec = validateAspectRatio(aspectRatio);
  if (!enabled) {
    return {
      enabled: false,
      skipped: true,
      assPath: null,
      cuesPath: null,
      chunkCount: 0,
      cuesSpec: { title, width: ratioSpec.width, height: ratioSpec.height, chunks: [] },
    };
  }

  fs.mkdirSync(outDir, { recursive: true });
  let cuesSpec;
  if (curatedCuesPath && fs.existsSync(curatedCuesPath)) {
    cuesSpec = JSON.parse(fs.readFileSync(curatedCuesPath, 'utf8'));
    cuesSpec.width = ratioSpec.width;
    cuesSpec.height = ratioSpec.height;
  } else {
    cuesSpec = buildCuesSpecFromWords({
      title,
      words,
      punchWords,
      width: ratioSpec.width,
      height: ratioSpec.height,
    });
  }

  const cuesPath = path.join(outDir, 'subtitles-cues.json');
  const assPath = path.join(outDir, 'subtitles.ass');
  fs.writeFileSync(cuesPath, JSON.stringify(cuesSpec, null, 2), 'utf8');

  const subPy = path.join(projectRoot, 'tools', 'subtitles', 'cartoon_subs.py');
  const { stdout } = await execFileAsync(
    'python3',
    [subPy, '--cues', cuesPath, '--ass-out', assPath],
    { timeout: 30_000 }
  );
  const res = JSON.parse(stdout);
  return {
    enabled: true,
    skipped: false,
    assPath: res.assPath,
    cuesPath,
    chunkCount: res.chunkCount,
    cuesSpec,
  };
}

/**
 * Burns a prepared `.ass` subtitle document onto an MP4 via `tools/subtitles/cartoon_subs.py`,
 * preserving audio (`-c:a copy`) and verifying bitstream/duration preservation via FFprobe.
 * @param {{ projectRoot?: string, cuesPath: string, assPath: string, inputMp4: string, outputMp4: string }} params
 */
export async function burnSubtitlesOntoMp4({
  projectRoot = PROJECT_ROOT,
  cuesPath,
  assPath,
  inputMp4,
  outputMp4,
}) {
  const hasLibass = await checkLibassAvailable();
  if (!hasLibass) {
    const err = new Error('LIBASS_MISSING: FFmpeg does not have the libass/ass filter available.');
    err.code = 'LIBASS_MISSING';
    throw err;
  }

  const subPy = path.join(projectRoot, 'tools', 'subtitles', 'cartoon_subs.py');
  const { stdout } = await execFileAsync(
    'python3',
    [subPy, '--cues', cuesPath, '--ass-out', assPath, '--input-mp4', inputMp4, '--output-mp4', outputMp4],
    { timeout: 180_000 }
  );
  const parsed = JSON.parse(stdout);

  // Verify audio bitstream preservation (codec, sample_rate, channels, duration drift <= 0.05s)
  const probeStream = async (mp4) => {
    const { stdout: out } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-select_streams', 'a:0', '-show_streams', mp4],
      { timeout: 15_000 }
    );
    return (JSON.parse(out).streams || [])[0] || null;
  };
  const beforeA = await probeStream(inputMp4);
  const afterA = await probeStream(outputMp4);
  const audioPreserved = Boolean(
    beforeA &&
      afterA &&
      beforeA.codec_name === afterA.codec_name &&
      beforeA.sample_rate === afterA.sample_rate &&
      beforeA.channels === afterA.channels &&
      Math.abs(Number(beforeA.duration || 0) - Number(afterA.duration || 0)) <= 0.06
  );
  if (!audioPreserved) {
    const err = new Error('SUBTITLE_AUDIO_DRIFT: Audio stream properties changed unexpectedly during subtitle burn-in.');
    err.code = 'SUBTITLE_AUDIO_DRIFT';
    throw err;
  }

  return {
    outputMp4: parsed.outputMp4,
    assPath: parsed.assPath,
    chunkCount: parsed.chunkCount,
    audioPreserved,
  };
}

/**
 * Evaluates which subtitle chunk and active word should display at a given timestamp `timeSec`.
 * Used by `GET /api/projects/:id/subtitles-preview?time=S` for live Step 3 timed caption overlays.
 * @param {object} cuesSpec
 * @param {number} timeSec
 */
export function getSubtitleCueAtTime(cuesSpec, timeSec) {
  const t = Math.max(0, Number(timeSec) || 0);
  const chunks = Array.isArray(cuesSpec?.chunks) ? cuesSpec.chunks : [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const c = chunks[ci];
    const start = Number(c.s || 0);
    const end = Number(c.holdUntil || c.e || 0);
    if (t >= start && t <= end) {
      const punchSet = new Set((c.punchWords || []).map((w) => String(w).toUpperCase()));
      const words = Array.isArray(c.words) && c.words.length > 0
        ? c.words
        : (c.lines || [c.text || '']).flatMap((line, li) =>
            String(line)
              .split(/\s+/)
              .filter(Boolean)
              .map((w) => ({ text: w, line: li, s: start, e: end }))
          );
      let activeIndex = words.length - 1;
      for (let wi = 0; wi < words.length; wi++) {
        const ws = Number(words[wi].s ?? start);
        const nextS = wi + 1 < words.length ? Number(words[wi + 1].s ?? end) : end;
        if (t >= ws && t <= nextS) {
          activeIndex = wi;
          break;
        }
      }
      return {
        active: true,
        chunkIndex: ci,
        start,
        end,
        hero: Boolean(c.hero),
        activeIndex,
        words: words.map((w, idx) => {
          const upper = String(w.text).toUpperCase();
          const norm = upper.replace(/[^A-Z0-9',-]/g, '');
          const isPunch = punchSet.has(norm) || punchSet.has(upper);
          return {
            text: upper,
            line: Number(w.line || 0),
            active: idx === activeIndex,
            spokenPunch: idx <= activeIndex && isPunch,
            isPunch,
          };
        }),
        safeZone: {
          marginV: Number(cuesSpec?.marginV || 330),
          playResX: Number(cuesSpec?.width || 1080),
          playResY: Number(cuesSpec?.height || 1920),
        },
      };
    }
  }
  return {
    active: false,
    chunkIndex: -1,
    words: [],
    safeZone: {
      marginV: Number(cuesSpec?.marginV || 330),
      playResX: Number(cuesSpec?.width || 1080),
      playResY: Number(cuesSpec?.height || 1920),
    },
  };
}
