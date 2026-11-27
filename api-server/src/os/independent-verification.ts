/**
 * WORA OS — independent verification checks.
 *
 * The executor reports what happened; this module checks the actual output
 * against a contract, deterministic properties, secret-leak signatures and an
 * artifact digest. It never trusts a tool's self-report and never mutates the
 * output. The orchestrator combines these checks with its acceptance review.
 */
import { createHash } from 'node:crypto';
import { SECRET_PATTERNS } from './secrets.js';
import { verifyAssignmentSolution, verifyEmployeeSchedule, verifyLpSolution, type ScientificVerification } from './scientific-verification.js';
import { verifyTsp, verifyVrp, type TspModel, type TspResult, type VrpModel, type VrpResult } from './routing.js';
import type { AssignmentResult, LpModel, LpResult, ScheduleInput, ScheduleResult } from './ortools.js';

export interface IndependentCheck {
  id: string;
  kind: string;
  description: string;
  status: 'passed' | 'failed' | 'not_run';
  evidence?: string;
}

export interface IndependentVerification {
  passed: boolean;
  checks: IndependentCheck[];
  failures: string[];
  artifactDigest: string;
}

const digest = (value: unknown): string => {
  try { return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex'); }
  catch { return ''; }
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);



function strings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 20 || value == null) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { for (const entry of value) strings(entry, out, depth + 1); return out; }
  if (isRecord(value)) { for (const entry of Object.values(value)) strings(entry, out, depth + 1); }
  return out;
}

function hasContent(value: unknown, depth = 0): boolean {
  if (depth > 20 || value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some((entry) => hasContent(entry, depth + 1));
  if (isRecord(value)) return Object.values(value).some((entry) => hasContent(entry, depth + 1));
  return false;
}

function contractCheck(tool: string | null, output: unknown): IndependentCheck {
  if (!isRecord(output)) {
    return { id: 'output-contract', kind: 'api-contract', description: 'The tool returns a structured object', status: 'failed', evidence: 'Output is null or not an object' };
  }
  const failures: string[] = [];
  switch (tool) {
    case 'forecast.linear':
      if (!Array.isArray(output['projections'])) failures.push('projections must be an array');
      break;
    case 'or.employee_schedule':
      if (!Array.isArray(output['assignments'])) failures.push('assignments must be an array');
      if (!Array.isArray(output['perShift'])) failures.push('perShift must be an array');
      break;
    case 'or.assignment':
      if (!Array.isArray(output['assignments'])) failures.push('assignments must be an array');
      if (!finite(output['totalCost'])) failures.push('totalCost must be finite');
      break;
    case 'or.solve_lp':
      if (typeof output['status'] !== 'string') failures.push('status must be a string');
      if (typeof output['variables'] !== 'object' || output['variables'] === null) failures.push('variables must be an object');
      if (typeof output['verification'] !== 'object' || output['verification'] === null) failures.push('verification must be present');
      break;
    case 'graph.shortest_path':
      if (!Array.isArray(output['path'])) failures.push('path must be an array');
      if (output['totalCost'] !== null && !finite(output['totalCost'])) failures.push('totalCost must be finite or null');
      if (typeof output['verification'] !== 'object' || output['verification'] === null) failures.push('verification must be present');
      break;
    case 'meta.formulate_scientific_problem':
      if (typeof output['executable'] !== 'boolean') failures.push('executable must be boolean');
      if (!Array.isArray(output['decisionVariables'])) failures.push('decisionVariables must be an array');
      break;
    case 'sim.monte_carlo':
      if (!finite(output['mean']) || !finite(output['p10']) || !finite(output['p90'])) failures.push('mean/p10/p90 must be finite');
      break;
    case 'scaffold.webapp':
      if (!Array.isArray(output['files'])) failures.push('files must be an array');
      if (typeof output['testPassed'] !== 'boolean') failures.push('testPassed must be boolean');
      break;
    case 'system.diagnostics':
      if (!finite(output['cpus'])) failures.push('cpus must be a number');
      break;
    case 'web.fetch_read':
      if (!finite(output['status'])) failures.push('status must be a number');
      break;
    case 'browser.open':
    case 'browser.inspect':
      if (typeof output['markdown'] !== 'string' && tool === 'browser.inspect') failures.push('markdown must be a string');
      if (tool === 'browser.open' && typeof output['title'] !== 'string') failures.push('title must be a string');
      break;
    case 'browser.screenshot':
      if (typeof output['artifactId'] !== 'string') failures.push('artifactId must be a string');
      if (!finite(output['bytes'])) failures.push('bytes must be a number');
      break;
    case 'browser.research':
      if (typeof output['documentArtifactId'] !== 'string' || typeof output['screenshotArtifactId'] !== 'string') failures.push('both artifact IDs are required');
      if (typeof output['markdown'] !== 'string') failures.push('markdown must be a string');
      break;
    case 'cloud.write_file':
      if (!finite(output['bytes'])) failures.push('bytes must be a number');
      break;
    case 'cloud.exec':
      if (typeof output['exitCode'] !== 'number' && output['exitCode'] !== null) failures.push('exitCode must be a number or null');
      break;
    default:
      break;
  }
  return failures.length
    ? { id: 'output-contract', kind: 'api-contract', description: 'The tool output satisfies its documented contract', status: 'failed', evidence: failures.join('; ') }
    : { id: 'output-contract', kind: 'api-contract', description: 'The tool output satisfies its documented contract', status: 'passed', evidence: tool ?? 'generic object contract' };
}

function modelOf(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null;
  return isRecord(input['model']) ? input['model'] : input;
}

function verificationCheck(id: string, description: string, verification: ScientificVerification): IndependentCheck {
  return {
    id, kind: 'recomputation', description,
    status: verification.passed ? 'passed' : 'failed',
    evidence: verification.passed
      ? `${verification.checks.length} independent check(s) passed`
      : verification.failures.slice(0, 5).join('; ') || 'independent verification failed',
  };
}

function recomputationChecks(tool: string | null, toolInput: unknown, output: unknown): IndependentCheck[] {
  const model = modelOf(toolInput);
  if (!model || !isRecord(output)) return [];
  const checks: IndependentCheck[] = [];
  try {
    if (tool === 'or.assignment' && Array.isArray(model['costMatrix']) && Array.isArray(output['assignments'])) {
      checks.push(verificationCheck('recompute-assignment', 'Assignment indices, uniqueness and total cost are recomputed from the input matrix',
        verifyAssignmentSolution(model['costMatrix'] as number[][], output as unknown as AssignmentResult)));
    }
    if (tool === 'or.employee_schedule' && Array.isArray(model['employees']) && Array.isArray(model['shifts']) && Array.isArray(output['assignments'])) {
      checks.push(verificationCheck('recompute-schedule', 'Demand, availability, workload and labor cost are recomputed from the input roster',
        verifyEmployeeSchedule({ employees: model['employees'], shifts: model['shifts'] } as ScheduleInput, output as unknown as ScheduleResult)));
    }
    if (tool === 'or.solve_lp' && Array.isArray(model['objective']) && Array.isArray(model['constraints']) && isRecord(output['variables'])) {
      checks.push(verificationCheck('recompute-lp', 'Objective value, constraints, bounds and integrality are recomputed from the input model',
        verifyLpSolution(model as unknown as LpModel, output as unknown as LpResult)));
    }
    if (tool === 'routing.tsp' && (Array.isArray(model['points']) || Array.isArray(model['distanceMatrix'])) && Array.isArray(output['tour'])) {
      checks.push(verificationCheck('recompute-tsp', 'Tour coverage and distance are recomputed from the input points or matrix',
        verifyTsp(model as unknown as TspModel, output as unknown as TspResult)));
    }
    if (tool === 'routing.vrp' && Array.isArray(model['depots']) && Array.isArray(model['customers']) && Array.isArray(model['vehicles']) && Array.isArray(output['routes'])) {
      checks.push(verificationCheck('recompute-vrp', 'Customer coverage, capacity, route distance and approximation label are recomputed from the input model',
        verifyVrp(model as unknown as VrpModel, output as unknown as VrpResult)));
    }
  } catch (error) {
    checks.push({
      id: 'recompute-error', kind: 'recomputation',
      description: 'The independent verifier can recompute the result from the input',
      status: 'failed', evidence: error instanceof Error ? error.message : 'recomputation failed',
    });
  }
  return checks;
}

function propertyChecks(tool: string | null, output: unknown): IndependentCheck[] {
  if (!isRecord(output)) return [];
  const checks: IndependentCheck[] = [];
  if (tool === 'or.employee_schedule') {
    const feasible = output['feasible'] === true;
    const assignments = Array.isArray(output['assignments']) ? output['assignments'] : [];
    const perShift = Array.isArray(output['perShift']) ? output['perShift'] as Array<Record<string, unknown>> : [];
    const costOk = feasible ? finite(output['totalCost']) && Number(output['totalCost']) >= 0 : output['totalCost'] === null;
    const demandOk = !feasible || perShift.every((shift) => shift['meetsDemand'] === true);
    checks.push({
      id: 'property-schedule', kind: 'property', description: 'A feasible schedule has non-negative cost and covers every shift demand',
      status: costOk && demandOk && (feasible ? assignments.length > 0 : true) ? 'passed' : 'failed',
      evidence: `feasible=${feasible}; assignments=${assignments.length}; cost=${String(output['totalCost'])}; demandCovered=${demandOk}`,
    });
  }
  if (tool === 'or.assignment') {
    const assignments = Array.isArray(output['assignments']) ? output['assignments'] : [];
    checks.push({
      id: 'property-assignment', kind: 'property', description: 'An assignment has a finite non-negative total and one row per assigned pair',
      status: finite(output['totalCost']) && Number(output['totalCost']) >= 0 && assignments.length > 0 ? 'passed' : 'failed',
      evidence: `assignments=${assignments.length}; totalCost=${String(output['totalCost'])}`,
    });
  }
  if (tool === 'forecast.linear') {
    const projections = Array.isArray(output['projections']) ? output['projections'] as Array<Record<string, unknown>> : [];
    const ordered = projections.every((entry, index) => finite(entry['point']) && finite(entry['bandLow']) && finite(entry['bandHigh']) && Number(entry['bandLow']) <= Number(entry['point']) && Number(entry['point']) <= Number(entry['bandHigh']) && (index === 0 || Number(entry['step']) > Number(projections[index - 1]!['step'])));
    checks.push({
      id: 'property-forecast', kind: 'property', description: 'Forecast projections are ordered and bands contain the point estimate',
      status: projections.length > 0 && ordered ? 'passed' : 'failed', evidence: `${projections.length} projection(s)`,
    });
  }
  if (tool === 'or.solve_lp') {
    const status = output['status'];
    const verification = output['verification'] as { passed?: boolean } | undefined;
    checks.push({ id: 'property-lp', kind: 'property', description: 'An optimal LP/MIP result passes independent constraint, objective and bound verification', status: status !== 'Optimal' || verification?.passed === true ? 'passed' : 'failed', evidence: `status=${String(status)}; verification=${String(verification?.passed)}` });
  }
  if (tool === 'graph.shortest_path') {
    const status = output['status'];
    const path = Array.isArray(output['path']) ? output['path'] : [];
    const verification = output['verification'] as { passed?: boolean } | undefined;
    const cost = output['totalCost'];
    const valid = status === 'no_path'
      ? path.length === 0 && cost === null
      : status === 'optimal' && path.length >= 2 && finite(cost) && Number(cost) >= 0;
    checks.push({ id: 'property-shortest-path', kind: 'property', description: 'A shortest-path result is consistent with its status and passes independent verification', status: valid && verification?.passed === true ? 'passed' : 'failed', evidence: `status=${String(status)}; path=${path.length}; cost=${String(cost)}; verification=${String(verification?.passed)}` });
  }
  if (tool === 'sim.monte_carlo') {
    const ordered = finite(output['p10']) && finite(output['p50']) && finite(output['p90']) && Number(output['p10']) <= Number(output['p50']) && Number(output['p50']) <= Number(output['p90']);
    checks.push({ id: 'property-quantiles', kind: 'property', description: 'Simulated quantiles are ordered p10 ≤ p50 ≤ p90', status: ordered ? 'passed' : 'failed', evidence: `p10=${String(output['p10'])} p50=${String(output['p50'])} p90=${String(output['p90'])}` });
  }
  return checks;
}

export function verifyIndependently(input: {
  tool: string | null; toolInput?: unknown; toolOk: boolean; output: unknown; error?: string | null; evidence?: unknown;
}): IndependentVerification {
  const checks: IndependentCheck[] = [];
  const failures: string[] = [];
  if (!input.toolOk) {
    checks.push({ id: 'executor-result', kind: 'runtime', description: 'The executor returned without an error', status: 'failed', evidence: input.error ?? 'unknown tool error' });
    failures.push(input.error ?? 'Tool execution failed');
  }
  checks.push(contractCheck(input.tool, input.output));
  checks.push({
    id: 'output-quality', kind: 'quality', description: 'A successful tool produced non-empty output',
    status: input.toolOk && hasContent(input.output) ? 'passed' : 'failed',
    evidence: input.toolOk ? (hasContent(input.output) ? 'Output contains content.' : 'Output was empty.') : 'Tool did not succeed.',
  });
  checks.push(...propertyChecks(input.tool, input.output));
  checks.push(...recomputationChecks(input.tool, input.toolInput, input.output));

  const leaked: string[] = [];
  const scan = [...strings(input.output), ...strings(input.evidence)];
  for (const text of scan) {
    for (const signature of SECRET_PATTERNS) if (signature.pattern.test(text)) leaked.push(signature.id);
  }
  checks.push({
    id: 'secret-leak', kind: 'security', description: 'Output contains no high-confidence credential signature',
    status: leaked.length ? 'failed' : 'passed', evidence: leaked.length ? [...new Set(leaked)].join(', ') : 'no credential signatures found',
  });
  if (leaked.length) failures.push(`Possible secret leak: ${[...new Set(leaked)].join(', ')}`);

  const artifactDigest = digest({ output: input.output, evidence: input.evidence ?? null });
  checks.push({
    id: 'artifact-integrity', kind: 'integrity', description: 'The verifier recorded a digest of the output and evidence',
    status: artifactDigest ? 'passed' : 'failed', evidence: artifactDigest || 'digest unavailable',
  });
  if (!artifactDigest) failures.push('Artifact digest could not be computed');

  for (const check of checks) if (check.status === 'failed' && check.id !== 'executor-result') failures.push(`${check.id}: ${check.evidence ?? 'failed'}`);
  return { passed: failures.length === 0, checks, failures: [...new Set(failures)], artifactDigest };
}
