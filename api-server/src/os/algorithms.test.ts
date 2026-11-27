/**
 * WORA OS — algorithm catalog and selection tests.
 *
 * These are unit and route tests over the real implementation. They verify that
 * the catalog only advertises tools that exist, that selection is deterministic,
 * and that unsupported/nonlinear requests fail closed instead of inventing a
 * solver.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-algorithms-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['WORA_EXT_KEY_FILE'] = path.join(TMP, 'ext.key');
process.env['WORA_EXT_BUNDLED_DIR'] = path.join(TMP, 'bundled');
process.env['WORA_EXTENSIONS_LOCAL_ROOTS'] = TMP;
process.env['AUTH_SECRET'] = 'test-secret-0123456789abcdef0123456789abcdef';
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { ALGORITHM_CATALOG_VERSION, PROBLEM_KINDS, listAlgorithms, selectAlgorithm } = await import('./algorithms.js');
const { getTool, runTool } = await import('./tools.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-algorithms-test';
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

test('algorithm catalog only advertises real, resolvable tools', () => {
  const algorithms = listAlgorithms();
  assert.ok(algorithms.length >= 8);
  assert.equal(ALGORITHM_CATALOG_VERSION, '2026-11-27.1');
  const ids = new Set<string>();
  for (const algorithm of algorithms) {
    assert.ok(!ids.has(algorithm.id), `duplicate algorithm id ${algorithm.id}`);
    ids.add(algorithm.id);
    assert.equal(algorithm.maturity === 'tested' || algorithm.maturity === 'tested-baseline', true);
    assert.ok(algorithm.guarantee && algorithm.scientificBasis && algorithm.limitations.length > 0);
    if (algorithm.toolId) {
      const tool = getTool(algorithm.toolId);
      assert.ok(tool, `catalog advertises missing tool ${algorithm.toolId}`);
    }
  }
  for (const kind of PROBLEM_KINDS) {
    assert.ok(algorithms.some((algorithm) => algorithm.problemKinds.includes(kind)), `no algorithm covers ${kind}`);
  }
});

test('explicit assignment kind selects Hungarian and names the missing matrix', () => {
  const result = selectAlgorithm({ kind: 'assignment' });
  assert.equal(result.status, 'selected');
  assert.equal(result.problemKind, 'assignment');
  assert.equal(result.primary?.algorithmId, 'hungarian-assignment');
  assert.equal(result.primary?.toolId, 'or.assignment');
  assert.ok(result.missingInformation.some((item) => /costMatrix/.test(item)));
  assert.ok(result.primary?.verification.some((item) => /totalCost/.test(item)));
});

test('structured features outrank keyword guesses', () => {
  const result = selectAlgorithm({
    objective: 'optimize the schedule and assign employees',
    features: { hasCostMatrix: true, matrixRows: 3, matrixCols: 3 },
  });
  assert.equal(result.problemKind, 'assignment');
  assert.equal(result.confidence, 0.9);
  assert.equal(result.primary?.algorithmId, 'hungarian-assignment');
});

test('employee scheduling selects the dedicated MIP, not generic assignment', () => {
  const result = selectAlgorithm({
    objective: 'schedule 20 employees across five shifts with availability constraints',
    features: { hasEmployees: true, hasShifts: true },
  });
  assert.equal(result.status, 'selected');
  assert.equal(result.problemKind, 'employee_scheduling');
  assert.equal(result.primary?.algorithmId, 'highs-employee-scheduling');
  assert.equal(result.primary?.toolId, 'or.employee_schedule');
  assert.equal(result.missingInformation.length, 0);
});

test('forecasting and decision problems select their implemented baselines', () => {
  const forecast = selectAlgorithm({ objective: 'forecast demand for the next 6 months from the time series' });
  assert.equal(forecast.problemKind, 'forecasting');
  assert.equal(forecast.primary?.toolId, 'forecast.linear');
  assert.match(forecast.warnings.join(' '), /keyword-based/);

  const decision = selectAlgorithm({ objective: 'choose a vendor using weighted criteria and alternatives' });
  assert.equal(decision.problemKind, 'multi_criteria_decision');
  assert.equal(decision.primary?.toolId, 'decision.weighted_matrix');
});

test('unsupported nonlinear problems fail closed, even when a kind is supplied', () => {
  const result = selectAlgorithm({ objective: 'minimize a nonlinear nonconvex objective', features: { nonlinear: true } });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.primary, null);
  assert.match(result.warnings.join(' '), /No nonlinear solver/);
  const explicit = selectAlgorithm({ kind: 'linear_programming', features: { nonlinear: true } });
  assert.equal(explicit.status, 'unsupported');
  assert.equal(explicit.primary, null);
});

test('unknown problems return needs_input without fabricating an algorithm', () => {
  const result = selectAlgorithm({ objective: 'make the thing better somehow' });
  assert.equal(result.status, 'needs_input');
  assert.equal(result.problemKind, 'unknown');
  assert.equal(result.primary, null);
  assert.ok(result.missingInformation.length > 0);
});

test('selection is deterministic and the tool returns the same result', async () => {
  const input = { kind: 'integer_programming' as const, features: { integerVariables: true } };
  const first = selectAlgorithm(input);
  const second = selectAlgorithm(input);
  assert.deepEqual(first, second);
  const toolResult = await runTool('meta.select_algorithm', input, { workspaceId: WS, actor: 'test', permissions: new Set() });
  assert.equal(toolResult.ok, true);
  assert.deepEqual(toolResult.output, first);
});

test('algorithm API exposes the catalog and a real selection', async () => {
  const catalogResponse = await fetch(`${baseUrl}/algorithms`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json() as { catalogVersion: string; algorithms: unknown[] };
  assert.equal(catalog.catalogVersion, ALGORITHM_CATALOG_VERSION);
  assert.ok(catalog.algorithms.length >= 8);

  const response = await fetch(`${baseUrl}/algorithms/select`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'assignment', features: { hasCostMatrix: true, matrixRows: 3, matrixCols: 3 } }),
  });
  assert.equal(response.status, 200);
  const selected = await response.json() as { status: string; primary: { toolId: string } | null };
  assert.equal(selected.status, 'selected');
  assert.equal(selected.primary?.toolId, 'or.assignment');
});
