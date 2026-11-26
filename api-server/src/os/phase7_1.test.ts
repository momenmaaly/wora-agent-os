/**
 * WORA Phase 7.1 — forecasting reliability and generalization.
 *
 * These tests use the real deterministic structure layer, real mission
 * lifecycle, real tool execution and the real outcome verifier. They do not
 * mock a successful forecast: missing, malformed, conflicting and failed
 * inputs are exercised explicitly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-phase7-1-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
process.env['AUTH_SECRET'] = 'test-secret-0123456789abcdef0123456789abcdef';

const { ensureSeedAgents } = await import('./registry.js');
const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { inferProblemStructure } = await import('./problem-structure.js');
const { buildDeterministicReasoning } = await import('./reasoning-engine.js');
const { evaluateReasoningScenarios } = await import('./reasoning-evaluation.js');
const { evaluateForecastingParaphrases } = await import('./forecasting-evaluation.js');
const { verifyMissionOutcome } = await import('./outcome-verification.js');
const { runTool } = await import('./tools.js');
const { sealTaskToolInput } = await import('../security/task-fields.js');
const { getOsDb, newId } = await import('./db.js');

const WS = 'wora-phase7-1';
const ORIGINAL = 'Project monthly subscription revenue for the next six months from historical totals.';
const READY = 'Predict next month sales from [120, 128, 135, 142, 150, 159, 168, 178].';

test.before(() => ensureSeedAgents(WS));

test('Phase 7.1 A — the original held-out failure is now interpreted as a forecast with missing required inputs', () => {
  const structure = inferProblemStructure(ORIGINAL);
  assert.equal(structure.kind, 'forecasting');
  assert.equal(structure.forecasting?.targetVariable, 'revenue');
  assert.equal(structure.forecasting?.horizon?.steps, 6);
  assert.equal(structure.forecasting?.observations.length, 0);
  assert.equal(structure.forecasting?.canExecute, false);
  assert.ok(structure.forecasting?.missingInputs.some((item) => item.includes('observations')));

  const model = buildDeterministicReasoning({ workspaceId: WS, objective: ORIGINAL });
  assert.equal(model.problemType, 'forecasting');
  assert.equal(model.sufficientToProceed, false);
  assert.ok(model.informationNeeds.some((need) => need.materiality === 'critical' && need.question.includes('observations')));
  assert.ok(model.claims.some((claim) => claim.kind === 'unknown' && claim.statement.includes('Missing forecast input')));
  assert.equal(model.methods.some((method) => method.selected && /linear/iu.test(`${method.id} ${method.name}`)), false);
  assert.notEqual(model.confidence.kind, 'calibrated');
});

test('Phase 7.1 B — forecasting paraphrase development, held-out and negative suites are reported separately', () => {
  const evaluation = evaluateForecastingParaphrases();
  assert.equal(evaluation.development.total, 16);
  assert.equal(evaluation.development.passed, 16);
  assert.equal(evaluation.heldOut.total, 12);
  assert.equal(evaluation.heldOut.passed, 12);
  assert.equal(evaluation.negative.total, 6);
  assert.equal(evaluation.negative.passed, 6);
  assert.deepEqual(evaluation.failures, []);
  assert.ok(evaluation.categories['unseen-revenue-projection']);
});

test('Phase 7.1 C — a valid forecast executes with exactly the supplied observations and a verified calculation', async () => {
  const missionId = createMission({ workspaceId: WS, objective: READY, actor: 'phase7-1' });
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.reasoning?.problemStructure?.forecasting?.canExecute, true);
  assert.equal(detail.tasks.length, 1);
  assert.equal(detail.tasks[0]!.tool, 'forecast.linear');
  assert.deepEqual((detail.tasks[0]!.toolInput as { series: number[] }).series, [120, 128, 135, 142, 150, 159, 168, 178]);
  assert.equal((detail.tasks[0]!.toolInput as { steps: number }).steps, 1);

  await executeMission(missionId, 'phase7-1');
  const done = getMissionDetail(WS, missionId)!;
  assert.equal(done.status, 'completed');
  assert.equal(done.outcomeStatus, 'verified');
  assert.equal(done.outcomeVerification?.checks.some((check) => check.status === 'failed'), false);
  const run = done.tasks[0]!.runs[0] as { evidence?: string | Array<Record<string, unknown>> } | undefined;
  assert.ok(run?.evidence);
  const evidence = (typeof run!.evidence === 'string' ? JSON.parse(run!.evidence) : run!.evidence) as Array<{ output?: { projections?: unknown[]; disclaimer?: string } }>;
  assert.equal(evidence[0]?.output?.projections?.length, 1);
  assert.match(evidence[0]?.output?.disclaimer ?? '', /not a promise/iu);
});

test('Phase 7.1 D — missing forecast data produces an explicit gap and never a verified forecast', async () => {
  const missionId = createMission({ workspaceId: WS, objective: ORIGINAL, actor: 'phase7-1' });
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.tasks.length, 1);
  assert.equal(detail.tasks[0]!.tool, 'text.extract_summary');
  assert.match(detail.tasks[0]!.detail, /FORECAST INPUT GAP/iu);
  assert.doesNotMatch(detail.tasks[0]!.detail, /Bundled SAMPLE|sample roster|\[12, 7, 9\]/u);
  assert.equal(detail.tasks.some((task) => task.tool === 'forecast.linear'), false);

  await executeMission(missionId, 'phase7-1');
  const done = getMissionDetail(WS, missionId)!;
  assert.notEqual(done.outcomeStatus, 'verified');
  assert.equal(done.outcomeStatus, 'partially_verified');
  assert.ok(done.outcomeVerification?.checks.some((check) => check.id === 'required-input-gap' && check.status === 'not_run'));
  assert.equal(done.tasks[0]!.runs.length, 1);
});

test('Phase 7.1 E — insufficient, malformed, conflicting and contradictory inputs are distinguished', () => {
  const malformed = inferProblemStructure('Predict next month sales from series [120, 128, abc, 142, 150, 159, 168, 178].');
  assert.equal(malformed.forecasting?.seriesMalformed, true);
  assert.equal(malformed.forecasting?.observations.length, 0);
  assert.equal(malformed.forecasting?.canExecute, false);

  const tooFew = inferProblemStructure('Predict next month revenue from [10, 12, 14].');
  assert.equal(tooFew.forecasting?.observations.length, 3);
  assert.equal(tooFew.forecasting?.canExecute, false);
  assert.ok(tooFew.forecasting?.missingInputs.some((item) => item.includes('at least 8')));

  const conflicting = inferProblemStructure('Forecast next month sales from [120, 128, 135, 142, 150, 159, 168, 178], but the historical records conflict.');
  assert.equal(conflicting.forecasting?.conflictingRecords, true);
  assert.equal(conflicting.forecasting?.canExecute, false);
  assert.ok(conflicting.forecasting?.missingInputs.some((item) => item.includes('observations')));

  const contradictory = inferProblemStructure('Forecast next month sales from the historical series, but do not use historical data.');
  assert.equal(contradictory.forecasting?.canExecute, false);
  assert.ok(contradictory.forecasting?.missingInputs.some((item) => item.includes('observations')));

  const noHorizon = inferProblemStructure('Project revenue from the historical totals.');
  assert.equal(noHorizon.forecasting?.horizon, null);
  assert.equal(noHorizon.forecasting?.canExecute, false);
  assert.ok(noHorizon.forecasting?.missingInputs.some((item) => item.includes('horizon')));

  const noTarget = inferProblemStructure('Forecast the future.');
  assert.equal(noTarget.forecasting?.targetVariable, null);
  assert.ok(noTarget.forecasting?.missingInputs.some((item) => item.includes('target variable')));
});

test('Phase 7.1 F — misleading forecast-like wording stays in the correct non-forecast class', () => {
  for (const [objective, kind] of [
    ['Calculate the average sales last quarter.', 'descriptive_statistics'],
    ['Describe the trend in monthly sales.', 'trend_analysis'],
    ['Classify customers into segments based on purchase history.', 'classification'],
    ['Simulate three demand scenarios using Monte Carlo.', 'simulation'],
    ['Optimize inventory for next month.', 'optimization'],
    ['Why did sales drop last quarter?', 'root_cause_analysis'],
    ['Build a sales forecasting dashboard.', 'software_engineering'],
  ] as const) {
    const structure = inferProblemStructure(objective);
    assert.equal(structure.kind, kind, objective);
    assert.equal(structure.forecasting, null, objective);
  }
});

test('Phase 7.1 G — a failing forecast tool is not converted into success', async () => {
  const failed = await runTool('forecast.linear', { series: [1, 2], steps: 1 }, { workspaceId: WS, actor: 'phase7-1', permissions: new Set() });
  assert.equal(failed.ok, false);
  assert.ok(failed.error);

  const missionId = createMission({ workspaceId: WS, objective: READY, actor: 'phase7-1' });
  const db = getOsDb();
  const task = db.prepare('SELECT id FROM os_tasks WHERE mission_id = ? ORDER BY order_index LIMIT 1').get(missionId) as { id: string };
  db.prepare('UPDATE os_tasks SET tool_input = ? WHERE id = ?').run(sealTaskToolInput(WS, task.id, { series: [1, 2], steps: 1 }), task.id);
  await executeMission(missionId, 'phase7-1');
  const done = getMissionDetail(WS, missionId)!;
  assert.equal(done.status, 'failed');
  assert.equal(done.outcomeStatus, 'failed');
  assert.ok(done.tasks[0]!.runs.length >= 1);
  assert.ok(done.tasks[0]!.runs.some((runItem) => runItem.status === 'failed' || runItem.status === 'error'));
});

test('Phase 7.1 H — malformed forecast output is rejected by independent outcome verification', async () => {
  const missionId = createMission({ workspaceId: WS, objective: READY, actor: 'phase7-1' });
  await executeMission(missionId, 'phase7-1');
  const db = getOsDb();
  const task = db.prepare('SELECT id FROM os_tasks WHERE mission_id = ? ORDER BY order_index LIMIT 1').get(missionId) as { id: string };
  db.prepare("UPDATE os_runs SET evidence = ? WHERE task_id = ? AND status = 'completed'").run(JSON.stringify([{
    tool: 'forecast.linear', ok: true, output: { projections: [], disclaimer: 'malformed fixture' }, independentChecks: [],
  }]), task.id);
  const verification = verifyMissionOutcome(WS, missionId);
  assert.equal(verification.status, 'failed');
  assert.ok(verification.checks.some((check) => check.id.endsWith('-outcome') && check.status === 'failed'));
});

test('Phase 7.1 I — no cross-domain regression in the Phase 7 development and held-out suites', () => {
  const evaluation = evaluateReasoningScenarios();
  assert.equal(evaluation.development.total, 21);
  assert.equal(evaluation.development.passed, 21);
  assert.equal(evaluation.heldOut.total, 10);
  assert.equal(evaluation.heldOut.passed, 10);
  assert.ok(evaluation.metrics['understanding']!.rate >= 0.9);
  assert.ok(evaluation.metrics['causalReasoning']!.rate >= 0.8);
  assert.ok(evaluation.metrics['methodSelection']!.rate >= 0.9);
});
