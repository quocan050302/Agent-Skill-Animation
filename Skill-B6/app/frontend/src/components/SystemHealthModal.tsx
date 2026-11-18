import React from 'react';
import { CheckCircle2, RefreshCw, X, XCircle } from 'lucide-react';
import type { DoctorReportDto, UpstreamInfoDto } from '../api/client';

interface SystemHealthModalProps {
  mode: 'settings' | 'help';
  doctor: DoctorReportDto | null;
  upstream: UpstreamInfoDto | null;
  onClose: () => void;
  onRefreshDoctor: () => Promise<void>;
}

export const SystemHealthModal: React.FC<SystemHealthModalProps> = ({
  mode,
  doctor,
  upstream,
  onClose,
  onRefreshDoctor,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'settings' ? 'Kiểm tra hệ thống & Cài đặt' : 'Hướng dẫn B6 Local Studio'}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(23, 33, 47, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 60,
      }}
    >
      <div className="card" style={{ width: 'min(720px, 100%)', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            {mode === 'settings' ? 'Kiểm tra hệ thống (Environment Doctor & Upstream)' : 'Hướng dẫn sử dụng & Quy trình B6'}
          </h2>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Đóng">
            <X size={16} />
          </button>
        </div>

        {mode === 'settings' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={`badge ${doctor?.ok ? 'badge-success' : 'badge-danger'}`}>
                {doctor?.ok ? 'Hệ thống sẵn sàng' : 'Có lỗi môi trường'}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => void onRefreshDoctor()}>
                <RefreshCw size={14} />
                <span>Chạy lại Doctor</span>
              </button>
            </div>

            {doctor && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                <div style={{ padding: 10, background: 'var(--surface-subtle)', borderRadius: 8 }}>
                  <div><strong>App Root:</strong> <code>{doctor.appRoot}</code></div>
                  <div><strong>Projects Root:</strong> <code>{doctor.projectsDir}</code></div>
                  <div><strong>Dung lượng trống:</strong> {doctor.disk.freeGiB} GiB {doctor.disk.lowSpaceWarning ? '(Cảnh báo dưới 10 GiB)' : '(Đạt chuẩn)'}</div>
                  <div><strong>Địa chỉ local:</strong> <code>http://127.0.0.1:4310</code> (localhost-only, không công khai LAN)</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 8 }}>
                  {[
                    { label: 'Node.js', ok: doctor.executables.node.ok, detail: doctor.executables.node.version },
                    { label: 'Python + NumPy/PIL/CV2', ok: doctor.executables.python.ok, detail: `${doctor.executables.python.version} (${doctor.executables.python.numpy ?? '?'})` },
                    { label: 'FFmpeg', ok: doctor.executables.ffmpeg.ok, detail: `${doctor.executables.ffmpeg.version.slice(0, 36)} (shim: ${doctor.executables.ffmpeg.compatShimActive ? 'Bật' : 'Tắt'})` },
                    { label: 'FFprobe', ok: doctor.executables.ffprobe.ok, detail: doctor.executables.ffprobe.version.slice(0, 36) },
                  ].map((item) => (
                    <div key={item.label} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      {item.ok ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />}
                      <div>
                        <div style={{ fontWeight: 600 }}>{item.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {upstream && (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Upstream B6 Checkout (Read-Only)</div>
                    <div style={{ fontSize: 12 }}>
                      <div>Repo: <code>{upstream.repoUrl}</code> ({upstream.branch})</div>
                      <div>Commit SHA: <code>{upstream.commitSha}</code></div>
                      <div>Primary Reference: <code>{upstream.primaryReference.id}</code> — Verified: {upstream.primaryReference.verified ? 'PASS' : 'MISMATCH'}</div>
                      <div>Pack Integrity: {upstream.packCheck.ok ? `PASS (${upstream.packCheck.files} files)` : 'FAIL'}</div>
                    </div>
                  </div>
                )}

                <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
                  <div><strong>Tạo ảnh:</strong> {doctor.capabilities.imageGenerationRoute}</div>
                  <div><strong>Giọng đọc (TTS):</strong> {doctor.capabilities.ttsRoute}</div>
                  <div><strong>Renderer:</strong> {doctor.capabilities.codeRenderer}</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <p style={{ margin: 0 }}>
              <strong>B6 Local Studio</strong> điều phối quy trình dựng hoạt hình 2D bằng code Python/NumPy/Pillow/OpenCV từ repository <code>stickman-video-director</code>.
            </p>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li><strong>Dự án mới:</strong> Khởi tạo dự án qua CLI B6 (`stage: needs_authoring`), không dùng clip mẫu thay phim mới.</li>
              <li><strong>Kịch bản & Phân cảnh:</strong> Chỉnh sửa narration, shots, camera keyframes và phụ đề 1 dòng trong Inspector. Tự động lưu + <code>Ctrl+S</code>.</li>
              <li><strong>Tài nguyên & Tạo ảnh:</strong> Tạo brief yêu cầu ảnh cho Anti hoặc nhập PNG RGBA vào `assets/inbox/`. Không dùng lại pixel mẫu từ vendor.</li>
              <li><strong>Nhân vật & Rig:</strong> Kiểm tra khớp vai, cổ, `cuff` và chạy <code>Preflight</code>. Lưu ý: động tác đi/chạy cần author gait riêng.</li>
              <li><strong>Xem thử & QA:</strong> Validate → Draft 0.5x/0.75x → Preview Native MP4 → Review Pack (35 mục) → Phê duyệt thủ công → Xuất Video Full MP4.</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
};
