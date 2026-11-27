/**
 * WORA OS — advanced optimization, simulation and decision intelligence.
 *
 * These tests execute the real flow, routing, Pareto, Bayesian and simulation
 * implementations. They assert mathematical invariants and independent
 * verification outcomes, not only response shapes.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-advanced-computational-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { solveMaxFlow, solveMinCostFlow, solveBipartiteMatching, verifyMaxFlow, verifyMinCostFlow, verifyBipartiteMatching } = await import('./network-flow.js');
const { solveTsp, solveVrp, verifyTsp, verifyVrp } = await import('./routing.js');
const { solvePareto, verifyPareto } = await import('./multi-objective.js');
const { solveBayes, verifyBayes, betaQuantile } = await import('./bayesian.js');
const { simulateQueue, simulatePert } = await import('./simulation.js');
const { solveScenarios } = await import('./simulation-advanced.js');
const { formulateScientificProblem } = await import('./scientific-formulation.js');
const { runTool } = await import('./tools.js');
const { selectAlgorithm } = await import('./algorithms.js');
const { selectScientificMethod } = await import('./science.js');
const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-advanced-computational';
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

const FLOW = {
  source: 's',
  sink: 't',
  edges: [
    { from: 's', to: 'a', capacity: 3 },
    { from: 's', to: 'b', capacity: 2 },
    { from: 'a', to: 'b', capacity: 1 },
    { from: 'a', to: 't', capacity: 2 },
    { from: 'b', to: 't', capacity: 3 },
  ],
};

test('Dinic max flow returns the exact value and a matching min-cut', () => {
  const result = solveMaxFlow(FLOW);
  assert.equal(result.status, 'optimal');
  assert.equal(result.maxFlow, 5);
  assert.equal(result.minCut?.capacity, 5);
  assert.equal(result.verification.passed, true);
  assert.ok(result.verification.checks.some((check) => check.id === 'conservation' && check.status === 'passed'));
});

test('a disconnected max-flow network reports zero flow, not a fabricated path', () => {
  const result = solveMaxFlow({ source: 's', sink: 't', edges: [{ from: 's', to: 'a', capacity: 4 }, { from: 'b', to: 't', capacity: 4 }] });
  assert.equal(result.status, 'optimal');
  assert.equal(result.maxFlow, 0);
  assert.equal(result.minCut?.capacity, 0);
  assert.equal(result.verification.passed, true);
});

test('negative capacities are rejected and a tampered flow fails verification', () => {
  const invalid = solveMaxFlow({ source: 's', sink: 't', edges: [{ from: 's', to: 't', capacity: -1 }] });
  assert.equal(invalid.status, 'infeasible');
  assert.equal(invalid.verification.passed, false);
  const tampered = { ...solveMaxFlow(FLOW), flows: [{ id: 's->a', from: 's', to: 'a', capacity: 3, flow: 9 }] };
  const verification = verifyMaxFlow(FLOW, tampered);
  assert.equal(verification.passed, false);
  assert.ok(verification.failures.some((failure) => failure.startsWith('capacity')));
});

test('min-cost flow delivers exact demand at the true minimum cost', () => {
  const result = solveMinCostFlow({
    source: 's', sink: 't', demand: 3,
    edges: [
      { from: 's', to: 'a', capacity: 2, cost: 1 },
      { from: 's', to: 'b', capacity: 2, cost: 2 },
      { from: 'a', to: 't', capacity: 2, cost: 1 },
      { from: 'b', to: 't', capacity: 2, cost: 1 },
    ],
  });
  assert.equal(result.status, 'optimal');
  assert.equal(result.flow, 3);
  assert.equal(result.totalCost, 7);
  assert.equal(result.verification.passed, true);
});

test('min-cost flow reports infeasible demand and rejects a tampered cost', () => {
  const infeasible = solveMinCostFlow({ source: 's', sink: 't', demand: 10, edges: [{ from: 's', to: 't', capacity: 2, cost: 1 }] });
  assert.equal(infeasible.status, 'infeasible');
  const feasible = solveMinCostFlow({ source: 's', sink: 't', demand: 1, edges: [{ from: 's', to: 't', capacity: 2, cost: 3 }] });
  const tampered = { ...feasible, totalCost: 1 };
  const verification = verifyMinCostFlow({ source: 's', sink: 't', demand: 1, edges: [{ from: 's', to: 't', capacity: 2, cost: 3 }] }, tampered);
  assert.equal(verification.passed, false);
  assert.ok(verification.failures.some((failure) => failure.startsWith('cost')));
});

test('bipartite matching finds a maximum matching and detects an invalid one', () => {
  const model = { left: ['a', 'b', 'c'], right: ['x', 'y', 'z'], edges: [{ left: 'a', right: 'x' }, { left: 'a', right: 'y' }, { left: 'b', right: 'y' }, { left: 'c', right: 'z' }] };
  const result = solveBipartiteMatching(model);
  assert.equal(result.status, 'optimal');
  assert.equal(result.size, 3);
  assert.equal(result.verification.passed, true);
  const tampered = { ...result, matching: [{ left: 'a', right: 'x' }, { left: 'a', right: 'y' }], size: 2, unmatchedLeft: ['c'], unmatchedRight: ['z'] };
  const verification = verifyBipartiteMatching(model, tampered);
  assert.equal(verification.passed, false);
});

test('TSP exact Held-Karp matches brute force on a square', () => {
  const model = { points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 0, y: 1 }, { id: 'C', x: 1, y: 0 }, { id: 'D', x: 1, y: 1 }] };
  const result = solveTsp(model);
  assert.equal(result.status, 'optimal');
  assert.equal(result.exact, true);
  assert.equal(result.method, 'held-karp');
  assert.equal(result.cost, 4);
  assert.equal(result.verification.passed, true);
  assert.ok(result.verification.checks.some((check) => check.id === 'exact-optimum' && check.status === 'passed'));
});

test('large TSP instances are explicitly approximate, not optimal', () => {
  const points = Array.from({ length: 14 }, (_, index) => ({ id: `p${index}`, x: Math.cos(index), y: Math.sin(index) }));
  const result = solveTsp({ points, exactLimit: 10 });
  assert.equal(result.status, 'approximate');
  assert.equal(result.exact, false);
  assert.equal(result.method, 'nearest-neighbor+2-opt');
  assert.equal(result.verification.passed, true);
  assert.ok(result.cost !== null && result.lowerBound !== null && result.cost >= result.lowerBound);
});

test('invalid TSP input is rejected and a tampered tour fails verification', () => {
  const invalid = solveTsp({ distanceMatrix: [[0, 1], [1]] });
  assert.equal(invalid.status, 'infeasible');
  const model = { distanceMatrix: [[0, 1, 1], [1, 0, 1], [1, 1, 0]] };
  const valid = solveTsp(model);
  const tampered = { ...valid, tour: ['n1', 'n2', 'n3'], cost: 0 };
  const verification = verifyTsp(model, tampered);
  assert.equal(verification.passed, false);
});

test('VRP serves every customer within capacity and reports infeasible overloads', () => {
  const model = {
    depots: [{ id: 'd', x: 0, y: 0 }],
    customers: [{ id: 'a', x: 0, y: 1, demand: 1 }, { id: 'b', x: 1, y: 0, demand: 1 }, { id: 'c', x: 1, y: 1, demand: 1 }],
    vehicles: [{ id: 'v1', capacity: 2 }, { id: 'v2', capacity: 2 }],
  };
  const result = solveVrp(model);
  assert.equal(result.status, 'feasible');
  assert.equal(result.exact, false);
  assert.equal(result.routes.flatMap((route) => route.stops).sort().join(','), 'a,b,c');
  assert.equal(result.verification.passed, true);
  const infeasible = solveVrp({ ...model, customers: [{ id: 'a', x: 0, y: 1, demand: 10 }], vehicles: [{ id: 'v1', capacity: 2 }] });
  assert.equal(infeasible.status, 'infeasible');
});

test('VRP verification rejects a route that exceeds vehicle capacity', () => {
  const model = {
    depots: [{ id: 'd', x: 0, y: 0 }],
    customers: [{ id: 'a', x: 0, y: 1, demand: 3 }, { id: 'b', x: 1, y: 0, demand: 1 }],
    vehicles: [{ id: 'v1', capacity: 3 }, { id: 'v2', capacity: 3 }],
  };
  const result = solveVrp(model);
  const tampered = { ...result, routes: [{ vehicleId: 'v1', depotId: 'd', stops: ['a', 'b'], load: 4, distance: 3 }], totalDistance: 3 };
  const verification = verifyVrp(model, tampered);
  assert.equal(verification.passed, false);
});

test('Pareto analysis finds the true frontier and rejects a dominated frontier point', () => {
  const model = {
    objectives: [{ id: 'cost', label: 'Cost', direction: 'minimize' as const }, { id: 'quality', label: 'Quality', direction: 'maximize' as const }],
    candidates: [
      { name: 'A', values: { cost: 10, quality: 9 } },
      { name: 'B', values: { cost: 8, quality: 7 } },
      { name: 'C', values: { cost: 12, quality: 5 } },
      { name: 'D', values: { cost: 9, quality: 8 } },
    ],
  };
  const result = solvePareto(model);
  assert.equal(result.status, 'optimal');
  assert.deepEqual(result.frontier.map((point) => point.name), ['B', 'D', 'A']);
  assert.deepEqual(result.dominated.map((point) => point.name), ['C']);
  assert.equal(result.verification.passed, true);
  const tampered = { ...result, frontier: [...result.frontier, { name: 'C', values: { cost: 12, quality: 5 }, weightedScore: -1 }] };
  assert.equal(verifyPareto(model, tampered).passed, false);
});

test('Pareto sensitivity reports weight-driven winner changes honestly', () => {
  const result = solvePareto({
    objectives: [{ id: 'cost', label: 'Cost', direction: 'minimize' }, { id: 'quality', label: 'Quality', direction: 'maximize' }],
    candidates: [{ name: 'cheap', values: { cost: 1, quality: 1 } }, { name: 'premium', values: { cost: 10, quality: 10 } }],
    weights: { cost: 0.5, quality: 0.5 },
  });
  assert.equal(result.verification.passed, true);
  assert.ok(result.sensitivity.winner);
  assert.ok(result.sensitivity.notes.length > 0);
});

test('Beta–Binomial posterior is exact and prior sensitivity is computed', () => {
  const model = {
    type: 'beta_binomial' as const,
    prior: { alpha: 2, beta: 2 },
    successes: 7,
    trials: 10,
    alternativePriors: [{ label: 'uniform', alpha: 1, beta: 1 }, { label: 'strong', alpha: 10, beta: 10 }],
  };
  const result = solveBayes(model);
  assert.equal(result.status, 'optimal');
  assert.equal(result.posterior['alpha'], 9);
  assert.equal(result.posterior['beta'], 5);
  assert.equal(result.posterior['mean'], 0.642857);
  assert.ok(result.credibleInterval.lower < result.posterior['mean']!);
  assert.ok(result.credibleInterval.upper > result.posterior['mean']!);
  assert.equal(result.priorSensitivity.provided, true);
  assert.equal(result.priorSensitivity.variants.length, 2);
  assert.equal(result.verification.passed, true);
});

test('Normal–Normal posterior is exact and invalid priors are rejected', () => {
  const result = solveBayes({ type: 'normal_normal', prior: { mean: 0, sd: 10 }, observations: [4.1, 3.9, 4.3, 4.0], knownSd: 1 });
  assert.equal(result.status, 'optimal');
  assert.equal(result.posterior['n'], 4);
  assert.ok(result.credibleInterval.lower < result.posterior['mean']!);
  assert.equal(result.verification.passed, true);
  const invalid = solveBayes({ type: 'beta_binomial', prior: { alpha: 0, beta: 2 }, successes: 2, trials: 1 });
  assert.equal(invalid.status, 'infeasible');
});

test('a tampered Bayesian posterior fails independent verification', () => {
  const model = { type: 'beta_binomial' as const, prior: { alpha: 2, beta: 2 }, successes: 7, trials: 10 };
  const result = solveBayes(model);
  const tampered = { ...result, posterior: { ...result.posterior, mean: 0.9 }, predictive: 0.9 };
  assert.equal(verifyBayes(model, tampered).passed, false);
});

test('queue simulation is reproducible and conserves customers', () => {
  const model = { customers: 500, interarrivalMean: 1, serviceMean: 1.2, servers: 2, seed: 77 };
  const first = simulateQueue(model);
  const second = simulateQueue(model);
  assert.deepEqual(first, second);
  assert.equal(first.served, 500);
  assert.equal(first.verification.passed, true);
  assert.ok(first.utilization >= 0 && first.utilization <= 1);
});

test('scenario comparison is reproducible and ranks by median', () => {
  const model = {
    trials: 2_000,
    seed: 11,
    scenarios: [
      { name: 'base', items: [{ name: 'build', optimistic: 5, likely: 7, pessimistic: 10 }] },
      { name: 'slow', items: [{ name: 'build', optimistic: 8, likely: 12, pessimistic: 16 }] },
    ],
  };
  const first = solveScenarios(model);
  const second = solveScenarios(model);
  assert.equal(first.status, 'feasible');
  assert.equal(first.verification.passed, true);
  assert.equal(first.ranking[0]?.name, 'base');
  assert.deepEqual(first.scenarios.map((scenario) => scenario.result.p50), second.scenarios.map((scenario) => scenario.result.p50));
});

test('formulation covers every new method and refuses incomplete input', () => {
  assert.equal(formulateScientificProblem({ kind: 'max_flow', model: FLOW }).executable, true);
  assert.equal(formulateScientificProblem({ kind: 'max_flow', model: { edges: [] } }).executable, false);
  assert.equal(formulateScientificProblem({ kind: 'tsp', model: { points: [{ id: 'a', x: 0, y: 0 }] } }).executable, true);
  assert.equal(formulateScientificProblem({ kind: 'bayesian_inference', model: { type: 'beta_binomial', prior: { alpha: 1, beta: 1 }, successes: 1, trials: 2 } }).executable, true);
});

test('algorithm and science catalogs select the new implemented methods', () => {
  assert.equal(selectAlgorithm({ features: { hasNetworkFlow: true } }).primary?.toolId, 'graph.max_flow');
  assert.equal(selectAlgorithm({ features: { hasRouting: true, hasVehicles: true } }).primary?.toolId, 'routing.vrp');
  assert.equal(selectAlgorithm({ features: { hasPareto: true } }).primary?.toolId, 'decision.pareto');
  assert.equal(selectAlgorithm({ features: { hasBayes: true } }).primary?.toolId, 'stats.bayes_update');
  assert.equal(selectScientificMethod({ kind: 'bayesian_inference' }).method?.toolId, 'stats.bayes_update');
});

test('the tool registry executes advanced tools and rejects malformed input', async () => {
  const ctx = { workspaceId: WS, actor: 'test', permissions: new Set<string>() };
  const flow = await runTool('graph.max_flow', { model: FLOW }, ctx);
  assert.equal(flow.ok, true);
  assert.equal((flow.output as { maxFlow: number }).maxFlow, 5);
  const bad = await runTool('routing.tsp', { points: [] }, ctx);
  assert.equal(bad.ok, false);
});

test('a mission formulates and solves max flow end to end', async () => {
  const objective = `Find the maximum flow through this network ${JSON.stringify(FLOW)}`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[0]!.tool, 'meta.formulate_scientific_problem');
  assert.equal(detail.tasks[1]!.tool, 'graph.max_flow');
  const output = ((detail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['maxFlow'], 5);
  assert.equal((output['verification'] as { passed?: boolean }).passed, true);
});

test('a mission formulates and solves TSP end to end', async () => {
  const objective = `Plan the shortest tour visiting these points ${JSON.stringify({ points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 0, y: 1 }, { id: 'C', x: 1, y: 0 }, { id: 'D', x: 1, y: 1 }] })}`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[1]!.tool, 'routing.tsp');
  const output = ((detail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['status'], 'optimal');
  assert.equal(output['cost'], 4);
});

test('a mission formulates a Pareto decision and a Bayesian update end to end', async () => {
  const pareto = {
    objectives: [{ id: 'cost', label: 'Cost', direction: 'minimize' }, { id: 'quality', label: 'Quality', direction: 'maximize' }],
    candidates: [{ name: 'A', values: { cost: 10, quality: 9 } }, { name: 'B', values: { cost: 8, quality: 7 } }, { name: 'C', values: { cost: 12, quality: 5 } }],
  };
  const missionId = createMission({ workspaceId: WS, objective: `Choose the best trade-off ${JSON.stringify(pareto)}`, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[1]!.tool, 'decision.pareto');
  const output = ((detail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal((output['verification'] as { passed?: boolean }).passed, true);
  assert.deepEqual((output['frontier'] as Array<{ name: string }>).map((point) => point.name), ['B', 'A']);

  const bayes = { type: 'beta_binomial', prior: { alpha: 2, beta: 2 }, successes: 7, trials: 10 };
  const bayesMission = createMission({ workspaceId: WS, objective: `Update the posterior with these observations ${JSON.stringify(bayes)}`, actor: 'test' });
  await executeMission(bayesMission, 'test');
  const bayesDetail = getMissionDetail(WS, bayesMission)!;
  assert.equal(bayesDetail.status, 'completed');
  assert.equal(bayesDetail.tasks[1]!.tool, 'stats.bayes_update');
  const bayesOutput = ((bayesDetail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal((bayesOutput['verification'] as { passed?: boolean }).passed, true);
});

test('a mission runs a seeded queue and a scenario comparison end to end', async () => {
  const queue = { customers: 200, interarrivalMean: 1, serviceMean: 1.1, servers: 2, seed: 5 };
  const queueMission = createMission({ workspaceId: WS, objective: `Simulate this queue ${JSON.stringify(queue)}`, actor: 'test' });
  await executeMission(queueMission, 'test');
  const queueDetail = getMissionDetail(WS, queueMission)!;
  assert.equal(queueDetail.status, 'completed');
  assert.equal(queueDetail.tasks[1]!.tool, 'sim.queue');
  const queueOutput = ((queueDetail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(queueOutput['simulated'], true);
  assert.equal(queueOutput['seed'], 5);

  const scenarios = {
    trials: 1_000, seed: 3,
    scenarios: [
      { name: 'base', items: [{ name: 'build', optimistic: 5, likely: 7, pessimistic: 10 }] },
      { name: 'slow', items: [{ name: 'build', optimistic: 8, likely: 12, pessimistic: 16 }] },
    ],
  };
  const scenarioMission = createMission({ workspaceId: WS, objective: `Compare these scenarios ${JSON.stringify(scenarios)}`, actor: 'test' });
  await executeMission(scenarioMission, 'test');
  const scenarioDetail = getMissionDetail(WS, scenarioMission)!;
  assert.equal(scenarioDetail.status, 'completed');
  assert.equal(scenarioDetail.tasks[1]!.tool, 'sim.scenario_compare');
  const scenarioOutput = ((scenarioDetail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(scenarioOutput['simulated'], true);
  assert.equal((scenarioOutput['ranking'] as Array<{ name: string }>)[0]!.name, 'base');
});

test('advanced API routes execute real flow, routing, decision, Bayesian and simulation logic', async () => {
  const flow = await fetch(`${baseUrl}/network/max-flow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(FLOW) });
  assert.equal(flow.status, 200);
  assert.equal(((await flow.json()) as { maxFlow: number }).maxFlow, 5);
  const tsp = await fetch(`${baseUrl}/routing/tsp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 0, y: 1 }, { id: 'C', x: 1, y: 0 }] }) });
  assert.equal(tsp.status, 200);
  assert.equal(((await tsp.json()) as { status: string }).status, 'optimal');
  const bayes = await fetch(`${baseUrl}/stats/bayes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'beta_binomial', prior: { alpha: 2, beta: 2 }, successes: 7, trials: 10 }) });
  assert.equal(bayes.status, 200);
  assert.equal(((await bayes.json()) as { posterior: { alpha: number } }).posterior.alpha, 9);
  const invalid = await fetch(`${baseUrl}/routing/tsp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points: [] }) });
  assert.equal(invalid.status, 422);

  const minCost = await fetch(`${baseUrl}/network/min-cost-flow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 's', sink: 't', demand: 3, edges: [{ from: 's', to: 't', capacity: 3, cost: 2 }] }) });
  assert.equal(minCost.status, 200);
  assert.equal(((await minCost.json()) as { totalCost: number }).totalCost, 6);
  const matching = await fetch(`${baseUrl}/network/bipartite-matching`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ left: ['a'], right: ['x'], edges: [{ left: 'a', right: 'x' }] }) });
  assert.equal(matching.status, 200);
  assert.equal(((await matching.json()) as { size: number }).size, 1);
  const vrp = await fetch(`${baseUrl}/routing/vrp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ depots: [{ id: 'd', x: 0, y: 0 }], customers: [{ id: 'a', x: 0, y: 1, demand: 1 }], vehicles: [{ id: 'v', capacity: 2 }] }) });
  assert.equal(vrp.status, 200);
  assert.equal(((await vrp.json()) as { status: string }).status, 'feasible');
  const pareto = await fetch(`${baseUrl}/decision/pareto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objectives: [{ id: 'cost', label: 'Cost', direction: 'minimize' }, { id: 'quality', label: 'Quality', direction: 'maximize' }], candidates: [{ name: 'A', values: { cost: 1, quality: 1 } }, { name: 'B', values: { cost: 2, quality: 2 } }] }) });
  assert.equal(pareto.status, 200);
  assert.equal(((await pareto.json()) as { status: string }).status, 'optimal');
  const queue = await fetch(`${baseUrl}/simulate/queue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customers: 50, interarrivalMean: 1, serviceMean: 1, servers: 1, seed: 2 }) });
  assert.equal(queue.status, 200);
  assert.equal(((await queue.json()) as { simulated: boolean }).simulated, true);
  const scenarios = await fetch(`${baseUrl}/simulate/scenarios`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trials: 200, seed: 2, scenarios: [{ name: 'a', items: [{ name: 'x', optimistic: 1, likely: 2, pessimistic: 3 }] }, { name: 'b', items: [{ name: 'x', optimistic: 2, likely: 3, pessimistic: 4 }] }] }) });
  assert.equal(scenarios.status, 200);
  assert.equal(((await scenarios.json()) as { simulated: boolean }).simulated, true);
  const formulation = await fetch(`${baseUrl}/science/formulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'max_flow', model: FLOW }) });
  assert.equal(formulation.status, 200);
  assert.equal(((await formulation.json()) as { executable: boolean }).executable, true);
});

test('Monte Carlo remains reproducible after sharing the simulation primitive', () => {
  const first = simulatePert([{ name: 'build', optimistic: 1, likely: 2, pessimistic: 4 }], 500, 9);
  const second = simulatePert([{ name: 'build', optimistic: 1, likely: 2, pessimistic: 4 }], 500, 9);
  assert.deepEqual(first, second);
  assert.ok(betaQuantile(0.5, 2, 2) > 0.49 && betaQuantile(0.5, 2, 2) < 0.51);
});
