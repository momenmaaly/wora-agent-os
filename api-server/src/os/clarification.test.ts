import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-clarification-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { buildClarificationPlan } = await import('./clarification.js');
const { understandProblem } = await import('./problem.js');
const { buildDeterministicReasoning } = await import('./reasoning-engine.js');
const { createMission, executeMission, getMissionDetail, buildPlan } = await import('./orchestrator.js');

const WS = 'wora-clarification-test';

test('clarification: forecast objective produces a critical data question and no invented series', () => {
  const objective = 'Forecast monthly demand for the next 3 months';
  const problem = understandProblem({ objective });
  const plan = buildPlan(objective, undefined, WS);
  const reasoning = buildDeterministicReasoning({ workspaceId: WS, objective, track: undefined, includeMemory: false, actor: 'test' });
  const clarification = buildClarificationPlan({ problem, reasoning, plan });
  assert.ok(clarification.questions.length > 0);
  assert.ok(clarification.requiresAnswers);
  assert.ok(clarification.questions.some((entry) => entry.code === 'forecast_data' || /forecast|observation|horizon/iu.test(entry.prompt)));
  assert.ok(clarification.questions.every((entry) => entry.blocking === (entry.materiality === 'critical')));
});

test('clarification: answers are recorded as user evidence and drive the real forecast plan', async () => {
  const objective = 'Forecast monthly demand for the next 3 months';
  const missionId = createMission({
    workspaceId: WS,
    objective,
    actor: 'test',
    clarifications: [{ questionId: 'forecast-data', answer: 'series: 10, 12, 13, 15, 14, 16, 18, 19' }],
  });
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.objective, objective, 'the original user objective is preserved');
  assert.ok(detail.tasks.some((task) => task.tool === 'forecast.linear'), 'clarified data must reach the planner');
  const reasoning = detail.reasoning;
  assert.ok(reasoning, 'reasoning model is persisted');
  assert.ok(reasoning!.claims.some((claim) => claim.statement.includes('10, 12, 13, 15, 14, 16, 18, 19')), 'the answer is persisted as a user fact');

  await executeMission(missionId, 'test');
  const executed = getMissionDetail(WS, missionId)!;
  assert.equal(executed.status, 'completed');
  const forecast = executed.tasks.find((task) => task.tool === 'forecast.linear')!;
  assert.equal(forecast.status, 'completed');
  assert.ok(executed.verifications.some((record) => record.result === 'passed'));
});
