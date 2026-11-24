/**
 * WORA OS — dynamic capability analysis, specialist selection and team formation.
 * Deterministic, explainable, and grounded in the existing registry, plan,
 * verified evidence, workload and security boundaries.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { getAgent, listAgents, type AgentRecord } from './registry.js';
import { getTool } from './tools.js';
import { SPECIALIZATION_BY_ID, type Specialization } from './specializations.js';
import { resolveCapabilities, type CapabilityProfile } from '../extensions/capabilities.js';
import type { ProblemProfile } from './problem.js';

export const SELECTION_SCHEMA_VERSION = '1.0';
export type SelectionRisk = 'low' | 'medium' | 'high';
export type TeamStrategy = 'single_agent' | 'multi_agent' | 'capability_gap';

export interface CapabilityRequirement {
  id: string; capability: string; label: string; description: string;
  taskIndex: number; taskTitle: string; specialization: string;
  requiredSkills: string[]; requiredTools: string[]; requiredPermissions: string[];
  expectedOutput: string; acceptance: string[]; dependsOn: number[];
  risk: SelectionRisk; minSuitability: number;
}
export interface CandidateMetrics {
  verifiedSamples: number; successRate: number; recentFailureRate: number;
  workload: number; costUnits: number; latencyUnits: number;
}
export interface CandidateEvaluation {
  agentId: string; agentName: string; specialization: string; eligible: boolean;
  rejectionReasons: string[]; score: number; confidence: number; capabilityMatch: number;
  missingTools: string[]; missingPermissions: string[]; metrics: CandidateMetrics;
  factors: { capability: number; performance: number; availability: number; workload: number; cost: number; latency: number };
  explanation: string;
}
export interface SelectionDecision {
  requirement: CapabilityRequirement;
  selectedAgentId: string | null; selectedAgentName: string | null; confidence: number;
  explanation: {
    summary: string; matchedCapabilities: string[]; matchedSkills: string[]; matchedTools: string[];
    alternativesConsidered: Array<{ agentId: string; agentName: string; score: number; eligible: boolean; reason: string }>;
    expectedCostUnits: number | null; expectedLatencyUnits: number | null; unresolvedRisks: string[];
  };
  candidates: CandidateEvaluation[]; gap: string | null;
}
export interface TeamAssignment {
  taskIndex: number; taskTitle: string; requirementId: string;
  agentId: string | null; agentName: string | null; dependsOn: number[];
  status: 'assigned' | 'capability_gap';
}
export interface TeamPlan {
  schemaVersion: typeof SELECTION_SCHEMA_VERSION;
  missionId: string | null; strategy: TeamStrategy;
  requirements: CapabilityRequirement[]; decisions: SelectionDecision[];
  team: Array<{ agentId: string; name: string; specialization: string; capabilities: string[]; workload: number; confidence: number }>;
  assignments: TeamAssignment[]; parallelGroups: number[][];
  gaps: Array<{ taskIndex: number; taskTitle: string; capability: string; reason: string }>;
  explanation: string; createdAt: string;
}
export interface SelectionTask {
  id?: string; title: string; objective: string; specialization: string;
  tool: string | null; acceptance: string[]; dependsOn: number[]; agentId?: string | null;
}
interface PerformanceEvidence {
  samples: number; successes: number; failures: number; successRate: number;
  recentFailureRate: number; lastFailureAt: string | null; confidence: number;
}
const MODEL_COST: Record<string, number> = { general: 1, analysis: 1.2, coding: 1.5, planning: 1.8 };
const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const specOf = (id: string): Specialization | null => SPECIALIZATION_BY_ID.get(id) ?? null;

export function requirementForTask(task: SelectionTask, index: number, workspaceId: string): CapabilityRequirement {
  const spec = specOf(task.specialization);
  const tool = task.tool ? getTool(task.tool, workspaceId) : null;
  return {
    id: `cap-${index}-${task.specialization}`, capability: task.specialization,
    label: spec?.label ?? task.specialization,
    description: spec?.description ?? `Task capability: ${task.title}`,
    taskIndex: index, taskTitle: task.title, specialization: task.specialization,
    requiredSkills: spec?.skills ?? [], requiredTools: tool ? [tool.id] : [],
    requiredPermissions: tool ? unique([...(tool.permission ? [tool.permission] : []), ...(tool.permissions ?? [])]) : [],
    expectedOutput: task.acceptance[0] ?? `A verified result for: ${task.title}`,
    acceptance: task.acceptance.slice(0, 12), dependsOn: [...task.dependsOn],
    risk: (tool?.risk ?? 'low') as SelectionRisk,
    minSuitability: task.specialization === 'generalist' ? 0.45 : 0.55,
  };
}
export function requirementsForPlan(plan: SelectionTask[], workspaceId: string): CapabilityRequirement[] {
  return plan.map((task, index) => requirementForTask(task, index, workspaceId));
}
function workloadFor(workspaceId: string, agentId: string): number {
  const row = getOsDb().prepare("SELECT COUNT(*) AS c FROM os_tasks WHERE workspace_id = ? AND agent_id = ? AND status IN ('assigned', 'running', 'reviewing')")
    .get(workspaceId, agentId) as { c?: number } | undefined;
  return Number(row?.c ?? 0);
}
function evidenceFromVerifications(workspaceId: string, agentId: string, capability: string): PerformanceEvidence {
  const rows = getOsDb().prepare(`SELECT v.result, v.created_at
    FROM os_verifications v JOIN os_runs r ON r.id = v.run_id JOIN os_tasks t ON t.id = v.task_id
    WHERE v.workspace_id = ? AND r.agent_id = ? AND t.specialization = ?
    ORDER BY v.created_at DESC LIMIT 50`).all(workspaceId, agentId, capability) as Array<{ result: string; created_at: string }>;
  const samples = rows.length;
  const successes = rows.filter((row) => row.result === 'passed').length;
  const recent = rows.slice(0, 5);
  const recentFailures = recent.filter((row) => row.result !== 'passed').length;
  return {
    samples, successes, failures: samples - successes,
    successRate: samples ? successes / samples : 0.5,
    recentFailureRate: recent.length ? recentFailures / recent.length : 0,
    lastFailureAt: rows.find((row) => row.result !== 'passed')?.created_at ?? null,
    confidence: samples ? Math.min(0.95, 0.35 + Math.min(samples, 10) * 0.06) : 0.2,
  };
}
function performanceFor(workspaceId: string, agentId: string, capability: string): PerformanceEvidence {
  const row = getOsDb().prepare('SELECT attempts, verified_successes, verified_failures, last_failure_at FROM os_agent_performance WHERE workspace_id = ? AND agent_id = ? AND task_category = ?')
    .get(workspaceId, agentId, capability) as { attempts?: number; verified_successes?: number; verified_failures?: number; last_failure_at?: string | null } | undefined;
  const historical = evidenceFromVerifications(workspaceId, agentId, capability);
  if (!row || Number(row.attempts ?? 0) === 0) return historical;
  const samples = Number(row.attempts ?? 0);
  const successes = Number(row.verified_successes ?? 0);
  return {
    samples, successes, failures: Number(row.verified_failures ?? 0),
    successRate: samples ? successes / samples : 0.5,
    recentFailureRate: historical.recentFailureRate,
    lastFailureAt: row.last_failure_at ?? historical.lastFailureAt,
    confidence: Math.min(0.95, 0.35 + Math.min(samples, 10) * 0.06),
  };
}
function capabilityProfile(workspaceId: string, agent: AgentRecord): CapabilityProfile | null {
  try { return resolveCapabilities(workspaceId, agent.id); } catch { return null; }
}
function scoreCandidate(workspaceId: string, requirement: CapabilityRequirement, agent: AgentRecord): CandidateEvaluation {
  const spec = specOf(requirement.specialization);
  const profile = capabilityProfile(workspaceId, agent);
  const skills = new Set([...agent.skills, ...(profile?.skills.map((skill) => skill.key) ?? [])]);
  const tools = new Set(profile?.tools ?? agent.tools);
  const permissions = new Set(profile?.permissions ?? agent.permissions);
  const exact = agent.specialization === requirement.specialization;
  const knownCapability = Boolean(spec);
  const skillCoverage = requirement.requiredSkills.length ? requirement.requiredSkills.filter((skill) => skills.has(skill)).length / requirement.requiredSkills.length : 1;
  const toolCoverage = requirement.requiredTools.length ? requirement.requiredTools.filter((tool) => tools.has(tool)).length / requirement.requiredTools.length : 1;
  const permissionCoverage = requirement.requiredPermissions.length ? requirement.requiredPermissions.filter((permission) => permissions.has(permission) || permissions.has('*')).length / requirement.requiredPermissions.length : 1;
  const capabilityMatch = exact ? 1 : knownCapability ? 0.6 * skillCoverage + 0.25 * toolCoverage + 0.15 * permissionCoverage : 0;
  const missingTools = requirement.requiredTools.filter((tool) => !tools.has(tool));
  const missingPermissions = requirement.requiredPermissions.filter((permission) => !permissions.has(permission) && !permissions.has('*'));
  const workload = workloadFor(workspaceId, agent.id);
  const evidence = performanceFor(workspaceId, agent.id, requirement.capability);
  const availability = agent.status === 'active' ? 1 : 0;
  const performance = Math.max(0, Math.min(1, 0.5 + (evidence.successRate - 0.5) * evidence.confidence - evidence.recentFailureRate * 0.15));
  const workloadScore = 1 / (1 + workload);
  const costUnits = MODEL_COST[spec?.modelTier ?? 'general'] ?? 1;
  const latencyUnits = 1 + workload * 0.25 + (spec?.modelTier === 'planning' ? 0.3 : 0);
  const cost = Math.min(1, 1 / costUnits);
  const latency = Math.min(1, 1 / latencyUnits);
  const score = 0.45 * capabilityMatch + 0.25 * performance + 0.10 * availability + 0.08 * workloadScore + 0.06 * cost + 0.06 * latency;
  const rejectionReasons: string[] = [];
  if (agent.status !== 'active') rejectionReasons.push(`agent is ${agent.status}`);
  if (capabilityMatch < requirement.minSuitability) rejectionReasons.push(`capability match ${capabilityMatch.toFixed(2)} below ${requirement.minSuitability}`);
  if (missingTools.length) rejectionReasons.push(`missing tool(s): ${missingTools.join(', ')}`);
  if (missingPermissions.length) rejectionReasons.push(`missing permission(s): ${missingPermissions.join(', ')}`);
  const eligible = rejectionReasons.length === 0;
  const matchedSkills = requirement.requiredSkills.filter((skill) => skills.has(skill));
  const matchedTools = requirement.requiredTools.filter((tool) => tools.has(tool));
  return {
    agentId: agent.id, agentName: agent.name, specialization: agent.specialization, eligible, rejectionReasons,
    score: Math.round(score * 1_000) / 1_000,
    confidence: Math.round((0.35 + capabilityMatch * 0.35 + evidence.confidence * 0.30) * 100) / 100,
    capabilityMatch: Math.round(capabilityMatch * 1_000) / 1_000, missingTools, missingPermissions,
    metrics: {
      verifiedSamples: evidence.samples, successRate: Math.round(evidence.successRate * 1_000) / 1_000,
      recentFailureRate: Math.round(evidence.recentFailureRate * 1_000) / 1_000,
      workload, costUnits, latencyUnits: Math.round(latencyUnits * 100) / 100,
    },
    factors: {
      capability: Math.round(capabilityMatch * 1_000) / 1_000, performance: Math.round(performance * 1_000) / 1_000,
      availability, workload: Math.round(workloadScore * 1_000) / 1_000,
      cost: Math.round(cost * 1_000) / 1_000, latency: Math.round(latency * 1_000) / 1_000,
    },
    explanation: eligible
      ? `${agent.name}: ${exact ? 'exact specialization' : `${(capabilityMatch * 100).toFixed(0)}% capability match`}, ${matchedSkills.length}/${requirement.requiredSkills.length} skills, ${matchedTools.length}/${requirement.requiredTools.length} tools, ${evidence.samples} verified sample(s), workload ${workload}.`
      : `${agent.name} rejected: ${rejectionReasons.join('; ')}.`,
  };
}

export function selectForRequirement(workspaceId: string, requirement: CapabilityRequirement, options: { preferAgentId?: string | null; excludeAgentId?: string | null; agents?: AgentRecord[] } = {}): SelectionDecision {
  const agents = options.agents ?? listAgents(workspaceId, { status: 'active' });
  const candidates = agents.filter((agent) => agent.id !== options.excludeAgentId)
    .map((agent) => scoreCandidate(workspaceId, requirement, agent))
    .sort((a, b) => (b.eligible ? 1 : 0) - (a.eligible ? 1 : 0) || b.score - a.score || a.agentId.localeCompare(b.agentId));
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const selected = (options.preferAgentId ? eligible.find((candidate) => candidate.agentId === options.preferAgentId) : undefined) ?? eligible[0] ?? null;
  const alternatives = candidates.slice(0, 8).map((candidate) => ({ agentId: candidate.agentId, agentName: candidate.agentName, score: candidate.score, eligible: candidate.eligible, reason: candidate.explanation }));
  const risks: string[] = [];
  if (selected && selected.metrics.verifiedSamples < 3) risks.push('cold start: fewer than three verified samples for this capability');
  if (selected && selected.metrics.recentFailureRate > 0) risks.push(`recent verified failure rate ${(selected.metrics.recentFailureRate * 100).toFixed(0)}%`);
  if (selected && selected.metrics.workload > 0) risks.push(`current workload ${selected.metrics.workload} task(s)`);
  if (requirement.risk === 'high') risks.push('high-risk action: payload-bound human approval is still mandatory');
  return {
    requirement,
    selectedAgentId: selected?.agentId ?? null, selectedAgentName: selected?.agentName ?? null,
    confidence: selected?.confidence ?? 0,
    explanation: {
      summary: selected
        ? `Selected ${selected.agentName} for ${requirement.label} (${requirement.taskTitle}) with score ${selected.score.toFixed(3)}; ${selected.explanation}`
        : `Capability gap: no eligible agent can satisfy ${requirement.label} (${requirement.taskTitle}) within the security boundary.`,
      matchedCapabilities: selected ? [requirement.capability] : [],
      matchedSkills: selected ? requirement.requiredSkills.filter((skill) => (agents.find((agent) => agent.id === selected.agentId)?.skills ?? []).includes(skill)) : [],
      matchedTools: selected ? requirement.requiredTools.filter((tool) => !selected.missingTools.includes(tool)) : [],
      alternativesConsidered: alternatives,
      expectedCostUnits: selected?.metrics.costUnits ?? null,
      expectedLatencyUnits: selected?.metrics.latencyUnits ?? null,
      unresolvedRisks: risks,
    },
    candidates,
    gap: selected ? null : `No eligible agent satisfies ${requirement.capability}; missing tools: ${requirement.requiredTools.join(', ') || 'none'}; missing permissions: ${requirement.requiredPermissions.join(', ') || 'none'}.`,
  };
}

function parallelGroups(plan: SelectionTask[]): number[][] {
  const remaining = new Set(plan.map((_, index) => index));
  const groups: number[][] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((index) => plan[index]!.dependsOn.every((dependency) => !remaining.has(dependency))).sort((a, b) => a - b);
    if (!ready.length) break;
    groups.push(ready);
    for (const index of ready) remaining.delete(index);
  }
  return groups;
}

export function buildTeamPlan(workspaceId: string, plan: SelectionTask[], problem?: ProblemProfile | null, missionId: string | null = null): TeamPlan {
  const agents = listAgents(workspaceId);
  const requirements = requirementsForPlan(plan, workspaceId);
  const decisions = requirements.map((requirement) => selectForRequirement(workspaceId, requirement, { agents }));
  const selectedIds = unique(decisions.map((decision) => decision.selectedAgentId).filter((id): id is string => Boolean(id)));
  const team = selectedIds.map((agentId) => {
    const agent = agents.find((entry) => entry.id === agentId)!;
    const selectedDecisions = decisions.filter((decision) => decision.selectedAgentId === agentId);
    return {
      agentId, name: agent.name, specialization: agent.specialization,
      capabilities: unique(selectedDecisions.map((decision) => decision.requirement.capability)),
      workload: workloadFor(workspaceId, agentId),
      confidence: Math.round((selectedDecisions.reduce((sum, decision) => sum + decision.confidence, 0) / Math.max(1, selectedDecisions.length)) * 100) / 100,
    };
  });
  const assignments: TeamAssignment[] = decisions.map((decision) => ({
    taskIndex: decision.requirement.taskIndex, taskTitle: decision.requirement.taskTitle,
    requirementId: decision.requirement.id, agentId: decision.selectedAgentId, agentName: decision.selectedAgentName,
    dependsOn: decision.requirement.dependsOn, status: decision.selectedAgentId ? 'assigned' : 'capability_gap',
  }));
  const gaps = decisions.filter((decision) => decision.gap).map((decision) => ({
    taskIndex: decision.requirement.taskIndex, taskTitle: decision.requirement.taskTitle,
    capability: decision.requirement.capability, reason: decision.gap!,
  }));
  const strategy: TeamStrategy = gaps.length ? 'capability_gap' : team.length <= 1 ? 'single_agent' : 'multi_agent';
  const explanation = strategy === 'capability_gap'
    ? `Capability gap on ${gaps.length} task(s); no agent was fabricated and no unverified capability was assigned.`
    : strategy === 'single_agent'
      ? `The smallest capable team is one agent: ${team[0]?.name ?? 'none'}. No extra agents were created.`
      : `The smallest capable team has ${team.length} specialists across ${requirements.length} task(s); ${parallelGroups(plan).length} dependency layer(s) can be scheduled.`;
  return {
    schemaVersion: SELECTION_SCHEMA_VERSION, missionId, strategy, requirements, decisions, team, assignments,
    parallelGroups: parallelGroups(plan), gaps,
    explanation: `${explanation}${problem?.missingInformation.length ? ` Missing information: ${problem.missingInformation.join('; ')}.` : ''}`,
    createdAt: nowIso(),
  };
}

export function previewTeam(workspaceId: string, plan: SelectionTask[], problem?: ProblemProfile | null): TeamPlan {
  return buildTeamPlan(workspaceId, plan.map((task) => ({ ...task, acceptance: [...task.acceptance], dependsOn: [...task.dependsOn] })), problem, null);
}

export function persistTeamPlan(input: { workspaceId: string; missionId: string; plan: SelectionTask[]; taskIds: string[]; problem?: ProblemProfile | null; actor: string }): TeamPlan {
  const db = getOsDb();
  const team = buildTeamPlan(input.workspaceId, input.plan, input.problem, input.missionId);
  const id = newId('team');
  const ts = nowIso();
  db.prepare(`INSERT INTO os_team_plans (id, workspace_id, mission_id, strategy, requirements, decisions, team, graph, gaps, explanation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mission_id) DO UPDATE SET strategy = excluded.strategy, requirements = excluded.requirements,
      decisions = excluded.decisions, team = excluded.team, graph = excluded.graph, gaps = excluded.gaps,
      explanation = excluded.explanation, created_at = excluded.created_at`)
    .run(id, input.workspaceId, input.missionId, team.strategy, JSON.stringify(team.requirements).slice(0, 100_000),
      JSON.stringify(team.decisions).slice(0, 200_000), JSON.stringify(team.team).slice(0, 50_000),
      JSON.stringify({ parallelGroups: team.parallelGroups, assignments: team.assignments }).slice(0, 100_000),
      JSON.stringify(team.gaps).slice(0, 50_000), team.explanation.slice(0, 4_000), ts);
  db.prepare('DELETE FROM os_selection_decisions WHERE mission_id = ?').run(input.missionId);
  for (const decision of team.decisions) {
    const taskId = input.taskIds[decision.requirement.taskIndex];
    if (!taskId) continue;
    db.prepare(`INSERT INTO os_selection_decisions (id, workspace_id, mission_id, task_id, requirement_id, selected_agent_id, candidates, explanation, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(newId('sel'), input.workspaceId, input.missionId, taskId, decision.requirement.id, decision.selectedAgentId,
        JSON.stringify(decision.candidates).slice(0, 120_000), JSON.stringify(decision.explanation).slice(0, 20_000), decision.confidence, ts);
    if (decision.selectedAgentId) {
      db.prepare('UPDATE os_tasks SET agent_id = ?, updated_at = ? WHERE id = ? AND mission_id = ?').run(decision.selectedAgentId, ts, taskId, input.missionId);
    } else {
      db.prepare("UPDATE os_tasks SET agent_id = NULL, detail = CASE WHEN detail LIKE 'capability_gap:%' THEN detail ELSE ? END, updated_at = ? WHERE id = ? AND mission_id = ?")
        .run(`capability_gap: ${decision.gap ?? 'no eligible agent'}`, ts, taskId, input.missionId);
    }
  }
  audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'team.plan', subject: input.missionId, detail: { strategy: team.strategy, agents: team.team.map((agent) => agent.agentId), gaps: team.gaps.length } });
  return team;
}

export function getTeamPlan(workspaceId: string, missionId: string): TeamPlan | null {
  const row = getOsDb().prepare('SELECT * FROM os_team_plans WHERE workspace_id = ? AND mission_id = ?').get(workspaceId, missionId) as Record<string, string> | undefined;
  if (!row) return null;
  const graph = parseJson<{ parallelGroups?: number[][]; assignments?: TeamAssignment[] }>(row['graph'], {});
  return {
    schemaVersion: SELECTION_SCHEMA_VERSION, missionId, strategy: String(row['strategy']) as TeamStrategy,
    requirements: parseJson<CapabilityRequirement[]>(row['requirements'], []),
    decisions: parseJson<SelectionDecision[]>(row['decisions'], []),
    team: parseJson<TeamPlan['team']>(row['team'], []), assignments: graph.assignments ?? [],
    parallelGroups: graph.parallelGroups ?? [], gaps: parseJson<TeamPlan['gaps']>(row['gaps'], []),
    explanation: String(row['explanation'] ?? ''), createdAt: String(row['created_at']),
  };
}

export function listSelectionDecisions(workspaceId: string, missionId: string): Array<Record<string, unknown>> {
  const rows = getOsDb().prepare('SELECT * FROM os_selection_decisions WHERE workspace_id = ? AND mission_id = ? ORDER BY created_at ASC').all(workspaceId, missionId) as Array<Record<string, string>>;
  return rows.map((row) => ({
    id: row['id'], taskId: row['task_id'], requirementId: row['requirement_id'], selectedAgentId: row['selected_agent_id'],
    candidates: parseJson(row['candidates'], []), explanation: parseJson(row['explanation'], {}),
    confidence: Number(row['confidence']), createdAt: row['created_at'],
  }));
}

export function recordTaskSelection(input: { workspaceId: string; missionId: string; taskId: string; decision: SelectionDecision; reason: string }): void {
  const ts = nowIso();
  getOsDb().prepare(`INSERT INTO os_selection_decisions (id, workspace_id, mission_id, task_id, requirement_id, selected_agent_id, candidates, explanation, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mission_id, task_id) DO UPDATE SET selected_agent_id = excluded.selected_agent_id, candidates = excluded.candidates,
      explanation = excluded.explanation, confidence = excluded.confidence, created_at = excluded.created_at`)
    .run(newId('sel'), input.workspaceId, input.missionId, input.taskId, input.decision.requirement.id, input.decision.selectedAgentId,
      JSON.stringify(input.decision.candidates).slice(0, 120_000),
      JSON.stringify({ ...input.decision.explanation, reason: input.reason }).slice(0, 20_000), input.decision.confidence, ts);
}

export function resolveTaskAgent(workspaceId: string, task: SelectionTask, missionId: string): { agent: AgentRecord | null; decision: SelectionDecision } {
  const requirement = requirementForTask(task, 0, workspaceId);
  const decision = selectForRequirement(workspaceId, requirement, { preferAgentId: task.agentId ?? null });
  // A persisted assignment is attempted first when the agent is active and has
  // the assigned tool. Authorization is still re-checked at execution; a denied
  // capability then triggers the audited reassignment path instead of silently
  // substituting a different specialist before the task ever runs.
  const preferred = task.agentId ? getAgent(workspaceId, task.agentId) : null;
  if (preferred?.status === 'active' && (!task.tool || preferred.tools.includes(task.tool))) {
    const candidate = decision.candidates.find((entry) => entry.agentId === preferred.id);
    if (candidate) {
      const forced: SelectionDecision = {
        ...decision,
        selectedAgentId: preferred.id,
        selectedAgentName: preferred.name,
        gap: null,
        explanation: {
          ...decision.explanation,
          summary: `Persisted assignment honored: ${preferred.name}; authorization is re-checked at execution.`,
          unresolvedRisks: [...decision.explanation.unresolvedRisks, ...(candidate.eligible ? [] : ['persisted agent is not fully eligible; execution may deny and reassign'])],
        },
      };
      if (task.id) recordTaskSelection({ workspaceId, missionId, taskId: task.id, decision: forced, reason: 'persisted team assignment attempted before reassignment' });
      return { agent: preferred, decision: forced };
    }
  }
  const agent = decision.selectedAgentId ? getAgent(workspaceId, decision.selectedAgentId) : null;
  if (task.id) recordTaskSelection({ workspaceId, missionId, taskId: task.id, decision, reason: task.agentId ? 'team assignment validated' : 'dynamic selection' });
  return { agent, decision };
}

export function selectReplacement(workspaceId: string, task: SelectionTask, missionId: string, excludeAgentId: string): { agent: AgentRecord | null; decision: SelectionDecision } {
  const requirement = requirementForTask(task, 0, workspaceId);
  const decision = selectForRequirement(workspaceId, requirement, { excludeAgentId });
  const agent = decision.selectedAgentId ? getAgent(workspaceId, decision.selectedAgentId) : null;
  if (task.id) recordTaskSelection({ workspaceId, missionId, taskId: task.id, decision, reason: `reassigned after ${excludeAgentId} failed` });
  return { agent, decision };
}

export function recordAgentPerformance(input: { workspaceId: string; agentId: string; taskCategory: string; result: 'passed' | 'failed' | 'blocked'; durationMs: number }): void {
  const success = input.result === 'passed' ? 1 : 0;
  const failure = input.result === 'passed' ? 0 : 1;
  getOsDb().prepare(`INSERT INTO os_agent_performance (workspace_id, agent_id, task_category, attempts, verified_successes, verified_failures, total_duration_ms, last_failure_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, agent_id, task_category) DO UPDATE SET attempts = attempts + 1,
      verified_successes = verified_successes + excluded.verified_successes,
      verified_failures = verified_failures + excluded.verified_failures,
      total_duration_ms = total_duration_ms + excluded.total_duration_ms,
      last_failure_at = CASE WHEN excluded.verified_failures > 0 THEN excluded.last_failure_at ELSE last_failure_at END,
      updated_at = excluded.updated_at`)
    .run(input.workspaceId, input.agentId, input.taskCategory, success, failure, Math.max(0, input.durationMs), input.result === 'passed' ? null : nowIso(), nowIso());
}

export function performanceReport(workspaceId: string, agentId?: string): Array<Record<string, unknown>> {
  const rows = (agentId
    ? getOsDb().prepare('SELECT * FROM os_agent_performance WHERE workspace_id = ? AND agent_id = ? ORDER BY task_category').all(workspaceId, agentId)
    : getOsDb().prepare('SELECT * FROM os_agent_performance WHERE workspace_id = ? ORDER BY agent_id, task_category').all(workspaceId)) as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    agentId: row['agent_id'], taskCategory: row['task_category'], attempts: Number(row['attempts']),
    verifiedSuccesses: Number(row['verified_successes']), verifiedFailures: Number(row['verified_failures']),
    successRate: Number(row['attempts']) ? Number(row['verified_successes']) / Number(row['attempts']) : 0,
    averageDurationMs: Number(row['attempts']) ? Number(row['total_duration_ms']) / Number(row['attempts']) : 0,
    lastFailureAt: row['last_failure_at'] ?? null, updatedAt: row['updated_at'],
  }));
}
