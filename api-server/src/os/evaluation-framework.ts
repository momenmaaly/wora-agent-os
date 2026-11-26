/**
 * WORA OS — Phase 6 evaluation framework.
 *
 * Scenarios provide only an objective, facts, constraints and resources. The
 * framework asks WORA to construct its own problem model and composition; it
 * does not supply an expected execution plan. The evaluator checks explicit
 * properties (domain, provenance separation, approved capabilities, dependency
 * ordering, honest gaps) and records actual results for every scenario.
 */
import { modelProblem, type UnifiedProblem } from './problem-model.js';
import { composeMissionPlan, type ComposedMission } from './capability-composition.js';
import { getTool } from './tools.js';
import { evaluateSemanticCompatibility } from './semantic-contracts.js';
import { ensureSeedAgents } from './registry.js';

export interface EvaluationScenario {
  id: string;
  label: string;
  domain: 'business' | 'software' | 'data' | 'optimization' | 'allocation' | 'scheduling' | 'scientific' | 'decision' | 'multi_agent' | 'troubleshooting' | 'capability_failure' | 'missing_capability' | 'ambiguous';
  objective: string;
  facts: string[];
  constraints: string[];
  resources: string[];
  expectedDomain: UnifiedProblem['domain'];
  expectedNeeds: string[];
  /** plan = executable plan or honest gap; clarify = must preserve unknowns and not invent a plan. */
  expectedBehavior: 'plan' | 'gap' | 'clarify';
  evaluatorNote: string;
}

export interface ScenarioEvaluation {
  scenario: EvaluationScenario;
  model: UnifiedProblem;
  composition: ComposedMission;
  metrics: {
    domainCorrect: boolean;
    factsSeparated: boolean;
    assumptionsSeparated: boolean;
    unknownsPreserved: boolean;
    methodSelected: boolean;
    approvedOnly: boolean;
    hasRealToolForEveryNode: boolean;
    dependencyOrderValid: boolean;
    gapHonest: boolean;
    behaviorHonest: boolean;
    semanticFallbacksOnly: boolean;
    toolCalls: number;
    nodes: number;
    gaps: number;
    estimatedCostClass: 'low' | 'medium' | 'high';
    estimatedLatencyClass: 'low' | 'medium' | 'high';
  };
  passed: boolean;
  failures: string[];
  measuredAt: string;
}

export interface EvaluationSummary {
  scenarios: ScenarioEvaluation[];
  totals: {
    scenarios: number;
    passed: number;
    failed: number;
    domainAccuracy: number;
    provenanceSeparation: number;
    approvedOnly: number;
    dependencyOrdering: number;
    honestGaps: number;
    semanticFallbacks: number;
    estimatedToolCalls: number;
  };
}

const rank = { low: 0, medium: 1, high: 2 } as const;
const maxClass = (values: Array<'low' | 'medium' | 'high'>): 'low' | 'medium' | 'high' => values.reduce((max, value) => rank[value] > rank[max] ? value : max, 'low');

export const PHASE6_SCENARIOS: EvaluationScenario[] = [
  {
    id: 'P6-BIZ-01', label: 'Business planning with budget and time', domain: 'business',
    objective: 'A regional retailer wants to launch a subscription service for 12,000 customers within a budget of $250,000 and before the next quarter. Compare feasible go-to-market strategies and verify the arithmetic and dependencies. Do not claim market success.',
    facts: ['12,000 target customers', 'quarter deadline'], constraints: ['budget $250,000', 'must launch before next quarter'], resources: ['marketing team', 'customer database'],
    expectedDomain: 'organization', expectedNeeds: ['analysis', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'Internal feasibility and arithmetic may be verified; external market success must remain unclaimed.',
  },
  {
    id: 'P6-SW-02', label: 'Small software product', domain: 'software',
    objective: 'Build a small web application for a neighborhood library with book search, lending records and an acceptance test suite. The app must be implemented and tested before delivery.',
    facts: ['three requested capabilities'], constraints: ['must include acceptance tests'], resources: ['workspace', 'node test runner'],
    expectedDomain: 'software_engineering', expectedNeeds: ['engineering', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'A plan must use real implementation and test tools; no fake completion.',
  },
  {
    id: 'P6-DATA-03', label: 'Data engineering pipeline', domain: 'data',
    objective: 'Analyze a sales dataset with a time series and descriptive statistics, detect outliers and forecast the next three periods. The source data is not yet attached.',
    facts: ['sales dataset exists but is not attached'], constraints: ['must not invent missing observations'], resources: ['dataset'],
    expectedDomain: 'data_intelligence', expectedNeeds: ['analysis', 'forecasting', 'statistics', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'Missing data must be explicit; a plan may not run statistics on fabricated series.',
  },
  {
    id: 'P6-OPT-04', label: 'Mathematical optimization', domain: 'optimization',
    objective: 'Optimize the assignment of 8 technicians to 8 service jobs using the supplied cost matrix [[9,2,7,8],[6,4,3,7],[5,8,1,8],[7,6,9,4],[8,3,5,6],[4,7,2,5],[6,4,8,3],[5,9,6,2]] with one technician per job. Minimize total cost.',
    facts: ['8x8 cost matrix'], constraints: ['one technician per job', 'minimize total cost'], resources: ['cost matrix'],
    expectedDomain: 'operations_research', expectedNeeds: ['optimization', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'Feasibility and objective value must be independently checked.',
  },
  {
    id: 'P6-ALLOC-05', label: 'Resource allocation', domain: 'allocation',
    objective: 'Allocate a limited cloud budget of $40,000 across four teams while respecting each team minimum and the total capacity. Minimize total cost and explain the allocation.',
    facts: ['four teams', 'total budget $40,000'], constraints: ['respect team minimums', 'total capacity'], resources: ['cloud budget', 'team requirements'],
    expectedDomain: 'operations_research', expectedNeeds: ['optimization', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'If the exact solver input is absent, the plan must state what is missing.',
  },
  {
    id: 'P6-SCHED-06', label: 'Employee scheduling', domain: 'scheduling',
    objective: 'Schedule 20 employees across 5 shifts for next week. Each employee has availability and hourly cost; every shift demand must be met and no employee may exceed 5 assignments.',
    facts: ['20 employees', '5 shifts'], constraints: ['meet every shift demand', 'max 5 assignments per employee'], resources: ['employee roster', 'availability'],
    expectedDomain: 'operations_research', expectedNeeds: ['scheduling', 'optimization', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'The existing solver may use clearly labelled sample data only when the roster is absent; this scenario names the roster as a resource.',
  },
  {
    id: 'P6-SCI-07', label: 'Scientific uncertainty', domain: 'scientific',
    objective: 'A research study must estimate the risk of a supplier delay using uncertain optimistic, likely and pessimistic estimates. Simulate the distribution and explain what cannot be concluded from the available evidence.',
    facts: ['three-point estimates are uncertain'], constraints: ['do not present estimates as observations'], resources: ['estimates'],
    expectedDomain: 'research', expectedNeeds: ['simulation', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'Facts, assumptions and unknowns must remain separate.',
  },
  {
    id: 'P6-DEC-08', label: 'Decision with incomplete information', domain: 'decision',
    objective: 'Choose between three vendors using weighted criteria, but the security audit for one vendor is missing. Rank the alternatives and state whether the decision is safe.',
    facts: ['three vendors', 'one audit is missing'], constraints: ['criteria weights must be explicit', 'do not invent the missing audit'], resources: ['vendor scores'],
    expectedDomain: 'general', expectedNeeds: ['decision', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'A ranking may be produced only with the missing evidence clearly disclosed.',
  },
  {
    id: 'P6-MULTI-09', label: 'Multi-agent coordination', domain: 'multi_agent',
    objective: 'Coordinate a software architecture specialist and a QA specialist to deliver a small API: architecture must hand off a contract to QA, which must run independent tests before delivery.',
    facts: ['two specialist roles'], constraints: ['ordered handoff', 'independent tests'], resources: ['specialist agents', 'test runner'],
    expectedDomain: 'software_engineering', expectedNeeds: ['engineering', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'A plan must preserve dependency ordering and not merge independent verification into the authoring step.',
  },
  {
    id: 'P6-OPS-10', label: 'Operational troubleshooting', domain: 'troubleshooting',
    objective: 'Inspect the host machine for memory pressure, high load and disk problems, then explain the findings and the limits of the available diagnostics.',
    facts: ['host signals are available'], constraints: ['do not claim end-user device access'], resources: ['host diagnostics'],
    expectedDomain: 'diagnostics', expectedNeeds: ['diagnostics', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'The result must not claim access to a local device that is not connected.',
  },
  {
    id: 'P6-FAIL-11', label: 'Capability failure', domain: 'capability_failure',
    objective: 'Use the unavailable vendor-risk plugin to retrieve a risk score, then decide whether to approve a high-risk supplier. The plugin is not installed.',
    facts: ['the requested plugin is absent'], constraints: ['do not fabricate the risk score'], resources: ['supplier data'],
    expectedDomain: 'general', expectedNeeds: ['integration', 'verification'], expectedBehavior: 'gap',
    evaluatorNote: 'The exact missing integration must be reported, not simulated.',
  },
  {
    id: 'P6-MISS-12', label: 'Missing capability', domain: 'missing_capability',
    objective: 'Prove the payment protocol is correct with SMT formal verification and a model checker. No such solver is installed.',
    facts: ['protocol description is available'], constraints: ['do not substitute testing for a proof'], resources: ['protocol specification'],
    expectedDomain: 'general', expectedNeeds: ['formal_verification', 'verification'], expectedBehavior: 'gap',
    evaluatorNote: 'The exact formal-verification gap must be reported with a safe next step.',
  },
  {
    id: 'P6-AMB-13', label: 'Ambiguous negative case', domain: 'ambiguous',
    objective: 'Do the thing.',
    facts: [], constraints: [], resources: [],
    expectedDomain: 'general', expectedNeeds: ['analysis', 'verification'], expectedBehavior: 'clarify',
    evaluatorNote: 'Terse objective must remain ambiguous; WORA may not invent a domain or plan.',
  },
];

function dependencyOrderValid(composition: ComposedMission): boolean {
  return composition.tasks.every((task, index) => (task.dependsOn ?? []).every((dependency) => dependency >= 0 && dependency < index));
}

function inputBindingsValid(composition: ComposedMission): boolean {
  return composition.tasks.every((task) => (task.inputBindings ?? []).every((binding) => binding.taskIndex >= 0 && binding.taskIndex < composition.tasks.length && binding.key.length > 0));
}

function semanticFallbacksOnly(composition: ComposedMission): boolean {
  return composition.graph.nodes.every((node) => node.fallbackTools.every((fallback) => evaluateSemanticCompatibility({
    primaryTool: node.tool, fallbackTool: fallback, risk: 'low',
  }).compatible));
}

export function evaluateScenario(scenario: EvaluationScenario): ScenarioEvaluation {
  const model = modelProblem({ workspaceId: 'phase6-evaluation', objective: scenario.objective, includeMemory: false });
  const composition = composeMissionPlan({ workspaceId: 'phase6-evaluation', objective: scenario.objective, model });
  const metrics: ScenarioEvaluation['metrics'] = {
    domainCorrect: model.domain === scenario.expectedDomain,
    factsSeparated: model.facts.length > 0 && model.facts.every((fact) => fact.provenance === 'user-objective'),
    assumptionsSeparated: model.assumptions.every((assumption) => assumption.provenance === 'assumption'),
    unknownsPreserved: model.unknowns.length > 0 || scenario.expectedBehavior !== 'clarify',
    methodSelected: Boolean(model.methods.selected) || model.methods.missing.length > 0 || scenario.expectedBehavior !== 'plan',
    approvedOnly: composition.graph.nodes.every((node) => node.available && node.permissionsApproved.length === node.permissions.length),
    hasRealToolForEveryNode: composition.graph.nodes.every((node) => Boolean(getTool(node.tool))),
    dependencyOrderValid: dependencyOrderValid(composition) && inputBindingsValid(composition),
    gapHonest: composition.graph.gaps.every((gap) => gap.missing.length > 0),
    behaviorHonest: scenario.expectedBehavior === 'clarify'
      ? model.baseProfile.ambiguity.length > 0 || model.unknowns.length > 0
      : scenario.expectedBehavior === 'gap'
        ? composition.graph.gaps.length > 0
        : composition.tasks.length > 0,
    semanticFallbacksOnly: semanticFallbacksOnly(composition),
    toolCalls: composition.tasks.filter((task) => task.tool).length,
    nodes: composition.graph.nodes.length,
    gaps: composition.graph.gaps.length,
    estimatedCostClass: maxClass(composition.graph.nodes.map((node) => node.costClass === 'external' ? 'high' as const : node.costClass === 'local' ? 'medium' as const : 'low' as const)),
    estimatedLatencyClass: maxClass(composition.graph.nodes.map((node) => node.latencyClass)),
  };
  const required = ['domainCorrect', 'factsSeparated', 'assumptionsSeparated', 'unknownsPreserved', 'methodSelected', 'approvedOnly', 'hasRealToolForEveryNode', 'dependencyOrderValid', 'gapHonest', 'behaviorHonest', 'semanticFallbacksOnly'] as const;
  const failures = required.filter((key) => !metrics[key]).map((key) => `${key} failed`);
  if (scenario.expectedNeeds.some((need) => !model.needs.includes(need))) failures.push(`missing expected need(s): ${scenario.expectedNeeds.filter((need) => !model.needs.includes(need)).join(', ')}`);
  return { scenario, model, composition, metrics, passed: failures.length === 0, failures, measuredAt: new Date().toISOString() };
}

export function evaluatePhase6Scenarios(workspaceId = 'phase6-evaluation'): EvaluationSummary {
  ensureSeedAgents(workspaceId);
  const scenarios = PHASE6_SCENARIOS.map(evaluateScenario);
  const ratio = (predicate: (scenario: ScenarioEvaluation) => boolean) => scenarios.length ? scenarios.filter(predicate).length / scenarios.length : 0;
  return {
    scenarios,
    totals: {
      scenarios: scenarios.length,
      passed: scenarios.filter((scenario) => scenario.passed).length,
      failed: scenarios.filter((scenario) => !scenario.passed).length,
      domainAccuracy: ratio((scenario) => scenario.metrics.domainCorrect),
      provenanceSeparation: ratio((scenario) => scenario.metrics.factsSeparated && scenario.metrics.assumptionsSeparated && scenario.metrics.unknownsPreserved),
      approvedOnly: ratio((scenario) => scenario.metrics.approvedOnly),
      dependencyOrdering: ratio((scenario) => scenario.metrics.dependencyOrderValid),
      honestGaps: ratio((scenario) => scenario.metrics.gapHonest && scenario.metrics.behaviorHonest),
      semanticFallbacks: ratio((scenario) => scenario.metrics.semanticFallbacksOnly),
      estimatedToolCalls: scenarios.reduce((sum, scenario) => sum + scenario.metrics.toolCalls, 0),
    },
  };
}

/**
 * Held-out scenarios: added after the development evaluation set and not used
 * to change the model/composition implementation. Results are reported as-is.
 */
export const PHASE6_HELD_OUT_SCENARIOS: EvaluationScenario[] = [
  {
    id: 'P6-HOLD-01', label: 'Clinic nurse allocation', domain: 'scheduling',
    objective: 'A clinic must assign 6 nurses to 4 triage stations across 3 shifts while respecting availability and minimizing overtime cost.',
    facts: ['6 nurses', '4 triage stations', '3 shifts'], constraints: ['respect availability', 'minimize overtime'], resources: ['nurse roster'],
    expectedDomain: 'operations_research', expectedNeeds: ['scheduling', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'Held-out scheduling case.',
  },
  {
    id: 'P6-HOLD-02', label: 'Customer churn analysis', domain: 'data',
    objective: 'Investigate customer churn from a dataset with descriptive statistics and a forecast for the next two periods. The dataset is not attached.',
    facts: ['dataset is referenced but missing'], constraints: ['do not fabricate observations'], resources: ['customer dataset'],
    expectedDomain: 'data_intelligence', expectedNeeds: ['statistics', 'forecasting', 'verification'], expectedBehavior: 'plan',
    evaluatorNote: 'Held-out data case with missing input.',
  },
  {
    id: 'P6-HOLD-03', label: 'TLA+ protocol proof', domain: 'missing_capability',
    objective: 'Use TLA+ model checking to prove that a lock-free queue implementation preserves safety and liveness. No model checker is installed.',
    facts: ['implementation exists'], constraints: ['a proof is required'], resources: ['specification'],
    expectedDomain: 'general', expectedNeeds: ['formal_verification'], expectedBehavior: 'gap',
    evaluatorNote: 'Held-out missing-capability case.',
  },
  {
    id: 'P6-HOLD-04', label: 'Arabic ambiguous request', domain: 'ambiguous',
    objective: 'حسّن النظام.',
    facts: [], constraints: [], resources: [],
    expectedDomain: 'general', expectedNeeds: ['analysis', 'verification'], expectedBehavior: 'clarify',
    evaluatorNote: 'Held-out Arabic ambiguity case.',
  },
];

export function evaluateHeldOutScenarios(workspaceId = 'phase6-held-out'): EvaluationSummary {
  ensureSeedAgents(workspaceId);
  const scenarios = PHASE6_HELD_OUT_SCENARIOS.map(evaluateScenario);
  const ratio = (predicate: (scenario: ScenarioEvaluation) => boolean) => scenarios.length ? scenarios.filter(predicate).length / scenarios.length : 0;
  return {
    scenarios,
    totals: {
      scenarios: scenarios.length, passed: scenarios.filter((scenario) => scenario.passed).length, failed: scenarios.filter((scenario) => !scenario.passed).length,
      domainAccuracy: ratio((scenario) => scenario.metrics.domainCorrect),
      provenanceSeparation: ratio((scenario) => scenario.metrics.factsSeparated && scenario.metrics.assumptionsSeparated && scenario.metrics.unknownsPreserved),
      approvedOnly: ratio((scenario) => scenario.metrics.approvedOnly), dependencyOrdering: ratio((scenario) => scenario.metrics.dependencyOrderValid),
      honestGaps: ratio((scenario) => scenario.metrics.gapHonest && scenario.metrics.behaviorHonest), semanticFallbacks: ratio((scenario) => scenario.metrics.semanticFallbacksOnly),
      estimatedToolCalls: scenarios.reduce((sum, scenario) => sum + scenario.metrics.toolCalls, 0),
    },
  };
}
