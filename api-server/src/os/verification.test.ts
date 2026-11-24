/**
 * WORA OS — verification record tests.
 *
 * These exercise the real SQLite table and the orchestrator integration. They
 * do not accept an agent's self-report as evidence: the mission must produce a
 * persisted record with checks, actual output and a deterministic result.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-verification-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['WORA_EXT_KEY_FILE'] = path.join(TMP, 'ext.key');
process.env['WORA_EXT_BUNDLED_DIR'] = path.join(TMP, 'bundled');
process.env['AUTH_SECRET'] = 'test-secret-0123456789abcdef0123456789abcdef';
process.env['ADMIN_API_KEY'] = 'test-admin-key';
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { recordVerification, listVerifications, getVerification } = await import('./verification.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-verification-test';
let server: Server;
let baseUrl = '';

before(async () => {
  const app = express();
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

test('a completed mission produces a persisted verification with checks and evidence', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  const verifications = listVerifications(WS, { missionId });
  assert.ok(verifications.length >= 1);
  const record = verifications[0]!;
  assert.equal(record.result, 'passed');
  assert.equal(record.independence, 'deterministic-review');
  assert.ok(record.acceptanceCriteria.length > 0);
  assert.ok(record.evidence);
  assert.ok(record.checks.some((check) => check.id === 'tool-execution' && check.status === 'passed'));
  assert.ok(record.checks.some((check) => check.id === 'acceptance-review' && check.status === 'passed'));
  assert.equal(record.failureReason, '');
  assert.equal(record.verifier, 'wora.orchestrator/reviewRun');
  assert.ok(detail.verifications.some((entry) => entry.id === record.id));
});

test('a failed verification records the failure reason instead of hiding it', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  const task = detail.tasks[0]!;
  const record = recordVerification({
    workspaceId: WS,
    missionId,
    taskId: task.id,
    runId: `run_manual_failure_${Date.now()}`,
    objective: task.objective,
    acceptanceCriteria: task.acceptance,
    expectedOutput: 'A verified result',
    actualOutput: { ok: false },
    evidence: [{ reason: 'simulated failure fixture' }],
    checks: [{ id: 'acceptance-review', kind: 'acceptance', description: 'Acceptance review', status: 'failed', evidence: 'Expected evidence was absent' }],
    result: 'failed',
    failureReason: 'Expected evidence was absent',
    verifier: 'test-verifier',
  });
  assert.equal(record.result, 'failed');
  assert.equal(record.failureReason, 'Expected evidence was absent');
  assert.equal(getVerification(WS, record.id)?.id, record.id);
});

test('verification records are isolated by workspace', () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  const detail = getMissionDetail(WS, missionId)!;
  const task = detail.tasks[0]!;
  const record = recordVerification({
    workspaceId: WS, missionId, taskId: task.id, runId: `run_isolation_${Date.now()}`,
    objective: task.objective, acceptanceCriteria: task.acceptance, expectedOutput: 'x', actualOutput: null,
    evidence: [], checks: [], result: 'blocked', failureReason: 'not authorized',
  });
  assert.equal(getVerification('wora-other', record.id), null);
  assert.equal(listVerifications('wora-other').some((entry) => entry.id === record.id), false);
});

test('the verification API exposes the mission record and a single record', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  await executeMission(missionId, 'test');
  const headers = { authorization: 'Bearer test-admin-key', 'x-workspace': WS };
  const response = await fetch(`${baseUrl}/missions/${missionId}/verifications`, { headers });
  assert.equal(response.status, 200);
  const records = await response.json() as Array<{ id: string; result: string }>;
  assert.ok(records.length >= 1);
  assert.equal(records[0]!.result, 'passed');

  const one = await fetch(`${baseUrl}/verifications/${records[0]!.id}`, { headers });
  assert.equal(one.status, 200);
  assert.equal((await one.json() as { id: string }).id, records[0]!.id);
});
