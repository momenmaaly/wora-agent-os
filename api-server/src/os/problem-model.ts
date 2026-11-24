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
import { searchMemories } from './memory.js';

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
  if (profile.domain === 'software_engineering' || profile.domain === 'organization') needs.add('engineering');
  if (profile.domain === 'research') needs.add('research');
  if (profile.domain === 'diagnostics') needs.add('diagnostics');
  if (profile.features.hasTimeSeries) needs.add('forecasting');
  if (profile.features.hasCriteria) needs.add('decision');
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

export function modelProblem(input: { workspaceId: string; objective: string; track?: string; includeMemory?: boolean }): UnifiedProblem {
  const objective = input.objective.trim().slice(0, 4000);
  if (!objective) throw new Error('Objective is required');
  const profile = understandProblem({ objective, track: input.track });
  const facts = sentenceFacts(objective);
  const evidence: RetrievedEvidence[] = [];
  if (input.includeMemory !== false) {
    try {
      for (const memory of searchMemories(input.workspaceId, objective, { limit: 3 })) {
        evidence.push({
          id: `memory-${memory.id}`, memoryId: memory.id,
          statement: memory.content.slice(0, 500), provenance: 'retrieved-memory',
          source: `memory:${memory.id}`, confidence: null, score: memory.score,
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
  return {
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
    createdAt: nowIso(),
  };
}

export function saveProblemModel(workspaceId: string, missionId: string, model: UnifiedProblem): void {
  const db = getOsDb();
  const existing = db.prepare('SELECT id FROM os_problem_models WHERE workspace_id = ? AND mission_id = ?').get(workspaceId, missionId) as { id?: string } | undefined;
  const ts = nowIso();
  if (existing?.id) {
    db.prepare('UPDATE os_problem_models SET model = ?, created_at = ? WHERE workspace_id = ? AND mission_id = ?')
      .run(JSON.stringify(model).slice(0, 120_000), ts, workspaceId, missionId);
    return;
  }
  db.prepare('INSERT INTO os_problem_models (id, workspace_id, mission_id, model, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(newId('pmd'), workspaceId, missionId, JSON.stringify(model).slice(0, 120_000), ts);
}

export function getProblemModel(workspaceId: string, missionId: string): UnifiedProblem | null {
  const row = getOsDb().prepare('SELECT model FROM os_problem_models WHERE workspace_id = ? AND mission_id = ?')
    .get(workspaceId, missionId) as { model?: string } | undefined;
  return row ? parseJson<UnifiedProblem | null>(row.model, null) : null;
}
