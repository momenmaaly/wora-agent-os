/**
 * WORA OS — forecasting paraphrase evaluation.
 *
 * These cases are deliberately separate from the broad Phase 7 suite. They
 * exercise intent framing, target/horizon extraction, observation sufficiency
 * and negative controls. Expected answers live here only; the reasoning engine
 * never imports this module.
 */
import { buildDeterministicReasoning } from './reasoning-engine.js';
import type { ProblemStructureKind } from './problem-structure.js';

export const FORECASTING_EVALUATION_VERSION = '1.0';

export type ForecastSuite = 'development' | 'held-out' | 'negative';

export interface ForecastCase {
  id: string;
  category: string;
  objective: string;
  expect: {
    kind: ProblemStructureKind;
    problemType: string;
    targetIncludes?: string;
    targetAbsent?: boolean;
    horizonSteps?: number | null;
    observations?: number;
    malformed?: boolean;
    canExecute: boolean;
    missingIncludes?: string[];
    selectedMethodIncludes?: string;
    selectedMethodExcludes?: string;
    sufficient: boolean;
    criticalNeed: boolean;
    askQuestion: boolean;
  };
}

const DEV: ForecastCase[] = [
  {
    id: 'dev-original-subscription', category: 'projection-without-explicit-forecast-word',
    objective: 'Project monthly subscription revenue for the next six months from historical totals.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'revenue', horizonSteps: 6, observations: 0, canExecute: false, missingIncludes: ['observations'], selectedMethodExcludes: 'linear', sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'dev-valid-sales-series', category: 'sales-from-history-with-explicit-values',
    objective: 'Forecast next month sales from the eight monthly observations [120, 128, 135, 142, 150, 159, 168, 178].',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'sales', horizonSteps: 1, observations: 8, canExecute: true, selectedMethodIncludes: 'linear', sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'dev-demand-quarter', category: 'demand-next-quarter',
    objective: 'Estimate next quarter demand using [200, 212, 225, 239, 252, 267, 281, 296].',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'demand', horizonSteps: 3, observations: 8, canExecute: true, selectedMethodIncludes: 'linear', sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'dev-workload-history', category: 'workload-from-history',
    objective: 'Estimate upcoming workload from historical observations.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'workload', horizonSteps: null, observations: 0, canExecute: false, missingIncludes: ['horizon', 'observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'dev-future-value', category: 'future-numeric-value',
    objective: 'Predict a future numerical value from a time series.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'numerical value', horizonSteps: null, observations: 0, canExecute: false, missingIncludes: ['horizon', 'observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'dev-change-over-time', category: 'change-over-time-without-forecast-word',
    objective: 'How may a measured variable change over time?',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'measured variable', horizonSteps: null, observations: 0, canExecute: false, missingIncludes: ['horizon', 'observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'dev-incomplete-history', category: 'incomplete-history',
    objective: 'Forecast revenue for the next three months, but the historical data is incomplete.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'revenue', horizonSteps: 3, observations: 0, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'dev-no-target', category: 'forecast-without-target',
    objective: 'Forecast the future.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetAbsent: true, horizonSteps: null, observations: 0, canExecute: false, missingIncludes: ['target', 'horizon', 'observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'dev-missing-horizon', category: 'projection-without-horizon',
    objective: 'Project revenue from the historical totals.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'revenue', horizonSteps: null, observations: 0, canExecute: false, missingIncludes: ['horizon', 'observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'dev-malformed-series', category: 'malformed-input',
    objective: 'Predict next month sales from series [120, 128, abc, 142, 150, 159, 168, 178].',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'sales', horizonSteps: 1, observations: 0, malformed: true, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'dev-insufficient-series', category: 'insufficient-observations',
    objective: 'Predict next month revenue from [10, 12, 14].',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'revenue', horizonSteps: 1, observations: 3, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'dev-negative-average', category: 'negative-descriptive-statistics',
    objective: 'Calculate the average sales last quarter.',
    expect: { kind: 'descriptive_statistics', problemType: 'data_analysis', canExecute: false, selectedMethodIncludes: 'descriptive', sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'dev-negative-trend', category: 'negative-past-trend',
    objective: 'Describe the trend in monthly sales.',
    expect: { kind: 'trend_analysis', problemType: 'data_analysis', canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'dev-negative-classification', category: 'negative-classification',
    objective: 'Classify customers into segments based on purchase history.',
    expect: { kind: 'classification', problemType: 'classification', canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'dev-negative-simulation', category: 'negative-simulation',
    objective: 'Simulate three demand scenarios using Monte Carlo.',
    expect: { kind: 'simulation', problemType: 'general', canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'dev-negative-optimization', category: 'negative-optimization',
    objective: 'Optimize inventory for next month.',
    expect: { kind: 'optimization', problemType: 'optimization', canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
];

const HELD_OUT: ForecastCase[] = [
  {
    id: 'held-two-quarter-revenue', category: 'unseen-revenue-projection',
    objective: 'Estimate the next two quarters of subscription revenue from the recorded monthly totals.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'revenue', horizonSteps: 6, observations: 0, canExecute: false, missingIncludes: ['observations'], selectedMethodExcludes: 'linear', sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-ticket-volume', category: 'unseen-ticket-volume',
    objective: 'What should we expect for support-ticket volume in the coming year based on the last 24 months?',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'tickets', horizonSteps: 12, observations: 0, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-trailing-orders', category: 'unseen-trailing-orders',
    objective: 'Use the trailing twelve months of orders to anticipate the following three weeks.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'orders', horizonSteps: 3, observations: 0, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-active-users', category: 'unseen-active-users',
    objective: 'How might active-user counts move over the next 90 days?',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'users', horizonSteps: 90, observations: 0, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-headcount', category: 'unseen-headcount',
    objective: 'Project headcount needs for the coming year.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'headcount', horizonSteps: 12, observations: 0, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-warehouse-workload', category: 'unseen-warehouse-workload',
    objective: "Estimate next month's warehouse workload from the recorded observations.",
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'workload', horizonSteps: 1, observations: 0, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-retention-rate', category: 'unseen-retention-rate',
    objective: 'Predict the future value of the retention rate from the past six months.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'retention', horizonSteps: null, observations: 0, canExecute: false, missingIncludes: ['horizon', 'observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-cash-flow-series', category: 'unseen-valid-cash-flow',
    objective: 'Forecast the next three quarters of cash flow using [90, 94, 99, 105, 112, 118, 125, 133, 141, 149].',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'cash', horizonSteps: 9, observations: 10, canExecute: true, selectedMethodIncludes: 'linear', sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'held-churn-evolve', category: 'unseen-churn-evolve',
    objective: 'Estimate how churn may evolve over the next six months using the historical monthly churn series.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'churn', horizonSteps: 6, observations: 0, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-production-weeks', category: 'unseen-production-weeks',
    objective: 'Project production output for the next four weeks from the last twelve weeks.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'production', horizonSteps: 4, observations: 0, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-no-history', category: 'unseen-no-history',
    objective: 'Forecast the next quarter, but no historical data is available.',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetAbsent: true, horizonSteps: 3, observations: 0, canExecute: false, missingIncludes: ['target', 'observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
  {
    id: 'held-too-few', category: 'unseen-too-few',
    objective: 'Predict next month revenue using [1, 2, 3].',
    expect: { kind: 'forecasting', problemType: 'forecasting', targetIncludes: 'revenue', horizonSteps: 1, observations: 3, canExecute: false, missingIncludes: ['observations'], sufficient: false, criticalNeed: true, askQuestion: true },
  },
];

const NEGATIVE: ForecastCase[] = [
  {
    id: 'negative-summary', category: 'negative-summary',
    objective: "Summarize last quarter's average revenue by segment.",
    expect: { kind: 'descriptive_statistics', problemType: 'data_analysis', targetAbsent: true, canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'negative-causal', category: 'negative-causal',
    objective: 'Model how nurse staffing affects readmissions.',
    expect: { kind: 'causal_analysis', problemType: 'causal_analysis', targetAbsent: true, canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'negative-routes', category: 'negative-routing',
    objective: 'Optimize delivery routes for next month.',
    expect: { kind: 'optimization', problemType: 'optimization', targetAbsent: true, canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'negative-leads', category: 'negative-classification',
    objective: "Classify next quarter's leads by fit.",
    expect: { kind: 'classification', problemType: 'classification', targetAbsent: true, canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'negative-scenarios', category: 'negative-simulation',
    objective: "Simulate next year's demand scenarios.",
    expect: { kind: 'simulation', problemType: 'general', targetAbsent: true, canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
  {
    id: 'negative-build-dashboard', category: 'negative-software',
    objective: 'Build a sales forecasting dashboard.',
    expect: { kind: 'software_engineering', problemType: 'software_engineering', targetAbsent: true, canExecute: false, sufficient: true, criticalNeed: false, askQuestion: false },
  },
];

export interface ForecastCaseResult {
  id: string;
  suite: ForecastSuite;
  category: string;
  passed: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}

export interface ForecastEvaluation {
  schemaVersion: typeof FORECASTING_EVALUATION_VERSION;
  generatedAt: string;
  mode: 'deterministic';
  development: { total: number; passed: number; rate: number };
  heldOut: { total: number; passed: number; rate: number };
  negative: { total: number; passed: number; rate: number };
  categories: Record<string, { passed: number; total: number }>;
  failures: Array<{ id: string; suite: ForecastSuite; checks: Array<{ id: string; passed: boolean; detail: string }> }>;
  results: ForecastCaseResult[];
}

function evaluateCase(item: ForecastCase, suite: ForecastSuite): ForecastCaseResult {
  const model = buildDeterministicReasoning({ workspaceId: 'wora-forecast-eval', objective: item.objective });
  const structure = model.problemStructure;
  const forecast = structure?.forecasting;
  const checks: ForecastCaseResult['checks'] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  add('kind', structure?.kind === item.expect.kind, `expected ${item.expect.kind}, got ${structure?.kind ?? 'none'}`);
  add('problem-type', model.problemType === item.expect.problemType, `expected ${item.expect.problemType}, got ${model.problemType}`);
  if (item.expect.targetAbsent) add('target-absent', !forecast?.targetVariable, `target=${forecast?.targetVariable ?? 'none'}`);
  if (item.expect.targetIncludes) add('target', (forecast?.targetVariable ?? '').toLowerCase().includes(item.expect.targetIncludes.toLowerCase()), `target=${forecast?.targetVariable ?? 'none'}`);
  if (item.expect.horizonSteps !== undefined) add('horizon', (forecast?.horizon?.steps ?? null) === item.expect.horizonSteps, `horizon=${forecast?.horizon?.steps ?? 'none'}`);
  if (item.expect.observations !== undefined) add('observations', forecast?.observations.length === item.expect.observations, `observations=${forecast?.observations.length ?? 0}`);
  if (item.expect.malformed !== undefined) add('malformed', Boolean(forecast?.seriesMalformed) === item.expect.malformed, `malformed=${Boolean(forecast?.seriesMalformed)}`);
  add('can-execute', Boolean(forecast?.canExecute) === item.expect.canExecute, `canExecute=${Boolean(forecast?.canExecute)}`);
  for (const missing of item.expect.missingIncludes ?? []) add(`missing-${missing}`, (forecast?.missingInputs ?? []).some((value) => value.toLowerCase().includes(missing.toLowerCase())), `missing=${(forecast?.missingInputs ?? []).join(' | ') || 'none'}`);
  if (item.expect.selectedMethodIncludes) add('selected-method', model.methods.some((method) => method.selected && `${method.id} ${method.name}`.toLowerCase().includes(item.expect.selectedMethodIncludes!.toLowerCase())), `selected=${model.methods.filter((method) => method.selected).map((method) => method.name).join(' | ') || 'none'}`);
  if (item.expect.selectedMethodExcludes) add('selected-method-excluded', model.methods.every((method) => !method.selected || !`${method.id} ${method.name}`.toLowerCase().includes(item.expect.selectedMethodExcludes!.toLowerCase())), `selected=${model.methods.filter((method) => method.selected).map((method) => method.name).join(' | ') || 'none'}`);
  add('sufficiency', model.sufficientToProceed === item.expect.sufficient, `sufficient=${model.sufficientToProceed}`);
  add('critical-need', model.informationNeeds.some((need) => need.materiality === 'critical') === item.expect.criticalNeed, `critical=${model.informationNeeds.filter((need) => need.materiality === 'critical').length}`);
  add('clarification', Boolean(model.clarificationQuestion) === item.expect.askQuestion, `question=${model.clarificationQuestion ?? 'none'}`);
  if (item.expect.kind === 'forecasting') {
    add('provenance', model.claims.every((claim) => Boolean(claim.provenance.source && claim.provenance.digest && claim.provenance.trust)), `claims=${model.claims.length}`);
    add('uncertainty-not-calibrated', model.confidence.kind !== 'calibrated', `confidenceKind=${model.confidence.kind}`);
    if (!item.expect.canExecute) add('no-fabricated-series', (forecast?.observations.length ?? 0) === (item.expect.observations ?? 0), `observations=${forecast?.observations.length ?? 0}`);
  }
  return { id: item.id, suite, category: item.category, passed: checks.every((check) => check.passed), checks };
}

function summarize(results: ForecastCaseResult[]): { total: number; passed: number; rate: number } {
  const passed = results.filter((result) => result.passed).length;
  return { total: results.length, passed, rate: results.length ? Number((passed / results.length).toFixed(3)) : 1 };
}

export function evaluateForecastingParaphrases(): ForecastEvaluation {
  const development = DEV.map((item) => evaluateCase(item, 'development'));
  const heldOut = HELD_OUT.map((item) => evaluateCase(item, 'held-out'));
  const negative = NEGATIVE.map((item) => evaluateCase(item, 'negative'));
  const all = [...development, ...heldOut, ...negative];
  const categories: ForecastEvaluation['categories'] = {};
  for (const result of all) {
    categories[result.category] ??= { passed: 0, total: 0 };
    const category = categories[result.category]!;
    category.total += 1;
    if (result.passed) category.passed += 1;
  }
  return {
    schemaVersion: FORECASTING_EVALUATION_VERSION, generatedAt: new Date().toISOString(), mode: 'deterministic',
    development: summarize(development), heldOut: summarize(heldOut), negative: summarize(negative), categories,
    failures: all.filter((result) => !result.passed).map((result) => ({ id: result.id, suite: result.suite, checks: result.checks.filter((check) => !check.passed) })),
    results: all,
  };
}
