/**
 * WORA OS — governance enforcement tests.
 *
 * These are adversarial: they attempt replay, payload substitution, scope
 * widening, expiry abuse, budget abuse and direct high-risk tool execution.
 * The expected behavior is always a closed door, never a silent fallback.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-governance-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, getMissionDetail } = await import('./orchestrator.js');
const {
  createApproval, decideApproval, consumeApproval, actionScope, payloadDigest,
  getActionBudget, setActionBudget, requiresHumanApproval, getAutonomyPolicy, setAutonomyPolicy, getApproval,
} = await import('./governance.js');
const { runTool } = await import('./tools.js');
const { getOsDb } = await import('./db.js');

const WS = 'wora-governance-test';

before(() => {
  setAutonomyPolicy(WS, 'balanced', 'test');
});

function taskFixture() {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  const detail = getMissionDetail(WS, missionId)!;
  return { missionId, taskId: detail.tasks[0]!.id };
}

test('approvals are bound to action class, payload digest, scope and expiry', () => {
  const { missionId, taskId } = taskFixture();
  const payload = { command: 'node', args: ['--test', 'test/app.test.mjs'] };
  const scope = actionScope(missionId, taskId, 'host.exec');
  const approval = createApproval({
    workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Run tests',
    risk: 'high', toolInput: payload, requestedBy: 'agent',
  });
  assert.equal(approval.actionClass, 'C');
  assert.equal(approval.scope, scope);
  assert.equal(approval.payloadDigest, payloadDigest(payload));
  assert.ok(approval.expiresAt && Date.parse(approval.expiresAt) > Date.now());
  assert.equal(approval.amountUsd, null);
});

test('payload substitution, scope widening and cross-task replay are rejected', () => {
  const { missionId, taskId } = taskFixture();
  const payload = { command: 'node', args: ['--test', 'test/app.test.mjs'] };
  const scope = actionScope(missionId, taskId, 'host.exec');
  const approval = createApproval({ workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Run tests', risk: 'high', toolInput: payload, requestedBy: 'agent' });
  decideApproval(WS, approval.id, 'approved', 'reviewed', 'reviewer');
  assert.throws(() => consumeApproval(WS, approval.id, {
    payload: { command: 'node', args: ['--test', 'other.test.mjs'] }, scope, actionClass: 'C', actor: 'agent', missionId, taskId,
  }), /payload digest/);
  assert.throws(() => consumeApproval(WS, approval.id, {
    payload, scope: actionScope(missionId, 'another-task', 'host.exec'), actionClass: 'C', actor: 'agent', missionId, taskId,
  }), /scope/);
  assert.throws(() => consumeApproval(WS, approval.id, {
    payload, scope, actionClass: 'B', actor: 'agent', missionId, taskId,
  }), /action class/);
  assert.throws(() => consumeApproval(WS, approval.id, {
    payload, scope, actionClass: 'C', actor: 'agent', missionId: 'another-mission', taskId,
  }), /mission/);
});

test('an approval is single-use and cannot be replayed', () => {
  const { missionId, taskId } = taskFixture();
  const payload = { command: 'node', args: ['--test', 'test/app.test.mjs'] };
  const scope = actionScope(missionId, taskId, 'host.exec');
  const approval = createApproval({ workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Run tests', risk: 'high', toolInput: payload, requestedBy: 'agent' });
  decideApproval(WS, approval.id, 'approved', 'reviewed', 'reviewer');
  const consumed = consumeApproval(WS, approval.id, { payload, scope, actionClass: 'C', actor: 'agent', missionId, taskId });
  assert.ok(consumed.consumedAt);
  assert.throws(() => consumeApproval(WS, approval.id, { payload, scope, actionClass: 'C', actor: 'agent', missionId, taskId }), /already consumed/);
});

test('expired approvals cannot be decided or consumed', () => {
  const { missionId, taskId } = taskFixture();
  const payload = { command: 'node', args: ['--test', 'test/app.test.mjs'] };
  const scope = actionScope(missionId, taskId, 'host.exec');
  const approval = createApproval({ workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Run tests', risk: 'high', toolInput: payload, requestedBy: 'agent' });
  getOsDb().prepare('UPDATE os_approvals SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', approval.id);
  assert.throws(() => decideApproval(WS, approval.id, 'approved', 'late', 'reviewer'), /expired/);
  getOsDb().prepare("UPDATE os_approvals SET status = 'approved' WHERE id = ?").run(approval.id);
  assert.throws(() => consumeApproval(WS, approval.id, { payload, scope, actionClass: 'C', actor: 'agent', missionId, taskId }), /expired/);
});

test('budgets fail closed by default and can be raised explicitly', () => {
  const { missionId, taskId } = taskFixture();
  assert.equal(getActionBudget(WS).maxAmountUsd, 0);
  assert.throws(() => createApproval({
    workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Spend', risk: 'high',
    toolInput: { amountUsd: 5 }, requestedBy: 'agent',
  }), /action budget/);

  setActionBudget(WS, { maxAmountUsd: 100, maxApprovalsPerMission: 1 }, 'admin');
  const allowed = createApproval({
    workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Spend 50', risk: 'high',
    toolInput: { amountUsd: 50 }, requestedBy: 'agent',
  });
  assert.equal(allowed.amountUsd, 50);
  assert.throws(() => createApproval({
    workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Spend 101', risk: 'high',
    toolInput: { amountUsd: 101 }, requestedBy: 'agent',
  }), /action budget/);
  assert.throws(() => createApproval({
    workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Second approval', risk: 'high',
    toolInput: {}, requestedBy: 'agent',
  }), /approval budget/);
});

test('autopilot cannot bypass a high-risk action', () => {
  setAutonomyPolicy(WS, 'autopilot', 'test');
  assert.equal(getAutonomyPolicy(WS), 'autopilot');
  assert.equal(requiresHumanApproval(WS, 'high'), true);
  assert.equal(requiresHumanApproval(WS, 'medium'), false);
  assert.equal(requiresHumanApproval(WS, 'medium', { action: 'Pay', spendsMoney: true }), true);
  setAutonomyPolicy(WS, 'balanced', 'test');
});

test('the tool boundary rejects direct high-risk execution without a valid approval', async () => {
  const { missionId, taskId } = taskFixture();
  const result = await runTool('host.exec', { command: 'node', args: ['--test', 'test/app.test.mjs'] }, {
    workspaceId: WS, actor: 'test', permissions: new Set(['host:exec']), missionId, taskId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'APPROVAL_REQUIRED');
});

test('a class C action is refused at the tool boundary even when the tool itself is low risk', async () => {
  const { missionId, taskId } = taskFixture();
  const result = await runTool('meta.understand_problem', { objective: 'Inspect my computer and identify potential problems' }, {
    workspaceId: WS, actor: 'test', permissions: new Set(), missionId, taskId, actionClass: 'C',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'APPROVAL_REQUIRED');
});

test('canonical digests ignore key order and reject a caller-supplied mismatch', () => {
  assert.equal(payloadDigest({ b: 2, a: { d: 4, c: 3 } }), payloadDigest({ a: { c: 3, d: 4 }, b: 2 }));
  assert.notEqual(payloadDigest({ a: 1 }), payloadDigest({ a: 2 }));
  assert.throws(() => createApproval({
    workspaceId: WS, actionSummary: 'Mismatch', risk: 'high', toolInput: { a: 1 }, payloadDigest: payloadDigest({ a: 2 }), requestedBy: 'agent',
  }), /payload digest/);
});

test('a decision is single-use and a lowered budget blocks an already-approved amount', () => {
  setActionBudget(WS, { maxAmountUsd: 100, maxApprovalsPerMission: 5 }, 'admin');
  const approval = createApproval({
    workspaceId: WS, actionSummary: 'Spend 50', risk: 'high', toolInput: { amountUsd: 50 }, requestedBy: 'agent',
  });
  decideApproval(WS, approval.id, 'approved', 'ok', 'reviewer');
  assert.throws(() => decideApproval(WS, approval.id, 'denied', 'late', 'reviewer'), /already decided/);
  setActionBudget(WS, { maxAmountUsd: 0 }, 'admin');
  assert.throws(() => consumeApproval(WS, approval.id, {
    payload: { amountUsd: 50 }, scope: approval.scope, actionClass: 'C', actor: 'agent',
  }), /current workspace action budget/);
  assert.equal(getApproval(WS, approval.id)!.consumedAt, null);
  setActionBudget(WS, { maxAmountUsd: 100 }, 'admin');
});

test('a valid approval reaches the tool boundary, but a substituted payload does not', async () => {
  const { missionId, taskId } = taskFixture();
  setActionBudget(WS, { maxApprovalsPerMission: 5 }, 'admin');
  const payload = { command: 'node', args: ['--test', 'test/app.test.mjs'] };
  const scope = actionScope(missionId, taskId, 'host.exec');
  const approval = createApproval({ workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Run tests', risk: 'high', toolInput: payload, requestedBy: 'agent' });
  decideApproval(WS, approval.id, 'approved', 'reviewed', 'reviewer');
  const allowed = await runTool('host.exec', payload, {
    workspaceId: WS, actor: 'agent', permissions: new Set(['host:exec']), missionId, taskId,
    approvedAction: { approvalId: approval.id, payloadDigest: approval.payloadDigest, scope: approval.scope },
  });
  assert.notEqual(allowed.code, 'APPROVAL_REQUIRED');
  assert.ok(getApproval(WS, approval.id)!.consumedAt, 'the tool boundary must consume the approval');

  const replay = await runTool('host.exec', payload, {
    workspaceId: WS, actor: 'agent', permissions: new Set(['host:exec']), missionId, taskId,
    approvedAction: { approvalId: approval.id, payloadDigest: approval.payloadDigest, scope: approval.scope },
  });
  assert.equal(replay.code, 'APPROVAL_REQUIRED');

  const second = createApproval({ workspaceId: WS, missionId, taskId, toolId: 'host.exec', actionSummary: 'Run tests again', risk: 'high', toolInput: payload, requestedBy: 'agent' });
  decideApproval(WS, second.id, 'approved', 'reviewed', 'reviewer');
  const substituted = await runTool('host.exec', { command: 'node', args: ['--test', 'other.test.mjs'] }, {
    workspaceId: WS, actor: 'agent', permissions: new Set(['host:exec']), missionId, taskId,
    approvedAction: { approvalId: second.id, payloadDigest: second.payloadDigest, scope: second.scope },
  });
  assert.equal(substituted.code, 'APPROVAL_REQUIRED');
  assert.equal(getApproval(WS, second.id)!.consumedAt, null);
});
