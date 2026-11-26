/**
 * WORA OS — scientific catalog, method selection and decision-engine tests.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-science-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { listScientificDomains, scientificCatalogSummary, selectScientificMethod, describeScientificSelection } = await import('./science.js');
const { selectAlgorithm } = await import('./algorithms.js');
const { getTool, listTools, runTool } = await import('./tools.js');
const { understandProblem } = await import('./problem.js');
const { compareSolutionStrategies, assessReplan, scoreStrategy } = await import('./decision.js');
const { buildPlan, createMission, getMissionDetail } = await import('./orchestrator.js');
const { listDecisionRecords } = await import('./decision.js');
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
  baseUrl = `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}/api/os`;
});
after(() => { server?.close(); rmSync(TMP, { recursive: true, force: true }); });

test('the scientific map covers all twelve domains with explicit implementation status', () => {
  const domains = listScientificDomains();
  assert.equal(domains.length, 12);
  const statuses = new Set(['implemented', 'partial', 'experimental', 'documented', 'not_implemented']);
  for (const domain of domains) {
    assert.ok(domain.problems.length > 0);
    assert.ok(domain.methods.length > 0);
    assert.ok(domain.requiredInputs.length > 0);
    assert.ok(domain.outputs.length > 0);
    assert.ok(domain.guarantees.length > 0);
    assert.ok(domain.limitations.length > 0);
    assert.ok(domain.verification.length > 0);
    for (const method of domain.methods) {
      assert.ok(statuses.has(method.status), `${domain.id}/${method.id}`);
      if (method.status === 'implemented' && method.toolId) assert.ok(getTool(method.toolId), `missing tool ${method.toolId}`);
    }
    assert.ok(domain.implemented.length > 0, domain.id);
    assert.ok(domain.missing.length > 0, domain.id);
  }
  const summary = scientificCatalogSummary();
  assert.equal(summary.domains, 12);
  assert.ok(summary.implementedMethods > 0);
  assert.ok(summary.missingMethods > 0);
});

test('structured features select a method and explain assumptions and alternatives', () => {
  const selection = selectScientificMethod({
    objective: 'allocate jobs to workers under a linear cost matrix',
    features: { problemType: 'optimization', requires: ['assignment'], hasCostMatrix: true, matrixRows: 3, matrixCols: 3, precision: 'exact' },
  });
  assert.equal(selection.status, 'selected');
  assert.equal(selection.domain, 'operations_research');
  assert.equal(selection.method?.toolId, 'or.assignment');
  assert.equal(selection.method?.status, 'implemented');
  assert.ok(selection.assumptions.length > 0);
  assert.ok(selection.rejectedAlternatives.length > 0);
  assert.equal(selection.gap, null);
});

test('unsupported scientific requirements return an explicit gap, not a substitute', () => {
  const causal = selectScientificMethod({ objective: 'estimate a causal effect', features: { requires: ['causal_analysis'] } });
  assert.equal(causal.status, 'unsupported');
  assert.equal(causal.method, null);
  assert.match(causal.gap?.reason ?? '', /causal inference/i);
  assert.match(causal.gap?.suggestedNextStep ?? '', /tested implementation|authorized tool/i);

  const missingTool = selectScientificMethod({ objective: 'forecast demand', features: { hasTimeSeries: true, availableTools: [] } });
  assert.equal(missingTool.status, 'unsupported');
  assert.match(missingTool.gap?.reason ?? '', /not available/i);
});

test('decision comparison scores real plan and method candidates', () => {
  const objective = 'Optimize the allocation of 20 employees across 5 shifts. The schedule must respect availability and stay within budget. Success is a feasible schedule with verified demand coverage.';
  const profile = understandProblem({ objective });
  const plan = buildPlan(objective, 'optimization', WS);
  const decision = compareSolutionStrategies(plan, WS, profile);
  assert.equal(decision.plans.length, 2);
  assert.ok(decision.preferredPlan.score > 0);
  assert.ok(decision.methods.length >= 1);
  assert.ok(decision.preferredMethod);
  assert.equal(decision.executionShape, 'mathematical_solver');
  assert.ok(decision.smallestCapableTeam >= 1);
  assert.equal(decision.preferredMethod?.algorithmId, 'highs-employee-scheduling');
  assert.match(decision.reason, /highest-scoring|no executable scientific method/);
  assert.ok(decision.replanConditions.length > 0);
  assert.equal(scoreStrategy(decision.preferredPlan.metrics), decision.preferredPlan.score);
});

test('replan assessment only changes course with evidence or a changed condition', () => {
  assert.equal(assessReplan({ failureCategory: 'verification_failed' }).shouldReplan, false);
  assert.equal(assessReplan({ failureCategory: 'verification_failed' }).action, 'retry');
  assert.equal(assessReplan({ methodFailed: true, alternativesAvailable: true }).action, 'replan');
  assert.equal(assessReplan({ toolUnavailable: true, alternativesAvailable: false }).action, 'stop');
  assert.equal(assessReplan({ previousReplans: 2 }).action, 'stop');
  assert.equal(assessReplan({ previousReplans: 2, newEvidence: true, assumptionInvalidated: true }).shouldReplan, true);
  assert.equal(assessReplan({ failureCategory: 'authorization' }).action, 'reassign');
});

test('mission creation persists a decision record and exposes it through the API', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  const detail = getMissionDetail(WS, missionId)!;
  assert.ok(detail.decisions.length >= 1);
  assert.ok(detail.problemProfile?.scientific);
  assert.equal(listDecisionRecords(WS, missionId).length, detail.decisions.length);

  const domains = await fetch(`${baseUrl}/science/domains`);
  assert.equal(domains.status, 200);
  const body = await domains.json() as { domains: unknown[]; implementedMethods: number };
  assert.equal(body.domains.length, 12);
  assert.ok(body.implementedMethods > 0);

  const selected = await fetch(`${baseUrl}/science/select`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ objective: 'forecast demand', features: { hasTimeSeries: true } }),
  });
  assert.equal(selected.status, 200);
  assert.equal(((await selected.json()) as { method?: { toolId?: string } }).method?.toolId, 'forecast.linear');

  const compare = await fetch(`${baseUrl}/decisions/compare`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ objective: 'Optimize employee shifts with a cost matrix and uncertainty', track: 'optimization' }),
  });
  assert.equal(compare.status, 200);
  const comparison = await compare.json() as { decision?: { preferredPlan?: unknown } };
  assert.ok(comparison.decision?.preferredPlan);

  const decisions = await fetch(`${baseUrl}/missions/${missionId}/decisions`);
  assert.equal(decisions.status, 200);
  assert.ok(((await decisions.json()) as { decisions: unknown[] }).decisions.length >= 1);

  const replan = await fetch(`${baseUrl}/decisions/replan-check`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ methodFailed: true, alternativesAvailable: true }),
  });
  assert.equal(replan.status, 200);
  assert.equal(((await replan.json()) as { action: string }).action, 'replan');
});

test('scientific method selection is available as a real registry tool', async () => {
  assert.ok(listTools(WS).some((tool) => tool.id === 'meta.select_scientific_method'));
  const result = await runTool('meta.select_scientific_method', { kind: 'forecasting' }, { workspaceId: WS, actor: 'test', permissions: new Set() });
  assert.equal(result.ok, true);
  assert.equal((result.output as { method?: { toolId?: string } }).method?.toolId, 'forecast.linear');
  const algorithm = selectAlgorithm({ kind: 'forecasting' });
  assert.deepEqual(describeScientificSelection(algorithm).algorithmSelection, algorithm);
});
