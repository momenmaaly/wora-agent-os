/**
 * Phase 8.1 security regressions. These tests exercise the real SQLite-backed
 * services; they are written before the hardening changes to prove the audit
 * findings are reproducible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-phase8-1-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { addMemory, getMemory, deleteMemory, listMemoryVersions, listMemoryRetrievals, listMemories } = await import('./memory.js');
const { modelProblem, filterProblemForActor } = await import('./problem-model.js');
const { SPECIALIZATIONS } = await import('./specializations.js');
const { getTool } = await import('./tools.js');
const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { collectCandidateLessons, evaluateLesson, promoteLesson, recordLessonOutcome } = await import('./lessons.js');
const { setWorkspaceRole } = await import('./roles.js');

const WS = 'phase8-1';

function ownerRecord(actor: string, content: string) {
  return addMemory({ workspaceId: WS, scope: 'workspace', content, visibility: 'owner', actor });
}

test('version history cannot be read by another actor', () => {
  const record = ownerRecord('user', 'owner-version-secret');
  const versions = listMemoryVersions(WS, record.id, 'bob');
  assert.equal(versions, null);
});

test('mission retrieval honors the explicit actor instead of the generic user identity', () => {
  addMemory({ workspaceId: WS, scope: 'workspace', content: 'generic owner private payroll note', visibility: 'owner', actor: 'user' });
  const model = (modelProblem as unknown as (input: Record<string, unknown>) => ReturnType<typeof modelProblem>)({
    workspaceId: WS,
    objective: 'Explain the private payroll note and its implications',
    actor: 'bob',
  });
  assert.ok(!model.evidence.some((entry) => entry.statement.includes('generic owner private')));
});

test('semantic memory cannot self-assign verified status or a verified tag', () => {
  assert.throws(() => addMemory({
    workspaceId: WS, scope: 'semantic', content: 'Arbitrary unverified knowledge', tags: ['verified'], actor: 'member',
  }), /verified/i);
});

test('secret-shaped content is redacted before memory persistence', () => {
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const record = addMemory({ workspaceId: WS, scope: 'workspace', content: `credential ${token}`, actor: 'alice' });
  assert.ok(!record.content.includes(token));
  assert.match(record.content, /REDACTED/i);
});

test('deleting a memory erases its version content', () => {
  const record = ownerRecord('alice', 'delete me and my history');
  assert.equal(deleteMemory(WS, record.id, 'alice'), true);
  assert.equal(listMemoryVersions(WS, record.id, 'alice'), null);
});

test('advertised specialization tools exist in the executable registry', () => {
  const missing = [...new Set(SPECIALIZATIONS.flatMap((specialization) => specialization.tools))]
    .filter((toolId) => !getTool(toolId, WS));
  assert.deepEqual(missing, []);
});

test('lesson outcomes cannot be asserted without a recorded application and resolved mission', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'alice' });
  await executeMission(missionId, 'alice');
  const lessons = collectCandidateLessons(WS, missionId, 'alice');
  assert.ok(lessons.length > 0);
  const tested = evaluateLesson(WS, lessons[0]!.id, 'alice');
  const promoted = promoteLesson(WS, tested.id, 'admin');
  assert.throws(() => (recordLessonOutcome as unknown as (workspaceId: string, lessonId: string, input: Record<string, unknown>, actor: string) => unknown)(WS, promoted.id, { success: true }, 'admin'), /application|evidence/i);
});

test('cross-workspace reads are impossible for records, versions and retrieval snapshots', () => {
  const record = addMemory({ workspaceId: 'phase8-1-a', scope: 'workspace', content: 'cross workspace isolation marker', tags: ['isolation'], actor: 'alice', sourceClass: 'system', knowledgeStatus: 'active' });
  assert.equal(getMemory('phase8-1-b', record.id, 'alice'), null);
  assert.equal(listMemoryVersions('phase8-1-b', record.id, 'alice'), null);
  modelProblem({ workspaceId: 'phase8-1-a', objective: 'cross workspace isolation marker', actor: 'alice' });
  assert.equal(listMemoryRetrievals('phase8-1-b', { actor: 'alice' }).length, 0);
  assert.equal(listMemoryRetrievals('phase8-1-a', { actor: 'alice' })[0]?.selectedIds.includes(record.id), true);
});

test('organization and instance memory writes require reviewed admin/owner roles', () => {
  const ws = 'phase8-1-roles';
  setWorkspaceRole(ws, 'owner', 'owner', 'bootstrap');
  setWorkspaceRole(ws, 'member', 'member', 'owner');
  setWorkspaceRole(ws, 'admin', 'admin', 'owner');
  assert.throws(() => addMemory({ workspaceId: ws, scope: 'organization', content: 'member wrote organization knowledge', actor: 'member' }), /requires admin/i);
  assert.throws(() => addMemory({ workspaceId: ws, scope: 'instance', content: 'admin wrote instance knowledge', actor: 'admin' }), /requires owner/i);
  setWorkspaceRole(ws, 'member', 'admin', 'owner');
  const org = addMemory({ workspaceId: ws, scope: 'organization', content: 'admin reviewed organization knowledge', actor: 'member' });
  assert.equal(org.scope, 'organization');
});

test('owner-scoped user memory is never workspace-visible', () => {
  const record = addMemory({ workspaceId: WS, scope: 'user', content: 'private user-scope note', actor: 'carol' });
  assert.equal(record.visibility, 'owner');
  assert.equal(getMemory(WS, record.id, 'dave'), null);
  assert.ok(!listMemories(WS, { actor: 'dave' }).some((entry) => entry.id === record.id));
});

test('mission detail filters owner evidence for a different actor but keeps it for the owner', () => {
  const ws = 'phase8-1-mission-acl';
  const record = addMemory({ workspaceId: ws, scope: 'workspace', visibility: 'owner', content: 'zebra payroll evidence for owner only', actor: 'alice' });
  const missionId = createMission({ workspaceId: ws, objective: 'Explain zebra payroll evidence and its implications', actor: 'alice' });
  const ownerView = getMissionDetail(ws, missionId, 'alice')!;
  const otherView = getMissionDetail(ws, missionId, 'bob')!;
  assert.ok(ownerView.problemModel!.evidence.some((entry) => entry.memoryId === record.id));
  assert.ok(!otherView.problemModel!.evidence.some((entry) => entry.memoryId === record.id));
  assert.ok(!filterProblemForActor(ownerView.problemModel!, ws, 'bob').evidence.some((entry) => entry.memoryId === record.id));
});

test('lesson outcomes derive success from the terminal mission, not a caller flag', async () => {
  const ws = 'phase8-1-outcome';
  const first = createMission({ workspaceId: ws, objective: 'Inspect my computer and identify potential problems', actor: 'alice' });
  await executeMission(first, 'alice');
  const candidate = collectCandidateLessons(ws, first, 'alice')[0];
  assert.ok(candidate);
  const promoted = promoteLesson(ws, evaluateLesson(ws, candidate.id, 'admin').id, 'admin');
  const failed = createMission({ workspaceId: ws, objective: 'Inspect my computer and identify potential problems again', actor: 'alice' });
  const { getOsDb } = await import('./db.js');
  getOsDb().prepare("UPDATE os_missions SET status = 'failed', outcome_status = 'failed' WHERE workspace_id = ? AND id = ?").run(ws, failed);
  const { recordLessonApplication } = await import('./lessons.js');
  const application = recordLessonApplication(ws, promoted.id, { missionId: failed }, 'alice');
  const outcome = recordLessonOutcome(ws, promoted.id, { applicationId: application.id }, 'alice');
  assert.equal(outcome.successCount, 0);
  assert.equal(outcome.effectiveness, 0);
});
