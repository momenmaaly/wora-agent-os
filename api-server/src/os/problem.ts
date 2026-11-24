/**
 * WORA OS — structured problem understanding.
 *
 * This is a deterministic interpretation layer, not a claim of semantic
 * intelligence. It extracts explicit constraints, resources, uncertainty and
 * success criteria from the objective, derives structured algorithm-selection
 * features, and preserves a deterministic planner fallback when information is
 * missing.
 */
import { getOsDb, nowIso, parseJson } from './db.js';
import { selectAlgorithm, type AlgorithmSelection, type ProblemFeatures } from './algorithms.js';

export const PROBLEM_SCHEMA_VERSION = '1.0';

export const PROBLEM_DOMAINS = [
  'software_engineering',
  'operations_research',
  'data_intelligence',
  'organization',
  'research',
  'diagnostics',
  'general',
] as const;

export type ProblemDomain = (typeof PROBLEM_DOMAINS)[number];

export interface ProblemProfile {
  schemaVersion: typeof PROBLEM_SCHEMA_VERSION;
  objective: string;
  domain: ProblemDomain;
  plannerTrack: string | null;
  confidence: number;
  constraints: string[];
  dependencies: string[];
  resources: string[];
  uncertainty: string[];
  successCriteria: string[];
  missingInformation: string[];
  ambiguity: string[];
  features: ProblemFeatures;
  algorithmSelection: AlgorithmSelection;
  fallback: { strategy: 'deterministic-planner'; reason: string };
  source: 'deterministic-rules';
}

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const sentences = (text: string) => (text.match(/[^.!?\n]+[.!?]?/g) ?? [text]).map((sentence) => sentence.trim()).filter(Boolean).slice(0, 40);

function domainOf(text: string): { domain: ProblemDomain; track: string | null; confidence: number } {
  if (/(inspect|diagnos|check|audit|scan)\b.{0,80}\b(computer|machine|device|laptop|pc|server|host|system)\b|حاسوب|فحص.*جهاز/i.test(text)) {
    return { domain: 'diagnostics', track: 'diagnostics', confidence: 0.8 };
  }
  if (/optimi[sz]e|schedul|allocat|assignment|linear program|shift|employee|مخزون|جدولة|توزيع|تخصيص/i.test(text)) {
    return { domain: 'operations_research', track: 'optimization', confidence: 0.8 };
  }
  if (/forecast|time series|statistic|data pipeline|analytics|dataset|تنبؤ|بيانات/i.test(text)) {
    return { domain: 'data_intelligence', track: 'data', confidence: 0.75 };
  }
  if (/organization|organisation|company|marketplace|startup|منظمة|شركة/i.test(text)) {
    return { domain: 'organization', track: 'organization', confidence: 0.75 };
  }
  if (/research|investigate|study|source|url|بحث/i.test(text)) {
    return { domain: 'research', track: 'research', confidence: 0.7 };
  }
  if (/(build|create|develop|make|scaffold|implement)\b.{0,80}\b(web\s*(app|application|site)|application|app|platform|portal|saas|code|software|api)\b|تطبيق ويب|موقع|برمج/i.test(text)) {
    return { domain: 'software_engineering', track: 'webapp', confidence: 0.75 };
  }
  return { domain: 'general', track: null, confidence: 0.35 };
}

function deriveFeatures(text: string): ProblemFeatures {
  return {
    hasCostMatrix: /cost matrix|matrix|مصفوفة/i.test(text) && /cost|تكلفة/i.test(text),
    hasEmployees: /employee|staff|workforce|موظف/i.test(text),
    hasShifts: /shift|schedule|وردية|جدول/i.test(text),
    hasUncertainty: /uncertain|risk|monte carlo|simulat|مخاطر|محاكاة/i.test(text),
    hasTimeSeries: /time series|forecast|trend|سلسلة زمنية|تنبؤ/i.test(text),
    hasCriteria: /criteria|weighted|معايير/i.test(text),
    hasAlternatives: /alternative|vendor|بديل/i.test(text),
    integerVariables: /integer|binary|mip|صحيحة/i.test(text),
    nonlinear: /nonlinear|non-convex|غير خطي/i.test(text),
  };
}

function extractMatches(text: string, pattern: RegExp, cap = 8): string[] {
  return unique(sentences(text).filter((sentence) => pattern.test(sentence))).slice(0, cap);
}

export function understandProblem(input: { objective: string; track?: string }): ProblemProfile {
  const objective = input.objective.trim().slice(0, 4000);
  if (!objective) throw new Error('Objective is required');
  const detected = input.track && input.track !== 'generic'
    ? { domain: (PROBLEM_DOMAINS.includes(input.track as ProblemDomain) ? input.track : domainOf(objective).domain) as ProblemDomain, track: input.track, confidence: 0.9 }
    : domainOf(objective);
  const features = deriveFeatures(objective);
  const algorithmSelection = selectAlgorithm({ objective, features });
  const constraints = extractMatches(objective, /must|should|required|within|under|before|deadline|budget|limit|constraint|يجب|خلال|ميزانية|قيد/i);
  const dependencies = extractMatches(objective, /depends on|after|before|requires|following|بعد|قبل|يعتمد/i);
  const resources = extractMatches(objective, /budget|team|employee|server|database|api|tool|data|ميزانية|فريق|موظف|بيانات/i);
  const uncertainty = extractMatches(objective, /uncertain|estimate|risk|assumption|unknown|احتمال|مخاطر|افتراض/i);
  const successCriteria = extractMatches(objective, /success|accept|pass|verify|test|deliver|نجاح|قبول|تحقق|اختبار/i);
  const missingInformation = unique([
    ...algorithmSelection.missingInformation,
    ...(constraints.length ? [] : ['explicit constraints']),
    ...(successCriteria.length ? [] : ['acceptance criteria']),
  ]);
  const ambiguity = unique([
    ...(objective.length < 20 ? ['objective is terse'] : []),
    ...(detected.domain === 'general' ? ['domain is not explicit'] : []),
    ...(algorithmSelection.status === 'needs_input' ? ['problem class is unresolved'] : []),
    ...(algorithmSelection.status === 'unsupported' ? ['no implemented algorithm covers the stated problem'] : []),
  ]);
  return {
    schemaVersion: PROBLEM_SCHEMA_VERSION,
    objective,
    domain: detected.domain,
    plannerTrack: detected.track,
    confidence: detected.confidence,
    constraints,
    dependencies,
    resources,
    uncertainty,
    successCriteria,
    missingInformation,
    ambiguity,
    features,
    algorithmSelection,
    fallback: {
      strategy: 'deterministic-planner',
      reason: 'Rules and structured features only; no semantic model or external classifier was used.',
    },
    source: 'deterministic-rules',
  };
}

export function saveProblemProfile(workspaceId: string, missionId: string, profile: ProblemProfile): void {
  getOsDb().prepare(`INSERT INTO os_problem_profiles (workspace_id, mission_id, profile, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, mission_id) DO UPDATE SET profile = excluded.profile, created_at = excluded.created_at`)
    .run(workspaceId, missionId, JSON.stringify(profile).slice(0, 60_000), nowIso());
}

export function getProblemProfile(workspaceId: string, missionId: string): ProblemProfile | null {
  const row = getOsDb().prepare('SELECT profile FROM os_problem_profiles WHERE workspace_id = ? AND mission_id = ?').get(workspaceId, missionId) as { profile?: string } | undefined;
  return row ? parseJson<ProblemProfile | null>(row.profile, null) : null;
}
