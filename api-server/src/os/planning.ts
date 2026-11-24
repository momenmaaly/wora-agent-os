/**
 * WORA OS — formal, versioned planning representation.
 *
 * The existing deterministic planner remains the execution source of truth.
 * This module formalizes its tasks into goals, preconditions, effects,
 * resources, uncertainty and costs; produces deterministic alternatives;
 * compares them; and records plan versions. Replanning proposes a new plan
 * from remaining work without silently mutating a running task graph.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { getTool } from './tools.js';
import { openTaskToolInput } from '../security/task-fields.js';
import type { ProblemProfile } from './problem.js';
import type { PlanTask } from './orchestrator.js';

export const PLANNING_SCHEMA_VERSION = '1.0';

export type PlanningRisk = 'low' | 'medium' | 'high';

export interface FormalTask {
  index: number;
  title: string;
  goal: string;
  subgoals: string[];
  preconditions: string[];
  effects: string[];
  constraints: string[];
  resources: { tool: string | null; permissions: string[]; agentSpecialization: string };
  uncertainty: { risk: PlanningRisk; note: string };
  estimatedCost: number;
  dependsOn: number[];
}

export interface FormalPlan {
  schemaVersion: typeof PLANNING_SCHEMA_VERSION;
  strategy: 'direct' | 'risk-first';
  tasks: FormalTask[];
  order: number[];
  criticalPath: number[];
  metrics: { totalCost: number; maxRisk: PlanningRisk; uncertaintyCount: number; taskCount: number; depth: number };
  assumptions: string[];
  limitations: string[];
}

export interface PlanComparison {
  preferred: FormalPlan;
  plans: FormalPlan[];
  reason: string;
}

export interface PlanVersion {
  id: string;
  workspaceId: string;
  missionId: string;
  version: number;
  strategy: string;
  plan: FormalPlan;
  comparison: unknown;
  reason: string;
  actor: string;
  createdAt: string;
}

const riskWeight: Record<PlanningRisk, number> = { low: 1, medium: 2, high: 4 };
const maxRisk = (values: PlanningRisk[]): PlanningRisk => values.includes('high') ? 'high' : values.includes('medium') ? 'medium' : 'low';

function formalizeTasks(plan: PlanTask[], workspaceId: string, profile: ProblemProfile): FormalTask[] {
  return plan.map((task, index) => {
    const tool = task.tool ? getTool(task.tool, workspaceId) : null;
    const risk: PlanningRisk = tool?.risk ?? 'low';
    return {
      index,
      title: task.title,
      goal: task.objective,
      subgoals: task.acceptance.slice(0, 8),
      preconditions: [
        ...(task.dependsOn.length ? [`dependencies completed: ${task.dependsOn.join(', ')}`] : []),
        `agent specialization available: ${task.specialization}`,
        ...(task.tool ? [`tool available: ${task.tool}`] : []),
        ...(profile.constraints.length ? profile.constraints.slice(0, 3) : []),
      ],
      effects: [`task ${index} completed`, 'evidence and handoff contract recorded', ...(task.tool ? [`tool ${task.tool} executed`] : [])],
      constraints: task.acceptance.slice(0, 8),
      resources: { tool: task.tool, permissions: tool?.permission ? [tool.permission] : [], agentSpecialization: task.specialization },
      uncertainty: {
        risk,
        note: risk === 'high' ? 'high-risk tool; approval and independent verification required' : risk === 'medium' ? 'controlled action; review evidence' : 'deterministic low-risk action',
      },
      estimatedCost: riskWeight[risk],
      dependsOn: [...task.dependsOn],
    };
  });
}

function topologicalOrder(tasks: FormalTask[], prioritizeRisk: boolean): number[] {
  const remaining = new Set(tasks.map((task) => task.index));
  const order: number[] = [];
  while (remaining.size) {
    const ready = tasks.filter((task) => remaining.has(task.index) && task.dependsOn.every((dep) => !remaining.has(dep)));
    if (!ready.length) throw new Error('Plan contains a dependency cycle');
    ready.sort((a, b) => (prioritizeRisk ? riskWeight[b.uncertainty.risk] - riskWeight[a.uncertainty.risk] : a.index - b.index));
    const next = ready[0]!;
    order.push(next.index);
    remaining.delete(next.index);
  }
  return order;
}

function criticalPath(tasks: FormalTask[], order: number[]): { path: number[]; depth: number } {
  const byIndex = new Map(tasks.map((task) => [task.index, task]));
  const best = new Map<number, { cost: number; path: number[] }>();
  for (const index of order) {
    const task = byIndex.get(index)!;
    const predecessor = task.dependsOn.map((dep) => best.get(dep)).filter(Boolean) as Array<{ cost: number; path: number[] }>;
    const base = predecessor.sort((a, b) => b.cost - a.cost)[0] ?? { cost: 0, path: [] };
    best.set(index, { cost: base.cost + task.estimatedCost, path: [...base.path, index] });
  }
  const winner = [...best.values()].sort((a, b) => b.cost - a.cost)[0] ?? { cost: 0, path: [] };
  return { path: winner.path, depth: winner.path.length };
}

function makePlan(strategy: FormalPlan['strategy'], tasks: FormalTask[], profile: ProblemProfile): FormalPlan {
  const order = topologicalOrder(tasks, strategy === 'risk-first');
  const path = criticalPath(tasks, order);
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    strategy,
    tasks,
    order,
    criticalPath: path.path,
    metrics: {
      totalCost: tasks.reduce((sum, task) => sum + task.estimatedCost, 0),
      maxRisk: maxRisk(tasks.map((task) => task.uncertainty.risk)),
      uncertaintyCount: tasks.filter((task) => task.uncertainty.risk !== 'low').length,
      taskCount: tasks.length,
      depth: path.depth,
    },
    assumptions: [
      'Task specifications come from the deterministic planner; they are not a semantic proof.',
      ...(profile.missingInformation.length ? [`Missing information: ${profile.missingInformation.join('; ')}`] : []),
    ],
    limitations: [
      'Cost is a deterministic risk-weighted planning estimate, not money or wall-clock time.',
      'Alternatives reorder the same real tasks; no unimplemented capability is proposed.',
      ...(profile.algorithmSelection.status !== 'selected' ? ['Algorithm selection is not fully resolved; execution may need human input.'] : []),
    ],
  };
}

export function comparePlans(plan: PlanTask[], workspaceId: string, profile: ProblemProfile): PlanComparison {
  if (!plan.length) throw new Error('A plan must contain at least one task');
  const tasks = formalizeTasks(plan, workspaceId, profile);
  const direct = makePlan('direct', tasks, profile);
  const riskFirst = makePlan('risk-first', tasks, profile);
  const score = (candidate: FormalPlan) => candidate.metrics.totalCost + riskWeight[candidate.metrics.maxRisk] * 0.25;
  const preferred = score(riskFirst) < score(direct) ? riskFirst : direct;
  return {
    preferred,
    plans: [direct, riskFirst],
    reason: preferred.strategy === 'direct'
      ? 'The direct order is at least as cheap and exposes the same risk; no reordering benefit was demonstrated.'
      : 'Risk-first ordering has a lower deterministic risk-weighted estimate for this graph.',
  };
}

function view(row: Record<string, string | number>): PlanVersion {
  return {
    id: String(row['id']), workspaceId: String(row['workspace_id']), missionId: String(row['mission_id']),
    version: Number(row['version']), strategy: String(row['strategy']),
    plan: parseJson<FormalPlan>(String(row['plan']), {} as FormalPlan),
    comparison: parseJson<unknown>(String(row['comparison'] ?? '{}'), {}),
    reason: String(row['reason'] ?? ''), actor: String(row['actor']), createdAt: String(row['created_at']),
  };
}

export function savePlanVersion(input: {
  workspaceId: string; missionId: string; plan: FormalPlan; comparison?: unknown; reason: string; actor: string;
}): PlanVersion {
  const db = getOsDb();
  const next = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM os_plan_versions WHERE workspace_id = ? AND mission_id = ?').get(input.workspaceId, input.missionId) as { v: number }).v + 1;
  const id = newId('pln');
  const ts = nowIso();
  db.prepare(`INSERT INTO os_plan_versions (id, workspace_id, mission_id, version, strategy, plan, comparison, reason, actor, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.workspaceId, input.missionId, next, input.plan.strategy, JSON.stringify(input.plan).slice(0, 100_000), JSON.stringify(input.comparison ?? {}).slice(0, 20_000), input.reason.slice(0, 1_000), input.actor, ts);
  audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'plan.version', subject: input.missionId, detail: { version: next, strategy: input.plan.strategy, reason: input.reason.slice(0, 300) } });
  return view(db.prepare('SELECT * FROM os_plan_versions WHERE id = ?').get(id) as Record<string, string | number>);
}

export function listPlanVersions(workspaceId: string, missionId: string): PlanVersion[] {
  const rows = getOsDb().prepare('SELECT * FROM os_plan_versions WHERE workspace_id = ? AND mission_id = ? ORDER BY version DESC LIMIT 50').all(workspaceId, missionId) as unknown as Array<Record<string, string | number>>;
  return rows.map(view);
}

/** Propose a new plan from the remaining work; this does not mutate the task graph. */
export function replanMission(workspaceId: string, missionId: string, reason: string, actor: string): PlanVersion {
  const db = getOsDb();
  const mission = db.prepare('SELECT objective FROM os_missions WHERE workspace_id = ? AND id = ?').get(workspaceId, missionId) as { objective?: string } | undefined;
  if (!mission) throw new Error('Mission not found');
  const rows = db.prepare('SELECT * FROM os_tasks WHERE workspace_id = ? AND mission_id = ? ORDER BY order_index').all(workspaceId, missionId) as Array<Record<string, string | number>>;
  const remaining = rows.filter((row) => !['completed', 'cancelled'].includes(String(row['status'])));
  const profile = parseJson<ProblemProfile | null>((db.prepare('SELECT profile FROM os_problem_profiles WHERE workspace_id = ? AND mission_id = ?').get(workspaceId, missionId) as { profile?: string } | undefined)?.profile, null);
  if (!profile) throw new Error('Problem profile not found; cannot replan safely');
  const indexMap = new Map(remaining.map((row, index) => [String(row['id']), index]));
  const plan: PlanTask[] = remaining.map((row) => ({
    title: String(row['title']), objective: String(row['objective']), specialization: String(row['specialization']),
    tool: (row['tool'] as string | null) ?? null, toolInput: openTaskToolInput<Record<string, unknown>>(workspaceId, String(row['id']), String(row['tool_input'] ?? '{}'), {}),
    dependsOn: parseJson<string[]>(String(row['depends_on'] ?? '[]'), []).map((id) => indexMap.get(id)).filter((index): index is number => index !== undefined),
    acceptance: parseJson<string[]>(String(row['acceptance'] ?? '[]'), []), detail: String(row['detail'] ?? ''),
    fallbackTools: parseJson<string[]>(String(row['fallback_tools'] ?? '[]'), []),
  }));
  if (!plan.length) throw new Error('No remaining work to replan');
  const comparison = comparePlans(plan, workspaceId, profile);
  return savePlanVersion({ workspaceId, missionId, plan: comparison.preferred, comparison, reason: `replan: ${reason}`, actor });
}

export interface PlanExecutionCheck {
  id: string;
  status: 'passed' | 'failed';
  evidence: string;
}

/** Independent structural verification of an executed task graph. */
export function verifyPlanExecution(tasks: Array<{ id: string; status: string; dependsOn: string[] }>): { passed: boolean; checks: PlanExecutionCheck[] } {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const missingDeps: string[] = [];
  const prematureCompletions: string[] = [];
  const dangling: string[] = [];
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      const dependency = byId.get(dep);
      if (!dependency) { missingDeps.push(`${task.id}->${dep}`); continue; }
      if (task.status === 'completed' && dependency.status !== 'completed') prematureCompletions.push(`${task.id} completed before ${dep}`);
      if (dependency.status === 'failed' || dependency.status === 'blocked') {
        if (!['blocked', 'failed', 'cancelled'].includes(task.status)) dangling.push(`${task.id} is ${task.status} although ${dep} is ${dependency.status}`);
      }
    }
  }
  const checks: PlanExecutionCheck[] = [
    { id: 'plan-dependencies-exist', status: missingDeps.length ? 'failed' : 'passed', evidence: missingDeps.join(', ') || 'All declared dependencies exist.' },
    { id: 'plan-completion-order', status: prematureCompletions.length ? 'failed' : 'passed', evidence: prematureCompletions.join('; ') || 'No task completed before its dependencies.' },
    { id: 'plan-failure-propagation', status: dangling.length ? 'failed' : 'passed', evidence: dangling.join('; ') || 'No task runs on a failed or blocked dependency.' },
  ];
  return { passed: checks.every((check) => check.status === 'passed'), checks };
}
