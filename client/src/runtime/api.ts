import { readSessionToken } from '../lib/session.js';
import { resolveApiBase } from '../lib/apiBase.js';

const BASE = resolveApiBase(import.meta.env.VITE_OS_API, import.meta.env.VITE_API_URL);

export class RuntimeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'RuntimeApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = readSessionToken() ?? '';
  const response = await fetch(`${BASE}/api/os${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status})`;
    try { const body = await response.json() as { error?: string }; if (body.error) message = body.error; } catch { /* keep default */ }
    throw new RuntimeApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export interface RuntimeProviderInfo {
  id: 'docker' | 'process'; label: string; available: boolean; operational: boolean; isolated: boolean; reason: string; details: Record<string, unknown>;
}

export interface RuntimeCloudStatus {
  configuredProvider: string; operational: boolean; isolated: boolean; selected: string | null;
  providers: RuntimeProviderInfo[]; activeSessions: number; failedSessions: number;
  activeByProvider: Array<{ provider: string; kind: string; count: number }>;
  limits: { cpus: number; memoryMb: number; pids: number; timeoutMs: number; diskMb: number };
  maxSessionsPerWorkspace: number; truth: string;
}

export interface RuntimeStatusResponse {
  cloud: RuntimeCloudStatus;
  browser: { available: boolean; executable: string | null; reason: string; provider?: 'docker' | 'process'; isolated?: boolean; sandbox?: 'chromium' | 'container' | 'none'; containerImage?: string };
}

export interface RuntimeSession {
  id: string; kind: 'computer' | 'browser'; provider: string; status: string;
  missionId: string | null; taskId: string | null; limits: RuntimeCloudStatus['limits'];
  metadata?: { currentUrl?: string | null; currentTitle?: string | null; lastAction?: string | null; isolated?: boolean | null; network?: string | null; provider?: string | null; sandbox?: string | null };
  error: string; createdAt: string; startedAt: string | null; endedAt: string | null; expiresAt: string;
}

export interface RuntimeArtifact {
  id: string; sessionId: string; name: string; kind: string; mimeType: string; sizeBytes: number; createdAt: string; contentUrl: string;
}

export interface RuntimeSessionDetail {
  session: RuntimeSession;
  events: Array<{ id: string; kind: string; action: string; detail: Record<string, unknown>; createdAt: string }>;
  artifacts: RuntimeArtifact[];
}

export const runtimeApi = {
  status: () => request<RuntimeStatusResponse>('/runtime/status'),
  sessions: (missionId?: string) => request<{ computer: RuntimeSession[]; browser: RuntimeSession[] }>(`/runtime/sessions${missionId ? `?missionId=${encodeURIComponent(missionId)}` : ''}`),
  session: (id: string) => request<RuntimeSessionDetail>(`/runtime/sessions/${encodeURIComponent(id)}`),
  start: (kind: 'computer' | 'browser', ttlMinutes?: number) => request<RuntimeSession>('/runtime/sessions', { method: 'POST', body: JSON.stringify({ kind, ttlMinutes }) }),
  stop: (id: string, reason = 'api request') => request<RuntimeSession>(`/runtime/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', body: JSON.stringify({ reason }) }),
  artifacts: (missionId?: string) => request<RuntimeArtifact[]>(`/runtime/artifacts${missionId ? `?missionId=${encodeURIComponent(missionId)}` : ''}`),
  async artifactBlob(id: string): Promise<Blob> {
    const token = readSessionToken() ?? '';
    const response = await fetch(`${BASE}/api/os/runtime/artifacts/${encodeURIComponent(id)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new RuntimeApiError(`Artifact download failed (HTTP ${response.status})`, response.status);
    return await response.blob();
  },
};
