import type {
  AssetBriefInput,
  AssetRecord,
  AssetRole,
  CreateProjectInput,
  EditorSyncState,
  JobRecord,
  PatchProjectInput,
  QaApprovalVerdict,
  QaTechnicalVerdict,
  QaVisualVerdict,
  Ratio,
} from '@b6-studio/shared';

export interface ProjectSummaryDto {
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

export interface ProjectDetailDto {
  id: string;
  path: string;
  meta: {
    schema: string;
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
    revision?: number;
    lastRenderedRevision?: number | null;
    voiceTextSha256?: string | null;
    sceneSyncRequests: Array<{ id: string; createdAt: string; note: string; status: 'pending' | 'applied' }>;
  };
  projectJson: Record<string, unknown>;
  storyJson: {
    narration?: string;
    beats?: Array<{ id?: string; start: number; end: number; action: string; cause?: string; payoff?: string }>;
    status?: string;
  };
  captionsJson: Array<{ start: number; end: number; text: string }>;
  formats: Record<string, Record<string, unknown>>;
  charactersJson: {
    schema: string;
    actors: Array<{ id: string; package: string; views: string[] }>;
    rigid_cast: unknown[];
  };
  scenePy: string;
  sceneSyncRequests: Array<{ id: string; createdAt: string; note: string; status: 'pending' | 'applied' }>;
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

export interface DoctorReportDto {
  checkedAt: string;
  ok: boolean;
  appRoot: string;
  vendorRoot: string;
  skillDir: string;
  projectsDir: string;
  executables: {
    node: { path: string; version: string; ok: boolean };
    python: { path: string; version: string; importsOk: boolean; numpy?: string; pillow?: string; cv2?: string; ok: boolean };
    ffmpeg: { path: string; version: string; supportsVsync: boolean; compatShimActive: boolean; ok: boolean };
    ffprobe: { path: string; version: string; ok: boolean };
  };
  upstreamDoctor: { ok: boolean; checks: Record<string, boolean>; rawError?: string };
  disk: { freeBytes: number; freeGiB: number; okForRender: boolean; lowSpaceWarning: boolean };
  capabilities: { imageGenerationRoute: string; ttsRoute: string; codeRenderer: string };
}

export interface UpstreamInfoDto {
  ok: boolean;
  repoUrl: string;
  localPath: string;
  branch: string;
  commitSha: string;
  license: string;
  primaryReference: {
    id: string;
    path: string;
    expectedSha256: string;
    actualSha256: string | null;
    verified: boolean;
  };
  packCheck: { ok: boolean; files?: number; error?: string };
}

export interface OutputArtifactDto {
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

export interface ReviewStateDto {
  technicalStatus: QaTechnicalVerdict;
  visualReviewStatus: QaVisualVerdict;
  userApprovalStatus: QaApprovalVerdict;
  motionQcStatus?: QaTechnicalVerdict;
  motionQcSummary?: Record<string, unknown>;
  editorialQcStatus?: QaTechnicalVerdict;
  editorialQcSummary?: Record<string, unknown>;
  reasonCodes: string[];
  staleReasons: string[];
  blockingReasons: string[];
  currentSourceFingerprint: string | null;
  previewFingerprint: string | null;
  previewSha256: string | null;
  reviewSha256: string | null;
  verifiedAt: string;
  voiceStale: boolean;
  editorSyncState: EditorSyncState;
  renderUnlocked: boolean;
  evidenceLinks: Array<{ label: string; path: string; status: string }>;
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
  outputStatuses?: Record<string, { status: 'current' | 'historical' | 'stale' | 'corrupt'; reasonCodes: string[] }>;
}

export interface FieldRuntimeBindingRowDto {
  uiField: string;
  jsonPath: string;
  pythonFunction: string;
  affectedRegion: string;
  verificationMethod: string;
  liveBound: boolean;
}

export interface EditorBindingStatusDto {
  mode: 'bound_canonical' | 'authored_custom_scene';
  syncState: EditorSyncState;
  revision: number;
  lastRenderedRevision: number | null;
  voiceStale: boolean;
  canSynthesizeLocalVoice: boolean;
  motionEngineMode?: 'legacy_stance' | 'articulated_v1' | 'articulated_verified';
  motionQcVerified?: boolean;
  gaitHonestyNote: string;
  editorialMode?: 'none' | 'editorial_v1' | 'editorial_verified';
  editorialQcVerified?: boolean;
  shotVarietyWarnings?: string[];
  mappings: FieldRuntimeBindingRowDto[];
}

export interface EditorialReportResponseDto {
  projectId: string;
  ratio: Ratio;
  available: boolean;
  stale: boolean;
  reportPath: string | null;
  qcPath: string | null;
  qcStatus: QaTechnicalVerdict;
  qc: Record<string, unknown> | null;
  report: {
    schema?: string;
    duration_s?: number;
    fps?: number;
    cuts_detected?: Array<Record<string, unknown>>;
    per_second?: Array<Record<string, unknown>>;
    per_shot?: Array<Record<string, unknown>>;
    shot_variety?: Record<string, unknown>;
    semantic_lulls?: Record<string, unknown>;
    gaming_audit?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  evidenceLinks: Array<{ label: string; path: string; status: string }>;
  statusNote?: string;
}

export interface CharacterActorDto {
  id: string;
  characterId: string;
  displayName: string;
  packageDir: string;
  bindingVersion: number;
  registeredViews: string[];
  gaitStatus: 'unsupported_needs_authoring' | 'authored_verified';
  gaitNote: string;
  views: Record<
    string,
    {
      viewId: string;
      facing?: string;
      bodyPath: string;
      headPath: string;
      heads: Record<string, string>;
      cuffLeftPath: string;
      cuffRightPath: string;
      inkColor: string;
      headAnchor: [number, number] | null;
      neckAttachment: { mount_polygon: number[][]; min_overlap_fraction: number; min_overlap_thickness: number } | null;
      arms: Record<string, {
        socket: [number, number];
        exit_normal: [number, number];
        exit_center: [number, number];
        outlet_segment: [[number, number], [number, number]];
        lengths: [number, number];
        pole: number;
        ink_width: number;
        hand_radius: number;
        max_ik_offset: number;
        layer: 'front' | 'back';
      }>;
      legs: Record<string, { hip: [number, number]; ankle: [number, number]; ink_width: number; foot_size: [number, number] }>;
    }
  >;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Server trả về lỗi (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = new Error(String(data.error ?? `HTTP ${res.status}`)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export const api = {
  getDoctor: () => req<DoctorReportDto>('/api/doctor'),
  getUpstream: () => req<UpstreamInfoDto>('/api/upstream'),
  listProjects: () => req<{ projects: ProjectSummaryDto[] }>('/api/projects'),
  createProject: (input: CreateProjectInput) =>
    req<{ project: ProjectDetailDto }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  getProject: (id: string) => req<{ project: ProjectDetailDto }>(`/api/projects/${encodeURIComponent(id)}`),
  patchProject: (id: string, patch: PatchProjectInput) =>
    req<{ detail: ProjectDetailDto; validation: { valid: boolean; errors: string[]; totalDuration: number } }>(
      `/api/projects/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    ),
  saveScenePy: (id: string, content: string) =>
    req<{ sha256: string }>(`/api/projects/${encodeURIComponent(id)}/scene`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  duplicateProject: (id: string, title?: string) =>
    req<{ project: ProjectDetailDto }>(`/api/projects/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(title ? { title } : {}),
    }),
  deleteProject: (id: string) =>
    req<{ deletedId: string }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listAssets: (id: string) =>
    req<{ assets: AssetRecord[]; inboxFiles: string[]; requests: unknown[] }>(`/api/projects/${encodeURIComponent(id)}/assets`),
  uploadAsset: (
    id: string,
    file: File,
    meta: { role: AssetRole; classification?: 'PRODUCTION ASSET' | 'REFERENCE ONLY'; actorId?: string; viewId?: string; expressionId?: string; notes?: string },
  ) => {
    const fd = new FormData();
    fd.append('role', meta.role);
    if (meta.classification) fd.append('classification', meta.classification);
    if (meta.actorId) fd.append('actorId', meta.actorId);
    if (meta.viewId) fd.append('viewId', meta.viewId);
    if (meta.expressionId) fd.append('expressionId', meta.expressionId);
    if (meta.notes) fd.append('notes', meta.notes);
    fd.append('file', file);
    return req<{ asset: AssetRecord }>(`/api/projects/${encodeURIComponent(id)}/assets/import`, {
      method: 'POST',
      body: fd,
    });
  },
  importFromInbox: (
    id: string,
    payload: { inboxFilename: string; role: AssetRole; actorId?: string; viewId?: string; expressionId?: string },
  ) =>
    req<{ asset: AssetRecord }>(`/api/projects/${encodeURIComponent(id)}/assets/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  createAssetBrief: (id: string, brief: AssetBriefInput) =>
    req<{ requestId: string; requestPath: string; inboxPath: string; promptText: string; status: string }>(
      `/api/projects/${encodeURIComponent(id)}/assets/brief`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brief),
      },
    ),
  getCharacters: (id: string) =>
    req<{
      schema: string;
      actors: CharacterActorDto[];
      rigidCast: unknown[];
      latestPreflight: Record<string, unknown> | null;
    }>(`/api/projects/${encodeURIComponent(id)}/characters`),
  updateCharacterViewRig: (id: string, actorId: string, viewId: string, patch: Record<string, unknown>) =>
    req<{ viewPackage: Record<string, unknown> }>(
      `/api/projects/${encodeURIComponent(id)}/characters/${encodeURIComponent(actorId)}/views/${encodeURIComponent(viewId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    ),
  getOutputs: (id: string) => req<{ outputs: OutputArtifactDto[] }>(`/api/projects/${encodeURIComponent(id)}/outputs`),
  openOutputFolder: (id: string, relTarget = 'outputs') =>
    req<{ opened: string }>(`/api/projects/${encodeURIComponent(id)}/outputs/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relTarget }),
    }),
  getReviewState: (id: string, ratio: Ratio) =>
    req<{ review: ReviewStateDto }>(`/api/projects/${encodeURIComponent(id)}/review?ratio=${encodeURIComponent(ratio)}`),
  getEditorialReport: (id: string, ratio: Ratio) =>
    req<EditorialReportResponseDto>(
      `/api/projects/${encodeURIComponent(id)}/editorial-report?ratio=${encodeURIComponent(ratio)}`,
    ),
  runAnalyzeEditorial: (id: string, payload?: { ratio?: Ratio; reportRel?: string; videoRel?: string }) =>
    req<{ job: JobRecord }>(`/api/projects/${encodeURIComponent(id)}/analyze-editorial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    }),
  getEditorBinding: (id: string, ratio: Ratio) =>
    req<{ binding: EditorBindingStatusDto; qa: ReviewStateDto }>(
      `/api/projects/${encodeURIComponent(id)}/editor-binding?ratio=${encodeURIComponent(ratio)}`,
    ),
  getMotionCapability: (id: string, ratio: Ratio) =>
    req<{
      projectId: string;
      ratio: Ratio;
      engineVersion: string;
      motionSchema: string;
      motionEngineMode: 'legacy_stance' | 'articulated_v1' | 'articulated_verified';
      motionQcVerified: boolean;
      motionQcStatus: QaTechnicalVerdict;
      motionQcSummary: Record<string, unknown> | null;
      supportedPresets: string[];
      supportedCameraPresets: string[];
      supportedVisualBeats: string[];
    }>(`/api/projects/${encodeURIComponent(id)}/motion-capability?ratio=${encodeURIComponent(ratio)}`),
  synthesizeLocalVoice: (id: string, payload?: { voiceHint?: string; rate?: number; filename?: string }) =>
    req<{
      voice: { path: string; sha256: string; duration: number; voiceName: string; revision: number };
      qa: ReviewStateDto;
      project: ProjectDetailDto;
    }>(`/api/projects/${encodeURIComponent(id)}/voice/synthesize-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    }),
  runPreflight: (id: string) =>
    req<{ job: JobRecord }>(`/api/projects/${encodeURIComponent(id)}/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  runValidate: (id: string, ratio: Ratio) =>
    req<{ job: JobRecord }>(`/api/projects/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratio }),
    }),
  runDraft: (id: string, payload: { ratio: Ratio; draftScale: 0.5 | 0.75; start: number; seconds?: number; trustedCode: boolean }) =>
    req<{ job: JobRecord }>(`/api/projects/${encodeURIComponent(id)}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  runPreview: (id: string, payload: { ratio: Ratio; start: number; seconds?: number; trustedCode: boolean }) =>
    req<{ job: JobRecord }>(`/api/projects/${encodeURIComponent(id)}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  runReviewPack: (id: string, payload: { ratio: Ratio; reportRel: string; previousReviewRel?: string }) =>
    req<{ job: JobRecord }>(`/api/projects/${encodeURIComponent(id)}/review-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  runCheckReview: (id: string, payload: { ratio: Ratio; reviewRel: string; reportRel?: string }) =>
    req<{ job: JobRecord }>(`/api/projects/${encodeURIComponent(id)}/check-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  runApprove: (id: string, payload: { ratio: Ratio; reportRel: string; reviewRel: string; note: string }) =>
    req<{ job: JobRecord }>(`/api/projects/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  runRender: (id: string, payload: { ratio: Ratio; trustedCode: boolean }) =>
    req<{ job: JobRecord }>(`/api/projects/${encodeURIComponent(id)}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  listJobs: (projectId?: string) =>
    req<{ jobs: JobRecord[] }>(projectId ? `/api/jobs?projectId=${encodeURIComponent(projectId)}` : '/api/jobs'),
  getJob: (jobId: string) => req<{ job: JobRecord; logs: string[] }>(`/api/jobs/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId: string) => req<{ job: JobRecord }>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
};
