/**
 * WORA OS — result-status semantics.
 *
 * A solver claim and a verification result are separate facts. This module
 * normalizes them into one explicit status so Mission Review never promotes a
 * feasible or approximate result to optimal, and never rejects a verified
 * feasible result merely because optimality was not established.
 */
export type ResultStatus = 'optimal' | 'feasible' | 'approximate' | 'unverified' | 'not_verified' | 'infeasible';

export interface ResultAssessment {
  tool: string;
  status: ResultStatus;
  acceptable: boolean;
  optimalityEstablished: boolean;
  verificationPassed: boolean;
  simulated: boolean;
  issues: string[];
  evidence: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const lower = (value: unknown): string => typeof value === 'string' ? value.trim().toLowerCase() : '';

function verificationPassed(out: Record<string, unknown>): boolean | null {
  const verification = out['verification'];
  if (!isRecord(verification)) return null;
  return verification['passed'] === true;
}

function structuralStatus(tool: string, out: Record<string, unknown>): { status: ResultStatus; simulated: boolean } {
  const raw = lower(out['status']);
  const simulated = out['simulated'] === true;
  switch (tool) {
    case 'or.solve_lp':
      if (raw === 'optimal') return { status: 'optimal', simulated: false };
      if (raw === 'feasible') return { status: 'feasible', simulated: false };
      if (raw === 'infeasible') return { status: 'infeasible', simulated: false };
      return { status: 'not_verified', simulated: false };
    case 'or.employee_schedule':
      if (out['feasible'] === false) return { status: 'infeasible', simulated: false };
      if (out['feasible'] === true) return { status: raw === 'optimal' ? 'optimal' : 'feasible', simulated: false };
      return { status: 'not_verified', simulated: false };
    case 'or.assignment':
      return { status: 'optimal', simulated: false };
    case 'graph.shortest_path':
      if (raw === 'optimal') return { status: 'optimal', simulated: false };
      if (raw === 'no_path') return { status: 'infeasible', simulated: false };
      return { status: 'not_verified', simulated: false };
    case 'graph.max_flow':
    case 'graph.min_cost_flow':
    case 'graph.bipartite_matching':
    case 'decision.pareto':
    case 'stats.bayes_update':
      if (raw === 'optimal') return { status: 'optimal', simulated: false };
      if (raw === 'infeasible') return { status: 'infeasible', simulated: false };
      return { status: 'not_verified', simulated: false };
    case 'routing.tsp':
      if (raw === 'optimal') return { status: 'optimal', simulated: false };
      if (raw === 'approximate') return { status: 'approximate', simulated: false };
      if (raw === 'infeasible') return { status: 'infeasible', simulated: false };
      return { status: 'not_verified', simulated: false };
    case 'routing.vrp':
      if (raw === 'feasible') return { status: 'feasible', simulated: false };
      if (raw === 'infeasible') return { status: 'infeasible', simulated: false };
      return { status: 'not_verified', simulated: false };
    case 'sim.queue':
      if (raw === 'infeasible') return { status: 'infeasible', simulated: false };
      return { status: simulated ? 'feasible' : 'not_verified', simulated };
    case 'sim.scenario_compare':
      if (raw === 'infeasible') return { status: 'infeasible', simulated: false };
      return { status: simulated ? 'feasible' : 'not_verified', simulated };
    case 'sim.monte_carlo': {
      const ordered = finite(out['p10']) && finite(out['p50']) && finite(out['p90'])
        && Number(out['p10']) <= Number(out['p50']) && Number(out['p50']) <= Number(out['p90']);
      return { status: simulated && ordered ? 'feasible' : 'not_verified', simulated };
    }
    case 'forecast.linear':
      return {
        status: Array.isArray(out['projections']) && out['projections'].length > 0 && finite(out['holdoutMae']) ? 'feasible' : 'not_verified',
        simulated: false,
      };
    case 'decision.weighted_matrix':
      return {
        status: Array.isArray(out['ranking']) && out['ranking'].length > 0 && typeof out['robust'] === 'boolean' ? 'feasible' : 'not_verified',
        simulated: false,
      };
    case 'meta.formulate_scientific_problem':
      return { status: out['executable'] === true ? 'feasible' : 'unverified', simulated: false };
    case 'host.exec':
      return { status: out['passed'] === true && (out['exitCode'] === undefined || out['exitCode'] === 0) ? 'feasible' : 'not_verified', simulated: false };
    case 'security.scan':
      return { status: Number(out['criticalSecrets'] ?? 0) === 0 ? 'feasible' : 'not_verified', simulated: false };
    default:
      return { status: 'feasible', simulated };
  }
}

export function assessToolResult(tool: string | null, toolOk: boolean, output: unknown, error: string | null = null): ResultAssessment {
  const id = tool ?? 'none';
  if (!toolOk || !isRecord(output)) {
    return {
      tool: id, status: toolOk ? 'unverified' : 'not_verified', acceptable: false,
      optimalityEstablished: false, verificationPassed: false, simulated: false,
      issues: [toolOk ? 'Tool returned no output' : (error ?? 'Tool execution failed')],
      evidence: `status=${toolOk ? 'unverified' : 'not_verified'}; optimality=not-established; verification=not-run; simulated=false`,
    };
  }
  const structural = structuralStatus(id, output);
  const reportedVerification = verificationPassed(output);
  const requiresVerification = new Set([
    'or.solve_lp', 'or.employee_schedule', 'or.assignment', 'graph.shortest_path',
    'graph.max_flow', 'graph.min_cost_flow', 'graph.bipartite_matching', 'routing.tsp',
    'routing.vrp', 'decision.pareto', 'stats.bayes_update', 'sim.queue', 'sim.scenario_compare',
  ]);
  const verification = reportedVerification ?? (requiresVerification.has(id) ? false : structural.status !== 'not_verified');
  const status: ResultStatus = structural.status === 'infeasible' || structural.status === 'unverified'
    ? structural.status
    : verification ? structural.status : 'not_verified';
  const acceptable = status === 'optimal' || status === 'feasible' || status === 'approximate';
  const issues: string[] = [];
  if (status === 'infeasible') issues.push('Result is infeasible: the modeled constraints have no feasible solution.');
  else if (status === 'unverified') issues.push('Result is unverified: required inputs or evidence are missing.');
  else if (status === 'not_verified') issues.push('Result is not verified: independent verification did not pass or was not performed.');
  else if (!verification) issues.push('Independent verification did not pass.');
  return {
    tool: id, status, acceptable,
    optimalityEstablished: status === 'optimal',
    verificationPassed: verification,
    simulated: structural.simulated,
    issues,
    evidence: `status=${status}; optimality=${status === 'optimal' ? 'established' : 'not-established'}; verification=${verification ? 'passed' : 'not-passed'}; simulated=${structural.simulated}`,
  };
}
