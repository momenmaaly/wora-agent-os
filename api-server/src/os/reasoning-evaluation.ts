/**
 * WORA OS — reproducible reasoning evaluation.
 *
 * Development and held-out scenarios are kept separate. Expectations are
 * declared here, never in the production reasoning engine. The suite reports
 * per-dimension results and compares the deterministic baseline with the new
 * deterministic reasoning layer. No model-provider benchmark is claimed unless
 * a provider is explicitly supplied and executed.
 */
import { buildDeterministicReasoning } from './reasoning-engine.js';
import { understandProblem } from './problem.js';
import type { ReasoningEvidenceInput, ReasoningModel } from './reasoning-types.js';

export const REASONING_EVALUATION_VERSION = '1.0';

export interface ReasoningScenario {
  id: string;
  objective: string;
  evidence?: ReasoningEvidenceInput[];
  expect: {
    problemType?: string;
    outcomeIncludes?: string;
    hasAssumption?: string;
    hasUnknown?: string;
    contradiction?: boolean;
    minHypotheses?: number;
    hasRejectedHypothesis?: boolean;
    causal?: Array<{ relation?: string; evidenceKind?: string; identified?: boolean }>;
    noIdentifiedCausal?: boolean;
    criticalNeed?: boolean;
    askQuestion?: boolean;
    sufficient?: boolean;
    selectedMethodIncludes?: string;
    selectedMethodStatus?: 'implemented' | 'not_implemented' | 'partial';
    gapIncludes?: string;
    noHypotheses?: boolean;
    minMethods?: number;
    provenanceComplete?: boolean;
    forecastIntent?: boolean;
    targetVariableIncludes?: string;
    forecastHorizonSteps?: number;
    forecastObservations?: number;
    forecastCanExecute?: boolean;
    missingInputIncludes?: string;
    methodAssessedIncludes?: string;
    selectedMethodCount?: number;
    selectedMethodExcludes?: string;
  };
}

const DEV_SCENARIOS: ReasoningScenario[] = [
  {
    id: 'dev-outcome-business',
    objective: 'Reduce checkout failures by 20% so that customers can complete purchases reliably. Assume the payment provider is stable.',
    expect: { problemType: 'root_cause_analysis', outcomeIncludes: 'customers can complete purchases', hasAssumption: 'payment provider', sufficient: true, gapIncludes: 'causal-inference' },
  },
  {
    id: 'dev-software-engineering',
    objective: 'Build a multi-tenant SaaS API with role-based access and audit logs. Must support 1000 requests per second.',
    expect: { problemType: 'software_engineering', selectedMethodStatus: 'implemented', sufficient: true, noHypotheses: true, provenanceComplete: true },
  },
  {
    id: 'dev-optimization',
    objective: 'Schedule 12 nurses across 5 shifts with hourly costs and availability; minimize labor cost.',
    expect: { problemType: 'optimization', selectedMethodIncludes: 'employee scheduling', selectedMethodStatus: 'implemented', sufficient: true, minMethods: 2 },
  },
  {
    id: 'dev-forecasting',
    objective: 'Forecast next quarter demand from a time series and report uncertainty.',
    expect: { problemType: 'forecasting', forecastIntent: true, targetVariableIncludes: 'demand', forecastHorizonSteps: 3, forecastCanExecute: false, missingInputIncludes: 'observations', methodAssessedIncludes: 'linear trend', selectedMethodExcludes: 'linear', criticalNeed: true, askQuestion: true, sufficient: false, noHypotheses: true },
  },
  {
    id: 'dev-forecast-ready',
    objective: 'Predict next month sales from [120, 128, 135, 142, 150, 159, 168, 178].',
    expect: { problemType: 'forecasting', forecastIntent: true, targetVariableIncludes: 'sales', forecastHorizonSteps: 1, forecastObservations: 8, forecastCanExecute: true, selectedMethodIncludes: 'linear trend', selectedMethodStatus: 'implemented', sufficient: true, noHypotheses: true },
  },
  {
    id: 'dev-decision',
    objective: 'Choose a vendor using weighted criteria and alternatives.',
    expect: { problemType: 'decision', selectedMethodIncludes: 'weighted decision', selectedMethodStatus: 'implemented', sufficient: true },
  },
  {
    id: 'dev-formal-gap',
    objective: 'Prove the payment protocol satisfies mutual exclusion with a model checker and SMT solver.',
    expect: { problemType: 'formal_verification', gapIncludes: 'model-checking', sufficient: true },
  },
  {
    id: 'dev-causal-observational',
    objective: 'Ice cream sales are associated with drowning incidents. Is ice cream causing drowning?',
    expect: { problemType: 'causal_analysis', causal: [{ relation: 'correlates', evidenceKind: 'observational', identified: false }], noIdentifiedCausal: true, gapIncludes: 'causal-inference' },
  },
  {
    id: 'dev-causal-experimental',
    objective: 'Does the training program cause higher retention?',
    evidence: [{ id: 'trial-1', statement: 'A randomized controlled trial found the training program causes higher retention.', kind: 'observed-fact', source: 'verification:experiment', trust: 'verified', experimental: true, confidence: 0.95 }],
    expect: { problemType: 'causal_analysis', causal: [{ relation: 'causes', evidenceKind: 'experimental', identified: true }], gapIncludes: 'causal-inference' },
  },
  {
    id: 'dev-contradiction',
    objective: 'The server is healthy. The server is not healthy.',
    expect: { contradiction: true, sufficient: false, askQuestion: true, criticalNeed: true },
  },
  {
    id: 'dev-root-cause-rejected',
    objective: 'Checkout fails sometimes after deployment. The error rate increased because of a configuration change, but logs show memory exhaustion is not the cause.',
    expect: { problemType: 'root_cause_analysis', minHypotheses: 2, hasRejectedHypothesis: true, sufficient: true },
  },
  {
    id: 'dev-clarification',
    objective: 'Make the system faster but the target SLA is unknown.',
    expect: { criticalNeed: true, askQuestion: true, sufficient: false },
  },
  {
    id: 'dev-no-clarification',
    objective: 'Calculate the mean of the series 4, 8, 15.',
    expect: { problemType: 'data_analysis', selectedMethodIncludes: 'descriptive statistics', sufficient: true, noHypotheses: true },
  },
  {
    id: 'dev-missing-nonlinear',
    objective: 'Solve a nonlinear non-convex optimization problem for portfolio allocation.',
    expect: { problemType: 'optimization', gapIncludes: 'nonlinear-optimization' },
  },
  {
    id: 'dev-bayesian-gap',
    objective: 'Use Bayesian inference to update the posterior probability of failure.',
    expect: { gapIncludes: 'bayesian-inference' },
  },
  {
    id: 'dev-missing-data',
    objective: 'Estimate the cost of migrating our database but we do not know the data volume or downtime tolerance.',
    expect: { criticalNeed: true, askQuestion: true, sufficient: false },
  },
  {
    id: 'dev-assumption',
    objective: 'Assume the vendor SLA is 99.9%. Build a monitoring plan for the service.',
    expect: { problemType: 'software_engineering', hasAssumption: 'vendor SLA', sufficient: true },
  },
  {
    id: 'dev-multi-domain',
    objective: 'Design a warehouse layout and forecast demand while minimizing cost.',
    expect: { problemType: 'optimization', selectedMethodStatus: 'implemented', minMethods: 2, sufficient: true },
  },
  {
    id: 'dev-research',
    objective: 'Read the supplied sources and summarize conflicting evidence.',
    expect: { problemType: 'research', selectedMethodStatus: 'implemented', sufficient: true, provenanceComplete: true },
  },
  {
    id: 'dev-root-cause-no-evidence',
    objective: 'Why is the monthly report late? We do not know.',
    expect: { problemType: 'root_cause_analysis', minHypotheses: 2, provenanceComplete: true },
  },
  {
    id: 'dev-causal-trap',
    objective: 'Customers who use feature X have higher retention; therefore feature X causes retention.',
    expect: { problemType: 'causal_analysis', causal: [{ relation: 'causes', evidenceKind: 'assumed', identified: false }], noIdentifiedCausal: true, gapIncludes: 'causal-inference' },
  },
];

const HELD_OUT_SCENARIOS: ReasoningScenario[] = [
  {
    id: 'held-checkout-gateway',
    objective: 'Customers abandon checkout after payment failures. The team changed the gateway configuration last week, but database memory usage is normal.',
    expect: { problemType: 'root_cause_analysis', minHypotheses: 2, gapIncludes: 'causal-inference' },
  },
  {
    id: 'held-route-assignment',
    objective: 'A logistics team needs a minimum-cost assignment of routes to trucks using a matrix of costs.',
    expect: { problemType: 'optimization', selectedMethodStatus: 'implemented', sufficient: true },
  },
  {
    id: 'held-subscription-revenue',
    objective: 'Estimate the next two quarters of subscription revenue from the recorded monthly totals.',
    expect: { problemType: 'forecasting', forecastIntent: true, targetVariableIncludes: 'revenue', forecastHorizonSteps: 6, forecastCanExecute: false, missingInputIncludes: 'observations', methodAssessedIncludes: 'linear trend', selectedMethodExcludes: 'linear', criticalNeed: true, askQuestion: true, sufficient: false },
  },
  {
    id: 'held-cloud-provider',
    objective: 'Pick a cloud provider from weighted criteria and scored alternatives.',
    expect: { problemType: 'decision', selectedMethodIncludes: 'weighted decision', sufficient: true },
  },
  {
    id: 'held-lock-smt',
    objective: 'Verify the mutual-exclusion property of a locking protocol with an SMT solver.',
    expect: { problemType: 'formal_verification', gapIncludes: 'sat-smt' },
  },
  {
    id: 'held-staffing-readmissions',
    objective: 'Hospital readmissions rise when nurse staffing falls. Does staffing cause readmissions?',
    expect: { problemType: 'causal_analysis', noIdentifiedCausal: true, gapIncludes: 'causal-inference' },
  },
  {
    id: 'held-dashboard-discrepancy',
    objective: 'The sales dashboard shows a drop but warehouse records show stable shipments. What explains the discrepancy?',
    expect: { problemType: 'root_cause_analysis', minHypotheses: 2, provenanceComplete: true },
  },
  {
    id: 'held-identity-provider',
    objective: 'Create an admin console; the required identity provider is not decided.',
    expect: { problemType: 'software_engineering', criticalNeed: true, askQuestion: true, sufficient: false },
  },
  {
    id: 'held-infrastructure-cost',
    objective: 'We must cut infrastructure cost by 20%, but the current utilization report is unavailable.',
    expect: { criticalNeed: true, askQuestion: true, sufficient: false },
  },
  {
    id: 'held-ticket-classifier',
    objective: 'Train a classifier for support-ticket routing; no labeled examples exist.',
    expect: { gapIncludes: 'classification' },
  },
];

export interface ReasoningCheck { id: string; passed: boolean; detail: string; }
export interface ReasoningScenarioResult {
  id: string;
  suite: 'development' | 'held-out';
  passed: boolean;
  checks: ReasoningCheck[];
  summary: { problemType: string; mode: string; claims: number; hypotheses: number; methods: number; informationNeeds: number };
}
export interface ReasoningEvaluation {
  schemaVersion: typeof REASONING_EVALUATION_VERSION;
  generatedAt: string;
  mode: 'deterministic';
  providerBenchmark: 'not-run';
  providerNotice: string;
  development: { total: number; passed: number; rate: number };
  heldOut: { total: number; passed: number; rate: number };
  metrics: Record<string, { passed: number; total: number; rate: number }>;
  baseline: { outcomeIdentification: number; assumptionDetection: number; unknownDetection: number; methodSelection: number; note: string };
  scenarios: ReasoningScenarioResult[];
}

const lower = (value: string): string => value.toLowerCase();

function check(id: string, passed: boolean, detail: string): ReasoningCheck { return { id, passed, detail }; }

function evaluateScenario(scenario: ReasoningScenario, suite: 'development' | 'held-out'): ReasoningScenarioResult {
  const model: ReasoningModel = buildDeterministicReasoning({ objective: scenario.objective, evidence: scenario.evidence, workspaceId: 'wora-eval' });
  const expect = scenario.expect;
  const checks: ReasoningCheck[] = [];
  if (expect.problemType) checks.push(check('problem-type', model.problemType === expect.problemType, `expected ${expect.problemType}, got ${model.problemType}`));
  if (expect.outcomeIncludes) checks.push(check('outcome', lower(model.desiredOutcome).includes(lower(expect.outcomeIncludes)), `outcome="${model.desiredOutcome}"`));
  if (expect.hasAssumption) checks.push(check('assumption', model.assumptions.some((item) => lower(item).includes(lower(expect.hasAssumption!))), `assumptions=${model.assumptions.length}`));
  if (expect.hasUnknown) checks.push(check('unknown', model.unknowns.some((item) => lower(item).includes(lower(expect.hasUnknown!))), `unknowns=${model.unknowns.length}`));
  if (expect.contradiction !== undefined) checks.push(check('contradiction', (model.contradictions.length > 0) === expect.contradiction, `contradictions=${model.contradictions.length}`));
  if (expect.minHypotheses !== undefined) checks.push(check('hypotheses', model.hypotheses.length >= expect.minHypotheses, `hypotheses=${model.hypotheses.length}`));
  if (expect.hasRejectedHypothesis !== undefined) checks.push(check('rejected-hypothesis', model.hypotheses.some((item) => item.status === 'rejected') === expect.hasRejectedHypothesis, `rejected=${model.hypotheses.filter((item) => item.status === 'rejected').length}`));
  if (expect.noHypotheses) checks.push(check('no-forced-hypotheses', model.hypotheses.length === 0, `hypotheses=${model.hypotheses.length}`));
  if (expect.causal) {
    const matched = expect.causal.some((expected) => model.causalGraph.some((edge) =>
      (!expected.relation || edge.relation === expected.relation)
      && (!expected.evidenceKind || edge.evidenceKind === expected.evidenceKind)
      && (expected.identified === undefined || edge.identified === expected.identified)));
    checks.push(check('causal-edge', matched, `edges=${JSON.stringify(model.causalGraph.map((edge) => [edge.relation, edge.evidenceKind, edge.identified]))}`));
  }
  if (expect.noIdentifiedCausal) checks.push(check('causal-not-identified', model.causalGraph.every((edge) => !edge.identified), `identified=${model.causalGraph.filter((edge) => edge.identified).length}`));
  if (expect.criticalNeed !== undefined) checks.push(check('critical-need', model.informationNeeds.some((item) => item.materiality === 'critical') === expect.criticalNeed, `critical=${model.informationNeeds.filter((item) => item.materiality === 'critical').length}`));
  if (expect.askQuestion !== undefined) checks.push(check('clarification', Boolean(model.clarificationQuestion) === expect.askQuestion, `question=${model.clarificationQuestion ?? 'none'}`));
  if (expect.sufficient !== undefined) checks.push(check('sufficiency', model.sufficientToProceed === expect.sufficient, `sufficient=${model.sufficientToProceed}`));
  if (expect.selectedMethodIncludes) checks.push(check('selected-method', model.methods.some((item) => item.selected && (lower(item.name).includes(lower(expect.selectedMethodIncludes!)) || lower(item.id).includes(lower(expect.selectedMethodIncludes!)))), `selected=${model.methods.filter((item) => item.selected).map((item) => item.name).join(' | ') || 'none'}`));
  if (expect.selectedMethodStatus) checks.push(check('selected-method-status', model.methods.some((item) => item.selected && item.status === expect.selectedMethodStatus), `selected=${model.methods.filter((item) => item.selected).map((item) => `${item.name}:${item.status}`).join(' | ') || 'none'}`));
  if (expect.gapIncludes) checks.push(check('capability-gap', model.methods.some((item) => !item.implemented && item.applies && lower(`${item.id} ${item.name}`).includes(lower(expect.gapIncludes!))), `gaps=${model.methods.filter((item) => !item.implemented && item.applies).map((item) => item.id).join(', ') || 'none'}`));
  if (expect.minMethods !== undefined) checks.push(check('methods', model.methods.length >= expect.minMethods, `methods=${model.methods.length}`));
  if (expect.provenanceComplete) checks.push(check('provenance', model.claims.every((item) => Boolean(item.provenance.source && item.provenance.digest && item.provenance.trust)), `claims=${model.claims.length}`));
  const forecast = model.problemStructure?.forecasting;
  if (expect.forecastIntent !== undefined) checks.push(check('forecast-intent', Boolean(forecast?.intent) === expect.forecastIntent, `intent=${Boolean(forecast?.intent)}`));
  if (expect.targetVariableIncludes) checks.push(check('forecast-target', lower(forecast?.targetVariable ?? '').includes(lower(expect.targetVariableIncludes)), `target=${forecast?.targetVariable ?? 'none'}`));
  if (expect.forecastHorizonSteps !== undefined) checks.push(check('forecast-horizon', forecast?.horizon?.steps === expect.forecastHorizonSteps, `horizon=${forecast?.horizon?.steps ?? 'none'}`));
  if (expect.forecastObservations !== undefined) checks.push(check('forecast-observations', forecast?.observations.length === expect.forecastObservations, `observations=${forecast?.observations.length ?? 0}`));
  if (expect.forecastCanExecute !== undefined) checks.push(check('forecast-can-execute', forecast?.canExecute === expect.forecastCanExecute, `canExecute=${Boolean(forecast?.canExecute)}`));
  if (expect.missingInputIncludes) checks.push(check('forecast-missing-input', (forecast?.missingInputs ?? []).some((item) => lower(item).includes(lower(expect.missingInputIncludes!))), `missing=${(forecast?.missingInputs ?? []).join(' | ') || 'none'}`));
  if (expect.methodAssessedIncludes) checks.push(check('method-assessed', model.methods.some((item) => lower(item.name).includes(lower(expect.methodAssessedIncludes!)) || lower(item.id).includes(lower(expect.methodAssessedIncludes!))), `methods=${model.methods.map((item) => item.name).join(' | ') || 'none'}`));
  if (expect.selectedMethodCount !== undefined) checks.push(check('selected-method-count', model.methods.filter((item) => item.selected).length === expect.selectedMethodCount, `selected=${model.methods.filter((item) => item.selected).map((item) => item.name).join(' | ') || 'none'}`));
  if (expect.selectedMethodExcludes) checks.push(check('selected-method-excluded', model.methods.every((item) => !item.selected || !(lower(item.name).includes(lower(expect.selectedMethodExcludes!)) || lower(item.id).includes(lower(expect.selectedMethodExcludes!)))), `selected=${model.methods.filter((item) => item.selected).map((item) => item.name).join(' | ') || 'none'}`));
  return {
    id: scenario.id, suite, passed: checks.every((item) => item.passed), checks,
    summary: { problemType: model.problemType, mode: model.mode, claims: model.claims.length, hypotheses: model.hypotheses.length, methods: model.methods.length, informationNeeds: model.informationNeeds.length },
  };
}

function aggregate(results: ReasoningScenarioResult[], dimension: string, checkIds: string[]): { passed: number; total: number; rate: number } {
  const relevant = results.flatMap((result) => result.checks.filter((item) => checkIds.includes(item.id)));
  const passed = relevant.filter((item) => item.passed).length;
  return { passed, total: relevant.length, rate: relevant.length ? Number((passed / relevant.length).toFixed(3)) : 1 };
}

export function evaluateReasoningScenarios(): ReasoningEvaluation {
  const development = DEV_SCENARIOS.map((scenario) => evaluateScenario(scenario, 'development'));
  const heldOut = HELD_OUT_SCENARIOS.map((scenario) => evaluateScenario(scenario, 'held-out'));
  const all = [...development, ...heldOut];
  const baseline = { outcomeIdentification: 0, assumptionDetection: 0, unknownDetection: 0, methodSelection: 0, note: 'The Phase 6 baseline has no separate desired-outcome field, no hypothesis/causal/information layer and no semantic method assessment. Its objective text is treated as the outcome, so the outcome score is reported as 0 rather than inflated.' };
  for (const scenario of [...DEV_SCENARIOS, ...HELD_OUT_SCENARIOS]) {
    const profile = understandProblem({ objective: scenario.objective });
    if (scenario.expect.hasAssumption) baseline.assumptionDetection += profile.algorithmSelection.assumptions.length ? 1 : 0;
    if (scenario.expect.hasUnknown) baseline.unknownDetection += profile.missingInformation.length ? 1 : 0;
    if (scenario.expect.selectedMethodIncludes || scenario.expect.selectedMethodStatus) baseline.methodSelection += profile.algorithmSelection.status === 'selected' ? 1 : 0;
  }
  return {
    schemaVersion: REASONING_EVALUATION_VERSION, generatedAt: new Date().toISOString(), mode: 'deterministic',
    providerBenchmark: 'not-run',
    providerNotice: 'No external model provider was configured or benchmarked. The optional provider adapter is contract-tested with a local fixture only; no provider benchmark result is claimed.',
    development: { total: development.length, passed: development.filter((item) => item.passed).length, rate: Number((development.filter((item) => item.passed).length / development.length).toFixed(3)) },
    heldOut: { total: heldOut.length, passed: heldOut.filter((item) => item.passed).length, rate: Number((heldOut.filter((item) => item.passed).length / heldOut.length).toFixed(3)) },
    metrics: {
      understanding: aggregate(all, 'understanding', ['problem-type', 'outcome', 'assumption', 'unknown', 'contradiction']),
      hypothesisQuality: aggregate(all, 'hypothesis', ['hypotheses', 'rejected-hypothesis', 'no-forced-hypotheses']),
      causalReasoning: aggregate(all, 'causal', ['causal-edge', 'causal-not-identified']),
      informationGathering: aggregate(all, 'information', ['critical-need', 'clarification', 'sufficiency']),
      methodSelection: aggregate(all, 'methods', ['selected-method', 'selected-method-status', 'capability-gap', 'methods']),
      reliability: aggregate(all, 'reliability', ['provenance']),
      forecasting: aggregate(all, 'forecasting', ['forecast-intent', 'forecast-target', 'forecast-horizon', 'forecast-observations', 'forecast-can-execute', 'forecast-missing-input']),
    },
    baseline, scenarios: all,
  };
}
