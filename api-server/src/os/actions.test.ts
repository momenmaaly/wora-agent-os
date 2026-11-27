/**
 * WORA OS — action classification tests.
 *
 * The classifier is a governance decision, not an execution path. These tests
 * verify escalation rules, fail-closed validation, tool integration and the
 * real HTTP route.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-actions-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['WORA_EXT_KEY_FILE'] = path.join(TMP, 'ext.key');
process.env['WORA_EXT_BUNDLED_DIR'] = path.join(TMP, 'bundled');
process.env['AUTH_SECRET'] = 'test-secret-0123456789abcdef0123456789abcdef';
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { classifyAction, ACTION_SCHEMA_VERSION } = await import('./actions.js');
const { runTool } = await import('./tools.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-actions-test';
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

test('low-risk reversible actions are class A', () => {
  const result = classifyAction({ action: 'Read a workspace file', risk: 'low' });
  assert.equal(result.schemaVersion, ACTION_SCHEMA_VERSION);
  assert.equal(result.class, 'A');
  assert.equal(result.requiresApproval, false);
  assert.equal(result.allowedAutomatically, true);
  assert.equal(result.payloadBinding, 'scope');
});

test('medium-risk or irreversible actions are class B', () => {
  assert.equal(classifyAction({ action: 'Modify a project setting', risk: 'medium' }).class, 'B');
  const irreversible = classifyAction({ action: 'Delete a project', risk: 'low', reversible: false });
  assert.equal(irreversible.class, 'B');
  assert.equal(irreversible.allowedAfterPolicyCheck, true);
  assert.equal(irreversible.requiresApproval, false);
});

test('high-risk, financial and external commitments are class C', () => {
  for (const input of [
    { action: 'Deploy to production', risk: 'high' as const },
    { action: 'Pay an invoice', risk: 'low' as const, spendsMoney: true },
    { action: 'Sign a vendor contract', risk: 'low' as const, externalCommitment: true },
    { action: 'Publish customer data', risk: 'medium' as const, sensitiveData: true },
  ]) {
    const result = classifyAction(input);
    assert.equal(result.class, 'C', input.action);
    assert.equal(result.requiresApproval, true);
    assert.equal(result.allowedAutomatically, false);
    assert.equal(result.payloadBinding, 'exact');
  }
});

test('sensitive low-risk actions require a policy check, not automatic execution', () => {
  const result = classifyAction({ action: 'Read a confidential document', risk: 'low', sensitiveData: true });
  assert.equal(result.class, 'B');
  assert.equal(result.allowedAutomatically, false);
  assert.equal(result.allowedAfterPolicyCheck, true);
});

test('expired authorization is never treated as automatic', () => {
  const result = classifyAction({ action: 'Apply a cached change', risk: 'low', expiresAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(result.class, 'B');
  assert.match(result.reasons.join(' '), /expiry is already in the past/);
});

test('invalid expiry and negative amounts fail closed', () => {
  assert.throws(() => classifyAction({ action: 'x', risk: 'low', expiresAt: 'not-a-date' }), /valid ISO timestamp/);
  assert.throws(() => classifyAction({ action: 'x', risk: 'low', amountUsd: -1 }), /amountUsd/);
});

test('classification is deterministic and exposed as a tool', async () => {
  const input = { action: 'Review a pull request', risk: 'low' as const };
  assert.deepEqual(classifyAction(input), classifyAction(input));
  const toolResult = await runTool('meta.classify_action', input, { workspaceId: WS, actor: 'test', permissions: new Set() });
  assert.equal(toolResult.ok, true);
  assert.deepEqual(toolResult.output, classifyAction(input));
});

test('the action classification API returns a real decision', async () => {
  const response = await fetch(`${baseUrl}/actions/classify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'Transfer funds', risk: 'medium', spendsMoney: true, amountUsd: 250 }),
  });
  assert.equal(response.status, 200);
  const result = await response.json() as { class: string; requiresApproval: boolean; payloadBinding: string };
  assert.equal(result.class, 'C');
  assert.equal(result.requiresApproval, true);
  assert.equal(result.payloadBinding, 'exact');
});
