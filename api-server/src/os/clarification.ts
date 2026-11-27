/**
 * WORA OS — mission intake clarification.
 *
 * Reuses the existing reasoning information-needs and the deterministic plan
 * instead of creating a second understanding engine. Questions are advisory
 * unless they are critical; answers are passed back into mission creation as
 * user evidence and into the planner objective.
 */
import type { ProblemProfile } from './problem.js';
import type { ReasoningModel } from './reasoning-types.js';

export const CLARIFICATION_SCHEMA_VERSION = '1.0';

export type ClarificationCode =
  | 'information'
  | 'clarification'
  | 'forecast_data'
  | 'optimization_data'
  | 'method_gap'
  | 'problem_class'
  | 'capability_gap'
  | 'risk_approval'
  | 'domain';

export type ClarificationMateriality = 'critical' | 'high' | 'medium' | 'low';

export interface ClarificationQuestion {
  id: string;
  code: ClarificationCode;
  prompt: string;
  rationale: string;
  materiality: ClarificationMateriality;
  blocking: boolean;
  fields: string[];
  source: 'reasoning' | 'planner' | 'method-catalog';
}

export interface ClarificationPlan {
  schemaVersion: typeof CLARIFICATION_SCHEMA_VERSION;
  questions: ClarificationQuestion[];
  criticalCount: number;
  requiresAnswers: boolean;
  canProceed: boolean;
  summary: string;
}

export interface ClarificationAnswer {
  questionId: string;
  answer: string;
}

export interface PlanLike {
  title?: string;
  tool: string | null;
  detail: string;
}

const materialityRank: Record<ClarificationMateriality, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function questionKey(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/gu, ' ').trim();
}

export function buildClarificationPlan(input: {
  problem: ProblemProfile;
  reasoning?: ReasoningModel | null;
  plan?: PlanLike[];
  answers?: Record<string, string>;
  maxQuestions?: number;
}): ClarificationPlan {
  const plan = input.plan ?? [];
  const answers = input.answers ?? {};
  const questions: ClarificationQuestion[] = [];
  const seen = new Set<string>();

  const add = (entry: ClarificationQuestion) => {
    const key = questionKey(entry.prompt);
    if (!key || seen.has(key)) return;
    seen.add(key);
    questions.push(entry);
  };

  for (const need of input.reasoning?.informationNeeds ?? []) {
    if (need.status !== 'open' || need.recommendedAction !== 'ask-user') continue;
    add({
      id: need.id,
      code: 'information',
      prompt: need.question,
      rationale: need.rationale,
      materiality: need.materiality,
      blocking: need.materiality === 'critical',
      fields: [],
      source: 'reasoning',
    });
  }

  if (input.reasoning?.clarificationQuestion) {
    add({
      id: 'reasoning-clarification',
      code: 'clarification',
      prompt: input.reasoning.clarificationQuestion,
      rationale: 'The reasoning model found a material contradiction or unresolved critical need.',
      materiality: 'critical',
      blocking: true,
      fields: [],
      source: 'reasoning',
    });
  }

  const algorithm = input.problem.algorithmSelection;
  if (algorithm.status === 'unsupported') {
    add({
      id: 'method-gap',
      code: 'method_gap',
      prompt: algorithm.warnings[0] ?? 'The requested problem class has no tested WORA method.',
      rationale: 'No implemented method can produce a defensible result for this formulation.',
      materiality: 'critical',
      blocking: true,
      fields: algorithm.missingInformation,
      source: 'method-catalog',
    });
  } else if (algorithm.status === 'needs_input') {
    add({
      id: 'problem-class',
      code: 'problem_class',
      prompt: 'Which problem class best describes the objective?',
      rationale: 'The deterministic classifier could not select a method without inventing a problem type.',
      materiality: 'high',
      blocking: false,
      fields: algorithm.missingInformation,
      source: 'method-catalog',
    });
  } else if (algorithm.missingInformation.length) {
    add({
      id: 'algorithm-inputs',
      code: 'information',
      prompt: `The selected method needs: ${algorithm.missingInformation.join('; ')}.`,
      rationale: 'The method is implemented but cannot execute until these inputs are supplied.',
      materiality: 'critical',
      blocking: true,
      fields: algorithm.missingInformation,
      source: 'method-catalog',
    });
  }

  if (input.problem.missingInformation.includes('explicit constraints')) {
    add({
      id: 'constraints',
      code: 'information',
      prompt: 'Which constraints are mandatory (budget, deadline, compliance, availability)?',
      rationale: 'No explicit constraint was found in the objective; the planner would otherwise assume none.',
      materiality: 'medium',
      blocking: false,
      fields: ['constraints'],
      source: 'reasoning',
    });
  }
  if (input.problem.missingInformation.includes('acceptance criteria')) {
    add({
      id: 'acceptance',
      code: 'information',
      prompt: 'What evidence will prove that the mission succeeded?',
      rationale: 'No acceptance criterion was found; deterministic review would otherwise be used.',
      materiality: 'medium',
      blocking: false,
      fields: ['acceptance criteria'],
      source: 'reasoning',
    });
  }

  for (const task of plan) {
    if (task.tool === 'or.employee_schedule' && /SAMPLE roster/iu.test(task.detail)) {
      add({
        id: 'optimization-roster',
        code: 'optimization_data',
        prompt: 'Provide the real employees, hourly costs, availability, max assignments and shift demand.',
        rationale: 'The planner used the bundled sample roster because the objective contained no operational data.',
        materiality: 'high',
        blocking: false,
        fields: ['employees', 'shifts'],
        source: 'planner',
      });
    }
    if (task.tool === 'or.assignment' && /SAMPLE cost matrix/iu.test(task.detail)) {
      add({
        id: 'optimization-matrix',
        code: 'optimization_data',
        prompt: 'Provide the real cost matrix and row/column labels.',
        rationale: 'The planner used a sample matrix because the objective contained no numeric costs.',
        materiality: 'high',
        blocking: false,
        fields: ['costMatrix', 'rowLabels', 'colLabels'],
        source: 'planner',
      });
    }
    if (/CAPABILITY GAP/iu.test(task.detail)) {
      add({
        id: 'capability-gap',
        code: 'capability_gap',
        prompt: 'Which approved capability should WORA use, or should it stop and report the gap?',
        rationale: 'No approved executable capability matched the objective; nothing was installed automatically.',
        materiality: 'high',
        blocking: false,
        fields: ['capability'],
        source: 'planner',
      });
    }
    if (/FORECAST INPUT GAP/iu.test(task.detail)) {
      add({
        id: 'forecast-data',
        code: 'forecast_data',
        prompt: 'Provide the target variable, future horizon and at least eight chronological numeric observations.',
        rationale: 'The forecast method is implemented but cannot run without a real series and horizon.',
        materiality: 'critical',
        blocking: true,
        fields: ['target', 'horizon', 'observations'],
        source: 'planner',
      });
    }
  }

  if (input.problem.features.riskLevel === 'high') {
    add({
      id: 'risk-approval',
      code: 'risk_approval',
      prompt: 'This objective appears high impact. Which approval and rollback conditions apply?',
      rationale: 'High-risk actions are gated by class C human approval during execution.',
      materiality: 'medium',
      blocking: false,
      fields: ['approval', 'rollback'],
      source: 'reasoning',
    });
  }
  if (input.problem.confidence < 0.5) {
    add({
      id: 'domain',
      code: 'domain',
      prompt: 'Which domain should WORA use for this objective?',
      rationale: 'The deterministic domain classifier has low confidence.',
      materiality: 'low',
      blocking: false,
      fields: ['domain'],
      source: 'reasoning',
    });
  }

  const unanswered = questions
    .filter((entry) => !(answers[entry.id] ?? '').trim())
    .sort((a, b) => materialityRank[b.materiality] - materialityRank[a.materiality])
    .slice(0, Math.max(1, Math.min(input.maxQuestions ?? 8, 12)));
  const criticalCount = unanswered.filter((entry) => entry.blocking).length;
  return {
    schemaVersion: CLARIFICATION_SCHEMA_VERSION,
    questions: unanswered,
    criticalCount,
    requiresAnswers: criticalCount > 0,
    canProceed: plan.length > 0,
    summary: unanswered.length === 0
      ? 'No material clarification is outstanding.'
      : `${unanswered.length} clarification question(s), ${criticalCount} critical for a defensible result.`,
  };
}
