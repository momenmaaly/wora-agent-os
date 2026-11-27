import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env['WORA_OS_DB'] = ':memory:';
process.env['NODE_ENV'] = 'test';
const { createMission, getMissionDetail } = await import('./orchestrator.js');
const { getOsDb, nowIso, resetOsDbForTests } = await import('./db.js');
const { recoveryReport, recoverWorkspace } = await import('./recovery.js');
const WS = 'recovery-workspace';
after(() => resetOsDbForTests());

test('recovery reports interrupted missions, expired leases and started checkpoints', () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  const detail = getMissionDetail(WS, missionId)!;
  const task = detail.tasks[0]!;
  const db = getOsDb();
  db.prepare("UPDATE os_missions SET status = 'running' WHERE id = ?").run(missionId);
  db.prepare("UPDATE os_tasks SET status = 'running' WHERE id = ?").run(task.id);
  db.prepare(`INSERT INTO os_task_leases (task_id, mission_id, workspace_id, owner_id, acquired_at, heartbeat_at, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(task.id, missionId, WS, 'dead-worker', nowIso(), nowIso(), Date.now() - 1_000, nowIso());
  db.prepare(`INSERT INTO os_task_checkpoints (id, task_id, mission_id, workspace_id, run_id, attempt, status, checkpoint, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'started', ?, ?, ?)`).run('ckp_recovery', task.id, missionId, WS, 'run_recovery', 1, '{}', nowIso(), nowIso());
  const before = recoveryReport(WS);
  assert.equal(before.interruptedMissions, 1);
  assert.equal(before.expiredLeases, 1);
  assert.equal(before.startedCheckpoints, 1);
  assert.equal(before.resumable, true);
  const result = recoverWorkspace(WS);
  assert.equal(result.recoveredMissions, 1);
  assert.ok(result.recoveredLeases >= 1);
  assert.equal(result.after.expiredLeases, 0);
  assert.equal(result.after.interruptedMissions, 0);
  assert.equal(result.after.blockedTasks, 1, 'an interrupted task is blocked for explicit resume');
  const after = getMissionDetail(WS, missionId)!;
  assert.notEqual(after.status, 'running');
});

test('recovery is workspace-scoped', () => {
  const other = 'recovery-other';
  const missionId = createMission({ workspaceId: other, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  getOsDb().prepare("UPDATE os_missions SET status = 'running' WHERE id = ?").run(missionId);
  assert.equal(recoveryReport(other).interruptedMissions, 1);
  assert.equal(recoveryReport(WS).interruptedMissions, 0);
});
