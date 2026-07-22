import type {
  AttentionItem,
  AutomationSettings,
  Feature,
  FeaturePhase,
  MergeQueueItem,
  Project,
} from '@sdd/shared';

export interface LiveSessionInfo {
  id: string;
  projectId: string;
  featureId: string | null;
  kind: string;
  status: 'idle' | 'working' | 'awaiting_input' | 'stopped' | 'errored';
  awaitingKind: string | null;
  exited: boolean;
}

export interface AppState {
  projects: (Project & { currentBranch: string | null })[];
  features: Feature[];
  sessions: LiveSessionInfo[];
  attention: AttentionItem[];
  queues: Record<string, MergeQueueItem[]>;
  automation: AutomationSettings;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* raw text */
    }
    throw new Error(message || `${method} ${url} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  state: () => request<AppState>('GET', '/api/state'),
  addProject: (path: string, name?: string) => request<unknown>('POST', '/api/projects', { path, name }),
  updateProject: (id: string, patch: Record<string, unknown>) =>
    request<Project>('PATCH', `/api/projects/${id}`, patch),
  removeProject: (id: string) => request<unknown>('DELETE', `/api/projects/${id}`),
  createFeature: (projectId: string, name: string, description?: string) =>
    request<Feature>('POST', `/api/projects/${projectId}/features`, { name, description }),
  startPhase: (featureId: string, phase: FeaturePhase, prompt?: string) =>
    request<Feature>('POST', `/api/features/${featureId}/phases/${phase}/start`, { prompt }),
  approvePhase: (featureId: string, phase: FeaturePhase) =>
    request<Feature>('POST', `/api/features/${featureId}/phases/${phase}/approve`),
  discardPhase: (featureId: string, phase: FeaturePhase) =>
    request<Feature>('POST', `/api/features/${featureId}/phases/${phase}/discard`),
  advance: (featureId: string, to: FeaturePhase) =>
    request<Feature>('POST', `/api/features/${featureId}/advance`, { to }),
  integrate: (featureId: string) => request<Feature>('POST', `/api/features/${featureId}/integrate`),
  approveMerge: (featureId: string) => request<Feature>('POST', `/api/features/${featureId}/approve-merge`),
  retryIntegration: (featureId: string) =>
    request<Feature>('POST', `/api/features/${featureId}/retry-integration`),
  archiveFeature: (featureId: string) => request<unknown>('POST', `/api/features/${featureId}/archive`),
  ensureSession: (featureId: string) => request<{ sessionId: string }>('POST', `/api/features/${featureId}/session`),
  sendPrompt: (featureId: string, text: string) =>
    request<unknown>('POST', `/api/features/${featureId}/prompt`, { text }),
  resolveAttention: (id: string) => request<unknown>('POST', `/api/attention/${id}/resolve`),
  setAutomation: (patch: Partial<AutomationSettings>) =>
    request<AutomationSettings>('PUT', '/api/settings/automation', patch),
  diff: (featureId: string) => request<{ numstat: string; diff: string }>('GET', `/api/features/${featureId}/diff`),
};
