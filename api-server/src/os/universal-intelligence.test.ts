/**
 * WORA OS — universal intelligence acceptance.
 *
 * Natural-language objectives only: no algorithm, agent or tool is selected by
 * the caller. The tests exercise the real planner, mission lifecycle, solver
 * tools, independent verification and Mission Review.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-universal-intelligence-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail, buildPlan } = await import('./orchestrator.js');
const { understandProblem } = await import('./problem.js');
const { assessToolResult } = await import('./result-semantics.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-universal-intelligence';
let server: Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/os', createOsRouter({ production: false }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/os`;
});

after(() => {
  server?.close();
  rmSync(TMP, { recursive: true, force: true });
});

function outputOf(detail: NonNullable<ReturnType<typeof getMissionDetail>>, tool: string): Record<string, unknown> {
  const task = detail.tasks.find((candidate) => candidate.tool === tool);
  assert.ok(task, `missing task for ${tool}`);
  const run = task.runs.find((candidate) => candidate.status === 'completed');
  assert.ok(run, `missing completed run for ${tool}`);
  const evidence = run.evidence as Array<{ output?: Record<string, unknown> }>;
  const output = evidence.find((entry) => entry.output !== undefined)?.output;
  assert.ok(output, `missing output for ${tool}`);
  return output;
}

function latestOutputOf(detail: NonNullable<ReturnType<typeof getMissionDetail>>, tool: string): Record<string, unknown> {
  const task = detail.tasks.find((candidate) => candidate.tool === tool);
  assert.ok(task, `missing task for ${tool}`);
  const run = [...task.runs].reverse().find((candidate) => candidate.evidence.length > 0);
  assert.ok(run, `missing run for ${tool}`);
  const evidence = run.evidence as Array<{ output?: Record<string, unknown> }>;
  const output = evidence.find((entry) => entry.output !== undefined)?.output;
  assert.ok(output, `missing output for ${tool}`);
  return output;
}

async function createAndExecute(objective: string, concurrency = 1) {
  const created = await fetch(`${baseUrl}/missions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ objective, execute: false }),
  });
  assert.equal(created.status, 202);
  const mission = await created.json() as { id: string };
  const executed = await fetch(`${baseUrl}/missions/${mission.id}/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ concurrency }),
  });
  assert.equal(executed.status, 200);
  return await executed.json() as NonNullable<ReturnType<typeof getMissionDetail>>;
}

test('result-status semantics distinguish optimal, feasible, approximate, unverified, not_verified and infeasible', () => {
  const verified = { passed: true, checks: [], failures: [] };
  assert.equal(assessToolResult('or.solve_lp', true, { status: 'Optimal', objectiveValue: 1, verification: verified }).status, 'optimal');
  const feasible = assessToolResult('or.solve_lp', true, { status: 'Feasible', objectiveValue: 1, verification: verified });
  assert.equal(feasible.status, 'feasible');
  assert.equal(feasible.acceptable, true);
  assert.equal(feasible.optimalityEstablished, false);
  assert.equal(assessToolResult('routing.tsp', true, { status: 'approximate', exact: false, tour: ['a', 'b'], cost: 3, verification: verified }).status, 'approximate');
  assert.equal(assessToolResult('graph.shortest_path', true, { status: 'optimal', path: ['a'], totalCost: 0, verification: { passed: false } }).status, 'not_verified');
  assert.equal(assessToolResult('or.solve_lp', false, null, 'solver crashed').status, 'not_verified');
  assert.equal(assessToolResult('meta.formulate_scientific_problem', true, { executable: false }).status, 'unverified');
  assert.equal(assessToolResult('routing.vrp', true, { status: 'infeasible', verification: { passed: false } }).status, 'infeasible');
  assert.equal(assessToolResult('or.solve_lp', true, { status: 'Optimal', objectiveValue: 1, verification: { passed: false } }).status, 'not_verified');
});

const LP_MODEL = {
  sense: 'minimize',
  objective: [{ var: 'x', coeff: 2 }, { var: 'y', coeff: 3 }],
  constraints: [
    { name: 'demand', terms: [{ var: 'x', coeff: 1 }, { var: 'y', coeff: 1 }], op: '>=', rhs: 4 },
    { name: 'capacity', terms: [{ var: 'x', coeff: 1 }], op: '<=', rhs: 3 },
  ],
};
const MIP_MODEL = {
  sense: 'maximize',
  objective: [{ var: 'open_a', coeff: 8 }, { var: 'open_b', coeff: 5 }],
  constraints: [{ name: 'capacity', terms: [{ var: 'open_a', coeff: 2 }, { var: 'open_b', coeff: 1 }], op: '<=', rhs: 3 }],
  binaryVars: ['open_a', 'open_b'],
};
const ASSIGNMENT_MODEL = { costMatrix: [[12, 7, 9], [8, 14, 5], [6, 9, 11]], rowLabels: ['ana', 'ben', 'chen'], colLabels: ['api', 'web', 'data'] };
const SCHEDULE_MODEL = {
  employees: [
    { id: 'e1', name: 'Ana', hourlyCost: 20, availability: ['am', 'pm'] },
    { id: 'e2', name: 'Ben', hourlyCost: 18, availability: ['am'] },
  ],
  shifts: [{ id: 'am', name: 'Morning', demand: 1 }, { id: 'pm', name: 'Afternoon', demand: 1 }],
};
const GRAPH_MODEL = {
  edges: [
    { from: 's', to: 'a', weight: 1 },
    { from: 'a', to: 't', weight: 2 },
    { from: 's', to: 't', weight: 5 },
  ],
  start: 's', goal: 't',
};
const FLOW_MODEL = {
  source: 's', sink: 't',
  edges: [
    { from: 's', to: 'a', capacity: 3 }, { from: 's', to: 'b', capacity: 2 },
    { from: 'a', to: 'b', capacity: 1 }, { from: 'a', to: 't', capacity: 2 }, { from: 'b', to: 't', capacity: 3 },
  ],
};
const MIN_COST_MODEL = {
  source: 's', sink: 't', demand: 3,
  edges: [
    { from: 's', to: 'a', capacity: 2, cost: 1 }, { from: 's', to: 'b', capacity: 2, cost: 2 },
    { from: 'a', to: 't', capacity: 2, cost: 1 }, { from: 'b', to: 't', capacity: 2, cost: 1 },
  ],
};
const BIPARTITE_MODEL = { left: ['a', 'b', 'c'], right: ['x', 'y', 'z'], edges: [{ left: 'a', right: 'x' }, { left: 'a', right: 'y' }, { left: 'b', right: 'y' }, { left: 'c', right: 'z' }] };
const TSP_MODEL = { points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 0, y: 1 }, { id: 'C', x: 1, y: 0 }, { id: 'D', x: 1, y: 1 }] };
const VRP_MODEL = {
  depots: [{ id: 'd', x: 0, y: 0 }],
  customers: [{ id: 'a', x: 0, y: 1, demand: 1 }, { id: 'b', x: 1, y: 0, demand: 1 }, { id: 'c', x: 1, y: 1, demand: 1 }],
  vehicles: [{ id: 'v1', capacity: 2 }, { id: 'v2', capacity: 2 }],
};
const PARETO_MODEL = {
  objectives: [{ id: 'cost', label: 'Cost', direction: 'minimize' }, { id: 'quality', label: 'Quality', direction: 'maximize' }],
  candidates: [{ name: 'A', values: { cost: 10, quality: 9 } }, { name: 'B', values: { cost: 8, quality: 7 } }, { name: 'C', values: { cost: 12, quality: 5 } }],
};
const BAYES_MODEL = { type: 'beta_binomial', prior: { alpha: 2, beta: 2 }, successes: 7, trials: 10, alternativePriors: [{ label: 'uniform', alpha: 1, beta: 1 }] };
const MONTE_CARLO_MODEL = { trials: 500, seed: 7, items: [{ name: 'delivery', optimistic: 2, likely: 4, pessimistic: 9 }] };
const QUEUE_MODEL = { customers: 200, interarrivalMean: 1, serviceMean: 1.1, servers: 2, seed: 5 };
const FORECAST_MODEL = { series: [10, 12, 13, 15, 14, 16, 18, 19], steps: 3 };
const DECISION_MODEL = {
  criteria: [{ id: 'cost', label: 'Cost', weight: 0.4, direction: 'minimize' }, { id: 'quality', label: 'Quality', weight: 0.6, direction: 'maximize' }],
  alternatives: [{ name: 'vendor-a', scores: { cost: 6, quality: 9 } }, { name: 'vendor-b', scores: { cost: 9, quality: 7 } }],
};
const SCENARIO_MODEL = {
  trials: 1_000, seed: 3,
  scenarios: [
    { name: 'base', items: [{ name: 'build', optimistic: 5, likely: 7, pessimistic: 10 }] },
    { name: 'slow', items: [{ name: 'build', optimistic: 8, likely: 12, pessimistic: 16 }] },
  ],
};

const CAPABILITIES: Array<{ name: string; objective: string; tool: string; status: string }> = [
  { name: 'LP', objective: 'Minimize production cost with this linear program. Test data:', tool: 'or.solve_lp', status: 'optimal' },
  { name: 'MIP', objective: 'Choose which facilities to open with this binary integer program. Test data:', tool: 'or.solve_lp', status: 'optimal' },
  { name: 'assignment', objective: 'Assign each specialist to one project using this cost matrix. Test data:', tool: 'or.assignment', status: 'optimal' },
  { name: 'employee scheduling', objective: 'Build an employee shift schedule that meets demand at minimum labor cost. Test data:', tool: 'or.employee_schedule', status: 'optimal' },
  { name: 'Dijkstra', objective: 'Find the shortest path from s to t in this weighted graph. Test data:', tool: 'graph.shortest_path', status: 'optimal' },
  { name: 'A*', objective: 'Find the shortest path from s to t with A* using this weighted graph and heuristic. Test data:', tool: 'graph.shortest_path', status: 'optimal' },
  { name: 'max flow', objective: 'Find the maximum flow from source s to sink t in this capacitated network. Test data:', tool: 'graph.max_flow', status: 'optimal' },
  { name: 'min cost flow', objective: 'Find the minimum cost flow that delivers demand 3 through this network. Test data:', tool: 'graph.min_cost_flow', status: 'optimal' },
  { name: 'bipartite matching', objective: 'Find the maximum bipartite matching between these left and right nodes. Test data:', tool: 'graph.bipartite_matching', status: 'optimal' },
  { name: 'TSP', objective: 'Plan the shortest tour that visits every point exactly once. Test data:', tool: 'routing.tsp', status: 'optimal' },
  { name: 'VRP', objective: 'Design vehicle routes that serve every customer within vehicle capacity. Test data:', tool: 'routing.vrp', status: 'feasible' },
  { name: 'Pareto', objective: 'Find the Pareto frontier and trade-offs among these candidates. Test data:', tool: 'decision.pareto', status: 'optimal' },
  { name: 'Bayesian', objective: 'Update the Bayesian posterior from this prior and the observed successes. Test data:', tool: 'stats.bayes_update', status: 'optimal' },
  { name: 'Monte Carlo', objective: 'Simulate the delivery risk with a seeded Monte Carlo estimate. Test data:', tool: 'sim.monte_carlo', status: 'feasible' },
  { name: 'queue', objective: 'Simulate this queue and report waiting time and utilization. Test data:', tool: 'sim.queue', status: 'feasible' },
  { name: 'forecast', objective: 'Forecast demand for the next 3 months from this historical series. Test data:', tool: 'forecast.linear', status: 'feasible' },
  { name: 'decision matrix', objective: 'Choose a vendor with this weighted decision matrix. Test data:', tool: 'decision.weighted_matrix', status: 'feasible' },
  { name: 'scenario comparison', objective: 'Compare these scenarios under uncertainty with a seeded simulation. Test data:', tool: 'sim.scenario_compare', status: 'feasible' },
];

const MODELS: Record<string, unknown> = {
  LP: LP_MODEL, MIP: MIP_MODEL, assignment: ASSIGNMENT_MODEL, 'employee scheduling': SCHEDULE_MODEL,
  Dijkstra: GRAPH_MODEL, 'A*': { ...GRAPH_MODEL, algorithm: 'a_star', heuristic: { s: 3, a: 2, t: 0 } },
  'max flow': FLOW_MODEL, 'min cost flow': MIN_COST_MODEL, 'bipartite matching': BIPARTITE_MODEL,
  TSP: TSP_MODEL, VRP: VRP_MODEL, Pareto: PARETO_MODEL, Bayesian: BAYES_MODEL,
  'Monte Carlo': MONTE_CARLO_MODEL, queue: QUEUE_MODEL, forecast: FORECAST_MODEL,
  'decision matrix': DECISION_MODEL, 'scenario comparison': SCENARIO_MODEL,
};

for (const capability of CAPABILITIES) {
  test(`automatic selection and real execution: ${capability.name}`, { timeout: 60_000 }, async () => {
    const objective = `${capability.objective} ${JSON.stringify(MODELS[capability.name])}`;
    const profile = understandProblem({ objective });
    assert.equal(profile.scientific.method?.toolId, capability.tool, `method selection for ${capability.name}`);
    const plan = buildPlan(objective, undefined, WS);
    assert.ok(plan.some((task) => task.tool === capability.tool), `planned tool for ${capability.name}`);
    const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
    await executeMission(missionId, 'test');
    const detail = getMissionDetail(WS, missionId)!;
    assert.equal(detail.status, 'completed', `${capability.name} mission status: ${detail.summary}`);
    const output = outputOf(detail, capability.tool);
    const semantics = assessToolResult(capability.tool, true, output);
    assert.equal(semantics.status, capability.status, `${capability.name} result status`);
    assert.equal(semantics.acceptable, true);
    assert.equal((output['verification'] as { passed?: boolean } | undefined)?.passed ?? true, true);
    assert.ok(detail.handoffs.length >= 2, 'each planned step must produce a handoff contract');
    assert.ok(detail.verifications.every((verification) => verification.result === 'passed'));
  });
}

test('missing scientific data produces a gap, not a sample or a solver run', () => {
  const plan = buildPlan('Find the maximum flow through our distribution network from source to sink', undefined, WS);
  assert.equal(plan.length, 1);
  assert.equal(plan[0]!.tool, 'text.extract_summary');
  assert.match(plan[0]!.detail, /SCIENTIFIC INPUT GAP/);
  assert.match(plan[0]!.detail, /No sample values were substituted/);
});

test('Mission A — distribution network solves automatically and verifies feasible routes', { timeout: 90_000 }, async () => {
  const objective = `Design delivery routes for our distribution network. We have one depot, four customers with demand, and two vehicles with limited capacity. Minimize total distance while serving every customer exactly once. This is test data, not a live dispatch: ${JSON.stringify({
    depots: [{ id: 'main', x: 0, y: 0 }],
    customers: [
      { id: 'north', x: 0, y: 3, demand: 2 }, { id: 'east', x: 4, y: 0, demand: 2 },
      { id: 'south', x: 0, y: -3, demand: 2 }, { id: 'west', x: -4, y: 0, demand: 2 },
    ],
    vehicles: [{ id: 'truck-1', capacity: 4 }, { id: 'truck-2', capacity: 4 }],
  })}`;
  const detail = await createAndExecute(objective);
  assert.equal(detail.status, 'completed', detail.summary);
  assert.equal(detail.problemProfile?.scientific.method?.toolId, 'routing.vrp');
  assert.equal(detail.tasks[1]?.tool, 'routing.vrp');
  const output = outputOf(detail, 'routing.vrp');
  assert.equal(output['status'], 'feasible');
  assert.equal((output['verification'] as { passed?: boolean }).passed, true);
  assert.ok(Array.isArray(output['routes']) && (output['routes'] as unknown[]).length >= 1);
  assert.ok(detail.handoffs.length >= 2);
  assert.ok(detail.teamPlan && detail.teamPlan.team.length >= 1);
  assert.equal(detail.outcomeStatus, 'verified');
});

test('Mission B — workforce allocation formulates a binary program and verifies the optimum', { timeout: 90_000 }, async () => {
  const model = {
    sense: 'minimize',
    objective: [
      { var: 'ana_api', coeff: 40 }, { var: 'ana_web', coeff: 50 },
      { var: 'ben_api', coeff: 55 }, { var: 'ben_web', coeff: 35 },
      { var: 'chen_api', coeff: 30 },
    ],
    constraints: [
      { name: 'api_coverage', terms: [{ var: 'ana_api', coeff: 1 }, { var: 'ben_api', coeff: 1 }, { var: 'chen_api', coeff: 1 }], op: '=', rhs: 1 },
      { name: 'web_coverage', terms: [{ var: 'ana_web', coeff: 1 }, { var: 'ben_web', coeff: 1 }], op: '=', rhs: 1 },
      { name: 'ana_workload', terms: [{ var: 'ana_api', coeff: 1 }, { var: 'ana_web', coeff: 1 }], op: '<=', rhs: 1 },
      { name: 'ben_workload', terms: [{ var: 'ben_api', coeff: 1 }, { var: 'ben_web', coeff: 1 }], op: '<=', rhs: 1 },
      { name: 'chen_workload', terms: [{ var: 'chen_api', coeff: 1 }], op: '<=', rhs: 1 },
      { name: 'budget', terms: [{ var: 'ana_api', coeff: 40 }, { var: 'ana_web', coeff: 50 }, { var: 'ben_api', coeff: 55 }, { var: 'ben_web', coeff: 35 }, { var: 'chen_api', coeff: 30 }], op: '<=', rhs: 100 },
    ],
    binaryVars: ['ana_api', 'ana_web', 'ben_api', 'ben_web', 'chen_api'],
  };
  const objective = `Allocate our three specialists to two projects for the next sprint. Skills and availability restrict which specialist can take which project; each specialist can take at most one project, each project needs exactly one person, and total cost must stay within the 100 budget. Treat this as a binary integer program. Test data: ${JSON.stringify(model)}`;
  const detail = await createAndExecute(objective);
  assert.equal(detail.status, 'completed', detail.summary);
  assert.equal(detail.problemProfile?.scientific.method?.toolId, 'or.solve_lp');
  const output = outputOf(detail, 'or.solve_lp');
  assert.equal(output['status'], 'Optimal');
  assert.equal((output['verification'] as { passed?: boolean }).passed, true);
  const variables = output['variables'] as Record<string, number>;
  assert.equal(variables['chen_api'], 1);
  assert.equal(variables['ben_web'], 1);
  assert.equal(Number(output['objectiveValue']), 65);
  assert.equal(detail.outcomeStatus, 'verified');
});

test('Mission C — decision under uncertainty selects Bayesian and scenario methods and runs independent branches', { timeout: 120_000 }, async () => {
  const bayes = { type: 'beta_binomial', prior: { alpha: 2, beta: 2 }, successes: 7, trials: 10, alternativePriors: [{ label: 'uniform', alpha: 1, beta: 1 }] };
  const scenarios = {
    trials: 1_000, seed: 3,
    scenarios: [
      { name: 'premium', items: [{ name: 'demand', optimistic: 80, likely: 60, pessimistic: 40 }, { name: 'cost', optimistic: 20, likely: 25, pessimistic: 35 }] },
      { name: 'balanced', items: [{ name: 'demand', optimistic: 70, likely: 55, pessimistic: 35 }, { name: 'cost', optimistic: 18, likely: 22, pessimistic: 28 }] },
      { name: 'discount', items: [{ name: 'demand', optimistic: 90, likely: 70, pessimistic: 45 }, { name: 'cost', optimistic: 12, likely: 16, pessimistic: 24 }] },
    ],
  };
  const objective = `Decide which go-to-market strategy to recommend under demand uncertainty. First update our belief that demand is high using the observed conversion data. Then compare these scenarios for three strategies with a seeded simulation using optimistic, likely and pessimistic demand and cost estimates. Test data: ${JSON.stringify(bayes)} ${JSON.stringify(scenarios)}`;
  const detail = await createAndExecute(objective, 2);
  assert.equal(detail.status, 'completed', detail.summary);
  assert.deepEqual(detail.tasks.map((task) => task.tool), [
    'meta.formulate_scientific_problem', 'stats.bayes_update',
    'meta.formulate_scientific_problem', 'sim.scenario_compare',
  ]);
  assert.deepEqual(detail.tasks[1]!.dependsOn, [detail.tasks[0]!.id]);
  assert.deepEqual(detail.tasks[3]!.dependsOn, [detail.tasks[2]!.id]);
  assert.deepEqual(detail.tasks[0]!.dependsOn, []);
  assert.deepEqual(detail.tasks[2]!.dependsOn, []);
  const bayesOutput = outputOf(detail, 'stats.bayes_update');
  assert.equal(bayesOutput['status'], 'optimal');
  assert.equal((bayesOutput['credibleInterval'] as { lower: number; upper: number }).lower < (bayesOutput['credibleInterval'] as { lower: number; upper: number }).upper, true);
  const scenarioOutput = outputOf(detail, 'sim.scenario_compare');
  assert.equal(scenarioOutput['simulated'], true);
  assert.equal((scenarioOutput['verification'] as { passed?: boolean }).passed, true);
  assert.ok(Array.isArray(scenarioOutput['ranking']));
  assert.equal(detail.outcomeStatus, 'verified');
});

test('a verified approximate TSP is accepted and never promoted to optimal', { timeout: 60_000 }, async () => {
  const points = Array.from({ length: 14 }, (_, index) => ({ id: `p${index}`, x: Math.cos(index), y: Math.sin(index) }));
  const objective = `Plan the shortest tour visiting these points with an explicit exact limit. Test data: ${JSON.stringify({ points, exactLimit: 10 })}`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed', detail.summary);
  const output = outputOf(detail, 'routing.tsp');
  assert.equal(output['status'], 'approximate');
  assert.equal(output['exact'], false);
  const evidence = detail.tasks.find((task) => task.tool === 'routing.tsp')!.runs.find((run) => run.status === 'completed')!.evidence as Array<{ resultSemantics?: { status: string; optimalityEstablished: boolean } }>;
  assert.equal(evidence[0]!.resultSemantics?.status, 'approximate');
  assert.equal(evidence[0]!.resultSemantics?.optimalityEstablished, false);
});

test('an infeasible model fails Mission Review with an explicit infeasible status', { timeout: 60_000 }, async () => {
  const objective = `Design vehicle routes that serve every customer within vehicle capacity. Test data: ${JSON.stringify({
    depots: [{ id: 'd', x: 0, y: 0 }],
    customers: [{ id: 'a', x: 0, y: 1, demand: 10 }],
    vehicles: [{ id: 'v', capacity: 2 }],
  })}`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'failed');
  const task = detail.tasks.find((candidate) => candidate.tool === 'routing.vrp')!;
  assert.equal(task.status, 'failed');
  const output = latestOutputOf(detail, 'routing.vrp');
  assert.equal(output['status'], 'infeasible');
  assert.ok(task.runs.some((run) => run.issues.some((issue) => /infeasible/i.test(issue))));
});
