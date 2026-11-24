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
export const ALGORITHM_CATALOG_VERSION = '2026-11-24.1';

export const PROBLEM_KINDS = [
  'assignment',
  'employee_scheduling',
  'linear_programming',
  'integer_programming',
  'monte_carlo_simulation',
  'forecasting',
  'multi_criteria_decision',
  'extractive_summarization',
  'descriptive_statistics',
] as const;

export type ProblemKind = (typeof PROBLEM_KINDS)[number];
export type DetectedProblemKind = ProblemKind | 'unknown';
export type AlgorithmCost = 'low' | 'medium' | 'high';

export interface ProblemFeatures {
  hasCostMatrix?: boolean;
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

export interface AlgorithmDefinition {
  id: string;
  name: string;
  version: string;
  toolId: string | null;
  problemKinds: ProblemKind[];
  scientificBasis: string;
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
  toolId: string | null;
  reason: string;
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
  primary: AlgorithmChoice | null;
  alternatives: AlgorithmChoice[];
}

const CATALOG: AlgorithmDefinition[] = [
  {
    id: 'hungarian-assignment',
    name: 'Hungarian Assignment',
    version: '1.0.0',
    toolId: 'or.assignment',
    problemKinds: ['assignment'],
    scientificBasis: 'Kuhn–Munkres Hungarian algorithm for minimum-cost bipartite matching.',
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
    name: 'Employee Shift Scheduling MIP',
    version: '1.0.0',
    toolId: 'or.employee_schedule',
    problemKinds: ['employee_scheduling'],
    scientificBasis: 'Mixed-integer linear programming solved by HiGHS branch-and-bound.',
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
    name: 'HiGHS LP / MIP',
    version: '1.0.0',
    toolId: 'or.solve_lp',
    problemKinds: ['linear_programming', 'integer_programming'],
    scientificBasis: 'Linear programming and mixed-integer linear programming via the HiGHS solver.',
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
    id: 'pert-monte-carlo',
    name: 'PERT Monte Carlo',
    version: '1.0.0',
    toolId: 'sim.monte_carlo',
    problemKinds: ['monte_carlo_simulation'],
    scientificBasis: 'Seeded Monte Carlo sampling from triangular PERT three-point estimates.',
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
    name: 'Linear Trend Forecast with Holdout',
    version: '1.0.0',
    toolId: 'forecast.linear',
    problemKinds: ['forecasting'],
    scientificBasis: 'Ordinary least-squares linear trend with a chronological 80/20 holdout backtest.',
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
    name: 'Weighted Decision Matrix',
    version: '1.0.0',
    toolId: 'decision.weighted_matrix',
    problemKinds: ['multi_criteria_decision'],
    scientificBasis: 'Additive multi-criteria weighted scoring with ±25% weight-perturbation robustness checks.',
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
    name: 'Descriptive Statistics',
    version: '1.0.0',
    toolId: 'stats.describe',
    problemKinds: ['descriptive_statistics'],
    scientificBasis: 'Sample mean, sample standard deviation, quartiles, IQR outlier screening and least-squares slope.',
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
    name: 'Frequency-Based Extractive Summary',
    version: '1.0.0',
    toolId: 'text.extract_summary',
    problemKinds: ['extractive_summarization'],
    scientificBasis: 'Deterministic term-frequency sentence scoring with original-order reconstruction.',
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
  const feature = (kind: ProblemKind, label: string) => ({
    kind, confidence: 0.9, rationale: [`Structured feature: ${label}.`], warnings: [],
  });
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
    case 'descriptive_statistics':
      return ['numeric series'];
    case 'extractive_summarization':
      return ['source text'];
    default:
      return ['a supported problem class or structured features'];
  }
}

function choiceFor(algorithmId: string, reason: string): AlgorithmChoice | null {
  const entry = byId.get(algorithmId);
  if (!entry) return null;
  return {
    algorithmId: entry.id,
    name: entry.name,
    toolId: entry.toolId,
    reason,
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
    employee_scheduling: 'highs-employee-scheduling',
    linear_programming: 'highs-lp-mip',
    integer_programming: 'highs-lp-mip',
    monte_carlo_simulation: 'pert-monte-carlo',
    forecasting: 'linear-trend-forecast',
    multi_criteria_decision: 'weighted-decision-matrix',
    extractive_summarization: 'extractive-summarization',
    descriptive_statistics: 'descriptive-statistics',
  };
  return choiceFor(map[kind], `${detectedBy} The selected method matches the ${kind.replaceAll('_', ' ')} problem class.`);
}

function alternativesFor(kind: ProblemKind): AlgorithmChoice[] {
  if (kind === 'assignment') {
    const fallback = choiceFor('highs-lp-mip', 'Use a binary LP/MIP formulation when the assignment has side constraints, precedence or many-to-one allocation.');
    return fallback ? [fallback] : [];
  }
  if (kind === 'employee_scheduling') {
    const fallback = choiceFor('highs-lp-mip', 'Use a general MIP when the schedule needs additional side constraints beyond the built-in employee/shift model.');
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
      primary: null,
      alternatives: [],
    };
  }

  const primary = primaryFor(detected.kind, detected.rationale[0] ?? 'Detected problem class.');
  const missing = missingInformation(detected.kind, features);
  const warnings = [...detected.warnings];
  if (missing.length) warnings.push('The selected algorithm cannot run until the missing inputs are supplied.');
  return {
    schemaVersion: ALGORITHM_SCHEMA_VERSION,
    catalogVersion: ALGORITHM_CATALOG_VERSION,
    status: 'selected',
    problemKind: detected.kind,
    confidence: detected.confidence,
    rationale: detected.rationale,
    missingInformation: missing,
    warnings,
    primary,
    alternatives: alternativesFor(detected.kind),
  };
}
