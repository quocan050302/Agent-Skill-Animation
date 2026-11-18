import React from 'react';
import { ChevronDown, ChevronUp, StopCircle, Terminal } from 'lucide-react';
import type { JobRecord } from '@b6-studio/shared';

interface JobsDrawerProps {
  open: boolean;
  onToggle: () => void;
  jobs: JobRecord[];
  activeJobId: string | null;
  logs: string[];
  onSelectJob: (id: string) => void;
  onCancelJob: (id: string) => Promise<void>;
}

export const JobsDrawer: React.FC<JobsDrawerProps> = ({
  open,
  onToggle,
  jobs,
  activeJobId,
  logs,
  onSelectJob,
  onCancelJob,
}) => {
  const activeJob = jobs.find((j) => j.id === activeJobId) ?? jobs[0] ?? null;

  return (
    <div className="jobs-drawer" role="region" aria-label="Tác vụ và Nhật ký chạy B6">
      <div className="jobs-drawer-bar">
        <button
          type="button"
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: 'none',
            background: 'transparent',
            color: 'var(--text)',
            fontWeight: 600,
            padding: 0,
            minWidth: 0,
          }}
        >
          <Terminal size={15} color="var(--primary)" />
          <span>Tác vụ B6</span>
          <span aria-live="polite" style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeJob ? `${activeJob.kind}: ${activeJob.stageLabel} (${(activeJob.elapsedMs / 1000).toFixed(1)}s)` : 'Sẵn sàng'}
          </span>
          {activeJob?.frameProgress && (
            <span className="badge badge-warning">
              {activeJob.frameProgress.checkedFrame}/{activeJob.frameProgress.totalFrames} frames
            </span>
          )}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {activeJob && (activeJob.status === 'running' || activeJob.status === 'queued') && (
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void onCancelJob(activeJob.id)}>
              <StopCircle size={13} />
              <span>Hủy</span>
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={onToggle} aria-label={open ? 'Thu gọn logs' : 'Mở logs'}>
            {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="jobs-drawer-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
            {jobs.slice(0, 8).map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => onSelectJob(j.id)}
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: `1px solid ${j.id === activeJob?.id ? 'var(--primary)' : 'var(--border)'}`,
                  background: j.id === activeJob?.id ? 'var(--primary-soft)' : 'var(--surface)',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{j.kind}</strong>
                  <span>{j.status}</span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>{j.stageLabel}</div>
              </button>
            ))}
          </div>
          <div className="log-console">
            {logs.length > 0 ? logs.slice(-80).join('\n') : 'Chưa có log.'}
          </div>
        </div>
      )}
    </div>
  );
};
