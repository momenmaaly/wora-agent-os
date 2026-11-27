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

export type FormulationKind = 'linear_programming' | 'integer_programming' | 'shortest_path' | 'assignment' | 'employee_scheduling' | 'monte_carlo_simulation' | 'forecasting' | 'multi_criteria_decision';

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
    default: {
      const formulation = base(input.kind);
      formulation.missingInputs = ['a supported scientific problem class'];
      return finish(formulation, null);
    }
  }
}
