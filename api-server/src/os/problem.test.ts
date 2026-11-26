/**
 * WORA OS — structured problem understanding tests.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-problem-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { understandProblem, PROBLEM_SCHEMA_VERSION } = await import('./problem.js');
const { createMission, getMissionDetail } = await import('./orchestrator.js');
const { runTool } = await import('./tools.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-problem-test';
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

test('employee scheduling is represented as an operations problem with structured features', () => {
  const profile = understandProblem({
    objective: 'Optimize the allocation of 20 employees across 5 shifts. The schedule must respect availability, stay within the labor budget and produce a feasible assignment.',
  });
  assert.equal(profile.schemaVersion, PROBLEM_SCHEMA_VERSION);
  assert.equal(profile.domain, 'operations_research');
  assert.equal(profile.plannerTrack, 'optimization');
  assert.equal(profile.features.hasEmployees, true);
  assert.equal(profile.features.hasShifts, true);
  assert.ok(profile.constraints.length >= 1);
  assert.equal(profile.algorithmSelection.status, 'selected');
  assert.equal(profile.algorithmSelection.primary?.toolId, 'or.employee_schedule');
  assert.equal(profile.fallback.strategy, 'deterministic-planner');
});

test('software and diagnostics objectives are classified without pretending semantic certainty', () => {
  const software = understandProblem({ objective: 'Build a working web application for customer requests and test it.' });
  assert.equal(software.domain, 'software_engineering');
  assert.equal(software.plannerTrack, 'webapp');
  assert.ok(software.confidence > 0.5);

  const diagnostics = understandProblem({ objective: 'Inspect my computer and identify potential problems.' });
  assert.equal(diagnostics.domain, 'diagnostics');
  assert.equal(diagnostics.plannerTrack, 'diagnostics');
});

test('missing constraints, acceptance criteria and unsupported problems are explicit', () => {
  const vague = understandProblem({ objective: 'Make it better' });
  assert.equal(vague.domain, 'general');
  assert.ok(vague.missingInformation.includes('explicit constraints'));
  assert.ok(vague.missingInformation.includes('acceptance criteria'));
  assert.ok(vague.ambiguity.length >= 1);

  const nonlinear = understandProblem({ objective: 'Solve a non-convex nonlinear optimization problem with unknown constraints.' });
  assert.equal(nonlinear.algorithmSelection.status, 'unsupported');
  assert.equal(nonlinear.algorithmSelection.primary, null);
  assert.ok(nonlinear.ambiguity.some((entry) => /no implemented algorithm/i.test(entry)));
});

test('mission creation persists the structured problem profile', () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Optimize the allocation of 20 employees across 5 shifts respecting availability and minimizing labor cost', actor: 'test' });
  const detail = getMissionDetail(WS, missionId)!;
  assert.ok(detail.problemProfile);
  assert.equal(detail.problemProfile!.domain, 'operations_research');
  assert.equal(detail.problemProfile!.algorithmSelection.status, 'selected');
});

test('the understanding tool and HTTP API return the same real profile', async () => {
  const input = { objective: 'Build a working web application for customer requests.' };
  const toolResult = await runTool('meta.understand_problem', input, { workspaceId: WS, actor: 'test', permissions: new Set() });
  assert.equal(toolResult.ok, true);
  const response = await fetch(`${baseUrl}/problems/understand`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  assert.equal(response.status, 200);
  const api = await response.json() as { domain: string; plannerTrack: string; source: string };
  assert.equal(api.domain, 'software_engineering');
  assert.equal(api.plannerTrack, 'webapp');
  assert.equal(api.source, 'deterministic-rules');
});
