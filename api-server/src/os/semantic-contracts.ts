/**
 * WORA OS — machine-readable semantic capability contracts.
 *
 * Structural JSON-schema equality is not semantic equivalence. This module
 * records meaning, units, preconditions, side effects, determinism, precision,
 * error behavior, security and verification requirements for a capability and
 * evaluates whether one capability may replace another.
 *
 * Unknown or unparseable contracts are never considered compatible.
 */
import { getTool } from './tools.js';

export const SEMANTIC_CONTRACT_SCHEMA_VERSION = '1.0';

export type SideEffect = 'none' | 'workspace_read' | 'workspace_write' | 'external_read' | 'external_write' | 'unknown';
export type PrecisionKind = 'exact' | 'tolerance' | 'unknown';

export interface SemanticContract {
  schemaVersion: typeof SEMANTIC_CONTRACT_SCHEMA_VERSION;
  /** Stable semantic identity, not the tool name or package id. */
  id: string;
  version: string;
  inputMeaning: string;
  outputMeaning: string;
  inputUnits: Record<string, string>;
  outputUnits: Record<string, string>;
  inputTypes: Record<string, string>;
  outputTypes: Record<string, string>;
  preconditions: string[];
  postconditions: string[];
  sideEffects: SideEffect;
  deterministic: boolean;
  precision: { kind: PrecisionKind; tolerance?: number; unit?: string };
  errorBehavior: string;
  security: {
    dataClasses: string[];
    network: boolean;
    requiredPermissions: string[];
    maxRisk: 'low' | 'medium' | 'high';
  };
  verification: string[];
  resource: { costClass: 'low' | 'medium' | 'high'; latencyClass: 'low' | 'medium' | 'high' };
  /** Evidence supporting the contract itself; empty means unproven. */
  evidence: string[];
  confidence: number;
}

export interface SemanticCompatibilityCheck {
  id: string;
  status: 'passed' | 'failed';
  evidence: string;
}

export interface SemanticCompatibility {
  compatible: boolean;
  confidence: number;
  checks: SemanticCompatibilityCheck[];
  reasons: string[];
}

const builtinContracts: Record<string, SemanticContract> = {
  'text.extract_summary': {
    schemaVersion: '1.0', id: 'text.summary.v1', version: '1.0.0',
    inputMeaning: 'Natural-language text to summarize', outputMeaning: 'A shortened natural-language summary',
    inputUnits: { text: 'utf8-text', sentences: 'count' }, outputUnits: { summary: 'utf8-text', sentenceCount: 'count' },
    inputTypes: { text: 'string', sentences: 'integer' }, outputTypes: { summary: 'string', sentenceCount: 'integer' },
    preconditions: ['input text is present'], postconditions: ['summary is non-empty when input is non-empty'],
    sideEffects: 'none', deterministic: true, precision: { kind: 'exact' },
    errorBehavior: 'returns an execution error; never invents text',
    security: { dataClasses: ['workspace-content'], network: false, requiredPermissions: ['memory:read'], maxRisk: 'low' },
    verification: ['output-contract', 'output-quality', 'secret-leak'],
    resource: { costClass: 'low', latencyClass: 'low' }, evidence: ['deterministic core implementation'], confidence: 0.99,
  },
  'stats.describe': {
    schemaVersion: '1.0', id: 'stats.descriptive.v1', version: '1.0.0',
    inputMeaning: 'Finite numeric series', outputMeaning: 'Descriptive statistics over that exact series',
    inputUnits: { series: 'number' }, outputUnits: { mean: 'number', stddev: 'number', min: 'number', max: 'number' },
    inputTypes: { series: 'array<number>' }, outputTypes: { count: 'integer', mean: 'number', stddev: 'number', min: 'number', max: 'number' },
    preconditions: ['series contains at least one finite number'], postconditions: ['count equals the input series length', 'quantiles are ordered'],
    sideEffects: 'none', deterministic: true, precision: { kind: 'tolerance', tolerance: 1e-9, unit: 'number' },
    errorBehavior: 'returns an execution error for an invalid series',
    security: { dataClasses: ['workspace-content'], network: false, requiredPermissions: [], maxRisk: 'low' },
    verification: ['output-contract', 'property-statistics', 'secret-leak'],
    resource: { costClass: 'low', latencyClass: 'low' }, evidence: ['deterministic core implementation'], confidence: 0.99,
  },
  'or.assignment': {
    schemaVersion: '1.0', id: 'optimization.assignment.cost.v1', version: '1.0.0',
    inputMeaning: 'Cost matrix for a one-to-one assignment problem', outputMeaning: 'Optimal assignment and its total cost',
    inputUnits: { costMatrix: 'cost', totalCost: 'cost' }, outputUnits: { totalCost: 'cost' },
    inputTypes: { costMatrix: 'array<array<number>>' }, outputTypes: { assignments: 'array<object>', totalCost: 'number' },
    preconditions: ['costs are finite and non-negative'], postconditions: ['assignment covers every row exactly once', 'totalCost equals the sum of selected costs'],
    sideEffects: 'none', deterministic: true, precision: { kind: 'exact' },
    errorBehavior: 'returns an execution error for an infeasible or malformed matrix',
    security: { dataClasses: ['workspace-content'], network: false, requiredPermissions: [], maxRisk: 'low' },
    verification: ['output-contract', 'property-assignment', 'secret-leak'],
    resource: { costClass: 'low', latencyClass: 'low' }, evidence: ['Hungarian solver implementation'], confidence: 0.98,
  },
  'or.employee_schedule': {
    schemaVersion: '1.0', id: 'optimization.employee-schedule.cost.v1', version: '1.0.0',
    inputMeaning: 'Employees, availability, shift demand and hourly costs', outputMeaning: 'Feasible employee-to-shift schedule and total labor cost',
    inputUnits: { hourlyCost: 'currency', totalCost: 'currency', demand: 'people' }, outputUnits: { totalCost: 'currency' },
    inputTypes: { employees: 'array<object>', shifts: 'array<object>' }, outputTypes: { feasible: 'boolean', assignments: 'array<object>', totalCost: 'number|null' },
    preconditions: ['employee and shift identifiers are unique'], postconditions: ['every shift demand is met when feasible', 'no employee exceeds maxAssignments'],
    sideEffects: 'none', deterministic: true, precision: { kind: 'exact' },
    errorBehavior: 'returns feasible=false with a reason instead of inventing a schedule',
    security: { dataClasses: ['workspace-content'], network: false, requiredPermissions: [], maxRisk: 'low' },
    verification: ['output-contract', 'property-schedule', 'secret-leak'],
    resource: { costClass: 'medium', latencyClass: 'medium' }, evidence: ['MIP employee-schedule solver'], confidence: 0.95,
  },
  'sim.monte_carlo': {
    schemaVersion: '1.0', id: 'simulation.monte-carlo.v1', version: '1.0.0',
    inputMeaning: 'Independent three-point estimates and a deterministic seed', outputMeaning: 'Simulated distribution summary',
    inputUnits: { optimistic: 'number', likely: 'number', pessimistic: 'number' }, outputUnits: { mean: 'number', p10: 'number', p90: 'number' },
    inputTypes: { trials: 'integer', seed: 'integer', items: 'array<object>' }, outputTypes: { mean: 'number', p10: 'number', p50: 'number', p90: 'number' },
    preconditions: ['optimistic <= likely <= pessimistic'], postconditions: ['p10 <= p50 <= p90'],
    sideEffects: 'none', deterministic: true, precision: { kind: 'tolerance', tolerance: 1e-6, unit: 'number' },
    errorBehavior: 'returns an execution error for invalid estimates',
    security: { dataClasses: ['workspace-content'], network: false, requiredPermissions: [], maxRisk: 'low' },
    verification: ['output-contract', 'property-quantiles', 'secret-leak'],
    resource: { costClass: 'medium', latencyClass: 'medium' }, evidence: ['seeded Monte Carlo implementation'], confidence: 0.95,
  },
  'forecast.linear': {
    schemaVersion: '1.0', id: 'forecast.linear.v1', version: '1.0.0',
    inputMeaning: 'Ordered numeric time-series observations', outputMeaning: 'Linear trend point projections with uncertainty bands',
    inputUnits: { step: 'step', point: 'value' }, outputUnits: { step: 'step', point: 'value' },
    inputTypes: { series: 'array<number>' }, outputTypes: { projections: 'array<object>' },
    preconditions: ['series has at least two observations'], postconditions: ['projection steps are ordered', 'bands contain the point estimate'],
    sideEffects: 'none', deterministic: true, precision: { kind: 'tolerance', tolerance: 1e-9, unit: 'value' },
    errorBehavior: 'returns an execution error when the series is insufficient',
    security: { dataClasses: ['workspace-content'], network: false, requiredPermissions: [], maxRisk: 'low' },
    verification: ['output-contract', 'property-forecast', 'secret-leak'],
    resource: { costClass: 'low', latencyClass: 'low' }, evidence: ['linear trend implementation'], confidence: 0.9,
  },
  'decision.weighted_matrix': {
    schemaVersion: '1.0', id: 'decision.weighted-matrix.v1', version: '1.0.0',
    inputMeaning: 'Options, weighted criteria and scores', outputMeaning: 'Ranked options with normalized weighted scores',
    inputUnits: { weight: 'ratio', score: 'score' }, outputUnits: { score: 'score', rank: 'rank' },
    inputTypes: { options: 'array<object>', criteria: 'array<object>' }, outputTypes: { ranking: 'array<object>' },
    preconditions: ['criteria weights are finite'], postconditions: ['ranking is ordered by score'],
    sideEffects: 'none', deterministic: true, precision: { kind: 'tolerance', tolerance: 1e-9, unit: 'score' },
    errorBehavior: 'returns an execution error for malformed criteria',
    security: { dataClasses: ['workspace-content'], network: false, requiredPermissions: [], maxRisk: 'low' },
    verification: ['output-contract', 'output-quality', 'secret-leak'],
    resource: { costClass: 'low', latencyClass: 'low' }, evidence: ['deterministic weighted matrix implementation'], confidence: 0.95,
  },
  'web.fetch_read': {
    schemaVersion: '1.0', id: 'web.read.v1', version: '1.0.0',
    inputMeaning: 'Public HTTP(S) URL to read', outputMeaning: 'Authoritative HTTP status, title and extracted text',
    inputUnits: { url: 'url' }, outputUnits: { status: 'http-status', bytes: 'bytes' },
    inputTypes: { url: 'string' }, outputTypes: { status: 'integer', title: 'string', text: 'string' },
    preconditions: ['URL is public HTTPS and allowed by network policy'], postconditions: ['status reflects the authoritative response'],
    sideEffects: 'external_read', deterministic: false, precision: { kind: 'unknown' },
    errorBehavior: 'returns an execution error or the authoritative non-2xx status',
    security: { dataClasses: ['public-web'], network: true, requiredPermissions: ['web:read'], maxRisk: 'medium' },
    verification: ['output-contract', 'secret-leak'],
    resource: { costClass: 'medium', latencyClass: 'medium' }, evidence: ['safe-fetch implementation'], confidence: 0.85,
  },
  'system.diagnostics': {
    schemaVersion: '1.0', id: 'host.diagnostics.v1', version: '1.0.0',
    inputMeaning: 'No input', outputMeaning: 'Observed host health signals',
    inputUnits: {}, outputUnits: { cpus: 'count', usedPercent: 'percent' },
    inputTypes: {}, outputTypes: { cpus: 'integer', memory: 'object', findings: 'array<string>' },
    preconditions: [], postconditions: ['reported values come from the host runtime'],
    sideEffects: 'workspace_read', deterministic: false, precision: { kind: 'unknown' },
    errorBehavior: 'returns an execution error if host inspection fails',
    security: { dataClasses: ['host-metadata'], network: false, requiredPermissions: ['host:read'], maxRisk: 'low' },
    verification: ['output-contract', 'secret-leak'],
    resource: { costClass: 'low', latencyClass: 'low' }, evidence: ['host runtime implementation'], confidence: 0.9,
  },
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) if (typeof entry === 'string') out[key] = entry;
  return out;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean) : [];
}

/** Parse an untrusted manifest/storage contract. Returns null when incomplete. */
export function parseSemanticContract(raw: unknown): SemanticContract | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const precision = value['precision'] && typeof value['precision'] === 'object' ? value['precision'] as Record<string, unknown> : {};
  const security = value['security'] && typeof value['security'] === 'object' ? value['security'] as Record<string, unknown> : {};
  const resource = value['resource'] && typeof value['resource'] === 'object' ? value['resource'] as Record<string, unknown> : {};
  const sideEffects = String(value['sideEffects'] ?? 'unknown');
  const precisionKind = String(precision['kind'] ?? 'unknown');
  const risk = String(security['maxRisk'] ?? 'high');
  if (!['none', 'workspace_read', 'workspace_write', 'external_read', 'external_write', 'unknown'].includes(sideEffects)) return null;
  if (!['exact', 'tolerance', 'unknown'].includes(precisionKind)) return null;
  if (!['low', 'medium', 'high'].includes(risk)) return null;
  if (typeof value['id'] !== 'string' || typeof value['inputMeaning'] !== 'string' || typeof value['outputMeaning'] !== 'string') return null;
  const confidence = typeof value['confidence'] === 'number' && Number.isFinite(value['confidence']) ? value['confidence'] : 0;
  return {
    schemaVersion: '1.0', id: value['id'], version: String(value['version'] ?? '0.0.0'),
    inputMeaning: value['inputMeaning'], outputMeaning: value['outputMeaning'],
    inputUnits: stringRecord(value['inputUnits']), outputUnits: stringRecord(value['outputUnits']),
    inputTypes: stringRecord(value['inputTypes']), outputTypes: stringRecord(value['outputTypes']),
    preconditions: stringArray(value['preconditions']), postconditions: stringArray(value['postconditions']),
    sideEffects: sideEffects as SideEffect, deterministic: value['deterministic'] === true,
    precision: { kind: precisionKind as PrecisionKind, tolerance: typeof precision['tolerance'] === 'number' ? precision['tolerance'] : undefined, unit: typeof precision['unit'] === 'string' ? precision['unit'] : undefined },
    errorBehavior: String(value['errorBehavior'] ?? ''),
    security: { dataClasses: stringArray(security['dataClasses']), network: security['network'] === true, requiredPermissions: stringArray(security['requiredPermissions']), maxRisk: risk as 'low' | 'medium' | 'high' },
    verification: stringArray(value['verification']),
    resource: { costClass: String(resource['costClass'] ?? 'high') as 'low' | 'medium' | 'high', latencyClass: String(resource['latencyClass'] ?? 'high') as 'low' | 'medium' | 'high' },
    evidence: stringArray(value['evidence']), confidence: Math.max(0, Math.min(1, confidence)),
  };
}

/** Contract for a registered core or plugin tool. Unknown tools have none. */
export function semanticContractFor(toolId: string, workspaceId?: string): SemanticContract | null {
  const tool = getTool(toolId, workspaceId);
  if (tool?.semanticContract) return tool.semanticContract;
  return builtinContracts[toolId] ?? null;
}

function check(id: string, passed: boolean, evidence: string): SemanticCompatibilityCheck {
  return { id, status: passed ? 'passed' : 'failed', evidence };
}

function precisionAllows(primary: SemanticContract['precision'], fallback: SemanticContract['precision']): boolean {
  if (primary.kind === 'unknown') return fallback.kind !== 'unknown';
  if (fallback.kind === 'unknown') return false;
  if (primary.kind === 'exact') return fallback.kind === 'exact';
  return fallback.kind === 'exact' || (fallback.kind === 'tolerance' && typeof fallback.tolerance === 'number' && typeof primary.tolerance === 'number' && fallback.tolerance <= primary.tolerance);
}

/**
 * Evaluate semantic replacement. A fallback must be equal in meaning and
 * contracts, no broader in side effects/security, no weaker in verification,
 * and supported by enough contract evidence for the primary risk level.
 */
export function compareSemanticContracts(primary: SemanticContract | null, fallback: SemanticContract | null, risk: 'low' | 'medium' | 'high' = 'low'): SemanticCompatibility {
  const checks: SemanticCompatibilityCheck[] = [];
  const reasons: string[] = [];
  if (!primary) { checks.push(check('primary-contract', false, 'Primary capability has no semantic contract.')); reasons.push('Primary capability has no semantic contract.'); }
  if (!fallback) { checks.push(check('fallback-contract', false, 'Fallback capability has no semantic contract.')); reasons.push('Fallback capability has no semantic contract.'); }
  if (!primary || !fallback) return { compatible: false, confidence: 0, checks, reasons };

  const add = (id: string, passed: boolean, evidence: string) => {
    checks.push(check(id, passed, evidence));
    if (!passed) reasons.push(evidence);
  };
  add('semantic-identity', primary.id === fallback.id, `${primary.id} vs ${fallback.id}`);
  add('input-meaning', primary.inputMeaning === fallback.inputMeaning, `input meaning: "${primary.inputMeaning}" vs "${fallback.inputMeaning}"`);
  add('output-meaning', primary.outputMeaning === fallback.outputMeaning, `output meaning: "${primary.outputMeaning}" vs "${fallback.outputMeaning}"`);
  add('input-units', canonical(primary.inputUnits) === canonical(fallback.inputUnits), canonical({ primary: primary.inputUnits, fallback: fallback.inputUnits }));
  add('output-units', canonical(primary.outputUnits) === canonical(fallback.outputUnits), canonical({ primary: primary.outputUnits, fallback: fallback.outputUnits }));
  add('input-types', canonical(primary.inputTypes) === canonical(fallback.inputTypes), canonical({ primary: primary.inputTypes, fallback: fallback.inputTypes }));
  add('output-types', canonical(primary.outputTypes) === canonical(fallback.outputTypes), canonical({ primary: primary.outputTypes, fallback: fallback.outputTypes }));
  add('preconditions', canonical(primary.preconditions) === canonical(fallback.preconditions), `preconditions: ${primary.preconditions.join('; ')} vs ${fallback.preconditions.join('; ')}`);
  add('postconditions', canonical(primary.postconditions) === canonical(fallback.postconditions), `postconditions: ${primary.postconditions.join('; ')} vs ${fallback.postconditions.join('; ')}`);
  add('side-effects', primary.sideEffects === fallback.sideEffects, `${primary.sideEffects} vs ${fallback.sideEffects}`);
  add('determinism', !primary.deterministic || fallback.deterministic, `primary deterministic=${primary.deterministic}; fallback=${fallback.deterministic}`);
  add('precision', precisionAllows(primary.precision, fallback.precision), canonical({ primary: primary.precision, fallback: fallback.precision }));
  add('error-behavior', primary.errorBehavior === fallback.errorBehavior, `error behavior: "${primary.errorBehavior}" vs "${fallback.errorBehavior}"`);
  const permissions = new Set(primary.security.requiredPermissions);
  const extraPermissions = fallback.security.requiredPermissions.filter((permission) => !permissions.has(permission));
  add('permissions', extraPermissions.length === 0, extraPermissions.length ? `Fallback requires extra permissions: ${extraPermissions.join(', ')}` : 'no permission expansion');
  add('network', !fallback.security.network || primary.security.network, `network: ${primary.security.network} vs ${fallback.security.network}`);
  const riskRank = { low: 0, medium: 1, high: 2 } as const;
  add('risk', riskRank[fallback.security.maxRisk] <= riskRank[primary.security.maxRisk], `risk: ${primary.security.maxRisk} vs ${fallback.security.maxRisk}`);
  const verification = new Set(fallback.verification);
  const missingVerification = primary.verification.filter((id) => !verification.has(id));
  add('verification', missingVerification.length === 0, missingVerification.length ? `Fallback lacks verification checks: ${missingVerification.join(', ')}` : 'verification coverage retained');
  const requiredConfidence = risk === 'high' ? 0.95 : risk === 'medium' ? 0.8 : 0.6;
  add('evidence-confidence', fallback.evidence.length > 0 && fallback.confidence >= requiredConfidence, `confidence ${fallback.confidence} (required ${requiredConfidence}); evidence=${fallback.evidence.length}`);
  return {
    compatible: reasons.length === 0,
    confidence: Math.min(primary.confidence, fallback.confidence),
    checks,
    reasons: [...new Set(reasons)],
  };
}

export function evaluateSemanticCompatibility(input: {
  primaryTool: string; fallbackTool: string; workspaceId?: string; risk?: 'low' | 'medium' | 'high';
}): SemanticCompatibility {
  return compareSemanticContracts(
    semanticContractFor(input.primaryTool, input.workspaceId),
    semanticContractFor(input.fallbackTool, input.workspaceId),
    input.risk,
  );
}

export function listBuiltinSemanticContracts(): SemanticContract[] {
  return Object.values(builtinContracts);
}
