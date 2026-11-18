import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  EditorSyncState,
  QaApprovalVerdict,
  QaEvidenceSummary,
  QaTechnicalVerdict,
  QaVisualVerdict,
  Ratio,
} from '@b6-studio/shared';
import { PYCACHE_DIR, resolvePythonExe, resolveRealFfprobe } from '../config.js';
import { readJsonFile, resolveInsideRoot, sha256File } from '../utils/fs-safe.js';
import type { StudioMeta } from './project-service.js';

const EXPECTED_SUBCHECK_GROUPS = [
  'space_depth',
  'camera_purpose',
  'body_action',
  'expression_gaze',
  'rhythm_continuity',
  'drawing_anatomy',
  'limb_line_weight',
  'native_audio_captions',
] as const;

const REQUIRED_SUBCHECK_COUNT = 35;

export interface VerifiedPreviewEvidence {
  status: QaTechnicalVerdict;
  reportRel: string;
  kind: string;
  ratio: Ratio;
  fingerprint: string;
  videoRel: string | null;
  videoSha256: string | null;
  timeRange?: { start: number; end: number };
  checkedFrames?: number;
  reasonCodes: string[];
  ffprobe: {
    width: number;
    height: number;
    duration: number;
    nbFrames: number;
    fps: string;
    codec: string;
    hasAudio: boolean;
    bytes: number;
  } | null;
}

export interface VerifiedVisualReviewEvidence {
  status: QaVisualVerdict;
  reviewRel: string;
  reviewSha256: string;
  rawStatus: string;
  fingerprint: string;
  previewSha256: string;
  subcheckCounts: { total: number; pass: number; pending: number; needsRepair: number; na: number };
  remainingGaps: string[];
  htmlIndexUrl: string | null;
  reasonCodes: string[];
}

export interface VerifiedApprovalEvidence {
  status: QaApprovalVerdict;
  approvalPath: string;
  record: Record<string, unknown> | null;
  reasonCodes: string[];
}

export interface ResolvedProjectQaState {
  summary: QaEvidenceSummary;
  latestReport: VerifiedPreviewEvidence | null;
  latestMotionReview: VerifiedVisualReviewEvidence | null;
  approvalRecord: Record<string, unknown> | null;
  historyEvents: unknown[];
  activeFailure: unknown | null;
  outputStatuses: Record<string, { status: 'current' | 'historical' | 'stale' | 'corrupt'; reasonCodes: string[] }>;
}

interface FingerprintResolution {
  ok: boolean;
  fingerprint: string | null;
  reasonCodes: string[];
  errors: string[];
  voiceStale: boolean;
  hasSceneRuntime: boolean;
  projectStage: string;
  expectedDuration: number | null;
}

export class QaEvidenceResolver {
  private readonly fpCache = new Map<string, { key: string; value: FingerprintResolution }>();

  invalidateProject(projectDir: string): void {
    const prefix = `${path.resolve(projectDir)}::`;
    for (const k of this.fpCache.keys()) {
      if (k.startsWith(prefix)) this.fpCache.delete(k);
    }
  }

  private async computeFastStateKey(projectDir: string, ratio: Ratio): Promise<string> {
    const statFiles = [
      'project.json',
      'studio.meta.json',
      'story.json',
      'captions.json',
      'scene.py',
      'scene-control.json',
      'scene_runtime.py',
      'characters.json',
      'engine/manifest.json',
      ratio === '9:16' ? 'formats/portrait.json' : 'formats/landscape.json',
    ];
    try {
      const proj = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8')) as {
        voice?: { path?: string };
      };
      if (proj?.voice?.path && typeof proj.voice.path === 'string') {
        statFiles.push(proj.voice.path);
      }
    } catch {
      // handled in resolveCurrentProjectFingerprint
    }
    const parts: string[] = [ratio];
    for (const rel of statFiles) {
      const p = path.join(projectDir, rel);
      try {
        const st = fs.statSync(p);
        parts.push(`${rel}:${st.size}:${Math.trunc(st.mtimeMs)}`);
      } catch {
        parts.push(`${rel}:missing`);
      }
    }
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  }

  async resolveCurrentProjectFingerprint(projectDir: string, ratio: Ratio): Promise<FingerprintResolution> {
    const absDir = path.resolve(projectDir);
    const cacheKey = `${absDir}::${ratio}`;
    const stateHash = await this.computeFastStateKey(absDir, ratio);
    const cached = this.fpCache.get(cacheKey);
    if (cached && cached.key === stateHash) {
      return cached.value;
    }

    const reasonCodes: string[] = [];
    const errors: string[] = [];

    const projPath = path.join(absDir, 'project.json');
    if (!fs.existsSync(projPath)) {
      return {
        ok: false,
        fingerprint: null,
        reasonCodes: ['MISSING_PROJECT_JSON'],
        errors: ['Thiếu project.json.'],
        voiceStale: false,
        hasSceneRuntime: false,
        projectStage: 'missing',
        expectedDuration: null,
      };
    }

    let proj: Record<string, unknown>;
    try {
      proj = await readJsonFile<Record<string, unknown>>(projPath);
    } catch (e) {
      return {
        ok: false,
        fingerprint: null,
        reasonCodes: ['CORRUPT_PROJECT_JSON'],
        errors: [`Lỗi đọc project.json: ${e instanceof Error ? e.message : String(e)}`],
        voiceStale: false,
        hasSceneRuntime: false,
        projectStage: 'corrupt',
        expectedDuration: null,
      };
    }

    const projectStage = String(proj.stage ?? 'needs_authoring');
    const expectedDuration = typeof proj.duration === 'number' ? proj.duration : null;

    // Check voice-to-narration alignment cleanly
    let voiceStale = false;
    const metaPath = path.join(absDir, 'studio.meta.json');
    let meta: Partial<StudioMeta> | null = null;
    if (fs.existsSync(metaPath)) {
      try {
        meta = await readJsonFile<StudioMeta>(metaPath);
      } catch {
        // handled downstream
      }
    }

    const storyRel = String(proj.story ?? 'story.json');
    const storyAbs = path.join(absDir, storyRel);
    let narrationText = '';
    if (fs.existsSync(storyAbs)) {
      try {
        const story = await readJsonFile<{ narration?: string }>(storyAbs);
        narrationText = String(story.narration ?? '');
      } catch {
        // ignore
      }
    }

    if (meta && typeof meta.voiceTextSha256 === 'string' && meta.voiceTextSha256.length === 64) {
      const curNarrationSha = crypto.createHash('sha256').update(narrationText.trim(), 'utf8').digest('hex');
      if (curNarrationSha !== meta.voiceTextSha256) {
        voiceStale = true;
        reasonCodes.push('VOICE_NEEDS_REGENERATION');
        errors.push('Lời thoại đã thay đổi sau khi tạo/nhập audio gốc; cần tạo lại hoặc import file voice mới khớp lời thoại.');
      }
    }

    const scenePath = resolveInsideRoot(absDir, String(proj.scene ?? 'scene.py'), false);
    const sceneSrc = fs.existsSync(scenePath) ? await fsp.readFile(scenePath, 'utf8') : '';
    const hasSceneRuntime = sceneSrc.includes('scene_runtime') && fs.existsSync(path.join(absDir, 'scene-control.json'));

    if (!fs.existsSync(path.join(absDir, 'engine', 'manifest.json'))) {
      reasonCodes.push('ENGINE_NOT_HYDRATED');
      errors.push('Thiếu engine/manifest.json — cần chạy hydrate-project để khôi phục runtime B6.');
    }

    if (projectStage !== 'authored') {
      reasonCodes.push('PROJECT_NOT_AUTHORED');
      errors.push(`Dự án đang ở stage "${projectStage}", chưa thể xác nhận PASS kỹ thuật.`);
      const val: FingerprintResolution = {
        ok: false,
        fingerprint: null,
        reasonCodes,
        errors,
        voiceStale,
        hasSceneRuntime,
        projectStage,
        expectedDuration,
      };
      this.fpCache.set(cacheKey, { key: stateHash, value: val });
      return val;
    }

    // Delegate authoritative fingerprint computation to actual B6 runner `run.py validate`
    const runPy = path.join(absDir, 'run.py');
    if (!fs.existsSync(runPy)) {
      reasonCodes.push('MISSING_RUN_PY');
      errors.push('Thiếu run.py trong thư mục dự án.');
      const val: FingerprintResolution = {
        ok: false,
        fingerprint: null,
        reasonCodes,
        errors,
        voiceStale,
        hasSceneRuntime,
        projectStage,
        expectedDuration,
      };
      this.fpCache.set(cacheKey, { key: stateHash, value: val });
      return val;
    }

    const pythonExe = resolvePythonExe();
    const res = spawnSync(pythonExe, [runPy, 'validate', absDir, '--ratio', ratio], {
      cwd: absDir,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONPYCACHEPREFIX: PYCACHE_DIR,
      },
      encoding: 'utf8',
      shell: false,
      timeout: 15000,
    });

    if (res.status !== 0) {
      const msg = (res.stderr || res.stdout || '').trim().split(/\r?\n/).slice(-3).join(' ');
      reasonCodes.push('VALIDATION_FAILED');
      errors.push(msg || `run.py validate failed (exit ${res.status})`);
      const val: FingerprintResolution = {
        ok: false,
        fingerprint: null,
        reasonCodes,
        errors,
        voiceStale,
        hasSceneRuntime,
        projectStage,
        expectedDuration,
      };
      this.fpCache.set(cacheKey, { key: stateHash, value: val });
      return val;
    }

    let fp: string | null = null;
    try {
      const idx = res.stdout.lastIndexOf('RESULT ');
      const payload = idx >= 0 ? res.stdout.slice(idx + 7).trim() : res.stdout.trim();
      const parsed = JSON.parse(payload) as { valid?: boolean; fingerprint?: string };
      if (parsed.valid && typeof parsed.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(parsed.fingerprint)) {
        fp = parsed.fingerprint;
      }
    } catch {
      // handled below
    }

    if (!fp) {
      reasonCodes.push('INVALID_VALIDATE_OUTPUT');
      errors.push('Không đọc được fingerprint hợp lệ từ run.py validate.');
    }

    const val: FingerprintResolution = {
      ok: Boolean(fp) && !voiceStale && reasonCodes.length === 0,
      fingerprint: fp,
      reasonCodes,
      errors,
      voiceStale,
      hasSceneRuntime,
      projectStage,
      expectedDuration,
    };
    this.fpCache.set(cacheKey, { key: stateHash, value: val });
    return val;
  }

  probeVideoStrict(absPath: string, expectedRatio: Ratio): VerifiedPreviewEvidence['ffprobe'] {
    const ffprobe = resolveRealFfprobe();
    const res = spawnSync(
      ffprobe,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', absPath],
      { encoding: 'utf8', shell: false, timeout: 10000 },
    );
    if (res.status !== 0) return null;
    try {
      const parsed = JSON.parse(res.stdout) as {
        format?: { duration?: string };
        streams?: Array<{
          codec_type?: string;
          codec_name?: string;
          width?: number;
          height?: number;
          r_frame_rate?: string;
          nb_frames?: string;
          duration?: string;
        }>;
      };
      const v = parsed.streams?.find((s) => s.codec_type === 'video');
      const a = parsed.streams?.find((s) => s.codec_type === 'audio');
      if (!v) return null;

      const width = Number(v.width ?? 0);
      const height = Number(v.height ?? 0);
      const duration = Number(parsed.format?.duration ?? v.duration ?? 0);
      const nbFrames = Number(v.nb_frames ?? 0);
      if (!Number.isFinite(duration) || duration <= 0 || width <= 0 || height <= 0 || nbFrames <= 0) {
        return null;
      }

      // Check aspect ratio orientation matches declared ratio
      const ratioOk = expectedRatio === '9:16' ? height > width && Math.abs(width / height - 9 / 16) < 0.02
        : width > height && Math.abs(width / height - 16 / 9) < 0.02;
      if (!ratioOk) return null;

      const fpsStr = v.r_frame_rate ?? '0/1';
      const [numS, denS] = fpsStr.split('/');
      const fpsVal = Number(denS) ? Number(numS) / Number(denS) : Number(numS);
      if (!Number.isFinite(fpsVal) || Math.abs(fpsVal - 30) > 0.5) return null;

      return {
        width,
        height,
        duration,
        nbFrames,
        fps: fpsStr,
        codec: v.codec_name ?? 'unknown',
        hasAudio: Boolean(a),
        bytes: fs.statSync(absPath).size,
      };
    } catch {
      return null;
    }
  }

  async loadAndVerifyPreviewReport(
    projectDir: string,
    reportRel: string,
    fpInfo: FingerprintResolution,
    ratio: Ratio,
  ): Promise<VerifiedPreviewEvidence> {
    const reasonCodes: string[] = [];
    const absReport = resolveInsideRoot(projectDir, reportRel, false);
    if (!fs.existsSync(absReport)) {
      return {
        status: 'pending',
        reportRel,
        kind: 'missing',
        ratio,
        fingerprint: '',
        videoRel: null,
        videoSha256: null,
        reasonCodes: ['REPORT_MISSING'],
        ffprobe: null,
      };
    }

    let rep: Record<string, unknown>;
    try {
      rep = await readJsonFile<Record<string, unknown>>(absReport);
    } catch {
      return {
        status: 'fail',
        reportRel,
        kind: 'corrupt',
        ratio,
        fingerprint: '',
        videoRel: null,
        videoSha256: null,
        reasonCodes: ['REPORT_CORRUPT_JSON'],
        ffprobe: null,
      };
    }

    const kind = String(rep.kind ?? 'unknown');
    const repRatio = String(rep.ratio ?? '') as Ratio;
    const repFp = typeof rep.fingerprint === 'string' ? rep.fingerprint : '';
    const videoRelRaw = typeof rep.video === 'string' ? rep.video.replace(/\\/g, '/') : null;
    const expectedVideoSha = typeof rep.video_sha256 === 'string' ? rep.video_sha256 : null;

    if (kind !== 'preview' && kind !== 'render') {
      reasonCodes.push('NOT_A_PRODUCTION_PREVIEW_KIND');
    }
    if (rep.technical_fixture === true) {
      reasonCodes.push('TECHNICAL_FIXTURE_NOT_ELIGIBLE');
    }
    if (repRatio !== ratio) {
      reasonCodes.push('RATIO_MISMATCH');
    }
    if (rep.technical_status !== 'pass') {
      reasonCodes.push('REPORT_TECHNICAL_STATUS_NOT_PASS');
    }
    if (typeof rep.checked_frames !== 'number' || rep.checked_frames <= 0) {
      reasonCodes.push('ZERO_CHECKED_FRAMES');
    }

    let actualVideoSha: string | null = null;
    let probe: VerifiedPreviewEvidence['ffprobe'] = null;
    if (!videoRelRaw || !expectedVideoSha || !/^[0-9a-f]{64}$/.test(expectedVideoSha)) {
      reasonCodes.push('VIDEO_METADATA_MISSING');
    } else {
      let videoAbs: string | null = null;
      try {
        videoAbs = resolveInsideRoot(projectDir, videoRelRaw, true);
      } catch {
        reasonCodes.push('VIDEO_FILE_MISSING');
      }
      if (videoAbs) {
        actualVideoSha = await sha256File(videoAbs);
        if (actualVideoSha !== expectedVideoSha) {
          reasonCodes.push('VIDEO_SHA256_MISMATCH');
        }
        probe = this.probeVideoStrict(videoAbs, ratio);
        if (!probe) {
          reasonCodes.push('VIDEO_FFPROBE_INVALID_OR_TRUNCATED');
        } else {
          if (!probe.hasAudio) {
            reasonCodes.push('VIDEO_MISSING_AUDIO_STREAM');
          }
          if ((kind === 'preview' || kind === 'render') && fpInfo.expectedDuration && fpInfo.expectedDuration > 0) {
            const tr = rep.time_range as { start?: number; end?: number } | undefined;
            const trSpan = tr && typeof tr.start === 'number' && typeof tr.end === 'number' ? tr.end - tr.start : null;
            const isExplicitPartial =
              trSpan !== null &&
              ((typeof tr?.start === 'number' && tr.start > 0.05) || trSpan < fpInfo.expectedDuration - 0.5);
            if (isExplicitPartial) {
              reasonCodes.push('PARTIAL_CLIP_ONLY');
            } else if (Math.abs(probe.duration - fpInfo.expectedDuration) > 0.75) {
              reasonCodes.push('VIDEO_DURATION_MISMATCH');
            }
          }
        }
      }
    }

    // Determine fail vs stale vs pass strictly from gathered reasonCodes
    const hardFailCodes = new Set([
      'REPORT_CORRUPT_JSON',
      'REPORT_TECHNICAL_STATUS_NOT_PASS',
      'ZERO_CHECKED_FRAMES',
      'VIDEO_METADATA_MISSING',
      'VIDEO_FILE_MISSING',
      'VIDEO_SHA256_MISMATCH',
      'VIDEO_FFPROBE_INVALID_OR_TRUNCATED',
      'VIDEO_MISSING_AUDIO_STREAM',
      'VIDEO_DURATION_MISMATCH',
    ]);

    if (reasonCodes.some((c) => hardFailCodes.has(c))) {
      return {
        status: 'fail',
        reportRel,
        kind,
        ratio,
        fingerprint: repFp,
        videoRel: videoRelRaw,
        videoSha256: actualVideoSha ?? expectedVideoSha,
        timeRange: rep.time_range as { start: number; end: number } | undefined,
        checkedFrames: typeof rep.checked_frames === 'number' ? rep.checked_frames : undefined,
        reasonCodes,
        ffprobe: probe,
      };
    }

    if (
      reasonCodes.includes('NOT_A_PRODUCTION_PREVIEW_KIND') ||
      reasonCodes.includes('TECHNICAL_FIXTURE_NOT_ELIGIBLE') ||
      reasonCodes.includes('RATIO_MISMATCH')
    ) {
      return {
        status: 'pending',
        reportRel,
        kind,
        ratio,
        fingerprint: repFp,
        videoRel: videoRelRaw,
        videoSha256: actualVideoSha,
        timeRange: rep.time_range as { start: number; end: number } | undefined,
        checkedFrames: typeof rep.checked_frames === 'number' ? rep.checked_frames : undefined,
        reasonCodes,
        ffprobe: probe,
      };
    }

    if (fpInfo.voiceStale) {
      reasonCodes.push('VOICE_NEEDS_REGENERATION');
    }
    if (!fpInfo.fingerprint || repFp !== fpInfo.fingerprint) {
      reasonCodes.push('SOURCE_FINGERPRINT_MISMATCH');
    }

    const status: QaTechnicalVerdict =
      reasonCodes.includes('SOURCE_FINGERPRINT_MISMATCH') || reasonCodes.includes('VOICE_NEEDS_REGENERATION')
        ? 'stale'
        : reasonCodes.includes('PARTIAL_CLIP_ONLY')
        ? 'pending'
        : reasonCodes.length === 0
        ? 'pass'
        : 'stale';
    return {
      status,
      reportRel,
      kind,
      ratio,
      fingerprint: repFp,
      videoRel: videoRelRaw,
      videoSha256: actualVideoSha,
      timeRange: rep.time_range as { start: number; end: number } | undefined,
      checkedFrames: typeof rep.checked_frames === 'number' ? rep.checked_frames : undefined,
      reasonCodes,
      ffprobe: probe,
    };
  }

  async loadAndVerifyVisualReview(
    projectDir: string,
    reviewRel: string,
    verifiedPreview: VerifiedPreviewEvidence | null,
    currentFp: string | null,
    ratio: Ratio,
    hasActiveFailure: boolean,
  ): Promise<VerifiedVisualReviewEvidence> {
    const reasonCodes: string[] = [];
    const absReview = resolveInsideRoot(projectDir, reviewRel, false);
    if (!fs.existsSync(absReview)) {
      return {
        status: 'pending',
        reviewRel,
        reviewSha256: '',
        rawStatus: 'missing',
        fingerprint: '',
        previewSha256: '',
        subcheckCounts: { total: 0, pass: 0, pending: 0, needsRepair: 0, na: 0 },
        remainingGaps: [],
        htmlIndexUrl: null,
        reasonCodes: ['REVIEW_FILE_MISSING'],
      };
    }

    const reviewSha256 = await sha256File(absReview);
    let rev: Record<string, unknown>;
    try {
      rev = await readJsonFile<Record<string, unknown>>(absReview);
    } catch {
      return {
        status: 'needs_repair',
        reviewRel,
        reviewSha256,
        rawStatus: 'corrupt',
        fingerprint: '',
        previewSha256: '',
        subcheckCounts: { total: 0, pass: 0, pending: 0, needsRepair: 0, na: 0 },
        remainingGaps: ['motion-review.json không hợp lệ'],
        htmlIndexUrl: null,
        reasonCodes: ['REVIEW_CORRUPT_JSON'],
      };
    }

    const revRatio = String(rev.ratio ?? '');
    const revFp = typeof rev.fingerprint === 'string' ? rev.fingerprint : '';
    const revPreview = (rev.preview as { path?: string; sha256?: string }) ?? {};
    const revMeta = (rev.review as { status?: string; reviewer?: string; method?: string }) ?? {};
    const rawStatus = String(revMeta.status ?? 'pending');
    const remainingGaps = Array.isArray(rev.remaining_gaps) ? (rev.remaining_gaps as string[]) : [];

    const checks = (rev.checks as Record<string, {
      status?: string;
      subchecks?: Record<string, { status?: string; observation?: string; evidence?: string[] }>;
    }>) ?? {};

    let total = 0;
    let pass = 0;
    let pending = 0;
    let needsRepair = 0;
    let na = 0;
    let fakeEmptyPassOrNa = false;

    for (const grpKey of EXPECTED_SUBCHECK_GROUPS) {
      const grp = checks[grpKey];
      if (!grp || !grp.subchecks || typeof grp.subchecks !== 'object') {
        reasonCodes.push(`MISSING_CHECK_GROUP_${grpKey}`);
        continue;
      }
      for (const sub of Object.values(grp.subchecks)) {
        total++;
        if (sub.status === 'pass') {
          pass++;
          if (!sub.observation || !String(sub.observation).trim()) {
            fakeEmptyPassOrNa = true;
          }
        } else if (sub.status === 'not_applicable') {
          na++;
          if (!sub.observation || !String(sub.observation).trim()) {
            fakeEmptyPassOrNa = true;
          }
        } else if (sub.status === 'needs_repair') {
          needsRepair++;
        } else {
          pending++;
        }
      }
    }

    if (total !== REQUIRED_SUBCHECK_COUNT) {
      reasonCodes.push(`SUBCHECK_COUNT_MISMATCH_${total}_OF_${REQUIRED_SUBCHECK_COUNT}`);
    }
    if (fakeEmptyPassOrNa) {
      reasonCodes.push('SUBCHECK_EMPTY_OBSERVATION_PROHIBITED');
    }
    if (revRatio !== ratio) {
      reasonCodes.push('REVIEW_RATIO_MISMATCH');
    }
    if (!currentFp || revFp !== currentFp) {
      reasonCodes.push('REVIEW_FINGERPRINT_MISMATCH');
    }
    if (!verifiedPreview || !verifiedPreview.videoSha256 || revPreview.sha256 !== verifiedPreview.videoSha256) {
      reasonCodes.push('REVIEW_PREVIEW_SHA_MISMATCH');
    }

    // Verify referenced shot/caption artifacts inside review folder actually exist on disk
    const shotsArr = Array.isArray(rev.shots) ? (rev.shots as Array<{ evidence?: string[] }>) : [];
    for (const sh of shotsArr) {
      for (const evRel of sh.evidence ?? []) {
        try {
          resolveInsideRoot(projectDir, evRel, true);
        } catch {
          reasonCodes.push('REVIEW_SHOT_EVIDENCE_MISSING');
          break;
        }
      }
    }

    const htmlAbs = path.join(path.dirname(absReview), 'index.html');
    const projectId = path.basename(projectDir);
    const reviewDirName = path.basename(path.dirname(absReview));
    const htmlIndexUrl = fs.existsSync(htmlAbs) ? `/api/media/${projectId}/outputs/${reviewDirName}/index.html` : null;

    if (hasActiveFailure) {
      reasonCodes.push('ACTIVE_REVIEW_HISTORY_FAILURE');
    }

    let status: QaVisualVerdict = 'pending';
    const isStale = reasonCodes.includes('REVIEW_FINGERPRINT_MISMATCH') || reasonCodes.includes('REVIEW_PREVIEW_SHA_MISMATCH');
    if (
      needsRepair > 0 ||
      rawStatus === 'needs_repair' ||
      fakeEmptyPassOrNa ||
      hasActiveFailure ||
      reasonCodes.includes('REVIEW_SHOT_EVIDENCE_MISSING') ||
      (rawStatus === 'pass' && (total !== REQUIRED_SUBCHECK_COUNT || remainingGaps.length > 0))
    ) {
      status = isStale ? 'stale' : 'needs_repair';
    } else if (isStale) {
      status = 'stale';
    } else if (
      rawStatus === 'pass' &&
      total === REQUIRED_SUBCHECK_COUNT &&
      pending === 0 &&
      needsRepair === 0 &&
      remainingGaps.length === 0 &&
      reasonCodes.length === 0
    ) {
      const fpObj = (rev.full_playback as { preview_sha256?: string; observed_audio?: string }) ?? {};
      if (fpObj.preview_sha256 === verifiedPreview?.videoSha256 && revMeta.reviewer && fpObj.observed_audio) {
        status = 'pass';
      } else {
        reasonCodes.push('MISSING_FULL_PLAYBACK_OBSERVATION');
        status = 'needs_repair';
      }
    }

    return {
      status,
      reviewRel,
      reviewSha256,
      rawStatus,
      fingerprint: revFp,
      previewSha256: String(revPreview.sha256 ?? ''),
      subcheckCounts: { total, pass, pending, needsRepair, na },
      remainingGaps,
      htmlIndexUrl,
      reasonCodes,
    };
  }

  async loadAndVerifyApproval(
    projectDir: string,
    ratio: Ratio,
    verifiedPreview: VerifiedPreviewEvidence | null,
    verifiedReview: VerifiedVisualReviewEvidence | null,
    currentFp: string | null,
  ): Promise<VerifiedApprovalEvidence> {
    const approvalName = `approval-${ratio.replace(':', 'x')}.json`;
    const approvalPath = path.join(projectDir, approvalName);
    if (!fs.existsSync(approvalPath)) {
      return { status: 'pending', approvalPath: approvalName, record: null, reasonCodes: ['NO_APPROVAL_RECORD'] };
    }

    let rec: Record<string, unknown>;
    try {
      rec = await readJsonFile<Record<string, unknown>>(approvalPath);
    } catch {
      return { status: 'rejected', approvalPath: approvalName, record: null, reasonCodes: ['APPROVAL_CORRUPT_JSON'] };
    }

    const reasonCodes: string[] = [];
    const note = typeof rec.note === 'string' ? rec.note.trim() : '';
    const appFp = typeof rec.fingerprint === 'string' ? rec.fingerprint : '';
    const appVidSha = typeof rec.video_sha256 === 'string' ? rec.video_sha256 : '';
    const mr = (rec.motion_review as { review?: string; sha256?: string }) ?? {};

    if (note.length < 3) {
      reasonCodes.push('APPROVAL_NOTE_TOO_SHORT_OR_TAMPERED');
    }
    if (!currentFp || appFp !== currentFp) {
      reasonCodes.push('APPROVAL_FINGERPRINT_STALE');
    }
    if (!verifiedPreview || verifiedPreview.status !== 'pass' || appVidSha !== verifiedPreview.videoSha256) {
      reasonCodes.push('APPROVAL_PREVIEW_MISMATCH_OR_STALE');
    }
    if (!verifiedReview || verifiedReview.status !== 'pass') {
      reasonCodes.push('APPROVAL_REVIEW_NOT_PASS');
    } else if (!mr.review || mr.sha256 !== verifiedReview.reviewSha256) {
      reasonCodes.push('APPROVAL_REVIEW_SHA_MISMATCH');
    }

    if (reasonCodes.includes('APPROVAL_NOTE_TOO_SHORT_OR_TAMPERED')) {
      return { status: 'rejected', approvalPath: approvalName, record: rec, reasonCodes };
    }
    if (reasonCodes.length > 0) {
      return { status: 'stale', approvalPath: approvalName, record: rec, reasonCodes };
    }
    return { status: 'approved', approvalPath: approvalName, record: rec, reasonCodes: [] };
  }

  async resolveQaState(projectDir: string, ratio: Ratio): Promise<ResolvedProjectQaState> {
    const absDir = path.resolve(projectDir);
    const fpInfo = await this.resolveCurrentProjectFingerprint(absDir, ratio);
    const outputsDir = path.join(absDir, 'outputs');

    const previewCandidates: Array<{ mtimeMs: number; ev: VerifiedPreviewEvidence }> = [];
    const reviewDirs: Array<{ mtimeMs: number; reviewRel: string }> = [];
    const outputStatuses: ResolvedProjectQaState['outputStatuses'] = {};

    if (fs.existsSync(outputsDir)) {
      const entries = await fsp.readdir(outputsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(outputsDir, entry.name);
        const reportPath = path.join(subDir, 'report.json');
        if (fs.existsSync(reportPath)) {
          const stat = fs.statSync(reportPath);
          const ev = await this.loadAndVerifyPreviewReport(absDir, `outputs/${entry.name}/report.json`, fpInfo, ratio);
          if (ev.kind === 'draft') {
            outputStatuses[entry.name] = {
              status: ev.status === 'fail' ? 'corrupt' : 'historical',
              reasonCodes: ev.reasonCodes,
            };
          } else {
            outputStatuses[entry.name] = {
              status: ev.status === 'pass' ? 'current' : ev.status === 'fail' ? 'corrupt' : 'stale',
              reasonCodes: ev.reasonCodes,
            };
          }
          if (ev.kind === 'preview' || ev.kind === 'render') {
            previewCandidates.push({ mtimeMs: stat.mtimeMs, ev });
          }
        }
        const revPath = path.join(subDir, 'motion-review.json');
        if (fs.existsSync(revPath)) {
          const stat = fs.statSync(revPath);
          reviewDirs.push({ mtimeMs: stat.mtimeMs, reviewRel: `outputs/${entry.name}/motion-review.json` });
        }
      }
    }

    // Prefer a verified current PASS preview over stale ones; otherwise newest preview/render candidate
    previewCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const bestPreview =
      previewCandidates.find((c) => c.ev.status === 'pass')?.ev ?? previewCandidates[0]?.ev ?? null;

    // Review history check
    const historyFile = path.join(absDir, '.b6-review-history', 'index.json');
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
        // ignore unreadable history
      }
    }

    reviewDirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const matchingReviewRel =
      bestPreview?.videoSha256
        ? (
            await (async () => {
              for (const r of reviewDirs) {
                const ev = await this.loadAndVerifyVisualReview(
                  absDir,
                  r.reviewRel,
                  bestPreview,
                  fpInfo.fingerprint,
                  ratio,
                  Boolean(activeFailure),
                );
                if (ev.status === 'pass') return ev;
              }
              return null;
            })()
          )
        : null;

    const latestMotionReview =
      matchingReviewRel ??
      (reviewDirs[0]
        ? await this.loadAndVerifyVisualReview(
            absDir,
            reviewDirs[0].reviewRel,
            bestPreview,
            fpInfo.fingerprint,
            ratio,
            Boolean(activeFailure),
          )
        : null);

    const approval = await this.loadAndVerifyApproval(
      absDir,
      ratio,
      bestPreview,
      latestMotionReview,
      fpInfo.fingerprint,
    );

    const technicalStatus: QaTechnicalVerdict = bestPreview
      ? bestPreview.status
      : fpInfo.voiceStale
      ? 'stale'
      : fpInfo.ok
      ? 'pending'
      : fpInfo.projectStage === 'authored'
      ? 'fail'
      : 'pending';

    const visualReviewStatus: QaVisualVerdict = latestMotionReview ? latestMotionReview.status : 'pending';
    const userApprovalStatus: QaApprovalVerdict = approval.status;

    const reasonCodes = Array.from(
      new Set([
        ...fpInfo.reasonCodes,
        ...(bestPreview?.reasonCodes ?? []),
        ...(latestMotionReview?.reasonCodes ?? []),
        ...approval.reasonCodes,
      ]),
    );

    const staleReasons = reasonCodes.filter(
      (c) => c.includes('STALE') || c.includes('MISMATCH') || c.includes('VOICE_NEEDS_REGENERATION'),
    );

    const blockingReasons = [
      ...fpInfo.errors,
      ...(bestPreview && bestPreview.status !== 'pass' ? [`Preview chưa PASS hiện hành (${bestPreview.status}): ${bestPreview.reasonCodes.join(', ')}`] : []),
      ...(latestMotionReview && latestMotionReview.status !== 'pass'
        ? [`Visual review 35 mục chưa hoàn tất (${latestMotionReview.status})`]
        : []),
      ...(approval.status !== 'approved' ? [`Phê duyệt người dùng đang ở trạng thái ${approval.status}`] : []),
    ];

    let editorSyncState: EditorSyncState = 'not_authored';
    if (fpInfo.voiceStale) {
      editorSyncState = 'voice_needs_regeneration';
    } else if (fpInfo.projectStage !== 'authored') {
      editorSyncState = 'not_authored';
    } else if (!fpInfo.hasSceneRuntime) {
      editorSyncState = bestPreview?.status === 'pass' ? 'applied_to_renderer' : 'manual_scene_only';
    } else if (bestPreview?.status === 'pass') {
      editorSyncState = 'applied_to_renderer';
    } else if (bestPreview) {
      editorSyncState = 'preview_stale';
    } else {
      editorSyncState = 'bound_current';
    }

    const evidenceLinks: QaEvidenceSummary['evidenceLinks'] = [];
    if (bestPreview) {
      evidenceLinks.push({ label: 'Preview Report', path: bestPreview.reportRel, status: bestPreview.status });
      if (bestPreview.videoRel) {
        evidenceLinks.push({ label: 'Preview MP4', path: bestPreview.videoRel, status: bestPreview.status });
      }
    }
    if (latestMotionReview) {
      evidenceLinks.push({ label: 'Motion Review JSON', path: latestMotionReview.reviewRel, status: latestMotionReview.status });
    }
    if (approval.record) {
      evidenceLinks.push({ label: 'User Approval JSON', path: approval.approvalPath, status: approval.status });
    }

    const summary: QaEvidenceSummary = {
      technicalStatus,
      visualReviewStatus,
      userApprovalStatus,
      reasonCodes,
      staleReasons,
      blockingReasons,
      currentSourceFingerprint: fpInfo.fingerprint,
      previewFingerprint: bestPreview?.fingerprint ?? null,
      previewSha256: bestPreview?.videoSha256 ?? null,
      reviewSha256: latestMotionReview?.reviewSha256 ?? null,
      verifiedAt: new Date().toISOString(),
      voiceStale: fpInfo.voiceStale,
      editorSyncState,
      renderUnlocked: technicalStatus === 'pass' && visualReviewStatus === 'pass' && userApprovalStatus === 'approved',
      evidenceLinks,
    };

    return {
      summary,
      latestReport: bestPreview,
      latestMotionReview,
      approvalRecord: approval.record,
      historyEvents,
      activeFailure,
      outputStatuses,
    };
  }
}
