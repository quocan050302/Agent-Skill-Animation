import React from 'react';
import { ExternalLink, FolderOpen, StopCircle } from 'lucide-react';
import type { JobRecord } from '@b6-studio/shared';
import type { OutputArtifactDto, ReviewStateDto } from '../api/client';

interface JobsQaViewProps {
  projectId: string | null;
  jobs: JobRecord[];
  selectedJobId: string | null;
  selectedJobLogs: string[];
  onSelectJob: (id: string) => void;
  onCancelJob: (id: string) => Promise<void>;
  outputs: OutputArtifactDto[];
  reviewState: ReviewStateDto | null;
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
  onOpenFolder,
}) => {
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
