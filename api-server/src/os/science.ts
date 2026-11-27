/**
 * WORA OS — scientific domain map and method-selection explanation.
 *
 * This is the single source of truth for the 12 scientific domains. It does
 * NOT advertise unimplemented methods as executable: every method carries an
 * explicit implementation status, and only methods backed by the real
 * algorithm catalog and tool registry are marked implemented.
 *
 * Selection itself stays in algorithms.ts. This module explains the chosen
 * method, its domain, assumptions, rejected alternatives and gaps.
 */
import { listAlgorithms, selectAlgorithm, type AlgorithmSelection, type AlgorithmSelectionInput } from './algorithms.js';

export const SCIENCE_SCHEMA_VERSION = '1.0';
export const SCIENTIFIC_CATALOG_VERSION = '2026-11-27.1';

export type ImplementationStatus = 'implemented' | 'partial' | 'experimental' | 'documented' | 'not_implemented';

export type ScientificDomainId =
  | 'ai_cognitive'
  | 'mathematics'
  | 'planning_search'
  | 'decision_causal'
  | 'operations_research'
  | 'multi_agent'
  | 'control_autonomy'
  | 'simulation_prediction'
  | 'knowledge_systems'
  | 'autonomous_engineering'
  | 'formal_verification'
  | 'robotics_cyber_physical';

export interface ScientificMethod {
  id: string;
  name: string;
  status: ImplementationStatus;
  algorithmId: string | null;
  toolId: string | null;
  note: string;
}

export interface ScientificDomain {
  id: ScientificDomainId;
  domain: string;
  problems: string[];
  methods: ScientificMethod[];
  requiredInputs: string[];
  outputs: string[];
  dependencies: string[];
  guarantees: string[];
  limitations: string[];
  verification: string[];
  implemented: string[];
  partial: string[];
  missing: string[];
}

const method = (id: string, name: string, status: ImplementationStatus, algorithmId: string | null, toolId: string | null, note: string): ScientificMethod =>
  ({ id, name, status, algorithmId, toolId, note });

type ScientificDomainSeed = Omit<ScientificDomain, 'implemented' | 'partial' | 'missing'>;
const DOMAINS: ScientificDomainSeed[] = [
  {
    id: 'ai_cognitive',
    domain: 'Artificial intelligence and cognitive architectures',
    problems: ['Requirement distillation', 'Specialist routing', 'Capability-aware task decomposition'],
    methods: [
      method('deterministic-planner', 'Deterministic rule planner', 'implemented', null, null, 'Plans from explicit rules and structured features; no semantic planner claim.'),
      method('problem-understanding', 'Structured problem understanding', 'partial', null, 'meta.understand_problem', 'Extracts features, constraints and gaps deterministically.'),
      method('extractive-summary', 'Extractive summarization baseline', 'implemented', 'extractive-summarization', 'text.extract_summary', 'Frequency-based extraction, not abstractive reasoning.'),
      method('specialist-registry', 'Persistent specialist registry and handoffs', 'implemented', null, null, 'Real agents, capability profiles and mandatory handoff contracts.'),
      method('semantic-planner', 'Semantic or neural planner', 'not_implemented', null, null, 'Not implemented; no semantic model is claimed.'),
      method('meta-reasoning', 'Meta-reasoning controller', 'documented', null, null, 'Only deterministic selection heuristics exist.'),
    ],
    requiredInputs: ['objective', 'optional structured features', 'available agents/tools'],
    outputs: ['plan', 'selected specialist(s)', 'handoff contracts'],
    dependencies: ['registry.ts', 'problem.ts', 'selection.ts', 'orchestrator.ts'],
    guarantees: ['Deterministic, inspectable routing for supported problem classes.'],
    limitations: ['No general semantic understanding or autonomous self-modification.'],
    verification: ['Plan dependency checks', 'capability authorization', 'independent acceptance review'],
  },
  {
    id: 'mathematics',
    domain: 'Mathematics and computational foundations',
    problems: ['Discrete assignment', 'Linear and integer optimization', 'Descriptive statistics', 'Numerical trend fitting'],
    methods: [
      method('hungarian', 'Hungarian assignment', 'implemented', 'hungarian-assignment', 'or.assignment', 'Optimal one-to-one linear assignment.'),
      method('highs-lp-mip', 'HiGHS LP / MIP', 'implemented', 'highs-lp-mip', 'or.solve_lp', 'Linear and mixed-integer optimization.'),
      method('descriptive-statistics', 'Descriptive statistics', 'implemented', 'descriptive-statistics', 'stats.describe', 'Mean, quartiles, outliers and slope; no inference.'),
      method('least-squares', 'Least-squares trend', 'implemented', 'linear-trend-forecast', 'forecast.linear', 'Linear baseline with holdout backtest.'),
      method('symbolic-reasoning', 'General symbolic reasoning', 'not_implemented', null, null, 'No CAS, SAT or symbolic algebra engine.'),
      method('numerical-stability', 'Numerical stability policy', 'partial', null, null, 'Solver status and tolerances are checked; no formal numerical analysis.'),
    ],
    requiredInputs: ['numeric model or series', 'bounds/constraints', 'tolerances'],
    outputs: ['solution', 'objective value', 'validation evidence'],
    dependencies: ['ortools.ts', 'algorithms.ts'],
    guarantees: ['Optimality only when the named solver reports it.'],
    limitations: ['Linear models and small/medium fixtures; no general nonlinear solver.'],
    verification: ['Independent recomputation', 'solver status checks', 'constraint revalidation'],
  },
  {
    id: 'planning_search',
    domain: 'Automated planning and search',
    problems: ['Task decomposition', 'Dependency ordering', 'Retry and recovery planning'],
    methods: [
      method('rule-planning', 'Rule-based task planning', 'implemented', null, null, 'Deterministic planner branches with explicit task graphs.'),
      method('plan-comparison', 'Direct vs risk-first plan comparison', 'implemented', null, null, 'Deterministic cost/risk ordering comparison.'),
      method('durable-execution', 'Dependency-blocked durable execution', 'implemented', null, null, 'Leases, checkpoints and dependency gates.'),
      method('a-star', 'A* search', 'not_implemented', null, null, 'No graph-search planner is exposed.'),
      method('mcts', 'Monte Carlo Tree Search', 'not_implemented', null, null, 'Not implemented.'),
      method('pddl', 'PDDL planner', 'not_implemented', null, null, 'No PDDL parser or planner.'),
    ],
    requiredInputs: ['tasks', 'dependencies', 'preconditions/effects', 'risk/cost estimates'],
    outputs: ['ordered plan', 'critical path', 'execution graph'],
    dependencies: ['planning.ts', 'task-queue.ts'],
    guarantees: ['Cycle detection and dependency-respecting order.'],
    limitations: ['No optimal search over alternative action schemas.'],
    verification: ['Dependency existence', 'completion order', 'failure propagation checks'],
  },
  {
    id: 'decision_causal',
    domain: 'Decision science and causal intelligence',
    problems: ['Multi-criteria choice', 'Sensitivity analysis', 'Risk-aware decisions'],
    methods: [
      method('weighted-matrix', 'Weighted decision matrix', 'implemented', 'weighted-decision-matrix', 'decision.weighted_matrix', 'Additive scoring with weight perturbation.'),
      method('monte-carlo', 'Seeded Monte Carlo', 'implemented', 'pert-monte-carlo', 'sim.monte_carlo', 'Uncertainty propagation, not causal identification.'),
      method('sensitivity', 'Weight-perturbation sensitivity', 'partial', 'weighted-decision-matrix', 'decision.weighted_matrix', 'Limited to declared weights.'),
      method('bayesian-inference', 'Bayesian inference', 'not_implemented', null, null, 'No Bayesian network or posterior sampler.'),
      method('causal-inference', 'Causal inference', 'not_implemented', null, null, 'No identification strategy or causal graph.'),
      method('pomdp', 'POMDP planning', 'not_implemented', null, null, 'Not implemented.'),
    ],
    requiredInputs: ['alternatives', 'criteria/weights or priors', 'outcome estimates'],
    outputs: ['ranking or distribution', 'sensitivity notes', 'assumptions'],
    dependencies: ['algorithms.ts', 'ortools.ts'],
    guarantees: ['Deterministic ranking for the supplied judgments.'],
    limitations: ['Weights and distributions are assumptions, not learned causal facts.'],
    verification: ['Recompute scores', 'check quantile ordering', 'expose assumptions'],
  },
  {
    id: 'operations_research',
    domain: 'Operations research and optimization',
    problems: ['Resource allocation', 'Employee scheduling', 'Assignment and matching', 'Shortest path and graph routing', 'Constrained planning'],
    methods: [
      method('assignment', 'Hungarian assignment', 'implemented', 'hungarian-assignment', 'or.assignment', 'Exact optimal assignment for linear costs.'),
      method('mip', 'Mixed-integer programming', 'implemented', 'highs-lp-mip', 'or.solve_lp', 'General linear/integer models.'),
      method('employee-mip', 'Employee scheduling MIP', 'implemented', 'highs-employee-scheduling', 'or.employee_schedule', 'Demand, availability and workload constraints.'),
      method('dijkstra', 'Dijkstra shortest path', 'implemented', 'dijkstra-a-star', 'graph.shortest_path', 'Non-negative weighted graph search with independent path verification.'),
      method('a-star', 'A* shortest path', 'implemented', 'dijkstra-a-star', 'graph.shortest_path', 'Heuristic search verified against an independent Dijkstra baseline.'),
      method('multi-objective', 'Multi-objective optimization', 'partial', null, null, 'Weighted decision matrix only; no Pareto solver.'),
      method('robust-optimization', 'Robust/stochastic optimization', 'not_implemented', null, null, 'Monte Carlo informs risk but does not solve a robust program.'),
      method('cp-sat', 'Constraint programming / CP-SAT', 'not_implemented', null, null, 'Not implemented.'),
      method('min-cost-flow', 'Min-cost flow', 'not_implemented', null, null, 'Not implemented.'),
    ],
    requiredInputs: ['decision variables', 'objective', 'linear constraints', 'bounds/integrality'],
    outputs: ['optimal or infeasible status', 'variable assignment', 'objective value'],
    dependencies: ['ortools.ts', 'tools.ts'],
    guarantees: ['Optimality when HiGHS reports Optimal; infeasibility is explicit.'],
    limitations: ['No nonlinear, robust or Pareto optimization.'],
    verification: ['Constraint revalidation', 'demand coverage', 'objective recomputation'],
  },
  {
    id: 'multi_agent',
    domain: 'Multi-agent systems and distributed intelligence',
    problems: ['Specialist selection', 'Team formation', 'Handoffs and review', 'Lease-based execution'],
    methods: [
      method('dynamic-selection', 'Evidence-based dynamic selection', 'implemented', null, null, 'Capability, evidence, workload and cost scoring.'),
      method('team-formation', 'Smallest capable team formation', 'implemented', null, null, 'Dependency layers and explicit gaps.'),
      method('handoffs', 'Mandatory handoff contracts', 'implemented', null, null, 'Evidence, acceptance and capability snapshots.'),
      method('durable-leases', 'Durable task leases', 'implemented', null, null, 'Single-owner claims with expiry and recovery.'),
      method('consensus', 'Consensus protocol', 'not_implemented', null, null, 'No distributed consensus or game-theoretic allocation.'),
    ],
    requiredInputs: ['agent registry', 'capability requirements', 'task graph'],
    outputs: ['team plan', 'assignments', 'handoff evidence'],
    dependencies: ['selection.ts', 'registry.ts', 'task-queue.ts'],
    guarantees: ['No agent is selected without the required tools and permissions.'],
    limitations: ['Single SQLite writer/process in the tested deployment; no distributed consensus.'],
    verification: ['Capability authorization', 'lease ownership', 'handoff review'],
  },
  {
    id: 'control_autonomy',
    domain: 'Control theory and autonomous systems',
    problems: ['Retry and reassignment', 'Approval pause/resume', 'Recovery after interruption'],
    methods: [
      method('feedback-retry', 'Retry and reassignment feedback loop', 'implemented', null, null, 'Bounded attempts plus one qualified reassignment.'),
      method('approval-control', 'Approval-gated pause/resume', 'implemented', null, null, 'Class C actions stop at the boundary.'),
      method('recovery', 'Checkpoint and lease recovery', 'implemented', null, null, 'Interrupted work is marked and resumable.'),
      method('mpc', 'Model predictive control', 'not_implemented', null, null, 'No continuous-state controller.'),
      method('adaptive-control', 'Adaptive control', 'documented', null, null, 'Only discrete retry policy exists.'),
    ],
    requiredInputs: ['task state', 'failure evidence', 'retry/reassignment policy'],
    outputs: ['retry/reassign/stop decision', 'recovered state'],
    dependencies: ['orchestrator.ts', 'task-queue.ts', 'recovery.ts'],
    guarantees: ['No infinite retry without a changed strategy; approval boundaries remain closed.'],
    limitations: ['Discrete workflow control only; no physical control loop.'],
    verification: ['Attempt bounds', 'lease/checkpoint checks', 'approval consumption'],
  },
  {
    id: 'simulation_prediction',
    domain: 'Simulation and predictive intelligence',
    problems: ['Uncertainty propagation', 'Scenario comparison', 'Trend projection'],
    methods: [
      method('pert', 'Seeded PERT Monte Carlo', 'implemented', 'pert-monte-carlo', 'sim.monte_carlo', 'Reproducible triangular sampling.'),
      method('digital-twins', 'Digital twin scenarios', 'implemented', null, null, 'Stored observations and what-if scenarios.'),
      method('linear-forecast', 'Linear trend baseline', 'implemented', 'linear-trend-forecast', 'forecast.linear', 'Holdout backtest, no causal claim.'),
      method('system-dynamics', 'Calibrated system dynamics', 'not_implemented', null, null, 'No calibrated system-dynamics engine.'),
      method('causal-forecast', 'Causal forecasting', 'not_implemented', null, null, 'Not implemented.'),
    ],
    requiredInputs: ['estimates or series', 'trials/seed or steps', 'scenario assumptions'],
    outputs: ['distribution or projection', 'uncertainty bands', 'limitations'],
    dependencies: ['algorithms.ts', 'twins.ts'],
    guarantees: ['Seeded results are repeatable; simulations are labeled simulated.'],
    limitations: ['No observed ground truth, correlations or causal model.'],
    verification: ['Seed/trial record', 'quantile ordering', 'holdout metrics'],
  },
  {
    id: 'knowledge_systems',
    domain: 'Knowledge and information systems',
    problems: ['Scoped memory', 'Deterministic retrieval', 'Provenance and versioning'],
    methods: [
      method('scoped-memory', 'Scoped SQLite memory', 'implemented', null, null, 'Workspace/owner visibility and TTL.'),
      method('deterministic-retrieval', 'Deterministic retrieval', 'implemented', null, null, 'Keyword scoring over stored memory.'),
      method('lessons', 'Candidate lesson lifecycle', 'partial', null, null, 'Candidate/evaluate/promote/revoke with governance.'),
      method('vector-search', 'Vector retrieval', 'not_implemented', null, null, 'No embedding store.'),
      method('knowledge-graph', 'Knowledge graph', 'not_implemented', null, null, 'Not implemented.'),
    ],
    requiredInputs: ['records', 'scope/provenance', 'query'],
    outputs: ['ranked records', 'provenance', 'versions'],
    dependencies: ['memory.ts', 'lessons.ts'],
    guarantees: ['Workspace isolation and explicit provenance.'],
    limitations: ['No semantic/vector retrieval or graph inference.'],
    verification: ['Scope isolation tests', 'version snapshots', 'provenance checks'],
  },
  {
    id: 'autonomous_engineering',
    domain: 'Autonomous engineering and program synthesis',
    problems: ['Generate a tested application', 'Static security review', 'Patch-based repair'],
    methods: [
      method('scaffold', 'Zero-dependency application scaffold', 'implemented', null, 'scaffold.webapp', 'Generates and tests a small real app.'),
      method('security-scan', 'Static security scan', 'implemented', null, 'security.scan', 'Pattern-based triage, not formal proof.'),
      method('node-test', 'Automated Node test execution', 'implemented', null, 'host.exec', 'Allowlisted node --test only.'),
      method('patch-repair', 'Bounded patch-based repair', 'implemented', null, 'code.repair', 'Copies, patches and tests; does not mutate the source.'),
      method('general-synthesis', 'General program synthesis', 'not_implemented', null, null, 'No general synthesizer.'),
    ],
    requiredInputs: ['objective or defect', 'repository/patch', 'test command'],
    outputs: ['artifact', 'test evidence', 'diff'],
    dependencies: ['scaffold.ts', 'code-repair.ts', 'tools.ts'],
    guarantees: ['Generated artifacts are tested; repair is isolated from the source.'],
    limitations: ['Template scaffold and bounded diff repair, not general synthesis.'],
    verification: ['Node test pass', 'security scan', 'diff integrity'],
  },
  {
    id: 'formal_verification',
    domain: 'Formal verification, safety and reliability',
    problems: ['Input contracts', 'Independent result checks', 'Approval and permission boundaries'],
    methods: [
      method('zod-contracts', 'Zod runtime contracts', 'implemented', null, null, 'Input schema validation at tool boundaries.'),
      method('typescript-checks', 'TypeScript static checks', 'implemented', null, null, 'Compile-time type checking.'),
      method('independent-checks', 'Independent verification checks', 'implemented', null, null, 'Artifact and acceptance checks outside the producing agent.'),
      method('plan-verification', 'Plan execution verification', 'implemented', null, null, 'Dependency, order and failure propagation checks.'),
      method('model-checking', 'Model checking', 'not_implemented', null, null, 'No finite-state model checker.'),
      method('sat-smt', 'SAT/SMT solving', 'not_implemented', null, null, 'Not implemented.'),
    ],
    requiredInputs: ['contracts', 'execution evidence', 'acceptance criteria'],
    outputs: ['pass/fail checks', 'violation evidence'],
    dependencies: ['verification.ts', 'independent-verification.ts', 'governance.ts'],
    guarantees: ['Fail-closed contracts for covered paths.'],
    limitations: ['Not a proof of arbitrary program correctness.'],
    verification: ['Runtime schema checks', 'independent checks', 'approval digest checks'],
  },
  {
    id: 'robotics_cyber_physical',
    domain: 'Robotics and cyber-physical intelligence',
    problems: ['Device identity and pairing', 'Remote command channel foundation'],
    methods: [
      method('device-pairing', 'One-time device pairing and revocation', 'implemented', null, null, 'Paired device identity and heartbeat.'),
      method('local-channel', 'Local command channel foundation', 'partial', null, null, 'Pairing/revocation exists; physical control is not connected.'),
      method('navigation', 'Navigation and motion planning', 'not_implemented', null, null, 'Not implemented.'),
      method('sensor-fusion', 'Sensor fusion', 'not_implemented', null, null, 'Not implemented.'),
    ],
    requiredInputs: ['device identity', 'pairing token', 'command intent'],
    outputs: ['pairing/revocation state', 'heartbeat evidence'],
    dependencies: ['governance.ts', 'wora-server.ts'],
    guarantees: ['One-time pairing and revocable device identity.'],
    limitations: ['No physical robot, navigation or sensor integration.'],
    verification: ['Pairing one-time tests', 'heartbeat fingerprint', 'revocation checks'],
  },
];

function deriveStatusLists(domain: ScientificDomainSeed): void {
  const target = domain as ScientificDomain;
  target.implemented = domain.methods.filter((entry) => entry.status === 'implemented').map((entry) => entry.name);
  target.partial = domain.methods.filter((entry) => entry.status === 'partial' || entry.status === 'experimental').map((entry) => entry.name);
  target.missing = domain.methods.filter((entry) => entry.status === 'documented' || entry.status === 'not_implemented').map((entry) => entry.name);
}

for (const domain of DOMAINS) deriveStatusLists(domain);

const DOMAIN_BY_ID = new Map(DOMAINS.map((domain) => [domain.id, domain]));

const KIND_DOMAIN: Record<string, ScientificDomainId> = {
  assignment: 'operations_research',
  shortest_path: 'operations_research',
  employee_scheduling: 'operations_research',
  linear_programming: 'operations_research',
  integer_programming: 'operations_research',
  monte_carlo_simulation: 'simulation_prediction',
  forecasting: 'simulation_prediction',
  multi_criteria_decision: 'decision_causal',
  extractive_summarization: 'ai_cognitive',
  descriptive_statistics: 'mathematics',
};

export function listScientificDomains(): ScientificDomain[] {
  return DOMAINS.map((domain) => ({
    ...domain,
    problems: [...domain.problems],
    methods: domain.methods.map((entry) => ({ ...entry })),
    requiredInputs: [...domain.requiredInputs],
    outputs: [...domain.outputs],
    dependencies: [...domain.dependencies],
    guarantees: [...domain.guarantees],
    limitations: [...domain.limitations],
    verification: [...domain.verification],
    implemented: [...(domain as ScientificDomain).implemented],
    partial: [...(domain as ScientificDomain).partial],
    missing: [...(domain as ScientificDomain).missing],
  }));
}

export function getScientificDomain(id: string): ScientificDomain | null {
  const domain = DOMAIN_BY_ID.get(id as ScientificDomainId);
  return domain ? listScientificDomains().find((entry) => entry.id === domain.id) ?? null : null;
}

export function scientificCatalogSummary(): {
  schemaVersion: string;
  catalogVersion: string;
  domains: number;
  implementedMethods: number;
  partialMethods: number;
  missingMethods: number;
  implementedAlgorithms: number;
} {
  const methods = DOMAINS.flatMap((domain) => domain.methods);
  return {
    schemaVersion: SCIENCE_SCHEMA_VERSION,
    catalogVersion: SCIENTIFIC_CATALOG_VERSION,
    domains: DOMAINS.length,
    implementedMethods: methods.filter((entry) => entry.status === 'implemented').length,
    partialMethods: methods.filter((entry) => entry.status === 'partial' || entry.status === 'experimental').length,
    missingMethods: methods.filter((entry) => entry.status === 'documented' || entry.status === 'not_implemented').length,
    implementedAlgorithms: listAlgorithms().length,
  };
}

export interface ScientificGap {
  requiredCapability: string;
  reason: string;
  suggestedNextStep: string;
}

export interface ScientificSelection {
  schemaVersion: typeof SCIENCE_SCHEMA_VERSION;
  catalogVersion: string;
  domain: ScientificDomainId | null;
  domainName: string | null;
  status: AlgorithmSelection['status'];
  method: {
    algorithmId: string;
    name: string;
    toolId: string | null;
    status: ImplementationStatus;
    guarantee: string;
    requiredInputs: string[];
    outputs: string[];
    limitations: string[];
    verification: string[];
  } | null;
  confidence: number;
  rationale: string[];
  assumptions: string[];
  rejectedAlternatives: Array<{ name: string; reason: string; status: ImplementationStatus | 'implemented-alternative' }>;
  missingInformation: string[];
  gap: ScientificGap | null;
  algorithmSelection: AlgorithmSelection;
}

function statusForAlgorithm(algorithmId: string): ImplementationStatus {
  const domain = DOMAINS.find((entry) => entry.methods.some((candidate) => candidate.algorithmId === algorithmId));
  return domain?.methods.find((candidate) => candidate.algorithmId === algorithmId)?.status ?? 'implemented';
}

function gapFor(selection: AlgorithmSelection): ScientificGap | null {
  if (selection.status === 'unsupported') {
    return {
      requiredCapability: selection.warnings[0]?.replace(/^No /u, '').replace(/ solver.*$/u, '') || 'an unsupported scientific method',
      reason: selection.warnings.join(' ') || 'No implemented method covers this problem class.',
      suggestedNextStep: 'Provide a supported problem formulation, install an authorized tool/plugin, or add a tested implementation before executing.',
    };
  }
  if (selection.status === 'needs_input') {
    return {
      requiredCapability: 'a resolvable problem class and required inputs',
      reason: selection.warnings.join(' ') || 'The problem class could not be resolved from structured features.',
      suggestedNextStep: `Supply: ${selection.missingInformation.join('; ') || 'structured problem features'}.`,
    };
  }
  return null;
}

export function describeScientificSelection(selection: AlgorithmSelection): ScientificSelection {
  const primary = selection.primary;
  const domainId = primary ? KIND_DOMAIN[selection.problemKind] ?? null : null;
  const domain = domainId ? DOMAIN_BY_ID.get(domainId) ?? null : null;
  const status = primary ? statusForAlgorithm(primary.algorithmId) : 'not_implemented';
  const rejectedAlternatives = selection.alternatives.map((alternative) => ({
    name: alternative.name,
    reason: alternative.reason,
    status: statusForAlgorithm(alternative.algorithmId),
  }));
  if (domain && primary) {
    for (const candidate of domain.methods) {
      if (candidate.algorithmId === primary.algorithmId) continue;
      if (rejectedAlternatives.some((entry) => entry.name === candidate.name)) continue;
      if (candidate.status === 'not_implemented' || candidate.status === 'documented') {
        rejectedAlternatives.push({
          name: candidate.name,
          reason: `${candidate.note} It is not an executable option for this selection.`,
          status: candidate.status,
        });
      }
    }
  }
  const assumptions = primary
    ? [
        'Selection is based on the supplied structured features and explicit problem kind, not on semantic understanding.',
        ...(selection.warnings.some((warning) => /keyword-based/u.test(warning)) ? ['Objective keywords are a fallback signal only.'] : []),
        ...(selection.missingInformation.length ? ['Required inputs are not yet complete; execution must stop or request them.'] : []),
      ]
    : ['No executable method is assumed; the gap is explicit.'];
  return {
    schemaVersion: SCIENCE_SCHEMA_VERSION,
    catalogVersion: SCIENTIFIC_CATALOG_VERSION,
    domain: domainId,
    domainName: domain?.domain ?? null,
    status: selection.status,
    method: primary ? {
      algorithmId: primary.algorithmId,
      name: primary.name,
      toolId: primary.toolId,
      status,
      guarantee: primary.guarantee,
      requiredInputs: [...primary.requiredInputs],
      outputs: domain?.outputs.slice(0, 8) ?? [],
      limitations: [...primary.limitations],
      verification: [...primary.verification],
    } : null,
    confidence: selection.confidence,
    rationale: [...selection.rationale],
    assumptions,
    rejectedAlternatives: rejectedAlternatives.slice(0, 12),
    missingInformation: [...selection.missingInformation],
    gap: gapFor(selection),
    algorithmSelection: selection,
  };
}

export function selectScientificMethod(input: AlgorithmSelectionInput): ScientificSelection {
  return describeScientificSelection(selectAlgorithm(input));
}
