/**
 * WORA OS — typed client for the OS core (/api/os).
 * Same-origin by default (vite dev proxy / reverse proxy); set VITE_OS_API
 * to point at an API origin. Never handles secrets — session/bearer flows are
 * owned by the existing workspace session module.
 */
import { readSessionToken } from '../lib/session.js';

const BASE = (import.meta.env['VITE_OS_API'] as string | undefined)?.replace(/\/$/, '') ?? '';

export class OsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'OsApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = readSessionToken() ?? '';
  const response = await fetch(`${BASE}/api/os${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch { /* keep default */ }
    throw new OsApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ─── Types ─────────────────────────────────────────────── */
export interface OsState {
  agents: number;
  missions: { total: number; running: number; awaitingApproval: number; completed: number; failed: number };
  tasks: { completed: number; failed: number; blocked: number };
  approvals: { pending: number };
  devices: { pending: number; paired: number };
  memory: number;
  organizations: number;
  projects: number;
  artifacts: number;
}

export interface ApprovalRecord {
  id: string; kind: string; missionId: string | null; taskId: string | null; toolId: string | null;
  actionSummary: string; risk: string; toolInput: Record<string, unknown>; requestedBy: string;
  status: 'pending' | 'approved' | 'denied';
  decisionNote: string; decidedBy: string | null; decidedAt: string | null; createdAt: string;
}

export interface Playbook {
  id: string; name: string; toolId: string; keywords: string[];
  validation: { ok: boolean; detail: string };
  status: 'validated'; successRuns: number; reuseCount?: number; createdFromMission: string | null; createdAt: string; updatedAt: string;
}

export interface AiUsageSummary {
  since: string; days: number; pricingNote: string;
  totals: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  byProvider: Array<Record<string, unknown>>;
}

export interface DeviceRecord {
  id: string; name: string; platform: string; status: 'pending' | 'paired' | 'revoked';
  fingerprint: string; permissions: string[];
  createdAt: string; pairedAt: string | null; revokedAt: string | null; lastSeenAt: string | null;
}

export interface Specialization {
  id: string; label: string; description: string;
  skills: string[]; tools: string[]; permissions: string[]; modelTier: string;
}

export interface ToolInfo {
  id: string; name: string; description: string;
  inputSchema: Record<string, unknown>;
  permission: string | null;
  risk: 'low' | 'medium' | 'high';
  environment: string; timeoutMs: number;
}

export interface Agent {
  id: string; name: string; role: string; specialization: string;
  skills: string[]; tools: string[]; permissions: string[];
  status: 'active' | 'paused' | 'archived';
  source: string; instructions: string;
  model: { provider?: string; model?: string };
  limits: { maxTokens?: number; timeoutMs?: number };
  evaluation: string[];
  createdAt: string; updatedAt: string;
}

export interface OsRun {
  id: string; status: string; attempt: number;
  startedAt: string; finishedAt: string | null;
  summary: string;
  evidence: Array<Record<string, unknown>>;
  issues: string[];
}

export interface OsTask {
  id: string; orderIndex: number; title: string; objective: string;
  specialization: string; status: 'created' | 'planned' | 'assigned' | 'running' | 'reviewing' | 'completed' | 'failed' | 'blocked';
  agentId: string | null;
  agent: { id: string; name: string; specialization: string } | null;
  dependsOn: string[]; acceptance: string[];
  tool: string | null; toolInput: Record<string, unknown>; detail: string;
  runs: OsRun[]; createdAt: string; updatedAt: string;
}

export interface Handoff {
  id: string; taskId: string; from: string; to: string;
  contract: Record<string, unknown>; createdAt: string;
}

export interface MissionSummary {
  id: string; objective: string;
  status: 'planning' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
  summary: string; requestedBy: string; artifactId: string | null;
  createdAt: string; updatedAt: string;
}

export interface MissionDetail extends MissionSummary {
  tasks: OsTask[];
  handoffs: Handoff[];
  approvals: ApprovalRecord[];
  artifacts: Array<{ id: string; name: string; kind: string; created_at?: string; createdAt?: string }>;
}

export interface ScheduleRequest {
  employees: Array<{ id: string; name: string; hourlyCost: number; availability: string[]; maxAssignments?: number }>;
  shifts: Array<{ id: string; name: string; demand: number }>;
}

export interface ScheduleResult {
  status: string; feasible: boolean; totalCost: number | null;
  assignments: Array<{ employeeId: string; employeeName: string; shiftId: string; shiftName: string; hourlyCost: number }>;
  perShift: Array<{ shiftId: string; shiftName: string; demand: number; assigned: number; meetsDemand: boolean; employees: string[] }>;
  unassignedEmployees: string[];
  validation: string[];
  lp: string;
}

export interface MonteCarloResult {
  simulated: boolean; method: string; trials: number; seed: number;
  mean: number; stddev: number; p10: number; p50: number; p90: number; min: number; max: number;
  histogram: Array<{ from: number; to: number; count: number }>;
  disclaimer: string;
}

export interface DecisionResult {
  ranking: Array<{ name: string; score: number }>;
  winner: string;
  robust: boolean;
  perturbationNotes: string[];
  methodology: string;
}

export interface Organization {
  id: string; name: string; objective: string; template: string;
  departments: Array<{ id: string; name: string; mission: string; managerRole: string; kpis: string[] }>;
  leadership: Array<{ title: string; agentId: string | null }>;
  createdAt: string;
}

export interface OrgBuildResult {
  organizationId: string; name: string; template: string;
  projectId: string; kickoffMissionId: string;
  departments: Organization['departments'];
  agentsCreated: number; agentsReused: number;
  reporting: Array<{ from: string; to: string }>;
}

/* ─── Endpoints ─────────────────────────────────────────── */
export const osApi = {
  state: () => request<OsState>('/state'),
  specializations: () => request<Specialization[]>('/specializations'),
  tools: () => request<ToolInfo[]>('/tools'),
  sampleEmployeeSchedule: () => request<{ sample: boolean; employees: ScheduleRequest['employees']; shifts: ScheduleRequest['shifts']; note: string }>('/sample/employee-schedule'),

  agents: (query = '') => request<Agent[]>(`/agents${query ? `?query=${encodeURIComponent(query)}` : ''}`),
  createAgent: (body: { name: string; role: string; specialization: string; skills?: string[]; instructions?: string }) =>
    request<Agent>('/agents', { method: 'POST', body: JSON.stringify(body) }),
  updateAgent: (id: string, body: Partial<Pick<Agent, 'status' | 'name' | 'role' | 'skills' | 'instructions'>>) =>
    request<Agent>(`/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAgent: (id: string) => request<void>(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  missions: () => request<MissionSummary[]>('/missions'),
  mission: (id: string) => request<MissionDetail>(`/missions/${encodeURIComponent(id)}`),
  resumeMission: (id: string) => request<MissionDetail>(`/missions/${encodeURIComponent(id)}/execute`, { method: 'POST', body: '{}' }),
  launchMission: (objective: string) =>
    request<MissionDetail>('/missions', { method: 'POST', body: JSON.stringify({ objective }) }),
  artifact: (id: string) => request<{ id: string; name: string; kind: string; content: string }>(`/artifacts/${encodeURIComponent(id)}`),

  employeeSchedule: (body: ScheduleRequest) =>
    request<ScheduleResult>('/optimize/employee-schedule', { method: 'POST', body: JSON.stringify(body) }),
  monteCarlo: (body: { trials: number; seed: number; items: Array<{ name: string; optimistic: number; likely: number; pessimistic: number }> }) =>
    request<{ ok: boolean; output?: MonteCarloResult; error?: string }>('/simulate/monte-carlo', { method: 'POST', body: JSON.stringify(body) }),
  decisionMatrix: (body: { criteria: Array<{ id: string; label: string; weight: number }>; alternatives: Array<{ name: string; scores: Record<string, number> }> }) =>
    request<{ ok: boolean; output?: DecisionResult; error?: string }>('/decision/matrix', { method: 'POST', body: JSON.stringify(body) }),

  organizations: () => request<Organization[]>('/organizations'),
  buildOrganization: (body: { objective: string; name?: string }) =>
    request<OrgBuildResult>('/organizations', { method: 'POST', body: JSON.stringify(body) }),

  memory: (query = '') => request<Array<Record<string, unknown>>>(`/memory${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  addMemory: (body: { scope: string; scopeId?: string; content: string; tags?: string[]; visibility?: 'workspace' | 'owner'; ttlDays?: number | null }) =>
    request<Record<string, unknown>>('/memory', { method: 'POST', body: JSON.stringify(body) }),
  deleteMemory: (id: string) => request<void>(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  audit: (limit = 50) => request<Array<{ id: string; actor: string; action: string; subject: string; detail: Record<string, unknown>; createdAt: string }>>(`/audit?limit=${limit}`),

  approvals: (status: 'pending' | 'approved' | 'denied' | 'all' = 'pending') =>
    request<ApprovalRecord[]>(`/approvals?status=${status}`),
  decideApproval: (id: string, decision: 'approved' | 'denied', note = '') =>
    request<ApprovalRecord>(`/approvals/${encodeURIComponent(id)}/decide`, { method: 'POST', body: JSON.stringify({ decision, note }) }),

  autonomy: () => request<{ policy: 'balanced' | 'autopilot' }>('/settings/autonomy'),
  setAutonomy: (policy: 'balanced' | 'autopilot') =>
    request<{ policy: 'balanced' | 'autopilot' }>('/settings/autonomy', { method: 'POST', body: JSON.stringify({ policy }) }),

  playbooks: () => request<Playbook[]>('/playbooks'),
  deletePlaybook: (id: string) => request<void>(`/playbooks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  usage: (days = 30) => request<AiUsageSummary>(`/usage?days=${days}`),

  board: () => request<{ state: Record<string, unknown> | null; updatedAt: string | null; sizeBytes?: number }>('/board'),
  saveBoard: (state: Record<string, unknown>) => request<{ updatedAt: string; sizeBytes: number }>('/board', { method: 'PUT', body: JSON.stringify({ state }) }),
  clearBoard: () => request<void>('/board', { method: 'DELETE' }),

  roles: () => request<{ me: { userId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }; members: Array<{ userId: string; role: string; grantedBy: string }> }>('/roles'),
  setRole: (userId: string, role: 'owner' | 'admin' | 'member' | 'viewer') =>
    request<{ userId: string; role: string }>('/roles', { method: 'POST', body: JSON.stringify({ userId, role }) }),
  removeRole: (userId: string) => request<void>(`/roles/${encodeURIComponent(userId)}`, { method: 'DELETE' }),

  agentVersions: (id: string) => request<Array<{ id: string; version: number; changedBy: string; createdAt: string; snapshot: Record<string, unknown> }>>(`/agents/${encodeURIComponent(id)}/versions`),
  memoryVersions: (id: string) => request<Array<{ id: string; action: string; actor: string; createdAt: string; content: string; tags: string[] }>>(`/memory/${encodeURIComponent(id)}/versions`),

  twins: () => request<TwinRecord[]>('/twins'),
  createTwin: (body: { name: string; entityType?: string; drivers: TwinDriverInput[]; kpis?: TwinKpiInput[]; notes?: string }) =>
    request<TwinRecord>('/twins', { method: 'POST', body: JSON.stringify(body) }),
  twin: (id: string) => request<TwinRecord>(`/twins/${encodeURIComponent(id)}`),
  deleteTwin: (id: string) => request<void>(`/twins/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  recordTwinObservation: (id: string, payload: Record<string, unknown>) =>
    request<{ id: string; type: string; createdAt: string }>(`/twins/${encodeURIComponent(id)}/observations`, { method: 'POST', body: JSON.stringify({ payload }) }),
  runTwinScenario: (id: string, body: { name: string; adjustments: Array<{ driver: string; op: 'mul' | 'add'; value: number }>; trials?: number; seed?: number }) =>
    request<TwinScenarioResult>(`/twins/${encodeURIComponent(id)}/scenario`, { method: 'POST', body: JSON.stringify(body) }),

  devices: () => request<DeviceRecord[]>('/devices'),
  pairDevice: (body: { name: string; platform: string }) =>
    request<DeviceRecord & { pairingCode: string; note: string }>('/devices/pair', { method: 'POST', body: JSON.stringify(body) }),
  redeemDevice: (id: string, body: { code: string; fingerprint: string }) =>
    request<DeviceRecord>(`/devices/${encodeURIComponent(id)}/redeem`, { method: 'POST', body: JSON.stringify(body) }),
  revokeDevice: (id: string) =>
    request<DeviceRecord>(`/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: '{}' }),
};

export interface TwinDriverInput { name: string; optimistic: number; likely: number; pessimistic: number }
export interface TwinKpiInput { id: string; label: string; unit?: string; target?: number }
export interface TwinEvent { id: string; type: 'observation' | 'scenario' | 'note'; payload: Record<string, unknown>; createdAt: string }
export interface TwinRecord {
  id: string; workspaceId: string; name: string; entityType: string;
  params: { drivers: TwinDriverInput[]; notes: string };
  kpis: TwinKpiInput[]; events: TwinEvent[]; createdAt: string; updatedAt: string;
}
export interface TwinScenarioResult {
  simulated: true;
  baseline: { p10: number; p50: number; p90: number; mean: number };
  scenario: { p10: number; p50: number; p90: number; mean: number };
  deltaP50: number; deltaP90: number; deltaMeanPct: number;
  adjustments: Array<{ driver: string; op: 'mul' | 'add'; value: number }>;
  trials: number; seed: number;
}
