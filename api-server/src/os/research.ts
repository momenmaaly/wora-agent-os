/**
 * WORA OS — evidence-grounded research planning and synthesis.
 *
 * The planner decides when external research is actually needed, turns open
 * reasoning needs into searchable questions, selects existing retrieval tools
 * and preserves provenance. It never performs a search during planning and
 * never turns a missing source into a finding.
 */
import { createHash } from 'node:crypto';
import type { UnifiedProblem } from './problem-model.js';
import type { ReasoningEvidenceInput, ReasoningModel } from './reasoning-types.js';

export const RESEARCH_SCHEMA_VERSION = '1.0';

export type ResearchStatus = 'not-needed' | 'planned' | 'partial' | 'answered' | 'unanswered';
export type ResearchSourceKind = 'web' | 'memory' | 'tool';
export type ResearchStance = 'supports' | 'contradicts' | 'neutral' | 'unclear';

export interface ResearchQuestion {
  id: string;
  question: string;
  parentNeedId: string | null;
  materiality: 'critical' | 'high' | 'medium' | 'low';
  rationale: string;
  searchable: boolean;
}

export interface ResearchSource {
  id: string;
  kind: ResearchSourceKind;
  locator: string;
  tool: string;
  title: string;
  questionIds: string[];
  excerpt?: string;
  retrievedAt?: string | null;
}

export interface ResearchPlan {
  schemaVersion: typeof RESEARCH_SCHEMA_VERSION;
  needed: boolean;
  status: ResearchStatus;
  objective: string;
  questions: ResearchQuestion[];
  sources: ResearchSource[];
  reason: string;
  limitations: string[];
  maxSources: number;
}

export interface ResearchFinding {
  id: string;
  questionIds: string[];
  sourceId: string | null;
  tool: string;
  url: string | null;
  title: string | null;
  retrievedAt: string;
  status: number | null;
  excerpt: string;
  digest: string;
  truncated: boolean;
  stance: ResearchStance;
  strength: 'strong' | 'moderate' | 'weak' | 'none';
  note: string;
}

export interface ResearchConflict {
  questionId: string;
  findingIds: string[];
  note: string;
}

export interface ResearchSynthesis {
  schemaVersion: typeof RESEARCH_SCHEMA_VERSION;
  status: ResearchStatus;
  questions: ResearchQuestion[];
  findings: ResearchFinding[];
  answeredQuestionIds: string[];
  unansweredQuestionIds: string[];
  conflicts: ResearchConflict[];
  weakEvidence: string[];
  sourcesUsed: string[];
  limitations: string[];
  evidence: ReasoningEvidenceInput[];
}

export interface ResearchState {
  plan: ResearchPlan;
  findings: ResearchFinding[];
  synthesis: ResearchSynthesis;
  updatedAt: string;
}

export interface ResearchSummary {
  needed: boolean;
  status: ResearchStatus;
  questionCount: number;
  sourceCount: number;
  findingCount: number;
  unansweredCount: number;
  conflictCount: number;
  questions: Array<{ id: string; question: string; materiality: ResearchQuestion['materiality'] }>;
  sources: Array<{ kind: ResearchSourceKind; locator: string; tool: string }>;
  limitations: string[];
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'which', 'when', 'where', 'why', 'how',
  'does', 'did', 'are', 'was', 'were', 'is', 'be', 'been', 'about', 'into', 'over', 'under', 'than',
  'then', 'there', 'their', 'they', 'you', 'your', 'our', 'can', 'could', 'should', 'would', 'will',
  'في', 'من', 'على', 'إلى', 'عن', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'ما', 'هل', 'كيف', 'لماذا',
]);

function idFor(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha1').update(value).digest('hex').slice(0, 12)}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => (value ?? '').trim()).filter(Boolean))];
}

function tokens(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((token) => !STOPWORDS.has(token));
}

function overlap(left: string, right: string): number {
  const rightTokens = new Set(tokens(right));
  return tokens(left).filter((token) => rightTokens.has(token)).length;
}

function sanitizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|signature|sig/i.test(key)) url.searchParams.set(key, '[redacted]');
    }
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeText(value: string): string {
  return value.replace(/https?:\/\/[^\s)"']+/g, (raw) => sanitizeUrl(raw) ?? '[redacted-url]');
}

export function extractUrls(text: string): string[] {
  return unique((text.match(/https?:\/\/[^\s)"']+/g) ?? [])
    .map(sanitizeUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, 5));
}

function researchIntent(text: string): boolean {
  return /research|investigate|study|sources?|evidence|cite|bibliograph|literature|market\s+(?:study|analysis|research)|public record|بحث|دراسة|مصادر|دليل|مراجع|تحقق/iu.test(text);
}

function researchTopic(text: string): boolean {
  return /market|regulat|news|latest|current|external|public|سوق|تنظيم|أخبار|خارجي/iu.test(text);
}

function researchableQuestion(question: string): boolean {
  return /web|source|market|regulat|news|document|public|external|latest|current|internet|evidence|report|study|مصدر|ويب|سوق|تنظيم|أخبار|خارجي|دليل|تقرير|دراسة/iu.test(question);
}

function sourceTitle(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function planResearch(input: {
  objective: string;
  reasoning?: ReasoningModel | null;
  problem?: UnifiedProblem | null;
  urls?: string[];
  maxSources?: number;
}): ResearchPlan {
  const objective = sanitizeText(input.objective.trim()).slice(0, 4000);
  const urls = unique((input.urls ?? extractUrls(objective)).map(sanitizeUrl).filter((url): url is string => Boolean(url))).slice(0, input.maxSources ?? 5);
  const openNeeds = (input.reasoning?.informationNeeds ?? []).filter((need) => need.status === 'open');
  const gatherNeeds = openNeeds.filter((need) => (need.canSelfGather || need.recommendedAction === 'gather-self') && researchableQuestion(need.question));
  const highNeeds = openNeeds.filter((need) => need.materiality === 'critical' || need.materiality === 'high');
  const researchDomain = input.problem?.domain === 'research' || input.problem?.needs.includes('research') === true;
  const needed = urls.length > 0 || researchDomain || gatherNeeds.length > 0
    || (researchIntent(objective) && (researchTopic(objective) || highNeeds.length > 0 || (input.problem?.unknowns.length ?? 0) > 0 || input.problem?.uncertainty !== 'none'));

  if (!needed) {
    return {
      schemaVersion: RESEARCH_SCHEMA_VERSION, needed: false, status: 'not-needed', objective, questions: [], sources: [],
      reason: 'The deterministic problem model found no external research requirement; no search or fetch was planned.',
      limitations: ['No research was performed.'], maxSources: input.maxSources ?? 5,
    };
  }

  const questions: ResearchQuestion[] = [];
  const seen = new Set<string>();
  const addQuestion = (question: string, parentNeedId: string | null, materiality: ResearchQuestion['materiality'], rationale: string) => {
    const clean = sanitizeText(question.trim()).slice(0, 500);
    const key = clean.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/gu, ' ').trim();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    questions.push({ id: idFor('rq', clean), question: clean, parentNeedId, materiality, rationale, searchable: true });
  };

  const candidates = (gatherNeeds.length ? gatherNeeds : highNeeds).slice(0, 3);
  for (const need of candidates) addQuestion(need.question, need.id, need.materiality, need.rationale);
  if (questions.length === 0) addQuestion(`What verifiable evidence answers: ${objective}?`, null, 'high', 'The objective requests research but the reasoning model has no narrower open question.');
  for (const question of [...questions].slice(0, 2)) {
    addQuestion(`What evidence contradicts or qualifies: ${question.question}`, question.parentNeedId, 'high', 'Counter-evidence is required to avoid one-sided synthesis.');
  }
  for (const url of urls.slice(0, 3)) {
    addQuestion(`What does ${sourceTitle(url)} establish that is relevant to the objective?`, null, 'medium', 'The user supplied this source explicitly.');
  }

  const questionIds = questions.map((question) => question.id);
  const sources: ResearchSource[] = [];
  for (const url of urls) {
    sources.push({
      id: idFor('rs', url), kind: 'web', locator: url, tool: 'web.fetch_read', title: sourceTitle(url),
      questionIds,
    });
  }
  const limitations = ['Planning only: no external source was fetched and no finding exists until a retrieval tool runs.'];
  if (sources.length === 0) limitations.push('No explicit source URL was available; WORA did not search, fabricate a source, or claim access. Workspace memory remains a separate, deletable record and is not copied into research.');
  return {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    needed: true,
    status: sources.length ? 'planned' : 'unanswered',
    objective,
    questions: questions.slice(0, 8),
    sources: sources.slice(0, input.maxSources ?? 5),
    reason: urls.length
      ? `${urls.length} explicit source(s) and ${questions.length} research question(s) were planned.`
      : gatherNeeds.length
        ? `${gatherNeeds.length} reasoning information need(s) can be researched; no source was assumed.`
        : 'The objective requests research and the problem model has unresolved unknowns.',
    limitations,
    maxSources: input.maxSources ?? 5,
  };
}

function classifyStance(text: string, question: string): { stance: ResearchStance; note: string } {
  const sentences = (text.match(/[^.!?\n]+[.!?]?/g) ?? [text]).map((sentence) => sentence.trim()).filter(Boolean);
  const best = sentences.map((sentence) => ({ sentence, score: overlap(sentence, question) })).sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 2) return { stance: 'unclear', note: 'No lexical overlap with the research question; the source may be unrelated.' };
  const negated = /\b(?:not|no|never|false|myth|does not|is not|are not|was not|were not|cannot|can't)\b|غير|ليس|لا\s/iu.test(best.sentence);
  if (negated) return { stance: 'contradicts', note: 'A sentence with lexical overlap contains an explicit negation; this is a heuristic contradiction candidate, not proof.' };
  return { stance: best.score >= 3 ? 'supports' : 'neutral', note: 'Heuristic lexical support; the source is not independently verified.' };
}

function strengthOf(status: number | null, excerpt: string): ResearchFinding['strength'] {
  if (status !== null && status >= 400) return 'none';
  if (excerpt.length >= 400) return 'moderate';
  if (excerpt.length >= 120) return 'weak';
  return 'none';
}

export function findingFromToolOutput(input: {
  taskId: string;
  runId: string;
  tool: string;
  output: unknown;
  plan?: ResearchPlan | null;
}): ResearchFinding | null {
  const out = (input.output ?? {}) as Record<string, unknown>;
  const text = typeof out['text'] === 'string' ? out['text']
    : typeof out['markdown'] === 'string' ? out['markdown']
      : typeof out['content'] === 'string' ? out['content']
        : null;
  if (!text || !text.trim()) return null;
  const excerpt = text.trim().slice(0, 1200);
  const url = typeof out['url'] === 'string' ? out['url'] : typeof out['finalUrl'] === 'string' ? out['finalUrl'] : null;
  const status = typeof out['status'] === 'number' ? out['status'] : null;
  const question = input.plan?.questions[0]?.question ?? input.plan?.objective ?? '';
  const stance = classifyStance(excerpt, question);
  const digestValue = digest(excerpt);
  const questionIds = input.plan?.questions
    .map((item) => ({ id: item.id, score: overlap(excerpt, item.question) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => item.id) ?? [];
  return {
    id: `finding:${input.taskId}:${digestValue.slice(0, 12)}`,
    questionIds: questionIds.length ? questionIds : (input.plan?.questions.map((item) => item.id) ?? []),
    sourceId: input.plan?.sources.find((source) => source.locator === url)?.id ?? null,
    tool: input.tool,
    url,
    title: typeof out['title'] === 'string' ? out['title'] : url,
    retrievedAt: new Date().toISOString(),
    status,
    excerpt,
    digest: digestValue,
    truncated: out['truncated'] === true,
    stance: stance.stance,
    strength: strengthOf(status, excerpt),
    note: stance.note,
  };
}

export function synthesizeResearch(input: { plan: ResearchPlan; findings: ResearchFinding[] }): ResearchSynthesis {
  const findings = input.findings.filter((finding, index, all) => all.findIndex((entry) => entry.id === finding.id) === index);
  const answeredQuestionIds: string[] = [];
  const unansweredQuestionIds: string[] = [];
  const conflicts: ResearchConflict[] = [];
  for (const question of input.plan.questions) {
    const related = findings.filter((finding) => finding.questionIds.includes(question.id) || finding.questionIds.length === 0);
    const supports = related.filter((finding) => finding.stance === 'supports' && (finding.status === null || finding.status < 400) && finding.excerpt.length >= 40);
    const contradicts = related.filter((finding) => finding.stance === 'contradicts' && (finding.status === null || finding.status < 400) && finding.excerpt.length >= 40);
    if (supports.length && contradicts.length) {
      answeredQuestionIds.push(question.id);
      conflicts.push({
        questionId: question.id,
        findingIds: [...supports, ...contradicts].map((finding) => finding.id),
        note: 'Heuristic sources disagree; the conflict is unresolved and requires an authoritative source or human review.',
      });
    } else if (supports.length) answeredQuestionIds.push(question.id);
    else if (related.some((finding) => (finding.status === null || finding.status < 400) && finding.excerpt.length >= 40)) answeredQuestionIds.push(question.id);
    else unansweredQuestionIds.push(question.id);
  }
  const weakEvidence = findings
    .filter((finding) => finding.tool !== 'memory.search' && (finding.status === null || finding.status >= 400 || finding.strength === 'none' || finding.strength === 'weak'))
    .map((finding) => finding.id);
  const sourcesUsed = unique(findings.filter((finding) => finding.status === null || finding.status < 400).map((finding) => finding.url));
  const evidence: ReasoningEvidenceInput[] = findings
    .filter((finding) => (finding.status === null || finding.status < 400) && finding.excerpt.trim().length >= 40)
    .map((finding) => {
      const question = input.plan.questions.find((item) => finding.questionIds.includes(item.id));
      return {
        id: `research-evidence:${finding.id}`,
        statement: `${question ? `${question.question} — ` : ''}${finding.excerpt.slice(0, 600)}`.slice(0, 800),
        kind: 'retrieved-evidence' as const,
        source: finding.url ?? finding.tool,
        sourceId: finding.id,
        trust: 'unverified' as const,
        confidence: finding.strength === 'moderate' ? 0.55 : finding.strength === 'weak' ? 0.35 : 0.2,
        observedAt: finding.retrievedAt,
      };
    });
  const usable = findings.filter((finding) => (finding.status === null || finding.status < 400) && finding.excerpt.trim().length >= 40);
  const status: ResearchStatus = input.plan.status === 'not-needed' ? 'not-needed'
    : usable.length === 0 ? 'unanswered'
      : unansweredQuestionIds.length ? 'partial' : 'answered';
  const limitations = [...input.plan.limitations,
    'Research synthesis is extractive and heuristic; it does not establish truth, causality, or currentness without explicit source dates.',
  ];
  if (findings.length === 0) limitations.push('No finding was retrieved; every research question remains unanswered.');
  return {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    status,
    questions: input.plan.questions,
    findings,
    answeredQuestionIds,
    unansweredQuestionIds,
    conflicts,
    weakEvidence,
    sourcesUsed,
    limitations: unique(limitations),
    evidence,
  };
}

export function researchSummary(state: ResearchState | null | undefined): ResearchSummary | null {
  if (!state) return null;
  return {
    needed: state.plan.needed,
    status: state.synthesis.status,
    questionCount: state.plan.questions.length,
    sourceCount: state.plan.sources.length,
    findingCount: state.synthesis.findings.length,
    unansweredCount: state.synthesis.unansweredQuestionIds.length,
    conflictCount: state.synthesis.conflicts.length,
    questions: state.plan.questions.map((question) => ({ id: question.id, question: question.question, materiality: question.materiality })),
    sources: state.plan.sources.map((source) => ({ kind: source.kind, locator: source.locator, tool: source.tool })),
    limitations: state.synthesis.limitations.slice(0, 3),
  };
}
