import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { CreateProjectInput, InitRatio, Ratio } from '@b6-studio/shared';
import { PROJECTS_DIR, PYCACHE_DIR, SKILL_DIR, resolvePythonExe } from '../config.js';
import { assertSafeId, readJsonFile, resolveInsideRoot, slugifyTitle, writeAtomicJson } from '../utils/fs-safe.js';

export interface StudioMeta {
  schema: 'b6-studio-meta/1';
  id: string;
  title: string;
  brief: string;
  language: string;
  targetDuration: number;
  activeRatio: Ratio;
  premise: string;
  hook: string;
  createdAt: string;
  updatedAt: string;
  sceneSyncRequests: Array<{
    id: string;
    createdAt: string;
    note: string;
    status: 'pending' | 'applied';
  }>;
}

export interface ProjectSummary {
  id: string;
  title: string;
  brief: string;
  stage: string;
  purpose: string;
  ratios: Ratio[];
  activeRatio: Ratio;
  duration: number | null;
  targetDuration: number;
  updatedAt: string;
  createdAt: string;
  latestThumbnailUrl: string | null;
  latestVideoUrl: string | null;
  lastJob: { id: string; kind: string; status: string; updatedAt: string } | null;
}

export interface ProjectDetail {
  id: string;
  path: string;
  meta: StudioMeta;
  projectJson: Record<string, unknown>;
  storyJson: Record<string, unknown>;
  captionsJson: Array<{ start: number; end: number; text: string }>;
  formats: Record<string, Record<string, unknown>>;
  charactersJson: { schema: string; actors: Array<{ id: string; package: string; views: string[] }>; rigid_cast: unknown[] };
  scenePy: string;
  sceneSyncRequests: StudioMeta['sceneSyncRequests'];
  completeness: {
    hasStory: boolean;
    hasShots: boolean;
    hasCharacters: boolean;
    hasVoice: boolean;
    hasCaptions: boolean;
    readyForValidate: boolean;
    missingItems: string[];
  };
}

export class ProjectService {
  private readonly projectsRoot: string;

  constructor(projectsRoot = PROJECTS_DIR) {
    this.projectsRoot = projectsRoot;
    fs.mkdirSync(this.projectsRoot, { recursive: true });
  }

  getProjectDir(id: string): string {
    assertSafeId(id, 'Project ID');
    return resolveInsideRoot(this.projectsRoot, id, true);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const entries = await fsp.readdir(this.projectsRoot, { withFileTypes: true });
    const summaries: ProjectSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = path.join(this.projectsRoot, entry.name);
      const projPath = path.join(dir, 'project.json');
      if (!fs.existsSync(projPath)) continue;
      try {
        const proj = await readJsonFile<Record<string, unknown>>(projPath);
        if (proj.style !== 'B6') continue;
        const meta = await this.ensureMeta(entry.name, dir, proj);
        const ratios = Object.keys((proj.formats as Record<string, string>) ?? {}) as Ratio[];
        const latestMedia = await this.findLatestPreviewMedia(entry.name, dir);
        summaries.push({
          id: entry.name,
          title: meta.title,
          brief: meta.brief,
          stage: String(proj.stage ?? 'needs_authoring'),
          purpose: String(proj.purpose ?? 'production'),
          ratios,
          activeRatio: ratios.includes(meta.activeRatio) ? meta.activeRatio : (ratios[0] ?? '9:16'),
          duration: typeof proj.duration === 'number' ? proj.duration : null,
          targetDuration: meta.targetDuration,
          updatedAt: meta.updatedAt,
          createdAt: meta.createdAt,
          latestThumbnailUrl: latestMedia.thumbnailUrl,
          latestVideoUrl: latestMedia.videoUrl,
          lastJob: null,
        });
      } catch {
        // skip corrupted directory entries
      }
    }

    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async findLatestPreviewMedia(projectId: string, dir: string): Promise<{ thumbnailUrl: string | null; videoUrl: string | null }> {
    const outputsDir = path.join(dir, 'outputs');
    if (!fs.existsSync(outputsDir)) return { thumbnailUrl: null, videoUrl: null };
    const subs = await fsp.readdir(outputsDir, { withFileTypes: true });
    let bestTime = -1;
    let videoUrl: string | null = null;
    let thumbnailUrl: string | null = null;

    for (const s of subs) {
      if (!s.isDirectory()) continue;
      const subDir = path.join(outputsDir, s.name);
      const reportPath = path.join(subDir, 'report.json');
      const previewMp4 = path.join(subDir, 'preview.mp4');
      const contactSheet = path.join(subDir, 'contact-sheet.jpg');
      const stat = fs.existsSync(reportPath) ? fs.statSync(reportPath) : fs.statSync(subDir);
      if (stat.mtimeMs > bestTime) {
        if (fs.existsSync(previewMp4) || fs.existsSync(contactSheet)) {
          bestTime = stat.mtimeMs;
          videoUrl = fs.existsSync(previewMp4) ? `/api/media/${projectId}/outputs/${s.name}/preview.mp4` : null;
          thumbnailUrl = fs.existsSync(contactSheet) ? `/api/media/${projectId}/outputs/${s.name}/contact-sheet.jpg` : null;
        }
      }
    }
    return { thumbnailUrl, videoUrl };
  }

  private async ensureMeta(id: string, dir: string, proj: Record<string, unknown>): Promise<StudioMeta> {
    const metaPath = path.join(dir, 'studio.meta.json');
    if (fs.existsSync(metaPath)) {
      return readJsonFile<StudioMeta>(metaPath);
    }
    const ratios = Object.keys((proj.formats as Record<string, string>) ?? {}) as Ratio[];
    const now = new Date().toISOString();
    const meta: StudioMeta = {
      schema: 'b6-studio-meta/1',
      id,
      title: id,
      brief: '',
      language: 'en',
      targetDuration: typeof proj.duration === 'number' ? proj.duration : 10,
      activeRatio: ratios.includes('9:16') ? '9:16' : (ratios[0] ?? '9:16'),
      premise: '',
      hook: '',
      createdAt: now,
      updatedAt: now,
      sceneSyncRequests: [],
    };
    await writeAtomicJson(metaPath, meta);
    return meta;
  }

  async createProject(input: CreateProjectInput): Promise<ProjectDetail> {
    const baseSlug = input.slug ? assertSafeId(input.slug, 'Slug') : slugifyTitle(input.title);
    let candidateId = baseSlug;
    let suffix = 2;
    while (fs.existsSync(path.join(this.projectsRoot, candidateId))) {
      candidateId = `${baseSlug}-${suffix++}`;
    }
    assertSafeId(candidateId, 'Project ID');
    const targetDir = path.join(this.projectsRoot, candidateId);

    const ratio: InitRatio = input.ratio;
    const pythonExe = resolvePythonExe();
    const res = spawnSync(
      process.execPath,
      [path.join(SKILL_DIR, 'scripts', 'autopilot.mjs'), 'init', targetDir, '--style', 'B6', '--ratio', ratio],
      {
        cwd: SKILL_DIR,
        env: {
          ...process.env,
          B6_PYTHON: pythonExe,
          PYTHONUTF8: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONPYCACHEPREFIX: PYCACHE_DIR,
        },
        encoding: 'utf8',
        shell: false,
        timeout: 30000,
      },
    );

    if (res.status !== 0) {
      throw new Error(`Không thể khởi tạo dự án B6 qua CLI: ${res.stderr || res.stdout}`);
    }

    const now = new Date().toISOString();
    const activeRatio: Ratio = ratio === '16:9' ? '16:9' : '9:16';
    const meta: StudioMeta = {
      schema: 'b6-studio-meta/1',
      id: candidateId,
      title: input.title.trim(),
      brief: input.brief.trim(),
      language: input.language,
      targetDuration: input.targetDuration,
      activeRatio,
      premise: input.brief.trim(),
      hook: '',
      createdAt: now,
      updatedAt: now,
      sceneSyncRequests: [],
    };
    await writeAtomicJson(path.join(targetDir, 'studio.meta.json'), meta);

    // Prepare asset directories (outside engine/, inside project root)
    for (const sub of ['assets/inbox', 'assets/production', 'assets/reference', 'assets/requests', 'audio']) {
      await fsp.mkdir(path.join(targetDir, sub), { recursive: true });
    }
    await writeAtomicJson(path.join(targetDir, 'assets', 'manifest.json'), {
      schema: 'b6-studio-assets/1',
      assets: [],
    });

    return this.getProject(candidateId);
  }

  async getProject(id: string): Promise<ProjectDetail> {
    const dir = this.getProjectDir(id);
    const proj = await readJsonFile<Record<string, unknown>>(path.join(dir, 'project.json'));
    const meta = await this.ensureMeta(id, dir, proj);
    const storyRel = String(proj.story ?? 'story.json');
    const captionsRel = String(proj.captions ?? 'captions.json');
    const sceneRel = String(proj.scene ?? 'scene.py');
    const registryRel = String((proj.character_system as Record<string, unknown> | undefined)?.registry ?? 'characters.json');

    const storyJson = await readJsonFile<Record<string, unknown>>(resolveInsideRoot(dir, storyRel, true));
    const captionsJson = await readJsonFile<Array<{ start: number; end: number; text: string }>>(
      resolveInsideRoot(dir, captionsRel, true),
    );
    const charactersJson = await readJsonFile<ProjectDetail['charactersJson']>(resolveInsideRoot(dir, registryRel, true));
    const scenePy = await fsp.readFile(resolveInsideRoot(dir, sceneRel, true), 'utf8');

    const formats: Record<string, Record<string, unknown>> = {};
    const formatMap = (proj.formats as Record<string, string>) ?? {};
    for (const [r, rel] of Object.entries(formatMap)) {
      formats[r] = await readJsonFile<Record<string, unknown>>(resolveInsideRoot(dir, rel, true));
    }

    const activePlan = formats[meta.activeRatio] ?? Object.values(formats)[0] ?? {};
    const shots = Array.isArray(activePlan.shots) ? activePlan.shots : [];
    const hasStory = Boolean(typeof storyJson.narration === 'string' && storyJson.narration.trim().length > 0);
    const hasShots = shots.length > 0;
    const hasCharacters = charactersJson.actors.length > 0;
    const hasVoice = Boolean(proj.voice && (proj.voice as Record<string, unknown>).path);
    const hasCaptions = captionsJson.length > 0;

    const missingItems: string[] = [];
    if (!hasStory) missingItems.push('Kịch bản / narration (story.json)');
    if (!hasShots) missingItems.push(`Danh sách phân cảnh (${meta.activeRatio})`);
    if (!hasCharacters) missingItems.push('Nhân vật & Rig (characters.json)');
    if (!hasVoice) missingItems.push('Âm thanh gốc (voice WAV/M4A)');
    if (!hasCaptions) missingItems.push('Phụ đề đồng bộ (captions.json)');

    return {
      id,
      path: dir,
      meta,
      projectJson: proj,
      storyJson,
      captionsJson,
      formats,
      charactersJson,
      scenePy,
      sceneSyncRequests: meta.sceneSyncRequests ?? [],
      completeness: {
        hasStory,
        hasShots,
        hasCharacters,
        hasVoice,
        hasCaptions,
        readyForValidate: missingItems.length === 0 && proj.stage === 'authored',
        missingItems,
      },
    };
  }

  async duplicateProject(sourceId: string, newTitle?: string): Promise<ProjectDetail> {
    const srcDir = this.getProjectDir(sourceId);
    const srcDetail = await this.getProject(sourceId);
    const title = (newTitle || `${srcDetail.meta.title} (Copy)`).trim();
    const baseSlug = slugifyTitle(title);
    let candidateId = baseSlug;
    let suffix = 2;
    while (fs.existsSync(path.join(this.projectsRoot, candidateId))) {
      candidateId = `${baseSlug}-${suffix++}`;
    }
    const dstDir = path.join(this.projectsRoot, candidateId);

    // Copy project files excluding transient outputs/review history/approvals
    await fsp.cp(srcDir, dstDir, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(srcDir, src).replace(/\\/g, '/');
        if (!rel) return true;
        if (rel === 'outputs' || rel.startsWith('outputs/')) return false;
        if (rel === 'approvals' || rel.startsWith('approvals/')) return false;
        if (rel.startsWith('approval-')) return false;
        if (rel === '.b6-review-history' || rel.startsWith('.b6-review-history/')) return false;
        return true;
      },
    });

    const now = new Date().toISOString();
    const metaPath = path.join(dstDir, 'studio.meta.json');
    const meta = await readJsonFile<StudioMeta>(metaPath);
    meta.id = candidateId;
    meta.title = title;
    meta.createdAt = now;
    meta.updatedAt = now;
    await writeAtomicJson(metaPath, meta);

    return this.getProject(candidateId);
  }

  async deleteProject(id: string): Promise<{ deletedId: string }> {
    const dir = this.getProjectDir(id);
    const realRoot = fs.realpathSync(this.projectsRoot);
    const realDir = fs.realpathSync(dir);
    if (realDir === realRoot || !realDir.startsWith(realRoot + path.sep)) {
      throw new Error('Không thể xóa thư mục bên ngoài workspace/projects.');
    }
    await fsp.rm(realDir, { recursive: true, force: false });
    return { deletedId: id };
  }
}
