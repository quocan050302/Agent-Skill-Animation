import { z } from 'zod';

export const RatioSchema = z.enum(['9:16', '16:9']);
export type Ratio = z.infer<typeof RatioSchema>;

export const InitRatioSchema = z.enum(['9:16', '16:9', 'both']);
export type InitRatio = z.infer<typeof InitRatioSchema>;

export const AssetRoleSchema = z.enum([
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
  'audio_narration',
  'audio_sfx',
  'audio_bgm',
]);
export type AssetRole = z.infer<typeof AssetRoleSchema>;

export const AssetClassificationSchema = z.enum(['PRODUCTION ASSET', 'REFERENCE ONLY']);
export type AssetClassification = z.infer<typeof AssetClassificationSchema>;

export const CameraKeyframeSchema = z.object({
  t: z.number().finite().min(0),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  fov: z.number().finite().min(20).max(100),
  yaw: z.number().finite().optional(),
  pitch: z.number().finite().optional(),
});
export type CameraKeyframe = z.infer<typeof CameraKeyframeSchema>;

export const StagingCoordSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
export type StagingCoord = z.infer<typeof StagingCoordSchema>;

export const ShotEasingSchema = z.enum(['smooth', 'linear', 'ease_in', 'ease_out', 'hold']);
export type ShotEasing = z.infer<typeof ShotEasingSchema>;

export const ActorPoseStateSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().finite().positive().default(1),
  headAngleDeg: z.number().finite().min(-20).max(20).default(0),
  leftArmAction: z.enum(['rest', 'reach', 'offer', 'point']).default('rest'),
  leftArmPhase: z.number().finite().min(0).max(1).default(0.5),
  rightArmAction: z.enum(['rest', 'reach', 'offer', 'point']).default('rest'),
  rightArmPhase: z.number().finite().min(0).max(1).default(0.5),
  strideCycles: z.number().finite().min(0).default(0),
});
export type ActorPoseState = z.infer<typeof ActorPoseStateSchema>;

export const PropKeyframeSchema = z.object({
  propId: z.string().min(1).max(60),
  t: z.number().finite().min(0),
  x: z.number().finite(),
  y: z.number().finite(),
  angleDeg: z.number().finite().default(0),
  scale: z.number().finite().positive().default(1),
  holderActor: z.string().optional(),
  holderArm: z.enum(['left', 'right']).optional(),
  gripUv: z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]).optional(),
});
export type PropKeyframe = z.infer<typeof PropKeyframeSchema>;

export const MotionModeSchema = z.enum(['legacy_stance', 'articulated_v1']);
export type MotionMode = z.infer<typeof MotionModeSchema>;

export const MotionPresetSchema = z.enum([
  'none',
  'idle',
  'anticipate',
  'walk',
  'run',
  'dash',
  'stop',
  'turn',
  'react',
  'recover',
]);
export type MotionPreset = z.infer<typeof MotionPresetSchema>;

export const VisualBeatKindSchema = z.enum(['hook', 'surprise', 'action', 'escalation', 'payoff']);
export type VisualBeatKind = z.infer<typeof VisualBeatKindSchema>;

export const CameraPresetSchema = z.enum([
  'establish',
  'follow',
  'reaction_closeup',
  'object_insert',
  'impact',
  'settle',
]);
export type CameraPreset = z.infer<typeof CameraPresetSchema>;

export const GaitParamsSchema = z.object({
  cadenceHz: z.number().finite().positive().max(8).default(2.0),
  strideLen: z.number().finite().positive().max(400).default(110),
  footLift: z.number().finite().min(0).max(160).default(28),
  targetSpeed: z.number().finite().min(0).max(1500).default(0),
  pelvisDrop: z.number().finite().min(0).max(60).default(4),
  armSwingAmp: z.number().finite().min(0).max(1.5).default(0.32),
  anticipateS: z.number().finite().min(0).max(2).default(0.16),
  settleS: z.number().finite().min(0).max(2).default(0.18),
  stepCountOverride: z.number().int().min(2).max(40).optional(),
  facing: z.union([z.literal(1), z.literal(-1)]).default(1),
});
export type GaitParams = z.infer<typeof GaitParamsSchema>;

export const ContactEventSchema = z.object({
  id: z.string().min(1).max(60),
  t0: z.number().finite().min(0),
  t1: z.number().finite().positive(),
  side: z.enum(['left', 'right', 'both']).default('both'),
  kind: z.enum(['foot_plant', 'prop_grab', 'prop_release', 'impact']).default('foot_plant'),
  targetX: z.number().finite().default(0),
  targetY: z.number().finite().default(0),
}).refine((e) => e.t1 > e.t0, {
  message: 'ContactEvent yêu cầu t1 > t0',
});
export type ContactEvent = z.infer<typeof ContactEventSchema>;

export const ShotMotionSchema = z.object({
  mode: MotionModeSchema.default('articulated_v1'),
  preset: MotionPresetSchema.default('idle'),
  startX: z.number().finite().default(0),
  endX: z.number().finite().default(0),
  startY: z.number().finite().default(0),
  endY: z.number().finite().default(0),
  gait: GaitParamsSchema.optional(),
  contacts: z.array(ContactEventSchema).optional(),
  cameraPreset: CameraPresetSchema.optional(),
  visualBeat: VisualBeatKindSchema.optional(),
  headVariant: z.string().optional(),
});
export type ShotMotionSpec = z.infer<typeof ShotMotionSchema>;

export const DirectorBeatSchema = z.object({
  id: z.string().min(1).max(60),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  beatKind: VisualBeatKindSchema,
  cameraPreset: CameraPresetSchema.default('establish'),
  purpose: z.string().min(1),
  payoff: z.string().optional(),
}).refine((b) => b.end > b.start, {
  message: 'DirectorBeat yêu cầu end > start',
});
export type DirectorBeat = z.infer<typeof DirectorBeatSchema>;

export const EditorialModeSchema = z.enum(['none', 'editorial_v1']);
export type EditorialMode = z.infer<typeof EditorialModeSchema>;

export const EditorialRoleSchema = z.enum([
  'hook',
  'anticipation',
  'escalation',
  'reveal',
  'threat',
  'prop_insert',
  'chase',
  'impact',
  'reaction',
  'reversal',
  'payoff',
  'exit',
]);
export type EditorialRole = z.infer<typeof EditorialRoleSchema>;

export const EditorialShotSizeSchema = z.enum([
  'extreme_close',
  'close',
  'medium',
  'wide',
  'insert',
]);
export type EditorialShotSize = z.infer<typeof EditorialShotSizeSchema>;

export const EditorialCameraMovementSchema = z.enum([
  'hold',
  'track',
  'push',
  'pull',
  'whip_with_subject',
  'follow_prop',
]);
export type EditorialCameraMovement = z.infer<typeof EditorialCameraMovementSchema>;

export const EditorialTransitionKindSchema = z.enum([
  'hard_cut',
  'match_action_cut',
  'motivated_whip',
  'hold',
]);
export type EditorialTransitionKind = z.infer<typeof EditorialTransitionKindSchema>;

export const EditorialFocusTargetKindSchema = z.enum([
  'actor_head',
  'actor_eyes',
  'actor_hand',
  'actor_full',
  'prop',
  'action_group',
  'world_point',
]);
export type EditorialFocusTargetKind = z.infer<typeof EditorialFocusTargetKindSchema>;

export const EditorialIntensitySchema = z.enum(['low', 'normal', 'high']);
export type EditorialIntensity = z.infer<typeof EditorialIntensitySchema>;

export const EditorialPacingAdviceSchema = z.enum([
  'auto',
  'snappy',
  'hold_payoff',
  'tighten_cut',
  'contrast_angle',
  'keep',
]);
export type EditorialPacingAdvice = z.infer<typeof EditorialPacingAdviceSchema>;

export const EditorialFocusSchema = z.object({
  targetKind: EditorialFocusTargetKindSchema.default('actor_full'),
  actorId: z.string().max(80).default(''),
  propId: z.string().max(80).default(''),
  offsetXy: z.tuple([z.number().finite(), z.number().finite()]).default([0, 0]),
  scaleHint: z.number().finite().min(0.4).max(3.5).default(1),
  safeMargin: z.number().finite().min(0.02).max(0.3).default(0.08),
});
export type EditorialFocus = z.infer<typeof EditorialFocusSchema>;

export const EditorialTransitionSchema = z.object({
  kind: EditorialTransitionKindSchema.default('hard_cut'),
  durationS: z.number().finite().min(0).max(2).default(0),
  reason: z.string().max(500).default(''),
  preserveEyeline: z.boolean().default(true),
  matchAction: z.boolean().default(false),
});
export type EditorialTransition = z.infer<typeof EditorialTransitionSchema>;

export const EditorialRuleSchema = z.object({
  minHoldS: z.number().finite().min(0.1).max(3).default(0.35),
  maxAngularVelDegS: z.number().finite().min(5).max(360).default(90),
  maxCamSpeedPxS: z.number().finite().min(50).max(5000).default(1150),
  maxCamAccelPxS2: z.number().finite().min(100).max(20000).default(4800),
  allowStrobe: z.literal(false).default(false),
  protectCaptionBand: z.boolean().default(true),
});
export type EditorialRule = z.infer<typeof EditorialRuleSchema>;

export const EditorialShotConfigSchema = z.object({
  role: EditorialRoleSchema.default('reveal'),
  shotSize: EditorialShotSizeSchema.default('medium'),
  focus: EditorialFocusSchema.default({}),
  cameraMovement: EditorialCameraMovementSchema.default('hold'),
  transition: EditorialTransitionSchema.default({}),
  intensity: EditorialIntensitySchema.default('normal'),
  pacingAdvice: EditorialPacingAdviceSchema.default('auto'),
  actionOnsetS: z.number().finite().min(0).optional(),
  reactionHoldS: z.number().finite().min(0).max(3).default(0),
  notes: z.string().max(1000).default(''),
});
export type EditorialShotConfig = z.infer<typeof EditorialShotConfigSchema>;

export const EditorialProfileSchema = z.object({
  schema: z.literal('b6-studio-editorial/1').default('b6-studio-editorial/1'),
  mode: EditorialModeSchema.default('editorial_v1'),
  rules: EditorialRuleSchema.default({}),
});
export type EditorialProfile = z.infer<typeof EditorialProfileSchema>;

export const SemanticModeSchema = z.enum(['none', 'semantic_v1']);
export type SemanticMode = z.infer<typeof SemanticModeSchema>;

export const HeadMountStateSchema = z.enum(['attached', 'detaching', 'detached', 'reattaching']);
export type HeadMountState = z.infer<typeof HeadMountStateSchema>;

export const SemanticEvidenceRequirementsSchema = z
  .object({
    minActorVisible: z.number().finite().min(0).max(1).optional(),
    minPropVisible: z.number().finite().min(0).max(1).optional(),
    requiresVisibility: z.boolean().optional(),
    requiresPropVisibility: z.boolean().optional(),
    requiresTrajectory: z.boolean().optional(),
    requiresPropTrajectory: z.boolean().optional(),
    requiresPoseChange: z.boolean().optional(),
    requiresContact: z.boolean().optional(),
    requiresOcclusion: z.boolean().optional(),
    requiresAvoidance: z.boolean().optional(),
    requiresBounce: z.boolean().optional(),
    requiresRotation: z.boolean().optional(),
    requiresDetach: z.boolean().optional(),
    requiresReattach: z.boolean().optional(),
    requiresCollision: z.boolean().optional(),
    requiresReaction: z.boolean().optional(),
    minDisplacementPx: z.number().finite().min(0).optional(),
    minPropDisplacementPx: z.number().finite().min(0).optional(),
    minPropDyPx: z.number().finite().min(0).optional(),
    minPropRotationDeg: z.number().finite().min(0).optional(),
    minSpeedPxS: z.number().finite().min(0).optional(),
    maxContactPx: z.number().finite().min(0).optional(),
    maxCollisionGapPx: z.number().finite().min(0).optional(),
    minOcclusionRatio: z.number().finite().min(0).max(1).optional(),
    minHeadAngleDeltaDeg: z.number().finite().min(0).optional(),
    minCentroidShiftPx: z.number().finite().min(0).optional(),
    minCentroidYDropPx: z.number().finite().min(0).optional(),
    minBboxAspectDelta: z.number().finite().min(0).optional(),
    minDetachSeparationPx: z.number().finite().min(0).optional(),
    maxMountGapPx: z.number().finite().min(0).optional(),
    expectedOrientation: z.string().max(40).optional(),
    expectedHeadVariant: z.string().max(80).optional(),
  })
  .passthrough();
export type SemanticEvidenceRequirements = z.infer<typeof SemanticEvidenceRequirementsSchema>;

export const SemanticActionSpecSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_:-]+$/),
  shotId: z.string().max(80).optional(),
  actionType: z.string().min(1).max(60),
  actorId: z.string().min(1).max(80),
  targetPropId: z.string().max(80).optional(),
  occluderId: z.string().max(80).optional(),
  partId: z.string().max(60).optional(),
  startS: z.number().finite().min(0).optional(),
  endS: z.number().finite().positive().optional(),
  prerequisiteIds: z.array(z.string().max(80)).default([]),
  expectedOrientation: z.string().max(40).optional(),
  expectedHeadVariant: z.string().max(80).optional(),
  initiallyDetached: z.boolean().optional(),
  initiallyHeld: z.boolean().optional(),
  optionalReview: z.boolean().optional(),
  notes: z.string().max(500).default(''),
  evidenceRequirements: SemanticEvidenceRequirementsSchema.optional(),
});
export type SemanticActionSpec = z.infer<typeof SemanticActionSpecSchema>;

export const ShotItemSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  actor: z.string().default(''),
  environment: z.string().default(''),
  sceneGoal: z.string().default(''),
  composition: z.string().min(1),
  action: z.string().min(1),
  expression: z.string().default('neutral'),
  props: z.array(z.string()).default([]),
  staging: z.record(z.string(), StagingCoordSchema).default({}),
  camera: z.string().min(1),
  cameraKeys: z.array(CameraKeyframeSchema).default([
    { t: 0, x: 0, y: -210, z: 0, fov: 55 },
  ]),
  easing: ShotEasingSchema.optional(),
  actorStart: ActorPoseStateSchema.optional(),
  actorEnd: ActorPoseStateSchema.optional(),
  propKeyframes: z.array(PropKeyframeSchema).optional(),
  motionMode: MotionModeSchema.optional(),
  motion: ShotMotionSchema.optional(),
  cameraPreset: CameraPresetSchema.optional(),
  visualBeat: VisualBeatKindSchema.optional(),
  editorial: EditorialShotConfigSchema.optional(),
  semanticActions: z.array(SemanticActionSpecSchema).optional(),
  transition: z.string().min(1),
  short_cut_reason: z.string().optional(),
  asset_inputs: z.array(z.string()).default([]),
  sfx: z.string().default(''),
});
export type ShotItem = z.infer<typeof ShotItemSchema>;

export const CaptionCueSchema = z.object({
  id: z.string().optional(),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  text: z.string().min(1).refine((v) => !/[\r\n]/.test(v), {
    message: 'Caption phải là 1 dòng duy nhất (single-line semantic cue)',
  }),
});
export type CaptionCue = z.infer<typeof CaptionCueSchema>;

export const StoryBeatSchema = z.object({
  id: z.string().optional(),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  action: z.string().min(1),
  cause: z.string().optional(),
  payoff: z.string().optional(),
});
export type StoryBeat = z.infer<typeof StoryBeatSchema>;

export const CastInventoryItemSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  shot_ids: z.array(z.string().min(1)).min(1),
});
export type CastInventoryItem = z.infer<typeof CastInventoryItemSchema>;

export const CreateProjectInputSchema = z.object({
  title: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  brief: z.string().max(2000).default(''),
  ratio: InitRatioSchema.default('9:16'),
  language: z.string().min(2).max(20).default('en'),
  targetDuration: z.number().finite().min(1).max(180).default(10),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const PatchProjectInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative().optional(),
  title: z.string().min(1).max(120).optional(),
  premise: z.string().max(2000).optional(),
  hook: z.string().max(500).optional(),
  narration: z.string().max(10000).optional(),
  duration: z.number().finite().positive().max(180).nullable().optional(),
  stage: z.enum(['needs_authoring', 'authored']).optional(),
  activeRatio: RatioSchema.optional(),
  beats: z.array(StoryBeatSchema).optional(),
  directorBeats: z.array(DirectorBeatSchema).optional(),
  motionMode: MotionModeSchema.optional(),
  editorialMode: EditorialModeSchema.optional(),
  editorialProfile: EditorialProfileSchema.optional(),
  semanticMode: SemanticModeSchema.optional(),
  semanticActions: z.array(SemanticActionSpecSchema).optional(),
  shots: z.array(ShotItemSchema).optional(),
  captions: z.array(CaptionCueSchema).optional(),
  castInventory: z.array(CastInventoryItemSchema).optional(),
  nativeLayoutReason: z.string().max(1000).optional(),
  requestSceneSyncNote: z.string().max(1000).optional(),
});
export type PatchProjectInput = z.infer<typeof PatchProjectInputSchema>;

export const AssetBriefInputSchema = z.object({
  title: z.string().min(1).max(120),
  role: AssetRoleSchema,
  actorId: z.string().max(60).optional(),
  viewId: z.enum(['front', 'three_quarter', 'side', 'back']).optional(),
  expressionId: z.string().max(60).optional(),
  shotId: z.string().max(80).optional(),
  eraAndSetting: z.string().min(1).max(500),
  visualDescription: z.string().min(1).max(2000),
  requireAlpha: z.boolean().default(true),
  targetWidth: z.number().int().min(64).max(4096).default(1024),
  targetHeight: z.number().int().min(64).max(4096).default(1024),
});
export type AssetBriefInput = z.infer<typeof AssetBriefInputSchema>;

export const AssetRecordSchema = z.object({
  id: z.string(),
  filename: z.string(),
  relativePath: z.string(),
  role: AssetRoleSchema,
  classification: AssetClassificationSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  hasAlpha: z.boolean().optional(),
  transparentExterior: z.boolean().optional(),
  alphaBbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
  actorId: z.string().optional(),
  viewId: z.string().optional(),
  expressionId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  provenance: z.object({
    source: z.enum(['anti_image_gen', 'user_upload', 'inbox_import', 'local_synth']),
    tool: z.string(),
    prompt: z.string().optional(),
    createdAt: z.string(),
    notes: z.string().optional(),
  }),
});
export type AssetRecord = z.infer<typeof AssetRecordSchema>;

export const JobKindSchema = z.enum([
  'doctor',
  'preflight',
  'validate',
  'draft',
  'preview',
  'analyze-editorial',
  'analyze-semantic',
  'review-pack',
  'check-review',
  'approve',
  'render',
]);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobRecordSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  kind: JobKindSchema,
  ratio: RatioSchema.optional(),
  status: JobStatusSchema,
  stageLabel: z.string(),
  commandDisplay: z.string(),
  cwd: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  elapsedMs: z.number().nonnegative(),
  exitCode: z.number().int().nullable(),
  frameProgress: z.object({
    checkedFrame: z.number().int().nonnegative(),
    totalFrames: z.number().int().positive(),
  }).nullable(),
  outputDir: z.string().nullable(),
  reportPath: z.string().nullable(),
  videoPath: z.string().nullable(),
  resultJson: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const QaTechnicalVerdictSchema = z.enum(['pass', 'fail', 'pending', 'stale']);
export type QaTechnicalVerdict = z.infer<typeof QaTechnicalVerdictSchema>;

export const QaVisualVerdictSchema = z.enum(['pass', 'needs_repair', 'pending', 'stale']);
export type QaVisualVerdict = z.infer<typeof QaVisualVerdictSchema>;

export const QaApprovalVerdictSchema = z.enum(['approved', 'rejected', 'pending', 'stale']);
export type QaApprovalVerdict = z.infer<typeof QaApprovalVerdictSchema>;

export const EditorSyncStateSchema = z.enum([
  'not_authored',
  'bound_current',
  'applied_to_renderer',
  'preview_stale',
  'voice_needs_regeneration',
  'manual_scene_only',
]);
export type EditorSyncState = z.infer<typeof EditorSyncStateSchema>;

export const CanonicalScenePlanSchema = z.object({
  schema: z.literal('b6-studio-scene-control/1'),
  revision: z.number().int().nonnegative(),
  ratio: RatioSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.literal(30),
  duration: z.number().finite().positive(),
  narration: z.string(),
  voice_sha256: z.string().nullable(),
  narration_sha256: z.string(),
  voice_stale: z.boolean(),
  motionMode: MotionModeSchema.optional(),
  editorialMode: EditorialModeSchema.optional(),
  editorialProfile: EditorialProfileSchema.optional(),
  semanticMode: SemanticModeSchema.optional(),
  semanticActions: z.array(SemanticActionSpecSchema).optional(),
  directorBeats: z.array(DirectorBeatSchema).optional(),
  shots: z.array(ShotItemSchema),
  captions: z.array(CaptionCueSchema),
  updatedAt: z.string(),
});
export type CanonicalScenePlan = z.infer<typeof CanonicalScenePlanSchema>;

export const QaEvidenceSummarySchema = z.object({
  technicalStatus: QaTechnicalVerdictSchema,
  visualReviewStatus: QaVisualVerdictSchema,
  userApprovalStatus: QaApprovalVerdictSchema,
  motionQcStatus: QaTechnicalVerdictSchema.optional(),
  motionQcSummary: z.record(z.string(), z.unknown()).optional(),
  editorialQcStatus: QaTechnicalVerdictSchema.optional(),
  editorialQcSummary: z.record(z.string(), z.unknown()).optional(),
  semanticQcStatus: QaTechnicalVerdictSchema.optional(),
  semanticQcSummary: z.record(z.string(), z.unknown()).optional(),
  reasonCodes: z.array(z.string()),
  staleReasons: z.array(z.string()),
  blockingReasons: z.array(z.string()),
  currentSourceFingerprint: z.string().nullable(),
  previewFingerprint: z.string().nullable(),
  previewSha256: z.string().nullable(),
  reviewSha256: z.string().nullable(),
  verifiedAt: z.string(),
  voiceStale: z.boolean(),
  editorSyncState: EditorSyncStateSchema,
  renderUnlocked: z.boolean(),
  evidenceLinks: z.array(z.object({ label: z.string(), path: z.string(), status: z.string() })),
});
export type QaEvidenceSummary = z.infer<typeof QaEvidenceSummarySchema>;

export function migrateShotToEditorial(shot: ShotItem): ShotItem {
  if (shot.editorial) return shot;
  const presetToSize: Record<string, EditorialShotSize> = {
    establish: 'wide',
    follow: 'medium',
    reaction_closeup: 'close',
    object_insert: 'insert',
    impact: 'medium',
    settle: 'medium',
  };
  const presetToMove: Record<string, EditorialCameraMovement> = {
    establish: 'hold',
    follow: 'track',
    reaction_closeup: 'push',
    object_insert: 'follow_prop',
    impact: 'push',
    settle: 'pull',
  };
  const cp = shot.cameraPreset ?? shot.motion?.cameraPreset ?? 'establish';
  const vb = shot.visualBeat ?? shot.motion?.visualBeat ?? 'escalation';
  const role: EditorialRole =
    vb === 'hook'
      ? 'hook'
      : vb === 'surprise'
      ? 'reveal'
      : vb === 'payoff'
      ? 'payoff'
      : cp === 'object_insert'
      ? 'prop_insert'
      : cp === 'reaction_closeup'
      ? 'reaction'
      : 'escalation';

  const ed = EditorialShotConfigSchema.parse({
    role,
    shotSize: presetToSize[cp] ?? 'medium',
    focus: {
      targetKind: cp === 'object_insert' && shot.props.length > 0 ? 'prop' : cp === 'reaction_closeup' && shot.actor ? 'actor_head' : shot.actor ? 'actor_full' : 'world_point',
      actorId: shot.actor ?? '',
      propId: shot.props[0] ?? '',
    },
    cameraMovement: presetToMove[cp] ?? 'hold',
    transition: {
      kind: 'hard_cut',
      reason: shot.short_cut_reason ?? shot.transition ?? '',
    },
  });
  return { ...shot, editorial: ed };
}

export function migrateCanonicalPlanToEditorial(plan: CanonicalScenePlan): CanonicalScenePlan {
  if (plan.editorialMode === 'editorial_v1') return plan;
  return CanonicalScenePlanSchema.parse({
    ...plan,
    editorialMode: 'editorial_v1',
    editorialProfile: EditorialProfileSchema.parse({}),
    shots: plan.shots.map(migrateShotToEditorial),
  });
}
