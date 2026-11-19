export interface AspectRatioSpec {
  id: '9:16' | '1:1' | '16:9';
  label: string;
  width: number;
  height: number;
  fps: number;
  supported: boolean;
  status: 'SUPPORTED' | 'DISABLED';
  reason: string;
}

export interface VoiceOption {
  id: string;
  label: string;
  isDefault: boolean;
  notes: string;
}

export interface StoryShot {
  id: string;
  a: number;
  b: number;
  light?: string;
}

export interface AudioArtifactMeta {
  audioId: string;
  projectId: string;
  kind: string;
  provider: string;
  model?: string;
  voice?: string;
  originalFilename?: string;
  sourceFormat?: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  byteSize: number;
  sha256: string;
  audioUrl: string;
  createdAt: string;
}

export interface TimingWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface TimingSummary {
  timingId: string;
  audioId: string;
  audioDurationSec: number;
  targetDurationSec: number;
  expectedFrames: number;
  durationDeltaSec: number;
  overflow: boolean;
  alignmentPrecision: string;
  syncVerification: string;
  wordCount: number;
  phraseCount: number;
  segmentCount: number;
  wordsPerSec: number;
  valid: boolean;
  warnings: TimingWarning[];
  words: Array<{ w: string; s: number; e: number }>;
  phrases: Array<{ text: string; s: number; e: number }>;
  generatedAt: string;
}

export interface ExportMeta {
  exportId: string;
  jobId: string;
  projectId: string;
  inputSpecHash: string;
  sha256: string;
  byteSize: number;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  captionsEnabled: boolean;
  aspectRatio: string;
  qaStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNVERIFIED';
  downloadUrl: string;
  qaUrl: string;
  contactSheetUrl: string;
  subCheckUrl: string;
  createdAt: string;
}

export interface StudioProject {
  schemaVersion: number;
  projectId: string;
  title: string;
  scriptText: string;
  narrationSource: 'tts' | 'import';
  voiceId: string;
  ttsModel: string;
  sourceAudioId: string | null;
  sourceAudioMeta: AudioArtifactMeta | null;
  importedAudioId: string | null;
  importedAudioMeta: AudioArtifactMeta | null;
  ttsAudioId: string | null;
  ttsAudioMeta: AudioArtifactMeta | null;
  aspectRatio: '9:16' | '1:1' | '16:9';
  captionsEnabled: boolean;
  captionStyle: string;
  language: string;
  punchWords: string[];
  storyId: string;
  totalFrames: number;
  expectedDurationSec: number;
  shots: StoryShot[];
  engineReady: boolean;
  engineUrl: string | null;
  parityBaseline: boolean;
  protected: boolean;
  inputSpecHash: string;
  latestTiming: TimingSummary | null;
  exports: ExportMeta[];
  createdAt: string;
  updatedAt: string;
}

export interface RenderJob {
  jobId: string;
  projectId: string;
  storyId: string;
  inputSpecHash: string;
  stage: string;
  status: string;
  progressPct: number;
  frameCount: number;
  framesDone: number;
  captionsEnabled: boolean;
  aspectRatio: string;
  exportId: string | null;
  exportMeta: ExportMeta | null;
  error: string | null;
  errorCode: string | null;
  logs: Array<{ at: string; stage: string; message: string }>;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface QaGateItem {
  id: string;
  title: string;
  severity: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNVERIFIED';
  testedAt: string;
  message: string;
}

export interface ExportQaReport {
  evaluatedAt: string;
  projectId: string;
  jobId: string;
  overallStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNVERIFIED';
  humanSubjectiveReview: string;
  captionsEnabled: boolean;
  aspectRatio: string;
  mp4Probe: {
    valid: boolean;
    sha256: string;
    byteSize: number;
    durationSec: number;
    video: {
      codec: string;
      width: number;
      height: number;
      pixFmt: string;
      rFrameRate: string;
      nbFrames: number;
    };
    audio: {
      codec: string;
      sampleRate: number;
      channels: number;
      integratedLufs: number | null;
      truePeakDbfs: number | null;
    } | null;
    fastStart: { fastStartVerified: boolean };
    blackEvents: Array<{ start: number; end: number }>;
    freezeEvents: number[];
  };
  gates: QaGateItem[];
}

export interface SubtitleCuePreview {
  active: boolean;
  chunkIndex: number;
  hero?: boolean;
  words: Array<{
    text: string;
    line: number;
    active: boolean;
    spokenPunch: boolean;
    isPunch: boolean;
  }>;
  safeZone: { marginV: number; playResX: number; playResY: number };
}

export interface HealthResponse {
  ok: boolean;
  nodeVersion: string;
  freeDiskMb: number;
  kitReady: boolean;
  g03RedistributionStatus: string;
  ffmpegLibassAvailable: boolean;
  tts: {
    provider: string;
    hasKey: boolean;
    keySource: string;
    maskedKey: string;
    defaultVoice: string;
    status: string;
  };
}

export interface TtsSettingsView {
  provider: string;
  hasKey: boolean;
  keySource: string;
  maskedKey: string;
  selectionMode: 'auto' | 'manual';
  modelPolicy: 'quality' | 'balanced' | 'fast';
  includePreview: boolean;
  ttsModel: string;
  defaultVoice: string;
}

export interface ContractResponse {
  aspectRatios: AspectRatioSpec[];
  voices: VoiceOption[];
  jobStages: string[];
}
