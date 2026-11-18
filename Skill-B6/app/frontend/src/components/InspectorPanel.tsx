import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Code2, Copy, FolderOpen, Play, Plus, RefreshCw, ShieldAlert, Trash2, Undo2, Save } from 'lucide-react';
import type {
  ActorPoseState,
  CameraPreset,
  CaptionCue,
  JobRecord,
  MotionPreset,
  PropKeyframe,
  Ratio,
  ShotEasing,
  ShotItem,
  ShotMotionSpec,
  VisualBeatKind,
} from '@b6-studio/shared';
import type {
  CharacterActorDto,
  EditorBindingStatusDto,
  OutputArtifactDto,
  ProjectDetailDto,
  ReviewStateDto,
} from '../api/client';

export type InspectorTab = 'story' | 'shot' | 'camera' | 'character' | 'export';

interface InspectorPanelProps {
  project: ProjectDetailDto;
  activeTab: InspectorTab;
  onChangeTab: (tab: InspectorTab) => void;
  titleDraft: string;
  onChangeTitle: (v: string) => void;
  premiseDraft: string;
  onChangePremise: (v: string) => void;
  hookDraft: string;
  onChangeHook: (v: string) => void;
  narrationDraft: string;
  onChangeNarration: (v: string) => void;
  durationDraft: number;
  onChangeDuration: (v: number) => void;
  shots: ShotItem[];
  selectedShotIndex: number;
  onSelectShot: (idx: number) => void;
  onUpdateShot: (idx: number, next: ShotItem) => void;
  onDuplicateShot: (idx: number) => void;
  onDeleteShot: (idx: number) => void;
  captions: CaptionCue[];
  onChangeCaptions: (next: CaptionCue[]) => void;
  nativeLayoutReason: string;
  onChangeNativeLayoutReason: (v: string) => void;
  saveStatus: 'saved' | 'saving' | 'dirty' | 'error';
  saveError: string | null;
  validationErrors: string[];
  canUndo: boolean;
  onUndo: () => void;
  onForceSave: () => void;
  onRequestSceneSync: (note: string) => Promise<void>;
  onSaveScenePy: (content: string) => Promise<void>;
  characters: CharacterActorDto[];
  latestPreflight: Record<string, unknown> | null;
  onRunPreflight: () => Promise<void>;
  onUpdateRig: (actorId: string, viewId: string, patch: Record<string, unknown>) => Promise<void>;
  outputs: OutputArtifactDto[];
  reviewState: ReviewStateDto | null;
  editorBinding?: EditorBindingStatusDto | null;
  onSynthesizeLocalVoice?: (opts?: { voiceHint?: string }) => Promise<void>;
  onVerifyChanges?: () => Promise<void>;
  onReloadConflict?: () => Promise<void>;
  trustedCode: boolean;
  onToggleTrustedCode: (v: boolean) => void;
  onRunValidate: () => Promise<void>;
  onRunDraft: (scale: 0.5 | 0.75) => Promise<void>;
  onRunPreview: () => Promise<void>;
  onRunReviewPack: (reportRel: string) => Promise<void>;
  onRunCheckReview: (reviewRel: string, reportRel?: string) => Promise<void>;
  onRunApprove: (reportRel: string, reviewRel: string, note: string) => Promise<void>;
  onRunRender: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  activeJob: JobRecord | null;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  project,
  activeTab,
  onChangeTab,
  titleDraft,
  onChangeTitle,
  premiseDraft,
  onChangePremise,
  hookDraft,
  onChangeHook,
  narrationDraft,
  onChangeNarration,
  durationDraft,
  onChangeDuration,
  shots,
  selectedShotIndex,
  onUpdateShot,
  onDuplicateShot,
  onDeleteShot,
  captions,
  onChangeCaptions,
  nativeLayoutReason,
  onChangeNativeLayoutReason,
  saveStatus,
  saveError,
  validationErrors,
  canUndo,
  onUndo,
  onForceSave,
  onRequestSceneSync,
  onSaveScenePy,
  characters,
  latestPreflight,
  onRunPreflight,
  onUpdateRig,
  outputs,
  reviewState,
  editorBinding,
  onSynthesizeLocalVoice,
  onVerifyChanges,
  onReloadConflict,
  trustedCode,
  onToggleTrustedCode,
  onRunValidate,
  onRunDraft,
  onRunPreview,
  onRunReviewPack,
  onRunCheckReview,
  onRunApprove,
  onRunRender,
  onOpenFolder,
  activeJob,
}) => {
  const ratio: Ratio = project.meta.activeRatio;
  const selectedShot = shots[selectedShotIndex] ?? null;

  const [syncNote, setSyncNote] = useState('');
  const [sceneCode, setSceneCode] = useState(project.scenePy);
  const [showSceneEditor, setShowSceneEditor] = useState(false);
  const [approvalNote, setApprovalNote] = useState('');
  const [confirmDeleteShot, setConfirmDeleteShot] = useState(false);

  const [rigActorIdx, setRigActorIdx] = useState(0);
  const [rigViewId, setRigViewId] = useState('three_quarter');
  const [headAnchorInput, setHeadAnchorInput] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);

  const defaultActorPose = (): ActorPoseState => ({
    x: 0,
    y: 0,
    scale: 1,
    headAngleDeg: 0,
    leftArmAction: 'rest',
    leftArmPhase: 0.5,
    rightArmAction: 'rest',
    rightArmPhase: 0.5,
    strideCycles: 0,
  });

  const syncModeBadge = () => {
    const st = editorBinding?.syncState ?? reviewState?.editorSyncState;
    if (st === 'applied_to_renderer') return <span className="badge badge-success">Applied to renderer</span>;
    if (st === 'bound_current') return <span className="badge badge-success">Bound</span>;
    if (st === 'preview_stale') return <span className="badge badge-warning">Preview stale</span>;
    if (st === 'voice_needs_regeneration') return <span className="badge badge-warning">Voice stale</span>;
    if (st === 'manual_scene_only') return <span className="badge badge-neutral">Manual scene</span>;
    return <span className="badge badge-neutral">Editable</span>;
  };

  const busy = Boolean(activeJob && (activeJob.status === 'running' || activeJob.status === 'queued'));

  const saveBadge = () => {
    if (saveStatus === 'saving') return <span className="badge badge-warning">Đang lưu...</span>;
    if (saveStatus === 'dirty') return <span className="badge badge-warning">Chưa lưu</span>;
    if (saveStatus === 'error') return <span className="badge badge-danger">Lỗi lưu</span>;
    return <span className="badge badge-success">Đã lưu</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="inspector-tabs" role="tablist" aria-label="Inspector Tabs">
        {(
          [
            ['story', 'Story'],
            ['shot', 'Shot'],
            ['camera', 'Camera'],
            ['character', 'Character'],
            ['export', 'Export'],
          ] as Array<[InspectorTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`tab-btn ${activeTab === id ? 'active' : ''}`}
            onClick={() => onChangeTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Save Toolbar */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          background: 'var(--surface-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {saveBadge()}
          {syncModeBadge()}
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            rev {project.meta.revision ?? 1}
          </span>
          {canUndo && (
            <button type="button" className="btn btn-sm" onClick={onUndo} title="Hoàn tác thao tác gần nhất">
              <Undo2 size={13} />
              <span>Hoàn tác</span>
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {saveStatus === 'error' && onReloadConflict && (
            <button type="button" className="btn btn-sm" onClick={() => void onReloadConflict()}>
              <RefreshCw size={13} />
              <span>Tải lại</span>
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" onClick={onForceSave}>
            <Save size={13} />
            <span>Lưu (Ctrl+S)</span>
          </button>
        </div>
      </div>

      {saveError && (
        <div style={{ padding: '8px 16px', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12 }}>
          {saveError}
        </div>
      )}

      {validationErrors.length > 0 && (
        <div style={{ padding: '8px 16px', background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 12 }}>
          <strong>Cảnh báo timeline ({validationErrors.length}):</strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {validationErrors.slice(0, 4).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="inspector-content">
        {/* STORY TAB */}
        {activeTab === 'story' && (
          <>
            <label className="field">
              <span className="field-label">Tên dự án</span>
              <input
                className="input"
                aria-label="Tên dự án"
                value={titleDraft}
                onChange={(e) => onChangeTitle(e.target.value)}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="field">
                <span className="field-label">Thời lượng (giây)</span>
                <input
                  type="number"
                  step={0.5}
                  min={1}
                  max={180}
                  className="input"
                  value={durationDraft}
                  onChange={(e) => onChangeDuration(Number(e.target.value))}
                />
              </label>
              <div className="field">
                <span className="field-label">Stage</span>
                <div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-subtle)' }}>
                  {String(project.projectJson.stage ?? 'needs_authoring')}
                </div>
              </div>
            </div>

            <label className="field">
              <span className="field-label">Tiền đề / Premise</span>
              <textarea className="textarea" value={premiseDraft} onChange={(e) => onChangePremise(e.target.value)} />
            </label>

            <label className="field">
              <span className="field-label">Hook mở đầu</span>
              <input className="input" value={hookDraft} onChange={(e) => onChangeHook(e.target.value)} />
            </label>

            <div className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="field-label" style={{ margin: 0 }}>Lời thoại / Narration (story.json)</span>
                {editorBinding?.canSynthesizeLocalVoice && onSynthesizeLocalVoice && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={voiceBusy || busy || !narrationDraft.trim()}
                    onClick={async () => {
                      setVoiceBusy(true);
                      try {
                        await onSynthesizeLocalVoice({ voiceHint: 'David' });
                      } finally {
                        setVoiceBusy(false);
                      }
                    }}
                  >
                    <span>{voiceBusy ? 'Đang tạo WAV...' : 'Tạo Voice Local (SAPI)'}</span>
                  </button>
                )}
              </div>
              {reviewState?.voiceStale && (
                <div style={{ fontSize: 12, color: 'var(--warning)', background: 'var(--warning-soft)', padding: '6px 8px', borderRadius: 6, marginTop: 4 }}>
                  Lời thoại đã thay đổi sau audio gốc (<code>VOICE_NEEDS_REGENERATION</code>). Cần tạo lại Voice Local hoặc upload file WAV mới trước khi technical PASS được xác nhận.
                </div>
              )}
              <textarea
                className="textarea"
                aria-label="Lời thoại Narration"
                style={{ minHeight: 110, marginTop: 4 }}
                value={narrationDraft}
                onChange={(e) => onChangeNarration(e.target.value)}
              />
              <span className="field-hint">
                B6 yêu cầu phụ đề ghép lại phải khớp chính xác lời thoại gốc (original-speed voice-led timing).
              </span>
            </div>

            {ratio === '16:9' && (
              <label className="field">
                <span className="field-label">Lý do bố cục 16:9 (native_layout_reason)</span>
                <input
                  className="input"
                  value={nativeLayoutReason}
                  onChange={(e) => onChangeNativeLayoutReason(e.target.value)}
                  placeholder="Bắt buộc với 16:9 theo contract B6"
                />
              </label>
            )}

            {/* Captions List */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span className="section-label" style={{ margin: 0 }}>Phụ đề ({captions.length} câu, 1 dòng)</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const lastEnd = captions.length > 0 ? captions[captions.length - 1].end : 0;
                    onChangeCaptions([
                      ...captions,
                      { start: Number(lastEnd.toFixed(2)), end: Number((lastEnd + 1.2).toFixed(2)), text: 'New caption line' },
                    ]);
                  }}
                >
                  <Plus size={13} />
                  <span>Thêm câu</span>
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {captions.map((c, idx) => (
                  <div key={idx} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="number"
                        step={0.1}
                        className="input"
                        style={{ width: 72, minHeight: 30, padding: '4px 6px' }}
                        value={c.start}
                        aria-label={`Caption ${idx + 1} start`}
                        onChange={(e) => {
                          const next = [...captions];
                          next[idx] = { ...c, start: Number(e.target.value) };
                          onChangeCaptions(next);
                        }}
                      />
                      <span style={{ color: 'var(--muted)' }}>→</span>
                      <input
                        type="number"
                        step={0.1}
                        className="input"
                        style={{ width: 72, minHeight: 30, padding: '4px 6px' }}
                        value={c.end}
                        aria-label={`Caption ${idx + 1} end`}
                        onChange={(e) => {
                          const next = [...captions];
                          next[idx] = { ...c, end: Number(e.target.value) };
                          onChangeCaptions(next);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ marginLeft: 'auto' }}
                        aria-label={`Xóa phụ đề ${idx + 1}`}
                        onClick={() => onChangeCaptions(captions.filter((_, j) => j !== idx))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <input
                      className="input"
                      style={{ minHeight: 32, padding: '4px 8px' }}
                      value={c.text}
                      aria-label={`Nội dung phụ đề ${idx + 1}`}
                      onChange={(e) => {
                        const next = [...captions];
                        next[idx] = { ...c, text: e.target.value.replace(/[\r\n]+/g, ' ') };
                        onChangeCaptions(next);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Scene Sync Request */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="section-label" style={{ margin: 0 }}>Yêu cầu Anti cập nhật scene.py</span>
              <span className="field-hint">
                Thay đổi thông số story/camera trong UI không tự động viết lại logic Python trong `scene.py`. Ghi chú yêu cầu tại đây hoặc chỉnh `scene.py` nâng cao.
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  value={syncNote}
                  onChange={(e) => setSyncNote(e.target.value)}
                  placeholder="VD: Cho nhân vật nâng khiên ở 5.3s..."
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!syncNote.trim()}
                  onClick={async () => {
                    await onRequestSceneSync(syncNote.trim());
                    setSyncNote('');
                  }}
                >
                  Gửi
                </button>
              </div>
              {project.sceneSyncRequests.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {project.sceneSyncRequests.slice(-3).map((r) => (
                    <div key={r.id}>• [{r.status}] {r.note}</div>
                  ))}
                </div>
              )}
              <button type="button" className="btn btn-sm" onClick={() => { setSceneCode(project.scenePy); setShowSceneEditor((v) => !v); }}>
                <Code2 size={14} />
                <span>{showSceneEditor ? 'Ẩn scene.py' : 'Mở scene.py nâng cao'}</span>
              </button>
              {showSceneEditor && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea
                    className="textarea"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 160 }}
                    value={sceneCode}
                    onChange={(e) => setSceneCode(e.target.value)}
                  />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void onSaveScenePy(sceneCode)}>
                    Lưu scene.py
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* SHOT TAB */}
        {activeTab === 'shot' && (
          <>
            {!selectedShot ? (
              <div className="field-hint">Chọn một shot trên timeline hoặc bấm “Thêm shot” để chỉnh sửa.</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <strong>Shot #{selectedShotIndex + 1}</strong>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-sm" onClick={() => onDuplicateShot(selectedShotIndex)} title="Nhân bản shot">
                      <Copy size={13} />
                    </button>
                    {confirmDeleteShot ? (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          setConfirmDeleteShot(false);
                          onDeleteShot(selectedShotIndex);
                        }}
                      >
                        Xác nhận xóa
                      </button>
                    ) : (
                      <button type="button" className="btn btn-sm" onClick={() => setConfirmDeleteShot(true)} title="Xóa shot">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <label className="field">
                  <span className="field-label">Mã phân cảnh (Shot ID)</span>
                  <input
                    className="input"
                    value={selectedShot.id}
                    onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, id: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '_') })}
                  />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label className="field">
                    <span className="field-label">In (s)</span>
                    <input
                      type="number"
                      step={0.1}
                      className="input"
                      value={selectedShot.start}
                      onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, start: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Out (s)</span>
                    <input
                      type="number"
                      step={0.1}
                      className="input"
                      value={selectedShot.end}
                      onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, end: Number(e.target.value) })}
                    />
                  </label>
                </div>

                <label className="field">
                  <span className="field-label">Nhân vật (Actor / Cast)</span>
                  <input
                    className="input"
                    value={selectedShot.actor}
                    onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, actor: e.target.value })}
                  />
                </label>

                <label className="field">
                  <span className="field-label">Bố cục (Composition)</span>
                  <textarea
                    className="textarea"
                    value={selectedShot.composition}
                    onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, composition: e.target.value })}
                  />
                </label>

                <label className="field">
                  <span className="field-label">Hành động (Action)</span>
                  <textarea
                    className="textarea"
                    value={selectedShot.action}
                    onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, action: e.target.value })}
                  />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label className="field">
                    <span className="field-label">Biểu cảm</span>
                    <input
                      className="input"
                      value={selectedShot.expression}
                      onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, expression: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Chuyển cảnh (Transition)</span>
                    <input
                      className="input"
                      value={selectedShot.transition}
                      onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, transition: e.target.value })}
                    />
                  </label>
                </div>

                {selectedShot.end - selectedShot.start < 0.9 && (
                  <label className="field">
                    <span className="field-label">Lý do cut nhanh (&lt;0.9s)</span>
                    <input
                      className="input"
                      value={selectedShot.short_cut_reason ?? ''}
                      onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, short_cut_reason: e.target.value })}
                    />
                  </label>
                )}

                <label className="field">
                  <span className="field-label">Easing chuyển động (scene_runtime)</span>
                  <select
                    className="select"
                    value={selectedShot.easing ?? 'smooth'}
                    onChange={(e) =>
                      onUpdateShot(selectedShotIndex, { ...selectedShot, easing: e.target.value as ShotEasing })
                    }
                  >
                    <option value="smooth">smooth (Cubic Smoothstep)</option>
                    <option value="linear">linear</option>
                    <option value="ease_in">ease_in</option>
                    <option value="ease_out">ease_out</option>
                    <option value="hold">hold (bậc thang)</option>
                  </select>
                </label>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="section-label" style={{ margin: 0 }}>Motion &amp; Gait Engine (Articulated 2D)</span>
                    <span
                      className={`badge ${
                        editorBinding?.motionEngineMode === 'articulated_verified'
                          ? 'badge-success'
                          : editorBinding?.motionEngineMode === 'articulated_v1'
                          ? 'badge-warning'
                          : 'badge-neutral'
                      }`}
                      data-testid="motion-engine-badge"
                    >
                      {editorBinding?.motionEngineMode === 'articulated_verified'
                        ? 'Articulated QA Verified'
                        : editorBinding?.motionEngineMode === 'articulated_v1'
                        ? 'Articulated Ready'
                        : 'Legacy Stance'}
                    </span>
                  </div>
                  {!selectedShot.motion ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const sx = selectedShot.actorStart?.x ?? 180;
                        const ex = selectedShot.actorEnd?.x ?? sx + 120;
                        const nextMotion: ShotMotionSpec = {
                          mode: 'articulated_v1',
                          preset: 'walk',
                          startX: sx,
                          endX: ex,
                          startY: 0,
                          endY: 0,
                          gait: {
                            cadenceHz: 2.0,
                            strideLen: 115,
                            footLift: 32,
                            targetSpeed: 120,
                            pelvisDrop: 4,
                            armSwingAmp: 0.34,
                            anticipateS: 0.16,
                            settleS: 0.18,
                            facing: ex < sx ? -1 : 1,
                          },
                          cameraPreset: selectedShot.cameraPreset ?? 'follow',
                          visualBeat: selectedShot.visualBeat ?? 'action',
                        };
                        onUpdateShot(selectedShotIndex, {
                          ...selectedShot,
                          motionMode: 'articulated_v1',
                          motion: nextMotion,
                        });
                      }}
                    >
                      Bật Articulated Motion Controls
                    </button>
                  ) : (() => {
                    const m = selectedShot.motion;
                    const g = m.gait ?? {
                      cadenceHz: 2.0,
                      strideLen: 110,
                      footLift: 28,
                      targetSpeed: 0,
                      pelvisDrop: 4,
                      armSwingAmp: 0.32,
                      anticipateS: 0.16,
                      settleS: 0.18,
                      facing: 1 as const,
                    };
                    const updateMotion = (patch: Partial<ShotMotionSpec>) =>
                      onUpdateShot(selectedShotIndex, {
                        ...selectedShot,
                        motionMode: patch.mode ?? m.mode,
                        motion: { ...m, ...patch },
                      });
                    const updateGait = (gPatch: Partial<NonNullable<ShotMotionSpec['gait']>>) =>
                      updateMotion({ gait: { ...g, ...gPatch } });
                    return (
                      <div style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: 12 }}>
                        <label className="field">
                          <span className="field-label" style={{ fontSize: 11 }}>Motion Preset</span>
                          <select
                            className="select"
                            data-testid="motion-preset-select"
                            style={{ minHeight: 28, padding: '2px 4px' }}
                            value={m.preset}
                            onChange={(e) => updateMotion({ preset: e.target.value as MotionPreset })}
                          >
                            {(['idle', 'anticipate', 'walk', 'run', 'dash', 'stop', 'turn', 'react', 'recover', 'none'] as const).map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="field-label" style={{ fontSize: 11 }}>Visual Beat</span>
                          <select
                            className="select"
                            data-testid="visual-beat-select"
                            style={{ minHeight: 28, padding: '2px 4px' }}
                            value={selectedShot.visualBeat ?? m.visualBeat ?? 'action'}
                            onChange={(e) => {
                              const vb = e.target.value as VisualBeatKind;
                              onUpdateShot(selectedShotIndex, {
                                ...selectedShot,
                                visualBeat: vb,
                                motion: { ...m, visualBeat: vb },
                              });
                            }}
                          >
                            {(['hook', 'surprise', 'action', 'escalation', 'payoff'] as const).map((b) => (
                              <option key={b} value={b}>{b}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="field-label" style={{ fontSize: 11 }}>World Start X</span>
                          <input
                            type="number"
                            step={15}
                            className="input"
                            data-testid="motion-start-x"
                            style={{ minHeight: 28, padding: '2px 6px' }}
                            value={m.startX}
                            onChange={(e) => updateMotion({ startX: Number(e.target.value) })}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label" style={{ fontSize: 11 }}>World End X</span>
                          <input
                            type="number"
                            step={15}
                            className="input"
                            data-testid="motion-end-x"
                            style={{ minHeight: 28, padding: '2px 6px' }}
                            value={m.endX}
                            onChange={(e) => updateMotion({ endX: Number(e.target.value) })}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label" style={{ fontSize: 11 }}>Cadence (Hz)</span>
                          <input
                            type="number"
                            step={0.2}
                            min={0.2}
                            max={8}
                            className="input"
                            data-testid="motion-cadence"
                            style={{ minHeight: 28, padding: '2px 6px' }}
                            value={g.cadenceHz}
                            onChange={(e) => updateGait({ cadenceHz: Number(e.target.value) })}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label" style={{ fontSize: 11 }}>Stride (px)</span>
                          <input
                            type="number"
                            step={10}
                            min={20}
                            max={400}
                            className="input"
                            data-testid="motion-stride"
                            style={{ minHeight: 28, padding: '2px 6px' }}
                            value={g.strideLen}
                            onChange={(e) => updateGait({ strideLen: Number(e.target.value) })}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label" style={{ fontSize: 11 }}>Foot Lift (px)</span>
                          <input
                            type="number"
                            step={4}
                            min={0}
                            max={160}
                            className="input"
                            style={{ minHeight: 28, padding: '2px 6px' }}
                            value={g.footLift}
                            onChange={(e) => updateGait({ footLift: Number(e.target.value) })}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label" style={{ fontSize: 11 }}>Hướng (Facing)</span>
                          <select
                            className="select"
                            style={{ minHeight: 28, padding: '2px 4px' }}
                            value={g.facing}
                            onChange={(e) => updateGait({ facing: Number(e.target.value) < 0 ? -1 : 1 })}
                          >
                            <option value={1}>Phải (+1)</option>
                            <option value={-1}>Trái (-1)</option>
                          </select>
                        </label>
                      </div>
                    );
                  })()}
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="section-label" style={{ margin: 0 }}>Vị trí & Tư thế Actor (Start → End)</span>
                    {!selectedShot.actorStart && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          onUpdateShot(selectedShotIndex, {
                            ...selectedShot,
                            actorStart: defaultActorPose(),
                            actorEnd: defaultActorPose(),
                          })
                        }
                      >
                        Bật Pose Editor
                      </button>
                    )}
                  </div>
                  {(selectedShot.actorStart || selectedShot.actorEnd) && (() => {
                    const aStart = selectedShot.actorStart ?? defaultActorPose();
                    const aEnd = selectedShot.actorEnd ?? { ...aStart };
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                        {([
                          ['Start', aStart, (next: ActorPoseState) => onUpdateShot(selectedShotIndex, { ...selectedShot, actorStart: next })],
                          ['End', aEnd, (next: ActorPoseState) => onUpdateShot(selectedShotIndex, { ...selectedShot, actorEnd: next })],
                        ] as const).map(([label, pose, setPose]) => (
                          <div key={label} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                            <div style={{ gridColumn: '1 / -1', fontWeight: 600 }}>{label}</div>
                            <label className="field">
                              <span className="field-label" style={{ fontSize: 11 }}>X</span>
                              <input type="number" step={20} className="input" style={{ minHeight: 28, padding: '2px 6px' }} value={pose.x} onChange={(e) => setPose({ ...pose, x: Number(e.target.value) })} />
                            </label>
                            <label className="field">
                              <span className="field-label" style={{ fontSize: 11 }}>Y</span>
                              <input type="number" step={10} className="input" style={{ minHeight: 28, padding: '2px 6px' }} value={pose.y} onChange={(e) => setPose({ ...pose, y: Number(e.target.value) })} />
                            </label>
                            <label className="field">
                              <span className="field-label" style={{ fontSize: 11 }}>Head °</span>
                              <input type="number" step={2} min={-20} max={20} className="input" style={{ minHeight: 28, padding: '2px 6px' }} value={pose.headAngleDeg} onChange={(e) => setPose({ ...pose, headAngleDeg: Number(e.target.value) })} />
                            </label>
                            <label className="field">
                              <span className="field-label" style={{ fontSize: 11 }}>Tay trái</span>
                              <select className="select" style={{ minHeight: 28, padding: '2px 4px' }} value={pose.leftArmAction} onChange={(e) => setPose({ ...pose, leftArmAction: e.target.value as ActorPoseState['leftArmAction'] })}>
                                <option value="rest">rest</option>
                                <option value="reach">reach</option>
                                <option value="offer">offer</option>
                                <option value="point">point</option>
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label" style={{ fontSize: 11 }}>Tay phải</span>
                              <select className="select" style={{ minHeight: 28, padding: '2px 4px' }} value={pose.rightArmAction} onChange={(e) => setPose({ ...pose, rightArmAction: e.target.value as ActorPoseState['rightArmAction'] })}>
                                <option value="rest">rest</option>
                                <option value="reach">reach</option>
                                <option value="offer">offer</option>
                                <option value="point">point</option>
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label" style={{ fontSize: 11 }}>Stride (±25%)</span>
                              <input type="number" step={0.5} min={0} className="input" style={{ minHeight: 28, padding: '2px 6px' }} value={pose.strideCycles} onChange={(e) => setPose({ ...pose, strideCycles: Number(e.target.value) })} />
                            </label>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="section-label" style={{ margin: 0 }}>Đạo cụ (Prop Keyframes: {selectedShot.propKeyframes?.length ?? 0})</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const existing = selectedShot.propKeyframes ?? [];
                        const propName = selectedShot.props[0] ?? 'hat';
                        const last = existing[existing.length - 1];
                        const nextProp: PropKeyframe = last
                          ? { ...last, t: Number(Math.min(selectedShot.end - selectedShot.start, last.t + 0.5).toFixed(2)) }
                          : { propId: propName, t: 0, x: 0, y: -120, angleDeg: 0, scale: 1 };
                        onUpdateShot(selectedShotIndex, { ...selectedShot, propKeyframes: [...existing, nextProp] });
                      }}
                    >
                      <Plus size={13} />
                      <span>Thêm Prop Key</span>
                    </button>
                  </div>
                  {(selectedShot.propKeyframes ?? []).map((pk, pIdx) => (
                    <div key={pIdx} style={{ padding: 6, border: '1px solid var(--border)', borderRadius: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, fontSize: 11 }}>
                      <label className="field">
                        <span className="field-label">Prop</span>
                        <input className="input" style={{ minHeight: 26, padding: '2px 4px' }} value={pk.propId} onChange={(e) => {
                          const next = [...(selectedShot.propKeyframes ?? [])];
                          next[pIdx] = { ...pk, propId: e.target.value };
                          onUpdateShot(selectedShotIndex, { ...selectedShot, propKeyframes: next });
                        }} />
                      </label>
                      <label className="field">
                        <span className="field-label">t (s)</span>
                        <input type="number" step={0.1} className="input" style={{ minHeight: 26, padding: '2px 4px' }} value={pk.t} onChange={(e) => {
                          const next = [...(selectedShot.propKeyframes ?? [])];
                          next[pIdx] = { ...pk, t: Number(e.target.value) };
                          onUpdateShot(selectedShotIndex, { ...selectedShot, propKeyframes: next });
                        }} />
                      </label>
                      <label className="field">
                        <span className="field-label">Angle °</span>
                        <input type="number" step={5} className="input" style={{ minHeight: 26, padding: '2px 4px' }} value={pk.angleDeg} onChange={(e) => {
                          const next = [...(selectedShot.propKeyframes ?? [])];
                          next[pIdx] = { ...pk, angleDeg: Number(e.target.value) };
                          onUpdateShot(selectedShotIndex, { ...selectedShot, propKeyframes: next });
                        }} />
                      </label>
                      <label className="field">
                        <span className="field-label">X</span>
                        <input type="number" step={20} className="input" style={{ minHeight: 26, padding: '2px 4px' }} value={pk.x} onChange={(e) => {
                          const next = [...(selectedShot.propKeyframes ?? [])];
                          next[pIdx] = { ...pk, x: Number(e.target.value) };
                          onUpdateShot(selectedShotIndex, { ...selectedShot, propKeyframes: next });
                        }} />
                      </label>
                      <label className="field">
                        <span className="field-label">Y</span>
                        <input type="number" step={10} className="input" style={{ minHeight: 26, padding: '2px 4px' }} value={pk.y} onChange={(e) => {
                          const next = [...(selectedShot.propKeyframes ?? [])];
                          next[pIdx] = { ...pk, y: Number(e.target.value) };
                          onUpdateShot(selectedShotIndex, { ...selectedShot, propKeyframes: next });
                        }} />
                      </label>
                      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <button type="button" className="btn btn-sm" onClick={() => {
                          const next = (selectedShot.propKeyframes ?? []).filter((_, j) => j !== pIdx);
                          onUpdateShot(selectedShotIndex, { ...selectedShot, propKeyframes: next });
                        }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* CAMERA TAB */}
        {activeTab === 'camera' && (
          <>
            {!selectedShot ? (
              <div className="field-hint">Chọn một shot để chỉnh keyframes camera (x, y, z, fov).</div>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">Camera Director Preset</span>
                  <select
                    className="select"
                    data-testid="camera-preset-select"
                    value={selectedShot.cameraPreset ?? selectedShot.motion?.cameraPreset ?? 'establish'}
                    onChange={(e) => {
                      const cp = e.target.value as CameraPreset;
                      onUpdateShot(selectedShotIndex, {
                        ...selectedShot,
                        cameraPreset: cp,
                        ...(selectedShot.motion ? { motion: { ...selectedShot.motion, cameraPreset: cp } } : {}),
                      });
                    }}
                  >
                    <option value="establish">establish (Toàn cảnh định vị)</option>
                    <option value="follow">follow (Bám nhịp chuyển động)</option>
                    <option value="reaction_closeup">reaction_closeup (Cận biểu cảm)</option>
                    <option value="object_insert">object_insert (Cận đạo cụ / tay cầm)</option>
                    <option value="impact">impact (Nhấn đỉnh cao / cú đánh)</option>
                    <option value="settle">settle (Hạ nhịp kết shot)</option>
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">Ý đồ camera (Camera Intent)</span>
                  <input
                    className="input"
                    value={selectedShot.camera}
                    onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, camera: e.target.value })}
                  />
                </label>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="section-label" style={{ margin: 0 }}>Keyframes ({selectedShot.cameraKeys?.length ?? 0})</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {onVerifyChanges && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={verifyBusy || busy}
                        onClick={async () => {
                          setVerifyBusy(true);
                          try {
                            await onVerifyChanges();
                          } finally {
                            setVerifyBusy(false);
                          }
                        }}
                      >
                        <RefreshCw size={12} />
                        <span>{verifyBusy ? 'Đang kiểm...' : 'Verify changes'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const keys = selectedShot.cameraKeys ?? [];
                        const last = keys[keys.length - 1] ?? { t: 0, x: 0, y: -210, z: 0, fov: 55 };
                        const nextT = Math.min(selectedShot.end - selectedShot.start, Number((last.t + 0.5).toFixed(2)));
                        onUpdateShot(selectedShotIndex, {
                          ...selectedShot,
                          cameraKeys: [...keys, { ...last, t: nextT }],
                        });
                      }}
                    >
                      <Plus size={13} />
                      <span>Thêm Keyframe</span>
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(selectedShot.cameraKeys ?? []).map((k, kIdx) => (
                    <div key={kIdx} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                      {(['t', 'x', 'y', 'z', 'fov'] as const).map((field) => (
                        <label key={field} className="field">
                          <span className="field-label" style={{ fontSize: 11 }}>{field.toUpperCase()}</span>
                          <input
                            type="number"
                            step={field === 't' ? 0.1 : 10}
                            className="input"
                            style={{ minHeight: 30, padding: '3px 6px' }}
                            value={k[field]}
                            onChange={(e) => {
                              const nextKeys = [...(selectedShot.cameraKeys ?? [])];
                              nextKeys[kIdx] = { ...k, [field]: Number(e.target.value) };
                              onUpdateShot(selectedShotIndex, { ...selectedShot, cameraKeys: nextKeys });
                            }}
                          />
                        </label>
                      ))}
                      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={(selectedShot.cameraKeys?.length ?? 0) <= 1}
                          onClick={() => {
                            const nextKeys = (selectedShot.cameraKeys ?? []).filter((_, j) => j !== kIdx);
                            onUpdateShot(selectedShotIndex, { ...selectedShot, cameraKeys: nextKeys });
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {editorBinding && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="section-label" style={{ margin: 0 }}>Bảng Binding UI → Renderer</span>
                      <span className={`badge ${editorBinding.mode === 'bound_canonical' ? 'badge-success' : 'badge-neutral'}`}>
                        {editorBinding.mode === 'bound_canonical' ? 'Live Runtime Bound' : 'Custom scene.py'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
                      {editorBinding.mappings.map((m, mIdx) => (
                        <div key={mIdx} style={{ padding: 6, background: 'var(--surface-subtle)', borderRadius: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                            <span>{m.uiField}</span>
                            <span style={{ color: m.liveBound ? 'var(--success)' : 'var(--warning)' }}>
                              {m.liveBound ? 'Live' : 'Static'}
                            </span>
                          </div>
                          <div style={{ color: 'var(--muted)' }}>
                            <code>{m.jsonPath}</code> → <code>{m.pythonFunction}</code>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* CHARACTER & RIG TAB */}
        {activeTab === 'character' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="section-label" style={{ margin: 0 }}>Nhân vật & Rig ({characters.length})</span>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void onRunPreflight()} disabled={busy}>
                <RefreshCw size={13} />
                <span>Chạy Preflight</span>
              </button>
            </div>

            {latestPreflight && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: latestPreflight.technical_pass ? 'var(--success-soft)' : 'var(--danger-soft)',
                  color: latestPreflight.technical_pass ? 'var(--success)' : 'var(--danger)',
                  fontSize: 12,
                }}
              >
                <strong>Preflight: {latestPreflight.technical_pass ? 'PASS kỹ thuật' : 'FAIL'}</strong>
                <div>Scope: {String(latestPreflight.scope ?? '')}</div>
              </div>
            )}

            {characters.length === 0 ? (
              <div style={{ padding: 12, background: 'var(--surface-subtle)', borderRadius: 8, fontSize: 13, color: 'var(--muted)' }}>
                Chưa có nhân vật nào trong `characters.json`. Cần tạo & đăng ký package `b6-puppet/1` (`binding_version: 2`).
              </div>
            ) : (
              (() => {
                const actor = characters[rigActorIdx] ?? characters[0];
                const viewKeys = Object.keys(actor.views);
                const view = actor.views[rigViewId] ?? actor.views[viewKeys[0] ?? ''];
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <select
                        aria-label="Chọn nhân vật"
                        className="select"
                        value={rigActorIdx}
                        onChange={(e) => setRigActorIdx(Number(e.target.value))}
                      >
                        {characters.map((c, idx) => (
                          <option key={c.id} value={idx}>{c.displayName} ({c.id})</option>
                        ))}
                      </select>
                      <select
                        aria-label="Chọn góc nhìn nhân vật"
                        className="select"
                        value={view?.viewId ?? ''}
                        onChange={(e) => setRigViewId(e.target.value)}
                      >
                        {viewKeys.map((vk) => (
                          <option key={vk} value={vk}>{vk}</option>
                        ))}
                      </select>
                    </div>

                    <div className="badge badge-warning" style={{ whiteSpace: 'normal', borderRadius: 8, padding: '6px 8px' }}>
                      Walk/Run Gait: {actor.gaitStatus === 'unsupported_needs_authoring' ? 'Chưa hỗ trợ — cần author gait' : 'Đã author'}
                    </div>
                    <div className="field-hint">{actor.gaitNote}</div>

                    {view && (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div className="asset-thumb" style={{ height: 100, padding: 4 }}>
                            <img src={view.headPath} alt={`${actor.id} head`} />
                          </div>
                          <div className="asset-thumb" style={{ height: 100, padding: 4 }}>
                            <img src={view.bodyPath} alt={`${actor.id} body`} />
                          </div>
                        </div>

                        <div style={{ fontSize: 12, background: 'var(--surface-subtle)', padding: 10, borderRadius: 8 }}>
                          <div><strong>Ink Color:</strong> {view.inkColor}</div>
                          <div><strong>Head Anchor:</strong> {view.headAnchor ? `[${view.headAnchor.join(', ')}]` : 'auto'}</div>
                          <div><strong>Neck Mount:</strong> {view.neckAttachment ? `min overlap ${view.neckAttachment.min_overlap_fraction}, thickness ${view.neckAttachment.min_overlap_thickness}` : 'missing'}</div>
                          <div><strong>Left Arm:</strong> lengths {view.arms.left?.lengths?.join('/')} · ink_width {view.arms.left?.ink_width}</div>
                          <div><strong>Right Arm:</strong> lengths {view.arms.right?.lengths?.join('/')} · ink_width {view.arms.right?.ink_width}</div>
                          <div><strong>Expressions ({Object.keys(view.heads).length}):</strong> {Object.keys(view.heads).join(', ') || 'default only'}</div>
                        </div>

                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            className="input"
                            placeholder="Head anchor x,y (VD: 0,-290)"
                            value={headAnchorInput}
                            onChange={(e) => setHeadAnchorInput(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={async () => {
                              const parts = headAnchorInput.split(',').map(Number);
                              if (parts.length === 2 && parts.every(Number.isFinite)) {
                                await onUpdateRig(actor.id, view.viewId, { head_anchor: parts });
                                setHeadAnchorInput('');
                              }
                            }}
                          >
                            Cập nhật
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()
            )}
          </>
        )}

        {/* EXPORT & QA PIPELINE TAB */}
        {activeTab === 'export' && (
          <>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: 10,
                borderRadius: 8,
                background: trustedCode ? 'var(--primary-soft)' : 'var(--warning-soft)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={trustedCode}
                onChange={(e) => onToggleTrustedCode(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ fontSize: 12 }}>
                <strong>Xác nhận `--trusted-code` (Local Scene Python):</strong> Tôi đã rà soát `scene.py` trong dự án này và cho phép engine chạy local.
              </span>
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="section-label" style={{ margin: 0 }}>Pipeline thực thi B6 ({ratio})</span>
              <button type="button" className="btn" disabled={busy} onClick={() => void onRunValidate()}>
                <CheckCircle2 size={15} />
                <span>1. Kiểm tra điều kiện (Validate)</span>
              </button>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button type="button" className="btn" disabled={busy || !trustedCode} onClick={() => void onRunDraft(0.5)}>
                  <Play size={15} />
                  <span>2a. Draft 0.5x</span>
                </button>
                <button type="button" className="btn" disabled={busy || !trustedCode} onClick={() => void onRunDraft(0.75)}>
                  <Play size={15} />
                  <span>2b. Draft 0.75x</span>
                </button>
              </div>
              <button type="button" className="btn btn-primary" disabled={busy || !trustedCode} onClick={() => void onRunPreview()}>
                <Play size={15} />
                <span>3. Render Preview Native MP4</span>
              </button>

              {reviewState?.latestReport && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void onRunReviewPack(reviewState.latestReport!.path)}
                >
                  <ShieldAlert size={15} />
                  <span>4. Tạo Review Pack (35 mục)</span>
                </button>
              )}

              {reviewState?.latestMotionReview && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void onRunCheckReview(reviewState.latestMotionReview!.path, reviewState.latestReport?.path)}
                >
                  <CheckCircle2 size={15} />
                  <span>5. Kiểm tra Review JSON</span>
                </button>
              )}
            </div>

            {/* 3 Separate QA Decision Badges */}
            {reviewState && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="section-label" style={{ margin: 0 }}>Trạng thái QA tách biệt (3 tầng)</span>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>Kỹ thuật (Technical):</span>
                  <span
                    className={`badge ${
                      reviewState.technicalStatus === 'pass'
                        ? 'badge-success'
                        : reviewState.technicalStatus === 'fail'
                        ? 'badge-danger'
                        : reviewState.technicalStatus === 'stale'
                        ? 'badge-warning'
                        : 'badge-neutral'
                    }`}
                  >
                    {reviewState.technicalStatus === 'pass'
                      ? 'PASS kỹ thuật'
                      : reviewState.technicalStatus === 'fail'
                      ? 'FAIL kỹ thuật'
                      : reviewState.technicalStatus === 'stale'
                      ? 'STALE (Cần render lại)'
                      : 'Chưa chạy'}
                  </span>
                </div>
                {reviewState.motionQcStatus && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>Motion QC (Articulated):</span>
                    <span
                      className={`badge ${
                        reviewState.motionQcStatus === 'pass'
                          ? 'badge-success'
                          : reviewState.motionQcStatus === 'fail'
                          ? 'badge-danger'
                          : reviewState.motionQcStatus === 'stale'
                          ? 'badge-warning'
                          : 'badge-neutral'
                      }`}
                    >
                      {reviewState.motionQcStatus === 'pass'
                        ? 'PASS Articulated QC'
                        : reviewState.motionQcStatus === 'fail'
                        ? 'FAIL Motion QC'
                        : reviewState.motionQcStatus === 'stale'
                        ? 'STALE (Cần QC lại)'
                        : 'Chờ QC'}
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>Kiểm tra trực quan (35 mục):</span>
                  <span
                    className={`badge ${
                      reviewState.visualReviewStatus === 'pass'
                        ? 'badge-success'
                        : reviewState.visualReviewStatus === 'needs_repair'
                        ? 'badge-danger'
                        : 'badge-warning'
                    }`}
                  >
                    {reviewState.visualReviewStatus === 'pass'
                      ? 'PASS (35/35)'
                      : reviewState.visualReviewStatus === 'needs_repair'
                      ? 'Cần sửa (needs_repair)'
                      : reviewState.visualReviewStatus === 'stale'
                      ? 'STALE (Cần review lại)'
                      : 'Cần kiểm tra trực quan'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>Phê duyệt của bạn:</span>
                  <span
                    className={`badge ${
                      reviewState.userApprovalStatus === 'approved'
                        ? 'badge-success'
                        : reviewState.userApprovalStatus === 'rejected'
                        ? 'badge-danger'
                        : 'badge-warning'
                    }`}
                  >
                    {reviewState.userApprovalStatus === 'approved'
                      ? 'Đã duyệt'
                      : reviewState.userApprovalStatus === 'rejected'
                      ? 'Từ chối'
                      : reviewState.userApprovalStatus === 'stale'
                      ? 'STALE (Cần duyệt lại)'
                      : 'Chờ phê duyệt'}
                  </span>
                </div>

                {reviewState.blockingReasons.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', background: 'var(--warning-soft)', padding: 8, borderRadius: 6 }}>
                    <strong>Lý do chưa mở khóa Export:</strong>
                    <ul style={{ margin: '4px 0 0 14px', padding: 0 }}>
                      {reviewState.blockingReasons.slice(0, 4).map((r, idx) => (
                        <li key={idx}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {reviewState.latestReport &&
                  reviewState.latestMotionReview &&
                  reviewState.technicalStatus === 'pass' &&
                  reviewState.visualReviewStatus === 'pass' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                    <input
                      className="input"
                      placeholder="Ghi chú phê duyệt thực tế của bạn..."
                      value={approvalNote}
                      onChange={(e) => setApprovalNote(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || approvalNote.trim().length < 3}
                      onClick={() =>
                        void onRunApprove(reviewState.latestReport!.path, reviewState.latestMotionReview!.path, approvalNote)
                      }
                    >
                      <span>6. Ghi nhận Phê duyệt & Mở khóa Export</span>
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !trustedCode || !reviewState.renderUnlocked}
                  onClick={() => void onRunRender()}
                >
                  <span>7. Xuất Video Full MP4</span>
                </button>
                {!reviewState.renderUnlocked && (
                  <div className="field-hint" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <AlertTriangle size={13} color="var(--warning)" />
                    <span>Export Full bị khóa cho tới khi Technical PASS + Review 35/35 + User Approve đều khớp source hiện hành.</span>
                  </div>
                )}
              </div>
            )}

            {/* Outputs list */}
            {outputs.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="section-label" style={{ margin: 0 }}>Outputs ({outputs.length})</span>
                  <button type="button" className="btn btn-sm" onClick={() => void onOpenFolder()}>
                    <FolderOpen size={13} />
                    <span>Mở thư mục</span>
                  </button>
                </div>
                {outputs.slice(0, 4).map((o) => (
                  <div key={o.id} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
                    <div style={{ fontWeight: 600 }}>{o.id} ({o.kind} · {o.ratio})</div>
                    {o.ffprobe && (
                      <div style={{ color: 'var(--muted)' }}>
                        {o.ffprobe.width}x{o.ffprobe.height} · {o.ffprobe.fps}fps · {o.ffprobe.duration.toFixed(2)}s · {(o.ffprobe.bytes / 1024).toFixed(0)} KB
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      {o.videoUrl && (
                        <a href={o.videoUrl} download={`${project.id}-${o.id}.mp4`} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                          Tải MP4
                        </a>
                      )}
                      {o.srtUrl && (
                        <a href={o.srtUrl} download={`${o.id}.srt`} style={{ color: 'var(--primary)' }}>
                          SRT
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
