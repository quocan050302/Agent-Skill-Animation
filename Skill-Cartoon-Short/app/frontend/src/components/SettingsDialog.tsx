import React, { useEffect, useRef, useState } from 'react';
import { ApiError, studioApi } from '../api/client';
import type { TtsSettingsView } from '../types';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onSettingsUpdated: () => Promise<void>;
}

export function SettingsDialog({ open, onClose, onSettingsUpdated }: SettingsDialogProps) {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const [settings, setSettings] = useState<TtsSettingsView | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [selectionMode, setSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [ttsModel, setTtsModel] = useState('');
  const [models, setModels] = useState<Array<{ id: string; tier: string; isPreview: boolean; rank: number }>>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      setStatusMsg(null);
      setErrorMsg(null);
      setApiKeyInput('');
      studioApi
        .getTtsSettings()
        .then((s) => {
          setSettings(s);
          setSelectionMode(s.selectionMode);
          setTtsModel(s.ttsModel);
        })
        .catch((e) => setErrorMsg(e instanceof Error ? e.message : String(e)));
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const handleClose = () => {
    if (dlgRef.current) dlgRef.current.returnValue = '';
    onClose();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const patch: Record<string, unknown> = {
        selectionMode,
        ttsModel: ttsModel.trim(),
      };
      if (apiKeyInput.trim()) patch.apiKey = apiKeyInput.trim();
      const updated = await studioApi.saveTtsSettings(patch);
      setSettings(updated);
      setApiKeyInput('');
      setStatusMsg('Settings saved securely (0600 local store, never committed to Git).');
      await onSettingsUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClearKey = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const updated = await studioApi.saveTtsSettings({ clearKey: true });
      setSettings(updated);
      setModels([]);
      setStatusMsg('Saved API key cleared.');
      await onSettingsUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDiscover = async () => {
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await studioApi.discoverTtsModels(true);
      setModels(res.models || []);
      setStatusMsg(`Discovered ${res.models.length} TTS-capable Gemini models.`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <dialog ref={dlgRef} aria-labelledby="tts-settings-title" onClose={handleClose}>
      <div className="dialog-body stack">
        <div className="panel-header" style={{ marginBottom: 0 }}>
          <h2 id="tts-settings-title" className="panel-title">
            Gemini TTS Credentials & Model Discovery
          </h2>
          <button type="button" className="btn" onClick={() => dlgRef.current?.close()}>
            Close
          </button>
        </div>

        <p className="helper" style={{ margin: 0 }}>
          Status:{' '}
          <strong>
            {settings?.hasKey
              ? `Configured (${settings.keySource}: ${settings.maskedKey})`
              : 'BLOCKED — No GEMINI_API_KEY configured'}
          </strong>
        </p>

        <form className="stack" onSubmit={handleSave}>
          <div>
            <label className="field-label" htmlFor="gemini-api-key-input">
              Gemini API Key (optional local override of GEMINI_API_KEY env)
            </label>
            <input
              id="gemini-api-key-input"
              type="password"
              autoComplete="off"
              placeholder={settings?.hasKey ? `Saved (${settings.maskedKey})` : 'Paste AIza... key'}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <p className="helper">Stored server-side only in gitignored 0600 local settings. Never exposed to browser bundles.</p>
          </div>

          <div>
            <label className="field-label" htmlFor="tts-mode-select">
              TTS Model Selection Mode
            </label>
            <select
              id="tts-mode-select"
              value={selectionMode}
              onChange={(e) => setSelectionMode(e.target.value as 'auto' | 'manual')}
            >
              <option value="auto">Auto (discover & rank TTS-capable Gemini models)</option>
              <option value="manual">Manual (pin specific TTS model ID)</option>
            </select>
          </div>

          {selectionMode === 'manual' && (
            <div>
              <label className="field-label" htmlFor="tts-manual-model">
                Manual Gemini TTS Model ID
              </label>
              <input
                id="tts-manual-model"
                type="text"
                placeholder="e.g. gemini-2.5-flash-preview-tts"
                value={ttsModel}
                onChange={(e) => setTtsModel(e.target.value)}
              />
            </div>
          )}

          {statusMsg && <p className="alert-box alert-ok" role="status">{statusMsg}</p>}
          {errorMsg && <p className="alert-box alert-err" role="alert">{errorMsg}</p>}

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <button type="button" className="btn" disabled={loading} onClick={handleDiscover}>
                Discover TTS Models
              </button>
              {settings?.keySource === 'settings' && (
                <button type="button" className="btn btn-danger" disabled={loading} onClick={handleClearKey}>
                  Clear Key
                </button>
              )}
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              Save Settings
            </button>
          </div>
        </form>

        {models.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Discovered TTS Models</h3>
            <div className="log-box">
              {models.map((m) => (
                <div key={m.id}>
                  #{m.rank} {m.id} ({m.tier}{m.isPreview ? ', preview' : ', stable'})
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
