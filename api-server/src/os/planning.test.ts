/**
 * WORA OS — formal planning tests.
 *
 * These exercise real persisted plan versions and deterministic alternatives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-planning-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, getMissionDetail } = await import('./orchestrator.js');
const { comparePlans, listPlanVersions, replanMission, verifyPlanExecution } = await import('./planning.js');
const { understandProblem } = await import('./problem.js');
const { getOsDb } = await import('./db.js');

const WS = 'wora-planning-test';

test('a mission persists a formal plan with goals, preconditions, effects and metrics', () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Analyze the objective and extract requirements', actor: 'test' });
  const versions = listPlanVersions(WS, missionId);
  assert.equal(versions.length, 1);
  const plan = versions[0]!.plan;
  assert.equal(plan.schemaVersion, '1.0');
  assert.ok(plan.tasks.length >= 2);
  assert.ok(plan.tasks.every((task) => task.preconditions.length > 0 && task.effects.length > 0));
  assert.ok(plan.criticalPath.length >= 1);
  assert.equal(plan.metrics.taskCount, plan.tasks.length);
  assert.ok(plan.metrics.totalCost > 0);
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.planVersions.length, 1);
});

test('alternative plans preserve the same task graph and compare honestly', () => {
  const profile = understandProblem({ objective: 'Analyze the objective and extract requirements' });
  const comparison = comparePlans([
    { title: 'low risk', objective: 'summarize', specialization: 'business_analyst', tool: 'text.extract_summary', toolInput: { text: 'x', sentences: 1 }, dependsOn: [], acceptance: ['ok'], detail: '' },
    { title: 'high risk', objective: 'run tests', specialization: 'qa_engineer', tool: 'host.exec', toolInput: { command: 'node', args: ['--test', 'test/app.test.mjs'] }, dependsOn: [], acceptance: ['ok'], detail: '' },
  ], WS, profile);
  assert.equal(comparison.plans.length, 2);
  assert.equal(comparison.plans[0]!.metrics.taskCount, comparison.plans[1]!.metrics.taskCount);
  assert.deepEqual(comparison.plans[0]!.tasks.map((task) => task.index), comparison.plans[1]!.tasks.map((task) => task.index));
  assert.deepEqual(comparison.plans[0]!.order, [0, 1]);
  assert.deepEqual(comparison.plans[1]!.order, [1, 0]);
  assert.match(comparison.reason, /direct|Risk-first/);
});

test('a dependency cycle is rejected instead of producing an impossible plan', () => {
  const profile = understandProblem({ objective: 'Analyze the objective and extract requirements' });
  assert.throws(() => comparePlans([
    { title: 'a', objective: 'a', specialization: 'generalist', tool: null, toolInput: {}, dependsOn: [1], acceptance: [], detail: '' },
    { title: 'b', objective: 'b', specialization: 'generalist', tool: null, toolInput: {}, dependsOn: [0], acceptance: [], detail: '' },
  ], WS, profile), /dependency cycle/);
});

test('replanning records a new version from remaining work without mutating the graph', () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Analyze the objective and extract requirements', actor: 'test' });
  const detail = getMissionDetail(WS, missionId)!;
  getOsDb().prepare("UPDATE os_tasks SET status = 'completed' WHERE id = ?").run(detail.tasks[0]!.id);
  const replanned = replanMission(WS, missionId, 'predecessor completed; plan the remainder', 'test');
  assert.equal(replanned.version, 2);
  assert.equal(replanned.plan.metrics.taskCount, detail.tasks.length - 1);
  assert.equal(getMissionDetail(WS, missionId)!.tasks.length, detail.tasks.length);
  assert.equal(listPlanVersions(WS, missionId).length, 2);
});

test('plan versions are workspace-scoped', () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Analyze the objective and extract requirements', actor: 'test' });
  assert.equal(listPlanVersions('other-workspace', missionId).length, 0);
});

test('executed plan verification catches missing dependencies and premature completion', () => {
  const valid = verifyPlanExecution([
    { id: 'a', status: 'completed', dependsOn: [] },
    { id: 'b', status: 'completed', dependsOn: ['a'] },
  ]);
  assert.equal(valid.passed, true);
  const invalid = verifyPlanExecution([
    { id: 'a', status: 'failed', dependsOn: [] },
    { id: 'b', status: 'completed', dependsOn: ['a'] },
    { id: 'c', status: 'running', dependsOn: ['missing'] },
  ]);
  assert.equal(invalid.passed, false);
  assert.ok(invalid.checks.some((check) => check.id === 'plan-dependencies-exist' && check.status === 'failed'));
  assert.ok(invalid.checks.some((check) => check.id === 'plan-completion-order' && check.status === 'failed'));
  assert.ok(invalid.checks.some((check) => check.id === 'plan-failure-propagation' && check.status === 'failed'));
});
