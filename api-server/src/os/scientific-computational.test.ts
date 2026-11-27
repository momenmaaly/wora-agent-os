/**
 * WORA OS — scientific intelligence and computational problem-solving.
 *
 * These tests execute the real formulation, graph search, HiGHS solver,
 * independent verification, mission planner and API routes. Mathematical
 * properties are asserted directly; response shapes alone are not enough.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-scientific-computational-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { solveShortestPath } = await import('./graph.js');
const { formulateScientificProblem } = await import('./scientific-formulation.js');
const { verifyLpSolution, verifyAssignmentSolution } = await import('./scientific-verification.js');
const { solveLp, solveAssignment } = await import('./ortools.js');
const { runTool } = await import('./tools.js');
const { selectAlgorithm } = await import('./algorithms.js');
const { selectScientificMethod } = await import('./science.js');
const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-scientific-computational';
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

const GRAPH = {
  edges: [
    { from: 'A', to: 'B', weight: 4 },
    { from: 'A', to: 'C', weight: 1 },
    { from: 'C', to: 'B', weight: 2 },
    { from: 'B', to: 'D', weight: 1 },
    { from: 'C', to: 'D', weight: 8 },
  ],
  start: 'A',
  goal: 'D',
};

test('Dijkstra returns the exact minimum path and recomputes its cost', () => {
  const result = solveShortestPath({ ...GRAPH, algorithm: 'dijkstra' });
  assert.equal(result.status, 'optimal');
  assert.equal(result.algorithm, 'dijkstra');
  assert.deepEqual(result.path, ['A', 'C', 'B', 'D']);
  assert.equal(result.totalCost, 4);
  assert.equal(result.verification.passed, true);
  assert.ok(result.verification.checks.some((check) => check.id === 'path-cost' && check.status === 'passed'));
});

test('A* is verified against an independent Dijkstra baseline', () => {
  const result = solveShortestPath({
    ...GRAPH,
    algorithm: 'a_star',
    heuristic: { A: 3, C: 2, B: 1, D: 0 },
  });
  assert.equal(result.status, 'optimal');
  assert.equal(result.algorithm, 'a_star');
  assert.equal(result.heuristicUsed, true);
  assert.equal(result.totalCost, result.baselineCost);
  assert.equal(result.verification.passed, true);
  assert.ok(result.verification.checks.some((check) => check.id === 'a-star-optimality'));
});

test('an inadmissible A* heuristic is caught instead of being reported as optimal', () => {
  const result = solveShortestPath({
    edges: [
      { from: 'A', to: 'B', weight: 1 },
      { from: 'B', to: 'D', weight: 1 },
      { from: 'A', to: 'C', weight: 5 },
      { from: 'C', to: 'D', weight: 5 },
    ],
    start: 'A',
    goal: 'D',
    algorithm: 'a_star',
    heuristic: { A: 0, B: 100, C: 0, D: 0 },
  });
  assert.equal(result.status, 'not_verified');
  assert.equal(result.verification.passed, false);
  assert.ok(result.verification.failures.some((failure) => /a-star-optimality/.test(failure)));
  assert.ok((result.baselineCost ?? Infinity) < (result.totalCost ?? Infinity));
});

test('negative edge weights are rejected rather than solved with the wrong algorithm', () => {
  assert.throws(() => solveShortestPath({
    edges: [{ from: 'A', to: 'B', weight: -1 }], start: 'A', goal: 'B',
  }), /negative weight/i);
});

test('a missing path is reported as no_path with no fabricated route', () => {
  const result = solveShortestPath({ nodes: ['A', 'B', 'C'], edges: [{ from: 'A', to: 'B', weight: 1 }], start: 'A', goal: 'C' });
  assert.equal(result.status, 'no_path');
  assert.deepEqual(result.path, []);
  assert.equal(result.totalCost, null);
  assert.equal(result.verification.passed, true);
});

test('scientific formulation is explicit and blocks missing numeric inputs', () => {
  const complete = formulateScientificProblem({ kind: 'shortest_path', model: GRAPH });
  assert.equal(complete.executable, true);
  assert.equal(complete.solver, 'graph.shortest_path (Dijkstra/A*)');
  assert.ok(complete.decisionVariables.length > 0);
  assert.ok(complete.constraints.length > 0);
  assert.ok(complete.verification.length > 0);
  assert.match(complete.digest, /^[a-f0-9]{64}$/);

  const missing = formulateScientificProblem({ kind: 'shortest_path', model: { start: 'A', goal: 'D' } });
  assert.equal(missing.executable, false);
  assert.ok(missing.missingInputs.length > 0);
  assert.equal(missing.model, null);

  const lp = formulateScientificProblem({
    kind: 'linear_programming',
    model: {
      sense: 'maximize',
      objective: [{ var: 'x', coeff: 3 }, { var: 'y', coeff: 2 }],
      constraints: [{ name: 'labor', terms: [{ var: 'x', coeff: 1 }, { var: 'y', coeff: 1 }], op: '<=', rhs: 4 }],
    },
  });
  assert.equal(lp.executable, true);
  assert.deepEqual(lp.decisionVariables.sort(), ['x', 'y']);
});

test('LP/MIP results are independently recomputed and tampering is rejected', async () => {
  const model = {
    sense: 'maximize' as const,
    objective: [{ var: 'x', coeff: 3 }, { var: 'y', coeff: 2 }],
    constraints: [
      { name: 'labor', terms: [{ var: 'x', coeff: 1 }, { var: 'y', coeff: 1 }], op: '<=' as const, rhs: 4 },
      { name: 'xcap', terms: [{ var: 'x', coeff: 1 }], op: '<=' as const, rhs: 2 },
      { name: 'ycap', terms: [{ var: 'y', coeff: 1 }], op: '<=' as const, rhs: 3 },
    ],
  };
  const result = await solveLp(model);
  assert.equal(result.status, 'Optimal');
  assert.equal(result.objectiveValue, 10);
  assert.equal(result.verification.passed, true);
  assert.ok(result.verification.checks.some((check) => check.id === 'objective-recompute'));

  const tampered = { ...result, objectiveValue: 11, variables: { x: 3, y: 1 } };
  const verification = verifyLpSolution(model, tampered);
  assert.equal(verification.passed, false);
  assert.ok(verification.failures.some((failure) => /objective-recompute|constraint/.test(failure)));
});

test('an infeasible model is surfaced with a failed verification, not a fake optimum', async () => {
  const result = await solveLp({
    sense: 'maximize',
    objective: [{ var: 'x', coeff: 1 }],
    constraints: [
      { name: 'lower', terms: [{ var: 'x', coeff: 1 }], op: '>=', rhs: 2 },
      { name: 'upper', terms: [{ var: 'x', coeff: 1 }], op: '<=', rhs: 1 },
    ],
  });
  assert.notEqual(result.status, 'Optimal');
  assert.equal(result.verification.passed, false);
  assert.ok(result.verification.failures.some((failure) => /solver-status/.test(failure)));
});

test('assignment verification recomputes the total and detects duplicate rows', () => {
  const result = solveAssignment([[12, 7, 9], [8, 14, 5], [6, 9, 11]], ['a', 'b', 'c'], ['x', 'y', 'z']);
  assert.equal(result.totalCost, 18);
  assert.equal(result.verification.passed, true);
  const tampered = { ...result, assignments: [...result.assignments, result.assignments[0]!] };
  const verification = verifyAssignmentSolution([[12, 7, 9], [8, 14, 5], [6, 9, 11]], tampered);
  assert.equal(verification.passed, false);
  assert.ok(verification.failures.some((failure) => /assignment-unique|assignment-count|assignment-total/.test(failure)));
});

test('algorithm and science catalogs select the implemented graph method', () => {
  const selection = selectAlgorithm({ kind: 'shortest_path', features: { hasGraph: true } });
  assert.equal(selection.status, 'selected');
  assert.equal(selection.primary?.algorithmId, 'dijkstra-a-star');
  assert.equal(selection.primary?.toolId, 'graph.shortest_path');
  assert.ok(selection.missingInformation.some((item) => /weighted edges/i.test(item)));

  const scientific = selectScientificMethod({ kind: 'shortest_path', features: { hasGraph: true } });
  assert.equal(scientific.domain, 'operations_research');
  assert.equal(scientific.method?.toolId, 'graph.shortest_path');
  assert.equal(scientific.method?.status, 'implemented');
});

test('the graph tool rejects negative weights through the registry', async () => {
  const result = await runTool('graph.shortest_path', {
    edges: [{ from: 'A', to: 'B', weight: -2 }], start: 'A', goal: 'B',
  }, { workspaceId: WS, actor: 'test', permissions: new Set() });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /negative weight/i);
});

test('a mission formulates and solves a real shortest-path problem end to end', async () => {
  const objective = `Find the shortest path from A to D in this graph ${JSON.stringify({
    ...GRAPH,
    algorithm: 'a_star',
    heuristic: { A: 3, C: 2, B: 1, D: 0 },
  })} and verify the route`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks.length, 2);
  assert.equal(detail.tasks[0]!.tool, 'meta.formulate_scientific_problem');
  assert.equal(detail.tasks[1]!.tool, 'graph.shortest_path');
  const output = ((detail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['status'], 'optimal');
  assert.deepEqual(output['path'], ['A', 'C', 'B', 'D']);
  assert.equal(output['totalCost'], 4);
  assert.equal((output['verification'] as { passed?: boolean }).passed, true);
  assert.ok(detail.verifications.some((record) => record.result === 'passed'));
});

test('a mission formulates and solves a real LP end to end', async () => {
  const objective = `Maximize profit with the LP ${JSON.stringify({
    sense: 'maximize',
    objective: [{ var: 'x', coeff: 3 }, { var: 'y', coeff: 2 }],
    constraints: [
      { name: 'labor', terms: [{ var: 'x', coeff: 1 }, { var: 'y', coeff: 1 }], op: '<=', rhs: 4 },
      { name: 'xcap', terms: [{ var: 'x', coeff: 1 }], op: '<=', rhs: 2 },
      { name: 'ycap', terms: [{ var: 'y', coeff: 1 }], op: '<=', rhs: 3 },
    ],
  })} and verify`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[1]!.tool, 'or.solve_lp');
  const output = ((detail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['status'], 'Optimal');
  assert.equal(output['objectiveValue'], 10);
  assert.equal((output['verification'] as { passed?: boolean }).passed, true);
});

test('a mission formulates and executes an assignment with a real cost matrix', async () => {
  const objective = `Assign workers to jobs with this cost matrix ${JSON.stringify({
    costMatrix: [[12, 7, 9], [8, 14, 5], [6, 9, 11]],
    rowLabels: ['w1', 'w2', 'w3'],
    colLabels: ['j1', 'j2', 'j3'],
  })} and minimize total cost`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[1]!.tool, 'or.assignment');
  const output = ((detail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['totalCost'], 18);
  assert.equal((output['verification'] as { passed?: boolean }).passed, true);
});

test('a mission formulates and executes a seeded Monte Carlo simulation', async () => {
  const objective = `Simulate the delivery risk with Monte Carlo ${JSON.stringify({
    trials: 500,
    seed: 7,
    items: [{ name: 'delivery', optimistic: 2, likely: 4, pessimistic: 9 }],
  })} and report the distribution`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[1]!.tool, 'sim.monte_carlo');
  const output = ((detail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['simulated'], true);
  assert.ok(Number(output['p10']) <= Number(output['p50']) && Number(output['p50']) <= Number(output['p90']));
  assert.equal(output['seed'], 7);
  assert.equal(output['trials'], 500);
});

test('a mission formulates and executes a forecast with holdout metrics', async () => {
  const objective = `Forecast the next three months from this series ${JSON.stringify({
    series: [120, 128, 135, 142, 150, 159, 168, 178, 187, 197],
    steps: 3,
  })} and report uncertainty`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[1]!.tool, 'forecast.linear');
  const output = ((detail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal((output['projections'] as unknown[]).length, 3);
  assert.ok(Number.isFinite(Number(output['holdoutMae'])));
  assert.ok(Number.isFinite(Number(output['r2'])));
});

test('a mission formulates and executes a weighted multi-criteria decision', async () => {
  const objective = `Choose a vendor with this weighted decision matrix ${JSON.stringify({
    criteria: [
      { id: 'cost', label: 'Cost', weight: 5 },
      { id: 'quality', label: 'Quality', weight: 4 },
      { id: 'speed', label: 'Speed', weight: 3 },
    ],
    alternatives: [
      { name: 'Vendor A', scores: { cost: 8, quality: 6, speed: 5 } },
      { name: 'Vendor B', scores: { cost: 5, quality: 9, speed: 7 } },
    ],
  })} and stress-test the result`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[1]!.tool, 'decision.weighted_matrix');
  const output = ((detail.tasks[1]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.ok(Array.isArray(output['ranking']) && (output['ranking'] as unknown[]).length === 2);
  assert.equal(typeof output['robust'], 'boolean');
  assert.ok(typeof output['winner'] === 'string');
});

test('missing graph data becomes a recorded gap, never a sample graph', () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Find the shortest path in the delivery network and verify it', actor: 'test' });
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.tasks.length, 1);
  assert.equal(detail.tasks[0]!.tool, 'text.extract_summary');
  assert.match(detail.tasks[0]!.detail, /SCIENTIFIC INPUT GAP/);
  assert.match(detail.tasks[0]!.detail, /No sample values/);
});

test('scientific formulation and shortest-path API routes execute real logic', async () => {
  const formulation = await fetch(`${baseUrl}/science/formulate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'shortest_path', model: GRAPH }),
  });
  assert.equal(formulation.status, 200);
  const formulated = await formulation.json() as { executable: boolean; solver: string; digest: string };
  assert.equal(formulated.executable, true);
  assert.match(formulated.solver, /graph\.shortest_path/);
  assert.match(formulated.digest, /^[a-f0-9]{64}$/);

  const route = await fetch(`${baseUrl}/optimize/shortest-path`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(GRAPH),
  });
  assert.equal(route.status, 200);
  const result = await route.json() as { status: string; totalCost: number; verification: { passed: boolean } };
  assert.equal(result.status, 'optimal');
  assert.equal(result.totalCost, 4);
  assert.equal(result.verification.passed, true);

  const invalid = await fetch(`${baseUrl}/optimize/shortest-path`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ edges: [{ from: 'A', to: 'B', weight: -1 }], start: 'A', goal: 'B' }),
  });
  assert.equal(invalid.status, 422);
});
