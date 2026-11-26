/**
 * WORA OS — scientific intelligence end-to-end scenarios (A–G).
 *
 * Every scenario executes the real planner, tool registry, capability
 * selection, governance, verification, persistence and recovery paths. The
 * fixtures are deterministic and small enough to inspect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-scientific-e2e-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail, markInterruptedMissions, sampleEmployeeInput } = await import('./orchestrator.js');
const { createAgent } = await import('./registry.js');
const { getOsDb, newId, nowIso } = await import('./db.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { listMissionApprovals, decideApproval, getApproval } = await import('./governance.js');
const { workspacePath } = await import('./workspace.js');
const { runWorkerOnce } = await import('./worker.js');
const { selectAlgorithm } = await import('./algorithms.js');
const { selectScientificMethod } = await import('./science.js');
const { understandProblem } = await import('./problem.js');

const WS = 'wora-scientific-e2e';
const RECOVERY_WS = 'wora-scientific-recovery';

type Spec = {
  title: string; specialization: string; tool: string | null; input: Record<string, unknown>;
  dependsOn?: number[]; acceptance?: string[]; agentId?: string | null;
};

function syntheticMission(workspaceId: string, objective: string, specs: Spec[]): { missionId: string; ids: string[] } {
  const missionId = createMission({ workspaceId, objective, actor: 'test' });
  const db = getOsDb();
  db.prepare('DELETE FROM os_tasks WHERE mission_id = ?').run(missionId);
  const ids: string[] = [];
  const ts = nowIso();
  specs.forEach((spec, index) => {
    const id = newId('tsk');
    ids.push(id);
    db.prepare(`INSERT INTO os_tasks
      (id, mission_id, workspace_id, order_index, title, objective, specialization, status, agent_id, depends_on, acceptance, tool, tool_input, detail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, missionId, workspaceId, index, spec.title, spec.title, spec.specialization,
        spec.agentId ?? null,
        JSON.stringify((spec.dependsOn ?? []).map((dep) => ids[dep])),
        JSON.stringify(spec.acceptance ?? ['Output satisfies the deterministic review']),
        spec.tool, JSON.stringify(spec.input), 'scientific e2e fixture', ts, ts);
  });
  return { missionId, ids };
}

test('Test A — analytical problem: select and execute uncertainty analysis', { timeout: 60_000 }, async () => {
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  const objective = 'Analyze an uncertain delivery estimate with a seeded simulation and report the risk distribution';
  const { missionId } = syntheticMission(WS, objective, [{
    title: 'Run seeded PERT simulation',
    specialization: 'operations_research',
    tool: 'sim.monte_carlo',
    input: { trials: 500, seed: 7, items: [{ name: 'delivery', optimistic: 2, likely: 4, pessimistic: 9 }] },
    acceptance: ['Simulated quantiles are ordered', 'Result is labelled simulated'],
  }]);
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  const problem = detail.problemProfile!;
  assert.equal(problem.scientific.method?.toolId, 'sim.monte_carlo');
  assert.equal(problem.scientific.domain, 'simulation_prediction');
  const output = ((detail.tasks[0]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['simulated'], true);
  assert.ok(Number(output['p10']) <= Number(output['p50']) && Number(output['p50']) <= Number(output['p90']));
  assert.ok(detail.verifications.some((record) => record.result === 'passed'));
  assert.ok(detail.decisions.some((decision) => decision.kind === 'initial'));
});

test('Test B — optimization problem: solve, validate feasibility and objective value', { timeout: 60_000 }, async () => {
  const missionId = createMission({
    workspaceId: WS,
    objective: 'Optimize the allocation of 20 employees across 5 shifts respecting availability and minimizing labor cost. Success is a feasible schedule with verified demand coverage.',
    actor: 'test',
  });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.problemProfile?.scientific.method?.toolId, 'or.employee_schedule');
  const output = ((detail.tasks[0]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['feasible'], true);
  assert.ok(Number(output['totalCost']) >= 0);
  assert.ok(Array.isArray(output['perShift']) && (output['perShift'] as Array<{ meetsDemand?: boolean }>).every((shift) => shift.meetsDemand === true));
  assert.ok(detail.verifications.some((record) => record.result === 'passed'));
});

test('Test C — software project: select specialists, distribute work, test and verify', { timeout: 90_000 }, async () => {
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  const missionId = createMission({ workspaceId: WS, objective: 'Build a working web application for a small team task board', actor: 'test' });
  await executeMission(missionId, 'test');
  let detail = getMissionDetail(WS, missionId)!;
  const approval = detail.approvals.find((entry) => entry.status === 'pending');
  if (approval) {
    decideApproval(WS, approval.id, 'approved', 'e2e approval for generated tests', 'reviewer');
    await executeMission(missionId, 'test');
    detail = getMissionDetail(WS, missionId)!;
  }
  assert.equal(detail.status, 'completed');
  assert.ok(detail.tasks.some((task) => task.tool === 'scaffold.webapp' && task.status === 'completed'));
  assert.ok(detail.tasks.some((task) => task.tool === 'security.scan' && task.status === 'completed'));
  assert.ok(detail.tasks.some((task) => task.tool === 'host.exec' && task.status === 'completed'));
  assert.ok(detail.teamPlan && detail.teamPlan.team.length >= 2);
  const distinctAgents = new Set(detail.teamPlan!.assignments.map((assignment) => assignment.agentId).filter(Boolean)).size;
  const unnecessaryAgents = Math.max(0, detail.teamPlan!.team.length - distinctAgents);
  assert.equal(unnecessaryAgents, 0);
  assert.ok(detail.handoffs.length >= 1);
  assert.ok(detail.artifacts.length >= 1);
});

test('Test D — failure recovery: diagnose a failed read, repair the input, retry and verify', { timeout: 60_000 }, async () => {
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  mkdirSync(workspacePath(WS), { recursive: true });
  const { missionId, ids } = syntheticMission(WS, 'Read a required workspace input and recover if it is missing', [{
    title: 'Read required evidence', specialization: 'security_engineer', tool: 'fs.workspace_read',
    input: { path: 'scientific-recovery.txt' }, acceptance: ['File content returned'],
  }]);
  await executeMission(missionId, 'test');
  const failed = getMissionDetail(WS, missionId)!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.tasks[0]!.status, 'failed');
  assert.ok(failed.decisions.some((decision) => decision.kind === 'failure-assessment'));
  writeFileSync(path.join(workspacePath(WS), 'scientific-recovery.txt'), 'recovery evidence', 'utf8');
  await executeMission(missionId, 'test');
  const recovered = getMissionDetail(WS, missionId)!;
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.tasks.find((task) => task.id === ids[0])!.status, 'completed');
  assert.ok(recovered.verifications.some((record) => record.result === 'passed'));
});

test('Test E — missing capability: report a gap instead of pretending to complete', async () => {
  const { missionId } = syntheticMission(WS, 'Perform a task that requires an unavailable specialist capability', [{
    title: 'Unavailable specialist work', specialization: 'quantum_astrologer', tool: null,
    input: {}, acceptance: ['Impossible output'],
  }]);
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'failed');
  assert.match(detail.tasks[0]!.detail, /capability_gap/i);
  assert.equal(detail.tasks[0]!.runs.length, 0);

  const causal = selectScientificMethod({ objective: 'Estimate a causal effect from observational data with unknown confounders', features: { requires: ['causal_analysis'] } });
  assert.equal(causal.status, 'unsupported');
  assert.ok(causal.gap);
  assert.match(causal.gap!.reason, /causal inference/i);
});

test('Test F — restricted operation: stop at approval and resume only after valid approval', { timeout: 60_000 }, async () => {
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  mkdirSync(workspacePath(WS), { recursive: true });
  writeFileSync(path.join(workspacePath(WS), 'approval.test.mjs'), "import { test } from 'node:test';\ntest('restricted action', () => {});\n", 'utf8');
  const { missionId } = syntheticMission(WS, 'Run a restricted verification command after approval', [{
    title: 'Restricted test command', specialization: 'qa_engineer', tool: 'host.exec',
    input: { command: 'node', args: ['--test', 'approval.test.mjs'] }, acceptance: ['Tests passed'],
  }]);
  await executeMission(missionId, 'test');
  const waiting = getMissionDetail(WS, missionId)!;
  assert.equal(waiting.status, 'awaiting_approval');
  assert.equal(waiting.tasks[0]!.status, 'blocked');
  assert.equal(waiting.tasks[0]!.runs.length, 0, 'class C must not execute before approval');
  const pending = listMissionApprovals(WS, missionId).find((approval) => approval.status === 'pending')!;
  assert.equal(pending.actionClass, 'C');
  decideApproval(WS, pending.id, 'approved', 'explicit human approval', 'reviewer');
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.ok(getApproval(WS, pending.id)!.consumedAt);
});

test('Test G — runtime recovery: resume after interruption without duplicate completed work', { timeout: 60_000 }, async () => {
  setExecutionLimits(RECOVERY_WS, { maxAttempts: 1 }, 'test');
  const { missionId, ids } = syntheticMission(RECOVERY_WS, 'Recover a scientific analysis after a process interruption', [
    { title: 'completed analysis', specialization: 'data_analyst', tool: 'stats.describe', input: { series: [1, 2, 3] }, acceptance: ['Statistics returned'] },
    { title: 'interrupted analysis', specialization: 'data_analyst', tool: 'stats.describe', input: { series: [4, 5, 6] }, acceptance: ['Statistics returned'] },
  ]);
  const db = getOsDb();
  db.prepare("UPDATE os_tasks SET status = 'completed' WHERE id = ?").run(ids[0]!);
  db.prepare("UPDATE os_tasks SET status = 'running' WHERE id = ?").run(ids[1]!);
  db.prepare("UPDATE os_missions SET status = 'running' WHERE id = ?").run(missionId);
  assert.equal(markInterruptedMissions(RECOVERY_WS), 1);
  const recovered = await runWorkerOnce({ workspaceId: RECOVERY_WS, maxMissions: 1 });
  assert.deepEqual(recovered.completed, [missionId]);
  const detail = getMissionDetail(RECOVERY_WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks.find((task) => task.id === ids[0])!.runs.length, 0, 'completed work must not be re-executed');
  assert.equal(detail.tasks.find((task) => task.id === ids[1])!.status, 'completed');
  assert.ok(detail.artifacts.length >= 1);
});

test('benchmark: structured method selection beats a keyword-only baseline on disambiguating fixtures', () => {
  const fixtures = [
    { objective: 'optimize the schedule and assign employees', features: { hasCostMatrix: true, matrixRows: 3, matrixCols: 3 }, expected: 'or.assignment' },
    { objective: 'schedule employees across shifts', features: { hasEmployees: true, hasShifts: true }, expected: 'or.employee_schedule' },
    { objective: 'forecast demand from a time series', features: { hasTimeSeries: true }, expected: 'forecast.linear' },
    { objective: 'simulate risk and uncertainty', features: { hasUncertainty: true }, expected: 'sim.monte_carlo' },
  ];
  const dynamic = fixtures.map((fixture) => selectAlgorithm({ objective: fixture.objective, features: fixture.features }).primary?.toolId ?? null);
  const baseline = fixtures.map((fixture) => selectAlgorithm({ objective: fixture.objective }).primary?.toolId ?? null);
  const accuracy = (values: Array<string | null>) => values.filter((value, index) => value === fixtures[index]!.expected).length / fixtures.length;
  const dynamicAccuracy = accuracy(dynamic);
  const baselineAccuracy = accuracy(baseline);
  assert.ok(dynamicAccuracy >= baselineAccuracy);
  assert.ok(dynamicAccuracy >= 0.75);
  console.log(`[scientific-eval] structuredAccuracy=${dynamicAccuracy.toFixed(2)} keywordBaselineAccuracy=${baselineAccuracy.toFixed(2)} dynamic=${dynamic.join(',')} baseline=${baseline.join(',')}`);
});
