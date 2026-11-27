/**
 * WORA OS — adaptive method comparison.
 *
 * The catalog is not a keyword table. This layer compares the implemented
 * methods that could actually address a problem against its structure, supplied
 * inputs, data quality, verification surface, cost and recorded workspace
 * performance. It selects only an executable method and names the alternatives
 * it rejected. Missing data is a gap, never a reason to invent a model.
 */
import { createHash } from 'node:crypto';
import type { ProblemProfile } from './problem.js';
import { listAlgorithms, type AlgorithmDefinition } from './algorithms.js';
import { getTool } from './tools.js';
import { getOsDb, parseJson } from './db.js';
import { formulateScientificProblem, type FormulationKind } from './scientific-formulation.js';
import { extractStructuredJsonBlocks } from './structured-input.js';
import {
  ADVANCED_SCIENTIFIC_KINDS, kindLabel, modelForScientificKind, scientificKindForTool,
  scientificToolForKind, structuredScientificKind,
} from './scientific-routing.js';
import { researchUnresolvedMethod, type MethodResearch } from './method-research.js';

export const ADAPTIVE_INTELLIGENCE_SCHEMA_VERSION = '1.0';

export interface MethodHistory {
  attempts: number;
  verified: number;
  failed: number;
  successRate: number;
  averageDurationMs: number | null;
}

export interface MethodCandidate {
  toolId: string;
  algorithmId: string;
  kind: FormulationKind;
  name: string;
  eligible: boolean;
  executablePlan: boolean;
  score: number;
  structureFit: number;
  inputFit: number;
  dataQuality: number;
  verificationFit: number;
  textFit: number;
  historyFit: number;
  costFit: number;
  history: MethodHistory;
  reasons: string[];
  rejectionReason: string | null;
  requiredInputs: string[];
  verification: string[];
  guarantee: string;
  limitations: string[];
}

export interface AdaptiveBranchDecision {
  index: number;
  modelDigest: string | null;
  shapeKind: FormulationKind | null;
  candidates: MethodCandidate[];
  selected: MethodCandidate | null;
  rejected: MethodCandidate[];
  rationale: string;
  missingInformation: string[];
  research: MethodResearch | null;
}

export interface AdaptiveMethodDecision {
  schemaVersion: typeof ADAPTIVE_INTELLIGENCE_SCHEMA_VERSION;
  objectiveDigest: string;
  scientificRequired: boolean;
  structureKinds: FormulationKind[];
  branches: AdaptiveBranchDecision[];
  candidates: MethodCandidate[];
  selected: MethodCandidate | null;
  rejected: MethodCandidate[];
  rationale: string;
  assumptions: string[];
  missingInformation: string[];
  research: MethodResearch | null;
  confidence: number;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const digest = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 32);
const unique = <T>(values: T[]): T[] => [...new Set(values)];

const COST_FIT: Record<'low' | 'medium' | 'high', number> = { low: 1, medium: 0.7, high: 0.4 };

function historyFor(workspaceId: string, toolId: string): MethodHistory {
  const rows = getOsDb().prepare("SELECT payload FROM os_decision_records WHERE workspace_id = ? AND kind = 'method-outcome' ORDER BY created_at DESC LIMIT 400")
    .all(workspaceId) as Array<{ payload?: string }>;
  let attempts = 0;
  let verified = 0;
  let failed = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (const row of rows) {
    const payload = parseJson<Record<string, unknown> | null>(row.payload ?? '{}', null);
    if (!payload || payload['tool'] !== toolId) continue;
    if (typeof payload['verificationPassed'] !== 'boolean') continue;
    attempts += 1;
    if (payload['verificationPassed'] === true) verified += 1; else failed += 1;
    if (typeof payload['durationMs'] === 'number' && Number.isFinite(payload['durationMs'])) {
      durationSum += payload['durationMs'];
      durationCount += 1;
    }
  }
  return {
    attempts, verified, failed,
    successRate: attempts ? verified / attempts : 0.5,
    averageDurationMs: durationCount ? Math.round(durationSum / durationCount) : null,
  };
}

function scientificRequired(profile: ProblemProfile, shapeKinds: FormulationKind[]): boolean {
  if (shapeKinds.length) return true;
  if (profile.scientific.method && scientificKindForTool(profile.scientific.method.toolId)) return true;
  return profile.algorithmSelection.status === 'unsupported';
}

function featureKinds(profile: ProblemProfile, objective: string): FormulationKind[] {
  const f = profile.features;
  const kinds: FormulationKind[] = [];
  if (f.hasBipartite === true) kinds.push('bipartite_matching');
  if (f.hasMinCostFlow === true) kinds.push('min_cost_flow');
  else if (f.hasNetworkFlow === true) kinds.push('max_flow');
  if (f.hasRouting === true || (f.hasVehicles === true && /\broute|routing|deliver|fleet|توجيه|توصيل/iu.test(objective))) {
    if (f.hasVehicles === true) kinds.push('vrp');
    kinds.push('tsp');
  }
  if (f.hasPareto === true) kinds.push('pareto_multi_objective');
  if (f.hasBayes === true) kinds.push('bayesian_inference');
  if (f.hasQueue === true) kinds.push('queue_simulation');
  if (f.hasScenarios === true) kinds.push('scenario_comparison');
  if (f.hasEmployees === true && f.hasShifts === true) kinds.push('employee_scheduling');
  if (f.hasCostMatrix === true) kinds.push('assignment');
  if (f.hasTimeSeries === true) kinds.push('forecasting');
  if (f.hasCriteria === true && f.hasAlternatives === true) kinds.push('multi_criteria_decision');
  if (f.hasUncertainty === true && /monte\s*carlo|simulat/iu.test(objective)) kinds.push('monte_carlo_simulation');
  if (f.integerVariables === true) kinds.push('integer_programming');
  if (!kinds.length && /linear\s*program|\blp\b|maximi[sz]e|minimi[sz]e/iu.test(objective)) kinds.push('linear_programming');
  return unique(kinds);
}

function alternativeKinds(kind: FormulationKind): FormulationKind[] {
  switch (kind) {
    case 'assignment': return ['integer_programming'];
    case 'employee_scheduling': return ['integer_programming'];
    case 'tsp': return ['vrp', 'integer_programming'];
    case 'vrp': return ['tsp', 'integer_programming'];
    case 'bipartite_matching': return ['assignment'];
    case 'max_flow': return ['min_cost_flow'];
    case 'min_cost_flow': return ['max_flow'];
    case 'pareto_multi_objective': return ['multi_criteria_decision'];
    case 'bayesian_inference': return ['monte_carlo_simulation'];
    case 'scenario_comparison': return ['monte_carlo_simulation'];
    case 'queue_simulation': return ['monte_carlo_simulation'];
    case 'linear_programming': return ['integer_programming'];
    case 'integer_programming': return ['linear_programming'];
    default: return [];
  }
}

function textFit(kind: FormulationKind, profile: ProblemProfile, objective: string): number {
  const f = profile.features;
  const signals: Record<FormulationKind, number> = {
    assignment: (f.hasCostMatrix === true ? 0.8 : 0) + (/\bassign|matching|cost\s*matrix|مطابقة|تخصيص/iu.test(objective) ? 0.2 : 0),
    employee_scheduling: (f.hasEmployees === true && f.hasShifts === true ? 0.8 : 0) + (/\bshift|schedule|roster|employee|وردية|جدول|موظف/iu.test(objective) ? 0.2 : 0),
    linear_programming: (/\blinear\s*program|\blp\b|budget|capacity|maximi[sz]e|minimi[sz]e|قيد|ميزانية/iu.test(objective) ? 0.7 : 0.2),
    integer_programming: (f.integerVariables === true ? 0.7 : 0) + (/\binteger|binary|mip|صحيحة/iu.test(objective) ? 0.3 : 0),
    shortest_path: (f.hasGraph === true ? 0.8 : 0) + (/\bshortest\s*path|dijkstra|a\*|أقصر\s*مسار/iu.test(objective) ? 0.2 : 0),
    max_flow: (f.hasNetworkFlow === true && f.hasMinCostFlow !== true ? 0.8 : 0) + (/\bmax(?:imum)?\s*flow|تدفق/iu.test(objective) ? 0.2 : 0),
    min_cost_flow: (f.hasMinCostFlow === true ? 0.9 : 0) + (/\bmin(?:imum)?\s*cost\s*flow|بأقل\s*تكلفة/iu.test(objective) ? 0.1 : 0),
    bipartite_matching: (f.hasBipartite === true ? 0.9 : 0) + (/\bbipartite|maximum\s*matching|مطابقة\s*ثنائية/iu.test(objective) ? 0.1 : 0),
    tsp: (f.hasRouting === true ? 0.6 : 0) + (/\btsp\b|travel(?:l)?ing\s+sales|جولة\s*البائع/iu.test(objective) ? 0.4 : 0),
    vrp: (f.hasRouting === true && f.hasVehicles === true ? 0.7 : f.hasVehicles === true ? 0.6 : 0) + (/\bvehicle|fleet|truck|route|مركبة|أسطول|توجيه/iu.test(objective) ? 0.3 : 0),
    pareto_multi_objective: (f.hasPareto === true ? 0.9 : 0) + (/\bpareto|multi[ -]?objective|trade[ -]?off|باريتو/iu.test(objective) ? 0.1 : 0),
    bayesian_inference: (f.hasBayes === true ? 0.9 : 0) + (/\bbayes|posterior|prior|بايز/iu.test(objective) ? 0.1 : 0),
    queue_simulation: (f.hasQueue === true ? 0.9 : 0) + (/\bqueue|waiting\s*line|طابور/iu.test(objective) ? 0.1 : 0),
    scenario_comparison: (f.hasScenarios === true ? 0.9 : 0) + (/\bscenario|سيناريو/iu.test(objective) ? 0.1 : 0),
    monte_carlo_simulation: (f.hasUncertainty === true ? 0.6 : 0) + (/\bmonte\s*carlo|simulat|risk|محاكاة|مخاطر/iu.test(objective) ? 0.4 : 0),
    forecasting: (f.hasTimeSeries === true ? 0.9 : 0) + (/\bforecast|time\s*series|trend|تنبؤ/iu.test(objective) ? 0.1 : 0),
    multi_criteria_decision: (f.hasCriteria === true ? 0.7 : 0) + (f.hasAlternatives === true ? 0.3 : 0),
  };
  return clamp(signals[kind] ?? 0);
}

function algorithmFor(kind: FormulationKind): AlgorithmDefinition | null {
  return listAlgorithms().find((entry) => entry.problemKinds.includes(kind)) ?? null;
}

function unsupportedRequirement(kind: FormulationKind, objective: string): string | null {
  const text = objective.toLowerCase();
  if (/(time\s*window|delivery\s*window|نافذة\s*زمنية)/iu.test(text) && (kind === 'vrp' || kind === 'tsp')) {
    return 'The stated time windows are not modeled by the current routing baseline; using it would silently drop a constraint.';
  }
  if (/(two[ -]?stage|stochastic\s+program|chance[ -]?constraint|برمجة\s*عشوائية)/iu.test(text)
    && (kind === 'linear_programming' || kind === 'integer_programming' || kind === 'forecasting')) {
    return 'The current deterministic method does not model stochastic recourse or chance constraints.';
  }
  if (/(nonlinear|non-convex|غير\s*خطي)/iu.test(text)
    && (kind === 'linear_programming' || kind === 'integer_programming' || kind === 'assignment' || kind === 'employee_scheduling')) {
    return 'The current LP/MIP path does not model nonlinear terms.';
  }
  if (/(reinforcement\s*learning|\brl\b|deep\s*learning|neural\s*network|mcts|monte\s*carlo\s*tree)/iu.test(text)) {
    return 'No implemented method in the current catalog supports this learning/search requirement.';
  }
  return null;
}

function compatible(shape: FormulationKind | null, kind: FormulationKind): boolean {
  if (!shape) return false;
  if (shape === kind) return true;
  if (shape === 'linear_programming' && kind === 'integer_programming') return true;
  if (shape === 'integer_programming' && kind === 'linear_programming') return true;
  if (shape === 'max_flow' && kind === 'min_cost_flow') return true;
  return false;
}

function candidateFor(input: {
  kind: FormulationKind;
  shapeKind: FormulationKind | null;
  selectedKind: FormulationKind | null;
  block: Record<string, unknown> | null;
  profile: ProblemProfile;
  objective: string;
  workspaceId: string;
}): MethodCandidate {
  const toolId = scientificToolForKind(input.kind);
  const algorithm = algorithmFor(input.kind);
  const tool = getTool(toolId, input.workspaceId);
  const model = input.block ? modelForScientificKind(input.kind, input.block) : null;
  const formulation = formulateScientificProblem({ kind: input.kind, model: model ?? undefined, objective: input.objective });
  const history = historyFor(input.workspaceId, toolId);
  const shapeMatch = compatible(input.shapeKind, input.kind) ? (input.shapeKind === input.kind ? 1 : 0.75) : 0;
  const selectedMatch = input.selectedKind === input.kind ? 1 : 0;
  const text = textFit(input.kind, input.profile, input.objective);
  const hasBlock = Boolean(input.block);
  const advanced = ADVANCED_SCIENTIFIC_KINDS.has(input.kind);
  const inputFit = hasBlock
    ? (formulation.executable ? 1 : model ? 0.35 : 0.15)
    : (selectedMatch ? (advanced ? 0.15 : 0.6) : (advanced ? 0.15 : 0.4));
  const dataQuality = formulation.executable ? 1 : hasBlock ? 0.2 : selectedMatch ? 0.45 : 0.3;
  const verificationFit = clamp((formulation.verification.length || algorithm?.verification.length || 0) / 3);
  const historyFit = history.attempts >= 2 ? history.successRate : 0.5;
  const costFit = COST_FIT[algorithm?.costClass ?? 'medium'];
  const structureFit = shapeMatch || selectedMatch * 0.65 || text * 0.5;
  const score = Math.round((
    0.30 * structureFit + 0.22 * inputFit + 0.15 * dataQuality + 0.10 * verificationFit
    + 0.08 * text + 0.08 * historyFit + 0.04 * costFit + 0.03 * (algorithm?.deterministic ? 1 : 0.5)
  ) * 1000) / 1000;
  const toolAvailable = Boolean(tool && algorithm);
  const unsupported = unsupportedRequirement(input.kind, input.objective);
  const executablePlan = toolAvailable && !unsupported && (hasBlock ? formulation.executable : Boolean(selectedMatch) && !advanced);
  const eligible = executablePlan;
  const rejectionReason = !toolAvailable ? `The ${toolId} tool or its tested catalog entry is unavailable.`
    : unsupported ? unsupported
      : hasBlock && !formulation.executable ? `Missing required inputs: ${(formulation.missingInputs.length ? formulation.missingInputs : ['a valid structured model']).join('; ')}.`
        : !hasBlock && advanced ? 'This method requires a complete structured model; no sample data is invented.'
          : !hasBlock && !selectedMatch ? 'The objective does not provide enough structure to execute this method.'
            : null;
  const reasons = [
    input.shapeKind === input.kind ? `The supplied model has the exact ${kindLabel(input.kind)} shape.` : input.shapeKind && compatible(input.shapeKind, input.kind) ? `Compatible formulation of the supplied ${kindLabel(input.shapeKind)} model.` : '',
    input.selectedKind === input.kind ? 'The deterministic problem profile selected this class.' : '',
    text >= 0.7 ? 'The objective contains strong domain signals for this class.' : '',
    formulation.executable ? 'The formulation is executable with the supplied inputs.' : '',
    history.attempts >= 2 ? `Workspace history: ${history.verified}/${history.attempts} verified outcomes.` : '',
  ].filter(Boolean);
  return {
    toolId, algorithmId: algorithm?.id ?? 'unknown', kind: input.kind, name: algorithm?.name ?? kindLabel(input.kind),
    eligible, executablePlan, score, structureFit, inputFit, dataQuality, verificationFit, textFit: text, historyFit, costFit,
    history, reasons: reasons.slice(0, 4), rejectionReason,
    requiredInputs: formulation.missingInputs.length ? formulation.missingInputs : [...(algorithm?.inputs ?? [])],
    verification: formulation.verification.length ? formulation.verification : [...(algorithm?.verification ?? [])],
    guarantee: algorithm?.guarantee ?? 'No tested guarantee is available.', limitations: [...(algorithm?.limitations ?? [])].slice(0, 4),
  };
}

function decideBranch(input: {
  workspaceId: string;
  objective: string;
  profile: ProblemProfile;
  block: Record<string, unknown> | null;
  index: number;
}): AdaptiveBranchDecision {
  const shapeKind = structuredScientificKind(input.block);
  const selectedKind = scientificKindForTool(input.profile.scientific.method?.toolId ?? null);
  const kinds = unique([
    ...(shapeKind ? [shapeKind, ...alternativeKinds(shapeKind)] : []),
    ...(selectedKind ? [selectedKind, ...alternativeKinds(selectedKind)] : []),
    ...featureKinds(input.profile, input.objective),
  ]);
  const candidates = kinds.map((kind) => candidateFor({
    kind, shapeKind, selectedKind, block: input.block, profile: input.profile,
    objective: input.objective, workspaceId: input.workspaceId,
  })).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.toolId.localeCompare(b.toolId));
  let selected = candidates.find((candidate) => candidate.executablePlan) ?? null;
  if (!input.block && selected && selected.textFit < 0.3) {
    const strongerMissingMethod = candidates.find((candidate) => !candidate.eligible && ADVANCED_SCIENTIFIC_KINDS.has(candidate.kind) && candidate.textFit >= 0.6);
    if (strongerMissingMethod) selected = null;
  }
  const rejected = candidates.filter((candidate) => candidate !== selected);
  const rationale = selected
    ? `Selected ${selected.name} (${selected.score.toFixed(3)}). ${selected.reasons.join(' ')} Alternatives: ${rejected.slice(0, 4).map((candidate) => `${candidate.name}: ${candidate.eligible ? `score ${candidate.score.toFixed(3)}` : candidate.rejectionReason}`).join(' | ') || 'none'}.`
    : candidates.length
      ? `No method is executable. ${rejected.slice(0, 5).map((candidate) => `${candidate.name}: ${candidate.rejectionReason}`).join(' | ')}`
      : 'No scientific method is required for this objective.';
  const research = !selected && (scientificRequired(input.profile, shapeKind ? [shapeKind] : []) || candidates.length > 0)
    ? researchUnresolvedMethod({
      objective: input.objective, profile: input.profile, excludeExisting: true,
      missingInputs: unique(candidates.flatMap((candidate) => candidate.requiredInputs)),
    })
    : null;
  return {
    index: input.index, modelDigest: input.block ? digest(input.block) : null, shapeKind,
    candidates, selected, rejected, rationale,
    missingInformation: unique(candidates.flatMap((candidate) => candidate.eligible ? [] : candidate.requiredInputs)).slice(0, 12),
    research,
  };
}

export function selectAdaptiveMethod(input: {
  workspaceId: string;
  objective: string;
  profile: ProblemProfile;
  blocks?: Record<string, unknown>[];
}): AdaptiveMethodDecision {
  const objective = input.objective.trim().slice(0, 4000);
  const blocks = input.blocks ?? extractStructuredJsonBlocks(objective);
  const branches = (blocks.length ? blocks : [null]).map((block, index) => decideBranch({
    workspaceId: input.workspaceId, objective, profile: input.profile, block, index,
  }));
  const required = branches.some((branch) => branch.selected || branch.candidates.length > 0)
    || scientificRequired(input.profile, branches.map((branch) => branch.shapeKind).filter((kind): kind is FormulationKind => Boolean(kind)));
  const selected = branches.length === 1 ? branches[0]!.selected : null;
  const candidates = branches.length === 1 ? branches[0]!.candidates : branches.flatMap((branch) => branch.candidates).slice(0, 16);
  const rejected = branches.length === 1 ? branches[0]!.rejected : branches.flatMap((branch) => branch.rejected).slice(0, 16);
  const research = selected ? null : branches.find((branch) => branch.research)?.research ?? null;
  const rationale = branches.length === 1
    ? branches[0]!.rationale
    : `Multi-method problem: ${branches.map((branch) => `branch ${branch.index + 1} ${branch.selected ? `selects ${branch.selected.name}` : 'has no executable method'}`).join('; ')}. Branches are independent unless an explicit input binding creates a dependency.`;
  const missingInformation = unique(branches.flatMap((branch) => branch.missingInformation)).slice(0, 20);
  return {
    schemaVersion: ADAPTIVE_INTELLIGENCE_SCHEMA_VERSION,
    objectiveDigest: digest(objective),
    scientificRequired: required,
    structureKinds: unique(branches.map((branch) => branch.shapeKind).filter((kind): kind is FormulationKind => Boolean(kind))),
    branches,
    candidates,
    selected,
    rejected,
    rationale,
    assumptions: [
      'Method scores are explicit deterministic policy scores, not learned probabilities or guarantees.',
      'A method is executable only when its tool exists and its formulation has the supplied inputs.',
      'A different formulation is rejected unless an equivalent translation exists.',
      'Workspace method history is used only after at least two verified or failed outcomes.',
    ],
    missingInformation,
    research,
    confidence: selected ? selected.score : branches.length ? Math.max(0.2, 1 - missingInformation.length * 0.08) : 0.4,
  };
}

export function methodHistoryFor(workspaceId: string, toolId: string): MethodHistory {
  return historyFor(workspaceId, toolId);
}
