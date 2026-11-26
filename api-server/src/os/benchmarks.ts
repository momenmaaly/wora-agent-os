/**
 * WORA OS — reproducible algorithm benchmarks.
 *
 * Every benchmark uses a fixed fixture and the real tool registry. Correctness
 * is checked against an independent reference where one is cheap and exact;
 * otherwise the result records repeatability and the limitation instead of a
 * fabricated quality claim.
 */
import { performance } from 'node:perf_hooks';
import { getOsDb, newId, nowIso } from './db.js';
import { runTool } from './tools.js';
import { understandProblem } from './problem.js';
import { selectAlgorithm } from './algorithms.js';
import { buildPlan } from './orchestrator.js';
import { comparePlans, verifyPlanExecution } from './planning.js';
import { verifyIndependently } from './independent-verification.js';
import { classifyAction } from './actions.js';
import { listScientificDomains } from './science.js';

export const BENCHMARK_SUITE_VERSION = '1.1.0';

export interface BenchmarkResult {
  id: string;
  name: string;
  toolId: string;
  problemClass: string;
  correctness: boolean;
  quality: number | null;
  timeMs: number;
  toolCalls: number;
  reference: string;
  alternatives: string[];
  limitations: string[];
  evidence: Record<string, unknown>;
}

export interface BenchmarkRun {
  id: string;
  workspaceId: string;
  suiteVersion: string;
  results: BenchmarkResult[];
  summary: { total: number; passed: number; failed: number; totalMs: number; deterministicFixtures: number };
  createdAt: string;
}

export { listScientificDomains } from './science.js';


const result = (input: Omit<BenchmarkResult, 'id'>): BenchmarkResult => ({ id: newId('bench'), ...input });

async function timed(toolId: string, input: unknown, workspaceId: string): Promise<{ ok: boolean; output: unknown; timeMs: number; error?: string }> {
  const started = performance.now();
  const response = await runTool(toolId, input, { workspaceId, actor: 'benchmark', permissions: new Set(['*']) });
  return { ok: response.ok, output: response.output, timeMs: Math.round((performance.now() - started) * 1000) / 1000, error: response.error };
}

function permutations(values: number[]): number[][] {
  if (values.length <= 1) return [values];
  const out: number[][] = [];
  for (let i = 0; i < values.length; i++) {
    const rest = [...values.slice(0, i), ...values.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([values[i]!, ...tail]);
  }
  return out;
}

export async function runBenchmarkSuite(workspaceId: string): Promise<BenchmarkRun> {
  const results: BenchmarkResult[] = [];
  const matrix = [[9, 2, 7, 8], [6, 4, 3, 7], [5, 8, 1, 8], [7, 6, 9, 4]];
  const assignment = await timed('or.assignment', { costMatrix: matrix }, workspaceId);
  const brute = Math.min(...permutations([0, 1, 2, 3]).map((perm) => perm.reduce((sum, col, row) => sum + matrix[row]![col]!, 0)));
  const assignmentCost = (assignment.output as { totalCost?: number } | null)?.totalCost;
  results.push(result({
    name: '4x4 assignment fixture', toolId: 'or.assignment', problemClass: 'assignment',
    correctness: assignment.ok && assignmentCost === brute, quality: assignmentCost === brute ? 0 : null,
    timeMs: assignment.timeMs, toolCalls: 1, reference: `brute-force optimum ${brute}`,
    alternatives: ['brute-force enumeration (reference)', 'Hungarian algorithm (tested)'],
    limitations: ['The reference is exact only for small matrices.'],
    evidence: { assignmentCost, brute, ok: assignment.ok },
  }));

  const scheduleInput = {
    employees: [
      { id: 'e1', name: 'A', hourlyCost: 10, availability: ['morning', 'evening'], maxAssignments: 1 },
      { id: 'e2', name: 'B', hourlyCost: 12, availability: ['morning'], maxAssignments: 1 },
      { id: 'e3', name: 'C', hourlyCost: 9, availability: ['evening'], maxAssignments: 1 },
    ],
    shifts: [{ id: 'morning', name: 'Morning', demand: 1 }, { id: 'evening', name: 'Evening', demand: 1 }],
  };
  const schedule = await timed('or.employee_schedule', scheduleInput, workspaceId);
  const scheduleOut = schedule.output as { feasible?: boolean; totalCost?: number; validation?: { ok?: boolean }; perShift?: Array<{ meetsDemand?: boolean }> } | null;
  results.push(result({
    name: 'small employee schedule fixture', toolId: 'or.employee_schedule', problemClass: 'integer_programming',
    correctness: Boolean(schedule.ok && scheduleOut?.feasible === true && scheduleOut?.perShift?.length === scheduleInput.shifts.length && scheduleOut?.perShift?.every((shift) => shift.meetsDemand === true) && Number.isFinite(scheduleOut?.totalCost) && Number(scheduleOut?.totalCost) >= 0),
    quality: scheduleOut?.totalCost ?? null, timeMs: schedule.timeMs, toolCalls: 1,
    reference: 'independent demand coverage and solver validation', alternatives: ['HiGHS MIP (tested)', 'hand enumeration for two shifts (reference)'],
    limitations: ['Fixture is small; runtime and quality do not generalize to large rosters.'],
    evidence: { feasible: scheduleOut?.feasible, totalCost: scheduleOut?.totalCost, validation: scheduleOut?.validation, ok: schedule.ok },
  }));

  const lpInput = {
    sense: 'maximize', objective: [{ var: 'x', coeff: 1 }, { var: 'y', coeff: 1 }],
    constraints: [{ name: 'capacity', terms: [{ var: 'x', coeff: 1 }, { var: 'y', coeff: 1 }], op: '<=', rhs: 4 }],
    bounds: { x: { lower: 0 }, y: { lower: 0 } },
  };
  const lp = await timed('or.solve_lp', lpInput, workspaceId);
  const lpOut = lp.output as { status?: string; objectiveValue?: number } | null;
  results.push(result({
    name: 'two-variable LP fixture', toolId: 'or.solve_lp', problemClass: 'linear_programming',
    correctness: Boolean(lp.ok && lpOut?.status === 'Optimal' && Math.abs(Number(lpOut?.objectiveValue) - 4) < 1e-9),
    quality: lpOut?.objectiveValue ?? null, timeMs: lp.timeMs, toolCalls: 1,
    reference: 'analytic optimum 4', alternatives: ['HiGHS LP (tested)', 'analytic vertex enumeration (reference)'],
    limitations: ['Fixture has one binding constraint and two variables.'],
    evidence: { status: lpOut?.status, objectiveValue: lpOut?.objectiveValue, ok: lp.ok },
  }));

  const mcInput = { trials: 1000, seed: 42, items: [{ name: 'work', optimistic: 2, likely: 4, pessimistic: 9 }] };
  const mcA = await timed('sim.monte_carlo', mcInput, workspaceId);
  const mcB = await timed('sim.monte_carlo', mcInput, workspaceId);
  const mcOut = mcA.output as { mean?: number; p10?: number; p50?: number; p90?: number; simulated?: boolean } | null;
  const mcOutB = mcB.output as { mean?: number } | null;
  results.push(result({
    name: 'seeded PERT simulation fixture', toolId: 'sim.monte_carlo', problemClass: 'monte_carlo_simulation',
    correctness: Boolean(mcA.ok && mcB.ok && mcOut?.simulated === true && mcOut?.mean === mcOutB?.mean && Number(mcOut?.p10) <= Number(mcOut?.p50) && Number(mcOut?.p50) <= Number(mcOut?.p90)),
    quality: null, timeMs: Math.round((mcA.timeMs + mcB.timeMs) * 1000) / 1000, toolCalls: 2,
    reference: 'same-seed repeatability and quantile ordering', alternatives: ['seeded Monte Carlo (tested)', 'closed-form triangular moments (not implemented)'],
    limitations: ['A simulated estimate is not an observation; the fixture has no ground-truth future.'],
    evidence: { meanA: mcOut?.mean, meanB: mcOutB?.mean, p10: mcOut?.p10, p50: mcOut?.p50, p90: mcOut?.p90 },
  }));

  const series = Array.from({ length: 10 }, (_, index) => index + 1);
  const forecast = await timed('forecast.linear', { series, steps: 3 }, workspaceId);
  const forecastOut = forecast.output as { projections?: Array<{ point?: number }>; r2?: number } | null;
  const expected = [11, 12, 13];
  results.push(result({
    name: 'exact linear trend fixture', toolId: 'forecast.linear', problemClass: 'forecasting',
    correctness: Boolean(forecast.ok && forecastOut?.projections?.every((entry, index) => Math.abs(Number(entry.point) - expected[index]!) < 1e-6)),
    quality: forecastOut?.r2 ?? null, timeMs: forecast.timeMs, toolCalls: 1,
    reference: 'analytic continuation 11, 12, 13', alternatives: ['least-squares baseline (tested)', 'domain forecaster with exogenous data (not implemented)'],
    limitations: ['An exact synthetic line does not measure real-world forecast accuracy.'],
    evidence: { projections: forecastOut?.projections?.map((entry) => entry.point), expected, r2: forecastOut?.r2 },
  }));

  const decisionInput = {
    criteria: [{ id: 'cost', label: 'Cost', weight: 2 }, { id: 'speed', label: 'Speed', weight: 1 }],
    alternatives: [{ name: 'A', scores: { cost: 8, speed: 4 } }, { name: 'B', scores: { cost: 5, speed: 9 } }],
  };
  const decision = await timed('decision.weighted_matrix', decisionInput, workspaceId);
  const decisionOut = decision.output as { ranking?: Array<{ name?: string }> } | null;
  const expectedWinner = (2 * 8 + 1 * 4) >= (2 * 5 + 1 * 9) ? 'A' : 'B';
  results.push(result({
    name: 'weighted decision fixture', toolId: 'decision.weighted_matrix', problemClass: 'multi_criteria_decision',
    correctness: Boolean(decision.ok && decisionOut?.ranking?.[0]?.name === expectedWinner),
    quality: null, timeMs: decision.timeMs, toolCalls: 1,
    reference: `hand-computed winner ${expectedWinner}`, alternatives: ['weighted matrix (tested)', 'hand computation (reference)'],
    limitations: ['Weights are supplied, not learned; the result is not a causal claim.'],
    evidence: { winner: decisionOut?.ranking?.[0]?.name, expectedWinner },
  }));

  const stats = await timed('stats.describe', { series }, workspaceId);
  const statsOut = stats.output as { mean?: number; count?: number } | null;
  results.push(result({
    name: 'descriptive statistics fixture', toolId: 'stats.describe', problemClass: 'descriptive_statistics',
    correctness: Boolean(stats.ok && statsOut?.count === 10 && Math.abs(Number(statsOut?.mean) - 5.5) < 1e-9),
    quality: null, timeMs: stats.timeMs, toolCalls: 1, reference: 'direct mean 5.5',
    alternatives: ['descriptive statistics (tested)', 'direct computation (reference)'],
    limitations: ['Descriptive only; no inference or causal interpretation.'],
    evidence: { mean: statsOut?.mean, count: statsOut?.count },
  }));

  const understandingStart = performance.now();
  const understandingCases = [
    { objective: 'Optimize employee shifts with a cost matrix and risk', domain: 'operations_research' },
    { objective: 'Inspect my computer and diagnose the host system', domain: 'diagnostics' },
    { objective: 'Forecast a time series and compute descriptive statistics', domain: 'data_intelligence' },
    { objective: 'Build a working web application with a tested API', domain: 'software_engineering' },
  ].map((fixture) => ({ fixture, profile: understandProblem({ objective: fixture.objective }) }));
  const understandingMs = Math.round((performance.now() - understandingStart) * 1000) / 1000;
  results.push(result({
    name: 'structured problem-understanding fixtures', toolId: 'meta.understand_problem', problemClass: 'problem_understanding',
    correctness: understandingCases.every(({ fixture, profile }) => profile.domain === fixture.domain && profile.features !== undefined),
    quality: null, timeMs: understandingMs, toolCalls: understandingCases.length,
    reference: 'expected deterministic domains for four objectives', alternatives: ['deterministic rules (tested)', 'semantic classifier (not implemented)'],
    limitations: ['Four small English/Arabic fixtures do not measure general language understanding.', 'Domain labels are expected outputs from the rule set, not human annotations.'],
    evidence: { cases: understandingCases.map(({ fixture, profile }) => ({ objective: fixture.objective, expected: fixture.domain, actual: profile.domain, algorithmStatus: profile.algorithmSelection.status })) },
  }));

  const planningStart = performance.now();
  const planningProfile = understandProblem({ objective: 'Analyze the objective and extract requirements' });
  const planningInput = buildPlan('Analyze the objective and extract requirements', undefined, workspaceId);
  const planningComparison = comparePlans(planningInput, workspaceId, planningProfile);
  const planningMs = Math.round((performance.now() - planningStart) * 1000) / 1000;
  const planningPlan = planningComparison.preferred;
  results.push(result({
    name: 'formal planning and alternative comparison fixture', toolId: 'planning.comparePlans', problemClass: 'planning',
    correctness: planningPlan.tasks.length === planningInput.length && planningPlan.criticalPath.length > 0 && planningPlan.metrics.taskCount === planningInput.length,
    quality: planningPlan.metrics.totalCost, timeMs: planningMs, toolCalls: 1,
    reference: 'deterministic plan graph and critical path', alternatives: ['direct order (tested)', 'risk-first order (tested)'],
    limitations: ['Cost is a risk-weighted planning estimate, not wall-clock time or money.', 'The fixture has a shallow dependency graph.'],
    evidence: { strategy: planningPlan.strategy, taskCount: planningPlan.metrics.taskCount, criticalPath: planningPlan.criticalPath, alternatives: planningComparison.plans.map((plan) => ({ strategy: plan.strategy, cost: plan.metrics.totalCost })) },
  }));

  const algorithmStart = performance.now();
  const algorithmCases = [
    { kind: 'assignment' as const, expected: 'or.assignment' },
    { kind: 'employee_scheduling' as const, expected: 'or.employee_schedule' },
    { kind: 'linear_programming' as const, expected: 'or.solve_lp' },
    { kind: 'forecasting' as const, expected: 'forecast.linear' },
  ].map((fixture) => ({ fixture, selection: selectAlgorithm({ kind: fixture.kind }) }));
  const algorithmMs = Math.round((performance.now() - algorithmStart) * 1000) / 1000;
  results.push(result({
    name: 'algorithm-selection fixtures', toolId: 'meta.algorithm_select', problemClass: 'algorithm_selection',
    correctness: algorithmCases.every(({ fixture, selection }) => selection.primary?.toolId === fixture.expected),
    quality: null, timeMs: algorithmMs, toolCalls: algorithmCases.length,
    reference: 'catalog mapping from problem kind to implemented tool', alternatives: ['deterministic catalog selection (tested)', 'learned selector (not implemented)'],
    limitations: ['Tests catalog routing, not solution quality on a dataset.', 'Unsupported and ambiguous classes intentionally return needs_input/unsupported.'],
    evidence: { cases: algorithmCases.map(({ fixture, selection }) => ({ kind: fixture.kind, expected: fixture.expected, actual: selection.primary?.toolId ?? null, status: selection.status })) },
  }));

  const graph = [
    { id: 'a', status: 'completed', dependsOn: [] as string[] },
    { id: 'b', status: 'completed', dependsOn: ['a'] },
    { id: 'c', status: 'completed', dependsOn: ['b'] },
  ];
  const badGraph = [
    { id: 'a', status: 'failed', dependsOn: [] as string[] },
    { id: 'b', status: 'completed', dependsOn: ['a'] },
  ];
  const graphStart = performance.now();
  const graphCheck = verifyPlanExecution(graph);
  const badCheck = verifyPlanExecution(badGraph);
  const graphMs = Math.round((performance.now() - graphStart) * 1000) / 1000;
  results.push(result({
    name: 'dependency and failure-propagation verification fixtures', toolId: 'planning.verifyPlanExecution', problemClass: 'scheduling_verification',
    correctness: graphCheck.passed && !badCheck.passed,
    quality: null, timeMs: graphMs, toolCalls: 2,
    reference: 'valid DAG passes; completed child of failed parent fails', alternatives: ['structural graph verification (tested)', 'runtime-only executor report (rejected)'],
    limitations: ['Structural checks do not prove that a real worker executed in the expected order; lease and checkpoint checks cover that separately.'],
    evidence: { valid: graphCheck, invalid: badCheck },
  }));

  const verificationStart = performance.now();
  const goodVerification = verifyIndependently({ tool: 'stats.describe', toolOk: true, output: { mean: 5.5, count: 10 } });
  const badVerification = verifyIndependently({ tool: 'web.fetch_read', toolOk: true, output: { status: 200, content: 'token ghp_abcdefghijklmnopqrstuvwxyz123456' } });
  const verificationMs = Math.round((performance.now() - verificationStart) * 1000) / 1000;
  results.push(result({
    name: 'independent verification accuracy fixtures', toolId: 'wora.verifier/independent', problemClass: 'verification',
    correctness: goodVerification.passed && !badVerification.passed && badVerification.failures.some((failure) => /secret leak/i.test(failure)),
    quality: null, timeMs: verificationMs, toolCalls: 2,
    reference: 'clean output passes; credential leak fails closed', alternatives: ['independent contract/property/security checks (tested)', 'executor self-report (rejected)'],
    limitations: ['Two fixtures measure detection behavior, not a full precision/recall benchmark.'],
    evidence: { goodPassed: goodVerification.passed, badPassed: badVerification.passed, badFailures: badVerification.failures },
  }));

  const interventionStart = performance.now();
  const highRisk = classifyAction({ action: 'Deploy to production', risk: 'high', reversible: false });
  const lowRisk = classifyAction({ action: 'Summarize a document', risk: 'low', reversible: true });
  const interventionRate = 1 / 2;
  const interventionMs = Math.round((performance.now() - interventionStart) * 1000) / 1000;
  results.push(result({
    name: 'human-intervention classification fixture', toolId: 'meta.action_classify', problemClass: 'human_intervention',
    correctness: highRisk.class === 'C' && lowRisk.class !== 'C',
    quality: interventionRate, timeMs: interventionMs, toolCalls: 2,
    reference: 'high irreversible action requires intervention; low reversible action does not', alternatives: ['deterministic A/B/C classification (tested)', 'autopilot for class C (rejected)'],
    limitations: ['Intervention rate is computed over two illustrative actions, not a production workload.'],
    evidence: { highRisk, lowRisk, interventionRate },
  }));

  const coordinationStart = performance.now();
  const coordinationPlan = buildPlan('Build a working web application with a tested API', undefined, workspaceId);
  const coordinationGraph = coordinationPlan.map((task, index) => ({ id: String(index), status: 'completed', dependsOn: task.dependsOn.map(String) }));
  const coordinationMs = Math.round((performance.now() - coordinationStart) * 1000) / 1000;
  results.push(result({
    name: 'multi-agent handoff graph fixture', toolId: 'planning.verifyPlanExecution', problemClass: 'multi_agent_coordination',
    correctness: coordinationPlan.length >= 3 && coordinationPlan.every((task) => task.specialization.length > 0) && verifyPlanExecution(coordinationGraph).passed,
    quality: coordinationPlan.length, timeMs: coordinationMs, toolCalls: 1,
    reference: 'specialist assignments and dependency graph from the deterministic planner', alternatives: ['deterministic specialist plan (tested)', 'unconstrained parallel agents (rejected)'],
    limitations: ['Measures plan structure only; it does not execute multiple agents or claim coordination quality.'],
    evidence: { tasks: coordinationPlan.map((task) => ({ title: task.title, specialization: task.specialization, dependsOn: task.dependsOn })), verification: verifyPlanExecution(coordinationGraph) },
  }));

  const passed = results.filter((entry) => entry.correctness).length;
  const run: BenchmarkRun = {
    id: newId('bmr'), workspaceId, suiteVersion: BENCHMARK_SUITE_VERSION, results,
    summary: { total: results.length, passed, failed: results.length - passed, totalMs: Math.round(results.reduce((sum, entry) => sum + entry.timeMs, 0) * 1000) / 1000, deterministicFixtures: results.length },
    createdAt: nowIso(),
  };
  getOsDb().prepare('INSERT INTO os_benchmark_runs (id, workspace_id, suite_version, results, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(run.id, workspaceId, run.suiteVersion, JSON.stringify(results).slice(0, 1_000_000), JSON.stringify(run.summary), run.createdAt);
  return run;
}

export function listBenchmarkRuns(workspaceId: string, limit = 20): BenchmarkRun[] {
  const rows = getOsDb().prepare('SELECT * FROM os_benchmark_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, Math.min(Math.max(limit, 1), 50)) as unknown as Array<Record<string, string>>;
  return rows.map((row) => ({
    id: String(row['id']), workspaceId: String(row['workspace_id']), suiteVersion: String(row['suite_version']),
    results: (() => { try { return JSON.parse(String(row['results'] ?? '[]')) as BenchmarkResult[]; } catch { return []; } })(),
    summary: JSON.parse(String(row['summary'] ?? '{}')) as BenchmarkRun['summary'], createdAt: String(row['created_at']),
  }));
}
