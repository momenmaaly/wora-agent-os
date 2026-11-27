/**
 * WORA OS — scenario comparison.
 *
 * Runs the same seeded PERT model under multiple explicit scenarios, reports
 * baseline deltas and ranks scenarios by median outcome. Reproducibility is
 * checked by re-running every scenario with the same seed; all results remain
 * labelled simulated.
 */
import type { ScientificVerification } from './scientific-verification.js';
import { simulatePert, type PertItem, type PertResult } from './simulation.js';

export const SCENARIO_SCHEMA_VERSION = '1.0';
const TOLERANCE = 1e-9;

export interface ScenarioAdjustment { item: string; op: 'mul' | 'add'; value: number }
export interface ScenarioInput { name: string; items: PertItem[]; adjustments?: ScenarioAdjustment[] }
export interface ScenarioModel { scenarios: ScenarioInput[]; trials?: number; seed?: number }
export interface ScenarioOutcome {
  name: string;
  result: PertResult;
  deltaP50: number;
  deltaP90: number;
  deltaMeanPct: number;
}
export interface ScenarioResult {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  status: 'feasible' | 'infeasible' | 'unverified';
  simulated: true;
  exact: false;
  trials: number;
  seed: number;
  baseline: string;
  scenarios: ScenarioOutcome[];
  ranking: Array<{ name: string; p50: number }>;
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

function validate(model: ScenarioModel): string[] {
  const errors: string[] = [];
  if (!Array.isArray(model.scenarios) || model.scenarios.length < 2) errors.push('at least two scenarios are required');
  const names = new Set<string>();
  for (const scenario of model.scenarios ?? []) {
    if (!scenario.name?.trim()) errors.push('every scenario needs a name');
    if (names.has(scenario.name)) errors.push(`duplicate scenario name: ${scenario.name}`);
    names.add(scenario.name);
    if (!Array.isArray(scenario.items) || scenario.items.length === 0) errors.push(`scenario ${scenario.name} needs at least one item`);
    for (const item of scenario.items ?? []) {
      if (!item.name?.trim() || !Number.isFinite(item.optimistic) || !Number.isFinite(item.likely) || !Number.isFinite(item.pessimistic)) errors.push(`scenario ${scenario.name} has an invalid item`);
    }
    for (const adjustment of scenario.adjustments ?? []) {
      if (!Number.isFinite(adjustment.value) || (adjustment.op !== 'mul' && adjustment.op !== 'add')) errors.push(`scenario ${scenario.name} has an invalid adjustment`);
    }
  }
  const trials = model.trials ?? 10_000;
  if (!Number.isInteger(trials) || trials < 100 || trials > 100_000) errors.push('trials must be an integer between 100 and 100000');
  if (!Number.isInteger(model.seed ?? 42)) errors.push('seed must be an integer');
  return [...new Set(errors)];
}

function applyAdjustments(items: PertItem[], adjustments: ScenarioAdjustment[]): PertItem[] {
  return items.map((item) => {
    const adjustment = adjustments.find((entry) => entry.item === item.name);
    if (!adjustment) return item;
    const apply = (value: number) => (adjustment.op === 'mul' ? value * adjustment.value : value + adjustment.value);
    return { ...item, optimistic: apply(item.optimistic), likely: apply(item.likely), pessimistic: apply(item.pessimistic) };
  });
}

export function verifyScenarios(model: ScenarioModel, result: ScenarioResult): ScientificVerification {
  const verification = emptyVerification();
  if (result.status === 'infeasible') {
    add(verification, 'model-status', 'The scenario model is infeasible', true, 'invalid model reported explicitly');
    return verification;
  }
  add(verification, 'scenario-count', 'Every scenario is present in the result', result.scenarios.length === model.scenarios.length, `scenarios=${result.scenarios.length}`);
  add(verification, 'simulated-label', 'Every scenario result is labelled simulated', result.scenarios.every((scenario) => scenario.result.simulated === true), `${result.scenarios.length} scenario(s)`);
  add(verification, 'quantile-order', 'Every scenario has ordered p10 ≤ p50 ≤ p90', result.scenarios.every((scenario) => scenario.result.p10 <= scenario.result.p50 && scenario.result.p50 <= scenario.result.p90), `${result.scenarios.length} scenario(s)`);
  const baseline = result.scenarios.find((scenario) => scenario.name === result.baseline);
  const deltasOk = baseline !== undefined && result.scenarios.every((scenario) => {
    const expectedP50 = round(scenario.result.p50 - baseline.result.p50);
    const expectedP90 = round(scenario.result.p90 - baseline.result.p90);
    const expectedMean = baseline.result.mean === 0 ? 0 : round(((scenario.result.mean - baseline.result.mean) / baseline.result.mean) * 100);
    return Math.abs(expectedP50 - scenario.deltaP50) <= 1e-6 && Math.abs(expectedP90 - scenario.deltaP90) <= 1e-6 && Math.abs(expectedMean - scenario.deltaMeanPct) <= 1e-6;
  });
  add(verification, 'deltas', 'Baseline deltas are recomputed from the scenario distributions', deltasOk, `baseline=${result.baseline}`);
  const trials = model.trials ?? 10_000;
  const seed = model.seed ?? 42;
  const reproducible = model.scenarios.every((scenario, index) => {
    const rerun = simulatePert(applyAdjustments(scenario.items, scenario.adjustments ?? []), trials, seed);
    const recorded = result.scenarios[index]!.result;
    return rerun.p10 === recorded.p10 && rerun.p50 === recorded.p50 && rerun.p90 === recorded.p90 && rerun.mean === recorded.mean;
  });
  add(verification, 'reproducibility', 'Re-running every scenario with the same seed reproduces its quantiles and mean', reproducible, `seed=${seed}; trials=${trials}`);
  add(verification, 'ranking', 'Scenarios are ranked by median outcome', result.ranking.every((entry, index) => index === 0 || entry.p50 >= result.ranking[index - 1]!.p50), `top=${result.ranking[0]?.name ?? 'none'}`);
  return verification;
}

export function solveScenarios(model: ScenarioModel): ScenarioResult {
  const errors = validate(model);
  if (errors.length) {
    return {
      schemaVersion: SCENARIO_SCHEMA_VERSION, status: 'infeasible', simulated: true, exact: false, trials: model.trials ?? 10_000, seed: model.seed ?? 42, baseline: model.scenarios?.[0]?.name ?? '', scenarios: [], ranking: [],
      verification: { schemaVersion: '1.0', passed: false, checks: [{ id: 'model-validation', description: 'The scenario model is valid', status: 'failed', evidence: errors.join('; ') }], failures: errors, tolerance: TOLERANCE },
      limitations: ['Invalid model was not simulated.'],
    };
  }
  const trials = model.trials ?? 10_000;
  const seed = model.seed ?? 42;
  const outcomes = model.scenarios.map((scenario) => ({
    name: scenario.name,
    result: simulatePert(applyAdjustments(scenario.items, scenario.adjustments ?? []), trials, seed),
  }));
  const baseline = outcomes[0]!;
  const scenarios: ScenarioOutcome[] = outcomes.map((outcome) => ({
    name: outcome.name,
    result: outcome.result,
    deltaP50: round(outcome.result.p50 - baseline.result.p50),
    deltaP90: round(outcome.result.p90 - baseline.result.p90),
    deltaMeanPct: baseline.result.mean === 0 ? 0 : round(((outcome.result.mean - baseline.result.mean) / baseline.result.mean) * 100),
  }));
  const ranking = scenarios.map((scenario) => ({ name: scenario.name, p50: scenario.result.p50 })).sort((a, b) => a.p50 - b.p50);
  const result: ScenarioResult = {
    schemaVersion: SCENARIO_SCHEMA_VERSION, status: 'feasible', simulated: true, exact: false, trials, seed, baseline: baseline.name, scenarios, ranking,
    verification: emptyVerification(),
    limitations: ['Scenarios use independent triangular PERT inputs; correlations are not modeled.', 'Ranking by median is not a guarantee about any single run.', 'Simulation results are not observed outcomes.'],
  };
  result.verification = verifyScenarios(model, result);
  if (!result.verification.passed) result.status = 'unverified';
  return result;
}
