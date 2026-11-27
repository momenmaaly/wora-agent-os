/**
 * WORA OS — multi-objective decision analysis.
 *
 * Computes the Pareto frontier of an explicit candidate set, explains the
 * trade-offs between frontier points, ranks candidates under declared weights,
 * and stress-tests the winner with weight perturbations. The result is exact
 * for the supplied candidate set only; it is not a claim that no better
 * candidate exists outside that set.
 */
import type { ScientificVerification } from './scientific-verification.js';

export const MULTI_OBJECTIVE_SCHEMA_VERSION = '1.0';
const TOLERANCE = 1e-9;

export interface Objective { id: string; label: string; direction: 'minimize' | 'maximize' }
export interface Candidate { name: string; values: Record<string, number> }
export interface ParetoModel {
  objectives: Objective[];
  candidates: Candidate[];
  weights?: Record<string, number>;
}
export interface ParetoPoint {
  name: string;
  values: Record<string, number>;
  weightedScore: number | null;
}
export interface ParetoResult {
  schemaVersion: typeof MULTI_OBJECTIVE_SCHEMA_VERSION;
  status: 'optimal' | 'infeasible' | 'unverified';
  scope: 'supplied-candidate-set';
  frontier: ParetoPoint[];
  dominated: Array<{ name: string; dominatedBy: string[] }>;
  ranking: Array<{ name: string; score: number }>;
  tradeoffs: Array<{ from: string; to: string; differences: Record<string, number> }>;
  sensitivity: { robust: boolean; winner: string | null; notes: string[] };
  verification: ScientificVerification;
  limitations: string[];
}

function emptyVerification(): ScientificVerification {
  return { schemaVersion: '1.0', passed: true, checks: [], failures: [], tolerance: TOLERANCE };
}

function add(result: ScientificVerification, id: string, description: string, passed: boolean, evidence: string): void {
  result.checks.push({ id, description, status: passed ? 'passed' : 'failed', evidence });
  if (!passed) result.failures.push(`${id}: ${evidence}`);
  result.passed = result.failures.length === 0;
}

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function validates(model: ParetoModel): string[] {
  const errors: string[] = [];
  if (!Array.isArray(model.objectives) || model.objectives.length < 2) errors.push('at least two objectives are required');
  if (!Array.isArray(model.candidates) || model.candidates.length < 2) errors.push('at least two candidates are required');
  const objectiveIds = new Set(model.objectives.map((objective) => objective.id));
  if (objectiveIds.size !== model.objectives.length) errors.push('objective ids must be unique');
  for (const objective of model.objectives) {
    if (!objective.id?.trim()) errors.push('every objective needs an id');
    if (objective.direction !== 'minimize' && objective.direction !== 'maximize') errors.push(`objective ${objective.id} has an invalid direction`);
    if (model.weights?.[objective.id] !== undefined && (!Number.isFinite(model.weights[objective.id]) || model.weights[objective.id]! < 0)) errors.push(`weight for ${objective.id} must be finite and non-negative`);
  }
  const names = new Set<string>();
  for (const candidate of model.candidates) {
    if (!candidate.name?.trim()) errors.push('every candidate needs a name');
    if (names.has(candidate.name)) errors.push(`duplicate candidate name: ${candidate.name}`);
    names.add(candidate.name);
    for (const objective of model.objectives) {
      if (!Number.isFinite(candidate.values[objective.id])) errors.push(`candidate ${candidate.name} is missing a finite ${objective.id} value`);
    }
  }
  return [...new Set(errors)];
}

function dominates(a: Candidate, b: Candidate, objectives: Objective[]): boolean {
  let strict = false;
  for (const objective of objectives) {
    const av = a.values[objective.id]!;
    const bv = b.values[objective.id]!;
    if (objective.direction === 'minimize') {
      if (av > bv + TOLERANCE) return false;
      if (av < bv - TOLERANCE) strict = true;
    } else {
      if (av < bv - TOLERANCE) return false;
      if (av > bv + TOLERANCE) strict = true;
    }
  }
  return strict;
}

function score(candidate: Candidate, objectives: Objective[], weights: Record<string, number>): number {
  return objectives.reduce((sum, objective) => {
    const value = candidate.values[objective.id]!;
    return sum + (weights[objective.id] ?? 1) * (objective.direction === 'minimize' ? -value : value);
  }, 0);
}

function normalizedWeights(model: ParetoModel): Record<string, number> {
  const raw = model.weights ?? {};
  const positive = model.objectives.map((objective) => Math.max(0, raw[objective.id] ?? 1));
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return Object.fromEntries(model.objectives.map((objective) => [objective.id, 1 / model.objectives.length]));
  return Object.fromEntries(model.objectives.map((objective, index) => [objective.id, positive[index]! / total]));
}

function sensitivity(model: ParetoModel, weights: Record<string, number>): { robust: boolean; winner: string | null; notes: string[] } {
  const baseline = [...model.candidates].sort((a, b) => score(b, model.objectives, weights) - score(a, model.objectives, weights))[0]!;
  const notes: string[] = [];
  let robust = true;
  for (const objective of model.objectives) {
    for (const factor of [0.8, 1.2]) {
      const perturbed = { ...weights, [objective.id]: weights[objective.id]! * factor };
      const total = Object.values(perturbed).reduce((sum, value) => sum + value, 0);
      const normalized = Object.fromEntries(Object.entries(perturbed).map(([id, value]) => [id, value / total]));
      const winner = [...model.candidates].sort((a, b) => score(b, model.objectives, normalized) - score(a, model.objectives, normalized))[0]!;
      if (winner.name !== baseline.name) {
        robust = false;
        notes.push(`Changing ${objective.label} weight by ${factor > 1 ? '+20%' : '−20%'} changes the winner to ${winner.name}.`);
      }
    }
  }
  if (!notes.length) notes.push('The winner is stable under ±20% one-at-a-time weight perturbations.');
  return { robust, winner: baseline.name, notes };
}

export function verifyPareto(model: ParetoModel, result: ParetoResult): ScientificVerification {
  const verification = emptyVerification();
  if (result.status === 'infeasible') {
    add(verification, 'model-status', 'The multi-objective model is infeasible', true, 'invalid model reported explicitly');
    return verification;
  }
  const frontierNames = new Set(result.frontier.map((point) => point.name));
  const allDominated = model.candidates.every((candidate) => {
    if (frontierNames.has(candidate.name)) return true;
    return model.candidates.some((other) => other.name !== candidate.name && dominates(other, candidate, model.objectives));
  });
  add(verification, 'frontier-completeness', 'Every non-frontier candidate is dominated by another candidate', allDominated, `frontier=${frontierNames.size}; candidates=${model.candidates.length}`);
  const frontierNonDominated = result.frontier.every((point) => {
    const candidate = model.candidates.find((entry) => entry.name === point.name)!;
    return model.candidates.every((other) => other.name === point.name || !dominates(other, candidate, model.objectives));
  });
  add(verification, 'frontier-dominance', 'No frontier point is dominated by another candidate', frontierNonDominated, `${result.frontier.length} frontier point(s)`);
  const recomputedRanking = [...model.candidates].map((candidate) => ({ name: candidate.name, score: score(candidate, model.objectives, normalizedWeights(model)) }))
    .sort((a, b) => b.score - a.score);
  const rankingMatches = recomputedRanking.every((entry, index) => Math.abs(entry.score - (result.ranking[index]?.score ?? Number.NaN)) <= 1e-6);
  add(verification, 'weighted-ranking', 'The weighted ranking is reproducible from the declared weights', rankingMatches, `top=${result.ranking[0]?.name ?? 'none'}`);
  const frontierConsistent = result.frontier.every((point) => {
    const candidate = model.candidates.find((entry) => entry.name === point.name)!;
    return Object.entries(point.values).every(([id, value]) => Math.abs(value - candidate.values[id]!) <= 1e-9);
  });
  add(verification, 'frontier-values', 'Frontier values match the supplied candidate values', frontierConsistent, `${result.frontier.length} point(s)`);
  return verification;
}

export function solvePareto(model: ParetoModel): ParetoResult {
  const errors = validates(model);
  if (errors.length) {
    return {
      schemaVersion: MULTI_OBJECTIVE_SCHEMA_VERSION, status: 'infeasible', scope: 'supplied-candidate-set', frontier: [], dominated: [], ranking: [], tradeoffs: [],
      sensitivity: { robust: false, winner: null, notes: [] },
      verification: { schemaVersion: '1.0', passed: false, checks: [{ id: 'model-validation', description: 'The multi-objective model is valid', status: 'failed', evidence: errors.join('; ') }], failures: errors, tolerance: TOLERANCE },
      limitations: ['Invalid model was not analysed.'],
    };
  }
  const frontierCandidates = model.candidates.filter((candidate) =>
    !model.candidates.some((other) => other.name !== candidate.name && dominates(other, candidate, model.objectives)));
  const dominated = model.candidates.filter((candidate) => !frontierCandidates.includes(candidate))
    .map((candidate) => ({
      name: candidate.name,
      dominatedBy: model.candidates.filter((other) => other.name !== candidate.name && dominates(other, candidate, model.objectives)).map((other) => other.name),
    }));
  const weights = normalizedWeights(model);
  const ranking = [...model.candidates].map((candidate) => ({ name: candidate.name, score: round(score(candidate, model.objectives, weights)) }))
    .sort((a, b) => b.score - a.score);
  const frontier = [...frontierCandidates]
    .map((candidate) => ({ name: candidate.name, values: { ...candidate.values }, weightedScore: round(score(candidate, model.objectives, weights)) }))
    .sort((a, b) => a.values[model.objectives[0]!.id]! - b.values[model.objectives[0]!.id]!);
  const tradeoffs = frontier.slice(0, -1).map((point, index) => {
    const next = frontier[index + 1]!;
    const differences = Object.fromEntries(model.objectives.map((objective) => [objective.id, round(next.values[objective.id]! - point.values[objective.id]!)]));
    return { from: point.name, to: next.name, differences };
  });
  const result: ParetoResult = {
    schemaVersion: MULTI_OBJECTIVE_SCHEMA_VERSION, status: 'optimal', scope: 'supplied-candidate-set', frontier, dominated, ranking, tradeoffs,
    sensitivity: sensitivity(model, weights), verification: emptyVerification(),
    limitations: ['The frontier is exact only for the supplied candidate set.', 'Dominance uses strict improvement; identical candidates can both remain on the frontier.', 'Weights are judgments, not measured facts.'],
  };
  result.verification = verifyPareto(model, result);
  if (!result.verification.passed) result.status = 'unverified';
  return result;
}
