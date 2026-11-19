import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, studioApi } from './api/client';
import { ProjectLibrary } from './components/ProjectLibrary';
import { SettingsDialog } from './components/SettingsDialog';
import { StagePreview } from './components/StagePreview';
import type {
  AudioArtifactMeta,
  ContractResponse,
  ExportMeta,
  ExportQaReport,
  HealthResponse,
  RenderJob,
  StudioProject,
  SubtitleCuePreview,
} from './types';

const ACTIVE_PROJECT_KEY = 'cartoon-short-studio:active-project-id';
const TERMINAL_JOB_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'BLOCKED', 'INTERRUPTED']);

export function App() {
  const [surface, setSurface] = useState<'studio' | 'library'>('studio');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [contract, setContract] = useState<ContractResponse | null>(null);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [project, setProject] = useState<StudioProject | null>(null);
  const [activeStep, setActiveStep] = useState<number>(1);

  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [statusNotice, setStatusNotice] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Step 1: Script & Voice
  const [previewAudio, setPreviewAudio] = useState<AudioArtifactMeta | null>(null);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  // Step 2 & 3: Preview, Safe Zone, Timing, Subtitles
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [subtitleCue, setSubtitleCue] = useState<SubtitleCuePreview | null>(null);
  const [timingBusy, setTimingBusy] = useState(false);

  // Step 4 & 5: Render Job, QA & Export
  const [activeJob, setActiveJob] = useState<RenderJob | null>(null);
  const [renderSubmitting, setRenderSubmitting] = useState(false);
  const [selectedExport, setSelectedExport] = useState<ExportMeta | null>(null);
  const [exportQa, setExportQa] = useState<ExportQaReport | null>(null);
  const [playerMode, setPlayerMode] = useState<'engine' | 'mp4'>('engine');

  const saveTimerRef = useRef<number | null>(null);
  const sseCleanupRef = useRef<(() => void) | null>(null);

  const refreshSystem = useCallback(async () => {
    const [h, c, list] = await Promise.all([
      studioApi.getHealth(),
      studioApi.getContract(),
      studioApi.listProjects(),
    ]);
    setHealth(h);
    setContract(c);
    setProjects(list);
    return list;
  }, []);

  const openProjectById = useCallback(async (projectId: string) => {
    const loaded = await studioApi.getProject(projectId);
    setProject(loaded);
    setCurrentFrame(0);
    setPreviewAudio(null);
    setPlayerMode('engine');
    setSaveState('saved');
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, loaded.projectId);
    document.title = `${loaded.title} | Cartoon Short Studio`;

    const latestExport = loaded.exports[0] || null;
    setSelectedExport(latestExport);
    if (latestExport) {
      studioApi
        .getExportQa(loaded.projectId, latestExport.exportId)
        .then(setExportQa)
        .catch(() => setExportQa(null));
    } else {
      setExportQa(null);
    }

    const jobs = await studioApi.listJobs(loaded.projectId);
    setActiveJob(jobs[0] || null);
  }, []);

  // Initial load & reload persistence
  useEffect(() => {
    let mounted = true;
    refreshSystem()
      .then(async (list) => {
        if (!mounted || list.length === 0) return;
        const urlPid = new URLSearchParams(window.location.search).get('project');
        const savedPid = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
        const preferred =
          list.find((p) => p.projectId === urlPid) ||
          list.find((p) => p.projectId === savedPid) ||
          list.find((p) => p.projectId === 'ghost-army-ww2-30s') ||
          list[0];
        await openProjectById(preferred.projectId);
      })
      .catch((err) => {
        if (mounted) setErrorBanner(err instanceof Error ? err.message : String(err));
      });
    return () => {
      mounted = false;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (sseCleanupRef.current) sseCleanupRef.current();
    };
  }, [refreshSystem, openProjectById]);

  // Live timed subtitle cue sync for Step 3 StagePreview
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const timeSec = currentFrame / 30;
    studioApi
      .getSubtitlePreview(project.projectId, timeSec)
      .then((res) => {
        if (!cancelled) setSubtitleCue(res.cue);
      })
      .catch(() => {
        if (!cancelled) setSubtitleCue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [project?.projectId, project?.captionsEnabled, project?.scriptText, project?.latestTiming?.timingId, currentFrame]);

  // Subscribe to SSE progress whenever an active non-terminal job exists
  useEffect(() => {
    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }
    if (!activeJob || TERMINAL_JOB_STATES.has(activeJob.stage)) return;

    const unsub = studioApi.subscribeJobEvents(activeJob.jobId, async (nextJob) => {
      setActiveJob(nextJob);
      if (nextJob.stage === 'COMPLETED' && nextJob.exportMeta && project) {
        setStatusNotice(`Render verified and published (${nextJob.exportId}).`);
        const refreshed = await studioApi.getProject(project.projectId);
        setProject(refreshed);
        setSelectedExport(nextJob.exportMeta);
        setPlayerMode('mp4');
        const qa = await studioApi.getExportQa(project.projectId, nextJob.exportMeta.exportId);
        setExportQa(qa);
        setActiveStep(5);
      } else if (TERMINAL_JOB_STATES.has(nextJob.stage) && nextJob.error) {
        setErrorBanner(`${nextJob.stage}: ${nextJob.error}`);
      }
    });
    sseCleanupRef.current = unsub;
    return () => unsub();
  }, [activeJob?.jobId, activeJob?.stage, project?.projectId]);

  // Debounced per-project mutation saver (never autosaves to wrong project)
  const queueProjectPatch = useCallback(
    (patch: Record<string, unknown>, immediate = false) => {
      if (!project) return;
      const targetProjectId = project.projectId;
      setProject((prev) => (prev && prev.projectId === targetProjectId ? { ...prev, ...patch } as StudioProject : prev));
      setSaveState('dirty');
      setErrorBanner(null);

      const commit = async () => {
        setSaveState('saving');
        try {
          const updated = await studioApi.updateProject(targetProjectId, patch);
          setProject((prev) => (prev && prev.projectId === targetProjectId ? updated : prev));
          setProjects((list) => list.map((item) => (item.projectId === updated.projectId ? updated : item)));
          setSaveState('saved');
        } catch (err) {
          setSaveState('error');
          setErrorBanner(err instanceof Error ? err.message : String(err));
        }
      };

      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (immediate) {
        void commit();
      } else {
        saveTimerRef.current = window.setTimeout(() => {
          void commit();
        }, 420);
      }
    },
    [project]
  );

  // Step 1 Actions
  const handlePreviewVoice = async () => {
    if (!project) return;
    setTtsBusy(true);
    setErrorBanner(null);
    setStatusNotice(`Generating short voice preview (${project.voiceId})...`);
    try {
      const sample = project.scriptText.trim().slice(0, 140) || undefined;
      const res = await studioApi.previewVoice({
        projectId: project.projectId,
        voice: project.voiceId,
        text: sample,
        model: project.ttsModel || undefined,
      });
      setPreviewAudio(res.artifact);
      setStatusNotice(`Voice sample ready (${res.artifact.voice}, ${res.artifact.durationSec}s).`);
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTtsBusy(false);
    }
  };

  const handleGenerateTts = async () => {
    if (!project) return;
    setTtsBusy(true);
    setErrorBanner(null);
    setStatusNotice(`Synthesizing full narration with Gemini TTS (${project.voiceId})...`);
    try {
      const res = await studioApi.generateProjectTts(project.projectId, {
        scriptText: project.scriptText,
        voice: project.voiceId,
        model: project.ttsModel || undefined,
      });
      setProject(res.project);
      setStatusNotice(`Narration generated (${res.artifact.durationSec}s · ${res.artifact.model}).`);
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTtsBusy(false);
    }
  };

  const handleAudioUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !project) return;
    setUploadBusy(true);
    setErrorBanner(null);
    setStatusNotice(`Importing and validating ${file.name}...`);
    try {
      const res = await studioApi.importAudio(project.projectId, file);
      setProject(res.project);
      setStatusNotice(`Imported ${res.artifact.originalFilename || file.name} (${res.artifact.durationSec}s, normalized 48 kHz WAV).`);
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : String(err));
    } finally {
      setUploadBusy(false);
    }
  };

  // Step 3 Action
  const handleRunTiming = async () => {
    if (!project) return;
    setTimingBusy(true);
    setErrorBanner(null);
    setStatusNotice('Running FFprobe & timing_validator.py alignment...');
    try {
      const res = await studioApi.runTiming(project.projectId);
      setProject(res.project);
      setStatusNotice(
        `Aligned ${res.timing.wordCount} words (${res.timing.audioDurationSec}s, ${res.timing.alignmentPrecision}).`
      );
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTimingBusy(false);
    }
  };

  // Step 4 Actions
  const isJobRunning = Boolean(activeJob && !TERMINAL_JOB_STATES.has(activeJob.stage));

  const handleStartRender = async () => {
    if (!project || isJobRunning || renderSubmitting) return;
    setRenderSubmitting(true);
    setErrorBanner(null);
    try {
      const res = await studioApi.startRender(project.projectId);
      setActiveJob(res.job);
      setStatusNotice(`Render job ${res.job.jobId} started (${res.job.frameCount} frames).`);
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRenderSubmitting(false);
    }
  };

  const handleCancelRender = async () => {
    if (!activeJob) return;
    try {
      const canceled = await studioApi.cancelJob(activeJob.jobId);
      setActiveJob(canceled);
      setStatusNotice(`Canceled job ${canceled.jobId}.`);
    } catch (err) {
      setErrorBanner(err instanceof ApiError ? err.message : String(err));
    }
  };

  const jumpToStep = (step: number) => {
    setActiveStep(step);
    const el = document.getElementById(`studio-step-${step}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const stepSummary = [
    { num: 1, title: '1. Script & Voice', status: project?.sourceAudioMeta ? `${project.sourceAudioMeta.durationSec}s` : 'Needs audio' },
    { num: 2, title: '2. Video Settings', status: `${project?.aspectRatio || '9:16'} · ${project?.captionsEnabled ? 'SUB ON' : 'SUB OFF'}` },
    { num: 3, title: '3. Timing & Preview', status: project?.latestTiming ? project.latestTiming.alignmentPrecision : 'Ready' },
    { num: 4, title: '4. Render & Mix', status: activeJob ? activeJob.stage : 'Idle' },
    { num: 5, title: '5. QA & Export', status: selectedExport ? selectedExport.qaStatus : 'Pending' },
  ];

  const ttsKeyReady = Boolean(health?.tts?.hasKey);
  const activeAudio =
    project?.narrationSource === 'import'
      ? project.importedAudioMeta || project.sourceAudioMeta
      : project?.ttsAudioMeta || project?.sourceAudioMeta;

  return (
    <>
      <a href="#main-workspace" className="skip-link visually-hidden">
        Skip to studio workspace
      </a>

      <header className="topbar">
        <div className="brand-group">
          <h1 className="brand-title">Cartoon Short Studio</h1>
          <span className="pill pill-accent">9:16 · 1080×1920 · 30 FPS</span>
          {project && surface === 'studio' && (
            <span className={`pill ${saveState === 'error' ? 'pill-err' : saveState === 'saved' ? 'pill-ok' : 'pill-warn'}`}>
              {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved' : 'Save error'}
            </span>
          )}
        </div>

        <nav className="topbar-nav" aria-label="Primary studio navigation">
          <button
            type="button"
            className={`btn ${surface === 'library' ? 'btn-active' : ''}`}
            onClick={() => setSurface('library')}
          >
            Projects ({projects.length})
          </button>
          <button
            type="button"
            className={`btn ${surface === 'studio' ? 'btn-active' : ''}`}
            disabled={!project}
            onClick={() => setSurface('studio')}
          >
            Studio Workspace
          </button>
          <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
            API Settings ({ttsKeyReady ? 'Key OK' : 'No Key'})
          </button>
          <a href="/legacy" className="btn">
            Legacy Viewer
          </a>
        </nav>
      </header>

      <main id="main-workspace" className="workspace-shell" tabIndex={-1}>
        <div aria-live="polite" className="visually-hidden">
          {statusNotice}
        </div>
        {errorBanner && (
          <div role="alert" className="alert-box alert-err row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <span>{errorBanner}</span>
            <button type="button" className="btn" onClick={() => setErrorBanner(null)}>
              Dismiss
            </button>
          </div>
        )}

        {surface === 'library' || !project ? (
          <ProjectLibrary
            projects={projects}
            busy={ttsBusy || uploadBusy}
            onOpenProject={async (p) => {
              await openProjectById(p.projectId);
              setSurface('studio');
            }}
            onCreateProject={async (tpl) => {
              const created = await studioApi.createProject(tpl);
              await refreshSystem();
              await openProjectById(created.projectId);
              setSurface('studio');
            }}
            onDuplicateProject={async (p) => {
              const dup = await studioApi.duplicateProject(p.projectId);
              await refreshSystem();
              await openProjectById(dup.projectId);
              setSurface('studio');
            }}
            onDeleteProject={async (p) => {
              await studioApi.deleteProject(p.projectId);
              const list = await refreshSystem();
              if (project?.projectId === p.projectId && list.length > 0) {
                await openProjectById(list[0].projectId);
              }
            }}
          />
        ) : (
          <div className="studio-grid">
            {/* LEFT COLUMN: 5 Visible Numbered Pipeline Steps */}
            <div className="stack">
              <nav className="stepper-nav" aria-label="Pipeline steps">
                {stepSummary.map((st) => (
                  <button
                    key={st.num}
                    type="button"
                    className="step-jump"
                    aria-current={activeStep === st.num ? 'step' : undefined}
                    onClick={() => jumpToStep(st.num)}
                  >
                    <span>{st.title}</span>
                    <span className="pill">{st.status}</span>
                  </button>
                ))}
              </nav>

              {/* STEP 1: SCRIPT & VOICE */}
              <section id="studio-step-1" className="panel stack" aria-labelledby="step-1-heading">
                <div className="panel-header" style={{ marginBottom: 0 }}>
                  <h2 id="step-1-heading" className="panel-title">
                    1. Script &amp; Voice
                  </h2>
                  <span className={`pill ${ttsKeyReady ? 'pill-ok' : 'pill-warn'}`}>
                    {ttsKeyReady ? 'Gemini Key Configured' : 'Gemini TTS: No API Key'}
                  </span>
                </div>

                <div>
                  <label className="field-label" htmlFor="project-title-input">
                    Project Title
                  </label>
                  <input
                    id="project-title-input"
                    type="text"
                    value={project.title}
                    onChange={(e) => queueProjectPatch({ title: e.target.value })}
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="script-editor">
                    Narration Script ({project.scriptText.trim().split(/\s+/).filter(Boolean).length} words · {project.scriptText.length} chars)
                  </label>
                  <textarea
                    id="script-editor"
                    value={project.scriptText}
                    onChange={(e) => queueProjectPatch({ scriptText: e.target.value })}
                  />
                </div>

                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="field-label">Active Narration Source</legend>
                  <div className="segmented">
                    <label className={`seg-option ${project.narrationSource === 'tts' ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="narrationSource"
                        value="tts"
                        checked={project.narrationSource === 'tts'}
                        onChange={() => queueProjectPatch({ narrationSource: 'tts' }, true)}
                      />
                      <span>Gemini TTS</span>
                    </label>
                    <label className={`seg-option ${project.narrationSource === 'import' ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="narrationSource"
                        value="import"
                        checked={project.narrationSource === 'import'}
                        onChange={() => queueProjectPatch({ narrationSource: 'import' }, true)}
                      />
                      <span>Import Audio</span>
                    </label>
                  </div>
                </fieldset>

                {project.narrationSource === 'tts' ? (
                  <div className="stack">
                    <div>
                      <label className="field-label" htmlFor="voice-select">
                        Gemini Prebuilt Voice (Default: Kore)
                      </label>
                      <select
                        id="voice-select"
                        value={project.voiceId}
                        onChange={(e) => queueProjectPatch({ voiceId: e.target.value }, true)}
                      >
                        {(contract?.voices || []).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}{v.isDefault ? ' (Default)' : ''} — {v.notes}
                          </option>
                        ))}
                      </select>
                    </div>

                    {!ttsKeyReady && (
                      <div className="alert-box alert-warn">
                        Gemini TTS requires <code>GEMINI_API_KEY</code> (env) or a local key in <strong>API Settings</strong>. You
                        can also switch to <strong>Import Audio</strong> to use a real recorded WAV/MP3/M4A narration.
                      </div>
                    )}

                    <div className="row">
                      <button
                        type="button"
                        className="btn"
                        disabled={ttsBusy || !ttsKeyReady}
                        aria-describedby={!ttsKeyReady ? 'tts-key-hint' : undefined}
                        onClick={handlePreviewVoice}
                      >
                        {ttsBusy ? 'Working…' : 'Listen Voice Sample'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={ttsBusy || !ttsKeyReady || !project.scriptText.trim()}
                        aria-describedby={!ttsKeyReady ? 'tts-key-hint' : undefined}
                        onClick={handleGenerateTts}
                      >
                        Generate Full Narration
                      </button>
                    </div>
                    {!ttsKeyReady && (
                      <p id="tts-key-hint" className="helper">
                        Disabled until a valid Gemini API key is configured in API Settings or GEMINI_API_KEY env.
                      </p>
                    )}

                    {previewAudio && (
                      <div className="alert-box">
                        <p className="helper" style={{ margin: '0 0 6px' }}>
                          Voice Preview: <strong>{previewAudio.voice}</strong> · {previewAudio.model} · {previewAudio.durationSec}s
                        </p>
                        <audio controls src={previewAudio.audioUrl} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="stack">
                    <div>
                      <label className="field-label" htmlFor="audio-import-input">
                        Import Real Voiceover (WAV, MP3, or M4A · max 64 MiB · max 180s)
                      </label>
                      <input
                        id="audio-import-input"
                        type="file"
                        accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4"
                        disabled={uploadBusy}
                        onChange={handleAudioUpload}
                      />
                      <p className="helper">
                        Magic-sniffed, FFprobe-validated, and normalized to 48 kHz stereo WAV while preserving your original file.
                      </p>
                    </div>
                  </div>
                )}

                {activeAudio && (
                  <div className="alert-box alert-ok stack" style={{ gap: 6 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>
                        Active Audio ({activeAudio.provider === 'gemini' ? `Gemini · ${activeAudio.voice}` : 'Imported'})
                      </strong>
                      <span className="pill pill-ok">{activeAudio.durationSec}s</span>
                    </div>
                    <p className="helper" style={{ margin: 0 }}>
                      {activeAudio.originalFilename || activeAudio.model || activeAudio.audioId} · {activeAudio.sampleRate} Hz ·{' '}
                      {activeAudio.channels}ch
                    </p>
                    <audio controls src={activeAudio.audioUrl} />
                  </div>
                )}
              </section>

              {/* STEP 2: VIDEO SETTINGS */}
              <section id="studio-step-2" className="panel stack" aria-labelledby="step-2-heading">
                <div className="panel-header" style={{ marginBottom: 0 }}>
                  <h2 id="step-2-heading" className="panel-title">
                    2. Video Settings
                  </h2>
                  <span className="pill">{project.aspectRatio}</span>
                </div>

                <div>
                  <span className="field-label">Aspect Ratio</span>
                  <div className="ratio-grid" role="group" aria-label="Aspect ratio selection">
                    {(contract?.aspectRatios || []).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`ratio-btn ${project.aspectRatio === r.id ? 'selected' : ''}`}
                        disabled={!r.supported}
                        aria-describedby={`ratio-desc-${r.id.replace(':', '-')}`}
                        onClick={() => r.supported && queueProjectPatch({ aspectRatio: r.id }, true)}
                      >
                        <span>{r.id}</span>
                        <span className="helper" style={{ margin: 0, fontSize: 11 }}>
                          {r.supported ? `${r.width}×${r.height}` : 'Disabled'}
                        </span>
                      </button>
                    ))}
                  </div>
                  {(contract?.aspectRatios || []).map((r) => (
                    <p
                      key={r.id}
                      id={`ratio-desc-${r.id.replace(':', '-')}`}
                      className="helper"
                      style={{ marginTop: 4 }}
                    >
                      <strong>{r.id}</strong> ({r.status}): {r.reason}
                    </p>
                  ))}
                </div>

                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <label htmlFor="subtitles-toggle" className="row" style={{ cursor: 'pointer', fontWeight: 600 }}>
                    <input
                      id="subtitles-toggle"
                      type="checkbox"
                      checked={project.captionsEnabled}
                      onChange={(e) => queueProjectPatch({ captionsEnabled: e.target.checked }, true)}
                    />
                    <span>Burn Cartoon Subtitles (ON / OFF)</span>
                  </label>
                  <span className={`pill ${project.captionsEnabled ? 'pill-ok' : ''}`}>
                    {project.captionsEnabled ? 'SUB ON' : 'SUB OFF'}
                  </span>
                </div>

                <div className="row">
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <label className="field-label" htmlFor="caption-style-select">
                      Caption Style Preset
                    </label>
                    <select
                      id="caption-style-select"
                      value={project.captionStyle}
                      disabled={!project.captionsEnabled}
                      onChange={(e) => queueProjectPatch({ captionStyle: e.target.value }, true)}
                    >
                      <option value="cartoon">Cartoon (Ink #241726 + Gold #FFE055)</option>
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 110 }}>
                    <label className="field-label" htmlFor="language-select">
                      Language
                    </label>
                    <select
                      id="language-select"
                      value={project.language}
                      onChange={(e) => queueProjectPatch({ language: e.target.value }, true)}
                    >
                      <option value="en">English (en)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="punch-words-input">
                    Emphasis Punch Words (comma-separated, maps to cartoon_subs.py punchWords)
                  </label>
                  <input
                    id="punch-words-input"
                    type="text"
                    disabled={!project.captionsEnabled}
                    value={project.punchWords.join(', ')}
                    onChange={(e) =>
                      queueProjectPatch({
                        punchWords: e.target.value
                          .split(',')
                          .map((w) => w.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>

                <label htmlFor="safe-zone-toggle" className="row" style={{ cursor: 'pointer' }}>
                  <input
                    id="safe-zone-toggle"
                    type="checkbox"
                    checked={showSafeZone}
                    onChange={(e) => setShowSafeZone(e.target.checked)}
                  />
                  <span>Show 9:16 YouTube Shorts Safe-Zone Overlay on Stage</span>
                </label>
              </section>

              {/* STEP 3: TIMING & PREVIEW */}
              <section id="studio-step-3" className="panel stack" aria-labelledby="step-3-heading">
                <div className="panel-header" style={{ marginBottom: 0 }}>
                  <h2 id="step-3-heading" className="panel-title">
                    3. Timing &amp; Preview
                  </h2>
                  <button
                    type="button"
                    className="btn"
                    disabled={timingBusy || !project.sourceAudioId}
                    onClick={handleRunTiming}
                  >
                    {timingBusy ? 'Aligning…' : 'Run Timing Check'}
                  </button>
                </div>

                <p className="helper" style={{ margin: 0 }}>
                  Story target: <strong>{project.totalFrames} frames</strong> ({project.expectedDurationSec.toFixed(2)}s @ 30 FPS).
                  {project.latestTiming ? (
                    <>
                      {' '}
                      Probed audio: <strong>{project.latestTiming.audioDurationSec.toFixed(2)}s</strong> · Alignment:{' '}
                      <strong>{project.latestTiming.alignmentPrecision}</strong> ({project.latestTiming.syncVerification}).
                    </>
                  ) : (
                    ' Click Run Timing Check after attaching voiceover audio.'
                  )}
                </p>

                {project.latestTiming?.warnings?.map((w, idx) => (
                  <div
                    key={`${w.code}-${idx}`}
                    className={`alert-box ${w.severity === 'error' ? 'alert-err' : w.severity === 'warning' ? 'alert-warn' : ''}`}
                  >
                    <strong>{w.code}:</strong> {w.message}
                  </div>
                ))}

                <div>
                  <span className="field-label">Shots ({project.shots.length}) — click to seek real 3D frame &amp; subtitle preview</span>
                  <div className="shot-list">
                    {project.shots.map((shot) => {
                      const active = currentFrame >= shot.a && currentFrame <= shot.b;
                      const mid = Math.round((shot.a + shot.b) / 2);
                      return (
                        <button
                          key={shot.id}
                          type="button"
                          className={`shot-chip ${active ? 'active' : ''}`}
                          onClick={() => {
                            setPlayerMode('engine');
                            setCurrentFrame(mid);
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>{shot.id}</div>
                          <div className="helper" style={{ margin: 0, fontSize: 11 }}>
                            f{shot.a}–f{shot.b} ({(shot.a / 30).toFixed(1)}s)
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* STEP 4: RENDER & MIX */}
              <section id="studio-step-4" className="panel stack" aria-labelledby="step-4-heading">
                <div className="panel-header" style={{ marginBottom: 0 }}>
                  <h2 id="step-4-heading" className="panel-title">
                    4. Render &amp; Mix
                  </h2>
                  <span
                    className={`pill ${
                      activeJob?.stage === 'COMPLETED'
                        ? 'pill-ok'
                        : activeJob?.stage === 'FAILED' || activeJob?.stage === 'BLOCKED'
                          ? 'pill-err'
                          : activeJob
                            ? 'pill-accent'
                            : ''
                    }`}
                  >
                    {activeJob ? activeJob.stage : 'IDLE'}
                  </span>
                </div>

                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isJobRunning || renderSubmitting || !project.engineReady}
                    onClick={handleStartRender}
                  >
                    {isJobRunning ? `Rendering (${activeJob?.progressPct || 0}%)…` : 'Render Video'}
                  </button>
                  {isJobRunning && (
                    <button type="button" className="btn btn-danger" onClick={handleCancelRender}>
                      Cancel
                    </button>
                  )}
                  {activeJob && (activeJob.stage === 'FAILED' || activeJob.stage === 'CANCELED' || activeJob.stage === 'INTERRUPTED') && (
                    <button type="button" className="btn" onClick={handleStartRender}>
                      Retry New Job
                    </button>
                  )}
                </div>

                {activeJob && (
                  <div className="stack" style={{ gap: 8 }}>
                    <label className="helper" htmlFor="render-progress-bar" style={{ margin: 0 }}>
                      Job <code>{activeJob.jobId}</code> · Stage: <strong>{activeJob.stage}</strong> · Frames:{' '}
                      {activeJob.framesDone} / {activeJob.frameCount} ({activeJob.progressPct}%)
                    </label>
                    <progress id="render-progress-bar" max={100} value={activeJob.progressPct} />
                    {activeJob.error && <p className="alert-box alert-err">{activeJob.error}</p>}
                    <div className="log-box" aria-label="Render job stage log">
                      {activeJob.logs.slice(-10).map((line, i) => (
                        <div key={`${line.at}-${i}`}>
                          [{line.stage}] {line.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* STEP 5: QA & EXPORT */}
              <section id="studio-step-5" className="panel stack" aria-labelledby="step-5-heading">
                <div className="panel-header" style={{ marginBottom: 0 }}>
                  <h2 id="step-5-heading" className="panel-title">
                    5. QA &amp; Export
                  </h2>
                  <span className={`pill ${selectedExport?.qaStatus === 'PASS' ? 'pill-ok' : 'pill-warn'}`}>
                    {selectedExport ? `QA ${selectedExport.qaStatus}` : 'No verified export yet'}
                  </span>
                </div>

                {selectedExport ? (
                  <div className="stack">
                    <div className="row">
                      <span className="pill">{selectedExport.width}×{selectedExport.height}</span>
                      <span className="pill">{selectedExport.fps} FPS</span>
                      <span className="pill">{selectedExport.durationSec.toFixed(2)}s ({selectedExport.frameCount}f)</span>
                      <span className="pill">{selectedExport.captionsEnabled ? 'SUB ON' : 'SUB OFF'}</span>
                      {exportQa?.mp4Probe?.audio?.integratedLufs !== null && exportQa?.mp4Probe?.audio?.integratedLufs !== undefined && (
                        <span className="pill">{exportQa.mp4Probe.audio.integratedLufs} LUFS</span>
                      )}
                    </div>

                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setPlayerMode('mp4')}
                      >
                        Play Verified MP4
                      </button>
                      <a
                        href={`${selectedExport.downloadUrl}?attachment=1`}
                        className="btn"
                        download
                      >
                        Download MP4 ({(selectedExport.byteSize / (1024 * 1024)).toFixed(2)} MB)
                      </a>
                    </div>

                    {exportQa && (
                      <div className="table-wrap">
                        <table className="qa-table">
                          <caption>Evidence-Based QA Gates (Human subjective review: {exportQa.humanSubjectiveReview})</caption>
                          <thead>
                            <tr>
                              <th scope="col">Gate</th>
                              <th scope="col">Status</th>
                              <th scope="col">Evidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {exportQa.gates.map((g) => (
                              <tr key={g.id}>
                                <td>
                                  <strong>{g.id}</strong> — {g.title}
                                </td>
                                <td>
                                  <span
                                    className={`pill ${
                                      g.status === 'PASS'
                                        ? 'pill-ok'
                                        : g.status === 'FAIL'
                                          ? 'pill-err'
                                          : 'pill-warn'
                                    }`}
                                  >
                                    {g.status}
                                  </span>
                                </td>
                                <td>{g.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="stack" style={{ gap: 8 }}>
                      <figure style={{ margin: 0 }}>
                        <img
                          className="contact-thumb"
                          src={selectedExport.contactSheetUrl}
                          alt={`Story contact sheet thumbnails for ${project.title}`}
                        />
                        <figcaption className="helper">Story Contact Sheet (verified rendered 9:16 frames)</figcaption>
                      </figure>
                      {selectedExport.captionsEnabled && (
                        <figure style={{ margin: 0 }}>
                          <img
                            className="contact-thumb"
                            src={selectedExport.subCheckUrl}
                            alt={`Burned subtitle verification contact sheet for ${project.title}`}
                          />
                          <figcaption className="helper">Subtitle QA Check Sheet (post-burn MP4 frame captures)</figcaption>
                        </figure>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="helper" style={{ margin: 0 }}>
                    Complete Step 4 (Render Video) to generate a verified playable MP4, FFprobe codecs/loudness report, and
                    contact sheets. Final output is never marked complete before QA passes.
                  </p>
                )}
              </section>
            </div>

            {/* RIGHT / TOP-ON-MOBILE COLUMN: Dominant 9:16 Real-Engine / MP4 Stage */}
            <aside className="stage-column" aria-label="Video Stage & Telemetry">
              <StagePreview
                project={project}
                currentFrame={currentFrame}
                onFrameChange={setCurrentFrame}
                showSafeZone={showSafeZone}
                subtitleCue={subtitleCue}
                activeExport={selectedExport}
                playerMode={playerMode}
                onPlayerModeChange={setPlayerMode}
              />

              <section className="panel stack" style={{ gap: 8 }}>
                <h2 className="panel-title">Environment Truth</h2>
                <p className="helper" style={{ margin: 0 }}>
                  Disk free: <strong>{health ? `${health.freeDiskMb} MB` : '…'}</strong> · FFmpeg libass:{' '}
                  <strong>{health?.ffmpegLibassAvailable ? 'Installed' : 'Missing'}</strong> · Kit snapshot:{' '}
                  <strong>{health?.kitReady ? 'Verified Local (G03 Public Push BLOCKED)' : 'Missing'}</strong>
                </p>
                <p className="helper" style={{ margin: 0 }}>
                  Input spec hash: <code>{project.inputSpecHash}</code>
                </p>
              </section>
            </aside>
          </div>
        )}
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSettingsUpdated={async () => {
          await refreshSystem();
        }}
      />
    </>
  );
}
