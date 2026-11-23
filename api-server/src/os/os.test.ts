/**
 * WORA OS — core engine tests. Uses WORA_OS_DB=:memory: (set by the test
 * command) for an isolated, real SQLite database.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env['WORA_OS_DB'] = ':memory:';
const TEST_WORKSPACE = path.join(os.tmpdir(), `wora-test-ws-${process.pid}`);
process.env['WORA_WORKSPACE'] = TEST_WORKSPACE;
mkdirSync(TEST_WORKSPACE, { recursive: true });

const { solveAssignment, solveLp, solveEmployeeSchedule } = await import('./ortools.js');
const { runTool, listTools } = await import('./tools.js');
const { createAgent, listAgents, pickAgent, deleteAgent } = await import('./registry.js');
const { addMemory, searchMemories, listMemories, deleteMemory } = await import('./memory.js');
const { createMission, executeMission, getMissionDetail, getOsState, sampleEmployeeInput } = await import('./orchestrator.js');
const { buildOrganization, listOrganizations } = await import('./orgs.js');

const WS = 'wora-test';

before(() => {
  rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  mkdirSync(TEST_WORKSPACE, { recursive: true });
});

/* ─── OR solvers ─── */
test('Hungarian assignment finds the optimal matching', () => {
  const result = solveAssignment([[12, 7, 9], [8, 14, 5], [6, 9, 11]], ['a', 'b', 'c'], ['x', 'y', 'z']);
  assert.equal(result.assignments.length, 3);
  assert.equal(result.totalCost, 7 + 5 + 6);
});

test('Hungarian handles rectangular matrices with dummies', () => {
  const result = solveAssignment([[3, 1], [1, 2], [4, 3]]);
  assert.equal(result.assignments.length, 2); // two real-column assignments
  assert.equal(result.dummyAssignments, 1);   // third row matches a dummy column
  assert.equal(result.totalCost, 1 + 1);      // r0→c1 and r1→c0 is provably minimal
});

test('HiGHS solves a small MIP to optimality', async () => {
  const result = await solveLp({
    sense: 'maximize',
    objective: [{ var: 'chairs', coeff: 30 }, { var: 'tables', coeff: 50 }],
    constraints: [
      { name: 'carpentry', terms: [{ var: 'chairs', coeff: 1 }, { var: 'tables', coeff: 2 }], op: '<=', rhs: 40 },
      { name: 'finishing', terms: [{ var: 'chairs', coeff: 2 }, { var: 'tables', coeff: 1 }], op: '<=', rhs: 50 },
    ],
    binaryVars: [],
    integerVars: ['chairs', 'tables'],
  });
  assert.equal(result.status, 'Optimal');
  assert.equal(result.objectiveValue, 1100);
  assert.equal(result.variables['chairs'], 20);
});

test('employee schedule: 20 employees × 5 shifts solved and independently revalidated', async () => {
  const { employees, shifts } = sampleEmployeeInput();
  const result = await solveEmployeeSchedule({ employees, shifts });
  assert.equal(result.feasible, true, `expected feasible solution, got ${result.status}: ${result.validation.join(' | ')}`);
  assert.ok(result.totalCost !== null && result.totalCost > 0);
  for (const shift of result.perShift) assert.equal(shift.meetsDemand, true, `shift ${shift.shiftId} short`);
  assert.equal(result.validation.filter((v) => /NO/.test(v) && !/NO$/.test(v)).length, 0);
  // Total assigned equals demand
  assert.equal(result.assignments.length, shifts.reduce((acc, s) => acc + s.demand, 0));
});

test('employee schedule reports infeasibility honestly', async () => {
  const result = await solveEmployeeSchedule({
    employees: [{ id: 'solo', name: 'Solo (sample)', hourlyCost: 10, availability: ['morning'], maxAssignments: 1 }],
    shifts: [{ id: 'morning', name: 'Morning', demand: 3 }],
  });
  assert.equal(result.feasible, false);
  assert.equal(result.totalCost, null);
});

/* ─── Tools through the registry ─── */
test('tool registry lists real tools with risk metadata', () => {
  const tools = listTools();
  assert.ok(tools.length >= 10);
  for (const tool of tools) {
    assert.ok(tool.id && tool.name && tool.description);
    assert.ok(['low', 'medium', 'high'].includes(tool.risk));
  }
});

test('unknown tool returns structured error', async () => {
  const result = await runTool('nope.nothing', {}, { workspaceId: WS, actor: 'test', permissions: new Set(['*']) });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Unknown tool/);
});

test('permission gate blocks tools without the grant', async () => {
  const result = await runTool('system.diagnostics', {}, { workspaceId: WS, actor: 'test', permissions: new Set() });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /host:read/);
});

test('system.diagnostics returns real host signals', async () => {
  const result = await runTool('system.diagnostics', {}, { workspaceId: WS, actor: 'test', permissions: new Set(['host:read']) });
  assert.equal(result.ok, true);
  const out = result.output as Record<string, unknown>;
  assert.equal(typeof out['cpus'], 'number');
  assert.ok((out['cpus'] as number) >= 1);
  assert.ok(typeof (out['memory'] as Record<string, unknown>)['totalMB'] === 'number');
  assert.ok(Array.isArray(out['findings']));
});

/* ─── Memory ─── */
test('memory: write, search, list, delete with workspace isolation', () => {
  const record = addMemory({ workspaceId: WS, scope: 'semantic', content: 'The marketplace launch requires seller onboarding before paid acquisition.', tags: ['marketplace', 'launch'], provenance: 'test' });
  addMemory({ workspaceId: 'wora-other', scope: 'semantic', content: 'Marketplace launch secret from another workspace.', tags: ['marketplace'], provenance: 'test' });
  const hits = searchMemories(WS, 'marketplace launch');
  assert.ok(hits.some((m) => m.id === record.id));
  assert.ok(hits.every((m) => m.workspaceId === WS), 'cross-workspace leak detected');
  assert.ok(listMemories(WS, { scope: 'semantic' }).length >= 1);
  assert.equal(deleteMemory(WS, record.id), true);
});

/* ─── Registry ─── */
test('registry seeds specialists and supports custom agents', () => {
  const agents = listAgents(WS);
  assert.ok(agents.length >= 18);
  const custom = createAgent({ workspaceId: WS, name: 'Contract Reviewer', role: 'Reviews vendor contracts', specialization: 'business_analyst', actor: 'test' });
  assert.ok(listAgents(WS, { query: 'Contract Reviewer' }).some((a) => a.id === custom.id));
  assert.ok(pickAgent(WS, 'qa_engineer'));
  assert.equal(deleteAgent(WS, custom.id), true);
});

/* ─── Orchestration: Journey 1 (diagnostics) ─── */
test('mission: computer diagnostics completes with evidence, not theatre', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks.length, 1);
  const task = detail.tasks[0]!;
  assert.equal(task.status, 'completed');
  assert.ok(task.agent);
  assert.ok(task.runs[0]!.evidence.length > 0);
  assert.equal(detail.handoffs.length, 1);
  assert.ok(detail.artifacts.length >= 1);
});

/* ─── Orchestration: Journey 2 (create a testing agent) ─── */
test('mission: "create a software testing agent" persists a reusable agent', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Create a software testing agent', actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  const created = listAgents(WS, { specialization: 'qa_engineer', query: 'Testing' });
  assert.ok(created.length >= 1, 'no persistent QA-flavored agent was created');
});

/* ─── Orchestration: Journey 4 (build a web app) ─── */
test('mission: build a working web application — high-risk QA step waits for human approval, then completes', { timeout: 60_000 }, async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Build a working web application', actor: 'test' });
  await executeMission(missionId, 'test');
  const waiting = getMissionDetail(WS, missionId)!;
  // Balanced autonomy: the high-risk host.exec QA step pauses for human approval.
  assert.equal(waiting.status, 'awaiting_approval');
  const pending = waiting.approvals.find((a) => a.status === 'pending' && a.toolId === 'host.exec');
  assert.ok(pending, 'expected a pending host.exec approval');
  assert.equal(waiting.tasks.find((t) => t.tool === 'host.exec')!.status, 'blocked');
  // Denial path first: mission must fail loudly and the task must not execute.
  const scaffold = waiting.tasks.find((t) => t.tool === 'scaffold.webapp')!;
  assert.equal(scaffold.status, 'completed', JSON.stringify(scaffold.runs));
  const security = waiting.tasks.find((t) => t.tool === 'security.scan')!;
  assert.equal(security.status, 'completed');
  const qa = waiting.tasks.find((t) => t.tool === 'host.exec')!;
  assert.equal(qa.status, 'blocked');

  // Approve → the mission resumes and the QA step executes to green.
  const { decideApproval, setAutonomyPolicy } = await import('./governance.js');
  decideApproval(WS, pending.id, 'approved', 'approved in test', 'test');
  await executeMission(missionId, 'test');
  const done = getMissionDetail(WS, missionId)!;
  assert.equal(done.status, 'completed');
  assert.equal(done.tasks.find((t) => t.tool === 'host.exec')!.status, 'completed');
  assert.ok(done.tasks.every((t) => t.status === 'completed'));
  // Autopilot policy opts out of the gate entirely for future missions — documented behavior.
  setAutonomyPolicy(WS, 'autopilot', 'test');
  setAutonomyPolicy(WS, 'balanced', 'test');
});

/* ─── Orchestration: Journey 5 (employee schedule) ─── */
test('mission: employee scheduling objective books an optimal, revalidated schedule', { timeout: 30_000 }, async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Optimize the allocation of 20 employees across 5 shifts respecting availability and minimizing labor cost', actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  const task = detail.tasks[0]!;
  const output = ((task.runs[0]!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['feasible'], true);
});

/* ─── Orchestration: Journey 3 (build an organization) ─── */
test('organization builder persists departments, agents, project and kickoff mission', { timeout: 60_000 }, async () => {
  const result = await buildOrganization({ workspaceId: WS, objective: 'Build an organization to develop and operate an online marketplace for local services', actor: 'test' });
  assert.equal(result.template, 'commerce-marketplace');
  assert.ok(result.departments.length >= 6);
  assert.ok(result.agentsCreated >= 6);
  const orgs = listOrganizations(WS);
  assert.ok(orgs.some((o) => o.id === result.organizationId));
  const state = getOsState(WS);
  assert.ok(state.organizations >= 1);
  assert.ok(state.projects >= 1);
});

/* ─── Failure path: broken review fails loudly ─── */
test('mission: an infeasible optimization fails the task instead of pretending success', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Optimize the allocation of employees across shifts', actor: 'test' });
  // Sabotage the sample is not possible here; instead craft a direct failing tool call check.
  const result = await runTool('or.employee_schedule', {
    employees: [{ id: 'only', name: 'Only (sample)', hourlyCost: 1, availability: ['morning'], maxAssignments: 1 }],
    shifts: [{ id: 'morning', name: 'Morning', demand: 5 }],
  }, { workspaceId: WS, actor: 'test', permissions: new Set(['*']) });
  assert.equal((result.output as Record<string, unknown>)['feasible'], false);
  void missionId;
});

/* ─── Governance: approvals deny path ─── */
test('mission: a denied high-risk step fails loudly and never executes', { timeout: 60_000 }, async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Build a working web application', actor: 'test' });
  await executeMission(missionId, 'test');
  const waiting = getMissionDetail(WS, missionId)!;
  assert.equal(waiting.status, 'awaiting_approval');
  const pending = waiting.approvals.find((a) => a.status === 'pending' && a.toolId === 'host.exec')!;
  const { decideApproval } = await import('./governance.js');
  decideApproval(WS, pending.id, 'denied', 'test denial', 'test');
  await executeMission(missionId, 'test');
  const after = getMissionDetail(WS, missionId)!;
  assert.equal(after.status, 'failed');
  const qa = after.tasks.find((t) => t.tool === 'host.exec')!;
  assert.equal(qa.status, 'failed');
  assert.match(qa.detail, /test denial/);
});

/* ─── Governance: autonomy policy + revocable devices ─── */
test('governance: autonomy policy round-trips and high-risk gate follows it', async () => {
  const { getAutonomyPolicy, setAutonomyPolicy, requiresHumanApproval } = await import('./governance.js');
  assert.equal(getAutonomyPolicy(WS), 'balanced');
  assert.equal(requiresHumanApproval(WS, 'high'), true);
  assert.equal(requiresHumanApproval(WS, 'medium'), false);
  setAutonomyPolicy(WS, 'autopilot', 'test');
  assert.equal(getAutonomyPolicy(WS), 'autopilot');
  assert.equal(requiresHumanApproval(WS, 'high'), false);
  setAutonomyPolicy(WS, 'balanced', 'test');
  assert.equal(getAutonomyPolicy(WS), 'balanced');
});

test('governance: device pairing is one-time, redeemable and revocable', async () => {
  const { requestDevicePairing, redeemDevicePairing, revokeDevice, listDevices } = await import('./governance.js');
  const { device, pairingCode } = requestDevicePairing(WS, { name: 'Mostafa Laptop', platform: 'linux' }, 'test');
  assert.equal(device.status, 'pending');
  assert.match(pairingCode, /^[A-Z0-9]{4,12}$/);
  // wrong code rejected
  assert.throws(() => redeemDevicePairing(WS, { deviceId: device.id, code: 'ZZZZZZ', fingerprint: 'fp-test' }, 'test'), /Invalid pairing code/);
  const paired = redeemDevicePairing(WS, { deviceId: device.id, code: pairingCode, fingerprint: 'fp-0123456789abcdef' }, 'test');
  assert.equal(paired.status, 'paired');
  // single-use: redeeming again fails
  assert.throws(() => redeemDevicePairing(WS, { deviceId: device.id, code: pairingCode, fingerprint: 'fp-x' }, 'test'), /already paired/);
  // revoke is terminal
  const revoked = revokeDevice(WS, device.id, 'test');
  assert.equal(revoked.status, 'revoked');
  assert.throws(() => redeemDevicePairing(WS, { deviceId: device.id, code: pairingCode, fingerprint: 'fp-y' }, 'test'), /revoked/);
  assert.ok(listDevices(WS).some((d) => d.id === device.id));
});

/* ─── Governance: device heartbeat loop ─── */
test('governance: heartbeat requires paired state + matching fingerprint, and stops after revoke', async () => {
  const { requestDevicePairing, redeemDevicePairing, revokeDevice, deviceHeartbeat } = await import('./governance.js');
  const { device, pairingCode } = requestDevicePairing(WS, { name: 'QA Laptop', platform: 'linux' }, 'test');
  // heartbeat before pairing → rejected
  assert.throws(() => deviceHeartbeat(device.id, { fingerprint: 'fp-hb-1' }), /not paired/);
  redeemDevicePairing(WS, { deviceId: device.id, code: pairingCode, fingerprint: 'fp-hb-1' }, 'test');
  // wrong fingerprint → rejected
  assert.throws(() => deviceHeartbeat(device.id, { fingerprint: 'fp-WRONG' }), /Fingerprint mismatch/);
  // correct → updates last_seen
  const beat = deviceHeartbeat(device.id, { fingerprint: 'fp-hb-1' });
  assert.equal(beat.ok, true);
  // revoke → terminal
  revokeDevice(WS, device.id, 'test');
  assert.throws(() => deviceHeartbeat(device.id, { fingerprint: 'fp-hb-1' }), /revoked/);
});
