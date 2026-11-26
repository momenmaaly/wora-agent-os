/**
 * WORA OS — typed client for the OS core (/api/os).
 * Same-origin by default (vite dev proxy / reverse proxy). `VITE_API_URL` is
 * the shared API origin; `VITE_OS_API` can override it for split deployments.
 * Never handles secrets — session/bearer flows are owned by the existing
 * workspace session module.
 */
import { readSessionToken } from '../lib/session.js';
import { resolveApiBase } from '../lib/apiBase.js';

const BASE = resolveApiBase(import.meta.env.VITE_OS_API, import.meta.env.VITE_API_URL);

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
  actionSummary: string; target?: string; consequences?: string; resourceImpact?: string;
  summaryVersion?: string; reviewDigest?: string; risk: string; actionClass?: 'A' | 'B' | 'C'; scope?: string; payloadDigest?: string;
  expiresAt?: string | null; amountUsd?: number | null;
  toolInput: Record<string, unknown>; requestedBy: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  decisionNote: string; decidedBy: string | null; decidedAt: string | null;
  consumedAt?: string | null; consumedBy?: string | null; createdAt: string;
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
  specialization: string; status: 'created' | 'planned' | 'assigned' | 'running' | 'reviewing' | 'completed' | 'failed' | 'blocked' | 'cancelled';
  agentId: string | null;
  agent: { id: string; name: string; specialization: string } | null;
  dependsOn: string[]; acceptance: string[];
  tool: string | null; toolInput: Record<string, unknown>; fallbackTools?: string[]; detail: string;
  runs: OsRun[]; createdAt: string; updatedAt: string;
}

export interface Handoff {
  id: string; taskId: string; from: string; to: string;
  contract: Record<string, unknown>; createdAt: string;
}

export interface MissionSummary {
  id: string; objective: string;
  status: 'planning' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  summary: string; requestedBy: string; artifactId: string | null;
  outcomeStatus?: OutcomeStatus;
  createdAt: string; updatedAt: string;
}

export type OutcomeStatus = 'verified' | 'partially_verified' | 'unverified' | 'failed' | 'blocked' | 'requires_human_review';

export interface OutcomeVerification {
  missionId: string; workspaceId: string; status: OutcomeStatus;
  checks: Array<{ id: string; kind: string; status: 'passed' | 'failed' | 'not_run'; description: string; evidence: string }>;
  reasons: string[];
  taskEvidence: Array<{ taskId: string; tool: string | null; status: string; verification: string | null; outcome: string }>;
  artifactId: string | null; generatedAt: string;
}

export interface MissionDetail extends MissionSummary {
  tasks: OsTask[];
  handoffs: Handoff[];
  approvals: ApprovalRecord[];
  artifacts: Array<{ id: string; name: string; kind: string; created_at?: string; createdAt?: string }>;
  problemProfile?: ProblemProfile | null;
  problemModel?: UnifiedProblem | null;
  composition?: CompositionRecord | null;
  planVersions?: PlanVersion[];
  planVerification?: { passed: boolean; checks: Array<{ id: string; status: 'passed' | 'failed'; evidence: string }> };
  verifications?: VerificationRecord[];
  outcomeStatus?: OutcomeStatus;
  outcomeVerification?: OutcomeVerification | null;
  reasoning?: ReasoningModel | null;
}


export type ReasoningMode = 'deterministic' | 'model-assisted' | 'deterministic-fallback';
export interface ReasoningClaim {
  id: string; statement: string; kind: string; active: boolean;
  provenance: { kind: string; sourceId: string; source: string; trust: string; observedAt: string | null; digest: string | null };
  confidence: { value: number; kind: string; note: string }; evidenceIds: string[];
}
export interface ReasoningHypothesis {
  id: string; claimId: string; statement: string; cause: string; status: 'candidate' | 'supported' | 'rejected' | 'undetermined';
  rank: number; score: number; scoreKind: string; assumptions: string[]; evidenceFor: string[]; evidenceAgainst: string[];
  distinguishingTests: string[]; rejectionReason: string | null; revision: number; updatedAt: string;
}
export interface ReasoningCausalEdge {
  id: string; cause: string; effect: string; relation: string; evidenceKind: string; identified: boolean;
  evidenceIds: string[]; confounders: string[]; limitation: string; claimId: string | null;
}
export interface ReasoningInformationNeed {
  id: string; question: string; unknownClaimId: string | null; materiality: string; expectedInformationGain: number;
  cost: { timeMinutes: number; costUsd: number | null; risk: string; reversible: boolean };
  canSelfGather: boolean; recommendedAction: string; rationale: string; status: string;
}
export interface ReasoningMethod {
  id: string; name: string; domain: string; status: string; applies: boolean; reason: string;
  requiredInputs: string[]; assumptions: string[]; expectedOutputs: string[]; limitations: string[];
  evidenceRequirements: string[]; implemented: boolean; externalCapabilityRequired: boolean; gap: string | null; selected: boolean;
}
export interface ProblemStructureForecast {
  intent: boolean; targetVariable: string | null; horizon: { text: string; steps: number | null; unit: string; assumption: string | null } | null;
  observations: number[]; seriesSource: string | null; seriesMalformed: boolean; conflictingRecords: boolean;
  basis: string; requirements: Array<{ id: string; label: string; present: boolean; reason: string }>;
  missingInputs: string[]; canExecute: boolean; assumptions: string[]; extractionNotes: string[];
}
export interface ProblemStructure {
  schemaVersion: string; objectiveDigest: string; kind: string; confidence: number;
  signals: { projection: string[]; temporal: string[]; historical: string[]; target: string[]; negative: string[]; forecast: string[] };
  forecasting: ProblemStructureForecast | null;
  provenance: { kind: string; source: string; trust: string; digest: string };
}

export interface ReasoningModel {
  schemaVersion: string; workspaceId: string | null; missionId: string | null; version: number; parentVersion: number | null;
  mode: ReasoningMode; provider: { name: string; model: string | null; status: string; notice: string };
  objective: string; desiredOutcome: string; problemType: string; domain: string;
  claims: ReasoningClaim[]; hypotheses: ReasoningHypothesis[]; causalGraph: ReasoningCausalEdge[];
  informationNeeds: ReasoningInformationNeed[]; methods: ReasoningMethod[]; contradictions: string[];
  unknowns: string[]; assumptions: string[]; sufficientToProceed: boolean; clarificationQuestion: string | null;
  confidence: { value: number; kind: string; note: string }; limitations: string[];
  changes: Array<{ version: number; kind: string; description: string; invalidatedAssumptionIds: string[]; replanRecommended: boolean; createdAt: string }>;
  baseProblem?: UnifiedProblem | null; problemStructure?: ProblemStructure | null;
  createdAt: string;
}
export interface ReasoningSummary {
  schemaVersion: string; mode: ReasoningMode; providerStatus: string; problemType: string; sufficientToProceed: boolean;
  claimCounts: Record<string, number>; hypothesisCount: number; rejectedHypothesisCount: number; causalEdgeCount: number;
  informationNeedCount: number; criticalInformationNeedCount: number; selectedMethod: string | null; gapMethods: string[];
  clarificationQuestion: string | null; confidence: { value: number; kind: string; note: string }; limitations: string[];
}

export interface UnifiedProblem {
  schemaVersion: string; objective: string; desiredOutcome: string; successCriteria: string[];
  domain: string; subdomains: string[]; problemTypes: string[];
  facts: Array<{ id: string; statement: string; provenance: string; source: string; confidence: number | null }>;
  evidence: Array<{ id: string; statement: string; provenance: string; source: string; confidence: number | null; memoryId?: string; score?: number }>;
  assumptions: Array<{ id: string; statement: string; provenance: string; source: string; confidence: number | null }>;
  unknowns: string[]; constraints: string[]; dependencies: string[]; resources: string[];
  limits: { timeMs: number | null; costUsd: number | null; note: string };
  risk: string; reversibility: string; uncertainty: string; deterministic: boolean; stochastic: boolean; precision: string;
  approvals: string[]; needs: string[];
  methods: { selected: { name: string; toolId: string | null; guarantee: string } | null; rejected: Array<{ name: string; reason: string; status: string }>; missing: string[]; rationale: string[]; assumptions: string[] };
  confidence: number; provenance: string[]; reasoning?: ReasoningSummary; structure?: ProblemStructure | null; createdAt: string;
}

export interface CompositionNode {
  id: string; title: string; objective: string; role: string; capabilityKind: string; tool: string;
  skillKeys: string[]; agentId: string | null; specialization: string; dependsOn: string[];
  inputs: string[]; outputs: string[]; preconditions: string[]; postconditions: string[];
  permissions: string[]; permissionsApproved: string[]; available: boolean; risk: string;
  costClass: string; latencyClass: string; verification: string[]; fallbackTools: string[]; reason: string;
}

export interface CompositionRecord {
  id: string; workspaceId: string; missionId: string; selectedStrategy: string;
  graph: { schemaVersion: string; objective: string; nodes: CompositionNode[]; edges: Array<{ from: string; to: string; kind: string }>; gaps: Array<{ node: string | null; message: string; missing: string[] }>; explanation: string; createdAt: string };
  strategies: Array<{ id: string; name: string; description: string; nodeIds: string[]; score: number; feasible: boolean; rejectionReason: string | null; assumptions: string[]; metrics: Record<string, number> }>;
  gaps: Array<{ node: string | null; message: string; missing: string[] }>;
  explanation: string; createdAt: string; updatedAt: string;
}

export interface ProblemProfile {
  schemaVersion: string; objective: string; domain: string; plannerTrack: string | null; confidence: number;
  constraints: string[]; dependencies: string[]; resources: string[]; uncertainty: string[];
  successCriteria: string[]; missingInformation: string[]; ambiguity: string[];
  features: Record<string, boolean | number | undefined>;
  algorithmSelection: { status: string; problemKind: string; confidence: number; rationale: string[]; primary: { name: string; toolId: string | null; guarantee: string; limitations: string[] } | null; alternatives: Array<{ name: string; toolId: string | null }>; missingInformation: string[]; warnings: string[] };
  fallback: { strategy: string; reason: string }; source: string;
}

export interface FormalTask {
  index: number; title: string; goal: string; subgoals: string[]; preconditions: string[]; effects: string[];
  constraints: string[]; resources: { tool: string | null; permissions: string[]; agentSpecialization: string };
  uncertainty: { risk: 'low' | 'medium' | 'high'; note: string }; estimatedCost: number; dependsOn: number[];
}

export interface PlanVersion {
  id: string; workspaceId: string; missionId: string; version: number; strategy: string;
  plan: { schemaVersion: string; strategy: string; tasks: FormalTask[]; order: number[]; criticalPath: number[]; metrics: { totalCost: number; maxRisk: string; uncertaintyCount: number; taskCount: number; depth: number }; assumptions: string[]; limitations: string[] };
  comparison: unknown; reason: string; actor: string; createdAt: string;
}

export interface TaskLease { taskId: string; missionId: string; workspaceId: string; ownerId: string; acquiredAt: string; heartbeatAt: string; expiresAt: number; updatedAt: string }
export interface TaskCheckpoint { id: string; taskId: string; missionId: string; workspaceId: string; runId: string; attempt: number; status: string; outputDigest: string; evidenceDigest: string; checkpoint: unknown; createdAt: string; updatedAt: string }
export interface VerificationRecord { id: string; missionId: string; taskId: string; runId: string; result: string; independence: string; verifier: string; failureReason: string; checks: Array<{ id: string; kind: string; description: string; status: string; evidence?: string }>; createdAt: string }
export interface ExecutionLimits { maxConcurrentTasks: number; leaseTtlMs: number; maxAttempts: number }

export interface Lesson {
  id: string; workspaceId: string; missionId: string | null; taskId: string | null; title: string; content: string;
  evidence: unknown[]; status: 'candidate' | 'tested' | 'promoted' | 'rejected' | 'revoked'; confidence: number; version: number;
  provenance: string; createdBy: string; promotedBy: string | null; promotedAt: string | null; memoryId: string | null;
  revokedBy: string | null; revokedAt: string | null; revocationReason: string; outcomeCount: number; successCount: number; effectiveness: number;
  createdAt: string; updatedAt: string;
}
export interface LessonEvent { id: string; workspaceId: string; lessonId: string; action: string; actor: string; detail: unknown; createdAt: string }
export interface BenchmarkResult { id: string; name: string; toolId: string; problemClass: string; correctness: boolean; quality: number | null; timeMs: number; toolCalls: number; reference: string; alternatives: string[]; limitations: string[]; evidence: Record<string, unknown> }
export interface BenchmarkRun { id: string; workspaceId: string; suiteVersion: string; results: BenchmarkResult[]; summary: { total: number; passed: number; failed: number; totalMs: number; deterministicFixtures: number }; createdAt: string }

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
export interface RecoveryReport {
  workspaceId: string; interruptedMissions: number; blockedTasks: number;
  activeLeases: number; expiredLeases: number; startedCheckpoints: number;
  pendingApprovals: number; resumable: boolean;
}

export interface RuntimeStatus {
  mode: string; durableStore: boolean; missionLease: boolean; taskLeases: boolean;
  checkpoints: boolean; independentWorkers: string; limitations: string[];
  limits: ExecutionLimits; recovery: RecoveryReport; activeLeases: number;
  activeMissionLeases: number; runnableMissions: Array<{ id: string; status: string }>;
  cloud?: {
    operational: boolean; isolated: boolean; selected: string | null;
    activeSessions: number; failedSessions: number;
    providers: Array<{ id: string; label: string; operational: boolean; isolated: boolean; reason: string }>;
  };
  browser?: { available: boolean; executable: string | null; reason: string };
}

export interface MigrationStatus {
  version: number;
  applied: Array<{ version: number; name: string; appliedAt: string; rolledBackAt: string | null }>;
  pending: number[];
}

export interface MetricsSnapshot { counters: Record<string, number>; gauges: Record<string, number>; histograms?: Record<string, unknown> }

/* ─── Endpoints ─────────────────────────────────────────── */
export const osApi = {
  state: () => request<OsState>('/state'),
  runtimeStatus: () => request<RuntimeStatus>('/runtime/status'),
  recovery: () => request<RecoveryReport>('/recovery'),
  migrations: () => request<MigrationStatus>('/migrations'),
  metrics: () => request<MetricsSnapshot>('/metrics'),
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
  executeMission: (id: string, concurrency?: number) => request<MissionDetail>(`/missions/${encodeURIComponent(id)}/execute`, { method: 'POST', body: JSON.stringify(concurrency ? { concurrency } : {}) }),
  resumeMission: (id: string) => request<MissionDetail>(`/missions/${encodeURIComponent(id)}/execute`, { method: 'POST', body: '{}' }),
  pauseMission: (id: string) => request<MissionDetail>(`/missions/${encodeURIComponent(id)}/pause`, { method: 'POST', body: '{}' }),
  cancelMission: (id: string) => request<MissionDetail>(`/missions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }),
  missionLeases: (id: string) => request<TaskLease[]>(`/missions/${encodeURIComponent(id)}/leases`),
  taskCheckpoints: (id: string) => request<TaskCheckpoint[]>(`/tasks/${encodeURIComponent(id)}/checkpoints`),
  missionPlans: (id: string) => request<PlanVersion[]>(`/missions/${encodeURIComponent(id)}/plans`),
  replanMission: (id: string, reason: string) => request<PlanVersion>(`/missions/${encodeURIComponent(id)}/replan`, { method: 'POST', body: JSON.stringify({ reason }) }),
  missionVerifications: (id: string) => request<VerificationRecord[]>(`/missions/${encodeURIComponent(id)}/verifications`),
  missionOutcome: (id: string) => request<OutcomeVerification>(`/missions/${encodeURIComponent(id)}/outcome`),
  missionReasoning: (id: string) => request<ReasoningModel>(`/missions/${encodeURIComponent(id)}/reasoning`),
  missionReasoningVersions: (id: string) => request<Array<{ id: string; version: number; parentVersion: number | null; mode: string; createdAt: string; model: ReasoningModel }>>(`/missions/${encodeURIComponent(id)}/reasoning/versions`),
  addReasoningEvidence: (id: string, evidence: Array<{ statement: string; kind?: 'user-fact' | 'assumption'; source?: string }>) => request<{ model: ReasoningModel; change: Record<string, unknown> }>(`/missions/${encodeURIComponent(id)}/reasoning/evidence`, { method: 'POST', body: JSON.stringify({ evidence }) }),
  reasonProblem: (body: { objective: string; track?: string; useModel?: boolean; evidence?: Array<{ statement: string; kind?: 'user-fact' | 'assumption' }> }) => request<ReasoningModel>('/problems/reason', { method: 'POST', body: JSON.stringify(body) }),
  understandProblem: (objective: string, track?: string) => request<ProblemProfile>('/problems/understand', { method: 'POST', body: JSON.stringify({ objective, ...(track ? { track } : {}) }) }),
  launchMission: (objective: string, track?: string) =>
    request<MissionDetail>('/missions', { method: 'POST', body: JSON.stringify({ objective, ...(track ? { track } : {}) }) }),
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

  approvals: (status: 'pending' | 'approved' | 'denied' | 'expired' | 'all' = 'pending') =>
    request<ApprovalRecord[]>(`/approvals?status=${status}`),
  decideApproval: (id: string, decision: 'approved' | 'denied', note = '') =>
    request<ApprovalRecord>(`/approvals/${encodeURIComponent(id)}/decide`, { method: 'POST', body: JSON.stringify({ decision, note }) }),

  executionLimits: () => request<ExecutionLimits>('/settings/execution-limits'),
  setExecutionLimits: (body: Partial<ExecutionLimits>) => request<ExecutionLimits>('/settings/execution-limits', { method: 'POST', body: JSON.stringify(body) }),

  autonomy: () => request<{ policy: 'balanced' | 'autopilot' }>('/settings/autonomy'),
  setAutonomy: (policy: 'balanced' | 'autopilot') =>
    request<{ policy: 'balanced' | 'autopilot' }>('/settings/autonomy', { method: 'POST', body: JSON.stringify({ policy }) }),

  lessons: (status: Lesson['status'] | 'all' = 'all') => request<Lesson[]>(`/lessons?status=${status}`),
  lesson: (id: string) => request<Lesson>(`/lessons/${encodeURIComponent(id)}`),
  lessonHistory: (id: string) => request<LessonEvent[]>(`/lessons/${encodeURIComponent(id)}/history`),
  collectLessons: (missionId: string) => request<Lesson[]>('/lessons/collect', { method: 'POST', body: JSON.stringify({ missionId }) }),
  evaluateLesson: (id: string) => request<Lesson>(`/lessons/${encodeURIComponent(id)}/evaluate`, { method: 'POST', body: '{}' }),
  promoteLesson: (id: string) => request<Lesson>(`/lessons/${encodeURIComponent(id)}/promote`, { method: 'POST', body: '{}' }),
  rejectLesson: (id: string, reason: string) => request<Lesson>(`/lessons/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  revokeLesson: (id: string, reason: string) => request<Lesson>(`/lessons/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }),
  recordLessonOutcome: (id: string, success: boolean, missionId?: string) => request<Lesson>(`/lessons/${encodeURIComponent(id)}/outcomes`, { method: 'POST', body: JSON.stringify({ success, ...(missionId ? { missionId } : {}) }) }),
  benchmarks: () => request<BenchmarkRun[]>('/benchmarks/runs'),
  benchmarkDomains: () => request<Array<{ domain: string; implemented: string[]; partial: string[]; missing: string[] }>>('/benchmarks/domains'),
  runBenchmarks: () => request<BenchmarkRun>('/benchmarks/run', { method: 'POST', body: '{}' }),

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
