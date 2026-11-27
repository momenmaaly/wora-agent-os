/**
 * WORA OS — autonomous adaptive execution recovery experiments.
 *
 * These are real missions through the durable orchestrator, not previews. Each
 * experiment records the initial decision, actual failure evidence, diagnosis,
 * adaptation, re-execution and independent verification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-v22-recovery-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { ensureSeedAgents } = await import('./registry.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { getOsDb, parseJson } = await import('./db.js');
const { verifyIndependently } = await import('./independent-verification.js');

const WS = 'wora-v22-recovery';
ensureSeedAgents(WS);
setExecutionLimits(WS, { maxAttempts: 1, maxConcurrentTasks: 4 }, 'test');

function decisions(missionId: string): Array<{ kind: string; payload?: Record<string, unknown>; reason?: string }> {
  return getMissionDetail(WS, missionId)!.decisions as Array<{ kind: string; payload?: Record<string, unknown>; reason?: string }>;
}

function runEvidence(missionId: string, taskId: string): Array<Record<string, unknown>> {
  const row = getOsDb().prepare("SELECT evidence FROM os_runs WHERE mission_id = ? AND task_id = ? AND status = 'completed' ORDER BY finished_at DESC LIMIT 1").get(missionId, taskId) as { evidence?: string } | undefined;
  return parseJson<Array<Record<string, unknown>>>(row?.evidence ?? '[]', []);
}

test('A — an invalid but detectable formulation fails, is diagnosed, adapts to an equivalent MIP and is independently verified', async () => {
  const objective = 'Assign three candidates to three options with one forbidden pair. Test data: {"costMatrix":[[12,7,9],[8,14,5],[6,9,11]],"forbidden":[{"row":0,"col":1}]}';
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  const initial = getMissionDetail(WS, missionId)!;
  assert.equal(initial.tasks.find((task) => task.tool?.startsWith('or.'))?.tool, 'or.assignment');

  await executeMission(missionId, 'test', { maxAttempts: 1 });
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.outcomeStatus, 'verified');
  assert.equal(detail.tasks.find((task) => task.tool?.startsWith('or.'))?.tool, 'or.solve_lp');

  const kinds = decisions(missionId).map((entry) => entry.kind);
  for (const kind of ['adaptive-method-comparison', 'failure-assessment', 'adaptive-replan', 'adaptive-replan-outcome', 'method-outcome']) {
    assert.ok(kinds.includes(kind), `missing lifecycle record ${kind}; got ${kinds.join(', ')}`);
  }
  const outcomes = decisions(missionId).filter((entry) => entry.kind === 'method-outcome');
  const assignmentOutcome = outcomes.find((entry) => entry.payload?.['tool'] === 'or.assignment');
  const lpOutcome = outcomes.find((entry) => entry.payload?.['tool'] === 'or.solve_lp');
  assert.equal(assignmentOutcome?.payload?.['verificationPassed'], false);
  assert.equal(lpOutcome?.payload?.['verificationPassed'], true);
  const replan = decisions(missionId).find((entry) => entry.kind === 'adaptive-replan');
  assert.equal(replan?.payload?.['fromTool'], 'or.assignment');
  assert.equal(replan?.payload?.['toTool'], 'or.solve_lp');
  assert.ok(replan?.payload?.['planVersion']);
});

test('B — adversarial false success: a tool that reports Optimal with a wrong objective and violated constraint is rejected independently', () => {
  const result = verifyIndependently({
    tool: 'or.solve_lp', toolOk: true,
    toolInput: { sense: 'minimize', objective: [{ var: 'x', coeff: 1 }], constraints: [{ name: 'minimum', terms: [{ var: 'x', coeff: 1 }], op: '>=', rhs: 2 }], bounds: { x: { lower: 0 } } },
    output: { status: 'Optimal', objectiveValue: 999, variables: { x: 1 }, verification: { passed: true }, lp: 'forged' },
  });
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((check) => check.id === 'recompute-lp' && check.status === 'failed'));
  assert.ok(result.failures.some((failure) => /objective-recompute|constraint-1/u.test(failure)));
});

test('C — a mission with missing required inputs reports the gap and never starts the solver', async () => {
  const objective = 'Assign with a malformed matrix {"costMatrix":[[1,2],[3]]}';
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  const plan = getMissionDetail(WS, missionId)!;
  assert.ok(plan.tasks.some((task) => /INPUT GAP/u.test(task.detail ?? '')));
  assert.ok(!plan.tasks.some((task) => task.tool === 'or.assignment' || task.tool === 'or.solve_lp'));
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.outcomeStatus, 'partially_verified');
  const solverRuns = getOsDb().prepare("SELECT COUNT(*) AS c FROM os_tasks WHERE mission_id = ? AND tool IN ('or.assignment','or.solve_lp')").get(missionId) as { c: number };
  assert.equal(Number(solverRuns.c), 0);
});

test('D — a feasible approximate TSP result is accepted without being promoted to optimal', async () => {
  const points = Array.from({ length: 14 }, (_, index) => ({ id: `p${index}`, x: Math.cos(index) * 10, y: Math.sin(index) * 10 }));
  const objective = `Plan a tour over fourteen sites. Test data: ${JSON.stringify({ points, exactLimit: 10 })}`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  const tsp = detail.tasks.find((task) => task.tool === 'routing.tsp');
  assert.ok(tsp);
  const evidence = runEvidence(missionId, tsp!.id);
  const output = evidence.find((entry) => entry['output'] !== undefined)?.['output'] as Record<string, unknown> | undefined;
  assert.equal(output?.['status'], 'approximate');
  assert.equal(output?.['exact'], false);
  assert.notEqual(output?.['status'], 'optimal');
});

test('E — two applicable methods are compared; the exact assignment shape wins before evidence, and its stronger MIP alternative is available', () => {
  const competingWs = 'wora-v22-competing';
  ensureSeedAgents(competingWs);
  setExecutionLimits(competingWs, { maxAttempts: 1 }, 'test');
  const objective = 'Assign three candidates to three options with one forbidden pair. Test data: {"costMatrix":[[12,7,9],[8,14,5],[6,9,11]],"forbidden":[{"row":0,"col":1}]}';
  const missionId = createMission({ workspaceId: competingWs, objective, actor: 'test' });
  const comparison = (getMissionDetail(competingWs, missionId)!.decisions as Array<{ kind: string; payload?: Record<string, unknown> }>).find((entry) => entry.kind === 'adaptive-method-comparison')?.payload as { candidates?: Array<Record<string, unknown>> } | undefined;
  const candidates = comparison?.candidates ?? [];
  const assignment = candidates.find((candidate) => candidate['toolId'] === 'or.assignment');
  const lp = candidates.find((candidate) => candidate['toolId'] === 'or.solve_lp');
  assert.equal(assignment?.['eligible'], true);
  assert.equal(lp?.['eligible'], true);
  assert.ok(Number(assignment?.['score']) > Number(lp?.['score']));
});
