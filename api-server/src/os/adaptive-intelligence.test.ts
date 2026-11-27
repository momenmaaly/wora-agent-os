/**
 * WORA OS — adaptive intelligence acceptance.
 *
 * The suite compares methods from the actual catalog, exercises the real
 * planner and mission lifecycle, and records the structure, candidates,
 * selected method, adaptation and verification status for each case.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-adaptive-intelligence-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail, buildPlan } = await import('./orchestrator.js');
const { understandProblem } = await import('./problem.js');
const { selectAdaptiveMethod, methodHistoryFor } = await import('./adaptive-intelligence.js');
const { planAdaptation, alternativeForTask } = await import('./adaptive-replan.js');
const { saveDecisionRecord } = await import('./decision.js');
const { getOsDb, newId, nowIso } = await import('./db.js');
const { ensureSeedAgents } = await import('./registry.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-adaptive-intelligence';
let server: Server;
let baseUrl = '';

before(async () => {
  ensureSeedAgents(WS);
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
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

function decisionFor(objective: string) {
  const profile = understandProblem({ objective });
  return { profile, decision: selectAdaptiveMethod({ workspaceId: WS, objective, profile }) };
}

const assignment = 'Assign three candidates to three options and minimize cost. Test data: {"costMatrix":[[12,7,9],[8,14,5],[6,9,11]],"forbidden":[{"row":0,"col":1}]}';
const vrp = `Design delivery routes for four customers with two capacity-limited vehicles and minimize total distance. Test data: ${JSON.stringify({
  depots: [{ id: 'main', x: 0, y: 0 }],
  customers: [
    { id: 'north', x: 0, y: 3, demand: 2 }, { id: 'east', x: 4, y: 0, demand: 2 },
    { id: 'south', x: 0, y: -3, demand: 2 }, { id: 'west', x: -4, y: 0, demand: 2 },
  ],
  vehicles: [{ id: 'truck-1', capacity: 4 }, { id: 'truck-2', capacity: 4 }],
})}`;
const lp = 'Allocate a budget with a linear program. Test data: {"sense":"minimize","objective":[{"var":"x","coeff":2},{"var":"y","coeff":3}],"constraints":[{"name":"budget","terms":[{"var":"x","coeff":1},{"var":"y","coeff":1}],"op":"<=","rhs":10},{"name":"demand","terms":[{"var":"x","coeff":1}],"op":">=","rhs":2}],"bounds":[{"var":"x","lower":0},{"var":"y","lower":0}]}';
const schedule = 'Schedule employees across shifts. Test data: {"employees":[{"id":"e1","name":"A","hourlyCost":10,"availability":["s1","s2"],"maxAssignments":1},{"id":"e2","name":"B","hourlyCost":12,"availability":["s1","s2"],"maxAssignments":1}],"shifts":[{"id":"s1","name":"S1","demand":1},{"id":"s2","name":"S2","demand":1}]}';
const multi = `Update the probability that demand is high and compare three demand/cost scenarios. Test data: ${JSON.stringify({ type: 'beta_binomial', prior: { alpha: 2, beta: 2 }, successes: 7, trials: 10 })} ${JSON.stringify({ trials: 500, seed: 3, scenarios: [{ name: 'premium', items: [{ name: 'demand', optimistic: 80, likely: 60, pessimistic: 40 }] }, { name: 'balanced', items: [{ name: 'demand', optimistic: 70, likely: 55, pessimistic: 35 }] }] })}`;

test('known problems — assignment compares Hungarian and an exact MIP translation and selects the stronger fit', () => {
  const { decision } = decisionFor(assignment);
  assert.equal(decision.scientificRequired, true);
  assert.equal(decision.structureKinds[0], 'assignment');
  assert.equal(decision.selected?.toolId, 'or.assignment');
  assert.ok(decision.candidates.some((candidate) => candidate.toolId === 'or.solve_lp'));
  assert.ok(decision.candidates.some((candidate) => candidate.toolId === 'or.solve_lp' && candidate.eligible));
  assert.match(decision.rationale, /Selected Hungarian Assignment/u);
  const plan = buildPlan(assignment, undefined, WS);
  assert.equal(plan[1]?.tool, 'or.assignment');
  assert.match(plan[0]?.detail ?? '', /Adaptive method selection/u);
});

test('known problems — VRP overrides a misleading profile and rejects TSP for capacity', () => {
  const { decision } = decisionFor(vrp);
  assert.equal(decision.selected?.toolId, 'routing.vrp');
  const tsp = decision.candidates.find((candidate) => candidate.toolId === 'routing.tsp');
  assert.ok(tsp);
  assert.equal(tsp?.eligible, false);
  assert.match(tsp?.rejectionReason ?? '', /points or a distance matrix/u);
  const plan = buildPlan(vrp, undefined, WS);
  assert.deepEqual(plan.map((task) => task.tool), ['meta.formulate_scientific_problem', 'routing.vrp']);
});

test('known problems — LP and scheduling select their executable methods', () => {
  const linear = decisionFor(lp).decision;
  assert.equal(linear.selected?.toolId, 'or.solve_lp');
  assert.ok(linear.candidates.some((candidate) => candidate.toolId === 'or.solve_lp' && candidate.eligible));
  const shifts = decisionFor(schedule).decision;
  assert.equal(shifts.selected?.toolId, 'or.employee_schedule');
  assert.ok(shifts.candidates.some((candidate) => candidate.toolId === 'or.solve_lp'));
});

test('known problems — Bayesian and scenario branches are both selected independently', () => {
  const { decision } = decisionFor(multi);
  assert.equal(decision.branches.length, 2);
  assert.deepEqual(decision.branches.map((branch) => branch.selected?.toolId), ['stats.bayes_update', 'sim.scenario_compare']);
  const plan = buildPlan(multi, undefined, WS);
  assert.deepEqual(plan.map((task) => task.tool), [
    'meta.formulate_scientific_problem', 'stats.bayes_update',
    'meta.formulate_scientific_problem', 'sim.scenario_compare',
  ]);
  assert.deepEqual(plan[1]?.dependsOn, [0]);
  assert.deepEqual(plan[3]?.dependsOn, [2]);
});

test('unfamiliar combination — time windows reject VRP and record research instead of dropping the constraint', () => {
  const objective = `Route vehicles with delivery time windows and capacity. Test data: ${JSON.stringify({ depots: [{ id: 'd', x: 0, y: 0 }], customers: [{ id: 'c1', x: 1, y: 2, demand: 3 }], vehicles: [{ id: 'v1', capacity: 20 }] })}`;
  const { decision } = decisionFor(objective);
  assert.equal(decision.selected, null);
  assert.equal(decision.research?.status, 'research-required');
  assert.match(decision.research?.requirement ?? '', /time windows/u);
  assert.ok(decision.candidates.every((candidate) => !candidate.eligible));
  const plan = buildPlan(objective, undefined, WS);
  assert.equal(plan.length, 1);
  assert.match(plan[0]?.detail ?? '', /SCIENTIFIC INPUT GAP|MISSING REQUIRED INPUT|time windows/iu);
  assert.notEqual(plan[0]?.tool, 'routing.vrp');
});

test('unfamiliar combination — nonlinear and stochastic requirements stay research proposals', () => {
  const nonlinear = decisionFor('Find a nonlinear non-convex optimum for a chemical process.').decision;
  assert.equal(nonlinear.selected, null);
  assert.equal(nonlinear.research?.status, 'research-required');
  assert.ok(nonlinear.research?.candidates.every((candidate) => candidate.implementation !== 'implemented'));
  const stochastic = decisionFor('Solve a two-stage stochastic program with chance constraints.').decision;
  assert.equal(stochastic.selected, null);
  assert.equal(stochastic.research?.status, 'research-required');
  assert.ok(stochastic.research?.candidates.some((candidate) => /stochastic/iu.test(candidate.name)));
});

test('adversarial — misleading optimization words do not trigger a solver', () => {
  const objective = 'We are not optimizing anything. Write a short project update for the team and list the next three meetings.';
  const { decision } = decisionFor(objective);
  assert.equal(decision.scientificRequired, false);
  assert.equal(decision.selected, null);
  const plan = buildPlan(objective, undefined, WS);
  assert.ok(plan.every((task) => !task.tool?.startsWith('or.') && !task.tool?.startsWith('routing.')));
});

test('adversarial — missing advanced data produces a gap, not a fabricated model', () => {
  const objective = 'Find the maximum flow through our distribution network from source to sink.';
  const { decision } = decisionFor(objective);
  assert.equal(decision.selected, null);
  assert.equal(decision.research?.status, 'missing-inputs');
  const plan = buildPlan(objective, undefined, WS);
  assert.equal(plan.length, 1);
  assert.match(plan[0]?.detail ?? '', /SCIENTIFIC INPUT GAP/u);
  assert.notEqual(plan[0]?.tool, 'graph.max_flow');
});

test('adversarial — infeasible model is reported as failed, never as a completed optimum', async () => {
  const objective = `Solve a linear program that is deliberately infeasible. Test data: ${JSON.stringify({
    sense: 'minimize', objective: [{ var: 'x', coeff: 1 }],
    constraints: [{ name: 'low', terms: [{ var: 'x', coeff: 1 }], op: '>=', rhs: 5 }, { name: 'high', terms: [{ var: 'x', coeff: 1 }], op: '<=', rhs: 1 }],
    bounds: [{ var: 'x', lower: 0 }],
  })}`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'failed');
  assert.equal(detail.outcomeStatus, 'failed');
});

test('adversarial — a tool-schema failure with a proven translation switches methods', async () => {
  const { missionId } = (() => {
    const id = createMission({ workspaceId: WS, objective: 'Assign three candidates to three options with one forbidden pair', actor: 'test' });
    const db = getOsDb();
    db.prepare('DELETE FROM os_tasks WHERE mission_id = ?').run(id);
    const taskId = newId('tsk');
    const ts = nowIso();
    db.prepare(`INSERT INTO os_tasks
      (id, mission_id, workspace_id, order_index, title, objective, specialization, status, agent_id, depends_on, acceptance, tool, tool_input, detail, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?, 'planned', NULL, '[]', ?, ?, ?, 'adaptive fixture', ?, ?)`)
      .run(taskId, id, WS, 'Assignment with a forbidden pair', 'Assignment with a forbidden pair', 'operations_research',
        JSON.stringify(['Optimal assignment found', 'Forbidden pair respected']), 'or.assignment',
        JSON.stringify({ costMatrix: [[12, 7, 9], [8, 14, 5], [6, 9, 11]], forbidden: [{ row: 0, col: 1 }] }), ts, ts);
    return { missionId: id };
  })();
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[0]?.tool, 'or.solve_lp');
  assert.ok(detail.decisions.some((decision) => decision.kind === 'adaptive-replan'));
  assert.ok(detail.decisions.some((decision) => decision.kind === 'method-outcome' && (decision.payload as { tool?: string }).tool === 'or.assignment'));
  assert.ok(detail.decisions.some((decision) => decision.kind === 'adaptive-replan-outcome'));
});

test('outcome record — mission creation persists candidates, selection and a method outcome', async () => {
  const missionId = createMission({ workspaceId: WS, objective: vrp, actor: 'test' });
  const detail = getMissionDetail(WS, missionId)!;
  const comparison = detail.decisions.find((decision) => decision.kind === 'adaptive-method-comparison');
  assert.ok(comparison);
  const payload = comparison.payload as { selected?: { toolId?: string }; candidates?: unknown[] };
  assert.equal(payload.selected?.toolId, 'routing.vrp');
  assert.ok(Array.isArray(payload.candidates) && payload.candidates.length >= 2);
  await executeMission(missionId, 'test');
  const executed = getMissionDetail(WS, missionId)!;
  assert.equal(executed.status, 'completed');
  assert.equal(executed.outcomeStatus, 'verified');
  assert.ok(executed.decisions.some((decision) => decision.kind === 'method-outcome' && (decision.payload as { tool?: string }).tool === 'routing.vrp'));
});

test('adaptation planner — infeasible stops, missing data asks, no alternative stops, LP translates to assignment', () => {
  const infeasible = planAdaptation({ tool: 'or.solve_lp', toolInput: {}, failureCategory: 'solver_failure', issues: ['infeasible'], semantics: { status: 'infeasible', acceptable: false }, previousAdaptations: 0 });
  assert.equal(infeasible.action, 'stop');
  const missing = planAdaptation({ tool: 'or.solve_lp', toolInput: {}, failureCategory: 'invalid_input', issues: ['missing required input: bounds'], semantics: { status: 'not_verified', acceptable: false }, previousAdaptations: 0 });
  assert.equal(missing.action, 'request_information');
  const none = planAdaptation({ tool: 'forecast.linear', toolInput: {}, failureCategory: 'tool_error', issues: ['solver crashed'], semantics: { status: 'not_verified', acceptable: false }, previousAdaptations: 0 });
  assert.equal(none.action, 'stop');
  const lpModel = {
    sense: 'minimize',
    objective: [{ var: 'x_0_0', coeff: 12 }, { var: 'x_0_1', coeff: 7 }, { var: 'x_1_0', coeff: 8 }, { var: 'x_1_1', coeff: 14 }],
    constraints: [
      { name: 'r0', terms: [{ var: 'x_0_0', coeff: 1 }, { var: 'x_0_1', coeff: 1 }], op: '=', rhs: 1 },
      { name: 'r1', terms: [{ var: 'x_1_0', coeff: 1 }, { var: 'x_1_1', coeff: 1 }], op: '=', rhs: 1 },
      { name: 'c0', terms: [{ var: 'x_0_0', coeff: 1 }, { var: 'x_1_0', coeff: 1 }], op: '=', rhs: 1 },
      { name: 'c1', terms: [{ var: 'x_0_1', coeff: 1 }, { var: 'x_1_1', coeff: 1 }], op: '=', rhs: 1 },
      { name: 'forbid', terms: [{ var: 'x_0_1', coeff: 1 }], op: '=', rhs: 0 },
    ],
  };
  const translated = alternativeForTask({ tool: 'or.solve_lp', toolInput: lpModel });
  assert.equal(translated?.tool, 'or.assignment');
  assert.deepEqual(translated?.input.forbidden, [{ row: 0, col: 1 }]);
});

test('method history — verified outcomes are read back per workspace and tool', () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Record a method outcome for learning.', actor: 'test' });
  saveDecisionRecord({ workspaceId: WS, missionId, kind: 'method-outcome', comparison: { tool: 'or.solve_lp', verificationPassed: true, durationMs: 12 }, reason: 'test', actor: 'test' });
  saveDecisionRecord({ workspaceId: WS, missionId, kind: 'method-outcome', comparison: { tool: 'or.solve_lp', verificationPassed: false, durationMs: 8 }, reason: 'test', actor: 'test' });
  const history = methodHistoryFor(WS, 'or.solve_lp');
  assert.ok(history.attempts >= 2);
  assert.ok(history.verified >= 1);
  assert.ok(history.failed >= 1);
  assert.ok(history.successRate > 0 && history.successRate < 1);
});

test('API — adaptive preview exposes candidates and never returns a secret', async () => {
  const response = await fetch(`${baseUrl}/capabilities/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective: assignment }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  const adaptive = body['adaptive'] as Record<string, unknown>;
  assert.equal(adaptive['selected'] && (adaptive['selected'] as Record<string, unknown>)['toolId'], 'or.assignment');
  assert.ok(Array.isArray(adaptive['candidates']));
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /api[_-]?key|secret|password|token/iu);
});
