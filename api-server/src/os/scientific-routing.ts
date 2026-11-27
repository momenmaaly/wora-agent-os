/**
 * WORA OS — pure scientific routing helpers.
 *
 * These functions map between implemented formulation kinds, their tools and
 * the shape of a supplied structured model. They do not select a method and do
 * not execute anything; adaptive selection and planning build on them.
 */
import type { FormulationKind } from './scientific-formulation.js';

export const SCIENTIFIC_KIND_BY_TOOL: Record<string, FormulationKind> = {
  'or.solve_lp': 'linear_programming',
  'or.assignment': 'assignment',
  'or.employee_schedule': 'employee_scheduling',
  'graph.shortest_path': 'shortest_path',
  'sim.monte_carlo': 'monte_carlo_simulation',
  'forecast.linear': 'forecasting',
  'decision.weighted_matrix': 'multi_criteria_decision',
  'graph.max_flow': 'max_flow',
  'graph.min_cost_flow': 'min_cost_flow',
  'graph.bipartite_matching': 'bipartite_matching',
  'routing.tsp': 'tsp',
  'routing.vrp': 'vrp',
  'decision.pareto': 'pareto_multi_objective',
  'stats.bayes_update': 'bayesian_inference',
  'sim.queue': 'queue_simulation',
  'sim.scenario_compare': 'scenario_comparison',
};

export const SCIENTIFIC_TOOL_BY_KIND: Record<FormulationKind, string> = {
  linear_programming: 'or.solve_lp',
  integer_programming: 'or.solve_lp',
  shortest_path: 'graph.shortest_path',
  assignment: 'or.assignment',
  employee_scheduling: 'or.employee_schedule',
  monte_carlo_simulation: 'sim.monte_carlo',
  forecasting: 'forecast.linear',
  multi_criteria_decision: 'decision.weighted_matrix',
  max_flow: 'graph.max_flow',
  min_cost_flow: 'graph.min_cost_flow',
  bipartite_matching: 'graph.bipartite_matching',
  tsp: 'routing.tsp',
  vrp: 'routing.vrp',
  pareto_multi_objective: 'decision.pareto',
  bayesian_inference: 'stats.bayes_update',
  queue_simulation: 'sim.queue',
  scenario_comparison: 'sim.scenario_compare',
};

export const ADVANCED_SCIENTIFIC_KINDS = new Set<FormulationKind>([
  'max_flow', 'min_cost_flow', 'bipartite_matching', 'tsp', 'vrp',
  'pareto_multi_objective', 'bayesian_inference', 'queue_simulation', 'scenario_comparison',
  'multi_criteria_decision',
]);

export function scientificKindForTool(toolId: string | null | undefined): FormulationKind | null {
  return toolId ? SCIENTIFIC_KIND_BY_TOOL[toolId] ?? null : null;
}

export function scientificToolForKind(kind: FormulationKind): string {
  return SCIENTIFIC_TOOL_BY_KIND[kind];
}

export function structuredScientificKind(model: Record<string, unknown> | null): FormulationKind | null {
  if (!model) return null;
  const edges = Array.isArray(model['edges']) ? model['edges'] as Array<Record<string, unknown>> : [];
  if (edges.length && typeof model['source'] === 'string' && typeof model['sink'] === 'string') {
    const hasCost = edges.some((edge) => edge && typeof edge === 'object' && 'cost' in edge) || model['demand'] !== undefined;
    return hasCost ? 'min_cost_flow' : 'max_flow';
  }
  if (Array.isArray(model['left']) && Array.isArray(model['right']) && edges.length) return 'bipartite_matching';
  if (Array.isArray(model['depots']) && Array.isArray(model['customers']) && Array.isArray(model['vehicles'])) return 'vrp';
  if ((Array.isArray(model['points']) || Array.isArray(model['distanceMatrix'])) && !model['depots']) return 'tsp';
  if (Array.isArray(model['objectives']) && Array.isArray(model['candidates'])) return 'pareto_multi_objective';
  if (model['type'] === 'beta_binomial' || model['type'] === 'normal_normal') return 'bayesian_inference';
  if (Number.isInteger(model['customers']) && Number.isInteger(model['servers'])) return 'queue_simulation';
  if (Array.isArray(model['scenarios'])) return 'scenario_comparison';
  if (edges.length && typeof model['start'] === 'string' && typeof model['goal'] === 'string') return 'shortest_path';
  if (Array.isArray(model['employees']) && Array.isArray(model['shifts'])) return 'employee_scheduling';
  if (Array.isArray(model['objective']) && Array.isArray(model['constraints'])) {
    return model['integerVars'] || model['binaryVars'] ? 'integer_programming' : 'linear_programming';
  }
  if (Array.isArray(model['costMatrix'])) return 'assignment';
  if (Array.isArray(model['items'])) return 'monte_carlo_simulation';
  if (Array.isArray(model['series'])) return 'forecasting';
  if (Array.isArray(model['criteria']) && Array.isArray(model['alternatives'])) return 'multi_criteria_decision';
  return null;
}

export function modelForScientificKind(kind: FormulationKind, model: Record<string, unknown> | null): unknown | null {
  if (!model) return null;
  const shape = structuredScientificKind(model);
  if (!shape) return null;
  if (shape === kind) return model;
  if (kind === 'integer_programming' && shape === 'linear_programming') return model;
  if (kind === 'linear_programming' && shape === 'integer_programming') return model;
  if (kind === 'min_cost_flow' && shape === 'max_flow') return model;
  return null;
}

export function kindLabel(kind: FormulationKind): string {
  return kind.replaceAll('_', ' ');
}
