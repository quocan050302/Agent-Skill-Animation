import React, { useState } from 'react';
import { Check, Copy, Download, FileAudio, ImagePlus, Inbox, Upload } from 'lucide-react';
import type { AssetRecord, AssetRole } from '@b6-studio/shared';
import { api } from '../api/client';

interface AssetsViewProps {
  projectId: string;
  assets: AssetRecord[];
  inboxFiles: string[];
  onRefresh: () => Promise<void>;
}

const ROLES: Array<{ value: AssetRole; label: string }> = [
  { value: 'background_back', label: 'Nền xa (background_back)' },
  { value: 'background_mid', label: 'Nền giữa (background_mid)' },
  { value: 'foreground', label: 'Tiền cảnh (foreground)' },
  { value: 'character_head', label: 'Đầu nhân vật (character_head)' },
  { value: 'character_body', label: 'Thân nhân vật (character_body)' },
  { value: 'expression', label: 'Biểu cảm (expression)' },
  { value: 'sleeve_cuff', label: 'Tay áo / Cuff (sleeve_cuff)' },
  { value: 'prop', label: 'Đạo cụ (prop)' },
  { value: 'hand', label: 'Bàn tay (hand)' },
  { value: 'foot', label: 'Bàn chân (foot)' },
  { value: 'audio_narration', label: 'Giọng đọc gốc (audio_narration)' },
  { value: 'audio_sfx', label: 'Hiệu ứng âm thanh (audio_sfx)' },
  { value: 'audio_bgm', label: 'Nhạc nền (audio_bgm)' },
  { value: 'reference', label: 'Chỉ để đối chiếu (REFERENCE ONLY)' },
];

export const AssetsView: React.FC<AssetsViewProps> = ({ projectId, assets, inboxFiles, onRefresh }) => {
  const [uploadRole, setUploadRole] = useState<AssetRole>('prop');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Asset brief generator state
  const [briefTitle, setBriefTitle] = useState('');
  const [briefRole, setBriefRole] = useState<AssetRole>('character_head');
  const [briefEra, setBriefEra] = useState('Ancient Rome Colosseum Arena');
  const [briefDesc, setBriefDesc] = useState('');
  const [briefAlpha, setBriefAlpha] = useState(true);
  const [generatedBrief, setGeneratedBrief] = useState<{
    requestId: string;
    inboxPath: string;
    promptText: string;
    requestPath: string;
  } | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Inbox import role map
  const [inboxRole, setInboxRole] = useState<AssetRole>('prop');

  const handleFileUpload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      await api.uploadAsset(projectId, file, {
        role: uploadRole,
        classification: uploadRole === 'reference' ? 'REFERENCE ONLY' : 'PRODUCTION ASSET',
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleCreateBrief = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!briefTitle.trim() || !briefDesc.trim()) return;
    setError(null);
    try {
      const res = await api.createAssetBrief(projectId, {
        title: briefTitle.trim(),
        role: briefRole,
        eraAndSetting: briefEra.trim(),
        visualDescription: briefDesc.trim(),
        requireAlpha: briefAlpha,
        targetWidth: 1024,
        targetHeight: 1024,
      });
      setGeneratedBrief(res);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInboxImport = async (filename: string) => {
    setError(null);
    try {
      await api.importFromInbox(projectId, { inboxFilename: filename, role: inboxRole });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20 }}>Tài nguyên & Tạo ảnh (Anti Bridge)</h1>
        <div className="field-hint">
          Tách biệt rạch ròi `PRODUCTION ASSET` và `REFERENCE ONLY`. Hệ thống kiểm tra SHA-256 và chặn tái sử dụng media mẫu từ vendor.
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 14 }}>
        {/* Upload Card */}
        <div
          className="card"
          style={{
            borderStyle: dragOver ? 'dashed' : 'solid',
            borderColor: dragOver ? 'var(--primary)' : 'var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFileUpload(f);
          }}
        >
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Upload size={16} />
            <span>Nhập PNG / JPEG / WAV / M4A</span>
          </h2>
          <label className="field">
            <span className="field-label">Vai trò tài nguyên (Asset Role)</span>
            <select className="select" value={uploadRole} onChange={(e) => setUploadRole(e.target.value as AssetRole)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="btn btn-primary" style={{ width: 'fit-content' }}>
            <Upload size={15} />
            <span>{uploading ? 'Đang kiểm tra & nhập...' : 'Chọn tệp từ máy (hoặc kéo thả vào đây)'}</span>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.wav,.m4a,.mp3"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileUpload(f);
                e.target.value = '';
              }}
            />
          </label>
          <span className="field-hint">
            Backend tự động tính SHA-256, kích thước, và kiểm tra kênh trong suốt RGBA thực sự.
          </span>
        </div>

        {/* Agent-assisted Brief Generator */}
        <form className="card" onSubmit={handleCreateBrief} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ImagePlus size={16} />
            <span>Chuẩn bị yêu cầu ảnh cho Anti</span>
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="field">
              <span className="field-label">Tên tài nguyên</span>
              <input
                className="input"
                value={briefTitle}
                onChange={(e) => setBriefTitle(e.target.value)}
                placeholder="VD: Gladiator Shield"
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Role</span>
              <select className="select" value={briefRole} onChange={(e) => setBriefRole(e.target.value as AssetRole)}>
                {ROLES.filter((r) => !r.value.startsWith('audio_')).map((r) => (
                  <option key={r.value} value={r.value}>{r.value}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field-label">Bối cảnh & Thời đại</span>
            <input className="input" value={briefEra} onChange={(e) => setBriefEra(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field-label">Mô tả hình ảnh & góc nhìn</span>
            <textarea
              className="textarea"
              style={{ minHeight: 60 }}
              value={briefDesc}
              onChange={(e) => setBriefDesc(e.target.value)}
              placeholder="Mô tả chi tiết dáng, biểu cảm, vật liệu..."
              required
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={briefAlpha} onChange={(e) => setBriefAlpha(e.target.checked)} />
            <span>Yêu cầu nền trong suốt RGBA (tách layer để animate)</span>
          </label>
          <button type="submit" className="btn btn-primary">
            Chuẩn bị yêu cầu ảnh (Lưu asset-request.json)
          </button>

          {generatedBrief && (
            <div style={{ padding: 10, background: 'var(--surface-subtle)', borderRadius: 8, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <strong>Đã chuẩn bị ({generatedBrief.requestId})</strong> — lưu tại <code>{generatedBrief.requestPath}</code>.
                Gửi prompt dưới đây cho Anti để tạo ảnh vào thư mục inbox: <code>{generatedBrief.inboxPath}</code>.
              </div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: '#fff', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                {generatedBrief.promptText}
              </pre>
              <button
                type="button"
                className="btn btn-sm"
                style={{ width: 'fit-content' }}
                onClick={() => {
                  void navigator.clipboard.writeText(generatedBrief.promptText);
                  setCopiedPrompt(true);
                  setTimeout(() => setCopiedPrompt(false), 1800);
                }}
              >
                {copiedPrompt ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedPrompt ? 'Đã copy prompt' : 'Copy prompt'}</span>
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Inbox Import */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <h2 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Inbox size={16} />
            <span>Hộp thư đến (assets/inbox: {inboxFiles.length} tệp)</span>
          </h2>
          <select className="select" style={{ width: 'auto' }} value={inboxRole} onChange={(e) => setInboxRole(e.target.value as AssetRole)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>Role nhập: {r.value}</option>
            ))}
          </select>
        </div>
        {inboxFiles.length === 0 ? (
          <div className="field-hint">
            Chưa có tệp chờ trong <code>assets/inbox/</code>. Sau khi Anti tạo ảnh vào inbox, bấm Nhập kết quả.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {inboxFiles.map((f) => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
                <span>{f}</span>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleInboxImport(f)}>
                  <Download size={13} />
                  <span>Nhập kết quả</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Asset Gallery */}
      <div className="card">
        <h2 className="card-title">Danh sách tài nguyên dự án ({assets.length})</h2>
        {assets.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
            Chưa có ảnh — Tạo yêu cầu ảnh với Anti hoặc nhập PNG
          </div>
        ) : (
          <div className="assets-grid">
            {assets.map((a) => (
              <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="asset-thumb">
                  {a.mimeType.startsWith('image/') ? (
                    <img src={`/api/media/${projectId}/${a.relativePath}`} alt={a.filename} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: 'var(--primary)' }}>
                      <FileAudio size={28} />
                      <span style={{ fontSize: 12 }}>{a.mimeType}</span>
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.filename}>
                  {a.filename}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <span className="badge badge-neutral">{a.role}</span>
                  <span className={`badge ${a.classification === 'REFERENCE ONLY' ? 'badge-warning' : 'badge-success'}`}>
                    {a.classification}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {a.width && a.height ? `${a.width}x${a.height} · ` : ''}
                  {(a.sizeBytes / 1024).toFixed(1)} KB
                  {a.hasAlpha !== undefined && ` · Alpha: ${a.transparentExterior ? 'RGBA OK' : 'Solid'}`}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  SHA: {a.sha256.slice(0, 12)}… · {a.provenance.source}
                </div>
                {a.provenance.notes && (
                  <div style={{ fontSize: 11, color: a.provenance.notes.includes('CẢNH BÁO') ? 'var(--warning)' : 'var(--muted)' }}>
                    {a.provenance.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
