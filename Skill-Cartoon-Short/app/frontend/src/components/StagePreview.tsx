import React, { useEffect, useRef, useState } from 'react';
import type { ExportMeta, StudioProject, SubtitleCuePreview } from '../types';

interface StagePreviewProps {
  project: StudioProject;
  currentFrame: number;
  onFrameChange: (frame: number) => void;
  showSafeZone: boolean;
  subtitleCue: SubtitleCuePreview | null;
  activeExport: ExportMeta | null;
  playerMode: 'engine' | 'mp4';
  onPlayerModeChange: (mode: 'engine' | 'mp4') => void;
}

export function StagePreview({
  project,
  currentFrame,
  onFrameChange,
  showSafeZone,
  subtitleCue,
  activeExport,
  playerMode,
  onPlayerModeChange,
}: StagePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pollRef = useRef<number | null>(null);
  const [scale, setScale] = useState(360 / 1080);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // Compute exact CSS scale from 1080px native Three.js canvas to container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / 1080);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [playerMode]);

  // Reset engine readiness when story changes
  useEffect(() => {
    setEngineReady(false);
    setEngineError(null);
  }, [project.engineUrl, playerMode]);

  // Render exact requested frame inside real Three.js WebGL iframe
  useEffect(() => {
    if (playerMode !== 'engine' || !engineReady) return;
    const win = iframeRef.current?.contentWindow as any;
    if (win && win.ready && typeof win.renderFrame === 'function') {
      try {
        win.renderFrame(currentFrame);
      } catch (err) {
        setEngineError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [currentFrame, engineReady, playerMode]);

  const handleIframeLoad = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const started = Date.now();
    pollRef.current = window.setInterval(() => {
      const win = iframeRef.current?.contentWindow as any;
      if (win?.err) {
        if (pollRef.current !== null) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setEngineError(String(win.err));
        return;
      }
      if (win?.ready && typeof win.renderFrame === 'function') {
        if (pollRef.current !== null) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setEngineReady(true);
        try {
          win.renderFrame(currentFrame);
        } catch {
          // handled on frame effect
        }
        return;
      }
      if (Date.now() - started > 20000) {
        if (pollRef.current !== null) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setEngineError('Timed out waiting for Three.js WebGL engine initialization.');
      }
    }, 60);
  };

  const timeSec = currentFrame / 30;
  const linesByIndex = new Map<number, SubtitleCuePreview['words']>();
  if (subtitleCue?.active && project.captionsEnabled) {
    for (const w of subtitleCue.words) {
      const list = linesByIndex.get(w.line) || [];
      list.push(w);
      linesByIndex.set(w.line, list);
    }
  }

  return (
    <section className="panel stage-viewport-shell" aria-label="9:16 Video Preview Stage">
      <div className="panel-header" style={{ width: '100%', marginBottom: 0 }}>
        <div>
          <h2 className="panel-title">Live 9:16 Stage</h2>
          <p className="helper" style={{ marginTop: 2 }}>
            {project.aspectRatio} · 1080×1920 · 30 FPS · Frame {currentFrame} / {Math.max(0, project.totalFrames - 1)} (
            {timeSec.toFixed(2)}s)
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className={`btn ${playerMode === 'engine' ? 'btn-active' : ''}`}
            onClick={() => onPlayerModeChange('engine')}
          >
            Live Engine
          </button>
          <button
            type="button"
            className={`btn ${playerMode === 'mp4' ? 'btn-active' : ''}`}
            disabled={!activeExport}
            aria-describedby={!activeExport ? 'mp4-disabled-hint' : undefined}
            onClick={() => onPlayerModeChange('mp4')}
          >
            Verified MP4
          </button>
        </div>
      </div>
      {!activeExport && (
        <span id="mp4-disabled-hint" className="visually-hidden">
          Complete a verified render in Step 4 to unlock MP4 playback.
        </span>
      )}

      <div ref={containerRef} className="stage-frame-9x16">
        {playerMode === 'mp4' && activeExport ? (
          <video
            key={activeExport.exportId}
            className="stage-video"
            controls
            playsInline
            src={activeExport.downloadUrl}
            aria-label={`Verified exported video for ${project.title}`}
          />
        ) : project.engineUrl ? (
          <div className="stage-iframe-scaler">
            <iframe
              ref={iframeRef}
              title={`Real Three.js 9:16 Renderer for ${project.title}`}
              src={project.engineUrl}
              className="stage-iframe"
              style={{ transform: `scale(${scale})` }}
              onLoad={handleIframeLoad}
            />
            {showSafeZone && (
              <div className="safe-zone-guide" aria-hidden="true">
                <span className="safe-zone-tag">9:16 SHORTS SAFE ZONE</span>
              </div>
            )}
            {project.captionsEnabled && subtitleCue?.active && (
              <div className="cartoon-sub-overlay" aria-live="off">
                {Array.from(linesByIndex.entries())
                  .sort((a, b) => a[0] - b[0])
                  .map(([lineIdx, words]) => (
                    <div key={lineIdx}>
                      {words.map((w, wi) => (
                        <span
                          key={`${lineIdx}-${wi}`}
                          className={`sub-word ${w.isPunch && (w.active || w.spokenPunch) ? 'punch' : w.active ? 'active' : ''}`}
                        >
                          {w.text}
                        </span>
                      ))}
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <div className="dialog-body">
            <p className="alert-box alert-err">Engine not hydrated. Run npm run setup to hydrate WebGL story assets.</p>
          </div>
        )}
      </div>

      {engineError && <p className="alert-box alert-err" style={{ width: '100%' }}>{engineError}</p>}

      {playerMode === 'engine' && (
        <div style={{ width: '100%' }}>
          <label className="field-label" htmlFor="stage-frame-scrubber">
            Frame Scrubber ({currentFrame} / {Math.max(0, project.totalFrames - 1)} · {timeSec.toFixed(2)}s)
          </label>
          <input
            id="stage-frame-scrubber"
            type="range"
            min={0}
            max={Math.max(0, project.totalFrames - 1)}
            value={currentFrame}
            onChange={(e) => onFrameChange(Number(e.target.value))}
          />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="helper">
              {engineReady ? 'WebGL Three.js + Ink + DOF Ready' : 'Initializing Three.js WebGL...'}
            </span>
            <span className="pill">{project.captionsEnabled ? 'SUB PREVIEW ON' : 'SUB OFF'}</span>
          </div>
        </div>
      )}
    </section>
  );
}
