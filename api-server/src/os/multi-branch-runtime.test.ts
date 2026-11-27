/**
 * WORA OS — multi-branch runtime evidence.
 *
 * These tests inspect real run timestamps from the durable task queue. They do
 * not infer parallelism from the plan graph.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-v22-multi-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
process.env['WORA_TEST_TOOL_DELAY_MS'] = '250';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { ensureSeedAgents } = await import('./registry.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { getOsDb } = await import('./db.js');

const WS = 'wora-v22-multi';
ensureSeedAgents(WS);
setExecutionLimits(WS, { maxAttempts: 1, maxConcurrentTasks: 4 }, 'test');

function runs(missionId: string): Array<{ task_id: string; status: string; started_at: string; finished_at: string }> {
  return getOsDb().prepare('SELECT task_id, status, started_at, finished_at FROM os_runs WHERE mission_id = ? ORDER BY started_at').all(missionId) as Array<{ task_id: string; status: string; started_at: string; finished_at: string }>;
}

test('independent branches overlap in real run time while dependent branches wait', async () => {
  const objective = `Compare two independent models. Model A: {"costMatrix":[[1,2],[3,4]]} Model B: {"sense":"minimize","objective":[{"var":"x","coeff":1},{"var":"y","coeff":2}],"constraints":[{"name":"c1","terms":[{"var":"x","coeff":1},{"var":"y","coeff":1}],"op":">=","rhs":5}]}`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  const planned = getMissionDetail(WS, missionId)!;
  assert.equal(planned.tasks.length, 4);
  assert.deepEqual(planned.tasks.map((task) => task.tool), ['meta.formulate_scientific_problem', 'or.assignment', 'meta.formulate_scientific_problem', 'or.solve_lp']);

  await executeMission(missionId, 'test', { concurrency: 2 });
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.outcomeStatus, 'verified');
  const byTask = new Map(runs(missionId).map((run) => [run.task_id, run]));
  const first = byTask.get(detail.tasks[0]!.id)!;
  const second = byTask.get(detail.tasks[2]!.id)!;
  const dependentA = byTask.get(detail.tasks[1]!.id)!;
  const dependentB = byTask.get(detail.tasks[3]!.id)!;
  assert.ok(first.started_at < second.finished_at && second.started_at < first.finished_at, 'independent formulation tasks did not overlap');
  assert.ok(dependentA.started_at >= first.finished_at, 'dependent A started before its branch formulation completed');
  assert.ok(dependentB.started_at >= second.finished_at, 'dependent B started before its branch formulation completed');
  assert.match(planned.tasks[0]!.detail ?? '', /Adaptive branch 1/u);
  assert.match(planned.tasks[2]!.detail ?? '', /Adaptive branch 2/u);
});

test('a supported branch still executes when an independent branch is unsupported, and the gap is recorded', async () => {
  const mixedWs = 'wora-v22-mixed';
  ensureSeedAgents(mixedWs);
  setExecutionLimits(mixedWs, { maxAttempts: 1, maxConcurrentTasks: 4 }, 'test');
  const objective = 'Do two things. Model A: {"costMatrix":[[1,2],[3,4]]} Model B: {"depots":[{"id":"d","x":0,"y":0}],"customers":[{"id":"c","x":1,"y":0,"demand":1}],"vehicles":[{"id":"v","capacity":10}]} with a delivery time window.';
  const missionId = createMission({ workspaceId: mixedWs, objective, actor: 'test' });
  const planned = getMissionDetail(mixedWs, missionId)!;
  assert.equal(planned.tasks.length, 2);
  assert.ok(planned.tasks.some((task) => task.tool === 'or.assignment'));
  assert.ok(!planned.tasks.some((task) => task.tool === 'routing.vrp'));
  const gap = (planned.decisions as Array<{ kind: string; payload?: Record<string, unknown> }>).find((entry) => entry.kind === 'adaptive-branch-gap');
  assert.ok(gap);
  assert.equal((gap!.payload?.['selectedBranches'] as Array<Record<string, unknown>>).length, 1);

  await executeMission(missionId, 'test');
  const detail = getMissionDetail(mixedWs, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.outcomeStatus, 'partially_verified');
  assert.ok(detail.outcomeVerification?.checks.some((check) => check.id === 'adaptive-branch-gap' && check.status === 'not_run'));
});

test('a failed branch blocks only its downstream work and does not silently contaminate the independent branch', async () => {
  const isolationWs = 'wora-v22-branch-isolation';
  ensureSeedAgents(isolationWs);
  setExecutionLimits(isolationWs, { maxAttempts: 1, maxConcurrentTasks: 3 }, 'test');
  const missionId = createMission({ workspaceId: isolationWs, objective: 'Branch isolation fixture', actor: 'test' });
  const db = getOsDb();
  db.prepare('DELETE FROM os_tasks WHERE mission_id = ?').run(missionId);
  const ts = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO os_tasks
    (id, mission_id, workspace_id, order_index, title, objective, specialization, status, agent_id, depends_on, acceptance, tool, tool_input, detail, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', NULL, ?, ?, ?, ?, ?, ?, ?)`);
  const failedId = 'tsk_branch_failed';
  const independentId = 'tsk_branch_independent';
  const downstreamId = 'tsk_branch_downstream';
  insert.run(failedId, missionId, isolationWs, 0, 'failing branch', 'failing branch', 'operations_research', '[]', JSON.stringify(['The task fails honestly']), 'or.assignment', JSON.stringify({ model: { costMatrix: [[1, 2], [3]], forbidden: [{ row: 0, col: 1 }] } }), 'invalid branch fixture', ts, ts);
  insert.run(independentId, missionId, isolationWs, 1, 'independent branch', 'independent branch', 'data_analyst', '[]', JSON.stringify(['Statistics returned']), 'stats.describe', JSON.stringify({ series: [1, 2, 3, 4] }), 'independent fixture', ts, ts);
  insert.run(downstreamId, missionId, isolationWs, 2, 'downstream of failure', 'downstream of failure', 'data_analyst', JSON.stringify([failedId]), JSON.stringify(['Statistics returned']), 'stats.describe', JSON.stringify({ series: [1, 2, 3, 4] }), 'downstream fixture', ts, ts);

  await executeMission(missionId, 'test', { concurrency: 3 });
  const detail = getMissionDetail(isolationWs, missionId)!;
  assert.equal(detail.tasks[0]!.status, 'failed');
  assert.equal(detail.tasks[1]!.status, 'completed');
  assert.equal(detail.tasks[2]!.status, 'blocked');
  assert.equal(detail.status, 'failed');
  const independentRun = runs(missionId).find((run) => run.task_id === independentId);
  assert.equal(independentRun?.status, 'completed');
});
