/**
 * WORA OS — Operations Research engines.
 *
 * - `solveLp`: LP / MIP solving through HiGHS (WASM build of the HiGHS solver).
 * - `employeeSchedule`: min-cost shift assignment MIP with independent
 *   validation of the solution (availability, demand, max workload).
 * - `assignment`: Hungarian algorithm for balanced assignment problems.
 *
 * These are real solvers running locally. No heuristic theatre.
 */
// The published types describe an ES module namespace for this CommonJS
// package; at runtime the default import is the loader function itself.
import loadHighsImport from 'highs';

export interface HighsLike {
  solve(problem: string, options?: { output_flag?: boolean }): {
    Status: string;
    ObjectiveValue: number | null;
    Columns?: Record<string, { Primal: number }>;
  };
}
const loadHighs = loadHighsImport as unknown as (options?: unknown) => Promise<HighsLike>;

let highsPromise: Promise<HighsLike> | null = null;
export function getHighs(): Promise<HighsLike> {
  if (!highsPromise) highsPromise = loadHighs();
  return highsPromise;
}

/* ─── Variable-name sanitization ─────────────────────────── */
const NAME_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function sanitizeVarName(raw: string): string {
  let name = raw.replace(/[^A-Za-z0-9_]/g, '_');
  if (!NAME_OK.test(name)) name = `v_${name}`;
  return name;
}
/** Deterministic collision-free sanitizer used when building models. */
export function uniqueVarNamer(): (raw: string) => string {
  const used = new Map<string, number>();
  return (raw: string) => {
    const base = sanitizeVarName(raw);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}_${count}`;
  };
}

export interface LpTerm { var: string; coeff: number }
export interface LpConstraint { name?: string; terms: LpTerm[]; op: '<=' | '>=' | '='; rhs: number }
export interface LpModel {
  sense: 'minimize' | 'maximize';
  objective: LpTerm[];
  constraints: LpConstraint[];
  integerVars?: string[];
  binaryVars?: string[];
  bounds?: Record<string, { lower?: number; upper?: number }>;
}
export interface LpResult {
  status: string;
  objectiveValue: number | null;
  variables: Record<string, number>;
  lp: string;
}

export async function solveLp(model: LpModel): Promise<LpResult> {
  const allVars = new Set<string>();
  for (const t of model.objective) allVars.add(t.var);
  for (const c of model.constraints) for (const t of c.terms) allVars.add(t.var);
  if (!allVars.size) throw new Error('Model has no variables');

  const namer = uniqueVarNamer();
  const varNames = [...allVars];
  const sanitized = new Map<string, string>();
  for (const v of varNames) sanitized.set(v, namer(v));
  const s = (name: string) => sanitized.get(name)!;

  const integer = new Set([...(model.integerVars ?? []), ...(model.binaryVars ?? [])].map(s));
  const binary = new Set((model.binaryVars ?? []).map(s));
  const fmt = (n: number) => {
    if (!Number.isFinite(n)) throw new Error('Non-finite coefficient');
    return String(Math.abs(n) === Math.round(Math.abs(n)) ? Math.trunc(n) : n);
  };
  const term = (t: LpTerm, first: boolean) => {
    const coeff = t.coeff;
    if (coeff === 0) return '';
    const sign = coeff < 0 ? ' - ' : first ? '' : ' + ';
    const abs = Math.abs(coeff);
    const body = abs === 1 ? s(t.var) : `${fmt(abs)} ${s(t.var)}`;
    return `${sign}${body}`;
  };
  const line = (terms: LpTerm[]) => terms.map((t, i) => term(t, i === 0)).join('');

  const parts: string[] = [];
  parts.push(model.sense === 'maximize' ? 'Maximize' : 'Minimize');
  parts.push(` obj: ${line(model.objective)}`);
  parts.push('Subject To');
  model.constraints.forEach((c, i) => {
    const cname = sanitizeVarName(c.name ?? `c${i}`);
    parts.push(` ${cname}: ${line(c.terms)} ${c.op} ${fmt(c.rhs)}`);
  });
  const boundLines: string[] = [];
  for (const v of varNames) {
    const sv = s(v);
    if (binary.has(sv)) { boundLines.push(` 0 <= ${sv} <= 1`); continue; }
    const b = model.bounds?.[v];
    if (b && (b.lower !== undefined || b.upper !== undefined)) {
      const lo = b.lower ?? 0;
      boundLines.push(b.upper === undefined ? ` ${sv} >= ${fmt(lo)}` : ` ${fmt(lo)} <= ${sv} <= ${fmt(b.upper)}`);
    } else {
      boundLines.push(` ${sv} >= 0`);
    }
  }
  if (boundLines.length) { parts.push('Bounds'); parts.push(...boundLines); }
  if (integer.size) { parts.push('Generals'); parts.push(` ${[...integer].join(' ')}`); }
  parts.push('End');
  const lp = parts.join('\n');

  const highs = await getHighs();
  const raw = highs.solve(lp, { output_flag: false });
  const variables: Record<string, number> = {};
  if (raw.Columns) {
    for (const [name, col] of Object.entries(raw.Columns)) {
      const original = [...sanitized.entries()].find(([, v]) => v === name)?.[0] ?? name;
      variables[original] = col.Primal;
    }
  }
  return {
    status: raw.Status,
    objectiveValue: raw.ObjectiveValue ?? null,
    variables,
    lp,
  };
}

/* ─── Employee → shift scheduling (min-cost MIP) ─────────── */
export interface ScheduleEmployee {
  id: string;
  name: string;
  hourlyCost: number;
  availability: string[]; // shift ids
  maxAssignments?: number; // default 1
}
export interface ScheduleShift { id: string; name: string; demand: number }
export interface ScheduleInput { employees: ScheduleEmployee[]; shifts: ScheduleShift[] }
export interface ScheduleResult {
  status: string;
  feasible: boolean;
  totalCost: number | null;
  assignments: Array<{ employeeId: string; employeeName: string; shiftId: string; shiftName: string; hourlyCost: number }>;
  perShift: Array<{ shiftId: string; shiftName: string; demand: number; assigned: number; meetsDemand: boolean; employees: string[] }>;
  unassignedEmployees: string[];
  validation: string[];
  lp: string;
}

export async function solveEmployeeSchedule(input: ScheduleInput): Promise<ScheduleResult> {
  const { employees, shifts } = input;
  if (!employees.length) throw new Error('At least one employee is required');
  if (!shifts.length) throw new Error('At least one shift is required');
  const shiftIds = new Set(shifts.map((s) => s.id));
  for (const e of employees) {
    for (const a of e.availability) if (!shiftIds.has(a)) throw new Error(`Employee "${e.id}" lists unknown shift "${a}"`);
    if (!(e.hourlyCost >= 0)) throw new Error(`Employee "${e.id}" has an invalid cost`);
  }
  for (const s of shifts) if (!(s.demand >= 0)) throw new Error(`Shift "${s.id}" has an invalid demand`);

  const varNameMemo = new Map<string, string>();
  const pairNamer = uniqueVarNamer();
  const varName = (e: string, s: string) => {
    const key = `${e} ${s}`;
    let name = varNameMemo.get(key);
    if (!name) { name = `x_${pairNamer(key)}`; varNameMemo.set(key, name); }
    return name;
  };
  const objective: LpTerm[] = [];
  for (const e of employees) for (const s of shifts) if (e.availability.includes(s.id)) objective.push({ var: varName(e.id, s.id), coeff: e.hourlyCost });
  if (!objective.length) throw new Error('No employee is available for any shift — model is infeasible by construction');

  const constraints: LpConstraint[] = [];
  for (const s of shifts) {
    constraints.push({
      name: `demand_${s.id}`,
      terms: employees.filter((e) => e.availability.includes(s.id)).map((e) => ({ var: varName(e.id, s.id), coeff: 1 })),
      op: '>=',
      rhs: s.demand,
    });
  }
  for (const e of employees) {
    constraints.push({
      name: `cap_${e.id}`,
      terms: shifts.filter((s) => e.availability.includes(s.id)).map((s) => ({ var: varName(e.id, s.id), coeff: 1 })),
      op: '<=',
      rhs: e.maxAssignments ?? 1,
    });
  }

  const binaryVars = objective.map((t) => t.var);
  const lp = await solveLp({ sense: 'minimize', objective, constraints, binaryVars });
  const validation: string[] = [];
  const assignments: ScheduleResult['assignments'] = [];
  if (lp.status === 'Optimal') {
    for (const e of employees) {
      for (const s of shifts) {
        const v = lp.variables[varName(e.id, s.id)];
        if (v && v > 0.5) assignments.push({ employeeId: e.id, employeeName: e.name, shiftId: s.id, shiftName: s.name, hourlyCost: e.hourlyCost });
      }
    }
    // Independent re-validation (does not trust the solver blindly).
    const perShiftMap = new Map<string, string[]>();
    const perEmployeeCount = new Map<string, number>();
    for (const a of assignments) {
      perShiftMap.set(a.shiftId, [...(perShiftMap.get(a.shiftId) ?? []), a.employeeName]);
      perEmployeeCount.set(a.employeeId, (perEmployeeCount.get(a.employeeId) ?? 0) + 1);
    }
    let demandOk = true;
    for (const s of shifts) {
      const got = perShiftMap.get(s.id)?.length ?? 0;
      if (got < s.demand) demandOk = false;
      validation.push(`Shift "${s.name}": demand ${s.demand}, assigned ${got} → ${got >= s.demand ? 'OK' : 'SHORTFALL'}`);
    }
    let availabilityOk = true;
    for (const a of assignments) {
      const e = employees.find((emp) => emp.id === a.employeeId)!;
      if (!e.availability.includes(a.shiftId)) availabilityOk = false;
    }
    validation.push(`Availability respected: ${availabilityOk ? 'yes' : 'NO — solver output violates an availability constraint'}`);
    let capOk = true;
    for (const e of employees) {
      const count = perEmployeeCount.get(e.id) ?? 0;
      if (count > (e.maxAssignments ?? 1)) capOk = false;
    }
    validation.push(`Max assignments per employee respected: ${capOk ? 'yes' : 'NO'}`);
    validation.push(`Demand fully covered: ${demandOk ? 'yes' : 'NO'}`);
  }

  const perShift = shifts.map((s) => {
    const names = assignments.filter((a) => a.shiftId === s.id).map((a) => a.employeeName);
    return { shiftId: s.id, shiftName: s.name, demand: s.demand, assigned: names.length, meetsDemand: names.length >= s.demand, employees: names };
  });
  const assignedIds = new Set(assignments.map((a) => a.employeeId));

  return {
    status: lp.status,
    feasible: lp.status === 'Optimal',
    totalCost: lp.status === 'Optimal' ? lp.objectiveValue : null,
    assignments,
    perShift,
    unassignedEmployees: employees.filter((e) => !assignedIds.has(e.id)).map((e) => e.id),
    validation,
    lp: lp.lp,
  };
}

/* ─── Hungarian algorithm (rectangular) ──────────────────── */
export interface AssignmentResult {
  assignments: Array<{ row: number; col: number; rowLabel: string; colLabel: string; cost: number }>;
  totalCost: number;
  dummyAssignments: number;
  size: number;
}

export function solveAssignment(cost: number[][], rowLabels?: string[], colLabels?: string[]): AssignmentResult {
  const nRows = cost.length;
  if (!nRows) throw new Error('Cost matrix is empty');
  const nCols = cost[0]!.length;
  if (!nCols) throw new Error('Cost matrix rows must not be empty');
  for (const row of cost) if (row.length !== nCols) throw new Error('Cost matrix must be rectangular');

  const n = Math.max(nRows, nCols);
  const maxAbs = Math.max(...cost.flat().map((v) => Math.abs(v)), 1);
  const DUMMY = 0; // zero-cost dummies keep dummy assignments distinguishable from preferable real edges
  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i < nRows && j < nCols ? cost[i]![j]! : DUMMY * maxAbs)));

  // O(n^3) Hungarian, 1-indexed internally.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = matrix[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) { minv[j] = cur; way[j] = j0; }
        if (minv[j]! < delta) { delta = minv[j]!; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]!] = u[p[j]!]! + delta; v[j] = v[j]! - delta; }
        else minv[j] = minv[j]! - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) rowToCol[p[j]! - 1] = j - 1;

  const assignments: AssignmentResult['assignments'] = [];
  let totalCost = 0;
  let dummyAssignments = 0;
  for (let i = 0; i < n; i++) {
    const j = rowToCol[i]!;
    if (i < nRows && j < nCols) {
      assignments.push({ row: i, col: j, rowLabel: rowLabels?.[i] ?? `row-${i + 1}`, colLabel: colLabels?.[j] ?? `col-${j + 1}`, cost: cost[i]![j]! });
      totalCost += cost[i]![j]!;
    } else {
      dummyAssignments += 1;
    }
  }
  return { assignments, totalCost, dummyAssignments, size: n };
}
