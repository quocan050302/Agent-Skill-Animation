import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Ratio } from '@b6-studio/shared';
import { resolveRealFfprobe } from '../config.js';
import { readJsonFile, resolveInsideRoot, sha256File } from '../utils/fs-safe.js';
import type { ProjectService } from './project-service.js';
import { QaEvidenceResolver } from './qa-evidence-service.js';

export interface OutputArtifactInfo {
  id: string;
  kind: string;
  ratio: string;
  outputDirRel: string;
  reportRel: string;
  createdAt: string;
  videoRel: string | null;
  videoUrl: string | null;
  contactSheetUrl: string | null;
  srtUrl: string | null;
  vttUrl: string | null;
  technicalStatus: string;
  creativeStatus: string;
  userAcceptance: string;
  verificationStatus: 'current' | 'historical' | 'stale' | 'corrupt';
  verificationReasons: string[];
  fingerprint: string;
  ffprobe: {
    width: number;
    height: number;
    duration: number;
    fps: string;
    codec: string;
    hasAudio: boolean;
    bytes: number;
    sha256: string;
  } | null;
  timings: Record<string, number> | null;
}

export class OutputService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly qaResolver: QaEvidenceResolver = new QaEvidenceResolver(),
  ) {}

  async listOutputs(projectId: string): Promise<OutputArtifactInfo[]> {
    const dir = this.projectService.getProjectDir(projectId);
    const outputsDir = path.join(dir, 'outputs');
    if (!fs.existsSync(outputsDir)) return [];

    const entries = await fsp.readdir(outputsDir, { withFileTypes: true });
    const list: OutputArtifactInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(outputsDir, entry.name);
      const reportPath = path.join(subDir, 'report.json');
      if (!fs.existsSync(reportPath)) continue;

      try {
        const rep = await readJsonFile<Record<string, unknown>>(reportPath);
        const stat = fs.statSync(reportPath);
        const ratio = (rep.ratio === '16:9' ? '16:9' : '9:16') as Ratio;
        const reportRel = `outputs/${entry.name}/report.json`;
        const fpInfo = await this.qaResolver.resolveCurrentProjectFingerprint(dir, ratio);
        const verified = await this.qaResolver.loadAndVerifyPreviewReport(dir, reportRel, fpInfo, ratio);
        const videoRel = typeof rep.video === 'string' ? rep.video.replace(/\\/g, '/') : null;
        let ffprobeInfo: OutputArtifactInfo['ffprobe'] = null;

        if (videoRel) {
          const videoAbs = resolveInsideRoot(dir, videoRel, false);
          if (fs.existsSync(videoAbs)) {
            ffprobeInfo = await this.probeVideo(videoAbs);
          }
        }

        const contactSheet = path.join(subDir, 'contact-sheet.jpg');
        const srt = path.join(subDir, 'captions.srt');
        const vtt = path.join(subDir, 'captions.vtt');

        const kind = String(rep.kind ?? 'unknown');
        const verificationStatus: OutputArtifactInfo['verificationStatus'] =
          verified.status === 'fail'
            ? 'corrupt'
            : kind === 'draft'
            ? 'historical'
            : verified.status === 'pass'
            ? 'current'
            : 'stale';

        list.push({
          id: entry.name,
          kind,
          ratio: String(rep.ratio ?? '9:16'),
          outputDirRel: `outputs/${entry.name}`,
          reportRel,
          createdAt: stat.mtime.toISOString(),
          videoRel,
          videoUrl: videoRel && verified.ffprobe ? `/api/media/${projectId}/${videoRel}` : null,
          contactSheetUrl: fs.existsSync(contactSheet)
            ? `/api/media/${projectId}/outputs/${entry.name}/contact-sheet.jpg`
            : null,
          srtUrl: fs.existsSync(srt) ? `/api/media/${projectId}/outputs/${entry.name}/captions.srt` : null,
          vttUrl: fs.existsSync(vtt) ? `/api/media/${projectId}/outputs/${entry.name}/captions.vtt` : null,
          technicalStatus: kind === 'draft' ? String(rep.technical_status ?? 'unknown') : verified.status,
          creativeStatus: String(rep.creative_status ?? 'pending'),
          userAcceptance: String(rep.user_acceptance ?? 'not_inferred'),
          verificationStatus,
          verificationReasons: verified.reasonCodes,
          fingerprint: String(rep.fingerprint ?? ''),
          ffprobe: ffprobeInfo,
          timings: (rep.timings as Record<string, number>) ?? null,
        });
      } catch {
        // skip unreadable output dir
      }
    }

    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async probeVideo(absPath: string): Promise<OutputArtifactInfo['ffprobe']> {
    const ffprobe = resolveRealFfprobe();
    const res = spawnSync(
      ffprobe,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', absPath],
      { encoding: 'utf8', shell: false, timeout: 8000 },
    );
    if (res.status !== 0) return null;
    try {
      const parsed = JSON.parse(res.stdout) as {
        format?: { duration?: string; size?: string };
        streams?: Array<{
          codec_type?: string;
          codec_name?: string;
          width?: number;
          height?: number;
          r_frame_rate?: string;
        }>;
      };
      const v = parsed.streams?.find((s) => s.codec_type === 'video');
      const hasAudio = Boolean(parsed.streams?.some((s) => s.codec_type === 'audio'));
      const bytes = fs.statSync(absPath).size;
      const digest = await sha256File(absPath);
      return {
        width: v?.width ?? 0,
        height: v?.height ?? 0,
        duration: Number(parsed.format?.duration ?? 0),
        fps: v?.r_frame_rate ?? '30/1',
        codec: v?.codec_name ?? 'unknown',
        hasAudio,
        bytes,
        sha256: digest,
      };
    } catch {
      return null;
    }
  }

  openOutputFolder(projectId: string, relTarget = 'outputs'): { opened: string } {
    const dir = this.projectService.getProjectDir(projectId);
    const abs = resolveInsideRoot(dir, relTarget, true);
    if (process.platform === 'win32') {
      spawn('explorer.exe', [abs], { detached: true, stdio: 'ignore', shell: false }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [abs], { detached: true, stdio: 'ignore', shell: false }).unref();
    } else {
      spawn('xdg-open', [abs], { detached: true, stdio: 'ignore', shell: false }).unref();
    }
    return { opened: abs };
  }
}
