/**
 * WORA OS — deterministic solution-strategy comparison and replan assessment.
 *
 * The engine does not pretend to know an outcome. It scores the strategies it
 * can actually execute (direct/risk-first plans and the selected scientific
 * method plus its implemented alternatives) on explicit, inspectable features.
 * When uncertainty is too high the result carries assumptions and a gap rather
 * than a fabricated winner.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { comparePlans, type FormalPlan } from './planning.js';
import type { PlanTask } from './orchestrator.js';
import type { ProblemProfile } from './problem.js';
import type { AlgorithmChoice, AlgorithmCost } from './algorithms.js';
import { getTool } from './tools.js';
import { listAgents } from './registry.js';

export const DECISION_SCHEMA_VERSION = '1.0';

export interface StrategyMetrics {
  expectedQuality: number;
  feasibility: number;
  cost: number;
  time: number;
  resources: number;
  risk: number;
  uncertainty: number;
  reversibility: number;
  verificationDifficulty: number;
  specialistAvailability: number;
  toolAvailability: number;
}

export interface StrategyCandidate {
  id: string;
  kind: 'plan' | 'method';
  name: string;
  planStrategy: FormalPlan['strategy'] | null;
  algorithmId: string | null;
  toolId: string | null;
  metrics: StrategyMetrics;
  score: number;
  eligible: boolean;
  reason: string;
  assumptions: string[];
}

export type ExecutionShape = 'direct_tool' | 'single_specialist' | 'multi_agent_team' | 'mathematical_solver' | 'simulation' | 'combined';

export interface DecisionComparison {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  preferredPlan: StrategyCandidate;
  preferredMethod: StrategyCandidate | null;
  executionShape: ExecutionShape;
  smallestCapableTeam: number;
  plans: StrategyCandidate[];
  methods: StrategyCandidate[];
  reason: string;
  assumptions: string[];
  missingInformation: string[];
  confidence: number;
  replanConditions: string[];
}

export interface ReplanAssessmentInput {
  failureCategory?: string | null;
  methodFailed?: boolean;
  toolUnavailable?: boolean;
  specialistUnavailable?: boolean;
  costExceeded?: boolean;
  assumptionInvalidated?: boolean;
  newEvidence?: boolean;
  alternativesAvailable?: boolean;
  previousReplans?: number;
}

export interface ReplanAssessment {
  shouldReplan: boolean;
  action: 'retry' | 'reassign' | 'replan' | 'stop';
  reason: string;
  requiredEvidence: string[];
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const costWeight: Record<AlgorithmCost, number> = { low: 1, medium: 2, high: 4 };
const riskWeight: Record<string, number> = { low: 1, medium: 2, high: 4 };

const WEIGHTS = {
  expectedQuality: 0.22,
  feasibility: 0.18,
  cost: 0.12,
  time: 0.10,
  resources: 0.08,
  risk: 0.10,
  uncertainty: 0.06,
  reversibility: 0.04,
  verificationDifficulty: 0.05,
  specialistAvailability: 0.03,
  toolAvailability: 0.02,
};

export function scoreStrategy(metrics: StrategyMetrics): number {
  return Math.round((
    WEIGHTS.expectedQuality * metrics.expectedQuality
    + WEIGHTS.feasibility * metrics.feasibility
    + WEIGHTS.cost * metrics.cost
    + WEIGHTS.time * metrics.time
    + WEIGHTS.resources * metrics.resources
    + WEIGHTS.risk * metrics.risk
    + WEIGHTS.uncertainty * metrics.uncertainty
    + WEIGHTS.reversibility * metrics.reversibility
    + WEIGHTS.verificationDifficulty * metrics.verificationDifficulty
    + WEIGHTS.specialistAvailability * metrics.specialistAvailability
    + WEIGHTS.toolAvailability * metrics.toolAvailability
  ) * 1000) / 1000;
}

function hasSpecialist(workspaceId: string, toolId: string | null): boolean {
  if (!toolId) return true;
  return listAgents(workspaceId).some((agent) => agent.status === 'active' && agent.tools.includes(toolId));
}

function planCandidate(formal: FormalPlan, workspaceId: string): StrategyCandidate {
  const taskCount = Math.max(1, formal.metrics.taskCount);
  const toolMissing = formal.tasks.some((task) => task.resources.tool && !getTool(task.resources.tool, workspaceId));
  const specialistMissing = formal.tasks.some((task) => task.resources.agentSpecialization && !listAgents(workspaceId, { specialization: task.resources.agentSpecialization, status: 'active' }).length);
  const risk = clamp(1 - riskWeight[formal.metrics.maxRisk]! / 4);
  const metrics: StrategyMetrics = {
    expectedQuality: 0.8,
    feasibility: toolMissing ? 0.25 : specialistMissing ? 0.45 : 1,
    cost: clamp(1 / (1 + formal.metrics.totalCost / 8)),
    time: clamp(1 / (1 + taskCount / 8)),
    resources: clamp(1 / (1 + formal.metrics.totalCost / 16)),
    risk,
    uncertainty: clamp(1 - formal.metrics.uncertaintyCount / Math.max(1, taskCount)),
    reversibility: risk,
    verificationDifficulty: clamp(1 - Math.min(0.8, formal.metrics.uncertaintyCount / Math.max(1, taskCount) * 0.5)),
    specialistAvailability: specialistMissing ? 0.2 : 1,
    toolAvailability: toolMissing ? 0.1 : 1,
  };
  return {
    id: `plan:${formal.strategy}`,
    kind: 'plan',
    name: `${formal.strategy} plan`,
    planStrategy: formal.strategy,
    algorithmId: null,
    toolId: null,
    metrics,
    score: scoreStrategy(metrics),
    eligible: !toolMissing && !specialistMissing,
    reason: formal.strategy === 'direct'
      ? 'Preserves the original task order; no reordering benefit is assumed.'
      : 'Risk-first order may reduce exposure but does not change total estimated cost.',
    assumptions: [...formal.assumptions],
  };
}

function methodCandidate(choice: AlgorithmChoice, workspaceId: string, profile: ProblemProfile, primary: boolean): StrategyCandidate {
  const tool = choice.toolId ? getTool(choice.toolId, workspaceId) : null;
  const missing = profile.algorithmSelection.missingInformation.length > 0;
  const risk = clamp(1 - riskWeight[tool?.risk ?? 'low']! / 4);
  const metrics: StrategyMetrics = {
    expectedQuality: primary ? 0.9 : 0.7,
    feasibility: tool ? (missing ? 0.5 : 1) : 0.15,
    cost: clamp(1 / (1 + costWeight[choice.costClass])),
    time: clamp(1 / (1 + costWeight[choice.costClass] * 0.5)),
    resources: clamp(1 / (1 + costWeight[choice.costClass])),
    risk,
    uncertainty: primary ? 0.75 : 0.6,
    reversibility: risk,
    verificationDifficulty: clamp(1 / (1 + choice.verification.length / 3)),
    specialistAvailability: hasSpecialist(workspaceId, choice.toolId) ? 1 : 0.2,
    toolAvailability: tool ? 1 : 0.1,
  };
  return {
    id: `method:${choice.algorithmId}`,
    kind: 'method',
    name: choice.name,
    planStrategy: null,
    algorithmId: choice.algorithmId,
    toolId: choice.toolId,
    metrics,
    score: scoreStrategy(metrics),
    eligible: Boolean(tool) && !missing,
    reason: choice.reason,
    assumptions: [
      `Guarantee: ${choice.guarantee}`,
      ...choice.limitations.slice(0, 2),
    ],
  };
}

export function compareSolutionStrategies(
  plan: PlanTask[],
  workspaceId: string,
  profile: ProblemProfile,
): DecisionComparison {
  const planComparison = comparePlans(plan, workspaceId, profile);
  const plans = planComparison.plans.map((formal) => planCandidate(formal, workspaceId));
  const selection = profile.algorithmSelection;
  const methods: StrategyCandidate[] = [];
  if (selection.primary) methods.push(methodCandidate(selection.primary, workspaceId, profile, true));
  for (const alternative of selection.alternatives) methods.push(methodCandidate(alternative, workspaceId, profile, false));
  const eligiblePlans = plans.filter((candidate) => candidate.eligible);
  const eligibleMethods = methods.filter((candidate) => candidate.eligible);
  const preferredPlan = [...(eligiblePlans.length ? eligiblePlans : plans)].sort((a, b) => b.score - a.score)[0]!;
  const preferredMethod = [...eligibleMethods].sort((a, b) => b.score - a.score)[0] ?? null;
  const assumptions = [
    'Scores use explicit deterministic weights; they are not learned probabilities.',
    'A method is eligible only when its tool exists and required inputs are present.',
    ...profile.algorithmSelection.assumptions,
  ];
  const methodTool = selection.primary?.toolId ?? null;
  const executionShape: ExecutionShape = plan.length === 1
    ? methodTool === 'sim.monte_carlo' ? 'simulation'
      : methodTool?.startsWith('or.') ? 'mathematical_solver'
        : plan[0]?.tool ? 'direct_tool' : 'single_specialist'
    : methodTool ? 'combined' : 'multi_agent_team';
  const smallestCapableTeam = new Set(plan.map((task) => task.specialization)).size;
  const reason = preferredMethod
    ? `${preferredPlan.name} (${preferredPlan.score.toFixed(3)}) with ${preferredMethod.name} (${preferredMethod.score.toFixed(3)}) is the highest-scoring executable combination.`
    : `${preferredPlan.name} (${preferredPlan.score.toFixed(3)}) is the highest-scoring plan; no executable scientific method is available.`;
  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    preferredPlan,
    preferredMethod,
    executionShape,
    smallestCapableTeam,
    plans,
    methods,
    reason,
    assumptions,
    missingInformation: [...profile.missingInformation],
    confidence: clamp((preferredPlan.score + (preferredMethod?.score ?? 0.5)) / 2),
    replanConditions: [
      'a required tool or specialist becomes unavailable',
      'verified evidence invalidates an assumption',
      'a task fails after the bounded retry/reassignment budget',
      'the approved cost or time budget is exceeded',
      'new evidence materially changes feasibility or risk',
    ],
  };
}

export function assessReplan(input: ReplanAssessmentInput): ReplanAssessment {
  const previous = input.previousReplans ?? 0;
  if (previous >= 2 && !input.newEvidence) {
    return {
      shouldReplan: false, action: 'stop',
      reason: 'Two replans already occurred without new evidence; stop and escalate instead of churning plans.',
      requiredEvidence: ['new verified evidence or an explicit operator decision'],
    };
  }
  if (input.toolUnavailable || input.specialistUnavailable) {
    return {
      shouldReplan: true, action: input.alternativesAvailable ? 'replan' : 'stop',
      reason: input.toolUnavailable ? 'A required tool is unavailable.' : 'A required specialist is unavailable.',
      requiredEvidence: ['an alternative authorized tool/specialist or an explicit gap record'],
    };
  }
  if (input.costExceeded) {
    return {
      shouldReplan: true, action: 'replan',
      reason: 'The approved cost/resource budget was exceeded.',
      requiredEvidence: ['a cheaper feasible strategy or a new budget approval'],
    };
  }
  if (input.assumptionInvalidated) {
    return {
      shouldReplan: true, action: 'replan',
      reason: 'Verified evidence invalidated a plan assumption.',
      requiredEvidence: ['the evidence that invalidated the assumption and the revised plan'],
    };
  }
  if (input.methodFailed && input.alternativesAvailable) {
    return {
      shouldReplan: true, action: 'replan',
      reason: 'The selected scientific method failed and an implemented alternative is available.',
      requiredEvidence: ['failure evidence and the alternative method\'s inputs/preconditions'],
    };
  }
  if (input.failureCategory === 'authorization') {
    return {
      shouldReplan: false, action: 'reassign',
      reason: 'Authorization failed; reassign only to an agent that already holds the required permission.',
      requiredEvidence: ['capability denial evidence and an eligible alternate agent'],
    };
  }
  if (input.failureCategory === 'timeout' || input.failureCategory === 'solver_failure') {
    return {
      shouldReplan: true, action: input.alternativesAvailable ? 'replan' : 'stop',
      reason: 'The method or solver did not produce an accepted result.',
      requiredEvidence: ['timeout/solver status and a different feasible strategy'],
    };
  }
  return {
    shouldReplan: false, action: 'retry',
    reason: 'No changed assumption or new evidence justifies a new plan; retry within the bounded budget.',
    requiredEvidence: ['new evidence before changing strategy'],
  };
}

export function saveDecisionRecord(input: {
  workspaceId: string; missionId: string; kind: string; comparison: unknown; reason: string; actor: string;
}): void {
  const db = getOsDb();
  db.prepare(`INSERT INTO os_decision_records (id, workspace_id, mission_id, kind, payload, reason, actor, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(newId('dec'), input.workspaceId, input.missionId, input.kind, JSON.stringify(input.comparison).slice(0, 200_000), input.reason.slice(0, 2_000), input.actor, nowIso());
  audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: `decision.${input.kind}`, subject: input.missionId, detail: { reason: input.reason.slice(0, 300) } });
}

export function listDecisionRecords(workspaceId: string, missionId: string): Array<Record<string, unknown>> {
  const rows = getOsDb().prepare('SELECT * FROM os_decision_records WHERE workspace_id = ? AND mission_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(workspaceId, missionId) as Array<Record<string, string>>;
  return rows.map((row) => ({
    id: row['id'], kind: row['kind'], payload: parseJson(row['payload'] ?? '{}', {}),
    reason: row['reason'], actor: row['actor'], createdAt: row['created_at'],
  }));
}
