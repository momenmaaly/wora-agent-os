/**
 * WORA OS — multi-agent execution with real handoffs and reassignment.
 *
 * The first test runs four tasks across three specialists: a frontend build,
 * an independent data task, a dependent security scan, and a downstream read.
 * The second proves an authorization failure is reassigned to a qualified
 * specialist instead of being hidden or bypassed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-multi-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { getOsDb, newId, nowIso } = await import('./db.js');
const { ensureSeedAgents } = await import('./registry.js');
const { createAgent, deleteAgent, listAgents } = await import('./registry.js');
const WS = 'wora-multi';
type Spec = { title: string; specialization: string; tool: string; input: Record<string, unknown>; dependsOn?: number[]; acceptance?: string[]; agentId?: string };

function syntheticMission(workspaceId: string, objective: string, specs: Spec[]): string {
  ensureSeedAgents(workspaceId);
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
        spec.agentId ?? null, JSON.stringify((spec.dependsOn ?? []).map((dep) => ids[dep])),
        JSON.stringify(spec.acceptance ?? ['Output satisfies the deterministic review']),
        spec.tool, JSON.stringify(spec.input), 'multi-agent fixture', ts, ts);
  });
  return missionId;
}

test('four tasks across three specialists produce real evidence and ordered handoffs', async () => {
  const id = syntheticMission(WS, 'Build, scan and inspect a small application with three specialists', [
      { title: 'Build the application', specialization: 'frontend_engineer', tool: 'scaffold.webapp', input: { name: 'multi-agent-app' }, acceptance: ['Files created', 'Tests pass'], dependsOn: [] },
      { title: 'Profile the sample series', specialization: 'data_analyst', tool: 'stats.describe', input: { series: [1, 2, 3, 4, 5] }, acceptance: ['Statistics returned'], dependsOn: [] },
      { title: 'Scan the generated application', specialization: 'security_engineer', tool: 'security.scan', input: { path: 'apps/multi-agent-app' }, acceptance: ['Scan completes with a finding summary'], dependsOn: [0] },
      { title: 'Read the generated server', specialization: 'security_engineer', tool: 'fs.workspace_read', input: { path: 'apps/multi-agent-app/server.mjs' }, acceptance: ['Server source is returned'], dependsOn: [2] },
    ],
  );
  await executeMission(id, 'test', { concurrency: 2 });
  const detail = getMissionDetail(WS, id)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks.length, 4);
  for (const task of detail.tasks) assert.equal(task.status, 'completed', `${task.title} completed`);
  assert.equal(detail.handoffs.length, 4);
  for (const handoff of detail.handoffs) {
    assert.ok((handoff.contract as { evidence: unknown[] }).evidence.length > 0, `${handoff.taskId} carries evidence`);
    assert.equal((handoff.contract as { acceptanceMet: boolean }).acceptanceMet, true);
  }
  const scan = detail.tasks.find((task) => task.tool === 'security.scan')!;
  const read = detail.tasks.find((task) => task.tool === 'fs.workspace_read')!;
  const scanOutput = (scan.runs.at(-1) as unknown as { evidence: Array<{ output: unknown }> }).evidence[0]!.output as { scannedFiles?: number };
  const readOutput = (read.runs.at(-1) as unknown as { evidence: Array<{ output: unknown }> }).evidence[0]!.output as { content?: string };
  assert.ok(Number(scanOutput.scannedFiles) > 0, 'the security scan inspected real generated files');
  assert.match(String(readOutput.content), /createServer|listen/u, 'the downstream task read the generated server');

  const db = getOsDb();
  const order = db.prepare(`SELECT t.id, MIN(r.started_at) AS started, MAX(r.finished_at) AS finished
    FROM os_tasks t LEFT JOIN os_runs r ON r.task_id = t.id
    WHERE t.mission_id = ? GROUP BY t.id`).all(id) as Array<{ id: string; started: string; finished: string }>;
  const byId = new Map(order.map((row) => [row.id, row]));
  const build = detail.tasks.find((task) => task.tool === 'scaffold.webapp')!;
  const scanTask = detail.tasks.find((task) => task.tool === 'security.scan')!;
  const readTask = detail.tasks.find((task) => task.tool === 'fs.workspace_read')!;
  assert.ok(byId.get(scanTask.id)!.started >= byId.get(build.id)!.finished, 'the scan started after the build finished');
  assert.ok(byId.get(readTask.id)!.started >= byId.get(scanTask.id)!.finished, 'the read started after the scan finished');
});

test('a denied specialist is reassigned to a qualified specialist with an audit record', async () => {
  for (const agent of listAgents(WS, { specialization: 'security_engineer' })) deleteAgent(WS, agent.id, 'test');
  const unprivileged = createAgent({
    workspaceId: WS, name: 'Unprivileged Security', role: 'Security reviewer', specialization: 'security_engineer',
    tools: ['fs.workspace_read'], permissions: [], actor: 'test',
  });
  const privileged = createAgent({
    workspaceId: WS, name: 'Privileged Security', role: 'Security reviewer', specialization: 'security_engineer',
    tools: ['fs.workspace_read'], permissions: ['workspace:read'], actor: 'test',
  });
  const id = syntheticMission(WS, 'Read a fixture through the qualified security specialist', [{
    title: 'Read the fixture', specialization: 'security_engineer', tool: 'fs.workspace_read',
    input: { path: 'fixture.txt' }, acceptance: ['Fixture content returned'], dependsOn: [], agentId: unprivileged.id,
  }]);
  const { writeFileSync } = await import('node:fs');
  mkdirSync(path.join(process.env['WORA_WORKSPACE']!, WS), { recursive: true });
  writeFileSync(path.join(process.env['WORA_WORKSPACE']!, WS, 'fixture.txt'), 'fixture', 'utf8');
  await executeMission(id, 'test');
  const detail = getMissionDetail(WS, id)!;
  assert.equal(detail.status, 'completed');
  const task = detail.tasks[0]!;
  assert.equal(task.agentId, privileged.id, JSON.stringify({ unprivileged: unprivileged.id, privileged: privileged.id, taskAgent: task.agentId, runs: task.runs }));
  assert.equal(task.runs.length, 2);
  assert.equal(task.runs[0]!.status, 'failed');
  assert.match(String(task.runs[0]!.issues[0]), /not enabled|denied|authorization|permission/i);
  assert.equal(task.runs[1]!.status, 'completed');
  const decisions = getOsDb().prepare('SELECT kind FROM os_decision_records WHERE mission_id = ?').all(id) as Array<{ kind: string }>;
  assert.ok(decisions.some((decision) => decision.kind === 'authorization-reassignment'));
});

test.after(() => { rmSync(TMP, { recursive: true, force: true }); });
