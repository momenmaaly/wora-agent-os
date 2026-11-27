/**
 * WORA OS — dynamic selection, team formation and orchestration scenarios.
 * Real SQLite, real registry, real scheduler and real tools; no mocked ranking.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-selection-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { buildPlan, createMission, executeMission, getMissionDetail, markInterruptedMissions, resumeMission } = await import('./orchestrator.js');
const { getTeamPlan, previewTeam, selectForRequirement, selectReplacement, requirementForTask, recordAgentPerformance, performanceReport } = await import('./selection.js');
const { createAgent, listAgents, deleteAgent, ensureSeedAgents } = await import('./registry.js');
const { getOsDb, newId, nowIso } = await import('./db.js');
const { understandProblem } = await import('./problem.js');

let sequence = 0;
const workspace = () => `sel-ws-${++sequence}`;

before(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });
});

type Spec = { title: string; specialization: string; tool: string; input: Record<string, unknown>; dependsOn?: number[]; acceptance?: string[] };

function syntheticMission(ws: string, objective: string, specs: Spec[]): { missionId: string; ids: string[] } {
  ensureSeedAgents(ws);
  const missionId = createMission({ workspaceId: ws, objective, actor: 'test', track: 'generic' });
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
      .run(id, missionId, ws, index, spec.title, spec.title, spec.specialization,
        JSON.stringify((spec.dependsOn ?? []).map((dep) => ids[dep])),
        JSON.stringify(spec.acceptance ?? ['Output satisfies the deterministic review']),
        spec.tool, JSON.stringify(spec.input), 'selection fixture', ts, ts);
  });
  return { missionId, ids };
}

test('scenario 1 — a simple task selects one agent, not a team', async () => {
  const ws = workspace();
  const plan = buildPlan('inspect my computer and report CPU, memory and disk', 'diagnostics', ws);
  const team = previewTeam(ws, plan, understandProblem({ objective: 'inspect my computer' }));
  assert.equal(team.strategy, 'single_agent');
  assert.equal(team.team.length, 1);
  assert.equal(team.team[0]!.specialization, 'computer_diagnostics');
  assert.ok(team.assignments.every((assignment) => assignment.status === 'assigned'));
});

test('scenario 2 — a multi-specialty plan forms the smallest capable team with dependencies', async () => {
  const ws = workspace();
  const plan = [
    { title: 'Design the API', objective: 'Design API', specialization: 'backend_engineer', tool: null, acceptance: ['API contract documented'], dependsOn: [] },
    { title: 'Build the UI', objective: 'Build UI', specialization: 'frontend_engineer', tool: null, acceptance: ['UI implemented'], dependsOn: [] },
    { title: 'Review security', objective: 'Review security', specialization: 'security_engineer', tool: 'security.scan', acceptance: ['No critical secrets'], dependsOn: [0] },
    { title: 'Test the result', objective: 'Test result', specialization: 'qa_engineer', tool: 'host.exec', acceptance: ['Tests passed'], dependsOn: [1, 2] },
  ];
  const team = previewTeam(ws, plan, understandProblem({ objective: 'build and verify a secure web application' }));
  assert.equal(team.strategy, 'multi_agent');
  assert.equal(team.team.length, 4);
  assert.deepEqual(team.parallelGroups, [[0, 1], [2], [3]]);
  assert.ok(team.decisions.every((decision) => decision.explanation.alternativesConsidered.length > 0));
  assert.ok(team.decisions.some((decision) => decision.requirement.risk === 'high'));
});

test('scenario 3 — independent tasks are placed in one parallel layer', () => {
  const ws = workspace();
  const plan = [
    { title: 'Profile data A', objective: 'A', specialization: 'data_analyst', tool: 'stats.describe', acceptance: ['stats'], dependsOn: [] },
    { title: 'Profile data B', objective: 'B', specialization: 'data_analyst', tool: 'stats.describe', acceptance: ['stats'], dependsOn: [] },
  ];
  const team = previewTeam(ws, plan);
  assert.deepEqual(team.parallelGroups, [[0, 1]]);
  assert.equal(team.team.length, 1, 'the same specialist handles both tasks instead of creating an unnecessary second agent');
});

test('scenario 4 — a dependent task remains in a later layer until its prerequisite is verified', () => {
  const ws = workspace();
  const plan = [
    { title: 'Produce the artifact', objective: 'A', specialization: 'data_analyst', tool: 'stats.describe', acceptance: ['stats'], dependsOn: [] },
    { title: 'Consume the verified artifact', objective: 'B', specialization: 'qa_engineer', tool: 'host.exec', acceptance: ['tests passed'], dependsOn: [0] },
  ];
  const team = previewTeam(ws, plan);
  assert.deepEqual(team.parallelGroups, [[0], [1]]);
  assert.equal(team.assignments[1]!.dependsOn.length, 1);
});

test('scenario 5 — a missing specialist is an explicit capability gap, not a fabricated assignment', () => {
  const ws = workspace();
  const plan = [{ title: 'Design a quantum compiler', objective: 'quantum', specialization: 'quantum_architect', tool: null, acceptance: ['compiler'], dependsOn: [] }];
  const team = previewTeam(ws, plan);
  assert.equal(team.strategy, 'capability_gap');
  assert.equal(team.team.length, 0);
  assert.equal(team.gaps.length, 1);
  assert.equal(team.assignments[0]!.status, 'capability_gap');
  assert.match(team.gaps[0]!.reason, /No eligible agent/);
});

test('scenario 6 — a failed specialist can be replaced by another qualified agent', () => {
  const ws = workspace();
  ensureSeedAgents(ws);
  for (const agent of listAgents(ws, { specialization: 'qa_engineer' })) deleteAgent(ws, agent.id, 'test');
  const first = createAgent({ workspaceId: ws, name: 'QA One', role: 'QA', specialization: 'qa_engineer', actor: 'test' });
  const second = createAgent({ workspaceId: ws, name: 'QA Two', role: 'QA', specialization: 'qa_engineer', actor: 'test' });
  const requirement = requirementForTask({ title: 'Run tests', objective: 'Run tests', specialization: 'qa_engineer', tool: 'host.exec', acceptance: ['Tests passed'], dependsOn: [] }, 0, ws);
  const replacement = selectReplacement(ws, { title: 'Run tests', objective: 'Run tests', specialization: 'qa_engineer', tool: 'host.exec', acceptance: ['Tests passed'], dependsOn: [], agentId: first.id }, 'msn-test', first.id);
  assert.ok(replacement.agent);
  assert.equal(replacement.agent!.id, second.id);
  assert.ok(requirement.requiredPermissions.includes('host:exec'));
});

test('scenario 7 — workload and verified performance change the selected specialist', () => {
  const ws = workspace();
  ensureSeedAgents(ws);
  for (const agent of listAgents(ws, { specialization: 'data_analyst' })) deleteAgent(ws, agent.id, 'test');
  const busy = createAgent({ workspaceId: ws, name: 'Data Busy', role: 'Analyst', specialization: 'data_analyst', actor: 'test' });
  const fresh = createAgent({ workspaceId: ws, name: 'Data Fresh', role: 'Analyst', specialization: 'data_analyst', actor: 'test' });
  const missionId = createMission({ workspaceId: ws, objective: 'inspect my computer', actor: 'test', track: 'generic' });
  const db = getOsDb();
  const task = db.prepare('SELECT id FROM os_tasks WHERE mission_id = ? LIMIT 1').get(missionId) as { id: string };
  db.prepare("UPDATE os_tasks SET agent_id = ?, status = 'running' WHERE id = ?").run(busy.id, task.id);
  recordAgentPerformance({ workspaceId: ws, agentId: busy.id, taskCategory: 'data_analyst', result: 'failed', durationMs: 100 });
  recordAgentPerformance({ workspaceId: ws, agentId: fresh.id, taskCategory: 'data_analyst', result: 'passed', durationMs: 90 });
  const requirement = requirementForTask({ title: 'Analyze data', objective: 'Analyze', specialization: 'data_analyst', tool: 'stats.describe', acceptance: ['stats'], dependsOn: [] }, 0, ws);
  const decision = selectForRequirement(ws, requirement);
  assert.equal(decision.selectedAgentId, fresh.id);
  const busyCandidate = decision.candidates.find((candidate) => candidate.agentId === busy.id)!;
  assert.equal(busyCandidate.metrics.workload, 1);
  assert.ok(busyCandidate.metrics.successRate < 0.5);
});

test('scenario 8 — an agent lacking the required authorization is rejected, not used', () => {
  const ws = workspace();
  ensureSeedAgents(ws);
  for (const agent of listAgents(ws, { specialization: 'qa_engineer' })) deleteAgent(ws, agent.id, 'test');
  createAgent({ workspaceId: ws, name: 'Unprivileged QA', role: 'QA', specialization: 'qa_engineer', tools: ['host.exec'], permissions: [], actor: 'test' });
  const requirement = requirementForTask({ title: 'Run tests', objective: 'Run tests', specialization: 'qa_engineer', tool: 'host.exec', acceptance: ['Tests passed'], dependsOn: [] }, 0, ws);
  const decision = selectForRequirement(ws, requirement);
  assert.equal(decision.selectedAgentId, null);
  assert.match(decision.gap!, /missing permissions: host:exec/);
});

test('scenario 9 — an unverified output does not mark the mission completed', async () => {
  const ws = workspace();
  const { missionId } = syntheticMission(ws, 'Produce an invalid assignment result for verification', [
    { title: 'Produce invalid assignment', specialization: 'operations_research', tool: 'or.assignment', input: { costMatrix: [] }, acceptance: ['Valid assignment'] },
  ]);
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(ws, missionId)!;
  assert.notEqual(detail.status, 'completed');
  assert.equal(detail.tasks[0]!.status, 'failed');
  assert.ok(detail.verifications.some((record) => record.result === 'failed'));
});

test('scenario 10 — interrupted work is recoverable without losing completed tasks', async () => {
  const ws = workspace();
  const { missionId } = syntheticMission(ws, 'Run two independent statistics tasks', [
    { title: 'Stats one', specialization: 'data_analyst', tool: 'stats.describe', input: { series: [1, 2, 3] }, acceptance: ['Statistics returned'] },
    { title: 'Stats two', specialization: 'data_analyst', tool: 'stats.describe', input: { series: [4, 5, 6] }, acceptance: ['Statistics returned'] },
  ]);
  await executeMission(missionId, 'test', { concurrency: 2 });
  assert.equal(getMissionDetail(ws, missionId)!.status, 'completed');
  markInterruptedMissions(ws);
  assert.ok(getMissionDetail(ws, missionId)!.status === 'completed');
  assert.equal(resumeMission(ws, missionId, 'test'), false, 'a completed mission cannot be resumed');
});

test('scenario 11 — a sensitive operation stays blocked until a payload-bound approval is granted', async () => {
  const ws = workspace();
  const { missionId } = syntheticMission(ws, 'Run the allowlisted test suite', [
    { title: 'Run allowlisted tests', specialization: 'qa_engineer', tool: 'host.exec', input: { command: 'node', args: ['--test', 'missing.test.mjs'] }, acceptance: ['Tests passed'] },
  ]);
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(ws, missionId)!;
  assert.equal(detail.status, 'awaiting_approval');
  assert.equal(detail.tasks[0]!.status, 'blocked');
  assert.equal(detail.approvals[0]!.status, 'pending');
});

test('scenario 12 — verified performance learning changes suitability for a task category', () => {
  const ws = workspace();
  ensureSeedAgents(ws);
  for (const agent of listAgents(ws, { specialization: 'security_engineer' })) deleteAgent(ws, agent.id, 'test');
  const reliable = createAgent({ workspaceId: ws, name: 'Security Reliable', role: 'Security', specialization: 'security_engineer', actor: 'test' });
  const failing = createAgent({ workspaceId: ws, name: 'Security Failing', role: 'Security', specialization: 'security_engineer', actor: 'test' });
  for (let index = 0; index < 3; index += 1) recordAgentPerformance({ workspaceId: ws, agentId: reliable.id, taskCategory: 'security_engineer', result: 'passed', durationMs: 100 });
  for (let index = 0; index < 3; index += 1) recordAgentPerformance({ workspaceId: ws, agentId: failing.id, taskCategory: 'security_engineer', result: 'failed', durationMs: 100 });
  const requirement = requirementForTask({ title: 'Security review', objective: 'Review', specialization: 'security_engineer', tool: 'security.scan', acceptance: ['No secrets'], dependsOn: [] }, 0, ws);
  const decision = selectForRequirement(ws, requirement);
  assert.equal(decision.selectedAgentId, reliable.id);
  const failingCandidate = decision.candidates.find((candidate) => candidate.agentId === failing.id)!;
  assert.equal(failingCandidate.metrics.successRate, 0);
  assert.ok(performanceReport(ws, failing.id).length === 1);
});
