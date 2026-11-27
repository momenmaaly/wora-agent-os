/**
 * WORA OS — explicit scientific problem formulation.
 *
 * Formulation is a separate, inspectable step before execution. It names the
 * decision variables, data, objective, constraints, assumptions, solver,
 * expected outputs and verification criteria. It never fills missing numeric
 * values with samples; incomplete input stays a blocking gap.
 */
import { createHash } from 'node:crypto';
import type { GraphModel } from './graph.js';
import type { LpModel, ScheduleInput } from './ortools.js';

export const FORMULATION_SCHEMA_VERSION = '1.0';

export const FORMULATION_KINDS = [
  'linear_programming', 'integer_programming', 'shortest_path', 'assignment', 'employee_scheduling',
  'monte_carlo_simulation', 'forecasting', 'multi_criteria_decision', 'max_flow', 'min_cost_flow',
  'bipartite_matching', 'tsp', 'vrp', 'pareto_multi_objective', 'bayesian_inference',
  'queue_simulation', 'scenario_comparison',
] as const;

export type FormulationKind = (typeof FORMULATION_KINDS)[number];

export interface ScientificFormulation {
  schemaVersion: typeof FORMULATION_SCHEMA_VERSION;
  kind: FormulationKind;
  problemClass: string;
  decisionVariables: string[];
  inputData: string[];
  objective: string;
  constraints: string[];
  assumptions: string[];
  feasibilityConditions: string[];
  uncertainty: string;
  solver: string;
  expectedOutputs: string[];
  verification: string[];
  missingInputs: string[];
  executable: boolean;
  model: unknown;
  digest: string;
  limitations: string[];
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function base(kind: FormulationKind): ScientificFormulation {
  return {
    schemaVersion: FORMULATION_SCHEMA_VERSION, kind, problemClass: kind.replaceAll('_', ' '), decisionVariables: [], inputData: [],
    objective: '', constraints: [], assumptions: [], feasibilityConditions: [], uncertainty: 'none', solver: '',
    expectedOutputs: [], verification: [], missingInputs: [], executable: false, model: null, digest: '', limitations: [],
  };
}

function finish(formulation: ScientificFormulation, model: unknown): ScientificFormulation {
  formulation.executable = formulation.missingInputs.length === 0 && model !== null;
  formulation.model = model;
  formulation.digest = digest({ kind: formulation.kind, model, missingInputs: formulation.missingInputs });
  return formulation;
}

function normalizeLp(raw: unknown, integer: boolean): { model: LpModel | null; missing: string[]; errors: string[] } {
  if (!isRecord(raw)) return { model: null, missing: ['linear objective', 'linear constraints', 'variable bounds/integrality'], errors: ['model is missing'] };
  const errors: string[] = [];
  const sense = raw['sense'];
  if (sense !== 'minimize' && sense !== 'maximize') errors.push('sense must be minimize or maximize');
  const objective = Array.isArray(raw['objective']) ? raw['objective'] : [];
  if (!objective.length) errors.push('objective terms are required');
  const constraints = Array.isArray(raw['constraints']) ? raw['constraints'] : [];
  if (!constraints.length) errors.push('at least one constraint is required');
  const termsOk = (terms: unknown): boolean => Array.isArray(terms) && terms.length > 0 && terms.every((term) =>
    isRecord(term) && typeof term['var'] === 'string' && term['var'].trim().length > 0 && finite(term['coeff']));
  if (!termsOk(objective)) errors.push('every objective term needs a variable and a finite coefficient');
  for (const [index, constraint] of constraints.entries()) {
    if (!isRecord(constraint)) { errors.push(`constraint ${index + 1} is not an object`); continue; }
    if (!termsOk(constraint['terms'])) errors.push(`constraint ${index + 1} has invalid terms`);
    if (!['<=', '>=', '='].includes(String(constraint['op']))) errors.push(`constraint ${index + 1} has an invalid operator`);
    if (!finite(constraint['rhs'])) errors.push(`constraint ${index + 1} has a non-finite right-hand side`);
  }
  const integerVars = Array.isArray(raw['integerVars']) ? raw['integerVars'] : undefined;
  const binaryVars = Array.isArray(raw['binaryVars']) ? raw['binaryVars'] : undefined;
  if (integerVars && !integerVars.every((name) => typeof name === 'string' && name.trim())) errors.push('integerVars must be variable names');
  if (binaryVars && !binaryVars.every((name) => typeof name === 'string' && name.trim())) errors.push('binaryVars must be variable names');
  if (errors.length) return { model: null, missing: errors, errors };
  const model: LpModel = {
    sense: sense as LpModel['sense'],
    objective: objective as LpModel['objective'],
    constraints: constraints as LpModel['constraints'],
    ...(integerVars ? { integerVars: integerVars as string[] } : {}),
    ...(binaryVars ? { binaryVars: binaryVars as string[] } : {}),
    ...(isRecord(raw['bounds']) ? { bounds: raw['bounds'] as LpModel['bounds'] } : {}),
  };
  if (integer && !(model.integerVars?.length || model.binaryVars?.length)) {
    model.integerVars = unique(model.objective.map((term) => term.var));
  }
  return { model, missing: [], errors: [] };
}

function formulateLp(kind: 'linear_programming' | 'integer_programming', raw: unknown): ScientificFormulation {
  const formulation = base(kind);
  const normalized = normalizeLp(raw, kind === 'integer_programming');
  const model = normalized.model;
  formulation.missingInputs = normalized.missing;
  formulation.objective = model ? `${model.sense} ${model.objective.map((term) => `${term.coeff}·${term.var}`).join(' + ')}` : 'not formulated';
  formulation.decisionVariables = model ? unique([...model.objective.map((term) => term.var), ...model.constraints.flatMap((constraint) => constraint.terms.map((term) => term.var))]) : [];
  formulation.inputData = model ? ['objective coefficients', 'constraint coefficients and right-hand sides', ...(model.bounds ? ['variable bounds'] : [])] : [];
  formulation.constraints = model ? model.constraints.map((constraint, index) => `${constraint.name ?? `c${index + 1}`}: ${constraint.terms.map((term) => `${term.coeff}·${term.var}`).join(' + ')} ${constraint.op} ${constraint.rhs}`) : [];
  formulation.assumptions = ['The supplied model is the intended mathematical model.', 'Coefficients are finite and linear.', 'No missing data is imputed.'];
  formulation.feasibilityConditions = model ? ['All constraints satisfied within numerical tolerance', 'Variable bounds respected', ...(model.integerVars?.length ? ['Integer variables are integral'] : []), ...(model.binaryVars?.length ? ['Binary variables are 0 or 1'] : [])] : [];
  formulation.uncertainty = 'none unless the caller supplied stochastic parameters; the solver is deterministic for a fixed model.';
  formulation.solver = 'or.solve_lp (HiGHS LP/MIP)';
  formulation.expectedOutputs = ['solver status', 'objective value', 'variable assignment', 'independent constraint/objective verification'];
  formulation.verification = ['solver status is Optimal', 'objective recomputed from variables', 'every constraint re-evaluated', 'bounds and integrality checked'];
  formulation.limitations = ['Linear models only; nonlinear relationships require a different solver.', 'Optimality is claimed only when HiGHS reports Optimal and verification passes.'];
  return finish(formulation, model);
}

function formulateGraph(raw: unknown): ScientificFormulation {
  const formulation = base('shortest_path');
  if (!isRecord(raw)) {
    formulation.missingInputs = ['weighted edges', 'start node', 'goal node'];
    return finish(formulation, null);
  }
  const edges = Array.isArray(raw['edges']) ? raw['edges'] : [];
  const errors: string[] = [];
  if (!edges.length) errors.push('weighted edges are required');
  for (const [index, edge] of edges.entries()) {
    if (!isRecord(edge) || typeof edge['from'] !== 'string' || typeof edge['to'] !== 'string' || !finite(edge['weight'])) errors.push(`edge ${index + 1} needs from, to and a finite weight`);
    else if ((edge['weight'] as number) < 0) errors.push(`edge ${index + 1} has a negative weight`);
  }
  if (typeof raw['start'] !== 'string' || !raw['start'].trim()) errors.push('start node is required');
  if (typeof raw['goal'] !== 'string' || !raw['goal'].trim()) errors.push('goal node is required');
  if (errors.length) {
    formulation.missingInputs = errors;
    return finish(formulation, null);
  }
  const nodes = Array.isArray(raw['nodes']) ? raw['nodes'].filter((node): node is string => typeof node === 'string') : [];
  const model: GraphModel = {
    ...(nodes.length ? { nodes } : {}),
    edges: edges as GraphModel['edges'],
    start: raw['start'] as string,
    goal: raw['goal'] as string,
    ...(typeof raw['directed'] === 'boolean' ? { directed: raw['directed'] } : {}),
    ...(isRecord(raw['heuristic']) ? { heuristic: raw['heuristic'] as Record<string, number> } : {}),
    ...(raw['algorithm'] === 'dijkstra' || raw['algorithm'] === 'a_star' || raw['algorithm'] === 'auto' ? { algorithm: raw['algorithm'] } : {}),
  };
  formulation.decisionVariables = ['binary path-edge selection (solved implicitly by graph search)'];
  formulation.inputData = ['weighted edges', 'start and goal nodes', 'optional heuristic'];
  formulation.objective = `minimize total path weight from ${model.start} to ${model.goal}`;
  formulation.constraints = ['path begins at the start node', 'path ends at the goal node', 'each consecutive pair is a real edge', 'edge weights are non-negative'];
  formulation.assumptions = ['The graph model is correct and complete.', 'Weights are additive and non-negative.', 'A* heuristic is optional and is verified against Dijkstra.'];
  formulation.feasibilityConditions = ['start and goal exist in the graph', 'no negative edge weights', 'a path exists or no_path is reported'];
  formulation.uncertainty = 'none for deterministic edge weights.';
  formulation.solver = 'graph.shortest_path (Dijkstra/A*)';
  formulation.expectedOutputs = ['optimal path', 'path cost', 'expanded nodes', 'independent path and optimality verification'];
  formulation.verification = ['path endpoints are correct', 'every path step is a real edge', 'cost recomputed from edges', 'A* compared with an independent Dijkstra baseline'];
  formulation.limitations = ['Negative weights are rejected.', 'Optimality is relative to the supplied graph, not proof that the graph is correct.'];
  return finish(formulation, model);
}

function formulateAssignment(raw: unknown): ScientificFormulation {
  const formulation = base('assignment');
  if (!isRecord(raw)) {
    formulation.missingInputs = ['rectangular numeric cost matrix'];
    return finish(formulation, null);
  }
  const matrix = raw['costMatrix'];
  const valid = Array.isArray(matrix) && matrix.length > 0 && matrix.every((row) => Array.isArray(row) && row.length > 0 && row.every(finite));
  const rectangular = valid && matrix.every((row) => row.length === matrix[0]!.length);
  if (!valid || !rectangular) {
    formulation.missingInputs = ['a rectangular numeric cost matrix'];
    return finish(formulation, null);
  }
  const model = { costMatrix: matrix, ...(Array.isArray(raw['rowLabels']) ? { rowLabels: raw['rowLabels'] } : {}), ...(Array.isArray(raw['colLabels']) ? { colLabels: raw['colLabels'] } : {}) };
  formulation.decisionVariables = Array.from({ length: matrix.length }, (_, row) => Array.from({ length: matrix[0]!.length }, (_, col) => `x_${row}_${col}`)).flat();
  formulation.inputData = ['rectangular cost matrix', 'optional row and column labels'];
  formulation.objective = 'minimize the sum of selected assignment costs';
  formulation.constraints = ['each real row is assigned at most once', 'each real column is assigned at most once'];
  formulation.assumptions = ['Costs are additive and linear.', 'One-to-one matching; side constraints require a MIP.'];
  formulation.feasibilityConditions = ['cost matrix is rectangular and finite'];
  formulation.uncertainty = 'none.';
  formulation.solver = 'or.assignment (Hungarian)';
  formulation.expectedOutputs = ['selected row/column pairs', 'total cost', 'dummy assignments for rectangular inputs'];
  formulation.verification = ['recompute total cost', 'no duplicate row or column', 'indices are inside the matrix'];
  formulation.limitations = ['No precedence or capacity side constraints.', 'Many-to-one allocation requires a MIP formulation.'];
  return finish(formulation, model);
}

function formulateSchedule(raw: unknown): ScientificFormulation {
  const formulation = base('employee_scheduling');
  if (!isRecord(raw)) {
    formulation.missingInputs = ['employees with availability and cost', 'shifts with demand'];
    return finish(formulation, null);
  }
  const employees = Array.isArray(raw['employees']) ? raw['employees'] : [];
  const shifts = Array.isArray(raw['shifts']) ? raw['shifts'] : [];
  if (!employees.length) formulation.missingInputs.push('employees with availability and cost');
  if (!shifts.length) formulation.missingInputs.push('shifts with demand');
  if (formulation.missingInputs.length) return finish(formulation, null);
  const model = { employees, shifts } as ScheduleInput;
  formulation.decisionVariables = model.employees.flatMap((employee) => model.shifts.map((shift) => `x_${employee.id}_${shift.id}`));
  formulation.inputData = ['employee hourly cost', 'employee availability', 'employee max assignments', 'shift demand'];
  formulation.objective = 'minimize total labor cost';
  formulation.constraints = ['shift demand covered', 'employee availability respected', 'max assignments per employee respected'];
  formulation.assumptions = ['Single-period shifts.', 'Linear labor cost objective.', 'No breaks or consecutive-day rules.'];
  formulation.feasibilityConditions = ['demand can be covered by available employees', 'all referenced shift ids exist'];
  formulation.uncertainty = 'none unless demand or availability are uncertain.';
  formulation.solver = 'or.employee_schedule (HiGHS MIP)';
  formulation.expectedOutputs = ['assignments', 'total cost', 'per-shift coverage', 'independent schedule validation'];
  formulation.verification = ['recompute cost', 'revalidate demand', 'revalidate availability', 'revalidate workload caps'];
  formulation.limitations = ['No multi-period contracts, breaks or fairness objectives.'];
  return finish(formulation, model);
}

function formulateSimulation(raw: unknown): ScientificFormulation {
  const formulation = base('monte_carlo_simulation');
  if (!isRecord(raw)) {
    formulation.missingInputs = ['items with optimistic, likely and pessimistic estimates'];
    return finish(formulation, null);
  }
  const items = Array.isArray(raw['items']) ? raw['items'] : [];
  if (!items.length) formulation.missingInputs.push('items with optimistic, likely and pessimistic estimates');
  for (const [index, item] of items.entries()) {
    if (!isRecord(item) || typeof item['name'] !== 'string' || !finite(item['optimistic']) || !finite(item['likely']) || !finite(item['pessimistic'])) {
      formulation.missingInputs.push(`item ${index + 1} needs name and finite optimistic/likely/pessimistic values`);
    }
  }
  const trials = finite(raw['trials']) ? Math.floor(raw['trials'] as number) : 10_000;
  const seed = finite(raw['seed']) ? Math.floor(raw['seed'] as number) : 42;
  if (trials < 100 || trials > 100_000) formulation.missingInputs.push('trials must be between 100 and 100000');
  if (formulation.missingInputs.length) return finish(formulation, null);
  const model = { items, trials, seed };
  formulation.decisionVariables = ['sampled total outcome'];
  formulation.inputData = ['three-point PERT estimates', 'trial count', 'seed'];
  formulation.objective = 'estimate the distribution of the summed outcome';
  formulation.constraints = ['items are independent', 'triangular PERT marginals', 'seeded and reproducible'];
  formulation.assumptions = ['Three-point estimates are supplied, not learned.', 'Independence and triangular marginals are assumptions, not facts.'];
  formulation.feasibilityConditions = ['at least one complete three-point item', 'trials within the supported range'];
  formulation.uncertainty = 'explicit; the output is a simulated distribution, never an observed measurement.';
  formulation.solver = 'sim.monte_carlo (seeded PERT Monte Carlo)';
  formulation.expectedOutputs = ['p10/p50/p90', 'mean and standard deviation', 'histogram', 'seed and trial metadata'];
  formulation.verification = ['quantiles are ordered p10 ≤ p50 ≤ p90', 'seed and trial count are recorded', 'result is labelled simulated'];
  formulation.limitations = ['No correlation modeling.', 'Triangular marginals are an assumption.', 'Not a causal or observed forecast.'];
  return finish(formulation, model);
}

function formulateForecast(raw: unknown): ScientificFormulation {
  const formulation = base('forecasting');
  if (!isRecord(raw)) {
    formulation.missingInputs = ['numeric chronological series'];
    return finish(formulation, null);
  }
  const series = Array.isArray(raw['series']) ? raw['series'] : [];
  const steps = finite(raw['steps']) ? Math.floor(raw['steps'] as number) : 3;
  if (series.length < 8) formulation.missingInputs.push('at least eight chronological observations');
  if (!series.every(finite)) formulation.missingInputs.push('every observation must be finite');
  if (steps < 1 || steps > 90) formulation.missingInputs.push('steps must be between 1 and 90');
  if (formulation.missingInputs.length) return finish(formulation, null);
  const model = { series, steps };
  formulation.decisionVariables = ['forecast point for each future step'];
  formulation.inputData = ['chronological numeric series', 'forecast horizon'];
  formulation.objective = `project the next ${steps} period(s) with a linear trend baseline`;
  formulation.constraints = ['chronological order is preserved', 'only supplied observations are used'];
  formulation.assumptions = ['A linear trend continues.', 'No seasonality or causal mechanism is modeled.'];
  formulation.feasibilityConditions = ['at least eight observations', 'finite numeric values', 'horizon 1–90'];
  formulation.uncertainty = 'reported through holdout error and residual bands; it is not a calibrated predictive distribution.';
  formulation.solver = 'forecast.linear (least-squares with 80/20 holdout)';
  formulation.expectedOutputs = ['projections', 'slope/intercept', 'R²', 'holdout MAE', 'residual bands'];
  formulation.verification = ['holdout is chronological', 'R² and MAE are reported', 'bands contain the point estimate', 'no causal claim'];
  formulation.limitations = ['Linear trend only.', 'Small or constant series are refused or uninformative.', 'No seasonality or exogenous variables.'];
  return finish(formulation, model);
}

function formulateDecision(raw: unknown): ScientificFormulation {
  const formulation = base('multi_criteria_decision');
  if (!isRecord(raw)) {
    formulation.missingInputs = ['criteria with positive weights', 'alternatives with scores'];
    return finish(formulation, null);
  }
  const criteria = Array.isArray(raw['criteria']) ? raw['criteria'] : [];
  const alternatives = Array.isArray(raw['alternatives']) ? raw['alternatives'] : [];
  if (!criteria.length) formulation.missingInputs.push('criteria with positive weights');
  if (alternatives.length < 2) formulation.missingInputs.push('at least two alternatives with scores');
  for (const [index, criterion] of criteria.entries()) {
    if (!isRecord(criterion) || typeof criterion['id'] !== 'string' || !finite(criterion['weight']) || (criterion['weight'] as number) <= 0) formulation.missingInputs.push(`criterion ${index + 1} needs an id and a positive weight`);
  }
  for (const [index, alternative] of alternatives.entries()) {
    if (!isRecord(alternative) || typeof alternative['name'] !== 'string' || !isRecord(alternative['scores'])) formulation.missingInputs.push(`alternative ${index + 1} needs a name and scores`);
  }
  if (formulation.missingInputs.length) return finish(formulation, null);
  const model = { criteria, alternatives };
  formulation.decisionVariables = ['normalized criterion weights', 'alternative scores'];
  formulation.inputData = ['criteria and weights', 'alternative scores 0–10'];
  formulation.objective = 'rank alternatives by weighted additive score';
  formulation.constraints = ['weights are positive', 'scores are within 0–10', 'every alternative has a score for every criterion'];
  formulation.assumptions = ['Weights are judgments, not measured facts.', 'Additive scoring is an acceptable decision rule.'];
  formulation.feasibilityConditions = ['at least one criterion and two alternatives', 'complete score matrix'];
  formulation.uncertainty = 'weights are stress-tested with ±25% one-at-a-time perturbations.';
  formulation.solver = 'decision.weighted_matrix';
  formulation.expectedOutputs = ['ranking', 'normalized weights', 'robustness flag', 'perturbation notes'];
  formulation.verification = ['recompute weighted scores', 'check ranking under perturbations', 'expose that weights are judgments'];
  formulation.limitations = ['No interactions or hard constraints.', 'Sensitive to subjective weights and scores.'];
  return finish(formulation, model);
}

function formulateMaxFlow(raw: unknown): ScientificFormulation {
  const formulation = base('max_flow');
  if (!isRecord(raw)) { formulation.missingInputs = ['capacitated edges', 'source', 'sink']; return finish(formulation, null); }
  const edges = Array.isArray(raw['edges']) ? raw['edges'] : [];
  const errors: string[] = [];
  if (!edges.length) errors.push('at least one capacitated edge is required');
  for (const [index, edge] of edges.entries()) {
    if (!isRecord(edge) || typeof edge['from'] !== 'string' || typeof edge['to'] !== 'string' || !finite(edge['capacity'])) errors.push(`edge ${index + 1} needs from, to and a finite capacity`);
    else if ((edge['capacity'] as number) < 0) errors.push(`edge ${index + 1} has a negative capacity`);
  }
  if (typeof raw['source'] !== 'string' || !raw['source'].trim()) errors.push('source is required');
  if (typeof raw['sink'] !== 'string' || !raw['sink'].trim()) errors.push('sink is required');
  if (errors.length) { formulation.missingInputs = errors; return finish(formulation, null); }
  const model = { edges, source: raw['source'], sink: raw['sink'], ...(Array.isArray(raw['nodes']) ? { nodes: raw['nodes'] } : {}) };
  formulation.decisionVariables = edges.map((edge, index) => `f_${(edge as Record<string, unknown>)['from']}_${(edge as Record<string, unknown>)['to']}_${index}`);
  formulation.inputData = ['directed capacitated edges', 'source', 'sink'];
  formulation.objective = 'maximize flow from source to sink';
  formulation.constraints = ['flow conservation at intermediate nodes', '0 ≤ edge flow ≤ capacity'];
  formulation.assumptions = ['The supplied network is the intended model.', 'Capacities are finite and additive.'];
  formulation.feasibilityConditions = ['source and sink exist', 'capacities are non-negative'];
  formulation.uncertainty = 'none for deterministic capacities.';
  formulation.solver = 'graph.max_flow (Dinic)';
  formulation.expectedOutputs = ['max-flow value', 'edge flows', 'min-cut partition and capacity', 'independent conservation/capacity verification'];
  formulation.verification = ['capacity bounds', 'flow conservation', 'source outflow equals max flow', 'min-cut capacity equals max flow'];
  formulation.limitations = ['Single-commodity flow only.', 'No lower bounds or gains.'];
  return finish(formulation, model);
}

function formulateMinCostFlow(raw: unknown): ScientificFormulation {
  const formulation = base('min_cost_flow');
  if (!isRecord(raw)) { formulation.missingInputs = ['capacitated edges with costs', 'source', 'sink', 'demand']; return finish(formulation, null); }
  const edges = Array.isArray(raw['edges']) ? raw['edges'] : [];
  const errors: string[] = [];
  if (!edges.length) errors.push('at least one capacitated edge is required');
  for (const [index, edge] of edges.entries()) {
    if (!isRecord(edge) || typeof edge['from'] !== 'string' || typeof edge['to'] !== 'string' || !finite(edge['capacity']) || !finite(edge['cost'])) errors.push(`edge ${index + 1} needs from, to, finite capacity and finite cost`);
    else if ((edge['capacity'] as number) < 0) errors.push(`edge ${index + 1} has a negative capacity`);
  }
  if (typeof raw['source'] !== 'string' || !raw['source'].trim()) errors.push('source is required');
  if (typeof raw['sink'] !== 'string' || !raw['sink'].trim()) errors.push('sink is required');
  if (!finite(raw['demand']) || (raw['demand'] as number) < 0) errors.push('demand must be finite and non-negative');
  if (errors.length) { formulation.missingInputs = errors; return finish(formulation, null); }
  const model = { edges, source: raw['source'], sink: raw['sink'], demand: raw['demand'], ...(Array.isArray(raw['nodes']) ? { nodes: raw['nodes'] } : {}) };
  formulation.decisionVariables = edges.map((edge, index) => `f_${(edge as Record<string, unknown>)['from']}_${(edge as Record<string, unknown>)['to']}_${index}`);
  formulation.inputData = ['capacitated edges with unit costs', 'source', 'sink', 'demand'];
  formulation.objective = 'minimize total cost while delivering exactly the requested demand';
  formulation.constraints = ['flow conservation at intermediate nodes', '0 ≤ edge flow ≤ capacity', 'delivered flow equals demand'];
  formulation.assumptions = ['Linear additive edge costs.', 'The residual network has no negative cycle at optimum.'];
  formulation.feasibilityConditions = ['source and sink exist', 'max flow is at least the demand'];
  formulation.uncertainty = 'none for deterministic costs.';
  formulation.solver = 'graph.min_cost_flow (successive shortest paths)';
  formulation.expectedOutputs = ['delivered flow', 'total cost', 'edge flows', 'independent conservation/capacity/cost verification'];
  formulation.verification = ['exact demand delivered', 'capacity and conservation', 'cost recomputed', 'no negative residual cycle'];
  formulation.limitations = ['Single-commodity flow only.', 'Successive shortest paths is not a general min-cost circulation with lower bounds.'];
  return finish(formulation, model);
}

function formulateBipartite(raw: unknown): ScientificFormulation {
  const formulation = base('bipartite_matching');
  if (!isRecord(raw)) { formulation.missingInputs = ['left nodes', 'right nodes', 'edges']; return finish(formulation, null); }
  const left = Array.isArray(raw['left']) ? raw['left'] : [];
  const right = Array.isArray(raw['right']) ? raw['right'] : [];
  const edges = Array.isArray(raw['edges']) ? raw['edges'] : [];
  const errors: string[] = [];
  if (!left.length) errors.push('left nodes are required');
  if (!right.length) errors.push('right nodes are required');
  if (!edges.length) errors.push('at least one bipartite edge is required');
  for (const [index, edge] of edges.entries()) {
    if (!isRecord(edge) || typeof edge['left'] !== 'string' || typeof edge['right'] !== 'string') errors.push(`edge ${index + 1} needs left and right`);
  }
  if (errors.length) { formulation.missingInputs = errors; return finish(formulation, null); }
  const model = { left, right, edges };
  formulation.decisionVariables = edges.map((edge, index) => `x_${(edge as Record<string, unknown>)['left']}_${(edge as Record<string, unknown>)['right']}_${index}`);
  formulation.inputData = ['left and right node sets', 'allowed bipartite edges'];
  formulation.objective = 'maximize the number of one-to-one matched pairs';
  formulation.constraints = ['each left node at most once', 'each right node at most once', 'only supplied edges'];
  formulation.assumptions = ['Unweighted maximum-cardinality matching; weighted matching requires assignment.'];
  formulation.feasibilityConditions = ['both sides are non-empty', 'edges reference valid nodes'];
  formulation.uncertainty = 'none.';
  formulation.solver = 'graph.bipartite_matching (augmenting paths)';
  formulation.expectedOutputs = ['matching', 'size', 'unmatched nodes', 'independent maximality verification'];
  formulation.verification = ['every pair is a real edge and used once', 'size matches pairs', 'no augmenting path remains'];
  formulation.limitations = ['Maximum cardinality only; no costs or capacities.', 'One-to-one matching only.'];
  return finish(formulation, model);
}

function formulateTsp(raw: unknown): ScientificFormulation {
  const formulation = base('tsp');
  if (!isRecord(raw)) { formulation.missingInputs = ['points or a distance matrix']; return finish(formulation, null); }
  const points = Array.isArray(raw['points']) ? raw['points'] : [];
  const matrix = Array.isArray(raw['distanceMatrix']) ? raw['distanceMatrix'] : [];
  const errors: string[] = [];
  if (!points.length && !matrix.length) errors.push('points or a distance matrix is required');
  if (points.length) {
    if (new Set(points.map((point) => isRecord(point) ? point['id'] : undefined)).size !== points.length) errors.push('point ids must be unique');
    for (const [index, point] of points.entries()) if (!isRecord(point) || typeof point['id'] !== 'string' || !finite(point['x']) || !finite(point['y'])) errors.push(`point ${index + 1} needs id and finite x/y`);
  }
  if (matrix.length) {
    if (!matrix.every((row) => Array.isArray(row) && row.length === matrix.length && row.every((value) => finite(value) && value >= 0))) errors.push('distance matrix must be square with finite non-negative values');
  }
  if (errors.length) { formulation.missingInputs = errors; return finish(formulation, null); }
  const model = { ...(points.length ? { points } : {}), ...(matrix.length ? { distanceMatrix: matrix } : {}), ...(typeof raw['start'] === 'string' ? { start: raw['start'] } : {}), ...(finite(raw['exactLimit']) ? { exactLimit: raw['exactLimit'] } : {}) };
  formulation.decisionVariables = ['visit order permutation'];
  formulation.inputData = ['points with coordinates or a square distance matrix', 'optional start'];
  formulation.objective = 'minimize the closed tour length visiting every node once';
  formulation.constraints = ['visit every node exactly once', 'return to the start'];
  formulation.assumptions = ['Symmetric Euclidean distances when points are supplied.', 'Exact DP is limited to small instances.'];
  formulation.feasibilityConditions = ['at least one node', 'valid finite distances'];
  formulation.uncertainty = 'none.';
  formulation.solver = 'routing.tsp (Held-Karp exact ≤ exactLimit; nearest-neighbour + 2-opt above)';
  formulation.expectedOutputs = ['tour', 'cost', 'method', 'optimal/approximate status', 'MST lower bound', 'independent tour verification'];
  formulation.verification = ['permutation visits every node once', 'cost recomputed', 'tour starts at start', 'exact small instances compared with brute force', 'heuristic results labelled approximate'];
  formulation.limitations = ['Large instances are heuristic and not globally optimal.', 'No time windows, precedence or asymmetric TSP guarantees beyond exact small cases.'];
  return finish(formulation, model);
}

function formulateVrp(raw: unknown): ScientificFormulation {
  const formulation = base('vrp');
  if (!isRecord(raw)) { formulation.missingInputs = ['depots', 'customers with demand', 'vehicles with capacity']; return finish(formulation, null); }
  const depots = Array.isArray(raw['depots']) ? raw['depots'] : [];
  const customers = Array.isArray(raw['customers']) ? raw['customers'] : [];
  const vehicles = Array.isArray(raw['vehicles']) ? raw['vehicles'] : [];
  const errors: string[] = [];
  if (!depots.length) errors.push('at least one depot is required');
  if (!customers.length) errors.push('at least one customer is required');
  if (!vehicles.length) errors.push('at least one vehicle is required');
  for (const [index, customer] of customers.entries()) if (!isRecord(customer) || typeof customer['id'] !== 'string' || !finite(customer['x']) || !finite(customer['y']) || !finite(customer['demand']) || (customer['demand'] as number) < 0) errors.push(`customer ${index + 1} needs id, finite coordinates and non-negative demand`);
  for (const [index, vehicle] of vehicles.entries()) if (!isRecord(vehicle) || typeof vehicle['id'] !== 'string' || !finite(vehicle['capacity']) || (vehicle['capacity'] as number) <= 0) errors.push(`vehicle ${index + 1} needs id and positive capacity`);
  if (errors.length) { formulation.missingInputs = errors; return finish(formulation, null); }
  const model = { depots, customers, vehicles };
  formulation.decisionVariables = ['customer-to-route assignment', 'route order'];
  formulation.inputData = ['depot coordinates', 'customer coordinates and demands', 'vehicle capacities'];
  formulation.objective = 'minimize total travel distance while respecting vehicle capacities';
  formulation.constraints = ['every customer served once', 'route load ≤ vehicle capacity', 'routes start and end at a depot'];
  formulation.assumptions = ['Euclidean distances.', 'Nearest-depot assignment; routes use Clarke–Wright savings.', 'Heuristic, not globally optimal.'];
  formulation.feasibilityConditions = ['each demand ≤ some vehicle capacity', 'enough vehicles for the resulting routes'];
  formulation.uncertainty = 'none for deterministic demands and travel times.';
  formulation.solver = 'routing.vrp (multi-depot Clarke–Wright savings)';
  formulation.expectedOutputs = ['routes', 'loads', 'total distance', 'feasible/approximate status', 'independent coverage/capacity verification'];
  formulation.verification = ['every customer served exactly once', 'capacity respected', 'route distance recomputed', 'heuristic labelled feasible/approximate'];
  formulation.limitations = ['No time windows, pickups/deliveries or exact global optimum.', 'Depot assignment is not jointly optimized with routing.'];
  return finish(formulation, model);
}

function formulatePareto(raw: unknown): ScientificFormulation {
  const formulation = base('pareto_multi_objective');
  if (!isRecord(raw)) { formulation.missingInputs = ['objectives', 'candidate solutions with values']; return finish(formulation, null); }
  const objectives = Array.isArray(raw['objectives']) ? raw['objectives'] : [];
  const candidates = Array.isArray(raw['candidates']) ? raw['candidates'] : [];
  const errors: string[] = [];
  if (objectives.length < 2) errors.push('at least two objectives are required');
  if (candidates.length < 2) errors.push('at least two candidates are required');
  for (const [index, objective] of objectives.entries()) if (!isRecord(objective) || typeof objective['id'] !== 'string' || (objective['direction'] !== 'minimize' && objective['direction'] !== 'maximize')) errors.push(`objective ${index + 1} needs id and minimize/maximize direction`);
  for (const [index, candidate] of candidates.entries()) if (!isRecord(candidate) || typeof candidate['name'] !== 'string' || !isRecord(candidate['values'])) errors.push(`candidate ${index + 1} needs name and values`);
  if (errors.length) { formulation.missingInputs = errors; return finish(formulation, null); }
  const model = { objectives, candidates, ...(isRecord(raw['weights']) ? { weights: raw['weights'] } : {}) };
  formulation.decisionVariables = ['candidate selection'];
  formulation.inputData = ['objective directions', 'candidate objective values', 'optional weights'];
  formulation.objective = 'identify non-dominated candidates and explain trade-offs';
  formulation.constraints = ['all candidate values are finite', 'directions are declared per objective'];
  formulation.assumptions = ['The candidate set is the decision space.', 'Weights are judgments, not measured facts.'];
  formulation.feasibilityConditions = ['at least two objectives and two candidates'];
  formulation.uncertainty = 'weights are stress-tested ±20%; candidate values are treated as given.';
  formulation.solver = 'decision.pareto (dominance + weighted ranking)';
  formulation.expectedOutputs = ['Pareto frontier', 'dominated candidates', 'weighted ranking', 'trade-offs', 'sensitivity notes', 'independent dominance verification'];
  formulation.verification = ['frontier completeness', 'no frontier point is dominated', 'weighted scores recomputed', 'trade-off differences recomputed'];
  formulation.limitations = ['Exact only for the supplied candidate set.', 'No continuous Pareto front generation.', 'Weighted ranking is not a substitute for preference elicitation.'];
  return finish(formulation, model);
}

function formulateBayes(raw: unknown): ScientificFormulation {
  const formulation = base('bayesian_inference');
  if (!isRecord(raw)) { formulation.missingInputs = ['model type and prior', 'observations']; return finish(formulation, null); }
  const type = raw['type'];
  const errors: string[] = [];
  if (type === 'beta_binomial') {
    const prior = raw['prior'];
    if (!isRecord(prior) || !finite(prior['alpha']) || (prior['alpha'] as number) <= 0 || !finite(prior['beta']) || (prior['beta'] as number) <= 0) errors.push('beta prior needs positive alpha and beta');
    if (!Number.isInteger(raw['successes']) || !Number.isInteger(raw['trials']) || (raw['successes'] as number) < 0 || (raw['trials'] as number) < (raw['successes'] as number)) errors.push('successes and trials must be valid integers');
  } else if (type === 'normal_normal') {
    const prior = raw['prior'];
    if (!isRecord(prior) || !finite(prior['mean']) || !finite(prior['sd']) || (prior['sd'] as number) <= 0) errors.push('normal prior needs a finite mean and positive sd');
    if (!Array.isArray(raw['observations']) || !raw['observations'].length || !raw['observations'].every(finite)) errors.push('at least one finite observation is required');
    if (!finite(raw['knownSd']) || (raw['knownSd'] as number) <= 0) errors.push('knownSd must be positive');
  } else errors.push('type must be beta_binomial or normal_normal');
  if (errors.length) { formulation.missingInputs = errors; return finish(formulation, null); }
  const model = raw;
  formulation.decisionVariables = ['posterior distribution parameters'];
  formulation.inputData = ['prior parameters', 'observed successes/trials or observations', 'likelihood assumptions'];
  formulation.objective = 'update the prior with observed data and report uncertainty';
  formulation.constraints = ['valid conjugate likelihood', 'positive prior parameters'];
  formulation.assumptions = ['The likelihood and prior are the intended model.', 'Observations are exchangeable.'];
  formulation.feasibilityConditions = ['valid prior and observations'];
  formulation.uncertainty = 'explicit posterior credible interval; prior sensitivity is reported only when alternative priors are supplied.';
  formulation.solver = 'stats.bayes_update (conjugate Beta–Binomial / Normal–Normal)';
  formulation.expectedOutputs = ['posterior parameters', 'posterior mean and sd', 'credible interval', 'posterior predictive', 'prior sensitivity'];
  formulation.verification = ['posterior parameters recomputed', 'mean/sd formulas', 'credible interval contains the mean', 'P(theta>0.5) recomputed', 'sensitivity explicitly assessed or marked absent'];
  formulation.limitations = ['Conjugate models only; no MCMC or Bayesian network.', 'Credible intervals are model-conditional, not guaranteed real-world coverage.'];
  return finish(formulation, model);
}

function formulateQueue(raw: unknown): ScientificFormulation {
  const formulation = base('queue_simulation');
  if (!isRecord(raw)) { formulation.missingInputs = ['customers', 'interarrival mean', 'service mean', 'servers', 'seed']; return finish(formulation, null); }
  const errors: string[] = [];
  if (!Number.isInteger(raw['customers']) || (raw['customers'] as number) < 1 || (raw['customers'] as number) > 100_000) errors.push('customers must be an integer between 1 and 100000');
  if (!finite(raw['interarrivalMean']) || (raw['interarrivalMean'] as number) <= 0) errors.push('interarrivalMean must be positive');
  if (!finite(raw['serviceMean']) || (raw['serviceMean'] as number) <= 0) errors.push('serviceMean must be positive');
  if (!Number.isInteger(raw['servers']) || (raw['servers'] as number) < 1 || (raw['servers'] as number) > 100) errors.push('servers must be an integer between 1 and 100');
  if (!Number.isInteger(raw['seed'])) errors.push('seed must be an integer');
  if (errors.length) { formulation.missingInputs = errors; return finish(formulation, null); }
  const model = { customers: raw['customers'], interarrivalMean: raw['interarrivalMean'], serviceMean: raw['serviceMean'], servers: raw['servers'], seed: raw['seed'] };
  formulation.decisionVariables = ['customer wait and service timing'];
  formulation.inputData = ['customer count', 'exponential interarrival mean', 'exponential service mean', 'server count', 'seed'];
  formulation.objective = 'estimate waiting, utilization and makespan under a FCFS queue';
  formulation.constraints = ['customers are served in arrival order', 'a customer waits for an available server', 'no negative waits'];
  formulation.assumptions = ['Exponential interarrival and service distributions.', 'FCFS discipline.', 'No balking, reneging or priorities.'];
  formulation.feasibilityConditions = ['positive means', 'at least one server'];
  formulation.uncertainty = 'explicit simulated distribution; one seeded run is not a confidence interval.';
  formulation.solver = 'sim.queue (seeded discrete-event FCFS simulation)';
  formulation.expectedOutputs = ['mean/p90/max wait', 'utilization', 'makespan', 'served count', 'seed'];
  formulation.verification = ['all customers served', 'non-negative waits', 'utilization in [0,1]', 'seed recorded'];
  formulation.limitations = ['No system dynamics or agent-based behavior.', 'Short runs include warm-up bias.', 'Results are simulated, not observed.'];
  return finish(formulation, model);
}

function formulateScenarios(raw: unknown): ScientificFormulation {
  const formulation = base('scenario_comparison');
  if (!isRecord(raw)) { formulation.missingInputs = ['scenarios with PERT items']; return finish(formulation, null); }
  const scenarios = Array.isArray(raw['scenarios']) ? raw['scenarios'] : [];
  const errors: string[] = [];
  if (scenarios.length < 2) errors.push('at least two scenarios are required');
  for (const [index, scenario] of scenarios.entries()) {
    if (!isRecord(scenario) || typeof scenario['name'] !== 'string' || !Array.isArray(scenario['items']) || !scenario['items'].length) errors.push(`scenario ${index + 1} needs a name and items`);
  }
  if (errors.length) { formulation.missingInputs = errors; return finish(formulation, null); }
  const model = { scenarios, ...(finite(raw['trials']) ? { trials: raw['trials'] } : {}), ...(finite(raw['seed']) ? { seed: raw['seed'] } : {}) };
  formulation.decisionVariables = ['scenario choice'];
  formulation.inputData = ['scenario PERT items and adjustments', 'trials', 'seed'];
  formulation.objective = 'compare scenario distributions and their baseline deltas';
  formulation.constraints = ['same seed and trial count across scenarios', 'explicit scenario definitions'];
  formulation.assumptions = ['Scenarios are independent PERT models.', 'The baseline is the first scenario.'];
  formulation.feasibilityConditions = ['at least two complete scenarios'];
  formulation.uncertainty = 'explicit simulated distributions; ranking is by median, not a guarantee.';
  formulation.solver = 'sim.scenario_compare (seeded PERT)';
  formulation.expectedOutputs = ['scenario distributions', 'baseline deltas', 'ranking', 'reproducibility verification'];
  formulation.verification = ['scenario count', 'quantile ordering', 'deltas recomputed', 'same-seed reproducibility', 'simulated labels'];
  formulation.limitations = ['No correlation between scenarios.', 'Not a causal forecast or a single-run guarantee.'];
  return finish(formulation, model);
}


export function formulateScientificProblem(input: { kind: FormulationKind; model?: unknown; objective?: string }): ScientificFormulation {
  switch (input.kind) {
    case 'linear_programming': return formulateLp('linear_programming', input.model);
    case 'integer_programming': return formulateLp('integer_programming', input.model);
    case 'shortest_path': return formulateGraph(input.model);
    case 'assignment': return formulateAssignment(input.model);
    case 'employee_scheduling': return formulateSchedule(input.model);
    case 'monte_carlo_simulation': return formulateSimulation(input.model);
    case 'forecasting': return formulateForecast(input.model);
    case 'multi_criteria_decision': return formulateDecision(input.model);
    case 'max_flow': return formulateMaxFlow(input.model);
    case 'min_cost_flow': return formulateMinCostFlow(input.model);
    case 'bipartite_matching': return formulateBipartite(input.model);
    case 'tsp': return formulateTsp(input.model);
    case 'vrp': return formulateVrp(input.model);
    case 'pareto_multi_objective': return formulatePareto(input.model);
    case 'bayesian_inference': return formulateBayes(input.model);
    case 'queue_simulation': return formulateQueue(input.model);
    case 'scenario_comparison': return formulateScenarios(input.model);
    default: {
      const formulation = base(input.kind);
      formulation.missingInputs = ['a supported scientific problem class'];
      return finish(formulation, null);
    }
  }
}
