import React, { useState } from 'react';
import { Copy, FolderOpen, Plus, Trash2 } from 'lucide-react';
import type { InitRatio } from '@b6-studio/shared';
import type { ProjectSummaryDto } from '../api/client';

interface ProjectsViewProps {
  projects: ProjectSummaryDto[];
  activeProjectId: string | null;
  onOpenProject: (id: string) => void;
  onCreateProject: (input: {
    title: string;
    brief: string;
    ratio: InitRatio;
    language: string;
    targetDuration: number;
  }) => Promise<void>;
  onDuplicateProject: (id: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  activeProjectId,
  onOpenProject,
  onCreateProject,
  onDuplicateProject,
  onDeleteProject,
}) => {
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [ratio, setRatio] = useState<InitRatio>('9:16');
  const [language, setLanguage] = useState('en');
  const [targetDuration, setTargetDuration] = useState(10);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Vui lòng nhập tên dự án.');
      return;
    }
    setError(null);
    setCreating(true);
    try {
      await onCreateProject({
        title: title.trim(),
        brief: brief.trim(),
        ratio,
        language,
        targetDuration,
      });
      setTitle('');
      setBrief('');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const stageLabel = (stage: string) => {
    if (stage === 'needs_authoring') return { text: 'Cần biên soạn (needs_authoring)', cls: 'badge-warning' };
    if (stage === 'authored') return { text: 'Đã biên soạn (authored)', cls: 'badge-success' };
    return { text: stage, cls: 'badge-neutral' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Dự án B6 Local</h1>
          <div className="field-hint">
            Khởi tạo qua CLI B6 thật (<code>purpose: production</code>, mặc định <code>needs_authoring</code>). Không dùng demo/example thay cho phim mới.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
          <Plus size={16} />
          <span>Dự án mới</span>
        </button>
      </div>

      {showCreate && (
        <form className="card" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="card-title">Tạo dự án B6 mới</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}>
            <label className="field">
              <span className="field-label">Tên dự án *</span>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Đấu sĩ La Mã 10s"
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Tỷ lệ khung hình gốc</span>
              <select className="select" value={ratio} onChange={(e) => setRatio(e.target.value as InitRatio)}>
                <option value="9:16">9:16 Dọc (Khuyến nghị cho B6)</option>
                <option value="16:9">16:9 Ngang</option>
                <option value="both">Cả 9:16 và 16:9 (kế hoạch độc lập)</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Ngôn ngữ</span>
              <input className="input" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
            </label>
            <label className="field">
              <span className="field-label">Thời lượng mục tiêu (giây)</span>
              <input
                type="number"
                min={1}
                max={180}
                className="input"
                value={targetDuration}
                onChange={(e) => setTargetDuration(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Tóm tắt ngắn (Short brief)</span>
            <textarea
              className="textarea"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Mô tả tình huống, nhân vật, bối cảnh..."
            />
          </label>
          {error && <div className="field-error">{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setShowCreate(false)}>
              Hủy
            </button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? 'Đang khởi tạo B6 CLI...' : 'Khởi tạo dự án B6'}
            </button>
          </div>
        </form>
      )}

      {projects.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Chưa có dự án — Tạo dự án</div>
          <div className="field-hint" style={{ marginBottom: 14 }}>
            Tạo dự án B6 mới trong <code>workspace/projects</code> để bắt đầu quy trình từ kịch bản đến render MP4.
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            <span>Tạo dự án đầu tiên</span>
          </button>
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map((p) => {
            const st = stageLabel(p.stage);
            return (
              <div
                key={p.id}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  borderColor: p.id === activeProjectId ? 'var(--primary)' : undefined,
                }}
              >
                <div className="asset-thumb" style={{ height: 110 }}>
                  {p.latestThumbnailUrl ? (
                    <img src={p.latestThumbnailUrl} alt={p.title} />
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Chưa render contact sheet</span>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {p.ratios.join(', ')} · {p.duration ? `${p.duration}s` : `Mục tiêu ${p.targetDuration}s`}
                    </div>
                  </div>
                  <span className={`badge ${st.cls}`}>{st.text}</span>
                </div>
                {p.brief && (
                  <div style={{ fontSize: 13, color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {p.brief}
                  </div>
                )}
                {p.lastJob && (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Job gần nhất: <strong>{p.lastJob.kind}</strong> ({p.lastJob.status})
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => onOpenProject(p.id)}>
                    <FolderOpen size={14} />
                    <span>Mở Studio</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void onDuplicateProject(p.id)}
                    aria-label={`Nhân bản ${p.title}`}
                    title="Nhân bản dự án"
                  >
                    <Copy size={14} />
                  </button>
                  {confirmDeleteId === p.id ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        setConfirmDeleteId(null);
                        void onDeleteProject(p.id);
                      }}
                    >
                      Xác nhận xóa
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setConfirmDeleteId(p.id)}
                      aria-label={`Xóa ${p.title}`}
                      title="Xóa dự án"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
