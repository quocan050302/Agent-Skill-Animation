import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { AssetBriefInput, AssetClassification, AssetRecord, AssetRole } from '@b6-studio/shared';
import { SKILL_DIR, resolveRealFfprobe } from '../config.js';
import { readJsonFile, resolveInsideRoot, sha256Buffer, sha256File, writeAtomicJson } from '../utils/fs-safe.js';
import type { ProjectService } from './project-service.js';

interface AssetManifestFile {
  schema: 'b6-studio-assets/1';
  assets: AssetRecord[];
}

function loadProtectedHashesFromVendor(): Set<string> {
  const assetRolesPy = path.join(SKILL_DIR, 'scripts', 'b6_asset_roles.py');
  const set = new Set<string>();
  if (!fs.existsSync(assetRolesPy)) return set;
  const text = fs.readFileSync(assetRolesPy, 'utf8');
  const matches = text.matchAll(/'([0-9a-f]{64})':\s*\[/g);
  for (const m of matches) {
    set.add(m[1]);
  }
  return set;
}

const PROTECTED_HASHES = loadProtectedHashesFromVendor();

const IMAGE_ROLES = new Set<AssetRole>([
  'background_back',
  'background_mid',
  'foreground',
  'character_head',
  'character_body',
  'expression',
  'sleeve_cuff',
  'prop',
  'hand',
  'foot',
  'reference',
]);

const AUDIO_ROLES = new Set<AssetRole>(['audio_narration', 'audio_sfx', 'audio_bgm']);

export class AssetService {
  constructor(private readonly projectService: ProjectService) {}

  private async readManifest(projectDir: string): Promise<AssetManifestFile> {
    const manifestPath = path.join(projectDir, 'assets', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const empty: AssetManifestFile = { schema: 'b6-studio-assets/1', assets: [] };
      await writeAtomicJson(manifestPath, empty);
      return empty;
    }
    return readJsonFile<AssetManifestFile>(manifestPath);
  }

  private async writeManifest(projectDir: string, manifest: AssetManifestFile): Promise<void> {
    await writeAtomicJson(path.join(projectDir, 'assets', 'manifest.json'), manifest);
  }

  async listAssets(projectId: string): Promise<{ assets: AssetRecord[]; inboxFiles: string[]; requests: unknown[] }> {
    const dir = this.projectService.getProjectDir(projectId);
    const manifest = await this.readManifest(dir);

    const inboxDir = path.join(dir, 'assets', 'inbox');
    await fsp.mkdir(inboxDir, { recursive: true });
    const inboxEntries = await fsp.readdir(inboxDir, { withFileTypes: true });
    const inboxFiles = inboxEntries.filter((e) => e.isFile()).map((e) => e.name);

    const reqDir = path.join(dir, 'assets', 'requests');
    await fsp.mkdir(reqDir, { recursive: true });
    const reqFiles = (await fsp.readdir(reqDir)).filter((f) => f.endsWith('.json')).sort().reverse();
    const requests = await Promise.all(
      reqFiles.slice(0, 30).map((f) => readJsonFile(path.join(reqDir, f))),
    );

    return { assets: manifest.assets, inboxFiles, requests };
  }

  private async inspectImageBytes(buf: Buffer): Promise<{
    width: number;
    height: number;
    hasAlpha: boolean;
    transparentExterior: boolean;
    alphaBbox: [number, number, number, number] | null;
  }> {
    const meta = await sharp(buf).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const hasAlpha = Boolean(meta.hasAlpha);

    let transparentExterior = false;
    let alphaBbox: [number, number, number, number] | null = null;
    if (hasAlpha && width > 0 && height > 0) {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let minX = info.width;
      let minY = info.height;
      let maxX = -1;
      let maxY = -1;
      let hasZeroAlpha = false;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const a = data[(y * info.width + x) * 4 + 3];
          if (a < 255) hasZeroAlpha = true;
          if (a > 16) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      transparentExterior = hasZeroAlpha;
      if (maxX >= minX && maxY >= minY) {
        alphaBbox = [minX, minY, maxX + 1, maxY + 1];
      }
    }

    return { width, height, hasAlpha, transparentExterior, alphaBbox };
  }

  private probeAudio(filePath: string): { duration: number; codec: string; sampleRate: number } {
    const ffprobe = resolveRealFfprobe();
    const res = spawnSync(
      ffprobe,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
      { encoding: 'utf8', shell: false, timeout: 10000 },
    );
    if (res.status !== 0) {
      throw new Error(`FFprobe không đọc được file âm thanh: ${res.stderr}`);
    }
    const parsed = JSON.parse(res.stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; sample_rate?: string }>;
    };
    const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
    if (!audioStream) {
      throw new Error('Tệp tải lên không có audio stream hợp lệ.');
    }
    return {
      duration: Number(parsed.format?.duration ?? 0),
      codec: audioStream.codec_name ?? 'unknown',
      sampleRate: Number(audioStream.sample_rate ?? 0),
    };
  }

  async importBuffer(
    projectId: string,
    opts: {
      filename: string;
      buffer: Buffer;
      role: AssetRole;
      classification?: AssetClassification;
      source?: 'anti_image_gen' | 'user_upload' | 'inbox_import' | 'local_synth';
      tool?: string;
      prompt?: string;
      notes?: string;
      actorId?: string;
      viewId?: string;
      expressionId?: string;
      tags?: string[];
      syncToProjectInputs?: boolean;
    },
  ): Promise<AssetRecord> {
    const dir = this.projectService.getProjectDir(projectId);
    const safeName = path.basename(opts.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName || safeName.startsWith('.')) {
      throw new Error('Tên tệp asset không hợp lệ.');
    }
    const ext = path.extname(safeName).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    const isAudio = ['.wav', '.m4a', '.mp3', '.aac', '.flac', '.ogg'].includes(ext);

    if (IMAGE_ROLES.has(opts.role) && !isImage) {
      throw new Error(`Role "${opts.role}" yêu cầu tệp ảnh PNG/JPEG/WEBP.`);
    }
    if (AUDIO_ROLES.has(opts.role) && !isAudio) {
      throw new Error(`Role "${opts.role}" yêu cầu tệp âm thanh WAV/M4A/MP3/AAC.`);
    }

    const digest = sha256Buffer(opts.buffer);
    const classification: AssetClassification = opts.role === 'reference'
      ? 'REFERENCE ONLY'
      : (opts.classification ?? 'PRODUCTION ASSET');

    if (classification === 'PRODUCTION ASSET' && PROTECTED_HASHES.has(digest)) {
      throw new Error(
        'Bị chặn bởi B6 Asset Guard: tệp này trùng SHA-256 với media mẫu/demo/tham chiếu của upstream B6, không thể nhập làm PRODUCTION ASSET. Chỉ được gắn nhãn REFERENCE ONLY để đối chiếu.',
      );
    }

    let subDir = 'assets/production';
    if (classification === 'REFERENCE ONLY') subDir = 'assets/reference';
    else if (AUDIO_ROLES.has(opts.role)) subDir = 'audio';

    const relPath = `${subDir}/${safeName}`;
    const destPath = resolveInsideRoot(dir, relPath);
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    await fsp.writeFile(destPath, opts.buffer);

    let width: number | undefined;
    let height: number | undefined;
    let hasAlpha: boolean | undefined;
    let transparentExterior: boolean | undefined;
    let alphaBbox: [number, number, number, number] | null | undefined;
    let notes = opts.notes ?? '';

    if (isImage) {
      const info = await this.inspectImageBytes(opts.buffer);
      width = info.width;
      height = info.height;
      hasAlpha = info.hasAlpha;
      transparentExterior = info.transparentExterior;
      alphaBbox = info.alphaBbox;

      const needsAlpha = !['background_back', 'background_mid', 'reference'].includes(opts.role);
      if (needsAlpha && !transparentExterior) {
        notes = `${notes ? notes + ' | ' : ''}CẢNH BÁO: Ảnh chưa có nền trong suốt thực sự (transparent exterior RGBA).`;
      }
    } else if (isAudio) {
      const audioMeta = this.probeAudio(destPath);
      notes = `${notes ? notes + ' | ' : ''}Audio ${audioMeta.codec}, ${audioMeta.sampleRate}Hz, ${audioMeta.duration.toFixed(3)}s`;
      if (opts.role === 'audio_narration' && classification === 'PRODUCTION ASSET') {
        const projPath = path.join(dir, 'project.json');
        const proj = await readJsonFile<Record<string, unknown>>(projPath);
        proj.voice = {
          name: safeName,
          path: relPath,
          sha256: digest,
          speed: 1,
          source: opts.source ?? 'user_upload',
        };
        if (typeof proj.duration !== 'number' && audioMeta.duration > 0) {
          proj.duration = Number(audioMeta.duration.toFixed(3));
        }
        await writeAtomicJson(projPath, proj);
      }
    }

    if (classification === 'PRODUCTION ASSET' && (opts.syncToProjectInputs ?? true)) {
      const projPath = path.join(dir, 'project.json');
      const proj = await readJsonFile<Record<string, unknown>>(projPath);
      const inputs = Array.isArray(proj.inputs) ? [...(proj.inputs as string[])] : [];
      if (!inputs.includes(relPath)) {
        inputs.push(relPath);
        proj.inputs = inputs;
        await writeAtomicJson(projPath, proj);
      }
    }

    const record: AssetRecord = {
      id: `asset-${crypto.randomUUID().slice(0, 8)}`,
      filename: safeName,
      relativePath: relPath,
      role: opts.role,
      classification,
      mimeType: isImage ? (ext === '.png' ? 'image/png' : 'image/jpeg') : 'audio/' + ext.slice(1),
      sizeBytes: opts.buffer.length,
      sha256: digest,
      width,
      height,
      hasAlpha,
      transparentExterior,
      alphaBbox,
      actorId: opts.actorId,
      viewId: opts.viewId,
      expressionId: opts.expressionId,
      tags: opts.tags ?? [opts.role],
      provenance: {
        source: opts.source ?? 'user_upload',
        tool: opts.tool ?? 'B6 Local Studio Upload',
        prompt: opts.prompt,
        createdAt: new Date().toISOString(),
        notes: notes || undefined,
      },
    };

    const manifest = await this.readManifest(dir);
    manifest.assets = manifest.assets.filter((a) => a.relativePath !== relPath);
    manifest.assets.push(record);
    await this.writeManifest(dir, manifest);

    return record;
  }

  async createAssetBrief(projectId: string, brief: AssetBriefInput): Promise<{
    requestId: string;
    requestPath: string;
    inboxPath: string;
    promptText: string;
    status: 'prepared_awaiting_anti_or_import';
  }> {
    const dir = this.projectService.getProjectDir(projectId);
    const requestId = `req-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const inboxPath = path.join(dir, 'assets', 'inbox');
    await fsp.mkdir(inboxPath, { recursive: true });

    const layerNote = brief.requireAlpha
      ? 'Pure isolated transparent background (clean RGBA cutout, zero checkerboard or white halo, roomy margins around silhouette, no cropped limbs).'
      : 'Continuous wide painted environment plane with usable ground/horizon and generous overscan for camera movement, NO baked captions or text.';

    const promptText = [
      'A deliberately imperfect hand-painted 2D meme cartoon asset for B6 layered animation.',
      `Role: ${brief.role}${brief.actorId ? ` | Actor: ${brief.actorId}` : ''}${brief.viewId ? ` | View: ${brief.viewId}` : ''}${brief.expressionId ? ` | Expression: ${brief.expressionId}` : ''}.`,
      `Era & Setting: ${brief.eraAndSetting}.`,
      `Subject & Details: ${brief.visualDescription}.`,
      'Style Lock (B6 Sample 1 Primary Standard): irregular pressure-varying dark ink outlines with slight organic wobble, broad matte painted pigment masses, pale cool/violet soft underside shadows, warm diffuse lighting, expressive scrappy meme proportions (slightly flattened asymmetric white/skin head, heavy short upper lids, off-center expressive mouth when character). NO glossy 3D CGI, NO clean uniform vector outlines, NO photographic skin, NO extra duplicated limbs, NO text overlays.',
      `Technical Output: ${brief.targetWidth}x${brief.targetHeight}. ${layerNote}`,
    ].join('\n');

    const payload = {
      schema: 'b6-asset-request/1',
      requestId,
      createdAt: new Date().toISOString(),
      status: 'prepared_awaiting_anti_or_import',
      bridgeMode: 'agent-assisted-inbox (no callable image API from localhost browser)',
      expectedInboxDir: inboxPath,
      suggestedFilename: `${brief.role}${brief.actorId ? '-' + brief.actorId : ''}${brief.viewId ? '-' + brief.viewId : ''}.png`,
      brief,
      promptText,
    };

    const reqRel = `assets/requests/${requestId}.asset-request.json`;
    const reqAbs = resolveInsideRoot(dir, reqRel);
    await writeAtomicJson(reqAbs, payload);

    return {
      requestId,
      requestPath: reqAbs,
      inboxPath,
      promptText,
      status: 'prepared_awaiting_anti_or_import',
    };
  }

  async importFromInbox(
    projectId: string,
    filename: string,
    role: AssetRole,
    actorId?: string,
    viewId?: string,
    expressionId?: string,
  ): Promise<AssetRecord> {
    const dir = this.projectService.getProjectDir(projectId);
    const inboxFile = resolveInsideRoot(dir, path.posix.join('assets/inbox', path.basename(filename)), true);
    const buf = await fsp.readFile(inboxFile);
    const record = await this.importBuffer(projectId, {
      filename: path.basename(filename),
      buffer: buf,
      role,
      source: 'inbox_import',
      tool: 'Anti / Local Inbox Import',
      actorId,
      viewId,
      expressionId,
    });
    return record;
  }

  async verifyAssetSha(projectId: string, relativePath: string): Promise<string> {
    const dir = this.projectService.getProjectDir(projectId);
    const abs = resolveInsideRoot(dir, relativePath, true);
    return sha256File(abs);
  }
}
