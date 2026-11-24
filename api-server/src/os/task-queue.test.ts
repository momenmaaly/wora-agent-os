/**
 * WORA OS — durable task queue tests.
 *
 * These exercise real SQLite leases and checkpoints, not a simulated queue.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-task-queue-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail, pauseMission, resumeMission, cancelMission, markInterruptedMissions } = await import('./orchestrator.js');
const { claimTask, heartbeatTask, releaseTaskLease, getTaskLease, checkpointTask, latestTaskCheckpoint, listTaskCheckpoints, recoverExpiredTaskLeases } = await import('./task-queue.js');
const { getOsDb } = await import('./db.js');

const WS = 'wora-task-queue-test';

function missionWithTask(objective = 'Inspect my computer and identify potential problems') {
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  return { missionId, taskId: getMissionDetail(WS, missionId)!.tasks[0]!.id };
}

test('only one owner can hold an active task lease', () => {
  const { missionId, taskId } = missionWithTask();
  const first = claimTask({ workspaceId: WS, taskId, missionId, ownerId: 'worker-a', ttlMs: 30_000 });
  assert.ok(first);
  assert.equal(claimTask({ workspaceId: WS, taskId, missionId, ownerId: 'worker-b', ttlMs: 30_000 }), null);
  assert.equal(claimTask({ workspaceId: WS, taskId, missionId, ownerId: 'worker-a', ttlMs: 30_000 })?.ownerId, 'worker-a');
  assert.equal(getTaskLease(WS, taskId)?.ownerId, 'worker-a');
  assert.equal(releaseTaskLease({ workspaceId: WS, taskId, ownerId: 'worker-b' }), false);
  assert.equal(releaseTaskLease({ workspaceId: WS, taskId, ownerId: 'worker-a' }), true);
  assert.equal(getTaskLease(WS, taskId), null);
});

test('heartbeat extends a live lease and an expired lease is recoverable', () => {
  const { missionId, taskId } = missionWithTask();
  const lease = claimTask({ workspaceId: WS, taskId, missionId, ownerId: 'worker-a', ttlMs: 5_000 })!;
  assert.equal(heartbeatTask({ workspaceId: WS, taskId, ownerId: 'worker-b', ttlMs: 5_000 }), false);
  assert.equal(heartbeatTask({ workspaceId: WS, taskId, ownerId: 'worker-a', ttlMs: 5_000 }), true);
  getOsDb().prepare('UPDATE os_task_leases SET expires_at = ? WHERE task_id = ?').run(Date.now() - 1, taskId);
  assert.equal(recoverExpiredTaskLeases(WS), 1);
  assert.equal(getTaskLease(WS, taskId), null);
  assert.equal(claimTask({ workspaceId: WS, taskId, missionId, ownerId: 'worker-b', ttlMs: 5_000 })?.ownerId, 'worker-b');
  void lease;
});

test('checkpoints preserve started and completed states', () => {
  const { missionId, taskId } = missionWithTask();
  checkpointTask({ workspaceId: WS, taskId, missionId, runId: 'run-a', attempt: 1, status: 'started', checkpoint: { phase: 'before' } });
  assert.equal(latestTaskCheckpoint(WS, taskId)?.status, 'started');
  checkpointTask({ workspaceId: WS, taskId, missionId, runId: 'run-a', attempt: 1, status: 'completed', output: { ok: true }, evidence: [{ source: 'test' }], checkpoint: { phase: 'after' } });
  assert.equal(latestTaskCheckpoint(WS, taskId)?.status, 'completed');
  assert.equal(listTaskCheckpoints(WS, taskId).length, 1);
  assert.equal(latestTaskCheckpoint(WS, taskId)?.outputDigest.length, 32);
});

test('a started checkpoint without completion blocks a duplicate side effect', async () => {
  const { missionId, taskId } = missionWithTask();
  checkpointTask({ workspaceId: WS, taskId, missionId, runId: 'crashed-run', attempt: 1, status: 'started', checkpoint: { phase: 'before' } });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'failed');
  const task = detail.tasks.find((entry) => entry.id === taskId)!;
  assert.equal(task.status, 'blocked');
  assert.match(task.detail, /side_effect_uncertain/);
});

test('pause and resume gate execution at a task boundary', async () => {
  const { missionId } = missionWithTask();
  assert.equal(pauseMission(WS, missionId, 'test'), true);
  await executeMission(missionId, 'test');
  assert.equal(getMissionDetail(WS, missionId)!.status, 'paused');
  assert.equal(resumeMission(WS, missionId, 'test'), true);
  await executeMission(missionId, 'test');
  assert.equal(getMissionDetail(WS, missionId)!.status, 'completed');
});

test('cancel invalidates leases and prevents further execution', async () => {
  const { missionId, taskId } = missionWithTask();
  claimTask({ workspaceId: WS, taskId, missionId, ownerId: 'worker-a', ttlMs: 30_000 });
  assert.equal(cancelMission(WS, missionId, 'test'), true);
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'cancelled');
  assert.equal(detail.tasks.find((entry) => entry.id === taskId)!.status, 'cancelled');
  assert.equal(getTaskLease(WS, taskId), null);
  await executeMission(missionId, 'test');
  assert.equal(getMissionDetail(WS, missionId)!.status, 'cancelled');
});

test('restart recovery clears stale leases and remains resumable', async () => {
  const { missionId, taskId } = missionWithTask();
  claimTask({ workspaceId: WS, taskId, missionId, ownerId: 'worker-a', ttlMs: 30_000 });
  getOsDb().prepare("UPDATE os_missions SET status = 'running' WHERE id = ?").run(missionId);
  markInterruptedMissions();
  assert.equal(getTaskLease(WS, taskId), null);
  assert.equal(getMissionDetail(WS, missionId)!.status, 'failed');
  await executeMission(missionId, 'test');
  assert.equal(getMissionDetail(WS, missionId)!.status, 'completed');
});

test('a completed mission leaves no active lease and records completed checkpoints', async () => {
  const { missionId, taskId } = missionWithTask();
  await executeMission(missionId, 'test');
  assert.equal(getTaskLease(WS, taskId), null);
  assert.equal(latestTaskCheckpoint(WS, taskId)?.status, 'completed');
});
