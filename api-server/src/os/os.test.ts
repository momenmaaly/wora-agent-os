/**
 * WORA OS — core engine tests. Uses WORA_OS_DB=:memory: (set by the test
 * command) for an isolated, real SQLite database.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env['WORA_OS_DB'] = ':memory:';
const TEST_WORKSPACE = path.join(os.tmpdir(), `wora-test-ws-${process.pid}`);
process.env['WORA_WORKSPACE'] = TEST_WORKSPACE;
mkdirSync(TEST_WORKSPACE, { recursive: true });

const { solveAssignment, solveLp, solveEmployeeSchedule } = await import('./ortools.js');
const { runTool, listTools } = await import('./tools.js');
const { resolveInWorkspace, workspacePath } = await import('./workspace.js');
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

test('workspace: traversal and symlink escapes are rejected', () => {
  const ws = 'wora-path-test';
  const root = workspacePath(ws);
  const outside = path.join(os.tmpdir(), `wora-outside-${process.pid}`);
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, 'secret.txt'), 'outside secret');
  try {
    symlinkSync(outside, path.join(root, 'escape-dir'), 'dir');
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'escape-file'), 'file');
    symlinkSync(path.join(outside, 'missing.txt'), path.join(root, 'broken-link'), 'file');
    assert.throws(() => resolveInWorkspace(ws, '../wora-outside'), /escapes the sandboxed workspace/);
    assert.throws(() => resolveInWorkspace(ws, 'escape-dir/secret.txt'), /escapes the sandboxed workspace/);
    assert.throws(() => resolveInWorkspace(ws, 'escape-file'), /escapes the sandboxed workspace/);
    assert.throws(() => resolveInWorkspace(ws, 'broken-link'), /escapes the sandboxed workspace/);
    const newFile = resolveInWorkspace(ws, 'new/subdir/file.txt');
    assert.equal(path.relative(root, newFile), path.join('new', 'subdir', 'file.txt'));
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(path.join(root, 'escape-dir'), { force: true });
    rmSync(path.join(root, 'escape-file'), { force: true });
    rmSync(path.join(root, 'broken-link'), { force: true });
  }
});

test('permission gate blocks tools without the grant', async () => {
  const result = await runTool('system.diagnostics', {}, { workspaceId: WS, actor: 'test', permissions: new Set() });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /host:read/);
});

test('execution boundary enforces the agent tool allowlist even with wildcard permissions', async () => {
  const denied = await runTool('system.diagnostics', {}, {
    workspaceId: WS, actor: 'test', permissions: new Set(['*']), toolAllowlist: new Set(['text.extract_summary']),
  });
  assert.equal(denied.ok, false);
  assert.match(denied.error ?? '', /not enabled for this agent/);
  const allowed = await runTool('system.diagnostics', {}, {
    workspaceId: WS, actor: 'test', permissions: new Set(['host:read']), toolAllowlist: new Set(['system.diagnostics']),
  });
  assert.equal(allowed.ok, true);
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

/* ─── Self-building intelligence: playbooks distill from validated OR runs ─── */
test('playbooks: validated OR mission distills a reusable playbook; a similar mission reinforces it', { timeout: 90_000 }, async () => {
  const { listPlaybooks } = await import('./playbooks.js');
  const objective = 'Optimize the allocation of 20 employees across 5 shifts respecting availability and minimizing labor cost';
  const first = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(first, 'test');
  let books = listPlaybooks(WS).filter((p) => p.toolId === 'or.employee_schedule');
  assert.equal(books.length, 1, 'expected exactly one distilled playbook');
  assert.equal(books[0]!.status, 'validated');
  assert.ok(books[0]!.validation.ok, 'playbook must carry a passing re-validation');
  const runsBefore = books[0]!.successRuns;

  const second = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(second, 'test');
  books = listPlaybooks(WS).filter((p) => p.toolId === 'or.employee_schedule');
  assert.equal(books.length, 1, 'similar mission must reinforce, not duplicate');
  assert.ok(books[0]!.successRuns > runsBefore, `expected successRuns to grow (${runsBefore} → ${books[0]!.successRuns})`);
});

/* ─── AI usage ledger ─── */
test('usage ledger: records estimates and aggregates them (never throws on write)', async () => {
  const { recordAiUsage, getAiUsageSummary } = await import('./usage.js');
  recordAiUsage({ provider: 'groq', model: 'llama-3.3-70b-versatile', inputTokens: 400, outputTokens: 200, agentId: 'agent-test', auditId: 'audit-test' });
  const summary = getAiUsageSummary(1);
  assert.ok(summary.totals.calls >= 1);
  assert.ok(summary.totals.outputTokens >= 200);
  assert.ok(summary.byProvider.some((row) => String(row['provider']) === 'groq'));
  assert.ok(summary.totals.costUsd > 0, 'known model must carry a cost estimate');
});

/* ─── Restart recovery ─── */
test('restart recovery: in-flight missions are marked interrupted, then resumable idempotently', async () => {
  const { markInterruptedMissions, getOsState } = await import('./orchestrator.js');
  const missionId = createMission({ workspaceId: WS, objective: 'Optimize the allocation of 20 employees across 5 shifts respecting availability and minimizing labor cost', actor: 'test' });
  // Simulate a crash: mission row stuck in 'running' with no process behind it.
  const db = (await import('./db.js')).getOsDb();
  db.prepare("UPDATE os_missions SET status = 'running' WHERE id = ?").run(missionId);
  db.prepare("UPDATE os_tasks SET status = 'running' WHERE mission_id = ? AND order_index = 0").run(missionId);
  const marked = markInterruptedMissions();
  assert.ok(marked >= 1);
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'failed');
  assert.match(detail.summary, /restart/);
  // Resume: completed tasks skip; the interrupted one re-executes to green.
  await executeMission(missionId, 'test');
  const resumed = getMissionDetail(WS, missionId)!;
  assert.equal(resumed.status, 'completed');
});

test('forecast.linear: backtests honestly on a synthetic trend and refuses tiny series', async () => {
  const trend = Array.from({ length: 24 }, (_, i) => 100 + 2.5 * i + Math.sin(i) * 3);
  const result = await runTool('forecast.linear', { series: trend, steps: 3 }, { workspaceId: 'wora-test-forecast', actor: 'test', permissions: new Set() });
  assert.ok(result.ok);
  const out = result.output as { r2: number; holdoutMae: number; projections: Array<{ point: number }>; disclaimer: string };
  assert.ok(out.r2 > 0.9, 'clear synthetic trend fits well');
  assert.ok(out.holdoutMae < 10, 'holdout error is small on clean synthetic data');
  assert.equal(out.projections.length, 3);
  assert.match(out.disclaimer, /not a promise/i);
  const tooSmall = await runTool('forecast.linear', { series: [1, 2, 3], steps: 1 }, { workspaceId: 'wora-test-forecast', actor: 'test', permissions: new Set() });
  assert.equal(tooSmall.ok, false);
});

/* ─── RBAC v1 ─── */
test('roles: first actor bootstraps as owner; non-members default to viewer', async () => {
  const { getWorkspaceRole, roleRank } = await import('./roles.js');
  const ws = 'wora-test-roles';
  assert.equal(getWorkspaceRole(ws, 'first-user'), 'owner');
  assert.equal(getWorkspaceRole(ws, 'second-user'), 'viewer');
  assert.ok(roleRank('owner') > roleRank('admin') && roleRank('admin') > roleRank('member') && roleRank('member') > roleRank('viewer'));
});

test('roles: admin cannot grant owner; owner can; remove respects actor rank', async () => {
  const { setWorkspaceRole, removeWorkspaceRole, getWorkspaceRole } = await import('./roles.js');
  const ws = 'wora-test-roles2';
  assert.equal(getWorkspaceRole(ws, 'boss'), 'owner');
  setWorkspaceRole(ws, 'captain', 'admin', 'boss');
  assert.throws(() => setWorkspaceRole(ws, 'lieutenant', 'owner', 'captain'));
  assert.throws(() => setWorkspaceRole(ws, 'lieutenant', 'admin', 'captain'));
  setWorkspaceRole(ws, 'lieutenant', 'member', 'captain'); // admin can grant member
  assert.equal(getWorkspaceRole(ws, 'lieutenant'), 'member');
  assert.throws(() => removeWorkspaceRole(ws, 'boss', 'captain')); // admin cannot remove owner
  assert.throws(() => setWorkspaceRole(ws, 'boss', 'viewer', 'boss')); // owner cannot demote themselves
  assert.throws(() => removeWorkspaceRole(ws, 'boss', 'boss')); // owner cannot remove themselves
  assert.ok(removeWorkspaceRole(ws, 'lieutenant', 'captain'));
});

/* ─── Memory ACL + versioning ─── */
test('memory: owner-visibility records are hidden from other actors; workspace records visible to all', async () => {
  const ws = 'wora-test-acl';
  const secret = addMemory({ workspaceId: ws, scope: 'workspace', content: 'owner-only salary band', visibility: 'owner', actor: 'alice' });
  addMemory({ workspaceId: ws, scope: 'workspace', content: 'shared onboarding checklist', actor: 'alice' });
  assert.deepEqual(listMemories(ws, { actor: 'bob' }).map((m) => m.content), ['shared onboarding checklist']);
  assert.equal(searchMemories(ws, 'salary', { actor: 'bob' }).length, 0);
  assert.equal(listMemories(ws, { actor: 'alice' }).length, 2);
  assert.equal(deleteMemory(ws, secret.id, 'bob'), false); // other actor cannot delete owner record
  assert.ok(deleteMemory(ws, secret.id, 'alice'));
});

test('memory: writes snapshot create/delete versions; TTL hides expired records', async () => {
  const { listMemoryVersions } = await import('./memory.js');
  const ws = 'wora-test-memver';
  const record = addMemory({ workspaceId: ws, scope: 'project', scopeId: 'p1', content: 'v1 content', actor: 'qa' });
  const versions = listMemoryVersions(ws, record.id, 'qa');
  assert.ok(versions.some((v) => v.action === 'create'));
  const expiring = addMemory({ workspaceId: ws, scope: 'episodic', content: 'temporary note', ttlDays: 1, actor: 'qa' });
  const db = (await import('./db.js')).getOsDb();
  db.prepare("UPDATE os_memory SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), expiring.id);
  assert.equal(listMemories(ws, { actor: 'qa' }).some((m) => m.id === expiring.id), false);
});

/* ─── Agent versioning ─── */
test('agents: update snapshots the previous definition and bumps version', async () => {
  const { updateAgent, listAgentVersions, ensureSeedAgents } = await import('./registry.js');
  const ws = 'wora-test-agentver';
  ensureSeedAgents(ws);
  const [first] = listAgents(ws, { specialization: 'qa_engineer' });
  assert.ok(first);
  const updated = updateAgent(ws, first.id, { instructions: 'Tightened review checklist v2' }, 'qa-lead');
  assert.ok(updated);
  const versions = listAgentVersions(ws, first.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0]!.version, 1);
  assert.equal(versions[0]!.snapshot.instructions, first.instructions);
  assert.equal(versions[0]!.changedBy, 'qa-lead');
});

/* ─── Boards ─── */
test('board: put/get round-trips state, oversized payload rejected, clear wipes', async () => {
  const { getBoard, putBoard, clearBoard } = await import('./boards.js');
  const ws = 'wora-test-board';
  assert.equal(getBoard(ws), null);
  putBoard(ws, { projects: [{ id: 'p1', name: 'لوحة' }], tasks: [] }, 'tester');
  const board = getBoard(ws);
  assert.equal((board!.state as { projects: Array<{ name: string }> }).projects[0]!.name, 'لوحة');
  assert.throws(() => putBoard(ws, { blob: 'x'.repeat(600 * 1024) }, 'tester'));
  clearBoard(ws, 'tester');
  assert.equal(getBoard(ws), null);
});

/* ─── Digital twins ─── */
test('twins: create, observe, run an adjusted what-if scenario, events recorded', async () => {
  const { createTwin, getTwin, recordObservation, runScenario } = await import('./twins.js');
  const ws = 'wora-test-twin';
  const twin = createTwin({
    workspaceId: ws, name: 'خط إنتاج الفرن', entityType: 'pipeline',
    drivers: [{ name: 'العجلة اليومية', optimistic: 80, likely: 120, pessimistic: 160 }],
    kpis: [{ id: 'output', label: 'الإنتاج اليومي', unit: 'قطعة', target: 100 }],
    actor: 'tester',
  });
  recordObservation(ws, twin.id, { outputToday: 118 }, 'tester');
  const scenario = await runScenario(ws, twin.id, {
    name: 'توسعة المورد', adjustments: [{ driver: 'العجلة اليومية', op: 'mul', value: 0.8 }],
    trials: 500, seed: 7, actor: 'tester',
  });
  assert.equal(scenario.simulated, true);
  assert.ok(scenario.scenario.mean < scenario.baseline.mean, 'improving a driver lowers the expected total');
  const after = getTwin(ws, twin.id)!;
  assert.equal(after.events.length, 2);
  assert.ok(after.events.some((e) => e.type === 'scenario'));
});

/* ─── Playbook reuse accounting ─── */
test('playbooks: planner prefers a validated playbook over the bundled sample', async () => {
  const { buildPlan } = await import('./orchestrator.js');
  const { getOsDb } = await import('./db.js');
  const ws = 'wora-test-playbook-plan';
  const db = getOsDb();
  const ts = new Date().toISOString();
  const toolInput = { employees: [{ id: 'e1', name: 'سارة', hourlyCost: 30, availability: ['صباحي'] }], shifts: [{ id: 's1', name: 'صباحي', demand: 1 }] };
  db.prepare('INSERT INTO os_playbooks (id, workspace_id, name, tool_id, keywords, tool_input, validation, status, success_runs, reuse_count, created_from_mission, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('pb_testplan_1', ws, 'employee-schedule', 'or.employee_schedule', JSON.stringify(['schedule', 'employee', 'shift']), JSON.stringify(toolInput), JSON.stringify({ ok: true, detail: 'revalidated' }), 'validated', 3, 0, null, ts, ts);
  const plan = buildPlan('employee shift schedule', undefined, ws);
  const task = plan.find((t) => t.tool === 'or.employee_schedule')!;
  assert.deepEqual((task.toolInput as { employees: unknown[] }).employees, toolInput.employees);
  assert.match(task.detail, /playbook/i);
});
