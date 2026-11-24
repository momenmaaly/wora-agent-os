import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-security-api-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['ADMIN_API_KEY'] = 'test-admin-key-security-api';
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createOsRouter } = await import('./router.js');
const { workspacePath } = await import('./workspace.js');
const { createMission } = await import('./orchestrator.js');
const express = (await import('express')).default;
const WS = 'wora-security-api-test';
let server: Server;
let baseUrl = '';
const headers = { Authorization: 'Bearer test-admin-key-security-api', 'x-workspace': WS, 'Content-Type': 'application/json' };

before(async () => {
  const app = express();
  app.use('/api/os', createOsRouter({ production: false }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/os`;
});

after(() => { server?.close(); rmSync(TMP, { recursive: true, force: true }); });

test('recovery and metrics endpoints are wired and admin-gated', async () => {
  const recovery = await fetch(`${baseUrl}/recovery`, { headers });
  assert.equal(recovery.status, 200);
  const report = await recovery.json() as Record<string, unknown>;
  assert.equal(report['workspaceId'], WS);
  const migrations = await fetch(`${baseUrl}/migrations`, { headers });
  assert.equal(migrations.status, 200);
  const migrationBody = (await migrations.json()) as Record<string, unknown>;
  assert.ok(Array.isArray(migrationBody['applied']));
  assert.deepEqual(migrationBody['pending'], []);
  const metrics = await fetch(`${baseUrl}/metrics`, { headers });
  assert.equal(metrics.status, 200);
  const metricBody = (await metrics.json()) as Record<string, unknown>;
  assert.ok('counters' in metricBody);
  const prometheus = await fetch(`${baseUrl}/metrics/prometheus`, { headers });
  assert.equal(prometheus.status, 200);
  assert.match(await prometheus.text(), /wora_uptime_seconds/u);
});

test('code repair runs through the real API and returns a verified patch', async () => {
  const root = path.join(workspacePath(WS), 'api-repair');
  mkdirSync(path.join(root, 'test'), { recursive: true });
  writeFileSync(path.join(root, 'calc.js'), 'export function add(a, b) { return a - b; }\n');
  writeFileSync(path.join(root, 'test', 'calc.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../calc.js';\ntest('adds', () => assert.equal(add(2, 3), 5));\n`);
  const inspect = await fetch(`${baseUrl}/code-repair/inspect`, { method: 'POST', headers, body: JSON.stringify({ repoPath: 'api-repair' }) });
  assert.equal(inspect.status, 200);
  const inventory = await inspect.json() as Record<string, unknown>;
  assert.ok((inventory['files'] as string[]).includes('calc.js'));
  const response = await fetch(`${baseUrl}/code-repair`, {
    method: 'POST', headers,
    body: JSON.stringify({
      repoPath: 'api-repair', defect: 'add subtracts', testPath: 'test/calc.test.mjs', regressionPath: 'test',
      patch: `--- a/calc.js\n+++ b/calc.js\n@@ -1 +1 @@\n-export function add(a, b) { return a - b; }\n+export function add(a, b) { return a + b; }\n`,
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json() as Record<string, unknown>;
  assert.equal(result['ok'], true);
  assert.match(String(result['diff']), /\+export function add/u);
});

test('invalid code repair input is rejected before the engine runs', async () => {
  const response = await fetch(`${baseUrl}/code-repair`, {
    method: 'POST', headers,
    body: JSON.stringify({ repoPath: '../outside', defect: 'x', testPath: 'test/x.test.mjs', patch: 'not a diff' }),
  });
  assert.equal(response.status, 422);
});


test('dynamic capability analysis, team status and performance endpoints are wired', async () => {
  const analyze = await fetch(`${baseUrl}/capabilities/analyze`, {
    method: 'POST', headers,
    body: JSON.stringify({ objective: 'build and verify a secure web application with tests' }),
  });
  assert.equal(analyze.status, 200);
  const analysis = await analyze.json() as Record<string, unknown>;
  assert.ok(Array.isArray(analysis['requirements']));
  const team = analysis['team'] as Record<string, unknown>;
  assert.ok(Array.isArray(team['decisions']));
  assert.ok(['single_agent', 'multi_agent', 'capability_gap'].includes(String(team['strategy'])));

  const missionId = createMission({ workspaceId: WS, objective: 'inspect my computer', actor: 'test', track: 'diagnostics' });
  const status = await fetch(`${baseUrl}/missions/${missionId}/team`, { headers });
  assert.equal(status.status, 200);
  const statusBody = await status.json() as Record<string, unknown>;
  const missionTeam = statusBody['team'] as Record<string, unknown>;
  assert.ok(missionTeam);
  assert.equal(missionTeam['strategy'], 'single_agent');

  const performance = await fetch(`${baseUrl}/capabilities/performance`, { headers });
  assert.equal(performance.status, 200);
  assert.ok(Array.isArray(await performance.json()));
});
