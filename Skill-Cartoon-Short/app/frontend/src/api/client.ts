import type {
  AudioArtifactMeta,
  ContractResponse,
  ExportQaReport,
  HealthResponse,
  RenderJob,
  StudioProject,
  SubtitleCuePreview,
  TimingSummary,
  TtsSettingsView,
} from '../types';

export class ApiError extends Error {
  code: string;
  status: number;
  blocked: boolean;
  constructor(message: string, code = 'API_ERROR', status = 500, blocked = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.blocked = blocked;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof ArrayBuffer) && !(init.body instanceof Uint8Array)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`Server returned non-JSON (HTTP ${res.status})`, 'NON_JSON', res.status);
  }
  if (!res.ok || json?.ok === false) {
    throw new ApiError(
      json?.error || `Request failed (HTTP ${res.status})`,
      json?.code || json?.reasonCategory || 'API_ERROR',
      res.status,
      Boolean(json?.blocked || res.status === 503)
    );
  }
  return json as T;
}

export const studioApi = {
  getHealth: () => requestJson<HealthResponse>('/api/health'),
  getContract: () => requestJson<ContractResponse>('/api/contract'),

  listProjects: async (): Promise<StudioProject[]> => {
    const res = await requestJson<{ ok: true; projects: StudioProject[] }>('/api/projects');
    return res.projects;
  },
  getProject: async (id: string): Promise<StudioProject> => {
    const res = await requestJson<{ ok: true; project: StudioProject }>(`/api/projects/${encodeURIComponent(id)}`);
    return res.project;
  },
  createProject: async (payload: Partial<StudioProject> & { title: string }): Promise<StudioProject> => {
    const res = await requestJson<{ ok: true; project: StudioProject }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.project;
  },
  updateProject: async (id: string, patch: Record<string, unknown>): Promise<StudioProject> => {
    const res = await requestJson<{ ok: true; project: StudioProject }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return res.project;
  },
  duplicateProject: async (id: string, newTitle?: string): Promise<StudioProject> => {
    const res = await requestJson<{ ok: true; project: StudioProject }>(
      `/api/projects/${encodeURIComponent(id)}/duplicate`,
      { method: 'POST', body: JSON.stringify(newTitle ? { newTitle } : {}) }
    );
    return res.project;
  },
  deleteProject: async (id: string): Promise<{ deleted: true; projectId: string }> =>
    requestJson(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmDelete: true }),
    }),

  getTtsSettings: async (): Promise<TtsSettingsView> => {
    const res = await requestJson<{ ok: true; settings: TtsSettingsView }>('/api/tts/settings');
    return res.settings;
  },
  saveTtsSettings: async (patch: Record<string, unknown>): Promise<TtsSettingsView> => {
    const res = await requestJson<{ ok: true; settings: TtsSettingsView }>('/api/tts/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return res.settings;
  },
  discoverTtsModels: async (refresh = false) =>
    requestJson<{
      ok: boolean;
      blocked?: boolean;
      status: string;
      models: Array<{ id: string; tier: string; isPreview: boolean; rank: number; rankRationale: string }>;
      error?: string;
    }>(`/api/tts/models${refresh ? '?refresh=1' : ''}`),

  previewVoice: async (payload: { projectId: string; voice: string; text?: string; model?: string }) =>
    requestJson<{ ok: true; artifact: AudioArtifactMeta }>('/api/tts/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generateProjectTts: async (projectId: string, payload: { scriptText: string; voice: string; model?: string }) =>
    requestJson<{ ok: true; artifact: AudioArtifactMeta; project: StudioProject }>(
      `/api/projects/${encodeURIComponent(projectId)}/tts`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  importAudio: async (projectId: string, file: File) => {
    const bytes = await file.arrayBuffer();
    return requestJson<{ ok: true; artifact: AudioArtifactMeta; project: StudioProject }>(
      `/api/projects/${encodeURIComponent(projectId)}/import-audio`,
      {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': file.name,
        },
        body: bytes,
      }
    );
  },

  runTiming: async (projectId: string) =>
    requestJson<{ ok: true; timing: TimingSummary; project: StudioProject }>(
      `/api/projects/${encodeURIComponent(projectId)}/timing`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  getSubtitlePreview: async (projectId: string, timeSec: number) =>
    requestJson<{ ok: true; captionsEnabled: boolean; cue: SubtitleCuePreview; source?: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/subtitles-preview?time=${encodeURIComponent(timeSec.toFixed(3))}`
    ),

  startRender: async (projectId: string, options: { preset?: string; crf?: number; frameLimit?: number } = {}) =>
    requestJson<{ ok: true; job: RenderJob }>(`/api/projects/${encodeURIComponent(projectId)}/render`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  listJobs: async (projectId?: string): Promise<RenderJob[]> => {
    const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await requestJson<{ ok: true; jobs: RenderJob[] }>(`/api/jobs${q}`);
    return res.jobs;
  },
  getJob: async (jobId: string): Promise<RenderJob> => {
    const res = await requestJson<{ ok: true; job: RenderJob }>(`/api/jobs/${encodeURIComponent(jobId)}`);
    return res.job;
  },
  cancelJob: async (jobId: string): Promise<RenderJob> => {
    const res = await requestJson<{ ok: true; job: RenderJob }>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return res.job;
  },

  getExportQa: async (projectId: string, exportId: string): Promise<ExportQaReport> => {
    const res = await requestJson<{ ok: true; qa: ExportQaReport }>(
      `/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportId)}/qa`
    );
    return res.qa;
  },

  subscribeJobEvents(jobId: string, onUpdate: (job: RenderJob) => void): () => void {
    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    es.onmessage = (ev) => {
      try {
        onUpdate(JSON.parse(ev.data) as RenderJob);
      } catch {
        // ignore malformed event
      }
    };
    return () => es.close();
  },
};
