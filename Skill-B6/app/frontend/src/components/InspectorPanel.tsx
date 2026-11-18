import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Code2, Copy, FolderOpen, Play, Plus, RefreshCw, ShieldAlert, Trash2, Undo2, Save } from 'lucide-react';
import type { CaptionCue, JobRecord, Ratio, ShotItem } from '@b6-studio/shared';
import type { CharacterActorDto, OutputArtifactDto, ProjectDetailDto, ReviewStateDto } from '../api/client';

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {saveBadge()}
          {canUndo && (
            <button type="button" className="btn btn-sm" onClick={onUndo} title="Hoàn tác thao tác gần nhất">
              <Undo2 size={13} />
              <span>Hoàn tác</span>
            </button>
          )}
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={onForceSave}>
          <Save size={13} />
          <span>Lưu (Ctrl+S)</span>
        </button>
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

            <label className="field">
              <span className="field-label">Lời thoại / Narration (story.json)</span>
              <textarea
                className="textarea"
                aria-label="Lời thoại Narration"
                style={{ minHeight: 110 }}
                value={narrationDraft}
                onChange={(e) => onChangeNarration(e.target.value)}
              />
              <span className="field-hint">
                B6 yêu cầu phụ đề ghép lại phải khớp chính xác lời thoại gốc (original-speed voice-led timing).
              </span>
            </label>

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
                  <span className="field-label">Ý đồ camera (Camera Intent)</span>
                  <input
                    className="input"
                    value={selectedShot.camera}
                    onChange={(e) => onUpdateShot(selectedShotIndex, { ...selectedShot, camera: e.target.value })}
                  />
                </label>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="section-label" style={{ margin: 0 }}>Keyframes ({selectedShot.cameraKeys?.length ?? 0})</span>
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
                  <span className={`badge ${reviewState.technicalStatus === 'pass' ? 'badge-success' : 'badge-neutral'}`}>
                    {reviewState.technicalStatus === 'pass' ? 'PASS kỹ thuật' : 'Chưa chạy'}
                  </span>
                </div>
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
                      : 'Cần kiểm tra trực quan'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>Phê duyệt của bạn:</span>
                  <span className={`badge ${reviewState.userApprovalStatus === 'approved' ? 'badge-success' : 'badge-warning'}`}>
                    {reviewState.userApprovalStatus === 'approved' ? 'Đã duyệt' : 'Chờ phê duyệt'}
                  </span>
                </div>

                {reviewState.latestReport && reviewState.latestMotionReview && reviewState.visualReviewStatus === 'pass' && (
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
                      disabled={busy || !approvalNote.trim()}
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
                  disabled={busy || !trustedCode || reviewState.userApprovalStatus !== 'approved'}
                  onClick={() => void onRunRender()}
                >
                  <span>7. Xuất Video Full MP4</span>
                </button>
                {reviewState.userApprovalStatus !== 'approved' && (
                  <div className="field-hint" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <AlertTriangle size={13} color="var(--warning)" />
                    <span>Export Full bị khóa cho tới khi Review 35 mục & User Approve hoàn tất.</span>
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
