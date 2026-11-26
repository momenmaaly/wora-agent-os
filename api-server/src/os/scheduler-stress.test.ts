/**
 * WORA OS — scheduler stress and recovery tests.
 *
 * These tests execute real missions through the durable lease/checkpoint layer.
 * They measure outcomes, not hypothetical distributed scheduling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-scheduler-stress-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const {
  createMission, executeMission, getMissionDetail, cancelMission, resumeMission,
} = await import('./orchestrator.js');
const { getOsDb, newId, nowIso } = await import('./db.js');
const { ensureSeedAgents } = await import('./registry.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { listMissionApprovals, decideApproval } = await import('./governance.js');
const { workspacePath } = await import('./workspace.js');

const WS = 'wora-scheduler-stress';

type Spec = {
  title: string; specialization: string; tool: string; input: Record<string, unknown>;
  dependsOn?: number[]; acceptance?: string[];
};

function syntheticMission(specs: Spec[]): { missionId: string; ids: string[] } {
  ensureSeedAgents(WS);
  const missionId = createMission({ workspaceId: WS, objective: 'Scheduler stress fixture', actor: 'test' });
  const db = getOsDb();
  db.prepare('DELETE FROM os_tasks WHERE mission_id = ?').run(missionId);
  const ids: string[] = [];
  const ts = nowIso();
  specs.forEach((spec, index) => {
    const id = newId('tsk');
    ids.push(id);
    db.prepare(`INSERT INTO os_tasks
      (id, mission_id, workspace_id, order_index, title, objective, specialization, status, agent_id, depends_on, acceptance, tool, tool_input, detail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', NULL, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, missionId, WS, index, spec.title, spec.title, spec.specialization,
        JSON.stringify((spec.dependsOn ?? []).map((dep) => ids[dep])),
        JSON.stringify(spec.acceptance ?? ['Output satisfies the deterministic review']),
        spec.tool, JSON.stringify(spec.input), 'stress fixture', ts, ts);
  });
  return { missionId, ids };
}

function statsSpec(index: number, dependsOn: number[] = []): Spec {
  return {
    title: `statistics ${index}`, specialization: 'data_analyst', tool: 'stats.describe',
    input: { series: [1, 2, 3, 4, index + 1] }, dependsOn,
    acceptance: ['Descriptive statistics returned'],
  };
}

function completedRunCount(missionId: string): number {
  const row = getOsDb().prepare("SELECT COUNT(*) AS c FROM os_runs WHERE mission_id = ? AND status = 'completed'").get(missionId) as { c: number };
  return Number(row.c);
}

for (const concurrency of [2, 4, 8]) {
  test(`independent tasks complete under ${concurrency} workers without duplicate runs`, async () => {
    const { missionId, ids } = syntheticMission(Array.from({ length: 8 }, (_, index) => statsSpec(index)));
    const started = Date.now();
    await executeMission(missionId, 'test', { concurrency });
    const elapsed = Date.now() - started;
    const detail = getMissionDetail(WS, missionId)!;
    assert.equal(detail.status, 'completed');
    assert.ok(detail.tasks.every((task) => task.status === 'completed'));
    assert.equal(completedRunCount(missionId), ids.length);
    const runs = getOsDb().prepare('SELECT task_id, COUNT(*) AS c FROM os_runs WHERE mission_id = ? GROUP BY task_id').all(missionId) as Array<{ task_id: string; c: number }>;
    assert.equal(runs.length, ids.length);
    assert.ok(runs.every((row) => Number(row.c) === 1), JSON.stringify(runs));
    assert.ok(elapsed >= 0);
    console.log(`[scheduler] concurrency=${concurrency} tasks=${ids.length} elapsedMs=${elapsed}`);
  });
}

test('a large dependency chain completes in order under four workers', async () => {
  const specs = Array.from({ length: 12 }, (_, index) => statsSpec(index, index === 0 ? [] : [index - 1]));
  const { missionId } = syntheticMission(specs);
  await executeMission(missionId, 'test', { concurrency: 4 });
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.ok(detail.tasks.every((task) => task.status === 'completed'));
  const runs = getOsDb().prepare('SELECT task_id, started_at, finished_at FROM os_runs WHERE mission_id = ?').all(missionId) as Array<{ task_id: string; started_at: string; finished_at: string }>;
  const byTask = new Map(runs.map((run) => [run.task_id, run]));
  for (let index = 1; index < specs.length; index += 1) {
    const previous = byTask.get(detail.tasks[index - 1]!.id);
    const current = byTask.get(detail.tasks[index]!.id);
    assert.ok(previous?.finished_at);
    assert.ok(current?.started_at);
    assert.ok(previous.finished_at <= current.started_at, `task ${index} started before dependency finished`);
  }
});

test('expired worker leases are recovered and the mission remains resumable', async () => {
  const { missionId, ids } = syntheticMission([statsSpec(1)]);
  getOsDb().prepare("UPDATE os_missions SET status = 'running' WHERE id = ?").run(missionId);
  getOsDb().prepare('INSERT INTO os_task_leases (task_id, mission_id, workspace_id, owner_id, acquired_at, heartbeat_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ids[0]!, missionId, WS, 'crashed-worker', nowIso(), nowIso(), Date.now() - 1, nowIso());
  const { recoverExpiredTaskLeases } = await import('./task-queue.js');
  assert.equal(recoverExpiredTaskLeases(WS), 1);
  assert.equal(getMissionDetail(WS, missionId)!.tasks[0]!.status, 'blocked');
  await executeMission(missionId, 'test');
  assert.equal(getMissionDetail(WS, missionId)!.status, 'completed');
});

test('retry exhaustion produces an honest failure with the configured number of attempts', async () => {
  setExecutionLimits(WS, { maxAttempts: 2 }, 'test');
  const { missionId, ids } = syntheticMission([{
    title: 'read a missing file', specialization: 'software_engineer', tool: 'fs.workspace_read',
    input: { path: 'does-not-exist.txt' }, acceptance: ['File content returned'],
  }]);
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'failed');
  assert.equal(detail.tasks.find((task) => task.id === ids[0])!.status, 'failed');
  const runs = getOsDb().prepare('SELECT status, attempt FROM os_runs WHERE mission_id = ? ORDER BY attempt').all(missionId) as Array<{ status: string; attempt: number }>;
  assert.equal(runs.length, 2);
  assert.equal(runs.at(-1)!.status, 'failed');
  assert.ok(runs.every((run) => run.status !== 'completed'));
});

test('a failed dependency blocks dependents while an independent task still completes', async () => {
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  const { missionId } = syntheticMission([
    { title: 'failing dependency', specialization: 'software_engineer', tool: 'fs.workspace_read', input: { path: 'missing.txt' }, acceptance: ['File content returned'] },
    statsSpec(2),
    statsSpec(3, [0]),
  ]);
  await executeMission(missionId, 'test', { concurrency: 3 });
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.tasks[0]!.status, 'failed');
  assert.equal(detail.tasks[1]!.status, 'completed');
  assert.equal(detail.tasks[2]!.status, 'blocked');
  assert.equal(detail.status, 'failed');
});

test('cancellation during a running tool rejects the result and leaves no accepted completion', async () => {
  const workspace = workspacePath(WS);
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(workspace, 'slow.test.mjs'), "import { test } from 'node:test';\ntest('slow', async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });\n", 'utf8');
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  const { missionId, ids } = syntheticMission([{
    title: 'slow allowlisted test', specialization: 'qa_engineer', tool: 'host.exec',
    input: { command: 'node', args: ['--test', 'slow.test.mjs'] }, acceptance: ['Test passed'],
  }]);
  await executeMission(missionId, 'test');
  const pending = listMissionApprovals(WS, missionId).find((approval) => approval.status === 'pending');
  assert.ok(pending, 'expected an approval before the high-risk test runs');
  decideApproval(WS, pending.id, 'approved', 'test cancellation path', 'reviewer');

  const running = executeMission(missionId, 'test');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(cancelMission(WS, missionId, 'test'), true);
  await running;
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'cancelled');
  assert.equal(detail.tasks.find((task) => task.id === ids[0])!.status, 'cancelled');
  const runs = getOsDb().prepare('SELECT status FROM os_runs WHERE mission_id = ?').all(missionId) as Array<{ status: string }>;
  assert.ok(runs.length >= 1);
  assert.ok(runs.every((run) => run.status !== 'completed'), JSON.stringify(runs));
});
