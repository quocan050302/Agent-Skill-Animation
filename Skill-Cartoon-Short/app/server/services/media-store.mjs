/**
 * Secure Per-Project Media Store & Audio Import Pipeline (QA-TTS-01)
 *
 * Enforces:
 * - Magic-byte sniffing (WAV RIFF/WAVE, MP3 ID3/MPEG frame sync, M4A/MP4 audio ftyp box)
 * - Hard size (<= 64 MiB) & duration (<= 180 s) bounds
 * - Single audio stream FFprobe check, zero video streams, non-silent audio check
 * - Symlink-safe realpath confinement inside `workspace/projects/<projectId>/`
 * - Preserves original upload + normalizes companion 48 kHz stereo PCM16 WAV via FFmpeg args arrays
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PROJECT_ROOT, sha256Buffer } from '../../../tools/setup/hydrate.mjs';
import { validateSafeId } from '../../shared/contract.mjs';
import { atomicWriteSecureSync } from './settings-store.mjs';
import { normalizeTo48kStereoWav, probeAudioFile } from './tts-service.mjs';

export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_AUDIO_DURATION_SEC = 180;
const MIN_SILENCE_MEAN_DB = -72.0;

/**
 * Sniffs file magic bytes strictly for WAV, MP3, or M4A audio containers.
 * Rejects ZIP, PNG, JPEG, PDF, HTML, scripts, executables, and spoofed extensions.
 * @param {Buffer} buf
 * @returns {{ format: 'wav'|'mp3'|'m4a', ext: string, mime: string }}
 */
export function sniffAudioMagic(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) {
    const err = new Error('INVALID_AUDIO_FILE: File is empty or shorter than 16 bytes.');
    err.code = 'INVALID_AUDIO_FILE';
    err.statusCode = 400;
    throw err;
  }

  // Reject ZIP / PNG / JPEG / PDF / HTML / Mach-O / ELF explicitly
  const head4 = buf.subarray(0, 4);
  if (
    (head4[0] === 0x50 && head4[1] === 0x4b) || // PK (ZIP/JAR/DOCX)
    (head4[0] === 0x89 && head4[1] === 0x50 && head4[2] === 0x4e && head4[3] === 0x47) || // PNG
    (head4[0] === 0xff && head4[1] === 0xd8) || // JPEG
    head4.toString('ascii') === '%PDF' ||
    buf.subarray(0, 64).toString('utf8').trimStart().startsWith('<')
  ) {
    const err = new Error('SPOOFED_AUDIO_FILE: File signature matches a non-audio container (ZIP/image/document).');
    err.code = 'SPOOFED_AUDIO_FILE';
    err.statusCode = 400;
    throw err;
  }

  // WAV: RIFF....WAVE
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { format: 'wav', ext: '.wav', mime: 'audio/wav' };
  }

  // MP3: ID3 header or valid MPEG1/2 Layer III sync frame
  if (buf.subarray(0, 3).toString('ascii') === 'ID3') {
    return { format: 'mp3', ext: '.mp3', mime: 'audio/mpeg' };
  }
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0x00) {
    return { format: 'mp3', ext: '.mp3', mime: 'audio/mpeg' };
  }

  // M4A / MP4 audio: ISO BMFF ftyp box at offset 4
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    const allowedBrands = new Set(['M4A ', 'M4B ', 'mp42', 'isom', 'iso2', 'dash']);
    if (allowedBrands.has(brand)) {
      return { format: 'm4a', ext: '.m4a', mime: 'audio/mp4' };
    }
  }

  const err = new Error('UNSUPPORTED_AUDIO_FORMAT: Only valid WAV, MP3, or M4A audio files are supported.');
  err.code = 'UNSUPPORTED_AUDIO_FORMAT';
  err.statusCode = 400;
  throw err;
}

/**
 * Checks mean volume via FFmpeg volumedetect to reject silent / zeroed uploads.
 * @param {string} wavPath
 * @returns {{ meanVolumeDb: number, maxVolumeDb: number }}
 */
export function measureAudioVolumeDb(wavPath) {
  let stderr = '';
  try {
    const out = execFileSync(
      'python3',
      [
        '-c',
        'import subprocess, sys; p = subprocess.run(["ffmpeg", "-nostats", "-i", sys.argv[1], "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True); print(p.stderr)',
        wavPath,
      ],
      { encoding: 'utf8', timeout: 30_000 }
    );
    stderr = out;
  } catch (err) {
    stderr = String(err?.stderr || err?.stdout || '');
  }
  const meanMatch = /mean_volume:\s*([-\d.]+)\s*dB/.exec(stderr);
  const maxMatch = /max_volume:\s*([-\d.]+)\s*dB/.exec(stderr);
  const meanVolumeDb = meanMatch ? Number.parseFloat(meanMatch[1]) : -91.0;
  const maxVolumeDb = maxMatch ? Number.parseFloat(maxMatch[1]) : -91.0;
  return { meanVolumeDb, maxVolumeDb };
}

/**
 * Creates a MediaStore instance bound to a workspace root.
 * @param {{ projectRoot?: string }} [opts]
 */
export function createMediaStore({ projectRoot = PROJECT_ROOT } = {}) {
  const projectsRoot = path.resolve(projectRoot, 'workspace', 'projects');

  function assertInsideProject(projectId, candidatePath) {
    const safeId = validateSafeId(projectId, 'projectId');
    const projBase = path.resolve(projectsRoot, safeId);
    const resolved = path.resolve(candidatePath);
    if (!resolved.startsWith(projBase + path.sep)) {
      const err = new Error('PATH_TRAVERSAL_BLOCKED: Audio path escapes project boundary.');
      err.code = 'PATH_TRAVERSAL_BLOCKED';
      err.statusCode = 403;
      throw err;
    }
    if (fs.existsSync(resolved)) {
      const realBase = fs.realpathSync(projBase);
      const realTarget = fs.realpathSync(resolved);
      if (!realTarget.startsWith(realBase + path.sep)) {
        const err = new Error('SYMLINK_TRAVERSAL_BLOCKED: Symlink escapes project boundary.');
        err.code = 'SYMLINK_TRAVERSAL_BLOCKED';
        err.statusCode = 403;
        throw err;
      }
    }
    return resolved;
  }

  /**
   * Validates, stores, probes, and normalizes an uploaded voiceover file for a project.
   * @param {{ projectId: string, originalFilename?: string, bytes: Buffer }} params
   */
  function importVoiceover({ projectId, originalFilename = 'voiceover', bytes }) {
    const safeId = validateSafeId(projectId, 'projectId');
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      const err = new Error('EMPTY_UPLOAD: Audio upload payload is empty.');
      err.code = 'EMPTY_UPLOAD';
      err.statusCode = 400;
      throw err;
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      const err = new Error(`UPLOAD_TOO_LARGE: File (${bytes.length} bytes) exceeds 64 MiB limit.`);
      err.code = 'UPLOAD_TOO_LARGE';
      err.statusCode = 413;
      throw err;
    }

    const sniffed = sniffAudioMagic(bytes);
    const inputDir = assertInsideProject(safeId, path.join(projectsRoot, safeId, 'input'));
    fs.mkdirSync(inputDir, { recursive: true });

    const digest = sha256Buffer(bytes);
    const nonce = crypto.randomBytes(4).toString('hex');
    const audioId = `imp-${digest.slice(0, 12)}-${nonce}`;
    const safeDisplayName = path.basename(String(originalFilename || 'voiceover')).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);

    const rawPath = assertInsideProject(safeId, path.join(inputDir, `${audioId}${sniffed.ext}`));
    const normPath = assertInsideProject(safeId, path.join(inputDir, `${audioId}.48k.wav`));
    const metaPath = assertInsideProject(safeId, path.join(inputDir, `${audioId}.json`));

    try {
      atomicWriteSecureSync(rawPath, bytes, { mode: 0o600 });
      const rawProbe = probeAudioFile(rawPath);
      if (rawProbe.durationSec > MAX_AUDIO_DURATION_SEC) {
        const err = new Error(
          `AUDIO_TOO_LONG: Uploaded audio (${rawProbe.durationSec}s) exceeds ${MAX_AUDIO_DURATION_SEC}s cap.`
        );
        err.code = 'AUDIO_TOO_LONG';
        err.statusCode = 400;
        throw err;
      }

      const normProbe = normalizeTo48kStereoWav(rawPath, normPath);
      const vol = measureAudioVolumeDb(normPath);
      if (!Number.isFinite(vol.meanVolumeDb) || vol.meanVolumeDb < MIN_SILENCE_MEAN_DB) {
        const err = new Error(
          `SILENT_AUDIO_UPLOAD: Uploaded audio appears silent (mean_volume=${vol.meanVolumeDb} dB).`
        );
        err.code = 'SILENT_AUDIO_UPLOAD';
        err.statusCode = 400;
        throw err;
      }

      const artifact = {
        audioId,
        projectId: safeId,
        kind: 'imported-voiceover',
        provider: 'import',
        originalFilename: safeDisplayName,
        sourceFormat: sniffed.format,
        mimeType: sniffed.mime,
        rawPath,
        normalizedPath: normPath,
        sha256: digest,
        durationSec: rawProbe.durationSec,
        sampleRate: rawProbe.sampleRate,
        channels: rawProbe.channels,
        codec: rawProbe.codec,
        normalizedSampleRate: normProbe.sampleRate,
        normalizedChannels: normProbe.channels,
        byteSize: bytes.length,
        meanVolumeDb: vol.meanVolumeDb,
        maxVolumeDb: vol.maxVolumeDb,
        audioUrl: `/api/projects/${encodeURIComponent(safeId)}/audio/${encodeURIComponent(audioId)}`,
        createdAt: new Date().toISOString(),
      };

      atomicWriteSecureSync(metaPath, Buffer.from(JSON.stringify(artifact, null, 2), 'utf8'), { mode: 0o600 });
      return artifact;
    } catch (err) {
      for (const p of [rawPath, normPath, metaPath]) {
        try {
          if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        } catch {
          // best effort cleanup
        }
      }
      throw err;
    }
  }

  /**
   * Resolves a stored audio artifact metadata & playable file path strictly inside the project root.
   * @param {string} projectId
   * @param {string} audioId
   * @param {{ preferNormalized?: boolean }} [opts]
   */
  function resolveAudioArtifact(projectId, audioId, { preferNormalized = false } = {}) {
    const safeProject = validateSafeId(projectId, 'projectId');
    const safeAudio = validateSafeId(audioId, 'audioId');
    const dirs = [
      path.join(projectsRoot, safeProject, 'input'),
      path.join(projectsRoot, safeProject, 'generated', 'tts'),
      path.join(projectsRoot, safeProject, 'generated', 'tts-previews'),
    ];
    for (const dir of dirs) {
      const metaPath = assertInsideProject(safeProject, path.join(dir, `${safeAudio}.json`));
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const filePath = assertInsideProject(
          safeProject,
          preferNormalized && meta.normalizedPath ? meta.normalizedPath : meta.rawPath
        );
        if (fs.existsSync(filePath)) {
          return { meta, filePath };
        }
      }
    }
    const err = new Error(`AUDIO_NOT_FOUND: Audio "${safeAudio}" not found for project "${safeProject}".`);
    err.code = 'AUDIO_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  /**
   * Streams a validated media file over loopback HTTP with full byte-range support (200 / 206).
   */
  function streamMediaFile(req, res, filePath, contentType) {
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const rangeHeader = req.headers.range;
    const baseHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };

    if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
      const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
      let start = startStr ? Number.parseInt(startStr, 10) : 0;
      let end = endStr ? Number.parseInt(endStr, 10) : total - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }
      end = Math.min(end, total - 1);
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(end - start + 1),
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      ...baseHeaders,
      'Content-Length': String(total),
    });
    fs.createReadStream(filePath).pipe(res);
  }

  return {
    importVoiceover,
    resolveAudioArtifact,
    streamMediaFile,
  };
}
