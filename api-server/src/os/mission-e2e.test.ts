/**
 * WORA OS — end-to-end mission scenarios.
 *
 * These run the real planner, scheduler, tools, verification and artifact path.
 * Unsupported domain work is reported as a limitation, never fabricated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-mission-e2e-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail, markInterruptedMissions } = await import('./orchestrator.js');
const { getOsDb, newId, nowIso } = await import('./db.js');
const { ensureSeedAgents } = await import('./registry.js');
const { listMissionApprovals, decideApproval, getApproval } = await import('./governance.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { workspacePath } = await import('./workspace.js');

const WS = 'wora-mission-e2e';

type Spec = {
  title: string; specialization: string; tool: string; input: Record<string, unknown>;
  dependsOn?: number[]; acceptance?: string[];
};

function syntheticMission(objective: string, specs: Spec[]): { missionId: string; ids: string[] } {
  ensureSeedAgents(WS);
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  const db = getOsDb();
  db.prepare('DELETE FROM os_tasks WHERE mission_id = ?').run(missionId);
  const ids: string[] = [];
  const ts = nowIso();
  specs.forEach((spec, index) => {
    const id = newId('tsk');
    ids.push(id);
    db.prepare(`INSERT INTO os_tasks
      (id, mission_id, workspace_id, order_index, title, objective, specialization, status, agent_id, depends_on, acceptance, tool, tool_input, detail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', NULL, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, missionId, WS, index, spec.title, spec.title, spec.specialization,
        JSON.stringify((spec.dependsOn ?? []).map((dep) => ids[dep])),
        JSON.stringify(spec.acceptance ?? ['Output satisfies the deterministic review']),
        spec.tool, JSON.stringify(spec.input), 'e2e fixture', ts, ts);
  });
  return { missionId, ids };
}

function assertArtifactAndVerification(missionId: string): void {
  const detail = getMissionDetail(WS, missionId)!;
  assert.ok(detail.artifacts.length >= 1);
  assert.ok(detail.verifications.length >= 1);
  assert.ok(detail.verifications.every((record) => record.checks.some((check) => check.id === 'artifact-integrity' && check.status === 'passed')));
  assert.equal(detail.planVerification.passed, true, JSON.stringify(detail.planVerification));
}

test('scenario 1: diagnose and validate a generated software project with approval-gated tests', { timeout: 60_000 }, async () => {
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  const { missionId } = syntheticMission('Diagnose and repair a software project by generating it, scanning it and running its tests', [
    { title: 'Generate the project', specialization: 'frontend_engineer', tool: 'scaffold.webapp', input: { name: 'e2e-app', brief: 'small kanban app' }, acceptance: ['Application test suite passed'] },
    { title: 'Scan the generated project', specialization: 'security_engineer', tool: 'security.scan', input: { path: 'apps/e2e-app' }, dependsOn: [0], acceptance: ['No critical secrets found'] },
    { title: 'Run the generated tests', specialization: 'qa_engineer', tool: 'host.exec', input: { command: 'node', args: ['--test', 'apps/e2e-app/test/app.test.mjs'] }, dependsOn: [1], acceptance: ['Tests passed'] },
  ]);
  await executeMission(missionId, 'test');
  const waiting = getMissionDetail(WS, missionId)!;
  assert.equal(waiting.status, 'awaiting_approval');
  const pending = listMissionApprovals(WS, missionId).find((approval) => approval.status === 'pending');
  assert.ok(pending);
  decideApproval(WS, pending.id, 'approved', 'e2e approval', 'reviewer');
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks.find((task) => task.tool === 'host.exec')!.status, 'completed');
  assert.ok(getApproval(WS, pending.id)!.consumedAt);
  assertArtifactAndVerification(missionId);
});

test('scenario 2: build a small application from an idea', { timeout: 60_000 }, async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Build a working web application for a small team task board', actor: 'test' });
  await executeMission(missionId, 'test');
  let detail = getMissionDetail(WS, missionId)!;
  const approval = detail.approvals.find((entry) => entry.status === 'pending');
  if (approval) {
    decideApproval(WS, approval.id, 'approved', 'e2e approval', 'reviewer');
    await executeMission(missionId, 'test');
    detail = getMissionDetail(WS, missionId)!;
  }
  assert.equal(detail.status, 'completed');
  assert.ok(detail.tasks.some((task) => task.tool === 'scaffold.webapp' && task.status === 'completed'));
  assert.ok(detail.handoffs.length >= 1);
  assertArtifactAndVerification(missionId);
});

test('scenario 3: plan and schedule a resource-constrained operation', { timeout: 60_000 }, async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Optimize the allocation of 20 employees across 5 shifts respecting availability and minimizing labor cost', actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.problemProfile?.domain, 'operations_research');
  assert.ok(detail.problemProfile?.algorithmSelection.primary);
  const output = ((detail.tasks[0]!.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['feasible'], true);
  assertArtifactAndVerification(missionId);
});

test('scenario 4: missing information and uncertainty are surfaced instead of invented', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Forecast next quarter demand with incomplete sales data and unknown seasonality', actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.problemProfile?.domain, 'data_intelligence');
  assert.ok((detail.problemProfile?.missingInformation.length ?? 0) > 0);
  assert.ok((detail.problemProfile?.uncertainty.length ?? 0) > 0);
  assert.equal(detail.problemProfile?.source, 'deterministic-rules');
  assert.ok(detail.tasks.length >= 1);
});

test('scenario 5: recover a mission after an interrupted execution', async () => {
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  const { missionId, ids } = syntheticMission('Recover an interrupted mission', [
    { title: 'completed before interruption', specialization: 'data_analyst', tool: 'stats.describe', input: { series: [1, 2, 3] }, acceptance: ['Statistics returned'] },
    { title: 'waiting at interruption', specialization: 'data_analyst', tool: 'stats.describe', input: { series: [4, 5, 6] }, acceptance: ['Statistics returned'] },
  ]);
  getOsDb().prepare("UPDATE os_tasks SET status = 'completed' WHERE id = ?").run(ids[0]!);
  getOsDb().prepare("UPDATE os_tasks SET status = 'running' WHERE id = ?").run(ids[1]!);
  getOsDb().prepare("UPDATE os_missions SET status = 'running' WHERE id = ?").run(missionId);
  markInterruptedMissions();
  assert.equal(getMissionDetail(WS, missionId)!.status, 'failed');
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[0]!.status, 'completed');
  assert.equal(detail.tasks[1]!.status, 'completed');
  assertArtifactAndVerification(missionId);
});

test('scenario 6: a mission requiring explicit human approval never runs the action before approval', { timeout: 30_000 }, async () => {
  const workspace = workspacePath(WS);
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(workspace, 'approval.test.mjs'), "import { test } from 'node:test';\ntest('approved action', () => {});\n", 'utf8');
  const { missionId, ids } = syntheticMission('Run an approval-gated verification command', [{
    title: 'approval-gated test', specialization: 'qa_engineer', tool: 'host.exec',
    input: { command: 'node', args: ['--test', 'approval.test.mjs'] }, acceptance: ['Tests passed'],
  }]);
  await executeMission(missionId, 'test');
  const waiting = getMissionDetail(WS, missionId)!;
  assert.equal(waiting.status, 'awaiting_approval');
  assert.equal(waiting.tasks[0]!.status, 'blocked');
  assert.equal(waiting.tasks[0]!.runs.length, 0, 'the tool must not run before approval');
  const pending = listMissionApprovals(WS, missionId).find((approval) => approval.status === 'pending')!;
  decideApproval(WS, pending.id, 'approved', 'explicit human approval', 'reviewer');
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks.find((task) => task.id === ids[0])!.status, 'completed');
  assert.ok(getApproval(WS, pending.id)!.consumedAt);
  assertArtifactAndVerification(missionId);
});
