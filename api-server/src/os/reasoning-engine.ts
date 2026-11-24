/**
 * WORA OS — deterministic, evidence-grounded problem reasoning.
 *
 * The engine builds claims with provenance, detects contradictions, generates
 * and ranks hypotheses only when a problem is genuinely uncertain, extracts a
 * limited causal graph, identifies material information needs, and assesses
 * methods against the real scientific catalog. An optional provider may add
 * proposals, but every model proposal remains unverified.
 */
import { createHash } from 'node:crypto';
import { nowIso } from './db.js';
import { modelProblem, type UnifiedProblem } from './problem-model.js';
import { listScientificDomains } from './science.js';
import type {
  CausalEdge, ClaimKind, ClaimProvenance, ClaimTrust, ConfidenceKind, Hypothesis, InformationNeed,
  MethodAssessment, ReasoningChange, ReasoningClaim, ReasoningEvidenceInput, ReasoningModel,
  ReasoningProviderInfo, ReasoningSummary,
} from './reasoning-types.js';
import { REASONING_SCHEMA_VERSION } from './reasoning-types.js';
import { proposeReasoning, reasoningProviderStatus, type ReasoningProposal } from './reasoning-provider.js';

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'were', 'not', 'but', 'you', 'our', 'their', 'its', 'into', 'about', 'after', 'before', 'when', 'where', 'which', 'while', 'because', 'could', 'would', 'should', 'must', 'can', 'may', 'من', 'في', 'على', 'إلى', 'عن', 'أن', 'هذا', 'هذه', 'التي', 'الذي', 'مع', 'أو', 'لا', 'ما', 'هو', 'هي']);

const digest = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 32);
const idFor = (prefix: string, value: unknown): string => `${prefix}_${digest(value).slice(0, 16)}`;
const unique = (values: Array<string | null | undefined>): string[] => [...new Set(values.map((value) => (value ?? '').trim()).filter(Boolean))];
const words = (text: string): string[] => unique(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !STOP.has(word));
const overlap = (a: string, b: string): number => {
  const left = new Set(words(a));
  return words(b).filter((word) => left.has(word)).length;
};
const hasNegation = (text: string): boolean => /\b(?:not|no|never|none|without|cannot|isn't|aren't|doesn't|didn't)\b|(?:لا|ليس|بدون|لم|غير)\b/iu.test(text);
const sentence = (text: string): string => text.trim().replace(/^[-,;:]\s*/u, '').replace(/[,.;:]+$/u, '').slice(0, 800);

function claim(input: {
  statement: string; kind: ClaimKind; provenance: ClaimProvenance;
  confidence?: number; confidenceKind?: ConfidenceKind; confidenceNote?: string;
  evidenceIds?: string[]; supports?: string[]; contradicts?: string[]; id?: string;
}): ReasoningClaim {
  const statement = sentence(input.statement);
  return {
    id: input.id ?? idFor('rcl', `${input.kind}:${statement}`),
    statement,
    kind: input.kind,
    provenance: input.provenance,
    confidence: {
      value: Math.max(0, Math.min(1, input.confidence ?? (input.kind === 'user-fact' ? 1 : 0.5))),
      kind: input.confidenceKind ?? (input.kind === 'user-fact' ? 'deterministic' : 'heuristic'),
      note: input.confidenceNote ?? (input.kind === 'user-fact' ? 'Stated by the user; not independently verified.' : 'Heuristic only; not a calibrated probability.'),
    },
    evidenceIds: input.evidenceIds ?? [],
    supports: input.supports ?? [],
    contradicts: input.contradicts ?? [],
    active: true,
  };
}

function provenance(kind: ClaimProvenance['kind'], sourceId: string, source: string, trust: ClaimTrust): ClaimProvenance {
  return { kind, sourceId, source, trust, observedAt: nowIso(), digest: digest({ sourceId, source }) };
}

function desiredOutcomeOf(objective: string, base: UnifiedProblem): string {
  const explicit = /(?:so that|in order to|to achieve|goal(?: is|:)?|desired outcome(?: is|:)?|الهدف(?: هو|:)?|حتى|من أجل)\s+([^.!?\n]{3,500})/iu.exec(objective);
  if (explicit?.[1]) return sentence(explicit[1]);
  if (base.successCriteria[0]) return sentence(base.successCriteria[0]);
  return sentence(objective);
}

function problemTypeOf(objective: string, base: UnifiedProblem): string {
  if (/root cause|root-cause|troubleshoot|diagnos|\bwhy\b|intermittent|sometimes fails|\b(?:fail(?:s|ed|ure|ures)?|failing|error|incident|outage|bug|broken|discrepancy|mismatch|explains?)\b|سبب|تشخيص|لماذا|فشل|خطأ|عطل/iu.test(objective) || base.domain === 'diagnostics') return 'root_cause_analysis';
  if (/causal|causation|counterfactual|confound|correlat|associated with|linked to|causing|\bcauses?\b|سببية|ارتباط/iu.test(objective)) return 'causal_analysis';
  if (/formal verif|model check|sat solver|smt|proof|تحقق رسمي|إثبات/iu.test(objective)) return 'formal_verification';
  if (/optimi[sz](?:e|ing|ed|ation)?|minimi[sz](?:e|ing|ed|ation)?|maximi[sz](?:e|ing|ed|ation)?|schedul|allocat|assign(?:ed|ing|ment)?|cost matrix|shift|جدولة|توزيع|تخصيص/iu.test(objective)) return 'optimization';
  if (/forecast|time series|trend|estimate\b.{0,40}\b(?:revenue|sales|demand)|sales history|monthly.*history|تنبؤ|سلسلة زمنية/iu.test(objective)) return 'forecasting';
  if (/decision|criteria|alternative|قرار|معايير/iu.test(objective)) return 'decision';
  if (/data|dataset|statistic|analytics|\bmean\b|median|average|numeric series|بيانات|إحصاء/iu.test(objective)) return 'data_analysis';
  if (/build|create|develop|implement|software|app|api|web|تطبيق|برمج/iu.test(objective) || base.domain === 'software_engineering') return 'software_engineering';
  if (/organization|business|market|revenue|customer|شركة|سوق|عملاء/iu.test(objective) || base.domain === 'organization') return 'business_operations';
  if (base.domain === 'research') return 'research';
  return 'general';
}

function initialClaims(base: UnifiedProblem, evidence: ReasoningEvidenceInput[]): ReasoningClaim[] {
  const claims: ReasoningClaim[] = [];
  for (const fact of base.facts) {
    claims.push(claim({ statement: fact.statement, kind: 'user-fact', provenance: provenance('objective', fact.id, 'objective', 'unverified'), confidence: 1, confidenceKind: 'deterministic', confidenceNote: 'Explicit user statement.' }));
  }
  for (const item of base.evidence) {
    claims.push(claim({ statement: item.statement, kind: 'retrieved-evidence', provenance: provenance('retrieved-memory', item.memoryId, item.source, 'unverified'), confidence: 0.35, confidenceKind: 'none', confidenceNote: 'Retrieved memory; relevance is not truth.', evidenceIds: [item.id] }));
  }
  for (const item of base.assumptions) {
    claims.push(claim({ statement: item.statement, kind: 'assumption', provenance: provenance('deterministic-rule', item.id, 'deterministic-rules', 'assumption'), confidence: 0.5, confidenceKind: 'heuristic' }));
  }
  for (const item of base.constraints) {
    claims.push(claim({ statement: item, kind: 'constraint', provenance: provenance('objective', idFor('constraint', item), 'objective', 'unverified'), confidence: 1, confidenceKind: 'deterministic' }));
  }
  for (const item of base.unknowns) {
    claims.push(claim({ statement: item, kind: 'unknown', provenance: provenance('deterministic-rule', idFor('unknown', item), 'deterministic-rules', 'unverified'), confidence: 0.2, confidenceKind: 'none', confidenceNote: 'Missing information; not a fact.' }));
  }
  const objectiveSentences = (base.objective.match(/[^.!?\n]+[.!?]?/g) ?? [base.objective]).map((item) => item.trim()).filter(Boolean);
  for (const item of objectiveSentences) {
    if (/\b(?:assume|assuming|presumably|we believe|suppose)\b|افترض|بافتراض/iu.test(item)) {
      claims.push(claim({ statement: item, kind: 'assumption', provenance: provenance('objective', idFor('assumption', item), 'objective', 'assumption'), confidence: 0.5, confidenceKind: 'heuristic', confidenceNote: 'Explicitly stated as an assumption.' }));
    }
    if (/\b(?:unknown|not sure|unclear|missing|no data|without knowing|do not know|don't know|not know|not decided|undecided|unavailable|not available|no labeled|tbd)\b|غير معروف|غير واضح|لا نعرف|مفقود/iu.test(item)) {
      claims.push(claim({ statement: item, kind: 'unknown', provenance: provenance('objective', idFor('unknown', item), 'objective', 'unverified'), confidence: 0.2, confidenceKind: 'none', confidenceNote: 'Explicitly identified as missing or unknown.' }));
    }
  }
  for (const item of evidence) {
    const verified = item.trust === 'verified' && /^(?:verification|tool|system):/iu.test(item.source);
    const trust: ClaimTrust = item.kind === 'assumption' ? 'assumption' : verified ? 'verified' : 'unverified';
    claims.push(claim({
      statement: item.statement, kind: item.kind,
      provenance: provenance(item.kind === 'assumption' ? 'deterministic-rule' : item.kind === 'retrieved-evidence' ? 'retrieved-memory' : 'user-evidence', item.sourceId ?? item.id ?? idFor('ev', item.statement), item.source, trust),
      confidence: typeof item.confidence === 'number' ? item.confidence : trust === 'verified' ? 0.95 : 0.6,
      confidenceKind: trust === 'verified' ? 'deterministic' : 'uncalibrated',
      confidenceNote: trust === 'verified' ? 'Supplied by an identified verification or tool source.' : 'External/user evidence; not independently verified.',
      evidenceIds: item.id ? [item.id] : [],
    }));
  }
  const seen = new Set<string>();
  return claims.filter((item) => {
    const key = `${item.kind}:${item.statement.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectContradictions(claims: ReasoningClaim[]): string[] {
  const contradictions: string[] = [];
  const candidates = claims.filter((item) => ['user-fact', 'observed-fact', 'retrieved-evidence', 'assumption'].includes(item.kind));
  for (let index = 0; index < candidates.length; index += 1) {
    for (let other = index + 1; other < candidates.length; other += 1) {
      const left = candidates[index]!;
      const right = candidates[other]!;
      if (overlap(left.statement, right.statement) < 2) continue;
      if (hasNegation(left.statement) === hasNegation(right.statement)) continue;
      const statement = `Contradiction between "${left.statement}" and "${right.statement}"`;
      const item = claim({ statement, kind: 'contradiction', provenance: provenance('deterministic-rule', idFor('contr', statement), 'deterministic-rules', 'unverified'), confidence: 0.7, confidenceKind: 'heuristic', confidenceNote: 'Lexical contradiction candidate; requires human or evidence resolution.' });
      item.contradicts = [left.id, right.id];
      claims.push(item);
      left.contradicts.push(item.id);
      right.contradicts.push(item.id);
      contradictions.push(statement);
    }
  }
  return unique(contradictions);
}

interface HypothesisSeed { id: string; cause: string; statement: string; triggers: RegExp; tests: string[]; assumptions: string[]; }
const HYPOTHESES: HypothesisSeed[] = [
  { id: 'resource-exhaustion', cause: 'resource exhaustion', statement: 'Resource exhaustion (CPU, memory, disk or connection pool) explains the observed behavior.', triggers: /memory|cpu|disk|slow|latency|timeout|crash|exhaust|موارد|ذاكرة|بطء|انقطاع/iu, tests: ['Measure CPU, memory and disk at the failure time', 'Compare load with the failure interval'], assumptions: ['The measured resource metric is representative of the failure window.'] },
  { id: 'configuration-drift', cause: 'configuration drift', statement: 'A configuration or deployment change introduced the behavior.', triggers: /config|setting|deploy|release|version|environment|إعداد|نشر|إصدار/iu, tests: ['Diff configuration and deployment versions before and after the first failure', 'Replay the previous configuration in an isolated environment'], assumptions: ['A configuration change is observable in version control or deployment history.'] },
  { id: 'dependency-failure', cause: 'dependency or network failure', statement: 'An external dependency or network path is failing intermittently.', triggers: /network|connection|timeout|api|dependency|vendor|service|شبكة|اتصال|خدمة/iu, tests: ['Trace the failing request across dependency boundaries', 'Check dependency health and retry logs'], assumptions: ['Dependency telemetry exists and timestamps align.'] },
  { id: 'data-quality', cause: 'data quality', statement: 'Incorrect, missing or inconsistent data explains the observed result.', triggers: /data|dataset|missing|null|duplicate|inconsistent|بيانات|ناقص|مكرر/iu, tests: ['Validate the input distribution and missingness', 'Reproduce the result from a frozen data snapshot'], assumptions: ['A reproducible data snapshot is available.'] },
  { id: 'permissions', cause: 'permission or access control', statement: 'A permission or access-control change is blocking the expected operation.', triggers: /permission|access|403|unauthorized|denied|صلاحية|وصول|ممنوع/iu, tests: ['Inspect authorization decisions at the boundary', 'Replay with the previous role and scope'], assumptions: ['Authorization decisions are logged.'] },
  { id: 'concurrency', cause: 'concurrency or race condition', statement: 'A race condition or concurrent write explains the intermittent behavior.', triggers: /race|concurrent|intermittent|sometimes|lock|deadlock|تزامن|أحيانًا|قفل/iu, tests: ['Increase concurrency while recording request order', 'Inspect lock and transaction timelines'], assumptions: ['Concurrent execution can be reproduced safely.'] },
  { id: 'measurement-artifact', cause: 'measurement or observability artifact', statement: 'The observation is a measurement or dashboard artifact rather than a production behavior change.', triggers: /metric|dashboard|observ|sample|instrument|قياس|لوحة|مراقبة/iu, tests: ['Compare raw events with the aggregated metric', 'Check sampling and aggregation definitions'], assumptions: ['Raw events are retained.'] },
  { id: 'security-compromise', cause: 'security compromise', statement: 'Unauthorized access or a compromised component explains the behavior.', triggers: /breach|unauthorized|suspicious|injection|compromise|اختراق|مشبوه|حقن/iu, tests: ['Inspect authentication and access logs for anomalous identities', 'Verify artifact integrity and provenance'], assumptions: ['Security telemetry is trustworthy and time-synchronized.'] },
  { id: 'process-or-human', cause: 'process or human workflow', statement: 'A manual process or workflow step is being applied inconsistently.', triggers: /process|manual|workflow|training|operator|late|delay|overdue|إجراء|يدوي|تدريب|متأخر|تأخير/iu, tests: ['Observe the workflow step directly', 'Compare outcomes across operators or runs'], assumptions: ['The workflow can be observed without changing it.'] },
  { id: 'external-market', cause: 'external market or third-party behavior', statement: 'An external market or third-party change explains the business observation.', triggers: /market|revenue|sales|customer|vendor|third-party|سوق|مبيعات|عميل/iu, tests: ['Compare the change with an external control series', 'Check third-party announcements and service status'], assumptions: ['A control series or external record exists.'] },
];

function shouldHypothesize(problemType: string, objective: string, base: UnifiedProblem): boolean {
  return problemType === 'root_cause_analysis' || problemType === 'causal_analysis'
    || /why|root cause|cause|troubleshoot|diagnos|intermittent|sometimes|hypothes|possibly|likely|سبب|تشخيص|لماذا|أحيانًا/iu.test(objective);
}

function generateHypotheses(claims: ReasoningClaim[], problemType: string, objective: string, base: UnifiedProblem): { hypotheses: Hypothesis[]; claims: ReasoningClaim[] } {
  if (!shouldHypothesize(problemType, objective, base)) return { hypotheses: [], claims: [] };
  const contextClaims = claims.filter((item) => ['user-fact', 'observed-fact', 'retrieved-evidence'].includes(item.kind));
  const clauses = contextClaims.flatMap((item) => item.statement.split(/\b(?:but|however|while|whereas)\b|, but/iu).map((part) => ({ id: item.id, statement: part.trim() })).filter((part) => part.statement));
  const scored = HYPOTHESES.map((seed) => {
    const triggerMatch = seed.triggers.test(objective) || clauses.some((item) => seed.triggers.test(item.statement));
    let score = triggerMatch ? 0.45 : 0.1;
    const evidenceFor: string[] = [];
    const evidenceAgainst: string[] = [];
    for (const item of clauses) {
      if (overlap(item.statement, `${seed.statement} ${seed.cause}`) < 2) continue;
      if (hasNegation(item.statement)) evidenceAgainst.push(item.id);
      else evidenceFor.push(item.id);
      score += hasNegation(item.statement) ? -0.15 : 0.12;
    }
    if (!triggerMatch && evidenceFor.length === 0) score -= 0.1;
    return { seed, score: Math.max(0, Math.min(1, score)), evidenceFor: unique(evidenceFor), evidenceAgainst: unique(evidenceAgainst) };
  }).filter((item) => item.score >= 0.15).sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, 5);
  if (selected.length < 2) {
    selected.push({ seed: { id: 'insufficient-observability', cause: 'insufficient observability', statement: 'The available observations are insufficient to distinguish the remaining explanations.', triggers: /.*/u, tests: ['Collect a complete trace around the failure', 'State what observation would falsify each remaining explanation'], assumptions: ['Additional telemetry can be collected safely.'] }, score: 0.2, evidenceFor: [], evidenceAgainst: [] });
  }
  if (selected.length < 2) {
    selected.push({ seed: { id: 'process-or-human', cause: 'process or human workflow', statement: 'A manual process or workflow step is being applied inconsistently.', triggers: /.*/u, tests: ['Observe the workflow step directly', 'Compare outcomes across operators or runs'], assumptions: ['The workflow can be observed without changing it.'] }, score: 0.2, evidenceFor: [], evidenceAgainst: [] });
  }
  const hypotheses: Hypothesis[] = [];
  const added: ReasoningClaim[] = [];
  selected.forEach((entry, index) => {
    const rejected = entry.evidenceAgainst.length > entry.evidenceFor.length;
    const supported = !rejected && entry.evidenceFor.length >= 2;
    const hypothesisClaim = claim({
      statement: entry.seed.statement, kind: 'hypothesis',
      provenance: provenance('deterministic-rule', entry.seed.id, 'deterministic-rules', 'unverified'),
      confidence: entry.score, confidenceKind: 'heuristic',
      confidenceNote: 'Heuristic ranking from lexical evidence overlap; not a calibrated probability.',
      evidenceIds: [...entry.evidenceFor, ...entry.evidenceAgainst],
    });
    added.push(hypothesisClaim);
    hypotheses.push({
      id: idFor('hyp', entry.seed.id), claimId: hypothesisClaim.id, statement: entry.seed.statement, cause: entry.seed.cause,
      status: rejected ? 'rejected' : supported ? 'supported' : 'candidate', rank: index + 1, score: Number(entry.score.toFixed(3)),
      scoreKind: 'heuristic-uncalibrated', assumptions: entry.seed.assumptions, evidenceFor: entry.evidenceFor,
      evidenceAgainst: entry.evidenceAgainst, distinguishingTests: entry.seed.tests,
      rejectionReason: rejected ? 'Contradicting evidence outweighed supporting evidence in the current model.' : null,
      revision: 1, updatedAt: nowIso(),
    });
  });
  return { hypotheses, claims: added };
}

function extractCausalEdges(objective: string, evidence: ReasoningEvidenceInput[], claims: ReasoningClaim[]): CausalEdge[] {
  const edges: CausalEdge[] = [];
  const sentences = objective.match(/[^.!?\n]+[.!?]?/g) ?? [objective];
  const add = (cause: string, effect: string, relation: CausalEdge['relation'], evidenceKind: CausalEdge['evidenceKind'], confounders: string[], evidenceIds: string[]) => {
    const cleanCause = sentence(cause);
    const cleanEffect = sentence(effect);
    if (!cleanCause || !cleanEffect || cleanCause.toLowerCase() === cleanEffect.toLowerCase()) return;
    const identified = evidenceKind === 'experimental' && confounders.length === 0;
    const limitation = identified
      ? 'Experimental evidence supports this edge; replication and external validity remain open.'
      : evidenceKind === 'observational'
        ? 'Observational association only; correlation is not causation and causal identification is not claimed.'
        : 'Causal direction is asserted or model-proposed, not experimentally identified.';
    edges.push({
      id: idFor('causal', `${cleanCause}->${cleanEffect}:${relation}`), cause: cleanCause, effect: cleanEffect,
      relation, evidenceKind, identified, evidenceIds, confounders,
      limitation, claimId: null,
    });
  };
  for (const raw of sentences) {
    const text = raw.trim().split(/\b(?:but|however)\b/iu)[0]!.trim();
    const causal = /^(.+?)\s+(?:causes?|causing|leads to|results in|produces|triggers|يسبب|يؤدي إلى)\s+(.+)$/iu.exec(text);
    if (causal?.[1] && causal[2]) add(causal[1], causal[2], 'causes', 'assumed', [], []);
    const correlational = /^(.+?)\s+(?:(?:is|are|was|were) associated with|correlates with|(?:is|are|was|were) correlated with|(?:is|are) linked to|مرتبط بـ)\s+(.+)$/iu.exec(text);
    if (correlational?.[1] && correlational[2]) add(correlational[1], correlational[2], 'correlates', 'observational', [], []);
    const due = /^(.+?)\s+(?:because of|due to|بسبب)\s+(.+)$/iu.exec(text);
    if (due?.[1] && due[2]) add(due[2], due[1], 'contributes', 'assumed', [], []);
  }
  for (const item of evidence) {
    const evidenceText = item.statement.replace(/^.*?\b(?:found|showed|demonstrated|indicated|suggests?|that)\b\s+/iu, '');
    const causal = /^(.+?)\s+(?:causes?|leads to|results in|triggers)\s+(.+)$/iu.exec(evidenceText);
    if (causal?.[1] && causal[2]) {
      const experimental = item.experimental === true;
      add(causal[1], causal[2], 'causes', experimental ? 'experimental' : 'observational', item.confounders ?? [], item.id ? [item.id] : []);
    }
  }
  for (const edge of edges) {
    const causalClaim = claim({
      statement: `${edge.cause} ${edge.relation === 'correlates' ? 'correlates with' : 'is proposed to affect'} ${edge.effect}`,
      kind: 'causal-relation',
      provenance: provenance('deterministic-rule', edge.id, edge.evidenceKind === 'experimental' ? 'experimental-evidence' : 'text-or-evidence', 'unverified'),
      confidence: edge.identified ? 0.8 : 0.4, confidenceKind: 'heuristic', confidenceNote: edge.limitation, evidenceIds: edge.evidenceIds,
    });
    edge.claimId = causalClaim.id;
    claims.push(causalClaim);
  }
  return edges;
}

function informationNeeds(claims: ReasoningClaim[], base: UnifiedProblem, problemType: string, contradictions: string[]): InformationNeed[] {
  const needs: InformationNeed[] = [];
  for (const item of claims.filter((entry) => entry.kind === 'unknown')) {
    const explicitUnknown = item.provenance.kind === 'objective';
    const critical = explicitUnknown && /critical|must|blocking|cannot|without|required|sla|target|budget|deadline|data volume|downtime|acceptance|requirement|أساسي|ضروري|لا يمكن|بدون|هدف|ميزانية|حجم/iu.test(item.statement);
    const materiality: InformationNeed['materiality'] = critical ? 'critical' : base.uncertainty === 'high' || problemType === 'causal_analysis' ? 'high' : 'medium';
    const canSelfGather = /log|file|workspace|memory|database|\bdb\b|api|metric|dashboard|tool|سجل|ملف|قاعدة|واجهة/iu.test(item.statement)
      && !/data volume|downtime|tolerance|target|budget|sla|preference|intent|حجم|ميزانية|هدف/iu.test(item.statement);
    const action: InformationNeed['recommendedAction'] = materiality === 'critical' ? (canSelfGather ? 'gather-self' : 'ask-user') : 'proceed-with-assumption';
    needs.push({
      id: idFor('info', item.id), question: item.statement, unknownClaimId: item.id, materiality,
      expectedInformationGain: materiality === 'critical' ? 0.8 : materiality === 'high' ? 0.55 : 0.25,
      cost: { timeMinutes: canSelfGather ? 5 : 10, costUsd: null, risk: 'low', reversible: true },
      canSelfGather, recommendedAction: action,
      rationale: critical
        ? 'This information is required before a defensible decision; proceeding would require an explicit assumption.'
        : 'This information could improve the answer but is not required to proceed; the deterministic plan can continue.',
      status: 'open',
    });
  }
  if (contradictions.length) {
    needs.push({
      id: idFor('info', `contradiction:${contradictions[0]}`), question: 'Which conflicting statement should WORA treat as authoritative, and what evidence supports it?',
      unknownClaimId: null, materiality: 'critical', expectedInformationGain: 0.9,
      cost: { timeMinutes: 5, costUsd: null, risk: 'low', reversible: true }, canSelfGather: false,
      recommendedAction: 'ask-user', rationale: contradictions[0]!, status: 'open',
    });
  }
  return needs;
}

function methodCatalog(): Map<string, { name: string; domain: string; status: MethodAssessment['status']; algorithmId: string | null }> {
  const map = new Map<string, { name: string; domain: string; status: MethodAssessment['status']; algorithmId: string | null }>();
  for (const domain of listScientificDomains()) {
    for (const item of domain.methods) map.set(item.id, { name: item.name, domain: domain.domain, status: item.status, algorithmId: item.algorithmId });
  }
  return map;
}

function methodAssessments(base: UnifiedProblem, problemType: string): MethodAssessment[] {
  const catalog = methodCatalog();
  const assessments = new Map<string, MethodAssessment>();
  const add = (id: string, reason: string, applies: boolean, selected = false) => {
    const entry = catalog.get(id);
    const status = entry?.status ?? 'not_implemented';
    const implemented = status === 'implemented' || status === 'partial';
    assessments.set(id, {
      id, name: entry?.name ?? id.replaceAll('_', ' '), domain: entry?.domain ?? 'reasoning', status, applies,
      reason, requiredInputs: [], assumptions: [], expectedOutputs: [], limitations: [], evidenceRequirements: [],
      implemented, externalCapabilityRequired: !implemented, gap: implemented ? null : `${entry?.name ?? id} is not implemented in the current WORA catalog.`, selected,
    });
  };
  const primary = base.methods.selected;
  if (primary?.name) {
    const algorithmId = base.baseProfile.algorithmSelection.primary?.algorithmId ?? null;
    const methodId = [...catalog.entries()].find(([, value]) => (algorithmId && value.algorithmId === algorithmId) || value.name === primary.name)?.[0] ?? primary.name;
    add(methodId, `The deterministic catalog selected ${primary.name} for this problem class.`, true, true);
    const assessment = assessments.get(methodId);
    if (assessment) {
      assessment.requiredInputs = base.baseProfile.algorithmSelection.primary?.requiredInputs ?? [];
      assessment.assumptions = [...base.baseProfile.algorithmSelection.assumptions];
      assessment.expectedOutputs = ['A verified result from the selected method'];
      assessment.limitations = [...(base.baseProfile.algorithmSelection.primary?.limitations ?? [])];
      assessment.evidenceRequirements = [...(base.baseProfile.algorithmSelection.primary?.verification ?? [])];
    }
  }
  if (problemType === 'root_cause_analysis') {
    add('causal-inference', 'Root-cause analysis would benefit from causal identification, but the current catalog has no identification engine.', true);
    add('independent-checks', 'Independent verification can test a proposed root cause against observed evidence.', true);
  }
  if (problemType === 'causal_analysis') add('causal-inference', 'Causal inference is required for an identified causal claim; WORA supports only an explicit causal graph and association checks.', true);
  if (problemType === 'formal_verification') {
    add('model-checking', 'A proof or finite-state model check was requested; no model checker is implemented.', true);
    add('sat-smt', 'SMT/SAT solving is not implemented in this catalog.', true);
    add('zod-contracts', 'Runtime contracts can validate inputs, but they are not a formal proof.', true);
  }
  if (problemType === 'optimization') {
    add('mip', 'A linear/integer model is the relevant optimization family when the selected solver is not already the match.', true);
    if (/nonlinear|non-convex|غير خطي/iu.test(base.objective)) add('nonlinear-optimization', 'The problem is nonlinear or non-convex; no nonlinear solver is implemented.', true);
  }
  if (/bayesian|posterior|prior probability|بايز/iu.test(base.objective)) add('bayesian-inference', 'A Bayesian posterior was requested; no Bayesian network or posterior sampler is implemented.', true);
  if (/machine learning|classifier|classification model|تعلم آلي|تصنيف/iu.test(base.objective)) add('classification', 'A learned classifier was requested; no model-training capability is implemented.', true);
  if (problemType === 'forecasting') {
    for (const item of assessments.values()) item.selected = false;
    add('linear-forecast', 'A linear trend baseline is implemented; it is not a causal forecast.', true, true);
  }
  if (problemType === 'decision') {
    for (const item of assessments.values()) item.selected = false;
    add('weighted-matrix', 'A weighted decision matrix is implemented for explicit criteria and weights.', true, true);
  }
  if (problemType === 'data_analysis') {
    for (const item of assessments.values()) item.selected = false;
    add('descriptive-statistics', 'Descriptive statistics are implemented for numeric series; inference is not.', true, true);
  }
  if (problemType === 'software_engineering') add('typescript-checks', 'Type and contract checks are available; they are not a proof of arbitrary correctness.', true);
  if (problemType === 'business_operations') add('deterministic-planner', 'Business plans can be decomposed and checked internally; external market outcomes remain unverified.', true);
  if (![...assessments.values()].some((item) => item.selected)) add('deterministic-planner', 'No specialized scientific method is selected; deterministic planning is the explicit fallback.', true, true);
  return [...assessments.values()].sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
}


function mergeProposal(model: ReasoningModel, proposal: ReasoningProposal): ReasoningModel {
  const claims = [...model.claims];
  const hypotheses = [...model.hypotheses];
  const causalGraph = [...model.causalGraph];
  const informationNeeds = [...model.informationNeeds];
  const addedClaimIds: string[] = [];
  const modelProvenance = provenance('model', 'reasoning-provider', 'model-proposal', 'model-proposal');
  if (proposal.interpretation) {
    const item = claim({ statement: proposal.interpretation, kind: 'assumption', provenance: modelProvenance, confidence: 0.35, confidenceKind: 'uncalibrated', confidenceNote: 'Model proposal; unverified interpretation.' });
    claims.push(item); addedClaimIds.push(item.id); model.assumptions.push(item.statement);
  }
  for (const proposed of proposal.hypotheses ?? []) {
    const item = claim({ statement: proposed.statement, kind: 'hypothesis', provenance: modelProvenance, confidence: 0.35, confidenceKind: 'uncalibrated', confidenceNote: 'Model-generated hypothesis; uncalibrated and unverified.' });
    claims.push(item); addedClaimIds.push(item.id);
    hypotheses.push({
      id: idFor('hyp', `model:${proposed.statement}`), claimId: item.id, statement: proposed.statement,
      cause: proposed.cause ?? 'model-proposed explanation', status: 'candidate', rank: hypotheses.length + 1, score: 0.35,
      scoreKind: 'heuristic-uncalibrated', assumptions: proposed.assumptions ?? [], evidenceFor: proposed.evidenceIds ?? [],
      evidenceAgainst: [], distinguishingTests: proposed.distinguishingTests ?? [], rejectionReason: null,
      revision: 1, updatedAt: nowIso(),
    });
  }
  for (const edge of proposal.causalEdges ?? []) {
    causalGraph.push({
      id: idFor('causal', `model:${edge.cause}->${edge.effect}`), cause: edge.cause, effect: edge.effect,
      relation: edge.relation ?? 'unknown', evidenceKind: edge.evidenceKind ?? 'assumed', identified: false, evidenceIds: [],
      confounders: edge.confounders ?? [], limitation: 'Model-proposed causal structure; it is not identified or verified.', claimId: null,
    });
  }
  for (const question of proposal.questions ?? []) {
    informationNeeds.push({
      id: idFor('info', `model:${question.question}`), question: question.question, unknownClaimId: null,
      materiality: question.materiality ?? 'medium', expectedInformationGain: 0.4,
      cost: { timeMinutes: 10, costUsd: null, risk: 'low', reversible: true }, canSelfGather: false,
      recommendedAction: question.materiality === 'critical' ? 'ask-user' : 'proceed-with-assumption',
      rationale: `Model-proposed question: ${question.why}`, status: 'open',
    });
  }
  const methods = [...model.methods];
  for (const proposed of proposal.methods ?? []) {
    if (methods.some((item) => item.id === proposed.id)) continue;
    methods.push({
      id: proposed.id, name: proposed.id.replaceAll('_', ' '), domain: 'model-proposal', status: 'not_implemented',
      applies: true, reason: `Model-proposed method; unverified proposal: ${proposed.reason}`, requiredInputs: [], assumptions: [],
      expectedOutputs: [], limitations: ['Model proposal only; it is not an implemented capability.'], evidenceRequirements: [],
      implemented: false, externalCapabilityRequired: true, gap: 'Model-proposed method is not present in the implemented WORA catalog.', selected: false,
    });
  }
  return {
    ...model, claims, hypotheses, causalGraph, informationNeeds, methods,
    contradictions: unique([...model.contradictions, ...(proposal.contradictions ?? [])]),
    desiredOutcome: model.desiredOutcome === model.objective && proposal.desiredOutcome ? sentence(proposal.desiredOutcome) : model.desiredOutcome,
    mode: 'model-assisted',
    sufficientToProceed: model.sufficientToProceed && !(proposal.contradictions?.length),
    limitations: unique([...model.limitations, 'Model proposals are unverified; deterministic checks, permissions and approvals remain authoritative.']),
    changes: [...model.changes, { version: model.version, kind: 'provider-merged', description: 'Optional provider proposals merged as unverified claims.', affectedClaimIds: addedClaimIds, invalidatedAssumptionIds: [], replanRecommended: false, affectedTaskIds: [], createdAt: nowIso() }],
  };
}

export interface AnalyzeReasoningInput {
  workspaceId?: string | null;
  missionId?: string | null;
  objective: string;
  track?: string;
  evidence?: ReasoningEvidenceInput[];
  baseProblem?: UnifiedProblem;
  includeMemory?: boolean;
  useModel?: boolean;
  signal?: AbortSignal;
}

export function buildDeterministicReasoning(input: AnalyzeReasoningInput): ReasoningModel {
  const base = input.baseProblem ?? modelProblem({ workspaceId: input.workspaceId ?? '', objective: input.objective, track: input.track, includeMemory: input.includeMemory });
  const problemType = problemTypeOf(base.objective, base);
  const desiredOutcome = desiredOutcomeOf(base.objective, base);
  const claims = initialClaims(base, input.evidence ?? []);
  const contradictions = detectContradictions(claims);
  const hypotheses = generateHypotheses(claims, problemType, base.objective, base);
  claims.push(...hypotheses.claims);
  const causalGraph = extractCausalEdges(base.objective, input.evidence ?? [], claims);
  const needs = informationNeeds(claims, base, problemType, contradictions);
  const methods = methodAssessments(base, problemType);
  const criticalNeeds = needs.filter((item) => item.materiality === 'critical');
  const selectedMethod = methods.find((item) => item.selected) ?? null;
  const status = reasoningProviderStatus();
  const provider: ReasoningProviderInfo = input.useModel && status.configured
    ? { name: status.name, model: status.model, status: 'used', notice: 'Provider proposal requested; deterministic checks remain authoritative.' }
    : status.configured
      ? { name: status.name, model: status.model, status: 'disabled', notice: 'Provider is configured but not requested for this analysis; deterministic reasoning is active.' }
      : { name: 'none', model: null, status: 'not-configured', notice: status.notice };
  return {
    schemaVersion: REASONING_SCHEMA_VERSION, workspaceId: input.workspaceId ?? null, missionId: input.missionId ?? null,
    version: 1, parentVersion: null, mode: 'deterministic', provider, objective: base.objective, desiredOutcome,
    problemType, domain: base.domain, claims, hypotheses: hypotheses.hypotheses, causalGraph, informationNeeds: needs, methods,
    contradictions, unknowns: claims.filter((item) => item.kind === 'unknown').map((item) => item.statement),
    assumptions: claims.filter((item) => item.kind === 'assumption').map((item) => item.statement),
    sufficientToProceed: criticalNeeds.length === 0,
    clarificationQuestion: criticalNeeds.find((item) => item.recommendedAction === 'ask-user')?.question ?? (contradictions.length ? 'Which conflicting statement is correct, and what evidence supports it?' : null),
    confidence: { value: Math.max(0, Math.min(1, Number((0.35 + (base.confidence * 0.25) + (selectedMethod ? 0.15 : 0) - (contradictions.length ? 0.15 : 0)).toFixed(3)))), kind: 'heuristic', note: 'Heuristic confidence from deterministic extraction, method availability and unresolved contradictions; not calibrated.' },
    limitations: unique([
      'Deterministic lexical extraction; it is not universal semantic understanding.',
      ...(causalGraph.some((edge) => !edge.identified) ? ['Some causal edges are assumed or observational; causal identification is not claimed.'] : []),
      ...(methods.some((item) => !item.implemented && item.applies) ? ['Some applicable methods are not implemented; they are reported as gaps.'] : []),
      ...(provider.status === 'not-configured' ? ['No reasoning model provider is configured.'] : []),
    ]),
    changes: [{ version: 1, kind: 'initial', description: 'Initial deterministic reasoning model.', affectedClaimIds: claims.map((item) => item.id), invalidatedAssumptionIds: [], replanRecommended: false, affectedTaskIds: [], createdAt: nowIso() }],
    baseProblem: base, createdAt: nowIso(),
  };
}

export async function analyzeProblemReasoning(input: AnalyzeReasoningInput): Promise<ReasoningModel> {
  const baseModel = buildDeterministicReasoning(input);
  const status = reasoningProviderStatus();
  if (!input.useModel || !status.configured) return baseModel;
  const result = await proposeReasoning({
    objective: baseModel.objective, desiredOutcome: baseModel.desiredOutcome, domain: baseModel.domain,
    facts: baseModel.claims.filter((item) => item.kind === 'user-fact').map((item) => ({ id: item.id, statement: item.statement })),
    assumptions: baseModel.claims.filter((item) => item.kind === 'assumption').map((item) => ({ id: item.id, statement: item.statement })),
    unknowns: baseModel.claims.filter((item) => item.kind === 'unknown').map((item) => item.statement),
    evidence: baseModel.claims.filter((item) => item.kind === 'retrieved-evidence' || item.kind === 'observed-fact').map((item) => ({ id: item.id, statement: item.statement, kind: item.kind, source: item.provenance.source, trust: item.provenance.trust })),
    methods: baseModel.methods.map((item) => ({ id: item.id, name: item.name, status: item.status })), signal: input.signal,
  });
  if (result.ok && result.proposal) return mergeProposal(baseModel, result.proposal);
  return {
    ...baseModel, mode: 'deterministic-fallback',
    provider: { name: result.provider.name, model: result.provider.model, status: 'failed', notice: `Provider proposal failed (${result.error ?? 'unknown error'}); deterministic reasoning remains active.` },
    limitations: unique([...baseModel.limitations, 'The optional provider failed; no model-assisted conclusion is claimed.']),
  };
}

export function summarizeReasoning(model: ReasoningModel): ReasoningSummary {
  const counts = {} as Record<ClaimKind, number>;
  for (const item of model.claims) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return {
    schemaVersion: REASONING_SCHEMA_VERSION, mode: model.mode, providerStatus: model.provider.status, problemType: model.problemType,
    sufficientToProceed: model.sufficientToProceed, claimCounts: counts, hypothesisCount: model.hypotheses.length,
    rejectedHypothesisCount: model.hypotheses.filter((item) => item.status === 'rejected').length,
    causalEdgeCount: model.causalGraph.length, informationNeedCount: model.informationNeeds.length,
    criticalInformationNeedCount: model.informationNeeds.filter((item) => item.materiality === 'critical').length,
    selectedMethod: model.methods.find((item) => item.selected)?.name ?? null,
    gapMethods: model.methods.filter((item) => !item.implemented && item.applies).map((item) => item.name),
    clarificationQuestion: model.clarificationQuestion, confidence: model.confidence, limitations: model.limitations,
  };
}

export function updateReasoningWithEvidence(model: ReasoningModel, evidence: ReasoningEvidenceInput[], actor = 'user'): { model: ReasoningModel; change: ReasoningChange } {
  const next = structuredClone(model);
  next.version = model.version + 1;
  next.parentVersion = model.version;
  const base = next.baseProblem ?? modelProblem({ workspaceId: model.workspaceId ?? '', objective: model.objective, includeMemory: false });
  next.baseProblem = base;
  const claims = initialClaims(base, evidence);
  const existing = new Set(next.claims.map((item) => `${item.kind}:${item.statement.toLowerCase()}`));
  const added = claims.filter((item) => !existing.has(`${item.kind}:${item.statement.toLowerCase()}`));
  next.claims.push(...added);
  const contradictions = detectContradictions(next.claims);
  next.contradictions = unique([...next.contradictions, ...contradictions]);
  const invalidatedAssumptionIds: string[] = [];
  for (const item of evidence) {
    for (const claimId of item.contradicts ?? []) {
      const assumption = next.claims.find((entry) => entry.id === claimId && entry.kind === 'assumption');
      if (assumption) { assumption.active = false; invalidatedAssumptionIds.push(assumption.id); }
    }
  }
  const hypotheses = generateHypotheses(next.claims, next.problemType, next.objective, base);
  const existingHypotheses = new Map(next.hypotheses.map((item) => [item.id, item]));
  for (const item of hypotheses.hypotheses) {
    const prior = existingHypotheses.get(item.id);
    if (prior) {
      Object.assign(prior, item, {
        revision: prior.revision + 1,
        evidenceFor: unique([...prior.evidenceFor, ...item.evidenceFor]),
        evidenceAgainst: unique([...prior.evidenceAgainst, ...item.evidenceAgainst]),
        updatedAt: nowIso(),
      });
    } else {
      next.hypotheses.push(item);
    }
  }
  next.claims.push(...hypotheses.claims.filter((item) => !next.claims.some((claim) => claim.id === item.id)));
  next.hypotheses.sort((a, b) => b.score - a.score).forEach((item, index) => { item.rank = index + 1; });
  const newCausalClaims: ReasoningClaim[] = [];
  const recomputedCausal = extractCausalEdges(next.objective, evidence, newCausalClaims);
  const causalKey = (value: { cause: string; effect: string; relation: string }) => `${value.cause.toLowerCase().replace(/^(?:does|do|did|the|a|an)\s+/u, '').trim()}->${value.effect.toLowerCase().replace(/^(?:the|a|an)\s+/u, '').trim()}:${value.relation}`;
  for (const edge of recomputedCausal) {
    const prior = next.causalGraph.find((item) => item.id === edge.id || causalKey(item) === causalKey(edge));
    if (prior) {
      prior.evidenceIds = unique([...prior.evidenceIds, ...edge.evidenceIds]);
      prior.confounders = unique([...prior.confounders, ...edge.confounders]);
      prior.evidenceKind = edge.identified ? 'experimental' : prior.evidenceKind === 'experimental' ? prior.evidenceKind : edge.evidenceKind;
      prior.identified = prior.identified || edge.identified;
      prior.limitation = prior.identified ? edge.limitation : prior.limitation;
    } else {
      next.causalGraph.push(edge);
      const causalClaim = newCausalClaims.find((claim) => claim.id === edge.claimId);
      if (causalClaim && !next.claims.some((claim) => claim.id === causalClaim.id)) next.claims.push(causalClaim);
    }
  }
  next.informationNeeds = informationNeeds(next.claims, base, next.problemType, next.contradictions);
  next.unknowns = next.claims.filter((item) => item.kind === 'unknown').map((item) => item.statement);
  next.assumptions = next.claims.filter((item) => item.kind === 'assumption' && item.active).map((item) => item.statement);
  next.sufficientToProceed = next.informationNeeds.every((item) => item.materiality !== 'critical');
  next.clarificationQuestion = next.informationNeeds.find((item) => item.recommendedAction === 'ask-user')?.question ?? null;
  const change: ReasoningChange = {
    version: next.version, kind: invalidatedAssumptionIds.length ? 'assumption-invalidated' : 'evidence-added',
    description: invalidatedAssumptionIds.length
      ? `New evidence invalidated ${invalidatedAssumptionIds.length} assumption(s); the plan must be reviewed.`
      : `New evidence added to the reasoning model; ${added.length} claim(s) recorded.`,
    affectedClaimIds: added.map((item) => item.id), invalidatedAssumptionIds,
    replanRecommended: invalidatedAssumptionIds.length > 0 || contradictions.length > 0,
    affectedTaskIds: [], createdAt: nowIso(),
  };
  next.changes.push(change);
  next.confidence = { value: Math.max(0, Math.min(1, Number((model.confidence.value - (contradictions.length ? 0.05 : 0) + (added.length ? 0.02 : 0)).toFixed(3)))), kind: 'heuristic', note: 'Heuristic confidence updated after evidence; not calibrated.' };
  return { model: next, change };
}

export function reasoningModeNotice(): string {
  const status = reasoningProviderStatus();
  return status.configured
    ? 'Optional reasoning provider configured; deterministic checks remain authoritative.'
    : 'Deterministic reasoning only; no external model provider is configured.';
}

