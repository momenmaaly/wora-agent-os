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
    default:
      break;
  }
  return failures.length
    ? { id: 'output-contract', kind: 'api-contract', description: 'The tool output satisfies its documented contract', status: 'failed', evidence: failures.join('; ') }
    : { id: 'output-contract', kind: 'api-contract', description: 'The tool output satisfies its documented contract', status: 'passed', evidence: tool ?? 'generic object contract' };
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
