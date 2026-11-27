/**
 * WORA OS — measurable verified-outcome learning.
 *
 * The policy is deterministic history lookup, not machine learning. The test
 * measures a before/after selection change caused only by a verified mission
 * outcome in the same workspace, and proves workspace isolation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-v22-learning-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { ensureSeedAgents } = await import('./registry.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { understandProblem } = await import('./problem.js');
const { selectAdaptiveMethod, methodHistoryFor } = await import('./adaptive-intelligence.js');

const WS = 'wora-v22-learning';
ensureSeedAgents(WS);
setExecutionLimits(WS, { maxAttempts: 1 }, 'test');

const objective = 'Assign three candidates to three options with one forbidden pair. Test data: {"costMatrix":[[12,7,9],[8,14,5],[6,9,11]],"forbidden":[{"row":0,"col":1}]}';
const profile = understandProblem({ objective });

test('a verified adaptation changes the next selection in the same workspace and never leaks to another workspace', async () => {
  const before = selectAdaptiveMethod({ workspaceId: WS, objective, profile });
  assert.equal(before.selected?.toolId, 'or.assignment');
  const beforeCandidates = before.candidates.map((candidate) => [candidate.toolId, candidate.eligible, candidate.score]);
  console.log(`LEARNING_BEFORE ${JSON.stringify({ selected: before.selected?.toolId, candidates: beforeCandidates })}`);

  const first = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(first, 'test', { maxAttempts: 1 });
  const firstDetail = getMissionDetail(WS, first)!;
  assert.equal(firstDetail.status, 'completed');
  assert.equal(firstDetail.outcomeStatus, 'verified');

  const assignmentHistory = methodHistoryFor(WS, 'or.assignment');
  const lpHistory = methodHistoryFor(WS, 'or.solve_lp');
  assert.equal(assignmentHistory.failed, 1);
  assert.equal(assignmentHistory.verified, 0);
  assert.equal(lpHistory.verified, 1);
  assert.equal(lpHistory.failed, 0);

  const after = selectAdaptiveMethod({ workspaceId: WS, objective, profile });
  assert.equal(after.selected?.toolId, 'or.solve_lp');
  const rejectedAssignment = after.candidates.find((candidate) => candidate.toolId === 'or.assignment');
  assert.equal(rejectedAssignment?.eligible, false);
  assert.match(rejectedAssignment?.rejectionReason ?? '', /Workspace history: 1 failed and 0 verified/u);
  console.log(`LEARNING_AFTER ${JSON.stringify({ selected: after.selected?.toolId, candidates: after.candidates.map((candidate) => [candidate.toolId, candidate.eligible, candidate.score]) })}`);

  const second = createMission({ workspaceId: WS, objective, actor: 'test' });
  const secondPlan = getMissionDetail(WS, second)!;
  assert.deepEqual(secondPlan.tasks.map((task) => task.tool), ['meta.formulate_scientific_problem', 'or.solve_lp']);
  assert.ok(!(secondPlan.decisions as Array<{ kind: string }>).some((entry) => entry.kind === 'adaptive-replan'));
  await executeMission(second, 'test', { maxAttempts: 1 });
  const secondDetail = getMissionDetail(WS, second)!;
  assert.equal(secondDetail.status, 'completed');
  assert.equal(secondDetail.outcomeStatus, 'verified');

  const otherWs = 'wora-v22-learning-isolated';
  ensureSeedAgents(otherWs);
  const isolated = selectAdaptiveMethod({ workspaceId: otherWs, objective, profile });
  assert.equal(isolated.selected?.toolId, 'or.assignment');
  assert.equal(methodHistoryFor(otherWs, 'or.assignment').attempts, 0);
  assert.equal(methodHistoryFor(otherWs, 'or.solve_lp').attempts, 0);
});
