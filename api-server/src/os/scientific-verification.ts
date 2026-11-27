/**
 * WORA OS — independent scientific result verification.
 *
 * A solver returning "Optimal" is a claim, not proof. These checks recompute
 * the objective, re-evaluate every constraint and bound, inspect integrality,
 * and validate the semantic properties of assignment and scheduling results.
 */
import type { AssignmentResult, LpModel, LpResult, ScheduleInput, ScheduleResult } from './ortools.js';

export const SCIENTIFIC_VERIFICATION_SCHEMA_VERSION = '1.0';

export interface ScientificCheck {
  id: string;
  description: string;
  status: 'passed' | 'failed';
  evidence: string;
}

export interface ScientificVerification {
  schemaVersion: typeof SCIENTIFIC_VERIFICATION_SCHEMA_VERSION;
  passed: boolean;
  checks: ScientificCheck[];
  failures: string[];
  tolerance: number;
}

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function toleranceFor(scale: number, tolerance: number): number {
  return tolerance * Math.max(1, Math.abs(scale));
}

function empty(tolerance: number): ScientificVerification {
  return { schemaVersion: SCIENTIFIC_VERIFICATION_SCHEMA_VERSION, passed: true, checks: [], failures: [], tolerance };
}

function add(result: ScientificVerification, id: string, description: string, passed: boolean, evidence: string): void {
  result.checks.push({ id, description, status: passed ? 'passed' : 'failed', evidence });
  if (!passed) result.failures.push(`${id}: ${evidence}`);
  result.passed = result.failures.length === 0;
}

export function verifyLpSolution(model: LpModel, result: LpResult, tolerance = 1e-6): ScientificVerification {
  const verification = empty(tolerance);
  add(verification, 'solver-status', 'The solver reports an optimal status', result.status === 'Optimal', `status=${result.status}`);
  if (result.status !== 'Optimal') return verification;

  const variables = new Set<string>([
    ...model.objective.map((term) => term.var),
    ...model.constraints.flatMap((constraint) => constraint.terms.map((term) => term.var)),
    ...(model.integerVars ?? []),
    ...(model.binaryVars ?? []),
    ...Object.keys(model.bounds ?? {}),
  ]);
  const value = (name: string): number => result.variables[name] ?? 0;
  const finite = [...variables].every((name) => Number.isFinite(value(name)));
  add(verification, 'finite-variables', 'Every returned variable value is finite', finite, finite ? `${variables.size} variable(s)` : 'a variable is non-finite');

  const recomputedObjective = model.objective.reduce((sum, term) => sum + term.coeff * value(term.var), 0);
  const objectiveOk = result.objectiveValue !== null
    && Math.abs(recomputedObjective - result.objectiveValue) <= toleranceFor(recomputedObjective, tolerance);
  add(verification, 'objective-recompute', 'The reported objective equals the recomputed objective', objectiveOk, `recomputed=${round(recomputedObjective)}; reported=${String(result.objectiveValue)}`);

  for (const [index, constraint] of model.constraints.entries()) {
    const lhs = constraint.terms.reduce((sum, term) => sum + term.coeff * value(term.var), 0);
    const scale = constraint.rhs + Math.abs(lhs);
    const slack = constraint.op === '<=' ? constraint.rhs - lhs : constraint.op === '>=' ? lhs - constraint.rhs : Math.abs(lhs - constraint.rhs);
    const passed = slack >= -toleranceFor(scale, tolerance);
    add(verification, `constraint-${index + 1}`, `Constraint ${constraint.name ?? index + 1} is satisfied`, passed, `lhs=${round(lhs)} ${constraint.op} rhs=${constraint.rhs}; slack=${round(slack)}`);
  }

  for (const name of variables) {
    const bound = model.bounds?.[name];
    const current = value(name);
    const lower = bound?.lower ?? 0;
    const lowerOk = current >= lower - toleranceFor(lower, tolerance);
    const upperOk = bound?.upper === undefined || current <= bound.upper + toleranceFor(bound.upper, tolerance);
    add(verification, `bound-${name}`, `Bound for ${name} is respected`, lowerOk && upperOk, `value=${round(current)}; lower=${String(bound?.lower ?? 0)}; upper=${String(bound?.upper ?? '∞')}`);
  }

  for (const name of model.binaryVars ?? []) {
    const current = value(name);
    const nearInteger = Math.abs(current - Math.round(current)) <= tolerance;
    const rounded = Math.round(current);
    add(verification, `binary-${name}`, `Binary variable ${name} is 0 or 1`, nearInteger && (rounded === 0 || rounded === 1), `value=${round(current)}`);
  }
  for (const name of model.integerVars ?? []) {
    if ((model.binaryVars ?? []).includes(name)) continue;
    const current = value(name);
    add(verification, `integer-${name}`, `Integer variable ${name} is integral`, Math.abs(current - Math.round(current)) <= tolerance, `value=${round(current)}`);
  }
  return verification;
}

export function verifyAssignmentSolution(cost: number[][], result: AssignmentResult, tolerance = 1e-9): ScientificVerification {
  const verification = empty(tolerance);
  const rows = new Set<number>();
  const cols = new Set<number>();
  let recomputed = 0;
  for (const assignment of result.assignments) {
    const rowOk = assignment.row >= 0 && assignment.row < cost.length;
    const colOk = assignment.col >= 0 && assignment.col < (cost[0]?.length ?? 0);
    if (rowOk && colOk) recomputed += cost[assignment.row]![assignment.col]!;
    if (rows.has(assignment.row) || cols.has(assignment.col)) {
      add(verification, 'assignment-unique', 'No row or column is assigned twice', false, `duplicate row=${assignment.row} or col=${assignment.col}`);
    }
    rows.add(assignment.row);
    cols.add(assignment.col);
    add(verification, `assignment-${assignment.row}-${assignment.col}`, 'Assignment indices are inside the cost matrix', rowOk && colOk, `row=${assignment.row}; col=${assignment.col}`);
  }
  add(verification, 'assignment-total', 'The reported total equals the recomputed assignment cost', Math.abs(recomputed - result.totalCost) <= toleranceFor(recomputed, tolerance), `recomputed=${round(recomputed)}; reported=${result.totalCost}`);
  add(verification, 'assignment-count', 'The number of assignments is consistent with the matrix and dummies', result.assignments.length + result.dummyAssignments === result.size, `assignments=${result.assignments.length}; dummies=${result.dummyAssignments}; size=${result.size}`);
  return verification;
}

export function verifyEmployeeSchedule(input: ScheduleInput, result: ScheduleResult, tolerance = 1e-6): ScientificVerification {
  const verification = empty(tolerance);
  const byShift = new Map<string, number>();
  const byEmployee = new Map<string, number>();
  let recomputed = 0;
  for (const assignment of result.assignments) {
    const employee = input.employees.find((entry) => entry.id === assignment.employeeId);
    const shift = input.shifts.find((entry) => entry.id === assignment.shiftId);
    add(verification, `employee-${assignment.employeeId}-${assignment.shiftId}`, 'Assignment references a real employee and shift', Boolean(employee && shift), `employee=${assignment.employeeId}; shift=${assignment.shiftId}`);
    if (employee && shift) {
      recomputed += employee.hourlyCost;
      add(verification, `availability-${assignment.employeeId}-${assignment.shiftId}`, 'The employee is available for the assigned shift', employee.availability.includes(assignment.shiftId), `availability=${employee.availability.join(',') || 'none'}`);
    }
    byShift.set(assignment.shiftId, (byShift.get(assignment.shiftId) ?? 0) + 1);
    byEmployee.set(assignment.employeeId, (byEmployee.get(assignment.employeeId) ?? 0) + 1);
  }
  for (const shift of input.shifts) {
    const assigned = byShift.get(shift.id) ?? 0;
    add(verification, `demand-${shift.id}`, `Shift ${shift.id} meets demand`, assigned >= shift.demand, `demand=${shift.demand}; assigned=${assigned}`);
  }
  for (const employee of input.employees) {
    const count = byEmployee.get(employee.id) ?? 0;
    add(verification, `workload-${employee.id}`, `Employee ${employee.id} respects maxAssignments`, count <= (employee.maxAssignments ?? 1), `assigned=${count}; max=${employee.maxAssignments ?? 1}`);
  }
  const costOk = result.totalCost !== null && Math.abs(recomputed - result.totalCost) <= toleranceFor(recomputed, tolerance);
  add(verification, 'schedule-cost', 'The reported labor cost equals the recomputed assignment cost', costOk, `recomputed=${round(recomputed)}; reported=${String(result.totalCost)}`);
  add(verification, 'schedule-feasible', 'The solver marked the schedule feasible', result.feasible === true, `feasible=${result.feasible}`);
  return verification;
}
