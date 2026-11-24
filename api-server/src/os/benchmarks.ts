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

export const BENCHMARK_SUITE_VERSION = '1.0.0';

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

const DOMAIN_CAPABILITY_MAP = [
  { domain: 'Artificial intelligence and cognitive architectures', implemented: ['deterministic planner', 'extractive summary', 'specialist registry and handoffs'], partial: ['problem-understanding profile'], missing: ['general semantic planner', 'meta-reasoning controller'] },
  { domain: 'Mathematics and computational foundations', implemented: ['least squares', 'Monte Carlo probability', 'discrete optimization', 'descriptive statistics'], partial: ['numerical stability policy'], missing: ['general symbolic reasoning'] },
  { domain: 'Automated planning and search', implemented: ['rule planning', 'dependency-blocked task execution'], partial: ['durable task leases and checkpoints'], missing: ['A*', 'MCTS', 'PDDL planner'] },
  { domain: 'Decision science and causal intelligence', implemented: ['weighted decision matrix', 'Monte Carlo', 'descriptive statistics'], partial: ['sensitivity perturbation'], missing: ['Bayesian networks', 'causal inference', 'POMDP'] },
  { domain: 'Operations research and optimization', implemented: ['HiGHS LP/MIP', 'Hungarian assignment', 'employee scheduling'], partial: ['multi-objective optimization'], missing: ['CP-SAT', 'min-cost flow', 'robust optimization'] },
  { domain: 'Multi-agent systems and distributed intelligence', implemented: ['persistent agents', 'handoffs', 'review gates', 'durable task leases'], partial: ['multi-worker claim safety'], missing: ['consensus protocol', 'game-theoretic allocation'] },
  { domain: 'Control theory and autonomous systems', implemented: ['retry and reassignment', 'approval pause/resume', 'checkpoint recovery'], partial: ['adaptive retry policy'], missing: ['MPC', 'adaptive control'] },
  { domain: 'Simulation and predictive intelligence', implemented: ['seeded PERT Monte Carlo', 'digital twins', 'linear trend baseline'], partial: ['scenario comparison'], missing: ['calibrated system dynamics', 'causal forecasting'] },
  { domain: 'Knowledge and information systems', implemented: ['scoped SQLite memory', 'deterministic retrieval', 'provenance', 'versioning'], partial: ['candidate lesson lifecycle'], missing: ['vector retrieval', 'knowledge graph'] },
  { domain: 'Autonomous engineering and program synthesis', implemented: ['generated zero-dependency web app', 'static security scan', 'node:test verification'], partial: ['patch-based repair'], missing: ['general program synthesis'] },
  { domain: 'Formal verification, safety and reliability', implemented: ['Zod contracts', 'TypeScript checks', 'independent verification checks'], partial: ['property-based testing'], missing: ['model checking', 'SAT/SMT'] },
  { domain: 'Robotics and cyber-physical intelligence', implemented: ['device pairing and revocation foundation'], partial: ['local command channel'], missing: ['navigation', 'motion planning', 'sensor fusion'] },
] as const;

export function listScientificDomains() {
  return DOMAIN_CAPABILITY_MAP;
}

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
    correctness: Boolean(schedule.ok && scheduleOut?.feasible === true && scheduleOut?.perShift?.every((shift) => shift.meetsDemand === true)),
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

  const passed = results.filter((entry) => entry.correctness).length;
  const run: BenchmarkRun = {
    id: newId('bmr'), workspaceId, suiteVersion: BENCHMARK_SUITE_VERSION, results,
    summary: { total: results.length, passed, failed: results.length - passed, totalMs: Math.round(results.reduce((sum, entry) => sum + entry.timeMs, 0) * 1000) / 1000, deterministicFixtures: results.length },
    createdAt: nowIso(),
  };
  getOsDb().prepare('INSERT INTO os_benchmark_runs (id, workspace_id, suite_version, results, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(run.id, workspaceId, run.suiteVersion, JSON.stringify(results).slice(0, 100_000), JSON.stringify(run.summary), run.createdAt);
  return run;
}

export function listBenchmarkRuns(workspaceId: string, limit = 20): BenchmarkRun[] {
  const rows = getOsDb().prepare('SELECT * FROM os_benchmark_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, Math.min(Math.max(limit, 1), 50)) as unknown as Array<Record<string, string>>;
  return rows.map((row) => ({
    id: String(row['id']), workspaceId: String(row['workspace_id']), suiteVersion: String(row['suite_version']),
    results: JSON.parse(String(row['results'] ?? '[]')) as BenchmarkResult[],
    summary: JSON.parse(String(row['summary'] ?? '{}')) as BenchmarkRun['summary'], createdAt: String(row['created_at']),
  }));
}
