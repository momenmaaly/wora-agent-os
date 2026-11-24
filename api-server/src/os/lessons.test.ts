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
const { listLessons, collectCandidateLessons, evaluateLesson, promoteLesson, rejectLesson } = await import('./lessons.js');
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
  assert.deepEqual(collectCandidateLessons(WS, missionId, 'test'), []);
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

test('rejection is explicit and leaves no semantic memory', () => {
  const db = getOsDb();
  db.prepare(`INSERT INTO os_lessons (id, workspace_id, mission_id, task_id, title, content, evidence, status, confidence, version, provenance, created_by, created_at, updated_at)
    VALUES ('lsn_reject', ?, NULL, NULL, 'Reject me', 'A candidate lesson with plausible but unverified content.', '[]', 'candidate', 0.2, 1, 'manual', 'test', ?, ?)`)
    .run(WS, new Date().toISOString(), new Date().toISOString());
  const rejected = rejectLesson(WS, 'lsn_reject', 'operator', 'not enough evidence');
  assert.equal(rejected.status, 'rejected');
  assert.equal(listMemories(WS, { scope: 'semantic' }).length, 1);
});
