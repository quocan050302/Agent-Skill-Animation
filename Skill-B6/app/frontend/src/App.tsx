import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Film,
  FolderKanban,
  HelpCircle,
  Image as ImageIcon,
  PanelRightOpen,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import type { AssetRecord, CaptionCue, JobRecord, Ratio, ShotItem } from '@b6-studio/shared';
import {
  api,
  type CharacterActorDto,
  type DoctorReportDto,
  type OutputArtifactDto,
  type ProjectDetailDto,
  type ProjectSummaryDto,
  type ReviewStateDto,
  type UpstreamInfoDto,
} from './api/client';
import { ProjectsView } from './components/ProjectsView';
import { PlayerStage } from './components/PlayerStage';
import { InspectorPanel, type InspectorTab } from './components/InspectorPanel';
import { AssetsView } from './components/AssetsView';
import { JobsQaView } from './components/JobsQaView';
import { JobsDrawer } from './components/JobsDrawer';
import { SystemHealthModal } from './components/SystemHealthModal';

type MainSection = 'projects' | 'studio' | 'assets' | 'jobs';

interface EditorSnapshot {
  title: string;
  premise: string;
  hook: string;
  narration: string;
  duration: number;
  shots: ShotItem[];
  captions: CaptionCue[];
  nativeLayoutReason: string;
}

function normalizeShotsFromPlan(plan: Record<string, unknown> | undefined): ShotItem[] {
  const raw = Array.isArray(plan?.shots) ? (plan.shots as Array<Record<string, unknown>>) : [];
  return raw.map((s, idx) => ({
    id: String(s.id ?? `shot-${idx + 1}`),
    start: Number(s.start ?? 0),
    end: Number(s.end ?? 1),
    actor: String(s.actor ?? ''),
    environment: String(s.environment ?? ''),
    sceneGoal: String(s.sceneGoal ?? ''),
    composition: String(s.composition ?? 'Native B6 composition'),
    action: String(s.action ?? 'Action beat'),
    expression: String(s.expression ?? 'neutral'),
    props: Array.isArray(s.props) ? (s.props as string[]) : [],
    staging: (s.staging as ShotItem['staging']) ?? {},
    camera: String(s.camera ?? 'Hold'),
    cameraKeys: Array.isArray(s.camera_keys)
      ? (s.camera_keys as ShotItem['cameraKeys'])
      : Array.isArray(s.cameraKeys)
      ? (s.cameraKeys as ShotItem['cameraKeys'])
      : [{ t: 0, x: 0, y: -210, z: 0, fov: 55 }],
    transition: String(s.transition ?? 'cut'),
    short_cut_reason: typeof s.short_cut_reason === 'string' ? s.short_cut_reason : undefined,
    asset_inputs: Array.isArray(s.asset_inputs) ? (s.asset_inputs as string[]) : [],
    sfx: String(s.sfx ?? ''),
  }));
}

export function App() {
  const [section, setSection] = useState<MainSection>('projects');
  const [doctor, setDoctor] = useState<DoctorReportDto | null>(null);
  const [upstream, setUpstream] = useState<UpstreamInfoDto | null>(null);
  const [modalMode, setModalMode] = useState<'settings' | 'help' | null>(null);

  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    return localStorage.getItem('b6.activeProjectId');
  });
  const [project, setProject] = useState<ProjectDetailDto | null>(null);

  // Editable project state
  const [editor, setEditor] = useState<EditorSnapshot | null>(null);
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const autosaveTimerRef = useRef<number | null>(null);
  const latestEditorRef = useRef<EditorSnapshot | null>(null);

  // Studio substate
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('story');
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [selectedShotIndex, setSelectedShotIndex] = useState(0);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [inboxFiles, setInboxFiles] = useState<string[]>([]);
  const [characters, setCharacters] = useState<CharacterActorDto[]>([]);
  const [latestPreflight, setLatestPreflight] = useState<Record<string, unknown> | null>(null);
  const [outputs, setOutputs] = useState<OutputArtifactDto[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<ReviewStateDto | null>(null);
  const [trustedCode, setTrustedCode] = useState(false);

  // Jobs & Live SSE
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const pendingRefreshJobIdsRef = useRef<Set<string>>(new Set());

  const loadSystemHealth = useCallback(async () => {
    try {
      const [doc, up] = await Promise.all([api.getDoctor(), api.getUpstream()]);
      setDoctor(doc);
      setUpstream(up);
    } catch {
      // handled in UI badge
    }
  }, []);

  const loadProjectsList = useCallback(async () => {
    const res = await api.listProjects();
    setProjects(res.projects);
    return res.projects;
  }, []);

  const loadProjectBundle = useCallback(async (id: string) => {
    const { project: detail } = await api.getProject(id);
    const switchedProject = activeProjectIdRef.current !== id;
    activeProjectIdRef.current = id;
    setProject(detail);
    localStorage.setItem('b6.activeProjectId', id);
    setActiveProjectId(id);

    const activeRatio = detail.meta.activeRatio;
    const plan = detail.formats[activeRatio] ?? Object.values(detail.formats)[0];
    const snap: EditorSnapshot = {
      title: detail.meta.title,
      premise: detail.meta.premise ?? '',
      hook: detail.meta.hook ?? '',
      narration: detail.storyJson.narration ?? '',
      duration: typeof detail.projectJson.duration === 'number' ? detail.projectJson.duration : detail.meta.targetDuration,
      shots: normalizeShotsFromPlan(plan),
      captions: detail.captionsJson,
      nativeLayoutReason: String((plan?.caption as Record<string, unknown> | undefined)?.native_layout_reason ?? ''),
    };
    setEditor(snap);
    latestEditorRef.current = snap;
    undoStackRef.current = [];
    setCanUndo(false);
    setSaveStatus('saved');
    setSaveError(null);

    const [assetsRes, charsRes, outsRes, revRes, jobsRes] = await Promise.all([
      api.listAssets(id),
      api.getCharacters(id),
      api.getOutputs(id),
      api.getReviewState(id, activeRatio),
      api.listJobs(id),
    ]);
    setAssets(assetsRes.assets);
    setInboxFiles(assetsRes.inboxFiles);
    setCharacters(charsRes.actors);
    setLatestPreflight(charsRes.latestPreflight);
    setOutputs(outsRes.outputs);
    setReviewState(revRes.review);
    setJobs(jobsRes.jobs);
    if (switchedProject) {
      setActiveJobId(jobsRes.jobs.length > 0 ? jobsRes.jobs[0].id : null);
    } else if (jobsRes.jobs.length > 0) {
      setActiveJobId((cur) => cur ?? jobsRes.jobs[0].id);
    }
  }, []);

  useEffect(() => {
    void loadSystemHealth();
    void loadProjectsList().then((list) => {
      const savedId = localStorage.getItem('b6.activeProjectId');
      const target = list.find((p) => p.id === savedId) ?? list[0];
      if (target) {
        void loadProjectBundle(target.id);
      }
    });
  }, [loadSystemHealth, loadProjectsList, loadProjectBundle]);

  // Connect SSE for selected/running job (single owner inside effect + fallback poll for fast jobs/restarts)
  useEffect(() => {
    if (!activeJobId) return;
    let disposed = false;
    let pollTimer = 0;
    let sawLiveState = pendingRefreshJobIdsRef.current.has(activeJobId);
    let handledTerminal = false;
    setJobLogs([]);

    const upsertJob = (job: JobRecord) => {
      setJobs((prev) => {
        const idx = prev.findIndex((x) => x.id === job.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = job;
          return copy;
        }
        return [job, ...prev];
      });
    };

    const isTerminal = (s: JobRecord['status']) =>
      s === 'succeeded' || s === 'failed' || s === 'cancelled' || s === 'interrupted';

    const onTerminal = (job: JobRecord) => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      if (pollTimer) window.clearInterval(pollTimer);
      if (handledTerminal) return;
      handledTerminal = true;
      const shouldRefreshProject = sawLiveState || pendingRefreshJobIdsRef.current.has(job.id);
      pendingRefreshJobIdsRef.current.delete(job.id);
      if (shouldRefreshProject && job.projectId && job.projectId === activeProjectIdRef.current) {
        void loadProjectBundle(job.projectId);
        void loadProjectsList();
      }
    };

    const es = new EventSource(`/api/jobs/${encodeURIComponent(activeJobId)}/events`);
    sseRef.current = es;

    es.addEventListener('status', (ev) => {
      if (disposed) return;
      const job = JSON.parse((ev as MessageEvent).data) as JobRecord;
      upsertJob(job);
      if (!isTerminal(job.status)) {
        sawLiveState = true;
      } else {
        onTerminal(job);
      }
    });

    es.addEventListener('log', (ev) => {
      if (disposed) return;
      const payload = JSON.parse((ev as MessageEvent).data) as { line: string };
      setJobLogs((prev) => [...prev.slice(-399), payload.line]);
    });

    // Immediate snapshot + short fallback poll while running/queued in case a fast job finishes mid-handshake
    const syncSnapshot = async () => {
      try {
        const res = await api.getJob(activeJobId);
        if (disposed) return;
        upsertJob(res.job);
        if (res.logs.length > 0) setJobLogs(res.logs);
        if (!isTerminal(res.job.status)) {
          sawLiveState = true;
        } else {
          onTerminal(res.job);
        }
      } catch {
        // retry on next tick
      }
    };
    void syncSnapshot();
    pollTimer = window.setInterval(() => {
      void syncSnapshot();
    }, 1000);

    return () => {
      disposed = true;
      window.clearInterval(pollTimer);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, [activeJobId, loadProjectBundle, loadProjectsList]);

  const commitSave = useCallback(
    async (snapToSave: EditorSnapshot) => {
      if (!activeProjectId) return;
      setSaveStatus('saving');
      setSaveError(null);
      try {
        const res = await api.patchProject(activeProjectId, {
          title: snapToSave.title || activeProjectId,
          premise: snapToSave.premise,
          hook: snapToSave.hook,
          narration: snapToSave.narration,
          duration: snapToSave.duration,
          beats:
            snapToSave.shots.length > 0
              ? snapToSave.shots.map((s) => ({ id: s.id, start: s.start, end: s.end, action: s.action }))
              : undefined,
          shots: snapToSave.shots,
          captions: snapToSave.captions,
          nativeLayoutReason: snapToSave.nativeLayoutReason,
        });
        setProject(res.detail);
        setValidationErrors(res.validation.errors);
        setSaveStatus('saved');
        void loadProjectsList();
      } catch (err) {
        setSaveStatus('error');
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProjectId, loadProjectsList],
  );

  const updateEditor = useCallback(
    (updater: (prev: EditorSnapshot) => EditorSnapshot) => {
      const prev = latestEditorRef.current;
      if (!prev) return;
      const next = updater(prev);
      undoStackRef.current = [...undoStackRef.current.slice(-24), prev];
      latestEditorRef.current = next;
      setCanUndo(true);
      setEditor(next);
      setSaveStatus('dirty');
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(() => {
        if (latestEditorRef.current) {
          void commitSave(latestEditorRef.current);
        }
      }, 700);
    },
    [commitSave],
  );

  const handleForceSave = useCallback(() => {
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    if (latestEditorRef.current) {
      void commitSave(latestEditorRef.current);
    }
  }, [commitSave]);

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    setCanUndo(undoStackRef.current.length > 0);
    setEditor(prev);
    latestEditorRef.current = prev;
    void commitSave(prev);
  }, [commitSave]);

  // Ctrl+S / Cmd+S shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleForceSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleForceSave]);

  const launchJob = async (fn: () => Promise<{ job: JobRecord }>) => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      if (latestEditorRef.current) await commitSave(latestEditorRef.current);
    }
    try {
      const { job } = await fn();
      pendingRefreshJobIdsRef.current.add(job.id);
      setJobs((prev) => [job, ...prev.filter((x) => x.id !== job.id)]);
      setDrawerOpen(true);
      setActiveJobId(job.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const activeRatio: Ratio = project?.meta.activeRatio ?? '9:16';
  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;

  const handleAddShot = () => {
    if (!editor) return;
    const prevEnd = editor.shots.length > 0 ? editor.shots[editor.shots.length - 1].end : 0;
    const nextShot: ShotItem = {
      id: `shot-${editor.shots.length + 1}`,
      start: Number(prevEnd.toFixed(2)),
      end: Number((prevEnd + 2).toFixed(2)),
      actor: characters[0]?.id ?? 'marcus',
      environment: 'arena',
      sceneGoal: 'Cảnh mới',
      composition: `${activeRatio} framing`,
      action: 'Hành động chính trong shot',
      expression: 'neutral',
      props: [],
      staging: {},
      camera: 'Static or deliberate track',
      cameraKeys: [{ t: 0, x: 0, y: -210, z: 0, fov: 55 }],
      transition: 'cut',
      asset_inputs: [],
      sfx: '',
    };
    updateEditor((prev) => ({ ...prev, shots: [...prev.shots, nextShot] }));
    setSelectedShotIndex(editor.shots.length);
    setInspectorTab('shot');
  };

  return (
    <div className="studio-shell">
      {/* Slim Header */}
      <header className="studio-header">
        <div className="header-brand">
          <div className="brand-mark">B6</div>
          <span className="brand-title">B6 Local Studio</span>
          {project && (
            <div className="header-project-pill">
              <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                {editor?.title || project.meta.title}
              </strong>
              <span className="badge badge-neutral">{activeRatio}</span>
              <span className={`badge ${project.projectJson.stage === 'authored' ? 'badge-success' : 'badge-warning'}`}>
                {String(project.projectJson.stage ?? 'needs_authoring')}
              </span>
            </div>
          )}
        </div>

        <div className="header-actions">
          {section === 'studio' && project && (
            <button
              type="button"
              className="btn btn-sm tablet-inspector-toggle"
              onClick={() => setMobileInspectorOpen((v) => !v)}
            >
              <PanelRightOpen size={15} />
              <span>Inspector</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setModalMode('settings')}
            aria-label="Kiểm tra hệ thống"
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: doctor?.ok ? 'var(--success)' : 'var(--danger)',
              }}
            />
            <span className="nav-label">{doctor?.ok ? 'Source OK' : 'Kiểm tra môi trường'}</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setModalMode('help')} aria-label="Hướng dẫn">
            <HelpCircle size={15} />
            <span className="nav-label">Help</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setModalMode('settings')} aria-label="Cài đặt">
            <Settings size={15} />
          </button>
        </div>
      </header>

      {/* Main 3-Column Body */}
      <div className={`studio-body ${section === 'studio' && project ? '' : 'studio-body--two-col'}`}>
        {/* Left Navigation */}
        <nav className="left-nav" aria-label="Điều hướng chính">
          <div className="nav-items">
            {(
              [
                ['projects', 'Projects', FolderKanban],
                ['studio', 'Studio', Film],
                ['assets', 'Assets', ImageIcon],
                ['jobs', 'Jobs & QA', Activity],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                className={`nav-btn ${section === id ? 'active' : ''}`}
                disabled={id !== 'projects' && !project}
                onClick={() => setSection(id)}
              >
                <Icon size={17} />
                <span className="nav-label">{label}</span>
              </button>
            ))}
          </div>

          <div className="recent-projects-box">
            <div className="section-label">Dự án gần đây</div>
            {projects.slice(0, 5).map((p) => (
              <button
                key={p.id}
                type="button"
                className={`recent-item ${p.id === activeProjectId ? 'active' : ''}`}
                onClick={() => {
                  void loadProjectBundle(p.id);
                  setSection('studio');
                }}
              >
                <span className="recent-item-title">{p.title}</span>
                <span className="recent-item-meta">
                  {p.ratios.join(', ')} · {p.stage}
                </span>
              </button>
            ))}
          </div>
        </nav>

        {/* Center Workspace */}
        <main className="center-stage">
          {section === 'projects' && (
            <ProjectsView
              projects={projects}
              activeProjectId={activeProjectId}
              onOpenProject={(id) => {
                void loadProjectBundle(id);
                setSection('studio');
              }}
              onCreateProject={async (input) => {
                const { project: created } = await api.createProject(input);
                await loadProjectsList();
                await loadProjectBundle(created.id);
                setSection('studio');
              }}
              onDuplicateProject={async (id) => {
                const { project: dup } = await api.duplicateProject(id);
                await loadProjectsList();
                await loadProjectBundle(dup.id);
              }}
              onDeleteProject={async (id) => {
                await api.deleteProject(id);
                if (activeProjectId === id) {
                  setProject(null);
                  setEditor(null);
                  setActiveProjectId(null);
                  localStorage.removeItem('b6.activeProjectId');
                }
                await loadProjectsList();
              }}
            />
          )}

          {section === 'studio' && project && editor && (
            <PlayerStage
              projectId={project.id}
              ratio={activeRatio}
              outputs={outputs}
              selectedOutputId={selectedOutputId}
              onSelectOutput={setSelectedOutputId}
              shots={editor.shots}
              captions={editor.captions}
              selectedShotIndex={selectedShotIndex}
              onSelectShot={(idx) => {
                setSelectedShotIndex(idx);
                setInspectorTab('shot');
              }}
              onAddShot={handleAddShot}
              missingItems={project.completeness.missingItems}
            />
          )}

          {section === 'assets' && project && (
            <AssetsView
              projectId={project.id}
              assets={assets}
              inboxFiles={inboxFiles}
              onRefresh={() => loadProjectBundle(project.id)}
            />
          )}

          {section === 'jobs' && (
            <JobsQaView
              projectId={activeProjectId}
              jobs={jobs}
              selectedJobId={activeJobId}
              selectedJobLogs={jobLogs}
              onSelectJob={(id) => setActiveJobId(id)}
              onCancelJob={async (id) => {
                await api.cancelJob(id);
              }}
              outputs={outputs}
              reviewState={reviewState}
              onOpenFolder={async () => {
                if (activeProjectId) await api.openOutputFolder(activeProjectId, 'outputs');
              }}
            />
          )}
        </main>

        {/* Right Inspector (only in Studio mode when a project is open) */}
        {section === 'studio' && project && editor && (
          <aside className={`inspector-panel ${mobileInspectorOpen ? 'open-drawer' : ''}`} aria-label="Inspector">
            <InspectorPanel
              project={project}
              activeTab={inspectorTab}
              onChangeTab={setInspectorTab}
              titleDraft={editor.title}
              onChangeTitle={(v) => updateEditor((p) => ({ ...p, title: v }))}
              premiseDraft={editor.premise}
              onChangePremise={(v) => updateEditor((p) => ({ ...p, premise: v }))}
              hookDraft={editor.hook}
              onChangeHook={(v) => updateEditor((p) => ({ ...p, hook: v }))}
              narrationDraft={editor.narration}
              onChangeNarration={(v) => updateEditor((p) => ({ ...p, narration: v }))}
              durationDraft={editor.duration}
              onChangeDuration={(v) => updateEditor((p) => ({ ...p, duration: v }))}
              shots={editor.shots}
              selectedShotIndex={selectedShotIndex}
              onSelectShot={setSelectedShotIndex}
              onUpdateShot={(idx, next) =>
                updateEditor((p) => {
                  const copy = [...p.shots];
                  copy[idx] = next;
                  return { ...p, shots: copy };
                })
              }
              onDuplicateShot={(idx) =>
                updateEditor((p) => {
                  const orig = p.shots[idx];
                  if (!orig) return p;
                  const dur = orig.end - orig.start;
                  const lastEnd = p.shots[p.shots.length - 1]?.end ?? 0;
                  const dup: ShotItem = {
                    ...orig,
                    id: `${orig.id}-copy`,
                    start: Number(lastEnd.toFixed(2)),
                    end: Number((lastEnd + dur).toFixed(2)),
                  };
                  return { ...p, shots: [...p.shots, dup] };
                })
              }
              onDeleteShot={(idx) => {
                updateEditor((p) => ({ ...p, shots: p.shots.filter((_, j) => j !== idx) }));
                setSelectedShotIndex(0);
              }}
              captions={editor.captions}
              onChangeCaptions={(next) => updateEditor((p) => ({ ...p, captions: next }))}
              nativeLayoutReason={editor.nativeLayoutReason}
              onChangeNativeLayoutReason={(v) => updateEditor((p) => ({ ...p, nativeLayoutReason: v }))}
              saveStatus={saveStatus}
              saveError={saveError}
              validationErrors={validationErrors}
              canUndo={canUndo}
              onUndo={handleUndo}
              onForceSave={handleForceSave}
              onRequestSceneSync={async (note) => {
                const res = await api.patchProject(project.id, { requestSceneSyncNote: note });
                setProject(res.detail);
              }}
              onSaveScenePy={async (content) => {
                await api.saveScenePy(project.id, content);
                await loadProjectBundle(project.id);
              }}
              characters={characters}
              latestPreflight={latestPreflight}
              onRunPreflight={() => launchJob(() => api.runPreflight(project.id))}
              onUpdateRig={async (actorId, viewId, patch) => {
                await api.updateCharacterViewRig(project.id, actorId, viewId, patch);
                await loadProjectBundle(project.id);
              }}
              outputs={outputs}
              reviewState={reviewState}
              trustedCode={trustedCode}
              onToggleTrustedCode={setTrustedCode}
              onRunValidate={() => launchJob(() => api.runValidate(project.id, activeRatio))}
              onRunDraft={(scale) =>
                launchJob(() =>
                  api.runDraft(project.id, {
                    ratio: activeRatio,
                    draftScale: scale,
                    start: 0,
                    seconds: editor.duration,
                    trustedCode,
                  }),
                )
              }
              onRunPreview={() =>
                launchJob(() =>
                  api.runPreview(project.id, {
                    ratio: activeRatio,
                    start: 0,
                    seconds: editor.duration,
                    trustedCode,
                  }),
                )
              }
              onRunReviewPack={(reportRel) =>
                launchJob(() => api.runReviewPack(project.id, { ratio: activeRatio, reportRel }))
              }
              onRunCheckReview={(reviewRel, reportRel) =>
                launchJob(() => api.runCheckReview(project.id, { ratio: activeRatio, reviewRel, reportRel }))
              }
              onRunApprove={(reportRel, reviewRel, note) =>
                launchJob(() => api.runApprove(project.id, { ratio: activeRatio, reportRel, reviewRel, note }))
              }
              onRunRender={() => launchJob(() => api.runRender(project.id, { ratio: activeRatio, trustedCode }))}
              onOpenFolder={async () => {
                await api.openOutputFolder(project.id, 'outputs');
              }}
              activeJob={activeJob}
            />
          </aside>
        )}
      </div>

      {/* Bottom Jobs Drawer */}
      <JobsDrawer
        open={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
        jobs={jobs}
        activeJobId={activeJobId}
        logs={jobLogs}
        onSelectJob={(id) => {
          setActiveJobId(id);
          setDrawerOpen(true);
        }}
        onCancelJob={async (id) => {
          await api.cancelJob(id);
        }}
      />

      {/* Mobile Bottom Navigation (320px-767px) */}
      <nav className="mobile-bottom-nav" aria-label="Điều hướng di động">
        <button
          type="button"
          className={`mobile-nav-btn ${section === 'projects' ? 'active' : ''}`}
          onClick={() => { setMobileInspectorOpen(false); setSection('projects'); }}
        >
          <FolderKanban size={18} />
          <span>Dự án</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${section === 'studio' && !mobileInspectorOpen ? 'active' : ''}`}
          disabled={!project}
          onClick={() => { setMobileInspectorOpen(false); setSection('studio'); }}
        >
          <Film size={18} />
          <span>Studio</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${section === 'studio' && mobileInspectorOpen ? 'active' : ''}`}
          disabled={!project}
          onClick={() => { setSection('studio'); setMobileInspectorOpen((v) => !v); }}
        >
          <SlidersHorizontal size={18} />
          <span>Chỉnh sửa</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${section === 'assets' ? 'active' : ''}`}
          disabled={!project}
          onClick={() => { setMobileInspectorOpen(false); setSection('assets'); }}
        >
          <ImageIcon size={18} />
          <span>Ảnh</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${section === 'jobs' ? 'active' : ''}`}
          disabled={!project}
          onClick={() => { setMobileInspectorOpen(false); setSection('jobs'); }}
        >
          <Activity size={18} />
          <span>Jobs</span>
        </button>
      </nav>

      {modalMode && (
        <SystemHealthModal
          mode={modalMode}
          doctor={doctor}
          upstream={upstream}
          onClose={() => setModalMode(null)}
          onRefreshDoctor={loadSystemHealth}
        />
      )}
    </div>
  );
}

export default App;
