import React, { useEffect, useRef, useState } from 'react';
import type { StudioProject } from '../types';

interface ProjectLibraryProps {
  projects: StudioProject[];
  onOpenProject: (project: StudioProject) => void;
  onCreateProject: (template: { title: string; storyId: string; scriptText: string; captionsEnabled: boolean }) => Promise<void>;
  onDuplicateProject: (project: StudioProject) => Promise<void>;
  onDeleteProject: (project: StudioProject) => Promise<void>;
  busy: boolean;
}

const TEMPLATES = [
  {
    id: 'ghost-army-ww2-30s',
    label: 'Ghost Army 30s Template',
    title: 'Ghost Army Deception Short',
    storyId: 'ghost-army-ww2-30s',
    captionsEnabled: true,
    scriptText:
      "During World War II, the Americans built an entire army that wasn't real. Inflatable rubber tanks, hidden speakers, and fake radio chatter fooled scouts from miles away. Their deadliest weapon wasn't a gun. It was deception.",
  },
  {
    id: 'zombie-supermarket-10s',
    label: 'Zombie Supermarket 10s Template',
    title: 'Midnight Snack Short',
    storyId: 'zombie-supermarket-10s',
    captionsEnabled: true,
    scriptText:
      'A hungry zombie walked into Fresh-Mart at midnight, hunting for one last snack. The aisle looked promising—until he reached the shelf. Completely sold out.',
  },
];

export function ProjectLibrary({
  projects,
  onOpenProject,
  onCreateProject,
  onDuplicateProject,
  onDeleteProject,
  busy,
}: ProjectLibraryProps) {
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<StudioProject | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = deleteDialogRef.current;
    if (!dlg) return;
    if (pendingDelete && !dlg.open) {
      dlg.showModal();
    } else if (!pendingDelete && dlg.open) {
      dlg.close();
    }
  }, [pendingDelete]);

  const handleDeleteClose = () => {
    const dlg = deleteDialogRef.current;
    const action = dlg?.returnValue || '';
    if (dlg) dlg.returnValue = '';
    const target = pendingDelete;
    setPendingDelete(null);
    if (action === 'confirm' && target) {
      onDeleteProject(target);
    }
  };

  const filtered = projects.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return p.title.toLowerCase().includes(q) || p.projectId.toLowerCase().includes(q) || p.storyId.toLowerCase().includes(q);
  });

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Start From Template</h2>
            <p className="helper">Create an isolated project workspace using hydrated 2D + 3D Three.js stories.</p>
          </div>
        </div>
        <div className="row">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                onCreateProject({
                  title: tpl.title,
                  storyId: tpl.storyId,
                  scriptText: tpl.scriptText,
                  captionsEnabled: tpl.captionsEnabled,
                })
              }
            >
              + {tpl.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Projects ({filtered.length})</h2>
          <div style={{ minWidth: 'min(100%, 260px)' }}>
            <label htmlFor="project-search" className="visually-hidden">
              Search projects
            </label>
            <input
              id="project-search"
              type="search"
              placeholder="Filter projects..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="library-grid">
          {filtered.map((p) => (
            <article key={p.projectId} className="project-card">
              <div className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="pill pill-accent">{p.aspectRatio} · {p.totalFrames}f</span>
                  <span className={`pill ${p.captionsEnabled ? 'pill-ok' : ''}`}>
                    {p.captionsEnabled ? 'SUB ON' : 'SUB OFF'}
                  </span>
                </div>
                <h3 style={{ margin: 0, fontSize: 16 }}>{p.title}</h3>
                <p className="helper" style={{ margin: 0 }}>
                  ID: <code>{p.projectId}</code> · Story: <code>{p.storyId}</code>
                </p>
                <p className="helper" style={{ margin: 0 }}>
                  Audio: {p.sourceAudioMeta ? `${p.sourceAudioMeta.provider} (${p.sourceAudioMeta.durationSec}s)` : 'Not attached yet'} · Exports: {p.exports.length}
                </p>
              </div>

              <div className="row">
                <button type="button" className="btn btn-primary" onClick={() => onOpenProject(p)}>
                  Open Studio
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => onDuplicateProject(p)}>
                  Duplicate
                </button>
                {!p.protected && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => setPendingDelete(p)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Native <dialog> modal per modern-web-guidance (no manual role="dialog"/aria-modal/Esc) */}
      <dialog ref={deleteDialogRef} aria-labelledby="delete-project-title" onClose={handleDeleteClose}>
        <div className="dialog-body stack">
          <h2 id="delete-project-title" className="panel-title">
            Delete project?
          </h2>
          <p className="helper">
            This permanently deletes <strong>{pendingDelete?.title}</strong> (<code>{pendingDelete?.projectId}</code>) and its
            isolated generated audio and job outputs.
          </p>
          <form method="dialog" className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" value="cancel" className="btn" autoFocus>
              Cancel
            </button>
            <button type="submit" value="confirm" className="btn btn-danger">
              Delete Permanently
            </button>
          </form>
        </div>
      </dialog>
    </div>
  );
}
