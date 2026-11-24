import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-benchmarks-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { listScientificDomains, runBenchmarkSuite, listBenchmarkRuns } = await import('./benchmarks.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;
const WS = 'wora-benchmarks-test';
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

test('the scientific map covers twelve domains with honest gaps', () => {
  const domains = listScientificDomains();
  assert.equal(domains.length, 12);
  for (const domain of domains) {
    assert.ok(domain.domain.length > 0);
    assert.ok(domain.implemented.length > 0);
    assert.ok(domain.missing.length > 0, domain.domain);
  }
});

test('the real benchmark suite passes its fixed fixtures and records limitations', async () => {
  const run = await runBenchmarkSuite(WS);
  assert.equal(run.summary.total, 7);
  assert.equal(run.summary.failed, 0, JSON.stringify(run.results.filter((entry) => !entry.correctness)));
  assert.equal(run.summary.passed, 7);
  for (const entry of run.results) {
    assert.ok(entry.limitations.length > 0, entry.name);
    assert.ok(entry.reference.length > 0, entry.name);
    assert.ok(entry.timeMs >= 0);
  }
  assert.equal(listBenchmarkRuns(WS).length, 1);
});

test('benchmark results are reproducible for correctness, not falsely presented as timing guarantees', async () => {
  const reproWs = 'wora-benchmarks-repro';
  const first = await runBenchmarkSuite(reproWs);
  const second = await runBenchmarkSuite(reproWs);
  assert.deepEqual(first.results.map((entry) => [entry.toolId, entry.correctness]), second.results.map((entry) => [entry.toolId, entry.correctness]));
  assert.equal(listBenchmarkRuns(reproWs).length, 2);
});

test('the domain map and run endpoints are real HTTP endpoints', async () => {
  const domains = await fetch(`${baseUrl}/benchmarks/domains`);
  assert.equal(domains.status, 200);
  assert.equal(((await domains.json()) as unknown[]).length, 12);
  const run = await fetch(`${baseUrl}/benchmarks/run`, { method: 'POST' });
  assert.equal(run.status, 200);
  const body = await run.json() as { summary?: { total?: number; failed?: number } };
  assert.equal(body.summary?.total, 7);
  assert.equal(body.summary?.failed, 0);
});
