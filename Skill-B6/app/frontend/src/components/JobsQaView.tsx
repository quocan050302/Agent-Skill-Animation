import React, { useState } from 'react';
import { BarChart3, ExternalLink, FolderOpen, StopCircle } from 'lucide-react';
import type { JobRecord } from '@b6-studio/shared';
import type {
  EditorialReportResponseDto,
  OutputArtifactDto,
  ReviewStateDto,
  SemanticReportResponseDto,
} from '../api/client';

interface JobsQaViewProps {
  projectId: string | null;
  jobs: JobRecord[];
  selectedJobId: string | null;
  selectedJobLogs: string[];
  onSelectJob: (id: string) => void;
  onCancelJob: (id: string) => Promise<void>;
  outputs: OutputArtifactDto[];
  reviewState: ReviewStateDto | null;
  editorialReport?: EditorialReportResponseDto | null;
  onAnalyzeEditorial?: () => Promise<void>;
  semanticReport?: SemanticReportResponseDto | null;
  onAnalyzeSemantic?: () => Promise<void>;
  activeJob?: JobRecord | null;
  onOpenFolder: () => Promise<void>;
}

export const JobsQaView: React.FC<JobsQaViewProps> = ({
  projectId,
  jobs,
  selectedJobId,
  selectedJobLogs,
  onSelectJob,
  onCancelJob,
  outputs,
  reviewState,
  editorialReport,
  onAnalyzeEditorial,
  semanticReport,
  onAnalyzeSemantic,
  activeJob,
  onOpenFolder,
}) => {
  const [madMode, setMadMode] = useState<'cut_excluded' | 'raw'>('cut_excluded');
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [semBusy, setSemBusy] = useState(false);
  const [semError, setSemError] = useState<string | null>(null);
  const statusBadge = (s: JobRecord['status']) => {
    if (s === 'succeeded') return 'badge-success';
    if (s === 'running' || s === 'queued') return 'badge-warning';
    if (s === 'failed' || s === 'interrupted') return 'badge-danger';
    return 'badge-neutral';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Jobs & Báo cáo QA</h1>
          <div className="field-hint">
            Theo dõi tiến trình thật (stdout/stderr, frame counter từ <code>b6_production.py</code>, kết quả FFprobe và 35 subchecks).
          </div>
        </div>
        {projectId && (
          <button type="button" className="btn" onClick={() => void onOpenFolder()}>
            <FolderOpen size={15} />
            <span>Mở thư mục Outputs</span>
          </button>
        )}
      </div>

      {/* Review Summary */}
      {reviewState && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}>
            <div>
              <div className="section-label">1. Technical Check</div>
              <div style={{ fontWeight: 700 }}>{reviewState.technicalStatus.toUpperCase()}</div>
              <div className="field-hint">{reviewState.latestReport?.path ?? 'Chưa có report.json'}</div>
              {reviewState.currentSourceFingerprint && (
                <div className="field-hint" style={{ fontSize: 11 }}>
                  Src FP: <code>{reviewState.currentSourceFingerprint.slice(0, 12)}…</code>
                  {reviewState.previewFingerprint ? ` | Preview FP: ${reviewState.previewFingerprint.slice(0, 12)}…` : ''}
                </div>
              )}
            </div>
            <div>
              <div className="section-label">2. Visual Motion Review (35 mục)</div>
              <div style={{ fontWeight: 700 }}>{reviewState.visualReviewStatus.toUpperCase()}</div>
              {reviewState.latestMotionReview && (
                <div className="field-hint">
                  Pass: {reviewState.latestMotionReview.subcheckCounts.pass}/{reviewState.latestMotionReview.subcheckCounts.total}
                  {' · '}Pending: {reviewState.latestMotionReview.subcheckCounts.pending}
                  {' · '}Needs repair: {reviewState.latestMotionReview.subcheckCounts.needsRepair}
                  {reviewState.latestMotionReview.htmlIndexUrl && (
                    <>
                      {' · '}
                      <a href={reviewState.latestMotionReview.htmlIndexUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
                        Mở review/index.html <ExternalLink size={11} />
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="section-label">3. User Approval & Export Gate</div>
              <div style={{ fontWeight: 700 }}>
                {reviewState.userApprovalStatus.toUpperCase()} · {reviewState.renderUnlocked ? 'EXPORT MỞ KHÓA' : 'EXPORT ĐANG KHÓA'}
              </div>
              <div className="field-hint">
                {reviewState.approvalRecord ? String(reviewState.approvalRecord.note ?? 'Approved') : 'Chưa có xác nhận người dùng'}
              </div>
            </div>
          </div>

          {(reviewState.reasonCodes.length > 0 || reviewState.blockingReasons.length > 0) && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Đồng bộ Editor: <code>{reviewState.editorSyncState}</code>
                {reviewState.voiceStale ? ' · VOICE_NEEDS_REGENERATION' : ''}
              </div>
              {reviewState.reasonCodes.length > 0 && (
                <div style={{ color: 'var(--muted)', marginBottom: 4 }}>
                  Mã bằng chứng: {reviewState.reasonCodes.join(', ')}
                </div>
              )}
              {reviewState.blockingReasons.length > 0 && (
                <ul style={{ margin: '4px 0 0 16px', padding: 0, color: 'var(--warning)' }}>
                  {reviewState.blockingReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Editorial Diagnostics Panel */}
      {projectId && (
        <details open className="card" data-testid="editorial-diagnostics-panel" style={{ minWidth: 0 }}>
          <summary
            style={{
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              listStyle: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <BarChart3 size={16} />
              <strong>Editorial Diagnostics & Pacing Telemetry</strong>
              <span
                className={`badge ${
                  editorialReport?.stale
                    ? 'badge-warning'
                    : (editorialReport?.qcStatus ?? reviewState?.editorialQcStatus) === 'pass'
                    ? 'badge-success'
                    : (editorialReport?.qcStatus ?? reviewState?.editorialQcStatus) === 'fail'
                    ? 'badge-danger'
                    : 'badge-neutral'
                }`}
                data-testid="editorial-qc-status-badge"
              >
                {editorialReport?.stale
                  ? 'STALE (Cần phân tích lại)'
                  : (editorialReport?.qcStatus ?? reviewState?.editorialQcStatus ?? 'pending').toUpperCase()}
              </span>
              <span className="badge badge-neutral">Ước lượng retention: Chưa khả dụng</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="editorial-mad-toggle-btn"
                onClick={(e) => {
                  e.preventDefault();
                  setMadMode((m) => (m === 'cut_excluded' ? 'raw' : 'cut_excluded'));
                }}
              >
                {madMode === 'cut_excluded' ? 'Cut-excluded MAD' : 'Raw MAD'}
              </button>
              {onAnalyzeEditorial && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  data-testid="analyze-editorial-btn"
                  disabled={
                    analyzeBusy ||
                    Boolean(activeJob && (activeJob.status === 'running' || activeJob.status === 'queued'))
                  }
                  onClick={async (e) => {
                    e.preventDefault();
                    setAnalyzeError(null);
                    setAnalyzeBusy(true);
                    try {
                      await onAnalyzeEditorial();
                    } catch (err) {
                      setAnalyzeError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setAnalyzeBusy(false);
                    }
                  }}
                >
                  {analyzeBusy || (activeJob?.kind === 'analyze-editorial' && (activeJob.status === 'running' || activeJob.status === 'queued'))
                    ? 'Đang phân tích…'
                    : 'Phân tích Editorial'}
                </button>
              )}
            </div>
          </summary>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {analyzeError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', background: 'var(--danger-soft)', padding: '6px 10px', borderRadius: 6 }}>
                Lỗi Phân tích Editorial: {analyzeError}
              </div>
            )}

            {!editorialReport?.available || !editorialReport.report ? (
              <div className="field-hint">
                {editorialReport?.statusNote ??
                  'Chưa có editorial-report.json cho preview hiện tại. Hãy chạy Preview hoặc bấm "Phân tích Editorial".'}
              </div>
            ) : (() => {
              const rep = editorialReport.report;
              const sum = (rep.summary ?? {}) as Record<string, unknown>;
              const perSec = Array.isArray(rep.per_second) ? (rep.per_second as Array<Record<string, unknown>>) : [];
              const qcDoc = (editorialReport.qc ?? {}) as Record<string, unknown>;
              const qcErrors = Array.isArray(qcDoc.errors) ? (qcDoc.errors as string[]) : [];
              const qcWarnings = Array.isArray(qcDoc.warnings) ? (qcDoc.warnings as string[]) : [];
              const repWarnings = Array.isArray(rep.warnings) ? (rep.warnings as string[]) : [];
              const gamingAudit = (rep.gaming_audit ?? {}) as Record<string, unknown>;
              const gamingReasons = Array.isArray(gamingAudit.reasons) ? (gamingAudit.reasons as string[]) : [];
              const allWarnings = Array.from(new Set([...qcErrors, ...qcWarnings, ...repWarnings, ...gamingReasons]));

              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(135px, 100%), 1fr))', gap: 8 }}>
                    <div style={{ padding: 8, background: 'var(--surface-subtle)', borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {madMode === 'cut_excluded' ? 'Cut-excluded Y-MAD' : 'Raw Y-MAD'}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {Number((madMode === 'cut_excluded' ? sum.cut_excluded_y_mad_mean : sum.raw_y_mad_mean) ?? 0).toFixed(2)}
                      </div>
                    </div>
                    <div style={{ padding: 8, background: 'var(--surface-subtle)', borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Image Residual Flow</div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {Number(sum.foreground_relative_motion_mean ?? 0).toFixed(2)} px/f
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                        Actor mask:{' '}
                        {typeof sum.actor_mask_motion_mean === 'number'
                          ? `${sum.actor_mask_motion_mean.toFixed(2)} px/f`
                          : 'n/a'}{' '}
                        · Prop:{' '}
                        {typeof sum.prop_mask_motion_mean === 'number'
                          ? `${sum.prop_mask_motion_mean.toFixed(2)} px/f`
                          : 'n/a'}
                      </div>
                    </div>
                    <div style={{ padding: 8, background: 'var(--surface-subtle)', borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Unique Shots / Cuts</div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {Number(sum.unique_compositions ?? 0)}/{Number(sum.shots_analyzed ?? 0)} · {Number(sum.cuts_detected ?? 0)} cuts
                      </div>
                    </div>
                    <div style={{ padding: 8, background: 'var(--surface-subtle)', borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Near-Static / Gaming</div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {Number(sum.pct_near_static ?? 0).toFixed(1)}% · {sum.gaming_detected ? 'GAMING!' : 'Clean'}
                      </div>
                    </div>
                  </div>

                  {allWarnings.length > 0 && (
                    <div style={{ fontSize: 12, padding: 8, borderRadius: 6, background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                      <strong>Cảnh báo Editorial / Pacing:</strong>
                      <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                        {allWarnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {perSec.length > 0 && (
                    <div style={{ overflowX: 'auto', width: '100%' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                            <th style={{ padding: '4px 6px' }}>Giây</th>
                            <th style={{ padding: '4px 6px' }}>Shot / Role</th>
                            <th style={{ padding: '4px 6px' }}>Y-MAD</th>
                            <th style={{ padding: '4px 6px' }}>FG (px/f)</th>
                            <th style={{ padding: '4px 6px' }}>Static %</th>
                            <th style={{ padding: '4px 6px' }}>Cuts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {perSec.map((secRow, i) => {
                            const bucket = ((madMode === 'cut_excluded' ? secRow.cut_excluded : secRow.raw) ??
                              secRow.cut_excluded ??
                              {}) as Record<string, unknown>;
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                                  {Number(secRow.start_s ?? i).toFixed(0)}–{Number(secRow.end_s ?? i + 1).toFixed(0)}s
                                </td>
                                <td style={{ padding: '4px 6px' }}>
                                  {String(secRow.active_shot_id ?? '—')}
                                  {secRow.active_role ? ` (${String(secRow.active_role)})` : ''}
                                </td>
                                <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                                  {Number(bucket.y_mad_mean ?? 0).toFixed(2)}
                                </td>
                                <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                                  {Number(bucket.foreground_relative_motion_mean ?? 0).toFixed(2)}
                                </td>
                                <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                                  {Number(bucket.pct_near_static ?? 0).toFixed(0)}%
                                </td>
                                <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                                  {Number(secRow.cuts_in_second ?? 0)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="field-hint" style={{ fontSize: 11 }}>
                    Báo cáo: <code>{editorialReport.reportPath}</code>
                    {editorialReport.qcPath ? ` · QC: ${editorialReport.qcPath}` : ''} · Lưu ý: MAD/optical-flow là telemetry biến thiên khung hình, KHÔNG thay thế đánh giá giữ chân người xem thật.
                  </div>
                </>
              );
            })()}
          </div>
        </details>
      )}

      {/* Semantic Action Evidence Panel */}
      {projectId && (
        <details open className="card" data-testid="semantic-evidence-panel" style={{ minWidth: 0 }}>
          <summary
            style={{
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              listStyle: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <BarChart3 size={16} />
              <strong>Semantic Evidence &amp; Action Verification</strong>
              <span
                className={`badge ${
                  semanticReport?.stale
                    ? 'badge-warning'
                    : (semanticReport?.qcStatus ?? reviewState?.semanticQcStatus) === 'pass'
                    ? 'badge-success'
                    : (semanticReport?.qcStatus ?? reviewState?.semanticQcStatus) === 'fail'
                    ? 'badge-danger'
                    : 'badge-neutral'
                }`}
                data-testid="semantic-qc-status-badge"
              >
                {semanticReport?.stale
                  ? 'STALE (Cần kiểm lại)'
                  : (semanticReport?.qcStatus ?? reviewState?.semanticQcStatus ?? 'pending').toUpperCase()}
              </span>
            </div>
            {onAnalyzeSemantic && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-testid="analyze-semantic-btn"
                disabled={
                  semBusy ||
                  Boolean(activeJob && (activeJob.status === 'running' || activeJob.status === 'queued'))
                }
                onClick={async (e) => {
                  e.preventDefault();
                  setSemError(null);
                  setSemBusy(true);
                  try {
                    await onAnalyzeSemantic();
                  } catch (err) {
                    setSemError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSemBusy(false);
                  }
                }}
              >
                {semBusy || (activeJob?.kind === 'analyze-semantic' && (activeJob.status === 'running' || activeJob.status === 'queued'))
                  ? 'Đang kiểm Semantic…'
                  : 'Phân tích Semantic'}
              </button>
            )}
          </summary>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {semError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', background: 'var(--danger-soft)', padding: '6px 10px', borderRadius: 6 }}>
                Lỗi Phân tích Semantic: {semError}
              </div>
            )}
            {!semanticReport?.available || !semanticReport.report ? (
              <div className="field-hint">
                {semanticReport?.statusNote ??
                  'Chưa có semantic-report.json cho preview hiện tại (chỉ yêu cầu ở dự án semantic_v1).'}
              </div>
            ) : (() => {
              const srep = semanticReport.report;
              const ssum = (srep.summary ?? {}) as Record<string, unknown>;
              const dbind = (srep.decoded_binding ?? {}) as Record<string, unknown>;
              const rows = Array.isArray(srep.action_results) ? (srep.action_results as Array<Record<string, unknown>>) : [];
              const errs = Array.isArray(srep.errors) ? (srep.errors as string[]) : [];
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(135px, 100%), 1fr))', gap: 8 }}>
                    <div style={{ padding: 8, background: 'var(--surface-subtle)', borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Verified Actions</div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {Number(ssum.verified_action_count ?? 0)}/{Number(ssum.action_count ?? 0)}
                      </div>
                    </div>
                    <div style={{ padding: 8, background: 'var(--surface-subtle)', borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Evidence Coverage</div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {(Number(ssum.coverage_ratio ?? 0) * 100).toFixed(0)}% ({Number(ssum.frames_checked ?? 0)}f)
                      </div>
                    </div>
                    <div style={{ padding: 8, background: 'var(--surface-subtle)', borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Decoded MP4 Binding</div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {dbind.verified ? 'VERIFIED' : 'MISMATCH'} (corr {Number(dbind.min_corr_vs_beauty ?? 0).toFixed(2)})
                      </div>
                    </div>
                  </div>
                  {errs.length > 0 && (
                    <div style={{ fontSize: 12, padding: 8, borderRadius: 6, background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                      {errs.map((er, idx) => (
                        <div key={idx}>• {er}</div>
                      ))}
                    </div>
                  )}
                  {rows.length > 0 && (
                    <div style={{ overflowX: 'auto', width: '100%' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                            <th style={{ padding: '4px 6px' }}>Action</th>
                            <th style={{ padding: '4px 6px' }}>Actor / Target</th>
                            <th style={{ padding: '4px 6px' }}>Window</th>
                            <th style={{ padding: '4px 6px' }}>Verdict</th>
                            <th style={{ padding: '4px 6px' }}>Evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((ar, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                                {String(ar.id ?? '')} ({String(ar.action_type ?? '')})
                              </td>
                              <td style={{ padding: '4px 6px' }}>
                                {String(ar.actor_id ?? '')}
                                {ar.target_prop_id ? ` → ${String(ar.target_prop_id)}` : ar.occluder_id ? ` @ ${String(ar.occluder_id)}` : ''}
                              </td>
                              <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>
                                {Number(ar.start_s ?? 0).toFixed(2)}–{Number(ar.end_s ?? 0).toFixed(2)}s
                              </td>
                              <td style={{ padding: '4px 6px' }}>
                                <span className={`badge ${ar.classification === 'verified_pass' ? 'badge-success' : ar.classification === 'uncertain_needs_human_review' ? 'badge-warning' : 'badge-danger'}`}>
                                  {String(ar.classification ?? '')}
                                </span>
                              </td>
                              <td style={{ padding: '4px 6px', fontSize: 11, color: 'var(--muted)' }}>
                                {JSON.stringify(ar.metrics ?? {}).slice(0, 90)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {semanticReport.debugLinks.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11 }}>
                      <span style={{ color: 'var(--muted)' }}>Debug Triptychs / Masks:</span>
                      {semanticReport.debugLinks.map((dl) => (
                        <a key={dl.relPath} href={dl.url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
                          {dl.label} <ExternalLink size={10} />
                        </a>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </details>
      )}

      {/* Jobs History & Live Logs */}
      <div className="card qa-split-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="section-label" style={{ margin: 0 }}>Danh sách tác vụ ({jobs.length})</div>
          {jobs.length === 0 ? (
            <div className="field-hint">Chưa có job nào được chạy.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
              {jobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => onSelectJob(j.id)}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 8,
                    border: `1px solid ${j.id === selectedJobId ? 'var(--primary)' : 'var(--border)'}`,
                    background: j.id === selectedJobId ? 'var(--primary-soft)' : 'var(--surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <strong>{j.kind}</strong>
                    <span className={`badge ${statusBadge(j.status)}`}>{j.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{j.stageLabel}</div>
                  {j.frameProgress && (
                    <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>
                      Frame {j.frameProgress.checkedFrame}/{j.frameProgress.totalFrames}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {(j.elapsedMs / 1000).toFixed(1)}s · {new Date(j.createdAt).toLocaleTimeString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="section-label" style={{ margin: 0 }}>Nhật ký tiến trình (Live Logs)</span>
            {selectedJobId &&
              (() => {
                const j = jobs.find((x) => x.id === selectedJobId);
                if (j && (j.status === 'running' || j.status === 'queued')) {
                  return (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => void onCancelJob(j.id)}>
                      <StopCircle size={14} />
                      <span>Hủy Job</span>
                    </button>
                  );
                }
                return null;
              })()}
          </div>
          <div className="log-console" style={{ maxHeight: 360 }}>
            {selectedJobLogs.length > 0 ? selectedJobLogs.join('\n') : 'Chọn một job để xem stdout/stderr thực tế.'}
          </div>
        </div>
      </div>

      {/* Outputs FFprobe Table */}
      {outputs.length > 0 && (
        <div className="card">
          <h2 className="card-title">Bằng chứng Outputs & FFprobe</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {outputs.map((o) => (
              <div key={o.id} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <strong>{o.outputDirRel} ({o.kind})</strong>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span
                      className={`badge ${
                        o.verificationStatus === 'current'
                          ? 'badge-success'
                          : o.verificationStatus === 'corrupt'
                          ? 'badge-danger'
                          : o.verificationStatus === 'stale'
                          ? 'badge-warning'
                          : 'badge-neutral'
                      }`}
                    >
                      {o.verificationStatus.toUpperCase()} · {o.technicalStatus}
                    </span>
                    <span className="badge badge-neutral">{o.ratio}</span>
                  </div>
                </div>
                {o.verificationReasons?.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 3 }}>
                    Kiểm chứng QA: {o.verificationReasons.join(', ')}
                  </div>
                )}
                {o.ffprobe ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    FFprobe: {o.ffprobe.width}x{o.ffprobe.height} · {o.ffprobe.codec} · {o.ffprobe.fps}fps ·{' '}
                    {o.ffprobe.duration.toFixed(3)}s · Audio: {o.ffprobe.hasAudio ? 'Có' : 'Không'} ·{' '}
                    SHA-256: <code>{o.ffprobe.sha256.slice(0, 16)}…</code>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Chưa có MP4 trong output này</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
