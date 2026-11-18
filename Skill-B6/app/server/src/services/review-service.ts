import { readJsonFile, resolveInsideRoot } from '../utils/fs-safe.js';
import type { ProjectService } from './project-service.js';
import {
  QaEvidenceResolver,
  type ResolvedProjectQaState,
  type VerifiedPreviewEvidence,
  type VerifiedVisualReviewEvidence,
} from './qa-evidence-service.js';
import type { QaEvidenceSummary, Ratio } from '@b6-studio/shared';

export interface ReviewSummary {
  technicalStatus: QaEvidenceSummary['technicalStatus'];
  visualReviewStatus: QaEvidenceSummary['visualReviewStatus'];
  userApprovalStatus: QaEvidenceSummary['userApprovalStatus'];
  reasonCodes: string[];
  staleReasons: string[];
  blockingReasons: string[];
  currentSourceFingerprint: string | null;
  previewFingerprint: string | null;
  previewSha256: string | null;
  reviewSha256: string | null;
  verifiedAt: string;
  voiceStale: boolean;
  editorSyncState: QaEvidenceSummary['editorSyncState'];
  renderUnlocked: boolean;
  evidenceLinks: QaEvidenceSummary['evidenceLinks'];
  latestReport: {
    path: string;
    kind: string;
    ratio: string;
    status: string;
    fingerprint: string;
    videoPath?: string;
    videoSha256?: string;
    timeRange?: { start: number; end: number };
    checkedFrames?: number;
    reasonCodes: string[];
  } | null;
  latestMotionReview: {
    path: string;
    status: string;
    rawStatus: string;
    reviewSha256: string;
    subcheckCounts: { total: number; pass: number; pending: number; needsRepair: number; na: number };
    remainingGaps: string[];
    htmlIndexUrl: string | null;
    reasonCodes: string[];
  } | null;
  approvalRecord: Record<string, unknown> | null;
  historyEvents: unknown[];
  activeFailure: unknown | null;
  outputStatuses: ResolvedProjectQaState['outputStatuses'];
}

export class ReviewService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly qaResolver: QaEvidenceResolver = new QaEvidenceResolver(),
  ) {}

  getResolver(): QaEvidenceResolver {
    return this.qaResolver;
  }

  private mapReport(ev: VerifiedPreviewEvidence | null): ReviewSummary['latestReport'] {
    if (!ev) return null;
    return {
      path: ev.reportRel,
      kind: ev.kind,
      ratio: ev.ratio,
      status: ev.status,
      fingerprint: ev.fingerprint,
      videoPath: ev.videoRel ?? undefined,
      videoSha256: ev.videoSha256 ?? undefined,
      timeRange: ev.timeRange,
      checkedFrames: ev.checkedFrames,
      reasonCodes: ev.reasonCodes,
    };
  }

  private mapReview(ev: VerifiedVisualReviewEvidence | null): ReviewSummary['latestMotionReview'] {
    if (!ev) return null;
    return {
      path: ev.reviewRel,
      status: ev.status,
      rawStatus: ev.rawStatus,
      reviewSha256: ev.reviewSha256,
      subcheckCounts: ev.subcheckCounts,
      remainingGaps: ev.remainingGaps,
      htmlIndexUrl: ev.htmlIndexUrl,
      reasonCodes: ev.reasonCodes,
    };
  }

  async getReviewState(projectId: string, ratio: Ratio): Promise<ReviewSummary> {
    const dir = this.projectService.getProjectDir(projectId);
    const resolved = await this.qaResolver.resolveQaState(dir, ratio);
    return {
      technicalStatus: resolved.summary.technicalStatus,
      visualReviewStatus: resolved.summary.visualReviewStatus,
      userApprovalStatus: resolved.summary.userApprovalStatus,
      reasonCodes: resolved.summary.reasonCodes,
      staleReasons: resolved.summary.staleReasons,
      blockingReasons: resolved.summary.blockingReasons,
      currentSourceFingerprint: resolved.summary.currentSourceFingerprint,
      previewFingerprint: resolved.summary.previewFingerprint,
      previewSha256: resolved.summary.previewSha256,
      reviewSha256: resolved.summary.reviewSha256,
      verifiedAt: resolved.summary.verifiedAt,
      voiceStale: resolved.summary.voiceStale,
      editorSyncState: resolved.summary.editorSyncState,
      renderUnlocked: resolved.summary.renderUnlocked,
      evidenceLinks: resolved.summary.evidenceLinks,
      latestReport: this.mapReport(resolved.latestReport),
      latestMotionReview: this.mapReview(resolved.latestMotionReview),
      approvalRecord: resolved.approvalRecord,
      historyEvents: resolved.historyEvents,
      activeFailure: resolved.activeFailure,
      outputStatuses: resolved.outputStatuses,
    };
  }

  async readMotionReview(projectId: string, reviewRel: string): Promise<Record<string, unknown>> {
    const dir = this.projectService.getProjectDir(projectId);
    const abs = resolveInsideRoot(dir, reviewRel, true);
    return readJsonFile<Record<string, unknown>>(abs);
  }
}
