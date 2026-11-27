import { z } from 'zod';

/**
 * WORA OS — algorithm selection and catalog.
 *
 * This module is deliberately narrow: it selects among algorithms that are
 * actually implemented and tested in this repository. It does not advertise
 * research candidates as production capabilities. Every catalog entry names
 * its real tool, guarantees, inputs, verification checks and limitations.
 *
 * Selection is deterministic and explainable. Structured features outrank
 * keyword hints; explicit problem kinds outrank both. When the problem class
 * is unknown, the engine returns `needs_input` instead of fabricating a plan.
 */
export const ALGORITHM_SCHEMA_VERSION = '1.0';
export const ALGORITHM_CATALOG_VERSION = '2026-11-28.1';

export const PROBLEM_KINDS = [
  'assignment',
  'shortest_path',
  'employee_scheduling',
  'linear_programming',
  'integer_programming',
  'monte_carlo_simulation',
  'forecasting',
  'multi_criteria_decision',
  'max_flow',
  'min_cost_flow',
  'bipartite_matching',
  'tsp',
  'vrp',
  'pareto_multi_objective',
  'bayesian_inference',
  'queue_simulation',
  'scenario_comparison',
  'extractive_summarization',
  'descriptive_statistics',
] as const;

export type ProblemKind = (typeof PROBLEM_KINDS)[number];
export type DetectedProblemKind = ProblemKind | 'unknown';
export type AlgorithmCost = 'low' | 'medium' | 'high';

export type ScientificRequirement =
  | 'assignment'
  | 'scheduling'
  | 'optimization'
  | 'simulation'
  | 'forecasting'
  | 'statistics'
  | 'decision'
  | 'summarization'
  | 'planning'
  | 'causal_analysis'
  | 'formal_verification'
  | 'reinforcement_learning'
  | 'deep_learning'
  | 'bayesian_inference'
  | 'graph'
  | 'network_flow'
  | 'routing'
  | 'multi_objective'
  | 'queueing'
  | 'scenario'
  | 'mcts';

export interface ProblemFeatures {
  problemType?: 'prediction' | 'optimization' | 'planning' | 'causal_analysis' | 'simulation' | 'formal_verification' | 'decision' | 'allocation' | 'scheduling' | 'classification';
  requires?: ScientificRequirement[];
  uncertaintyLevel?: 'none' | 'low' | 'medium' | 'high';
  constraintsCount?: number;
  variableCount?: number;
  dependencyCount?: number;
  precision?: 'exact' | 'approximate' | 'bounds';
  timeLimitMs?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  deterministic?: boolean;
  stochastic?: boolean;
  availableTools?: string[];
  hasCostMatrix?: boolean;
  hasGraph?: boolean;
  hasNetworkFlow?: boolean;
  hasMinCostFlow?: boolean;
  hasBipartite?: boolean;
  hasRouting?: boolean;
  hasVehicles?: boolean;
  hasPareto?: boolean;
  hasBayes?: boolean;
  hasQueue?: boolean;
  hasScenarios?: boolean;
  graphNodes?: number;
  graphEdges?: number;
  negativeWeights?: boolean;
  matrixRows?: number;
  matrixCols?: number;
  hasEmployees?: boolean;
  hasShifts?: boolean;
  hasUncertainty?: boolean;
  hasTimeSeries?: boolean;
  hasCriteria?: boolean;
  hasAlternatives?: boolean;
  integerVariables?: boolean;
  nonlinear?: boolean;
}

export interface AlgorithmSelectionInput {
  objective?: string;
  kind?: ProblemKind;
  features?: ProblemFeatures;
}

export const algorithmSelectionInputSchema = z.object({
  objective: z.string().trim().max(4000).optional(),
  kind: z.enum(PROBLEM_KINDS).optional(),
  features: z.object({
    problemType: z.enum(['prediction', 'optimization', 'planning', 'causal_analysis', 'simulation', 'formal_verification', 'decision', 'allocation', 'scheduling', 'classification']).optional(),
    requires: z.array(z.enum(['assignment', 'scheduling', 'optimization', 'simulation', 'forecasting', 'statistics', 'decision', 'summarization', 'planning', 'causal_analysis', 'formal_verification', 'reinforcement_learning', 'deep_learning', 'bayesian_inference', 'graph', 'network_flow', 'routing', 'multi_objective', 'queueing', 'scenario', 'mcts'])).max(20).optional(),
    uncertaintyLevel: z.enum(['none', 'low', 'medium', 'high']).optional(),
    constraintsCount: z.number().int().min(0).max(100_000).optional(),
    variableCount: z.number().int().min(0).max(100_000).optional(),
    dependencyCount: z.number().int().min(0).max(100_000).optional(),
    precision: z.enum(['exact', 'approximate', 'bounds']).optional(),
    timeLimitMs: z.number().int().positive().max(86_400_000).optional(),
    riskLevel: z.enum(['low', 'medium', 'high']).optional(),
    deterministic: z.boolean().optional(),
    stochastic: z.boolean().optional(),
    availableTools: z.array(z.string().min(1).max(120)).max(500).optional(),
    hasCostMatrix: z.boolean().optional(),
    hasGraph: z.boolean().optional(),
    hasNetworkFlow: z.boolean().optional(),
    hasMinCostFlow: z.boolean().optional(),
    hasBipartite: z.boolean().optional(),
    hasRouting: z.boolean().optional(),
    hasVehicles: z.boolean().optional(),
    hasPareto: z.boolean().optional(),
    hasBayes: z.boolean().optional(),
    hasQueue: z.boolean().optional(),
    hasScenarios: z.boolean().optional(),
    graphNodes: z.number().int().positive().max(2_000).optional(),
    graphEdges: z.number().int().positive().max(5_000).optional(),
    negativeWeights: z.boolean().optional(),
    matrixRows: z.number().int().positive().max(200).optional(),
    matrixCols: z.number().int().positive().max(200).optional(),
    hasEmployees: z.boolean().optional(),
    hasShifts: z.boolean().optional(),
    hasUncertainty: z.boolean().optional(),
    hasTimeSeries: z.boolean().optional(),
    hasCriteria: z.boolean().optional(),
    hasAlternatives: z.boolean().optional(),
    integerVariables: z.boolean().optional(),
    nonlinear: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export interface AlgorithmDefinition {
  id: string;
  name: string;
  version: string;
  domain: string;
  toolId: string | null;
  problemKinds: ProblemKind[];
  scientificBasis: string;
  preconditions: string[];
  failureConditions: string[];
  assumptions: string[];
  guarantee: string;
  complexity: string;
  inputs: string[];
  outputs: string[];
  verification: string[];
  limitations: string[];
  costClass: AlgorithmCost;
  deterministic: boolean;
  maturity: 'tested' | 'tested-baseline';
}

export interface AlgorithmChoice {
  algorithmId: string;
  name: string;
  domain: string;
  toolId: string | null;
  reason: string;
  suitability: number;
  rejectedBecause?: string;
  guarantee: string;
  requiredInputs: string[];
  verification: string[];
  limitations: string[];
  costClass: AlgorithmCost;
}

export interface AlgorithmSelection {
  schemaVersion: typeof ALGORITHM_SCHEMA_VERSION;
  catalogVersion: string;
  status: 'selected' | 'needs_input' | 'unsupported';
  problemKind: DetectedProblemKind;
  confidence: number;
  rationale: string[];
  missingInformation: string[];
  warnings: string[];
  assumptions: string[];
  missingInputsBlockExecution: boolean;
  primary: AlgorithmChoice | null;
  alternatives: AlgorithmChoice[];
}

const CATALOG: AlgorithmDefinition[] = [
  {
    id: 'hungarian-assignment',
    domain: 'operations_research',
    name: 'Hungarian Assignment',
    version: '1.0.0',
    toolId: 'or.assignment',
    problemKinds: ['assignment'],
    scientificBasis: 'Kuhn–Munkres Hungarian algorithm for minimum-cost bipartite matching.',
    preconditions: ["a rectangular numeric cost matrix", "finite linear costs"],
    failureConditions: ["nonlinear or side-constrained costs require MIP"],
    assumptions: ["one-to-one matching", "costs are additive"],
    guarantee: 'Optimal assignment for the supplied linear cost matrix, including rectangular matrices via dummy columns.',
    complexity: 'O(n^3) for an n×n matrix; input is capped at 200 rows.',
    inputs: ['costMatrix (rows × columns)', 'optional rowLabels', 'optional colLabels'],
    outputs: ['assignments', 'totalCost', 'dummyAssignments'],
    verification: [
      'Recompute totalCost from the returned assignments.',
      'Check that no real row or column is assigned more than once.',
      'Check the dummy count for rectangular inputs.',
    ],
    limitations: [
      'Linear additive costs only; side constraints and precedence are not represented.',
      'One-to-one matching; many-to-one allocation needs an LP/MIP formulation.',
    ],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'highs-employee-scheduling',
    domain: 'operations_research',
    name: 'Employee Shift Scheduling MIP',
    version: '1.0.0',
    toolId: 'or.employee_schedule',
    problemKinds: ['employee_scheduling'],
    scientificBasis: 'Mixed-integer linear programming solved by HiGHS branch-and-bound.',
    preconditions: ["employees with availability and cost", "shift demand"],
    failureConditions: ["infeasible or non-linear constraints are reported, not repaired"],
    assumptions: ["single-period shifts", "linear labor cost objective"],
    guarantee: 'Optimal feasible schedule for the supplied employees, shifts, availability and workload limits; infeasibility is reported explicitly.',
    complexity: 'NP-hard in general; practical runtime depends on the number of employee/shift variables.',
    inputs: ['employees with hourlyCost, availability and maxAssignments', 'shifts with demand'],
    outputs: ['assignments', 'totalCost', 'perShift demand checks', 'independent validation messages'],
    verification: [
      'Revalidate demand per shift from the returned assignments.',
      'Revalidate employee availability and maxAssignments.',
      'Recompute total labor cost from assigned hourly costs.',
    ],
    limitations: [
      'Single-period shifts; no breaks, consecutive-day rules or multi-period contracts.',
      'The objective is labor cost; fairness and preference objectives are not modeled.',
    ],
    costClass: 'medium',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'highs-lp-mip',
    domain: 'operations_research',
    name: 'HiGHS LP / MIP',
    version: '1.0.0',
    toolId: 'or.solve_lp',
    problemKinds: ['linear_programming', 'integer_programming'],
    scientificBasis: 'Linear programming and mixed-integer linear programming via the HiGHS solver.',
    preconditions: ["linear objective and constraints", "bounds/integrality"],
    failureConditions: ["non-optimal status or invalid model is rejected"],
    assumptions: ["model supplied by caller is valid", "linear relationships"],
    guarantee: 'Optimal solution when HiGHS reports Optimal; non-optimal statuses are surfaced rather than hidden.',
    complexity: 'Polynomial for LP in practice; NP-hard for integer programs.',
    inputs: ['sense', 'linear objective', 'linear constraints', 'optional integer/binary variables', 'optional bounds'],
    outputs: ['status', 'objectiveValue', 'variables', 'generated LP model'],
    verification: [
      'Require solver status Optimal before accepting the result.',
      'Check every constraint against the returned variable values within tolerance.',
      'Recompute the objective from the returned variables.',
    ],
    limitations: [
      'Linear models only; nonlinear, quadratic and logic constraints need a different formulation.',
      'A solver result is only as valid as the model supplied by the caller.',
    ],
    costClass: 'medium',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'dijkstra-a-star',
    domain: 'operations_research',
    name: 'Dijkstra / A* Shortest Path',
    version: '1.0.0',
    toolId: 'graph.shortest_path',
    problemKinds: ['shortest_path'],
    scientificBasis: 'Dijkstra label-setting on non-negative weights, with optional A* heuristic search.',
    preconditions: ['an explicit weighted graph', 'start and goal nodes', 'non-negative edge weights'],
    failureConditions: ['negative weights are rejected', 'a missing path returns no_path, not a fabricated path'],
    assumptions: ['edge weights are additive', 'the supplied graph is the intended model', 'an A* heuristic is optional'],
    guarantee: 'A minimum-cost path when Dijkstra/A* succeeds; A* is checked against an independent Dijkstra baseline before optimality is claimed.',
    complexity: 'O((V + E) log V) with a binary heap; inputs are capped at 2,000 nodes and 5,000 edges.',
    inputs: ['nodes (optional)', 'edges with from/to/weight', 'start', 'goal', 'optional directed flag and heuristic'],
    outputs: ['optimal path', 'path cost', 'expanded nodes', 'independent path/optimality verification'],
    verification: [
      'Confirm the path starts at start and ends at goal.',
      'Confirm every consecutive pair is a real edge and recompute the cost.',
      'For A*, compare the cost with an independent Dijkstra baseline.',
      'Reject negative edge weights instead of silently using a different algorithm.',
    ],
    limitations: [
      'No negative weights, time-dependent edges, multi-commodity flow or dynamic replanning.',
      'Optimality is relative to the supplied graph, not proof that the graph is correct.',
    ],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'pert-monte-carlo',
    domain: 'simulation_prediction',
    name: 'PERT Monte Carlo',
    version: '1.0.0',
    toolId: 'sim.monte_carlo',
    problemKinds: ['monte_carlo_simulation'],
    scientificBasis: 'Seeded Monte Carlo sampling from triangular PERT three-point estimates.',
    preconditions: ["three-point estimates per item", "trial count and seed"],
    failureConditions: ["invalid or oversized inputs are rejected"],
    assumptions: ["items are independent", "triangular marginals"],
    guarantee: 'Reproducible simulated distribution for the supplied independent item estimates; it is not an observed measurement.',
    complexity: 'O(trials × items); trials are capped at 100,000.',
    inputs: ['items with optimistic, likely and pessimistic values', 'trials', 'seed'],
    outputs: ['p10/p50/p90/mean', 'histogram', 'sample metadata'],
    verification: [
      'Check the requested seed and trial count are recorded.',
      'Check P10 ≤ P50 ≤ P90 and that the mean lies inside the reported range.',
      'Label every result as simulated, never observed.',
    ],
    limitations: [
      'Items are summed as independent estimates; correlations are not modeled.',
      'Triangular marginals are an assumption, not a validated distribution.',
    ],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'linear-trend-forecast',
    domain: 'simulation_prediction',
    name: 'Linear Trend Forecast with Holdout',
    version: '1.0.0',
    toolId: 'forecast.linear',
    problemKinds: ['forecasting'],
    scientificBasis: 'Ordinary least-squares linear trend with a chronological 80/20 holdout backtest.',
    preconditions: ["at least five chronological points", "forecast steps"],
    failureConditions: ["short/constant series are refused or flagged"],
    assumptions: ["linear trend continues", "no seasonality or causal claim"],
    guarantee: 'A transparent baseline forecast with R², holdout MAE and residual-standard-deviation bands; it is not a causal claim.',
    complexity: 'O(n) for fitting and prediction.',
    inputs: ['numeric series (at least 5 points recommended)', 'steps (1–90)'],
    outputs: ['forecast points', 'slope/intercept', 'R²', 'holdout MAE', 'residual bands'],
    verification: [
      'Confirm the holdout is chronological, not random.',
      'Report R² and holdout MAE alongside every forecast.',
      'Do not accept the forecast as evidence of a causal mechanism.',
    ],
    limitations: [
      'Linear trend only; seasonality, regime changes and exogenous variables are not modeled.',
      'Small or constant series are refused or produce uninformative fits.',
    ],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested-baseline',
  },
  {
    id: 'weighted-decision-matrix',
    domain: 'decision_causal',
    name: 'Weighted Decision Matrix',
    version: '1.0.0',
    toolId: 'decision.weighted_matrix',
    problemKinds: ['multi_criteria_decision'],
    scientificBasis: 'Additive multi-criteria weighted scoring with ±25% weight-perturbation robustness checks.',
    preconditions: ["criteria with positive weights", "alternatives with scores"],
    failureConditions: ["invalid weights or scores are rejected"],
    assumptions: ["weights are judgments", "additive scoring"],
    guarantee: 'Deterministic ranking for the supplied criteria, weights and scores, with an explicit robustness flag.',
    complexity: 'O(alternatives × criteria × perturbations).',
    inputs: ['criteria with positive weights', 'alternatives with scores in [0, 10]'],
    outputs: ['ranked alternatives', 'scores', 'robust winner flag', 'perturbation notes'],
    verification: [
      'Recompute each weighted score from the normalized weights.',
      'Confirm the ranking is stable under the reported ±25% perturbations or flag it.',
      'Expose that the weights are judgments, not measured facts.',
    ],
    limitations: [
      'Additive linear scoring; interactions and hard constraints are not modeled.',
      'Results depend on subjective criteria and weights.',
    ],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'descriptive-statistics',
    domain: 'mathematics',
    name: 'Descriptive Statistics',
    version: '1.0.0',
    toolId: 'stats.describe',
    problemKinds: ['descriptive_statistics'],
    scientificBasis: 'Sample mean, sample standard deviation, quartiles, IQR outlier screening and least-squares slope.',
    preconditions: ["numeric series"],
    failureConditions: ["empty or non-numeric series is rejected"],
    assumptions: ["sample is representative", "descriptive only"],
    guarantee: 'Deterministic descriptive summary of the supplied numeric series.',
    complexity: 'O(n log n) for sorting.',
    inputs: ['numeric series'],
    outputs: ['count', 'mean', 'stddev', 'quartiles', 'outliers', 'trend slope'],
    verification: [
      'Recompute count, mean and quartiles from the input series.',
      'Treat IQR outliers as screening signals, not proof of data errors.',
    ],
    limitations: [
      'Descriptive only; no hypothesis test, confidence interval or causal inference.',
      'Sensitive to the supplied sample and does not repair missing data.',
    ],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'extractive-summarization',
    domain: 'ai_cognitive',
    name: 'Frequency-Based Extractive Summary',
    version: '1.0.0',
    toolId: 'text.extract_summary',
    problemKinds: ['extractive_summarization'],
    scientificBasis: 'Deterministic term-frequency sentence scoring with original-order reconstruction.',
    preconditions: ["source text", "sentence count"],
    failureConditions: ["empty text returns an explicit error"],
    assumptions: ["source sentences are the only content", "extractive only"],
    guarantee: 'Reproducible extractive selection from the supplied text; no abstractive claims are made.',
    complexity: 'O(sentences × tokens).',
    inputs: ['text', 'sentences (requested count)'],
    outputs: ['summary', 'sentenceCount', 'method'],
    verification: [
      'Check every selected sentence exists in the source text.',
      'Preserve source order in the output.',
      'Do not treat the summary as complete semantic coverage.',
    ],
    limitations: [
      'Extractive only; no synthesis, reasoning or fact checking.',
      'Term frequency can over-select repetitive passages.',
    ],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested-baseline',
  },
  {
    id: 'dinic-max-flow',
    domain: 'operations_research',
    name: 'Dinic Maximum Flow',
    version: '1.0.0',
    toolId: 'graph.max_flow',
    problemKinds: ['max_flow'],
    scientificBasis: 'Dinic blocking-flow algorithm with a max-flow/min-cut certificate.',
    preconditions: ['directed capacitated edges', 'source and sink'],
    failureConditions: ['negative capacities are rejected', 'a disconnected network yields zero flow, not a fabricated path'],
    assumptions: ['single-commodity flow', 'capacities are finite'],
    guarantee: 'A maximum flow with a min-cut whose capacity equals the flow value.',
    complexity: 'O(V²E) worst case; inputs capped at 2,000 nodes and 5,000 edges.',
    inputs: ['edges with from/to/capacity', 'source', 'sink'],
    outputs: ['maxFlow', 'edge flows', 'min-cut partition and capacity', 'verification'],
    verification: ['flow conservation', 'capacity bounds', 'source outflow equals max flow', 'min-cut equality'],
    limitations: ['No lower bounds, gains, multi-commodity or dynamic flow.'],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'successive-shortest-path-min-cost-flow',
    domain: 'operations_research',
    name: 'Min-Cost Flow (Successive Shortest Paths)',
    version: '1.0.0',
    toolId: 'graph.min_cost_flow',
    problemKinds: ['min_cost_flow'],
    scientificBasis: 'Successive shortest augmenting paths on the residual network with negative-cycle optimality checks.',
    preconditions: ['capacitated edges with linear costs', 'source', 'sink', 'exact demand'],
    failureConditions: ['demand above max flow is infeasible', 'negative residual cycles invalidate optimality'],
    assumptions: ['linear additive edge costs', 'single commodity'],
    guarantee: 'Minimum-cost flow of exactly the requested demand when a feasible residual optimum exists.',
    complexity: 'Depends on augmentations and shortest-path search; inputs capped at 2,000 nodes and 5,000 edges.',
    inputs: ['edges with capacity and cost', 'source', 'sink', 'demand'],
    outputs: ['delivered flow', 'total cost', 'edge flows', 'verification'],
    verification: ['exact demand', 'conservation and capacity', 'cost recomputation', 'residual no-negative-cycle'],
    limitations: ['No general min-cost circulation with lower bounds or gains.'],
    costClass: 'medium',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'bipartite-matching',
    domain: 'operations_research',
    name: 'Maximum Bipartite Matching',
    version: '1.0.0',
    toolId: 'graph.bipartite_matching',
    problemKinds: ['bipartite_matching'],
    scientificBasis: 'Kuhn augmenting-path matching with an independent augmenting-path maximality check.',
    preconditions: ['left and right node sets', 'allowed edges'],
    failureConditions: ['invalid edge references are ignored; unmatched nodes are reported'],
    assumptions: ['unweighted one-to-one matching'],
    guarantee: 'A maximum-cardinality matching with no augmenting path remaining.',
    complexity: 'O(VE) for the augmenting-path implementation.',
    inputs: ['left nodes', 'right nodes', 'edges'],
    outputs: ['matching', 'size', 'unmatched nodes', 'verification'],
    verification: ['real edges used once', 'size consistency', 'no augmenting path'],
    limitations: ['No costs, capacities or many-to-one matching.'],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'tsp-held-karp',
    domain: 'operations_research',
    name: 'TSP (Held-Karp / 2-opt)',
    version: '1.0.0',
    toolId: 'routing.tsp',
    problemKinds: ['tsp'],
    scientificBasis: 'Held-Karp dynamic programming for exact small instances; nearest-neighbour + 2-opt for larger ones.',
    preconditions: ['points or a square distance matrix', 'optional start'],
    failureConditions: ['invalid distances are rejected', 'large instances are heuristic, not optimal'],
    assumptions: ['symmetric distances for 2-opt', 'exact DP limited by exactLimit'],
    guarantee: 'Exact optimal tour at or below exactLimit; an explicit approximate tour above it.',
    complexity: 'O(2ⁿn²) exact; heuristic is polynomial per 2-opt pass.',
    inputs: ['points or distance matrix', 'start', 'exactLimit'],
    outputs: ['tour', 'cost', 'method', 'status', 'MST lower bound', 'verification'],
    verification: ['permutation visits every node once', 'cost recomputed', 'brute-force check for n≤8', 'heuristic labelled approximate'],
    limitations: ['No time windows, precedence or asymmetric large-instance guarantees.'],
    costClass: 'medium',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'cvrp-clarke-wright',
    domain: 'operations_research',
    name: 'Multi-Depot CVRP (Clarke–Wright)',
    version: '1.0.0',
    toolId: 'routing.vrp',
    problemKinds: ['vrp'],
    scientificBasis: 'Clarke–Wright savings with nearest-depot assignment and capacity checks.',
    preconditions: ['depots', 'customers with demand', 'vehicles with capacity'],
    failureConditions: ['demand above every capacity or too few vehicles is infeasible'],
    assumptions: ['Euclidean distances', 'heuristic routing'],
    guarantee: 'A capacity-feasible route set when one is found; no global optimality claim.',
    complexity: 'Polynomial savings construction plus route merges.',
    inputs: ['depots', 'customers with demand', 'vehicles with capacity'],
    outputs: ['routes', 'loads', 'total distance', 'status', 'verification'],
    verification: ['customer coverage', 'capacity', 'distance recomputation', 'approximation label'],
    limitations: ['No time windows, pickups/deliveries or jointly optimized depot assignment.'],
    costClass: 'medium',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'pareto-frontier',
    domain: 'decision_causal',
    name: 'Pareto Multi-Objective Analysis',
    version: '1.0.0',
    toolId: 'decision.pareto',
    problemKinds: ['pareto_multi_objective'],
    scientificBasis: 'Pairwise Pareto dominance over an explicit candidate set with weighted ranking and weight perturbation.',
    preconditions: ['at least two objectives', 'at least two candidates with complete values'],
    failureConditions: ['missing values or duplicate names are rejected'],
    assumptions: ['the candidate set is the decision space', 'weights are judgments'],
    guarantee: 'The exact Pareto frontier for the supplied candidate set.',
    complexity: 'O(candidates² × objectives).',
    inputs: ['objectives with directions', 'candidate values', 'optional weights'],
    outputs: ['frontier', 'dominated candidates', 'ranking', 'trade-offs', 'sensitivity', 'verification'],
    verification: ['frontier completeness', 'non-dominance', 'ranking recomputation', 'value consistency'],
    limitations: ['No continuous frontier generation; exact only for supplied candidates.'],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'bayes-conjugate',
    domain: 'decision_causal',
    name: 'Conjugate Bayesian Update',
    version: '1.0.0',
    toolId: 'stats.bayes_update',
    problemKinds: ['bayesian_inference'],
    scientificBasis: 'Beta–Binomial and Normal–Normal conjugate posterior updating with credible intervals.',
    preconditions: ['valid prior', 'observations or successes/trials'],
    failureConditions: ['invalid priors or data are rejected'],
    assumptions: ['declared likelihood and prior are the intended model', 'exchangeable observations'],
    guarantee: 'Exact conjugate posterior parameters and model-conditional credible intervals.',
    complexity: 'O(1) for Beta–Binomial; O(n) for Normal–Normal.',
    inputs: ['prior parameters', 'successes/trials or observations', 'credible level', 'optional alternative priors'],
    outputs: ['posterior parameters', 'credible interval', 'posterior predictive', 'prior sensitivity', 'verification'],
    verification: ['posterior formulas', 'interval contains mean', 'P(theta>0.5) recomputation', 'sensitivity disclosure'],
    limitations: ['Conjugate models only; no MCMC, Bayesian networks or causal identification.'],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'discrete-event-queue',
    domain: 'simulation_prediction',
    name: 'Discrete-Event FCFS Queue',
    version: '1.0.0',
    toolId: 'sim.queue',
    problemKinds: ['queue_simulation'],
    scientificBasis: 'Seeded discrete-event simulation of a multi-server FCFS queue with exponential interarrival and service times.',
    preconditions: ['customers', 'positive means', 'servers', 'seed'],
    failureConditions: ['invalid means or server counts are rejected'],
    assumptions: ['exponential distributions', 'FCFS', 'no balking or reneging'],
    guarantee: 'A reproducible simulated wait/utilization/makespan record; not an observed measurement.',
    complexity: 'O(customers × servers).',
    inputs: ['customers', 'interarrivalMean', 'serviceMean', 'servers', 'seed'],
    outputs: ['mean/p90/max wait', 'utilization', 'makespan', 'served count', 'verification'],
    verification: ['all customers served', 'non-negative waits', 'utilization bounds', 'seed recorded'],
    limitations: ['No priorities, warm-up removal or non-exponential service distributions.'],
    costClass: 'low',
    deterministic: true,
    maturity: 'tested',
  },
  {
    id: 'scenario-comparison',
    domain: 'simulation_prediction',
    name: 'Seeded Scenario Comparison',
    version: '1.0.0',
    toolId: 'sim.scenario_compare',
    problemKinds: ['scenario_comparison'],
    scientificBasis: 'Same-seed PERT simulation across explicit scenarios with baseline deltas and reproducibility checks.',
    preconditions: ['at least two scenarios with PERT items', 'trials', 'seed'],
    failureConditions: ['invalid scenarios are rejected'],
    assumptions: ['scenarios are independent PERT models', 'the first scenario is the baseline'],
    guarantee: 'Reproducible scenario distributions and deltas; not a causal forecast.',
    complexity: 'O(scenarios × trials × items).',
    inputs: ['scenarios', 'trials', 'seed'],
    outputs: ['scenario distributions', 'baseline deltas', 'ranking', 'verification'],
    verification: ['quantile ordering', 'delta recomputation', 'same-seed reproducibility', 'simulated labels'],
    limitations: ['No cross-scenario correlation or single-run guarantee.'],
    costClass: 'medium',
    deterministic: true,
    maturity: 'tested',
  },

];

const byId = new Map(CATALOG.map((entry) => [entry.id, entry]));

export function listAlgorithms(): AlgorithmDefinition[] {
  return CATALOG.map((entry) => ({
    ...entry,
    problemKinds: [...entry.problemKinds],
    inputs: [...entry.inputs],
    outputs: [...entry.outputs],
    verification: [...entry.verification],
    limitations: [...entry.limitations],
  }));
}

export function getAlgorithm(id: string): AlgorithmDefinition | null {
  return byId.get(id) ?? null;
}

const textOf = (input: AlgorithmSelectionInput): string => (input.objective ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function explicitKind(input: AlgorithmSelectionInput): ProblemKind | null {
  return input.kind && PROBLEM_KINDS.includes(input.kind) ? input.kind : null;
}

function structuredProblem(input: AlgorithmSelectionInput): {
  kind: DetectedProblemKind; confidence: number; rationale: string[]; warnings: string[]; unsupported?: string;
} | null {
  const f = input.features ?? {};
  const unsupported = (label: string): { kind: DetectedProblemKind; confidence: number; rationale: string[]; warnings: string[]; unsupported: string } => ({
    kind: 'unknown', confidence: 0.9,
    rationale: [`Structured requirement: ${label}.`],
    warnings: [`No implemented WORA method covers ${label}; do not substitute an unrelated method without documenting the approximation.`],
    unsupported: label,
  });
  const requires = new Set(f.requires ?? []);
  if (f.negativeWeights === true) return unsupported('negative-weight shortest paths');
  const unsupportedRequirement = [...requires].find((requirement) =>
    ['causal_analysis', 'formal_verification', 'reinforcement_learning', 'deep_learning', 'mcts', 'planning'].includes(requirement));
  if (unsupportedRequirement) {
    const labels: Record<string, string> = {
      causal_analysis: 'causal inference', formal_verification: 'formal verification/model checking',
      reinforcement_learning: 'reinforcement learning', deep_learning: 'deep learning',
      bayesian_inference: 'Bayesian inference', mcts: 'Monte Carlo Tree Search', planning: 'automated planning/search',
    };
    return unsupported(labels[unsupportedRequirement] ?? unsupportedRequirement.replaceAll('_', ' '));
  }
  if (f.problemType === 'planning') return unsupported('automated planning/search');
  if (f.problemType === 'causal_analysis') return unsupported('causal inference');
  if (f.problemType === 'formal_verification') return unsupported('formal model checking');
  if (f.problemType === 'classification') return unsupported('classification/learning');

  const choose = (kind: ProblemKind, label: string) => ({
    kind, confidence: 0.9, rationale: [`Structured feature: ${label}.`], warnings: [],
  });
  if (f.hasNetworkFlow === true || requires.has('network_flow')) return choose(f.hasMinCostFlow === true ? 'min_cost_flow' : 'max_flow', 'capacitated network flow');
  if (f.hasBipartite === true) return choose('bipartite_matching', 'bipartite graph');
  if (f.hasRouting === true || requires.has('routing')) return choose(f.hasVehicles === true ? 'vrp' : 'tsp', 'routing problem');
  if (f.hasPareto === true || requires.has('multi_objective')) return choose('pareto_multi_objective', 'multiple competing objectives');
  if (f.hasBayes === true || requires.has('bayesian_inference')) return choose('bayesian_inference', 'Bayesian uncertainty');
  if (f.hasQueue === true || requires.has('queueing')) return choose('queue_simulation', 'queueing system');
  if (f.hasScenarios === true || requires.has('scenario')) return choose('scenario_comparison', 'scenario comparison');
  if (f.hasGraph === true || requires.has('graph')) return choose('shortest_path', 'explicit weighted graph');
  if (f.problemType === 'scheduling') return choose('employee_scheduling', 'scheduling');
  if (f.problemType === 'optimization' || f.problemType === 'allocation') {
    if (f.hasEmployees === true || f.hasShifts === true) return choose('employee_scheduling', 'scheduling constraints');
    if (f.hasCostMatrix === true) return choose('assignment', 'cost matrix');
    if (f.integerVariables === true) return choose('integer_programming', 'integer variables');
    return choose('linear_programming', 'linear optimization');
  }
  if (f.problemType === 'simulation') return choose('monte_carlo_simulation', 'simulation or stochastic uncertainty');
  if (f.problemType === 'prediction') return choose('forecasting', 'forecasting/prediction');
  if (f.problemType === 'decision') return choose('multi_criteria_decision', 'multi-criteria decision');
  if (requires.has('simulation')) return choose('monte_carlo_simulation', 'simulation or stochastic uncertainty');
  if (requires.has('forecasting')) return choose('forecasting', 'forecasting/prediction');
  if (requires.has('statistics')) return choose('descriptive_statistics', 'descriptive statistics');
  if (requires.has('decision')) return choose('multi_criteria_decision', 'multi-criteria decision');
  if (requires.has('summarization')) return choose('extractive_summarization', 'extractive summarization');
  if (requires.has('assignment')) return choose('assignment', 'assignment');
  if (requires.has('scheduling')) return choose('employee_scheduling', 'scheduling');
  if (requires.has('optimization')) {
    if (f.hasEmployees === true || f.hasShifts === true) return choose('employee_scheduling', 'scheduling constraints');
    if (f.hasCostMatrix === true) return choose('assignment', 'cost matrix');
    if (f.integerVariables === true) return choose('integer_programming', 'integer variables');
    return choose('linear_programming', 'linear optimization');
  }
  return null;
}

function detectProblem(input: AlgorithmSelectionInput): {
  kind: DetectedProblemKind;
  confidence: number;
  rationale: string[];
  warnings: string[];
  unsupported?: string;
} {
  const f = input.features ?? {};
  if (f.nonlinear === true) {
    return {
      kind: 'unknown',
      confidence: 0.95,
      rationale: ['Structured feature "nonlinear" is set.'],
      warnings: ['No nonlinear solver is implemented in WORA; do not substitute a linear model without documenting the approximation.'],
      unsupported: 'nonlinear optimization',
    };
  }

  const explicit = explicitKind(input);
  if (explicit) {
    return { kind: explicit, confidence: 1, rationale: [`Explicit problem kind: ${explicit}.`], warnings: [] };
  }
  const structured = structuredProblem(input);
  if (structured) return structured;
  const feature = (kind: ProblemKind, label: string) => ({
    kind, confidence: 0.9, rationale: [`Structured feature: ${label}.`], warnings: [],
  });
  if (f.hasNetworkFlow === true) return feature(f.hasMinCostFlow === true ? 'min_cost_flow' : 'max_flow', 'capacitated network flow');
  if (f.hasBipartite === true) return feature('bipartite_matching', 'bipartite graph');
  if (f.hasRouting === true) return feature(f.hasVehicles === true ? 'vrp' : 'tsp', 'routing problem');
  if (f.hasPareto === true) return feature('pareto_multi_objective', 'multiple competing objectives');
  if (f.hasBayes === true) return feature('bayesian_inference', 'Bayesian uncertainty');
  if (f.hasQueue === true) return feature('queue_simulation', 'queueing system');
  if (f.hasScenarios === true) return feature('scenario_comparison', 'scenario comparison');
  if (f.hasGraph === true) return feature('shortest_path', 'explicit weighted graph');
  if (f.hasEmployees === true || f.hasShifts === true) return feature('employee_scheduling', 'employees/shifts present');
  if (f.hasCostMatrix === true || (f.matrixRows !== undefined && f.matrixCols !== undefined)) return feature('assignment', 'cost matrix dimensions present');
  if (f.integerVariables === true) return feature('integer_programming', 'integer variables present');
  if (f.hasUncertainty === true) return feature('monte_carlo_simulation', 'uncertainty present');
  if (f.hasTimeSeries === true) return feature('forecasting', 'time series present');
  if (f.hasCriteria === true || f.hasAlternatives === true) return feature('multi_criteria_decision', 'criteria/alternatives present');

  const text = textOf(input);
  const keyword = (kind: ProblemKind, label: string, pattern: RegExp) => pattern.test(text)
    ? { kind, confidence: 0.65, rationale: [`Objective text mentions ${label}.`], warnings: ['Classification is keyword-based; supply structured features or an explicit kind for higher confidence.'] }
    : null;
  const detected =
    keyword('max_flow', 'maximum flow', /max(?:imum)?\s*flow|min[ -]?cut|شبكة\s*تدفق|أقصى\s*تدفق/u) ??
    keyword('min_cost_flow', 'minimum cost flow', /min(?:imum)?\s*cost\s*flow|cost[ -]?flow|تدفق\s*بأقل\s*تكلفة/u) ??
    keyword('bipartite_matching', 'bipartite matching', /bipartite|maximum\s*matching|مطابقة\s*ثنائية/u) ??
    keyword('tsp', 'traveling salesperson', /travel(?:l)?ing\s+sales(?:person|man)|tsp\b|جولة\s*البائع/u) ??
    keyword('vrp', 'vehicle routing', /vehicle\s+routing|vrp\b|capacitated\s+routing|توجيه\s*المركبات/u) ??
    keyword('pareto_multi_objective', 'Pareto multi-objective', /pareto|multi[ -]?objective|trade[ -]?off\s*front|باريتو|أهداف\s*متعددة/u) ??
    keyword('bayesian_inference', 'Bayesian inference', /bayes|posterior|prior\s*update|بايز|تحديث\s*بعدي/u) ??
    keyword('queue_simulation', 'queue simulation', /queue|waiting\s*line|servers?\b|طابور|صف\s*انتظار/u) ??
    keyword('scenario_comparison', 'scenario comparison', /scenario\s+compar|compare\s+scenarios|مقارنة\s*السيناريوهات/u) ??
    keyword('shortest_path', 'shortest path or graph routing', /shortest\s*path|dijkstra|a\*|graph\s+(?:route|path|network)|network\s+path|route\s+optim|أقصر\s+مسار|مسار\s+الشبكة/u) ??
    keyword('employee_scheduling', 'employees, shifts or scheduling', /employee|shift|staff|workforce|roster|schedule|وردية|موظف|جدول/u) ??
    keyword('assignment', 'assignment or matching', /cost matrix|assignment|matching|assign .* (task|job|worker)|توزيع|مطابقة/u) ??
    keyword('monte_carlo_simulation', 'simulation, risk or uncertainty', /monte carlo|simulat|scenario|risk|uncertainty|محاكاة/u) ??
    keyword('forecasting', 'forecasting or time series', /forecast|trend|time series|demand|تنبؤ/u) ??
    keyword('multi_criteria_decision', 'weighted criteria or alternatives', /decision|criteria|alternative|vendor|weighted matrix|قرار/u) ??
    keyword('extractive_summarization', 'summarization', /summary|summarize|extract|ملخص/u) ??
    keyword('descriptive_statistics', 'descriptive statistics', /statistics|distribution|outlier|describe|إحصاء/u) ??
    keyword('integer_programming', 'integer optimization', /integer program|mixed-integer|mip|برمجة صحيحة/u) ??
    keyword('linear_programming', 'linear optimization', /linear program|optimization|optimize|constraint|تحسين/u);
  if (detected) return detected;

  return {
    kind: 'unknown',
    confidence: 0,
    rationale: ['No explicit kind, structured feature or supported keyword was found.'],
    warnings: ['No algorithm was selected. Provide a problem kind, structured features, or a clearer objective.'],
  };
}

function missingInformation(kind: DetectedProblemKind, features: ProblemFeatures): string[] {
  switch (kind) {
    case 'shortest_path':
      return ['weighted edges', 'start node', 'goal node'];
    case 'assignment':
      return features.hasCostMatrix || (features.matrixRows !== undefined && features.matrixCols !== undefined)
        ? []
        : ['costMatrix with numeric rows and columns'];
    case 'employee_scheduling': {
      const missing: string[] = [];
      if (features.hasEmployees !== true) missing.push('employees with hourlyCost, availability and maxAssignments');
      if (features.hasShifts !== true) missing.push('shifts with demand');
      return missing;
    }
    case 'linear_programming':
    case 'integer_programming':
      return ['linear objective', 'linear constraints', 'variable bounds/integrality'];
    case 'monte_carlo_simulation':
      return ['items with optimistic, likely and pessimistic estimates'];
    case 'forecasting':
      return ['numeric time series with chronological order'];
    case 'multi_criteria_decision':
      return ['criteria with positive weights', 'alternatives with scores'];
    case 'max_flow':
      return ['capacitated edges', 'source', 'sink'];
    case 'min_cost_flow':
      return ['capacitated edges with costs', 'source', 'sink', 'demand'];
    case 'bipartite_matching':
      return ['left nodes', 'right nodes', 'allowed edges'];
    case 'tsp':
      return ['points or a square distance matrix'];
    case 'vrp':
      return ['depots', 'customers with demand', 'vehicles with capacity'];
    case 'pareto_multi_objective':
      return ['at least two objectives', 'candidate solutions with values'];
    case 'bayesian_inference':
      return ['prior parameters', 'observations or successes/trials'];
    case 'queue_simulation':
      return ['customers', 'interarrival mean', 'service mean', 'servers', 'seed'];
    case 'scenario_comparison':
      return ['at least two scenarios with PERT items'];
    case 'descriptive_statistics':
      return ['numeric series'];
    case 'extractive_summarization':
      return ['source text'];
    default:
      return ['a supported problem class or structured features'];
  }
}

function choiceFor(algorithmId: string, reason: string, suitability = 0.9): AlgorithmChoice | null {
  const entry = byId.get(algorithmId);
  if (!entry) return null;
  return {
    algorithmId: entry.id,
    name: entry.name,
    domain: entry.domain,
    toolId: entry.toolId,
    reason,
    suitability,
    guarantee: entry.guarantee,
    requiredInputs: [...entry.inputs],
    verification: [...entry.verification],
    limitations: [...entry.limitations],
    costClass: entry.costClass,
  };
}

function primaryFor(kind: ProblemKind, detectedBy: string): AlgorithmChoice | null {
  const map: Record<ProblemKind, string> = {
    assignment: 'hungarian-assignment',
    shortest_path: 'dijkstra-a-star',
    employee_scheduling: 'highs-employee-scheduling',
    linear_programming: 'highs-lp-mip',
    integer_programming: 'highs-lp-mip',
    monte_carlo_simulation: 'pert-monte-carlo',
    forecasting: 'linear-trend-forecast',
    multi_criteria_decision: 'weighted-decision-matrix',
    max_flow: 'dinic-max-flow',
    min_cost_flow: 'successive-shortest-path-min-cost-flow',
    bipartite_matching: 'bipartite-matching',
    tsp: 'tsp-held-karp',
    vrp: 'cvrp-clarke-wright',
    pareto_multi_objective: 'pareto-frontier',
    bayesian_inference: 'bayes-conjugate',
    queue_simulation: 'discrete-event-queue',
    scenario_comparison: 'scenario-comparison',
    extractive_summarization: 'extractive-summarization',
    descriptive_statistics: 'descriptive-statistics',
  };
  return choiceFor(map[kind], `${detectedBy} The selected method matches the ${kind.replaceAll('_', ' ')} problem class.`);
}

function alternativesFor(kind: ProblemKind): AlgorithmChoice[] {
  if (kind === 'assignment') {
    const fallback = choiceFor('highs-lp-mip', 'Use a binary LP/MIP formulation when the assignment has side constraints, precedence or many-to-one allocation.', 0.65);
    return fallback ? [fallback] : [];
  }
  if (kind === 'employee_scheduling') {
    const fallback = choiceFor('highs-lp-mip', 'Use a general MIP when the schedule needs additional side constraints beyond the built-in employee/shift model.', 0.65);
    return fallback ? [fallback] : [];
  }
  return [];
}

export function selectAlgorithm(input: AlgorithmSelectionInput): AlgorithmSelection {
  const detected = detectProblem(input);
  const features = input.features ?? {};
  if (detected.unsupported) {
    return {
      schemaVersion: ALGORITHM_SCHEMA_VERSION,
      catalogVersion: ALGORITHM_CATALOG_VERSION,
      status: 'unsupported',
      problemKind: detected.kind,
      confidence: detected.confidence,
      rationale: detected.rationale,
      missingInformation: [],
      warnings: detected.warnings,
      assumptions: ['The stated problem class has no tested implementation in the current catalog.'],
      missingInputsBlockExecution: true,
      primary: null,
      alternatives: [],
    };
  }
  if (detected.kind === 'unknown') {
    return {
      schemaVersion: ALGORITHM_SCHEMA_VERSION,
      catalogVersion: ALGORITHM_CATALOG_VERSION,
      status: 'needs_input',
      problemKind: 'unknown',
      confidence: detected.confidence,
      rationale: detected.rationale,
      missingInformation: missingInformation('unknown', features),
      warnings: detected.warnings,
      assumptions: ['The stated problem class has no tested implementation in the current catalog.'],
      missingInputsBlockExecution: true,
      primary: null,
      alternatives: [],
    };
  }

  const primary = primaryFor(detected.kind, detected.rationale[0] ?? 'Detected problem class.');
  const missing = missingInformation(detected.kind, features);
  const warnings = [...detected.warnings];
  if (missing.length) warnings.push('The selected algorithm cannot run until the missing inputs are supplied.');
  if (primary?.toolId && features.availableTools && !features.availableTools.includes(primary.toolId)) {
    return {
      schemaVersion: ALGORITHM_SCHEMA_VERSION,
      catalogVersion: ALGORITHM_CATALOG_VERSION,
      status: 'unsupported',
      problemKind: detected.kind,
      confidence: detected.confidence,
      rationale: detected.rationale,
      missingInformation: missing,
      warnings: [...warnings, `The matching tool ${primary.toolId} is not available in the current authorized tool set.`],
      assumptions: ['No substitute tool is assumed; a missing authorized tool is an explicit capability gap.'],
      missingInputsBlockExecution: true,
      primary: null,
      alternatives: [],
    };
  }
  if (features.timeLimitMs !== undefined && features.timeLimitMs < 1_000) warnings.push('The requested time limit is very small; solver or tool timeout may be exceeded.');
  if (features.precision === 'exact' && detected.kind === 'forecasting') warnings.push('The implemented forecast is a linear baseline, not an exact predictor.');
  if (features.riskLevel === 'high') warnings.push('A high-risk action may require class C approval before execution.');
  if (features.stochastic === true && detected.kind !== 'monte_carlo_simulation') warnings.push('Stochastic input is present; the selected method may use expected values unless simulation is selected explicitly.');
  return {
    schemaVersion: ALGORITHM_SCHEMA_VERSION,
    catalogVersion: ALGORITHM_CATALOG_VERSION,
    status: 'selected',
    problemKind: detected.kind,
    confidence: detected.confidence,
    rationale: detected.rationale,
    missingInformation: missing,
    warnings,
    assumptions: [
      'The selected method is implemented and tested in the current repository.',
      ...(features.precision === 'exact' && detected.kind === 'forecasting' ? ['The linear forecast is a baseline; exact prediction is not claimed.'] : []),
      ...(features.riskLevel === 'high' ? ['The action may require class C approval before execution.'] : []),
    ],
    missingInputsBlockExecution: missing.length > 0,
    primary,
    alternatives: alternativesFor(detected.kind),
  };
}
