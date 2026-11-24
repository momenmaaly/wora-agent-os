import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-runtime-api-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, getMissionDetail } = await import('./orchestrator.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;
const WS = 'wora-preview';
let server: Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/os', createOsRouter({ production: false }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/os`;
});

after(() => {
  server?.close();
  rmSync(TMP, { recursive: true, force: true });
});

test('pause, resume, cancel and diagnostics are real workspace-scoped endpoints', async () => {
  const pausedMission = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  const paused = await fetch(`${baseUrl}/missions/${pausedMission}/pause`, { method: 'POST' });
  assert.equal(paused.status, 200);
  assert.equal(((await paused.json()) as { status?: string }).status, 'paused');
  assert.equal(getMissionDetail(WS, pausedMission)!.status, 'paused');

  const resumed = await fetch(`${baseUrl}/missions/${pausedMission}/resume`, { method: 'POST' });
  assert.equal(resumed.status, 200);
  assert.equal(((await resumed.json()) as { status?: string }).status, 'completed');

  const leases = await fetch(`${baseUrl}/missions/${pausedMission}/leases`);
  assert.equal(leases.status, 200);
  assert.deepEqual(await leases.json(), []);
  const taskId = getMissionDetail(WS, pausedMission)!.tasks[0]!.id;
  const checkpoints = await fetch(`${baseUrl}/tasks/${taskId}/checkpoints`);
  assert.equal(checkpoints.status, 200);
  assert.ok(Array.isArray(await checkpoints.json()));

  const cancelledMission = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  const cancelled = await fetch(`${baseUrl}/missions/${cancelledMission}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(((await cancelled.json()) as { status?: string }).status, 'cancelled');
});

test('budget and lesson endpoints expose the real governance state', async () => {
  const budget = await fetch(`${baseUrl}/settings/action-budget`);
  assert.equal(budget.status, 200);
  assert.equal(((await budget.json()) as { maxAmountUsd?: number }).maxAmountUsd, 0);
  const updated = await fetch(`${baseUrl}/settings/action-budget`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ maxAmountUsd: 250, maxApprovalsPerMission: 3 }),
  });
  assert.equal(updated.status, 200);
  assert.equal(((await updated.json()) as { maxAmountUsd?: number }).maxAmountUsd, 250);

  const lessons = await fetch(`${baseUrl}/lessons`);
  assert.equal(lessons.status, 200);
  assert.ok(Array.isArray(await lessons.json()));
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  const collected = await fetch(`${baseUrl}/lessons/collect`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ missionId }),
  });
  assert.equal(collected.status, 200);
  assert.ok(Array.isArray(await collected.json()));
});
