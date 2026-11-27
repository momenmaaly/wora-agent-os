/**
 * WORA OS — controlled scientific method transition.
 *
 * A failed method is not silently replaced. This module only translates inputs
 * it can prove are equivalent for a different, implemented method, records the
 * previous failure and creates a new plan version. It never relaxes the stated
 * objective or bypasses permissions.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { getTool } from './tools.js';
import { listAlgorithms } from './algorithms.js';
import { saveDecisionRecord, listDecisionRecords } from './decision.js';
import { replanMission, type PlanVersion } from './planning.js';
import { openTaskToolInput, sealTaskToolInput } from '../security/task-fields.js';

export interface AdaptiveReplanResult {
  applied: boolean;
  fromTool: string | null;
  toTool: string | null;
  planVersion: PlanVersion | null;
  reason: string;
  gap: string | null;
}

interface AdaptiveTaskRow {
  id: string; mission_id: string; workspace_id: string; title: string; objective: string;
  specialization: string; status: string; tool: string | null; tool_input: string; acceptance: string;
}

function finiteMatrix(value: unknown): number[][] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const rows: number[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || !row.length || row.length > 200) return null;
    const numbers = row.map(Number);
    if (numbers.some((number) => !Number.isFinite(number))) return null;
    rows.push(numbers);
  }
  if (rows.length > 200 || new Set(rows.map((row) => row.length)).size !== 1) return null;
  return rows;
}

function forbiddenPairs(input: Record<string, unknown>): Array<{ row: number; col: number }> {
  if (!Array.isArray(input['forbidden'])) return [];
  return input['forbidden'].flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const row = Number(record['row'] ?? record['employee']);
    const col = Number(record['col'] ?? record['shift']);
    return Number.isInteger(row) && Number.isInteger(col) ? [{ row, col }] : [];
  });
}

export function assignmentToLp(input: Record<string, unknown>): Record<string, unknown> | null {
  const matrix = finiteMatrix(input['costMatrix']);
  if (!matrix) return null;
  const rows = matrix.length;
  const cols = matrix[0]!.length;
  const variables = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => `x_${row}_${col}`));
  const objective = variables.flatMap((row, r) => row.map((variable, c) => ({ var: variable, coeff: matrix[r]![c]! })));
  const constraints: Array<Record<string, unknown>> = [];
  for (let row = 0; row < rows; row += 1) {
    constraints.push({ name: `row_${row}`, terms: variables[row]!.map((variable) => ({ var: variable, coeff: 1 })), op: '=', rhs: 1 });
  }
  for (let col = 0; col < cols; col += 1) {
    constraints.push({ name: `col_${col}`, terms: variables.map((row) => ({ var: row[col]!, coeff: 1 })), op: '=', rhs: 1 });
  }
  for (const pair of forbiddenPairs(input)) {
    if (pair.row < 0 || pair.row >= rows || pair.col < 0 || pair.col >= cols) return null;
    constraints.push({ name: `forbidden_${pair.row}_${pair.col}`, terms: [{ var: variables[pair.row]![pair.col]!, coeff: 1 }], op: '=', rhs: 0 });
  }
  return { sense: 'minimize', objective, constraints, binaryVars: variables.flat() };
}

export function employeeScheduleToLp(input: Record<string, unknown>): Record<string, unknown> | null {
  const employees = Array.isArray(input['employees']) ? input['employees'] as Array<Record<string, unknown>> : null;
  const shifts = Array.isArray(input['shifts']) ? input['shifts'] as Array<Record<string, unknown>> : null;
  if (!employees?.length || !shifts?.length) return null;
  const employeeIds = employees.map((employee) => String(employee['id'] ?? ''));
  const shiftIds = shifts.map((shift) => String(shift['id'] ?? ''));
  if (new Set(employeeIds).size !== employeeIds.length || new Set(shiftIds).size !== shiftIds.length) return null;
  const forbidden = new Set(forbiddenPairs(input).map((pair) => `${pair.row}:${pair.col}`));
  const variables: Array<{ employee: number; shift: number; variable: string; cost: number }> = [];
  employees.forEach((employee, employeeIndex) => {
    const availability = Array.isArray(employee['availability']) ? employee['availability'].map(String) : [];
    shifts.forEach((shift, shiftIndex) => {
      if (!availability.includes(String(shift['id'] ?? '')) || forbidden.has(`${employeeIndex}:${shiftIndex}`)) return;
      variables.push({
        employee: employeeIndex, shift: shiftIndex,
        variable: `x_${employeeIndex}_${shiftIndex}`,
        cost: Number(employee['hourlyCost'] ?? 0),
      });
    });
  });
  if (!variables.length) return null;
  const constraints: Array<Record<string, unknown>> = [];
  employees.forEach((employee, employeeIndex) => {
    const terms = variables.filter((entry) => entry.employee === employeeIndex).map((entry) => ({ var: entry.variable, coeff: 1 }));
    if (!terms.length) return;
    constraints.push({ name: `employee_${employeeIndex}_limit`, terms, op: '<=', rhs: Math.max(1, Number(employee['maxAssignments'] ?? 1)) });
  });
  shifts.forEach((shift, shiftIndex) => {
    const terms = variables.filter((entry) => entry.shift === shiftIndex).map((entry) => ({ var: entry.variable, coeff: 1 }));
    if (!terms.length) return;
    constraints.push({ name: `shift_${shiftIndex}_demand`, terms, op: '>=', rhs: Math.max(0, Number(shift['demand'] ?? 0)) });
  });
  if (!constraints.length) return null;
  return {
    sense: 'minimize',
    objective: variables.map((entry) => ({ var: entry.variable, coeff: entry.cost })),
    constraints,
    binaryVars: variables.map((entry) => entry.variable),
  };
}


function lpToAssignment(input: Record<string, unknown>): Record<string, unknown> | null {
  const sense = input['sense'];
  if (sense !== 'minimize' && sense !== 'maximize') return null;
  if (!Array.isArray(input['objective']) || !Array.isArray(input['constraints'])) return null;
  const variablePattern = /^x_(\d+)_(\d+)$/u;
  const costs = new Map<string, number>();
  for (const entry of input['objective']) {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const variable = String(record['var'] ?? '');
    const coefficient = Number(record['coeff']);
    if (!variablePattern.test(variable) || !Number.isFinite(coefficient)) return null;
    costs.set(variable, sense === 'maximize' ? -coefficient : coefficient);
  }
  if (!costs.size) return null;
  const rowTerms = new Map<number, string[]>();
  const colTerms = new Map<number, string[]>();
  const forbidden: Array<{ row: number; col: number }> = [];
  for (const entry of input['constraints']) {
    if (!entry || typeof entry !== 'object') return null;
    const constraint = entry as Record<string, unknown>;
    if (!Array.isArray(constraint['terms'])) return null;
    const terms = constraint['terms'] as Array<Record<string, unknown>>;
    const rhs = Number(constraint['rhs']);
    if (!Number.isFinite(rhs)) return null;
    if (constraint['op'] === '=' && rhs === 0 && terms.length === 1) {
      const match = variablePattern.exec(String(terms[0]?.['var'] ?? ''));
      if (!match || Number(terms[0]?.['coeff']) !== 1) return null;
      forbidden.push({ row: Number(match[1]), col: Number(match[2]) });
      continue;
    }
    if (constraint['op'] !== '=' || rhs !== 1 || !terms.length) return null;
    if (!terms.every((term) => Number(term['coeff']) === 1 && variablePattern.test(String(term['var'] ?? '')))) return null;
    const parsed = terms.map((term) => variablePattern.exec(String(term['var'] ?? ''))!).map((match) => ({ row: Number(match[1]), col: Number(match[2]) }));
    const rows = new Set(parsed.map((entry) => entry.row));
    const cols = new Set(parsed.map((entry) => entry.col));
    if (rows.size === 1) {
      const row = [...rows][0]!;
      const existing = rowTerms.get(row) ?? [];
      if (existing.length && existing.join(',') !== terms.map((term) => String(term['var'])).join(',')) return null;
      rowTerms.set(row, terms.map((term) => String(term['var'])));
    } else if (cols.size === 1) {
      const col = [...cols][0]!;
      const existing = colTerms.get(col) ?? [];
      if (existing.length && existing.join(',') !== terms.map((term) => String(term['var'])).join(',')) return null;
      colTerms.set(col, terms.map((term) => String(term['var'])));
    } else {
      return null;
    }
  }
  if (!rowTerms.size || !colTerms.size) return null;
  const rows = Math.max(...[...rowTerms.keys()]) + 1;
  const cols = Math.max(...[...colTerms.keys()]) + 1;
  if (rows > 200 || cols > 200) return null;
  const costMatrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (const [variable, cost] of costs) {
    const match = variablePattern.exec(variable)!;
    const row = Number(match[1]);
    const col = Number(match[2]);
    if (row >= rows || col >= cols) return null;
    costMatrix[row]![col] = cost;
  }
  return { costMatrix, forbidden };
}

export type AdaptationAction = 'switch_method' | 'request_information' | 'repair_formulation' | 'decompose' | 'stop';

export interface AdaptationPlan {
  action: AdaptationAction;
  reason: string;
  alternative: { tool: string; input: Record<string, unknown>; rationale: string } | null;
  requiredEvidence: string[];
  gap: string | null;
}

/**
 * Decide a bounded, justified response to a failed method. It never relaxes a
 * constraint, never invents missing data and never switches to a method whose
 * input translation is not proven equivalent.
 */
export function planAdaptation(input: {
  tool: string | null;
  toolInput: Record<string, unknown>;
  failureCategory: string;
  issues: string[];
  semantics: { status: string; acceptable: boolean } | null;
  previousAdaptations: number;
}): AdaptationPlan {
  if (input.previousAdaptations >= 1) {
    return { action: 'stop', reason: 'An adaptive method transition already occurred for this task; stop instead of chaining changes.', alternative: null, requiredEvidence: ['new verified evidence or an explicit operator decision'], gap: 'adaptation_limit' };
  }
  if (input.semantics?.status === 'infeasible') {
    return { action: 'stop', reason: 'The model is infeasible. Switching algorithms cannot satisfy contradictory constraints; corrected data or an explicitly authorized constraint change is required.', alternative: null, requiredEvidence: ['corrected data', 'or an explicitly authorized constraint change'], gap: 'infeasible_model' };
  }
  if (input.failureCategory === 'authorization') {
    return { action: 'stop', reason: 'Authorization failed; a different algorithm does not grant permission.', alternative: null, requiredEvidence: ['an authorized agent/tool or an explicit permission grant'], gap: 'authorization' };
  }
  // A schema rejection can mean the selected tool cannot express a constraint
  // that a translated method can. Prefer the proven translation; only call the
  // failure an input gap when no equivalent method exists.
  const alternative = alternativeForTask({ tool: input.tool, toolInput: input.toolInput });
  if (alternative) {
    return { action: 'switch_method', reason: alternative.rationale, alternative, requiredEvidence: ['the translated model must be equivalent', 'the replacement must pass independent verification'], gap: null };
  }
  const text = input.issues.join('; ').toLowerCase();
  if (/missing|required input|invalid input|schema|malformed|no output|empty/iu.test(text) || input.failureCategory === 'invalid_input' || input.failureCategory === 'empty_output') {
    return { action: 'request_information', reason: 'The failure is an input/data problem, not evidence that another algorithm would succeed.', alternative: null, requiredEvidence: ['the missing or invalid values, supplied by the user or an authorized source'], gap: 'missing_or_invalid_input' };
  }
  return { action: 'stop', reason: 'No implemented equivalent method exists for this failure; report the gap instead of switching blindly.', alternative: null, requiredEvidence: ['a verified equivalent method or new evidence'], gap: 'no_implemented_alternative' };
}

/** Return an implemented alternative only when the input translation is semantically equivalent. */
export function alternativeForTask(task: { tool: string | null; toolInput: Record<string, unknown> }): { tool: string; input: Record<string, unknown>; rationale: string } | null {
  const target = getTool('or.solve_lp');
  if (!target) return null;
  if (!listAlgorithms().some((algorithm) => algorithm.toolId === 'or.solve_lp')) return null;
  const model = task.toolInput['model'];
  const input = model && typeof model === 'object' && !Array.isArray(model) ? model as Record<string, unknown> : task.toolInput;
  if (task.tool === 'or.solve_lp') {
    const translated = lpToAssignment(input);
    return translated ? { tool: 'or.assignment', input: translated, rationale: 'The LP is an exact binary assignment formulation with row/column equality constraints; it was converted back to the Hungarian method with the same forbidden pairs.' } : null;
  }
  if (task.tool === 'or.assignment') {
    const translated = assignmentToLp(input);
    return translated ? { tool: 'or.solve_lp', input: translated, rationale: 'Hungarian assignment was reformulated as an exact binary MIP with the same row/column constraints; side constraints are encoded as forbidden assignments.' } : null;
  }
  if (task.tool === 'or.employee_schedule') {
    const translated = employeeScheduleToLp(input);
    return translated ? { tool: 'or.solve_lp', input: translated, rationale: 'Employee scheduling was reformulated as an exact binary MIP with the same availability, workload and demand constraints; forbidden pairs are encoded explicitly.' } : null;
  }
  return null;
}

export function applyAdaptiveReplan(input: {
  workspaceId: string; missionId: string; taskId: string; reason: string; actor: string;
  toolInput?: Record<string, unknown>;
}): AdaptiveReplanResult {
  const db = getOsDb();
  const task = db.prepare('SELECT * FROM os_tasks WHERE workspace_id = ? AND mission_id = ? AND id = ?')
    .get(input.workspaceId, input.missionId, input.taskId) as AdaptiveTaskRow | undefined;
  if (!task) return { applied: false, fromTool: null, toTool: null, planVersion: null, reason: 'Task not found', gap: 'task_not_found' };
  if (['completed', 'cancelled', 'running', 'reviewing'].includes(task.status)) {
    return { applied: false, fromTool: task.tool, toTool: null, planVersion: null, reason: 'Task is not in a replannable state', gap: `task_status_${task.status}` };
  }
  const previous = listDecisionRecords(input.workspaceId, input.missionId)
    .filter((record) => record.kind === 'adaptive-replan' && (record.comparison as Record<string, unknown> | null)?.['taskId'] === input.taskId);
  if (previous.length >= 2) {
    return { applied: false, fromTool: task.tool, toTool: null, planVersion: null, reason: 'Adaptive replan limit reached', gap: 'adaptive_replan_limit' };
  }
  const toolInput = input.toolInput ?? openTaskToolInput<Record<string, unknown>>(input.workspaceId, task.id, task.tool_input, {});
  const candidate = alternativeForTask({ tool: task.tool, toolInput });
  if (!candidate) {
    return { applied: false, fromTool: task.tool, toTool: null, planVersion: null, reason: 'No implemented equivalent alternative exists', gap: 'no_implemented_alternative' };
  }
  const lastRun = db.prepare("SELECT issues, summary FROM os_runs WHERE task_id = ? AND status IN ('failed', 'retrying') ORDER BY started_at DESC LIMIT 1")
    .get(task.id) as { issues?: string; summary?: string } | undefined;
  const previousFailure = parseJson<string[]>(lastRun?.issues, []);
  let version: PlanVersion | null = null;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE os_tasks SET tool = ?, tool_input = ?, fallback_tools = '[]', input_bindings = '[]', status = ?, detail = ?, agent_id = NULL, updated_at = ? WHERE id = ?")
      .run(candidate.tool, sealTaskToolInput(input.workspaceId, task.id, candidate.input), 'planned',
        `adaptive_replan: ${task.tool ?? 'none'} -> ${candidate.tool}; ${candidate.rationale}`.slice(0, 500), nowIso(), task.id);
    version = replanMission(input.workspaceId, input.missionId, `adaptive method transition ${task.tool} -> ${candidate.tool}: ${input.reason}`, input.actor);
    saveDecisionRecord({
      workspaceId: input.workspaceId, missionId: input.missionId, kind: 'adaptive-replan',
      comparison: {
        taskId: task.id, fromTool: task.tool, toTool: candidate.tool,
        previousFailure, rationale: candidate.rationale,
        planVersion: version.version, inputDigest: candidate.input,
      },
      reason: input.reason.slice(0, 500), actor: input.actor,
    });
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  }
  audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'task.adaptive_replan', subject: task.id, detail: { missionId: input.missionId, from: task.tool, to: candidate.tool, planVersion: version?.version ?? null } });
  return { applied: true, fromTool: task.tool, toTool: candidate.tool, planVersion: version, reason: candidate.rationale, gap: null };
}
