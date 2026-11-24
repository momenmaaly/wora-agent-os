/**
 * WORA OS — adversarial security regressions.
 *
 * Each test attempts a real bypass or cross-boundary read against SQLite-backed
 * code. A passing test means the operation was refused or the exposed view was
 * redacted, not that a mock returned a canned error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-security-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail, listMissions } = await import('./orchestrator.js');
const {
  createApproval, decideApproval, consumeApproval, actionScope, getApproval,
} = await import('./governance.js');
const { listPlanVersions } = await import('./planning.js');
const { listVerifications } = await import('./verification.js');
const { listTaskLeases, claimTask } = await import('./task-queue.js');
const { listLessons, collectCandidateLessons, evaluateLesson, promoteLesson, revokeLesson, getLesson } = await import('./lessons.js');
const { getWorkspaceRole, setWorkspaceRole } = await import('./roles.js');
const { createOsRouter } = await import('./router.js');
const { getOsDb } = await import('./db.js');
const express = (await import('express')).default;

const A = 'wora-security-a';
const B = 'wora-security-b';

function mission(ws: string, objective = 'Inspect my computer and identify potential problems') {
  const id = createMission({ workspaceId: ws, objective, actor: 'test' });
  return { id, taskId: getMissionDetail(ws, id)!.tasks[0]!.id };
}

test('two simultaneous consumption attempts produce exactly one consumed approval', async () => {
  const { id: missionId, taskId } = mission(A);
  const payload = { command: 'node', args: ['--test', 'test/app.test.mjs'] };
  const approval = createApproval({
    workspaceId: A, missionId, taskId, toolId: 'host.exec', actionSummary: 'Run tests',
    risk: 'high', toolInput: payload, requestedBy: 'agent',
  });
  decideApproval(A, approval.id, 'approved', 'reviewed', 'reviewer');
  const attempts = await Promise.allSettled([
    (async () => consumeApproval(A, approval.id, { payload, scope: approval.scope, actionClass: 'C', actor: 'agent-a', missionId, taskId }))(),
    (async () => consumeApproval(A, approval.id, { payload, scope: approval.scope, actionClass: 'C', actor: 'agent-b', missionId, taskId }))(),
  ]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
  assert.ok(getApproval(A, approval.id)!.consumedAt);
  assert.equal(getApproval(A, approval.id)!.consumedBy, 'agent-a');
});

test('approval payload substitution, scope widening and cross-workspace lookup fail closed', () => {
  const { id: missionId, taskId } = mission(A);
  const payload = { command: 'node', args: ['--test', 'test/app.test.mjs'] };
  const approval = createApproval({
    workspaceId: A, missionId, taskId, toolId: 'host.exec', actionSummary: 'Run tests',
    risk: 'high', toolInput: payload, requestedBy: 'agent',
  });
  decideApproval(A, approval.id, 'approved', 'reviewed', 'reviewer');
  assert.equal(getApproval(B, approval.id), null);
  assert.throws(() => consumeApproval(A, approval.id, {
    payload: { command: 'node', args: ['--test', 'other.test.mjs'] }, scope: approval.scope, actionClass: 'C', actor: 'agent', missionId, taskId,
  }), /payload digest/);
  assert.throws(() => consumeApproval(A, approval.id, {
    payload, scope: actionScope(missionId, 'other-task', 'host.exec'), actionClass: 'C', actor: 'agent', missionId, taskId,
  }), /scope/);
  assert.equal(getApproval(A, approval.id)!.consumedAt, null);
});

test('missions, plans, leases, verifications and lessons are workspace-isolated', async () => {
  const a = mission(A);
  const b = mission(B);
  claimTask({ workspaceId: B, taskId: b.taskId, missionId: b.id, ownerId: 'b-worker', ttlMs: 30_000 });
  await executeMission(a.id, 'test');

  assert.equal(getMissionDetail(A, b.id), null);
  assert.ok(listMissions(A).every((entry) => entry.id !== b.id));
  assert.deepEqual(listPlanVersions(A, b.id), []);
  assert.equal(listVerifications(A, { missionId: b.id }).length, 0);
  assert.ok(listTaskLeases(A, b.id).length === 0);
  assert.ok(listTaskLeases(B, b.id).length > 0);

  const lesson = listLessons(A).find((entry) => entry.missionId === a.id)!;
  assert.ok(lesson);
  assert.equal(getLesson(B, lesson.id), null);
  assert.ok(listLessons(B).every((entry) => entry.id !== lesson.id));
});

test('lesson promotion and revocation require an admin role at the HTTP boundary', async () => {
  const ws = 'wora-preview';
  // Bootstrap a different owner, then demote the preview actor to viewer.
  assert.equal(getWorkspaceRole(ws, 'bootstrap-owner'), 'owner');
  setWorkspaceRole(ws, 'preview', 'viewer', 'bootstrap-owner');
  const app = express();
  app.use(express.json());
  app.use('/api/os', createOsRouter({ production: false }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    for (const pathName of ['/lessons/anything/promote', '/lessons/anything/revoke']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/os${pathName}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal(response.status, 403, pathName);
    }
  } finally {
    server.close();
  }
});

test('lesson revocation is state-safe and cannot be used as a promotion shortcut', async () => {
  const lessonMission = mission(A);
  await executeMission(lessonMission.id, 'test');
  const lesson = listLessons(A).find((entry) => entry.missionId === lessonMission.id)!;
  assert.ok(lesson);
  assert.throws(() => revokeLesson(A, lesson.id, 'admin', 'not promoted'), /Only a promoted lesson/);
  evaluateLesson(A, lesson.id, 'operator');
  const promoted = promoteLesson(A, lesson.id, 'operator');
  const revoked = revokeLesson(A, lesson.id, 'admin', 'superseded');
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.memoryId, promoted.memoryId);
  assert.throws(() => revokeLesson(A, lesson.id, 'admin', 'again'), /Only a promoted lesson/);
});

test('secret-shaped output is redacted from mission views, evidence, verification and artifacts', async () => {
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const secretMission = createMission({
    workspaceId: A,
    objective: `Summarize this incident note: token ${token} and keep the summary.`,
    actor: 'test',
  });
  await executeMission(secretMission, 'test');
  const detail = getMissionDetail(A, secretMission)!;
  assert.ok(detail);
  assert.ok(!JSON.stringify(detail).includes(token), 'mission detail leaked the token');
  const runs = getOsDb().prepare('SELECT evidence, issues, summary FROM os_runs WHERE mission_id = ?').all(secretMission) as Array<Record<string, string>>;
  assert.ok(runs.length > 0);
  assert.ok(!JSON.stringify(runs).includes(token), 'persisted run evidence leaked the token');
  const verifications = getOsDb().prepare('SELECT actual_output, evidence, checks, failure_reason FROM os_verifications WHERE mission_id = ?').all(secretMission) as Array<Record<string, string>>;
  assert.ok(verifications.length > 0);
  assert.ok(!JSON.stringify(verifications).includes(token), 'persisted verification leaked the token');
  const artifacts = getOsDb().prepare('SELECT content FROM os_artifacts WHERE mission_id = ?').all(secretMission) as Array<Record<string, string>>;
  assert.ok(artifacts.length > 0);
  assert.ok(!JSON.stringify(artifacts).includes(token), 'persisted artifact leaked the token');
  const audit = getOsDb().prepare('SELECT detail FROM os_audit WHERE workspace_id = ?').all(A) as Array<Record<string, string>>;
  assert.ok(!JSON.stringify(audit).includes(token), 'audit detail leaked the token');
  const approval = createApproval({ workspaceId: A, actionSummary: `token ${token}`, risk: 'high', toolInput: { token }, requestedBy: 'agent' });
  assert.ok(!JSON.stringify(getApproval(A, approval.id)).includes(token), 'approval view leaked the token');
});
