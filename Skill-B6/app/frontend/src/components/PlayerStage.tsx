import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Pause,
  Play,
  Plus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Ratio, ShotItem } from '@b6-studio/shared';
import type { EditorBindingStatusDto, OutputArtifactDto, ReviewStateDto } from '../api/client';

interface PlayerStageProps {
  projectId: string;
  ratio: Ratio;
  outputs: OutputArtifactDto[];
  selectedOutputId: string | null;
  onSelectOutput: (id: string) => void;
  shots: ShotItem[];
  captions: Array<{ start: number; end: number; text: string }>;
  selectedShotIndex: number;
  onSelectShot: (idx: number) => void;
  onAddShot: () => void;
  missingItems: string[];
  reviewState?: ReviewStateDto | null;
  editorBinding?: EditorBindingStatusDto | null;
}

export const PlayerStage: React.FC<PlayerStageProps> = ({
  ratio,
  outputs,
  selectedOutputId,
  onSelectOutput,
  shots,
  captions,
  selectedShotIndex,
  onSelectShot,
  onAddShot,
  missingItems,
  reviewState,
  editorBinding,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fitScreen, setFitScreen] = useState(true);
  const [showMotionOverlay, setShowMotionOverlay] = useState(false);

  const activeOutput = outputs.find((o) => o.id === selectedOutputId) ?? outputs.find((o) => o.videoUrl) ?? outputs[0] ?? null;
  const activeVideoUrl = activeOutput?.videoUrl ?? null;
  const currentShot =
    shots.find((s) => currentTime >= s.start && currentTime < s.end) ??
    shots[selectedShotIndex] ??
    shots[0] ??
    null;

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [activeVideoUrl]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const stepFrame = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setPlaying(false);
    const next = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta / 30));
    v.currentTime = next;
    setCurrentTime(next);
  };

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const f = Math.floor((sec % 1) * 30);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };

  const activeCaption = captions.find((c) => currentTime >= c.start && currentTime < c.end);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="player-container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="section-label" style={{ margin: 0 }}>Xem thử ({ratio})</span>
            {activeOutput && (
              <>
                <span className="badge badge-neutral">
                  {activeOutput.kind.toUpperCase()} · {activeOutput.id}
                </span>
                <span
                  className={`badge ${
                    activeOutput.verificationStatus === 'current'
                      ? 'badge-success'
                      : activeOutput.verificationStatus === 'corrupt'
                      ? 'badge-danger'
                      : activeOutput.verificationStatus === 'stale'
                      ? 'badge-warning'
                      : 'badge-neutral'
                  }`}
                  data-testid="output-freshness-badge"
                >
                  {activeOutput.verificationStatus === 'current'
                    ? 'Current PASS'
                    : activeOutput.verificationStatus === 'stale'
                    ? 'Preview STALE (Cần render lại)'
                    : activeOutput.verificationStatus === 'corrupt'
                    ? 'Corrupt / FAIL'
                    : 'Draft lịch sử'}
                </span>
              </>
            )}
            {editorBinding && (
              <span
                className={`badge ${
                  editorBinding.syncState === 'applied_to_renderer' || editorBinding.syncState === 'bound_current'
                    ? 'badge-success'
                    : editorBinding.syncState === 'preview_stale' || editorBinding.syncState === 'voice_needs_regeneration'
                    ? 'badge-warning'
                    : 'badge-neutral'
                }`}
                data-testid="editor-sync-badge"
              >
                {editorBinding.syncState === 'applied_to_renderer'
                  ? 'Applied to renderer'
                  : editorBinding.syncState === 'bound_current'
                  ? 'Bound (chờ render)'
                  : editorBinding.syncState === 'preview_stale'
                  ? 'Preview stale'
                  : editorBinding.syncState === 'voice_needs_regeneration'
                  ? 'Voice needs regeneration'
                  : editorBinding.syncState === 'manual_scene_only'
                  ? 'Manual scene (needs authoring)'
                  : 'Chưa biên soạn'}
                {' · '}rev {editorBinding.revision}
              </span>
            )}
          </div>
          {reviewState && reviewState.technicalStatus === 'stale' && activeOutput?.verificationStatus === 'stale' && (
            <div style={{ width: '100%', fontSize: 12, color: 'var(--warning)' }}>
              Dữ liệu chỉnh sửa hiện tại khác với bản render đang phát — hãy bấm <strong>Render Preview Native MP4</strong> để xem thay đổi mới nhất.
            </div>
          )}
          {outputs.length > 0 && (
            <select
              aria-label="Chọn bản render để xem"
              className="select"
              style={{ width: 'auto', minWidth: 200 }}
              value={activeOutput?.id ?? ''}
              onChange={(e) => onSelectOutput(e.target.value)}
            >
              {outputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id} ({o.kind} · {o.ratio})
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className={`btn btn-sm ${showMotionOverlay ? 'btn-primary' : ''}`}
            data-testid="toggle-motion-overlay"
            onClick={() => setShowMotionOverlay((v) => !v)}
          >
            <span>{showMotionOverlay ? 'Ẩn Motion Overlay' : 'Motion Overlay'}</span>
          </button>
        </div>

        <div className="player-viewport" style={{ position: 'relative' }}>
          {showMotionOverlay && currentShot && (
            <div
              data-testid="motion-diagnostic-overlay"
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                zIndex: 4,
                background: 'rgba(15, 23, 42, 0.86)',
                color: '#F8FAFC',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                pointerEvents: 'none',
                border: '1px solid rgba(148, 163, 184, 0.35)',
              }}
            >
              <div>
                <strong>{currentShot.id}</strong> · {currentShot.motion?.preset ?? 'legacy'} · cam:{' '}
                {currentShot.cameraPreset ?? currentShot.motion?.cameraPreset ?? 'establish'} · beat:{' '}
                {currentShot.visualBeat ?? currentShot.motion?.visualBeat ?? 'action'}
              </div>
              {currentShot.motion?.gait && (
                <div>
                  cadence {currentShot.motion.gait.cadenceHz}Hz · stride {currentShot.motion.gait.strideLen}px ·
                  facing {currentShot.motion.gait.facing > 0 ? '+1' : '-1'} ·{' '}
                  {editorBinding?.motionEngineMode ?? 'legacy_stance'}
                </div>
              )}
            </div>
          )}
          {activeVideoUrl ? (
            <video
              ref={videoRef}
              src={activeVideoUrl}
              className={`player-video ${ratio === '9:16' ? 'ratio-9-16' : 'ratio-16-9'}`}
              style={fitScreen ? undefined : { maxHeight: 'none' }}
              muted={muted}
              playsInline
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
              onEnded={() => setPlaying(false)}
            />
          ) : activeOutput?.contactSheetUrl ? (
            <img
              src={activeOutput.contactSheetUrl}
              alt={`Contact sheet ${activeOutput.id}`}
              style={{ maxWidth: '100%', maxHeight: 460, objectFit: 'contain' }}
            />
          ) : (
            <div style={{ color: '#CBD5E1', textAlign: 'center', padding: 24, maxWidth: 420 }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: '#FFFFFF' }}>
                Chưa có bản render thật để phát
              </div>
              {missingItems.length > 0 ? (
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  Chưa đủ dữ liệu để preview — còn thiếu: {missingItems.join(', ')}.
                </div>
              ) : (
                <div style={{ fontSize: 13 }}>
                  Dữ liệu đã sẵn sàng. Bấm <strong>Draft</strong> hoặc <strong>Preview</strong> ở thanh công cụ bên dưới để render bằng B6 code engine.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="player-controls">
          <button
            type="button"
            className="btn btn-sm"
            onClick={togglePlay}
            disabled={!activeVideoUrl}
            aria-label={playing ? 'Tạm dừng' : 'Phát'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
            <span>{playing ? 'Tạm dừng' : 'Phát'}</span>
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => stepFrame(-1)}
            disabled={!activeVideoUrl}
            aria-label="Lùi 1 frame"
            title="Lùi 1 frame (1/30s)"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => stepFrame(1)}
            disabled={!activeVideoUrl}
            aria-label="Tiến 1 frame"
            title="Tiến 1 frame (1/30s)"
          >
            <ChevronRight size={16} />
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <input
            type="range"
            aria-label="Thanh tua thời gian"
            className="player-scrubber"
            min={0}
            max={duration || 10}
            step={1 / 30}
            value={currentTime}
            disabled={!activeVideoUrl}
            onChange={(e) => seekTo(Number(e.target.value))}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Bật tiếng' : 'Tắt tiếng'}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            aria-label="Âm lượng"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            style={{ width: 68 }}
            onChange={(e) => {
              const val = Number(e.target.value);
              setVolume(val);
              setMuted(val === 0);
              if (videoRef.current) videoRef.current.volume = val;
            }}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setFitScreen((f) => !f)}
            aria-label="Fit to screen"
            title="Khớp màn hình"
          >
            <Maximize2 size={15} />
          </button>
        </div>

        {activeCaption && (
          <div style={{ fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <strong>Phụ đề tại {currentTime.toFixed(2)}s:</strong> “{activeCaption.text}”
          </div>
        )}
      </div>

      {/* Shot Timeline */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div className="section-label" style={{ margin: 0 }}>Phân cảnh & Timeline ({shots.length} shots)</div>
            <div className="field-hint">Nhấn vào từng shot để chỉnh sửa trong Inspector; phụ đề ({captions.length} câu) hiển thị theo thời gian thực.</div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onAddShot}>
            <Plus size={15} />
            <span>Thêm shot</span>
          </button>
        </div>

        {shots.length === 0 ? (
          <div style={{ padding: 14, background: 'var(--surface-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--muted)' }}>
            Chưa có phân cảnh nào cho tỷ lệ {ratio}. Bấm <strong>Thêm shot</strong> để bắt đầu dàn cảnh.
          </div>
        ) : (
          <div className="timeline-strip">
            {shots.map((shot, idx) => (
              <button
                key={`${shot.id}-${idx}`}
                type="button"
                className={`shot-block ${idx === selectedShotIndex ? 'selected' : ''}`}
                onClick={() => {
                  onSelectShot(idx);
                  if (videoRef.current && duration > 0) {
                    seekTo(Math.min(duration, shot.start));
                  }
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 12 }}>
                  <strong>{shot.id}</strong>
                  <span style={{ color: 'var(--muted)' }}>
                    {shot.start.toFixed(1)}–{shot.end.toFixed(1)}s
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shot.action}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {shot.actor || 'Cảnh nền'} · {shot.expression || 'neutral'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
