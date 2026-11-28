import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
process.env['WORA_OS_DB'] = ':memory:';
process.env['NODE_ENV'] = 'test';
const { getOsDb } = await import('./db.js');
const { createResearchProgram, getResearchProgram, listResearchPrograms, updateResearchProgram, addResearchWorkstream, linkMissionToWorkstream } = await import('./research-program.js');
const WS = 'wora-personal-program-tests';

beforeEach(() => {
  const db = getOsDb();
  db.exec('DELETE FROM os_artifacts; DELETE FROM os_missions; DELETE FROM os_audit;');
});

test('research programs persist append-only versions and list the latest version', () => {
  const created = createResearchProgram({ workspaceId: WS, title: 'WORA Personal R&D', objective: 'Build a reproducible autonomous research system', successCriteria: ['Verified experiments'], actor: 'test' });
  const updated = updateResearchProgram({ workspaceId: WS, programId: created.id, expectedVersion: 1, actor: 'test', patch: { status: 'active' } });
  assert.equal(updated.version, 2);
  assert.equal(getResearchProgram(WS, created.id)?.status, 'active');
  assert.equal(listResearchPrograms(WS)[0]?.version, 2);
  assert.equal(getOsDb().prepare("SELECT COUNT(*) AS count FROM os_artifacts WHERE kind = 'research-program'").get()?.count, 2);
});

test('stale writes are rejected instead of silently overwriting newer program state', () => {
  const created = createResearchProgram({ workspaceId: WS, title: 'Program', objective: 'Objective' });
  updateResearchProgram({ workspaceId: WS, programId: created.id, expectedVersion: 1, patch: { status: 'active' } });
  assert.throws(() => updateResearchProgram({ workspaceId: WS, programId: created.id, expectedVersion: 1, patch: { title: 'Stale' } }), /version conflict/);
});

test('workstreams enforce valid dependencies and preserve explicit deliverables', () => {
  const created = createResearchProgram({ workspaceId: WS, title: 'Program', objective: 'Objective' });
  const first = addResearchWorkstream({ workspaceId: WS, programId: created.id, expectedVersion: 1, workstream: { title: 'Literature review', objective: 'Map prior work', specialization: 'research', deliverables: ['Evidence map'] } });
  const firstId = first.workstreams[0]!.id;
  const second = addResearchWorkstream({ workspaceId: WS, programId: created.id, expectedVersion: 2, workstream: { title: 'Benchmark', objective: 'Test candidate methods', specialization: 'evaluation', dependsOn: [firstId] } });
  assert.deepEqual(second.workstreams[1]!.dependsOn, [firstId]);
  assert.throws(() => addResearchWorkstream({ workspaceId: WS, programId: created.id, expectedVersion: 3, workstream: { title: 'Invalid', objective: 'Invalid dependency', specialization: 'qa', dependsOn: ['missing'] } }), /existing workstream/);
});

test('mission links are workspace-scoped and never create duplicate missions', () => {
  const db = getOsDb();
  const created = createResearchProgram({ workspaceId: WS, title: 'Program', objective: 'Objective' });
  const withStream = addResearchWorkstream({ workspaceId: WS, programId: created.id, expectedVersion: 1, workstream: { title: 'Implementation', objective: 'Build the code', specialization: 'software_engineer' } });
  db.prepare("INSERT INTO os_missions (id, workspace_id, objective, status, created_at, updated_at) VALUES ('mission-a', ?, 'Existing mission', 'planning', datetime('now'), datetime('now'))").run(WS);
  const linked = linkMissionToWorkstream({ workspaceId: WS, programId: created.id, workstreamId: withStream.workstreams[0]!.id, missionId: 'mission-a', expectedVersion: 2 });
  assert.deepEqual(linked.workstreams[0]!.missionIds, ['mission-a']);
  assert.throws(() => linkMissionToWorkstream({ workspaceId: 'other-workspace', programId: created.id, workstreamId: withStream.workstreams[0]!.id, missionId: 'mission-a', expectedVersion: 3 }), /not found/);
});
