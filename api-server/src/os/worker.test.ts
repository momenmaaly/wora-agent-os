/**
 * WORA OS — opt-in durable worker and runtime-status tests.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-worker-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, getMissionDetail, markInterruptedMissions } = await import('./orchestrator.js');
const { runWorkerOnce, workerStatus, startWorker, workerSnapshot } = await import('./worker.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-worker-test';
let server: Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use('/api/os', createOsRouter({ production: false }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}/api/os`;
});
after(() => { server?.close(); rmSync(TMP, { recursive: true, force: true }); });

test('the worker resumes an interrupted mission without re-running completed work', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  assert.equal(markInterruptedMissions(WS), 1);
  assert.equal(getMissionDetail(WS, missionId)!.status, 'failed');

  const first = await runWorkerOnce({ workspaceId: WS, maxMissions: 1 });
  assert.deepEqual(first.attempted, [missionId]);
  assert.deepEqual(first.completed, [missionId]);
  assert.equal(getMissionDetail(WS, missionId)!.status, 'completed');
  assert.equal(getMissionDetail(WS, missionId)!.tasks.every((task) => task.status === 'completed'), true);

  const second = await runWorkerOnce({ workspaceId: WS, maxMissions: 1 });
  assert.deepEqual(second.attempted, []);
  assert.deepEqual(second.completed, []);
});

test('worker status is honest about single-process durability and exposes runtime HTTP state', async () => {
  const status = workerStatus();
  assert.equal(status.mode, 'opt-in-worker');
  assert.equal(status.durableStore, false);
  assert.equal(status.taskLeases, true);
  assert.equal(status.missionLease, true);
  assert.ok(status.limitations.length >= 2);
  assert.ok(workerSnapshot(WS).recovery);

  const response = await fetch(`${baseUrl}/runtime/status`);
  assert.equal(response.status, 200);
  const body = await response.json() as { mode?: string; taskLeases?: boolean; limits?: unknown };
  assert.equal(body.mode, 'opt-in-worker');
  assert.equal(body.taskLeases, true);
  assert.ok(body.limits);
});

test('the polling worker stops gracefully', async () => {
  const handle = startWorker({ workspaceId: WS, intervalMs: 1_000, maxMissions: 1 });
  handle.stop();
  await handle.done;
  const listed = (await import('./orchestrator.js')).listMissions(WS);
  assert.ok(listed.length > 0);
  const firstId = listed[0]?.id;
  assert.ok(firstId);
  assert.notEqual(getMissionDetail(WS, firstId)?.status, 'running');
});
