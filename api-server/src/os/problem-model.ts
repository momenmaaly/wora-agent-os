/**
 * WORA OS — canonical unified problem representation.
 *
 * This extends the existing deterministic problem profile; it does not replace
 * it. The representation separates what the user stated, what was retrieved,
 * what is assumed and what remains unknown. It never fills a missing
 * requirement with an invented fact.
 */
import { getOsDb, newId, nowIso, parseJson } from './db.js';
import { understandProblem, type ProblemDomain, type ProblemProfile } from './problem.js';
import { DEFAULT_MISSION_MEMORY_SCOPES, memoryAccessibleTo, recordMemoryRetrieval, searchMemories, type MemoryScope, type MemorySourceClass, type MemoryVerificationStatus } from './memory.js';
import { redactSecrets } from './secrets.js';
import type { ReasoningSummary } from './reasoning-types.js';
import type { ProblemStructure } from './problem-structure.js';

export const UNIFIED_PROBLEM_SCHEMA_VERSION = '1.0';

export type ProvenanceKind = 'user-objective' | 'retrieved-memory' | 'assumption' | 'inferred';
export type Reversibility = 'reversible' | 'costly' | 'irreversible';
export type Precision = 'exact' | 'approximate' | 'bounds' | 'unknown';

export interface ProblemFact {
  id: string;
  statement: string;
  provenance: ProvenanceKind;
  source: string;
  confidence: number | null;
}

export interface RetrievedEvidence extends ProblemFact {
  provenance: 'retrieved-memory';
  memoryId: string;
  score: number;
  memoryScope?: MemoryScope;
  memoryVerificationStatus?: MemoryVerificationStatus;
  memorySourceClass?: MemorySourceClass;
}

export interface MemoryRetrievalSummary {
  id: string;
  actor: string;
  scopes: MemoryScope[];
  scopeIds: Partial<Record<MemoryScope, string[]>>;
  selectedIds: string[];
}

export interface MethodPlan {
  selected: ProblemProfile['scientific']['method'];
  rejected: Array<{ name: string; reason: string; status: string }>;
  missing: string[];
  rationale: string[];
  assumptions: string[];
}

export interface UnifiedProblem {
  schemaVersion: typeof UNIFIED_PROBLEM_SCHEMA_VERSION;
  objective: string;
  desiredOutcome: string;
  successCriteria: string[];
  domain: ProblemDomain;
  subdomains: string[];
  problemTypes: string[];
  facts: ProblemFact[];
  evidence: RetrievedEvidence[];
  assumptions: ProblemFact[];
  unknowns: string[];
  constraints: string[];
  dependencies: string[];
  resources: string[];
  requiredResources: string[];
  limits: { timeMs: number | null; costUsd: number | null; note: string };
  risk: 'low' | 'medium' | 'high';
  reversibility: Reversibility;
  uncertainty: 'none' | 'low' | 'medium' | 'high';
  deterministic: boolean;
  stochastic: boolean;
  precision: Precision;
  approvals: string[];
  needs: string[];
  methods: MethodPlan;
  confidence: number;
  provenance: string[];
  baseProfile: ProblemProfile;
  /** Compact reference to the evidence-grounded reasoning model, when one was built. */
  reasoning?: ReasoningSummary;
  structure?: ProblemStructure;
  memoryRetrieval?: MemoryRetrievalSummary;
  createdAt: string;
}

const unique = (values: Array<string | null | undefined>): string[] => [...new Set(values.map((value) => (value ?? '').trim()).filter(Boolean))];

function sentenceFacts(objective: string): ProblemFact[] {
  return (objective.match(/[^.!?\n]+[.!?]?/g) ?? [objective])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((statement, index) => ({
      id: `fact-${index}`, statement: statement.slice(0, 500), provenance: 'user-objective',
      source: 'objective', confidence: 1,
    }));
}

function needsFor(profile: ProblemProfile, objective: string): string[] {
  const needs = new Set<string>(['analysis', 'verification']);
  for (const requirement of profile.features.requires ?? []) needs.add(requirement);
  if (profile.domain === 'software_engineering' || profile.domain === 'organization' || /software architecture|qa specialist|specialist agents|multi-agent/iu.test(objective)) needs.add('engineering');
  if (profile.domain === 'research') needs.add('research');
  if (profile.domain === 'diagnostics') needs.add('diagnostics');
  if (profile.features.hasTimeSeries) needs.add('forecasting');
  if (profile.features.hasCriteria || /compare|strateg(?:y|ies)|alternatives?|choose|rank|قارن|بدائل/iu.test(objective)) needs.add('decision');
  if (profile.features.hasUncertainty) needs.add('simulation');
  if (/plugin|mcp|integration|echo|external service|api/iu.test(objective)) needs.add('integration');
  if (profile.features.riskLevel === 'high') needs.add('approval');
  return [...needs];
}

function parseLimits(objective: string): UnifiedProblem['limits'] {
  const time = /(\d+)\s*(?:minutes?|mins?|دقائق|دقيقة)/iu.exec(objective);
  const cost = /(?:\$|usd\s*)(\d[\d,]*(?:\.\d+)?)/iu.exec(objective);
  return {
    timeMs: time?.[1] ? Number(time[1]) * 60_000 : null,
    costUsd: cost?.[1] ? Number(cost[1].replace(/,/g, '')) : null,
    note: time || cost ? 'Parsed from explicit text; values are user-provided, not estimates.' : 'No explicit time or cost limit was supplied.',
  };
}

export function modelProblem(input: {
  workspaceId: string;
  objective: string;
  track?: string;
  includeMemory?: boolean;
  actor?: string;
  missionId?: string | null;
  scopes?: MemoryScope[];
  scopeIds?: Partial<Record<MemoryScope, string[]>>;
  onlyVerifiedSemantic?: boolean;
}): UnifiedProblem {
  const objective = input.objective.trim().slice(0, 4000);
  if (!objective) throw new Error('Objective is required');
  const profile = understandProblem({ objective, track: input.track });
  const facts = sentenceFacts(objective);
  const evidence: RetrievedEvidence[] = [];
  let memoryRetrieval: MemoryRetrievalSummary | undefined;
  if (input.includeMemory !== false) {
    try {
      const actor = input.actor ?? 'system';
      const scopes = input.scopes ?? DEFAULT_MISSION_MEMORY_SCOPES;
      const selected = searchMemories(input.workspaceId, objective, {
        limit: 3, actor, scopes, scopeIds: input.scopeIds,
        onlyVerifiedSemantic: input.onlyVerifiedSemantic ?? true,
      });
      memoryRetrieval = recordMemoryRetrieval({
        workspaceId: input.workspaceId, actor, missionId: input.missionId ?? null,
        purpose: 'problem-model', query: objective, selectedIds: selected.map((memory) => memory.id),
        scopes, scopeIds: input.scopeIds, limit: 3,
      });
      for (const memory of selected) {
        evidence.push({
          id: `memory-${memory.id}`, memoryId: memory.id,
          statement: memory.content.slice(0, 500), provenance: 'retrieved-memory',
          source: `memory:${memory.id}`, confidence: null, score: memory.score,
          memoryScope: memory.scope, memoryVerificationStatus: memory.verificationStatus,
          memorySourceClass: memory.sourceClass,
        });
      }
    } catch { /* retrieval is optional; absence is not evidence */ }
  }
  const assumptions: ProblemFact[] = unique([
    ...profile.algorithmSelection.assumptions,
    ...(profile.successCriteria.length ? [] : ['No explicit acceptance criteria were supplied; deterministic acceptance checks will be used and shown to the user.']),
    ...(profile.constraints.length ? [] : ['No explicit constraints were supplied; the objective text is the only constraint source.']),
  ]).map((statement, index) => ({
    id: `assumption-${index}`, statement: statement.slice(0, 500), provenance: 'assumption',
    source: 'deterministic-rules', confidence: 0.5,
  }));
  const risk = profile.features.riskLevel ?? 'low';
  const selectedMethod = profile.scientific.method;
  const methods: MethodPlan = {
    selected: selectedMethod,
    rejected: profile.scientific.rejectedAlternatives.map((entry) => ({ name: entry.name, reason: entry.reason, status: entry.status })),
    missing: profile.scientific.gap ? [profile.scientific.gap.requiredCapability] : [],
    rationale: [...profile.scientific.rationale],
    assumptions: [...profile.scientific.assumptions],
  };
  return redactSecrets({
    schemaVersion: UNIFIED_PROBLEM_SCHEMA_VERSION,
    objective,
    desiredOutcome: profile.successCriteria[0] ?? objective,
    successCriteria: [...profile.successCriteria],
    domain: profile.domain,
    subdomains: unique([profile.scientific.domainName]),
    problemTypes: unique([profile.features.problemType, ...(profile.features.requires ?? [])]),
    facts,
    evidence,
    assumptions,
    unknowns: [...profile.missingInformation],
    constraints: [...profile.constraints],
    dependencies: [...profile.dependencies],
    resources: [...profile.resources],
    requiredResources: [],
    limits: parseLimits(objective),
    risk,
    reversibility: risk === 'high' ? 'irreversible' : risk === 'medium' ? 'costly' : 'reversible',
    uncertainty: profile.features.uncertaintyLevel ?? 'none',
    deterministic: profile.features.deterministic !== false,
    stochastic: profile.features.stochastic === true,
    precision: (profile.features.precision ?? 'unknown') as Precision,
    approvals: risk === 'high' ? ['Human approval is required before any high-impact action.'] : [],
    needs: needsFor(profile, objective),
    methods,
    confidence: profile.confidence,
    provenance: [
      'objective:user-provided', 'problem-profile:deterministic-rules',
      ...(evidence.length ? ['memory:retrieved'] : []), 'assumptions:explicit',
    ],
    baseProfile: profile,
    memoryRetrieval,
    createdAt: nowIso(),
  }).value as UnifiedProblem;
}

export function saveProblemModel(workspaceId: string, missionId: string, model: UnifiedProblem): void {
  const db = getOsDb();
  const existing = db.prepare('SELECT id FROM os_problem_models WHERE workspace_id = ? AND mission_id = ?').get(workspaceId, missionId) as { id?: string } | undefined;
  const ts = nowIso();
  if (existing?.id) {
    db.prepare('UPDATE os_problem_models SET model = ?, created_at = ? WHERE workspace_id = ? AND mission_id = ?')
      .run(JSON.stringify(redactSecrets(model).value).slice(0, 120_000), ts, workspaceId, missionId);
    return;
  }
  db.prepare('INSERT INTO os_problem_models (id, workspace_id, mission_id, model, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(newId('pmd'), workspaceId, missionId, JSON.stringify(redactSecrets(model).value).slice(0, 120_000), ts);
}

export function getProblemModel(workspaceId: string, missionId: string): UnifiedProblem | null {
  const row = getOsDb().prepare('SELECT model FROM os_problem_models WHERE workspace_id = ? AND mission_id = ?')
    .get(workspaceId, missionId) as { model?: string } | undefined;
  const parsed = row ? parseJson<UnifiedProblem | null>(row.model, null) : null;
  return parsed ? redactSecrets(parsed).value : null;
}

/** Re-authorize persisted memory evidence at read time; revocation must apply to old snapshots. */
export function filterProblemForActor(model: UnifiedProblem, workspaceId: string, actor: string): UnifiedProblem {
  const evidence = model.evidence
    .filter((entry) => !entry.memoryId || memoryAccessibleTo(workspaceId, entry.memoryId, actor))
    .map((entry) => ({ ...entry, statement: redactSecrets(entry.statement).value }));
  const memoryRetrieval = model.memoryRetrieval
    ? { ...model.memoryRetrieval, selectedIds: model.memoryRetrieval.selectedIds.filter((id) => memoryAccessibleTo(workspaceId, id, actor)) }
    : undefined;
  return { ...model, evidence, ...(memoryRetrieval ? { memoryRetrieval } : {}) };
}
