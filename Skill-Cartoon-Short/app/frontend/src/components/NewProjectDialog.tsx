import React, { useEffect, useRef, useState } from 'react';
import type { ContractResponse, StudioProject } from '../types';

export interface NewProjectPayload {
  title: string;
  storyId: string;
  scriptText: string;
  voiceId: string;
  captionsEnabled: boolean;
  punchWords: string[];
}

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: NewProjectPayload) => Promise<void>;
  contract: ContractResponse | null;
  existingProjects: StudioProject[];
}

interface StoryTemplateOption {
  storyId: string;
  label: string;
  durationHint: string;
  starterScript: string;
  starterPunch: string;
}

const STORY_TEMPLATES: StoryTemplateOption[] = [
  {
    storyId: 'ghost-army-ww2-30s',
    label: 'WWII Deception / Ghost Army (30s · 900 frames · 7 scenes)',
    durationHint: '~65–80 words (~30s at 150 WPM)',
    starterScript:
      "During World War II, the Americans built an entire army that wasn't real. Inflatable rubber tanks, hidden speakers, and fake radio chatter fooled enemy scouts from miles away. Their deadliest weapon wasn't a gun. It was deception.",
    starterPunch: "WASN'T, REAL, INFLATABLE, FAKE, DECEPTION",
  },
  {
    storyId: 'zombie-supermarket-10s',
    label: 'Midnight Supermarket Comedy (10s · 300 frames · 4 scenes)',
    durationHint: '~22–28 words (~10s at 150 WPM)',
    starterScript:
      'A hungry zombie shambled into Fresh-Mart at midnight, hunting for one last snack. The aisle looked promising—until he reached the shelf. Completely sold out.',
    starterPunch: 'FRESH-MART, SOLD OUT',
  },
  {
    storyId: 'soldier-baseline',
    label: 'Roman Soldier Bridge & Camp (19.7s · 592 frames · 7 scenes)',
    durationHint: '~45–55 words (~20s at 150 WPM)',
    starterScript:
      'After marching for miles, Roman soldiers did something insane. Instead of resting, they started building a fortified camp every single night.',
    starterPunch: 'INSANE, FORTIFIED, EVERY NIGHT',
  },
];

export function NewProjectDialog({
  open,
  onClose,
  onCreate,
  contract,
  existingProjects,
}: NewProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [title, setTitle] = useState('');
  const [storyId, setStoryId] = useState('ghost-army-ww2-30s');
  const [scriptText, setScriptText] = useState('');
  const [voiceId, setVoiceId] = useState('Kore');
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [punchWordsRaw, setPunchWordsRaw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hydratedStoryIds = new Set(
    existingProjects.filter((p) => p.engineReady).map((p) => p.storyId)
  );
  const availableTemplates =
    hydratedStoryIds.size > 0
      ? STORY_TEMPLATES.filter((t) => hydratedStoryIds.has(t.storyId))
      : STORY_TEMPLATES;
  const effectiveTemplates = availableTemplates.length > 0 ? availableTemplates : STORY_TEMPLATES;
  const activeTemplate =
    effectiveTemplates.find((t) => t.storyId === storyId) || effectiveTemplates[0];

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setTitle('');
      setScriptText('');
      setPunchWordsRaw('');
      setVoiceId(contract?.voices?.[0]?.id || 'Kore');
      setCaptionsEnabled(true);
      setErrorMsg(null);
      if (effectiveTemplates.length > 0 && !effectiveTemplates.some((t) => t.storyId === storyId)) {
        setStoryId(effectiveTemplates[0].storyId);
      }
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const handleClose = () => {
    const dlg = dialogRef.current;
    if (dlg) dlg.returnValue = '';
    onClose();
  };

  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0;
  const estSec = wordCount > 0 ? (wordCount / 2.5).toFixed(1) : '0.0';

  const handleFillStarter = () => {
    if (!activeTemplate) return;
    setScriptText(activeTemplate.starterScript);
    setPunchWordsRaw(activeTemplate.starterPunch);
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setErrorMsg('Please enter a project title.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const punchWords = punchWordsRaw
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean)
        .slice(0, 40);
      await onCreate({
        title: cleanTitle,
        storyId: activeTemplate.storyId,
        scriptText: scriptText.trim(),
        voiceId,
        captionsEnabled,
        punchWords,
      });
      dialogRef.current?.close('created');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="new-project-dialog-title" onClose={handleClose}>
      <div className="dialog-body stack">
        <div className="panel-header" style={{ marginBottom: 0 }}>
          <h2 id="new-project-dialog-title" className="panel-title">
            New Cartoon Short Project
          </h2>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close('cancel')}>
            Close
          </button>
        </div>

        <p className="helper" style={{ margin: 0 }}>
          Creates an isolated project workspace with its own script, voiceover WAV (Gemini TTS or imported audio),
          dynamic Cartoon subtitles, and verified MP4 exports.
        </p>

        {errorMsg && (
          <div role="alert" className="alert-box alert-err">
            {errorMsg}
          </div>
        )}

        <form className="stack" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="new-proj-title">Project Title</label>
            <input
              id="new-proj-title"
              type="text"
              required
              maxLength={140}
              autoFocus
              placeholder="e.g. The Secret Inflatable Tank Division"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="new-proj-story">3D Scene World (Hydrated Three.js Template)</label>
            <p id="new-proj-story-hint" className="helper" style={{ margin: '0 0 6px' }}>
              Select the 9:16 Three.js 2D+3D animation stage. Recommended script length: {activeTemplate.durationHint}.
            </p>
            <select
              id="new-proj-story"
              aria-describedby="new-proj-story-hint"
              value={activeTemplate.storyId}
              onChange={(e) => setStoryId(e.target.value)}
            >
              {effectiveTemplates.map((tpl) => (
                <option key={tpl.storyId} value={tpl.storyId}>
                  {tpl.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <label htmlFor="new-proj-script" style={{ margin: 0 }}>
                Narration Script ({wordCount} words · ~{estSec}s)
              </label>
              <button type="button" className="btn" onClick={handleFillStarter}>
                Fill Starter Script
              </button>
            </div>
            <textarea
              id="new-proj-script"
              rows={5}
              maxLength={6000}
              placeholder="Write or paste your narration script here (you can also edit it later in Step 1)..."
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
            />
          </div>

          <div className="field-grid-2">
            <div>
              <label htmlFor="new-proj-voice">Default Gemini Voice</label>
              <select
                id="new-proj-voice"
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
              >
                {(contract?.voices || [{ id: 'Kore', label: 'Kore — Clear, steady narrator (Default)' }]).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="new-proj-punch">Punch Highlight Words (optional)</label>
              <input
                id="new-proj-punch"
                type="text"
                placeholder="e.g. SECRET, FAKE, DECEPTION"
                value={punchWordsRaw}
                onChange={(e) => setPunchWordsRaw(e.target.value)}
              />
            </div>
          </div>

          <label className="checkbox-row" htmlFor="new-proj-captions">
            <input
              id="new-proj-captions"
              type="checkbox"
              checked={captionsEnabled}
              onChange={(e) => setCaptionsEnabled(e.target.checked)}
            />
            <span>Enable Cartoon Subtitles (SUB ON — dynamic highlight style)</span>
          </label>

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="button"
              className="btn"
              disabled={submitting}
              onClick={() => dialogRef.current?.close('cancel')}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create & Open Project'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
