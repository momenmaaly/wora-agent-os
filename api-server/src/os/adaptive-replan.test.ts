/**
 * WORA OS — controlled adaptive method transitions.
 *
 * The original method genuinely fails because its input contract rejects a
 * side constraint. The orchestrator diagnoses the failure, creates a new plan
 * version and executes an equivalent, implemented MIP formulation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-adaptive-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { getOsDb, newId, nowIso } = await import('./db.js');
const { ensureSeedAgents } = await import('./registry.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { alternativeForTask } = await import('./adaptive-replan.js');

const WS = 'wora-adaptive';
type Spec = { title: string; specialization: string; tool: string; input: Record<string, unknown>; acceptance?: string[] };

function syntheticMission(objective: string, spec: Spec): { missionId: string; taskId: string } {
  ensureSeedAgents(WS);
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  const db = getOsDb();
  db.prepare('DELETE FROM os_tasks WHERE mission_id = ?').run(missionId);
  const taskId = newId('tsk');
  const ts = nowIso();
  db.prepare(`INSERT INTO os_tasks
    (id, mission_id, workspace_id, order_index, title, objective, specialization, status, agent_id, depends_on, acceptance, tool, tool_input, detail, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, ?, 'planned', NULL, '[]', ?, ?, ?, 'adaptive fixture', ?, ?)`)
    .run(taskId, missionId, WS, spec.title, spec.title, spec.specialization,
      JSON.stringify(spec.acceptance ?? ['Output satisfies the deterministic review']),
      spec.tool, JSON.stringify(spec.input), ts, ts);
  return { missionId, taskId };
}

test('assignment failure with a side constraint transitions to an equivalent MIP', async () => {
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  const { missionId } = syntheticMission('Assign three candidates to three options with one forbidden pair', {
    title: 'Assignment with a forbidden pair', specialization: 'operations_research', tool: 'or.assignment',
    input: { costMatrix: [[12, 7, 9], [8, 14, 5], [6, 9, 11]], forbidden: [{ row: 0, col: 1 }] },
    acceptance: ['Optimal assignment found', 'Forbidden pair respected'],
  });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  const task = detail.tasks[0]!;
  assert.equal(task.tool, 'or.solve_lp');
  assert.equal(task.status, 'completed');
  assert.ok(detail.decisions.some((decision) => decision.kind === 'adaptive-replan'));
  assert.ok(detail.planVersions.length >= 2);
  const output = ((task.runs.at(-1)!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['status'], 'Optimal');
  assert.equal(Number(output['objectiveValue']), 26);
  assert.ok(detail.verifications.some((record) => record.result === 'passed'));
});

test('employee scheduling failure with a forbidden pair transitions to an equivalent MIP', async () => {
  setExecutionLimits(WS, { maxAttempts: 1 }, 'test');
  const { missionId } = syntheticMission('Schedule two employees across two shifts with one forbidden pair', {
    title: 'Schedule with a forbidden pair', specialization: 'operations_research', tool: 'or.employee_schedule',
    input: {
      employees: [
        { id: 'e1', name: 'Employee 1', hourlyCost: 10, availability: ['s1', 's2'], maxAssignments: 1 },
        { id: 'e2', name: 'Employee 2', hourlyCost: 12, availability: ['s1', 's2'], maxAssignments: 1 },
      ],
      shifts: [{ id: 's1', name: 'Shift 1', demand: 1 }, { id: 's2', name: 'Shift 2', demand: 1 }],
      forbidden: [{ row: 0, col: 0 }],
    },
    acceptance: ['Feasible schedule', 'Forbidden pair respected'],
  });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  const task = detail.tasks[0]!;
  assert.equal(task.tool, 'or.solve_lp');
  assert.ok(detail.decisions.some((decision) => decision.kind === 'adaptive-replan'));
  const output = ((task.runs.at(-1)!.evidence[0] as unknown) as { output?: Record<string, unknown> }).output!;
  assert.equal(output['status'], 'Optimal');
  assert.equal(Number(output['objectiveValue']), 22);
});

test('no alternative is invented for a method without an implemented equivalent', () => {
  const candidate = alternativeForTask({ tool: 'forecast.linear', toolInput: { series: [1, 2] } });
  assert.equal(candidate, null);
});
