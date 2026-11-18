import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, resolveInsideRoot } from '../utils/fs-safe.js';
import type { ProjectService } from './project-service.js';

export interface ReviewSummary {
  technicalStatus: 'pass' | 'fail' | 'pending';
  visualReviewStatus: 'pass' | 'needs_repair' | 'pending';
  userApprovalStatus: 'approved' | 'rejected' | 'pending';
  latestReport: {
    path: string;
    kind: string;
    ratio: string;
    fingerprint: string;
    videoPath?: string;
    videoSha256?: string;
    timeRange?: { start: number; end: number };
    checkedFrames?: number;
  } | null;
  latestMotionReview: {
    path: string;
    status: string;
    subcheckCounts: { total: number; pass: number; pending: number; needsRepair: number; na: number };
    remainingGaps: string[];
    htmlIndexUrl: string | null;
  } | null;
  approvalRecord: Record<string, unknown> | null;
  historyEvents: unknown[];
  activeFailure: unknown | null;
}

export class ReviewService {
  constructor(private readonly projectService: ProjectService) {}

  async getReviewState(projectId: string, ratio: '9:16' | '16:9'): Promise<ReviewSummary> {
    const dir = this.projectService.getProjectDir(projectId);
    const outputsDir = path.join(dir, 'outputs');

    let latestReport: ReviewSummary['latestReport'] = null;
    let latestReportTime = -1;
    let latestReview: ReviewSummary['latestMotionReview'] = null;
    let latestReviewTime = -1;

    if (fs.existsSync(outputsDir)) {
      const entries = await fsp.readdir(outputsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(outputsDir, entry.name);

        const reportFile = path.join(subDir, 'report.json');
        if (fs.existsSync(reportFile)) {
          const stat = fs.statSync(reportFile);
          try {
            const rep = await readJsonFile<Record<string, unknown>>(reportFile);
            if (rep.ratio === ratio && stat.mtimeMs > latestReportTime) {
              latestReportTime = stat.mtimeMs;
              latestReport = {
                path: `outputs/${entry.name}/report.json`,
                kind: String(rep.kind ?? 'unknown'),
                ratio: String(rep.ratio ?? ratio),
                fingerprint: String(rep.fingerprint ?? ''),
                videoPath: typeof rep.video === 'string' ? rep.video : undefined,
                videoSha256: typeof rep.video_sha256 === 'string' ? rep.video_sha256 : undefined,
                timeRange: rep.time_range as { start: number; end: number } | undefined,
                checkedFrames: typeof rep.checked_frames === 'number' ? rep.checked_frames : undefined,
              };
            }
          } catch {
            // ignore
          }
        }

        const reviewFile = path.join(subDir, 'motion-review.json');
        if (fs.existsSync(reviewFile)) {
          const stat = fs.statSync(reviewFile);
          try {
            const rev = await readJsonFile<Record<string, unknown>>(reviewFile);
            if (rev.ratio === ratio && stat.mtimeMs > latestReviewTime) {
              latestReviewTime = stat.mtimeMs;
              const checks = (rev.checks as Record<string, { subchecks?: Record<string, { status?: string }> }>) ?? {};
              let total = 0;
              let pass = 0;
              let pending = 0;
              let needsRepair = 0;
              let na = 0;
              for (const group of Object.values(checks)) {
                for (const sub of Object.values(group.subchecks ?? {})) {
                  total++;
                  if (sub.status === 'pass') pass++;
                  else if (sub.status === 'not_applicable') na++;
                  else if (sub.status === 'needs_repair') needsRepair++;
                  else pending++;
                }
              }
              const reviewMeta = (rev.review as { status?: string }) ?? {};
              const htmlPath = path.join(subDir, 'index.html');
              latestReview = {
                path: `outputs/${entry.name}/motion-review.json`,
                status: String(reviewMeta.status ?? 'pending'),
                subcheckCounts: { total, pass, pending, needsRepair, na },
                remainingGaps: Array.isArray(rev.remaining_gaps) ? (rev.remaining_gaps as string[]) : [],
                htmlIndexUrl: fs.existsSync(htmlPath) ? `/api/media/${projectId}/outputs/${entry.name}/index.html` : null,
              };
            }
          } catch {
            // ignore
          }
        }
      }
    }

    const approvalFile = path.join(dir, `approval-${ratio.replace(':', 'x')}.json`);
    const approvalRecord = fs.existsSync(approvalFile)
      ? await readJsonFile<Record<string, unknown>>(approvalFile)
      : null;

    const historyFile = path.join(dir, '.b6-review-history', 'index.json');
    let historyEvents: unknown[] = [];
    let activeFailure: unknown | null = null;
    if (fs.existsSync(historyFile)) {
      try {
        const hist = await readJsonFile<{ ratios?: Record<string, { active?: unknown; events?: unknown[] }> }>(historyFile);
        const rState = hist.ratios?.[ratio];
        if (rState) {
          activeFailure = rState.active ?? null;
          historyEvents = rState.events ?? [];
        }
      } catch {
        // ignore
      }
    }

    const technicalStatus: ReviewSummary['technicalStatus'] = latestReport ? 'pass' : 'pending';
    let visualReviewStatus: ReviewSummary['visualReviewStatus'] = 'pending';
    if (latestReview) {
      if (latestReview.status === 'pass' && latestReview.subcheckCounts.pending === 0 && latestReview.subcheckCounts.needsRepair === 0) {
        visualReviewStatus = 'pass';
      } else if (latestReview.subcheckCounts.needsRepair > 0 || latestReview.status === 'needs_repair') {
        visualReviewStatus = 'needs_repair';
      }
    }
    const userApprovalStatus: ReviewSummary['userApprovalStatus'] = approvalRecord
      ? 'approved'
      : 'pending';

    return {
      technicalStatus,
      visualReviewStatus,
      userApprovalStatus,
      latestReport,
      latestMotionReview: latestReview,
      approvalRecord,
      historyEvents,
      activeFailure,
    };
  }

  async readMotionReview(projectId: string, reviewRel: string): Promise<Record<string, unknown>> {
    const dir = this.projectService.getProjectDir(projectId);
    const abs = resolveInsideRoot(dir, reviewRel, true);
    return readJsonFile<Record<string, unknown>>(abs);
  }
}
