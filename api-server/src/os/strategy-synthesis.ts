/**
 * WORA OS — strategy synthesis over a real capability graph.
 *
 * Candidates are genuinely different executable subsets of the graph. Scores
 * are deterministic policy scores, not probabilities. Infeasible candidates
 * are rejected with a reason; the selected strategy names its alternatives.
 */
import type { UnifiedProblem } from './problem-model.js';
import type { CompositionGraph, CompositionNode } from './capability-composition.js';

export const STRATEGY_SCHEMA_VERSION = '1.0';

export interface CompositionMetrics {
  expectedQuality: number;
  feasibility: number;
  scientificValidity: number;
  cost: number;
  time: number;
  resources: number;
  risk: number;
  uncertainty: number;
  reversibility: number;
  capabilityAvailability: number;
  permissionReadiness: number;
  verificationComplexity: number;
}

export interface CompositionStrategyCandidate {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
  metrics: CompositionMetrics;
  score: number;
  feasible: boolean;
  rejectionReason: string | null;
  assumptions: string[];
}

export interface CompositionStrategyDecision {
  schemaVersion: typeof STRATEGY_SCHEMA_VERSION;
  selected: CompositionStrategyCandidate | null;
  candidates: CompositionStrategyCandidate[];
  rejected: CompositionStrategyCandidate[];
  explanation: string;
  assumptions: string[];
  gap: string | null;
}

const WEIGHTS = {
  expectedQuality: 0.38,
  feasibility: 0.16,
  scientificValidity: 0.12,
  cost: 0.07,
  time: 0.05,
  resources: 0.04,
  risk: 0.06,
  uncertainty: 0.04,
  reversibility: 0.03,
  capabilityAvailability: 0.03,
  permissionReadiness: 0.01,
  verificationComplexity: 0.01,
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const riskWeight: Record<CompositionNode['risk'], number> = { low: 1, medium: 2, high: 4 };

export function scoreComposition(metrics: CompositionMetrics): number {
  return Math.round(Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + (weight ?? 0) * metrics[key as keyof CompositionMetrics], 0) * 1000) / 1000;
}

function metricsFor(nodes: CompositionNode[], problem: UnifiedProblem): CompositionMetrics {
  const count = Math.max(1, nodes.length);
  const hasSkill = nodes.some((node) => node.skillKeys.length > 0);
  const hasPlugin = nodes.some((node) => node.capabilityKind === 'plugin' || node.capabilityKind === 'mcp');
  const maxRisk = nodes.reduce((max, node) => Math.max(max, riskWeight[node.risk]), 1);
  const risk = clamp(1 - maxRisk / 4);
  const selectedMethod = problem.methods.selected;
  return {
    expectedQuality: clamp(0.68 + count * 0.075 + (hasSkill ? 0.04 : 0) + (hasPlugin ? 0.04 : 0)),
    feasibility: nodes.every((node) => node.available) && nodes.every((node) => node.permissions.every((permission) => node.permissionsApproved.includes(permission))) ? 1 : 0,
    scientificValidity: selectedMethod ? (problem.methods.missing.length ? 0.55 : 0.92) : 0.5,
    cost: clamp(1 / (1 + count * 0.4)),
    time: clamp(1 / (1 + count * 0.35)),
    resources: clamp(1 / (1 + count * 0.25)),
    risk,
    uncertainty: problem.uncertainty === 'high' ? 0.35 : problem.uncertainty === 'medium' ? 0.6 : 0.85,
    reversibility: problem.reversibility === 'irreversible' ? 0.2 : problem.reversibility === 'costly' ? 0.55 : 1,
    capabilityAvailability: nodes.every((node) => node.available) ? 1 : 0,
    permissionReadiness: nodes.every((node) => node.permissions.every((permission) => node.permissionsApproved.includes(permission))) ? 1 : 0,
    verificationComplexity: clamp(1 / (1 + count * 0.18)),
  };
}

function candidate(id: string, name: string, description: string, nodes: CompositionNode[], problem: UnifiedProblem): CompositionStrategyCandidate {
  const metrics = metricsFor(nodes, problem);
  const feasible = metrics.feasibility === 1 && nodes.length > 0;
  const missing = nodes.filter((node) => !node.available).map((node) => node.title);
  const missingPermissions = nodes.flatMap((node) => node.permissions.filter((permission) => !node.permissionsApproved.includes(permission)));
  const rejectionReason = !nodes.length ? 'The strategy has no executable node.'
    : missing.length ? `Unavailable capability node(s): ${missing.join(', ')}.`
      : missingPermissions.length ? `Missing permission(s): ${[...new Set(missingPermissions)].join(', ')}.` : null;
  return {
    id, name, description, nodeIds: nodes.map((node) => node.id), metrics, score: scoreComposition(metrics), feasible,
    rejectionReason, assumptions: [
      'Scores are deterministic policy weights, not learned probabilities or guarantees.',
      ...(nodes.some((node) => node.skillKeys.length) ? ['A selected Skill contributes untrusted, bounded operational knowledge; it cannot grant permissions.'] : []),
      ...(nodes.some((node) => node.fallbackTools.length) ? ['A compatible fallback exists for at least one capability; it must still pass authorization and independent verification.'] : []),
    ],
  };
}

export function synthesizeCompositionStrategy(graph: CompositionGraph, problem: UnifiedProblem): CompositionStrategyDecision {
  const primary = graph.nodes.find((node) => node.role === 'primary') ?? graph.nodes[graph.nodes.length - 1];
  const integration = graph.nodes.find((node) => node.role === 'integration');
  const context = graph.nodes.find((node) => node.role === 'context');
  const core = graph.nodes.filter((node) => node.role !== 'integration');
  const candidates: CompositionStrategyCandidate[] = [];
  if (primary) candidates.push(candidate('minimal', 'Minimal executable capability', 'Use one direct capability with the smallest execution surface.', [primary], problem));
  if (context && primary && context.id !== primary.id) {
    candidates.push(candidate('analysis-then-primary', 'Analysis plus primary capability', 'Use the context task, then execute the primary capability with the resulting evidence.', [context, primary], problem));
  }
  if (core.length && core.length !== 1) {
    candidates.push(candidate('core-layered', 'Layered core composition', 'Use every non-integration node in dependency order.', core, problem));
  }
  if (integration && context) {
    candidates.push(candidate('full-composition', 'Full composition with integration', 'Use context, authorized integration and the primary capability in dependency order.', graph.nodes, problem));
  }
  if (!candidates.length && graph.nodes.length) {
    candidates.push(candidate('full-composition', 'Full composition', 'Use the available capability graph.', graph.nodes, problem));
  }
  const uniqueCandidates = [...new Map(candidates.map((entry) => [entry.nodeIds.join('>'), entry])).values()]
    .sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.score - a.score || a.id.localeCompare(b.id));
  const selected = uniqueCandidates.find((entry) => entry.feasible) ?? null;
  const rejected = uniqueCandidates.filter((entry) => !entry.feasible);
  const explanation = selected
    ? `Selected "${selected.name}" (score ${selected.score.toFixed(3)}, ${selected.nodeIds.length} node(s)). ${uniqueCandidates.filter((entry) => entry.id !== selected.id).map((entry) => `${entry.name}: ${entry.feasible ? `score ${entry.score.toFixed(3)}` : entry.rejectionReason}`).join(' | ') || 'No other candidate was executable.'}`
    : `No feasible composition exists. ${rejected.map((entry) => `${entry.name}: ${entry.rejectionReason}`).join(' | ') || graph.gaps.map((gap) => gap.message).join(' | ')}`;
  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    selected,
    candidates: uniqueCandidates,
    rejected,
    explanation,
    assumptions: [
      'The strategy is chosen by explicit deterministic weights over feasibility, quality, scientific validity, cost, time, risk, uncertainty and availability.',
      'The selected strategy is executable only through the existing Tool Registry, agent authorization and governance boundary.',
    ],
    gap: graph.gaps.length ? graph.gaps.map((gap) => gap.message).join('; ') : selected ? null : 'No approved, available capability composition exists.',
  };
}
