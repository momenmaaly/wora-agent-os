import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-lessons-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { createMission, executeMission } = await import('./orchestrator.js');
const { listLessons, collectCandidateLessons, evaluateLesson, promoteLesson, rejectLesson, revokeLesson, recordLessonOutcome, recordLessonApplication, listLessonEvents } = await import('./lessons.js');
const { listMemories } = await import('./memory.js');
const { getOsDb } = await import('./db.js');

const WS = 'wora-lessons-test';

test('a completed verified mission produces candidate lessons, not promoted lessons', async () => {
  const missionId = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems', actor: 'test' });
  await executeMission(missionId, 'test');
  const candidates = listLessons(WS, { status: 'candidate' });
  assert.ok(candidates.length >= 1);
  assert.ok(candidates.every((lesson) => lesson.status === 'candidate'));
  assert.ok(candidates.every((lesson) => lesson.version === 1));
  assert.equal(listMemories(WS, { scope: 'semantic' }).length, 0);
  const recollected = collectCandidateLessons(WS, missionId, 'test');
  assert.ok(recollected.length >= 1);
  assert.equal(new Set(recollected.map((lesson) => lesson.id)).size, recollected.length);
});

test('evaluation is required before promotion, and promotion writes semantic memory', async () => {
  const lesson = listLessons(WS, { status: 'candidate' })[0]!;
  assert.throws(() => promoteLesson(WS, lesson.id, 'operator'), /evaluated/);
  const tested = evaluateLesson(WS, lesson.id, 'operator');
  assert.equal(tested.status, 'tested');
  const promoted = promoteLesson(WS, lesson.id, 'operator');
  assert.equal(promoted.status, 'promoted');
  assert.equal(promoted.version, 2);
  assert.ok(promoted.promotedAt);
  const memory = listMemories(WS, { scope: 'semantic' });
  assert.equal(memory.length, 1);
  assert.equal(memory[0]!.provenance, `lesson:${lesson.id}`);
  assert.throws(() => promoteLesson(WS, lesson.id, 'operator'), /Only an evaluated lesson|already promoted/);
  assert.throws(() => rejectLesson(WS, lesson.id, 'operator', 'late'), /cannot be rejected/);
});

test('a lesson without verified evidence cannot be evaluated or promoted', () => {
  const db = getOsDb();
  db.prepare(`INSERT INTO os_lessons (id, workspace_id, mission_id, task_id, title, content, evidence, status, confidence, version, provenance, created_by, created_at, updated_at)
    VALUES ('lsn_unverified', ?, NULL, NULL, 'Unverified', 'This content has no verification evidence at all.', '[]', 'candidate', 0.1, 1, 'manual', 'test', ?, ?)`)
    .run(WS, new Date().toISOString(), new Date().toISOString());
  assert.throws(() => evaluateLesson(WS, 'lsn_unverified', 'operator'), /enough verified evidence/);
  assert.equal(listLessons(WS, { status: 'candidate' }).some((lesson) => lesson.id === 'lsn_unverified'), true);
});

test('tampered or nonexistent verification evidence cannot be evaluated', () => {
  const db = getOsDb();
  db.prepare(`INSERT INTO os_lessons (id, workspace_id, mission_id, task_id, title, content, evidence, status, confidence, version, provenance, created_by, created_at, updated_at)
    VALUES ('lsn_fake', ?, NULL, NULL, 'Fake evidence', 'A lesson that claims verification that does not exist.', ?, 'candidate', 0.9, 1, 'manual', 'test', ?, ?)`)
    .run(WS, JSON.stringify([{ verificationId: 'ver_does_not_exist', result: 'passed', checks: ['artifact-integrity', 'acceptance-review'] }]), new Date().toISOString(), new Date().toISOString());
  assert.throws(() => evaluateLesson(WS, 'lsn_fake', 'operator'), /enough verified evidence/);
});

test('rejection is explicit and leaves no semantic memory', () => {
  const db = getOsDb();
  db.prepare(`INSERT INTO os_lessons (id, workspace_id, mission_id, task_id, title, content, evidence, status, confidence, version, provenance, created_by, created_at, updated_at)
    VALUES ('lsn_reject', ?, NULL, NULL, 'Reject me', 'A candidate lesson with plausible but unverified content.', '[]', 'candidate', 0.2, 1, 'manual', 'test', ?, ?)`)
    .run(WS, new Date().toISOString(), new Date().toISOString());
  const rejected = rejectLesson(WS, 'lsn_reject', 'operator', 'not enough evidence');
  assert.equal(rejected.status, 'rejected');
  assert.equal(listMemories(WS, { scope: 'semantic' }).length, 1);
});

test('promotion history, observed effectiveness and revocation are durable', async () => {
  const promoted = listLessons(WS, { status: 'promoted' })[0]!;
  const firstMission = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify potential problems for reuse', actor: 'operator' });
  const secondMission = createMission({ workspaceId: WS, objective: 'Inspect my computer and identify any remaining problems', actor: 'operator' });
  const db = getOsDb();
  for (const missionId of [firstMission, secondMission]) {
    db.prepare("UPDATE os_missions SET status = 'completed', outcome_status = 'verified', updated_at = ? WHERE workspace_id = ? AND id = ?")
      .run(new Date().toISOString(), WS, missionId);
  }
  const firstApplication = recordLessonApplication(WS, promoted.id, { missionId: firstMission }, 'operator');
  const success = recordLessonOutcome(WS, promoted.id, { applicationId: firstApplication.id }, 'operator');
  assert.equal(success.outcomeCount, 1);
  assert.equal(success.successCount, 1);
  assert.equal(success.effectiveness, 1);
  const secondApplication = recordLessonApplication(WS, promoted.id, { missionId: secondMission }, 'operator');
  db.prepare("UPDATE os_missions SET status = 'failed', outcome_status = 'failed' WHERE workspace_id = ? AND id = ?").run(WS, secondMission);
  const mixed = recordLessonOutcome(WS, promoted.id, { applicationId: secondApplication.id }, 'operator');
  assert.equal(mixed.outcomeCount, 2);
  assert.equal(mixed.effectiveness, 0.5);
  const actions = listLessonEvents(WS, promoted.id).map((event) => event.action);
  assert.deepEqual(actions, ['candidate', 'evaluate', 'promote', 'apply', 'outcome', 'apply', 'outcome']);
  assert.ok(promoted.memoryId);
  const revoked = revokeLesson(WS, promoted.id, 'admin', 'superseded by a stronger lesson');
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedBy, 'admin');
  assert.match(revoked.revocationReason, /superseded/);
  assert.equal(listMemories(WS, { scope: 'semantic' }).length, 0);
  assert.equal(listLessonEvents(WS, promoted.id).at(-1)?.action, 'revoke');
  assert.throws(() => recordLessonOutcome(WS, promoted.id, { applicationId: firstApplication.id }, 'operator'), /Only a promoted lesson/);
  assert.throws(() => revokeLesson(WS, promoted.id, 'admin', 'again'), /Only a promoted lesson/);
});

test('outcomes cannot be self-reported without a recorded application and terminal mission', () => {
  assert.throws(() => recordLessonOutcome(WS, 'lsn_missing', { applicationId: 'lsa_missing' }, 'operator'), /Lesson not found/);
});
