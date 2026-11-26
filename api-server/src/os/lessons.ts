/**
 * WORA OS — experience learning lifecycle.
 *
 * A completed task is an episode, not a lesson. Candidate lessons are derived
 * only from verification records that passed independent checks. They remain
 * candidates until an explicit evaluation and promotion. Promotion writes a
 * semantic memory record with provenance; nothing is auto-promoted.
 */
import { createHash } from 'node:crypto';
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { listVerifications, getVerification } from './verification.js';
import { addMemory, deleteMemory } from './memory.js';
import { redactSecrets } from './secrets.js';

export type LessonStatus = 'candidate' | 'tested' | 'promoted' | 'rejected' | 'revoked';

export interface LessonRecord {
  id: string;
  workspaceId: string;
  missionId: string | null;
  taskId: string | null;
  title: string;
  content: string;
  evidence: unknown[];
  status: LessonStatus;
  confidence: number;
  version: number;
  provenance: string;
  createdBy: string;
  promotedBy: string | null;
  promotedAt: string | null;
  memoryId: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revocationReason: string;
  outcomeCount: number;
  successCount: number;
  inconclusiveCount: number;
  effectiveness: number;
  createdAt: string;
  updatedAt: string;
}

export interface LessonApplication {
  id: string;
  workspaceId: string;
  lessonId: string;
  missionId: string;
  taskId: string | null;
  actor: string;
  appliedAt: string;
  source: string;
  evidenceDigest: string;
}

export interface LessonEvent {
  id: string; workspaceId: string; lessonId: string; action: string; actor: string; detail: unknown; createdAt: string;
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 32);

function redactValue<T>(value: T): T {
  return redactSecrets(value).value;
}

const view = (row: Record<string, string | number>): LessonRecord => ({
  id: String(row['id']), workspaceId: String(row['workspace_id']), missionId: (row['mission_id'] as string | null) ?? null,
  taskId: (row['task_id'] as string | null) ?? null, title: redactSecrets(String(row['title'])).value,
  content: redactSecrets(String(row['content'])).value,
  evidence: redactSecrets(parseJson<unknown[]>(String(row['evidence'] ?? '[]'), [])).value,
  status: String(row['status']) as LessonStatus,
  confidence: Number(row['confidence']), version: Number(row['version']), provenance: redactSecrets(String(row['provenance'])).value,
  createdBy: String(row['created_by']), promotedBy: (row['promoted_by'] as string | null) ?? null,
  promotedAt: (row['promoted_at'] as string | null) ?? null,
  memoryId: (row['memory_id'] as string | null) ?? null,
  revokedBy: (row['revoked_by'] as string | null) ?? null,
  revokedAt: (row['revoked_at'] as string | null) ?? null,
  revocationReason: redactSecrets(String(row['revocation_reason'] ?? '')).value,
  outcomeCount: Number(row['outcome_count'] ?? 0), successCount: Number(row['success_count'] ?? 0),
  inconclusiveCount: Number(row['inconclusive_count'] ?? 0),
  effectiveness: Number(row['effectiveness'] ?? 0),
  createdAt: String(row['created_at']), updatedAt: String(row['updated_at']),
});

function recordLessonEvent(workspaceId: string, lessonId: string, action: string, actor: string, detail: unknown): void {
  getOsDb().prepare('INSERT INTO os_lesson_events (id, workspace_id, lesson_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('lev'), workspaceId, lessonId, action, actor.slice(0, 200), JSON.stringify(redactValue(detail ?? {})).slice(0, 10_000), nowIso());
}

export function listLessonEvents(workspaceId: string, lessonId: string): LessonEvent[] {
  const rows = getOsDb().prepare('SELECT * FROM os_lesson_events WHERE workspace_id = ? AND lesson_id = ? ORDER BY created_at ASC LIMIT 200').all(workspaceId, lessonId) as unknown as Array<Record<string, string>>;
  return rows.map((row) => ({ id: String(row['id']), workspaceId: String(row['workspace_id']), lessonId: String(row['lesson_id']), action: String(row['action']), actor: String(row['actor']), detail: redactSecrets(parseJson(row['detail'], {})).value, createdAt: String(row['created_at']) }));
}

export function listLessons(workspaceId: string, opts: { status?: LessonStatus | 'all'; limit?: number } = {}): LessonRecord[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const db = getOsDb();
  const rows = opts.status && opts.status !== 'all'
    ? db.prepare('SELECT * FROM os_lessons WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, opts.status, limit)
    : db.prepare('SELECT * FROM os_lessons WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, limit);
  return (rows as unknown as Array<Record<string, string | number>>).map(view);
}

export function getLesson(workspaceId: string, lessonId: string): LessonRecord | null {
  const row = getOsDb().prepare('SELECT * FROM os_lessons WHERE workspace_id = ? AND id = ?').get(workspaceId, lessonId) as Record<string, string | number> | undefined;
  return row ? view(row) : null;
}

/**
 * Collect candidates from passed verifications. A verification without
 * artifact integrity or acceptance evidence is not eligible.
 */
export function collectCandidateLessons(workspaceId: string, missionId: string, actor: string): LessonRecord[] {
  const db = getOsDb();
  const verifications = listVerifications(workspaceId, { missionId, limit: 200 })
    .filter((verification) => verification.result === 'passed'
      && verification.checks.some((check) => check.id === 'acceptance-review' && check.status === 'passed')
      && verification.checks.some((check) => check.id === 'artifact-integrity' && check.status === 'passed')
      && !verification.checks.some((check) => check.status === 'failed'));
  const created: LessonRecord[] = [];
  for (const verification of verifications) {
    const task = db.prepare('SELECT id, title, objective, tool FROM os_tasks WHERE workspace_id = ? AND id = ?').get(workspaceId, verification.taskId) as { id: string; title: string; objective: string; tool: string | null } | undefined;
    if (!task) continue;
    const existing = db.prepare('SELECT id FROM os_lessons WHERE workspace_id = ? AND mission_id = ? AND task_id = ?').get(workspaceId, missionId, task.id) as { id?: string } | undefined;
    if (existing?.id) {
      const record = getLesson(workspaceId, existing.id);
      if (record) created.push(record);
      continue;
    }
    const title = redactSecrets(`Lesson: ${task.title}`).value.slice(0, 200);
    const content = redactSecrets([
      `When the objective is: ${task.objective}`,
      `A verified approach used ${task.tool ?? 'no external tool'} and passed independent checks.`,
      `Evidence: verification ${verification.id}, artifact digest ${String(verification.checks.find((check) => check.id === 'artifact-integrity')?.evidence ?? '')}.`,
      'Reuse only when the same preconditions and acceptance criteria hold; re-verify on the new task.',
    ].join('\n')).value.slice(0, 4_000);
    const evidence = redactSecrets([{ verificationId: verification.id, runId: verification.runId, result: verification.result, checks: verification.checks.map((check) => check.id) }]).value;
    const id = newId('lsn');
    const ts = nowIso();
    db.prepare(`INSERT INTO os_lessons (id, workspace_id, mission_id, task_id, title, content, evidence, status, confidence, version, provenance, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?, 1, ?, ?, ?, ?)`)
      .run(id, workspaceId, missionId, task.id, title, content, JSON.stringify(evidence), 0.7, `mission:${missionId}/verification:${verification.id}`, actor, ts, ts);
    recordLessonEvent(workspaceId, id, 'candidate', actor, { missionId, taskId: task.id, verificationId: verification.id, digest: digest(evidence) });
    audit(db, { workspaceId, actor, action: 'lesson.candidate', subject: id, detail: { missionId, taskId: task.id, verificationId: verification.id, digest: digest(evidence) } });
    created.push(getLesson(workspaceId, id)!);
  }
  return created;
}

/** Evaluation is explicit and deterministic; it never promotes. */
export function evaluateLesson(workspaceId: string, lessonId: string, actor: string): LessonRecord {
  const db = getOsDb();
  const lesson = getLesson(workspaceId, lessonId);
  if (!lesson) throw new Error('Lesson not found');
  if (lesson.status !== 'candidate' && lesson.status !== 'tested') throw new Error(`Lesson is ${lesson.status}`);
  const evidence = Array.isArray(lesson.evidence) ? lesson.evidence : [];
  const validEvidence = evidence.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as Record<string, unknown>;
    if (typeof record['verificationId'] !== 'string') return false;
    const verification = getVerification(workspaceId, record['verificationId']);
    return Boolean(verification && verification.result === 'passed'
      && verification.checks.some((check) => check.id === 'artifact-integrity' && check.status === 'passed')
      && verification.checks.some((check) => check.id === 'acceptance-review' && check.status === 'passed')
      && !verification.checks.some((check) => check.status === 'failed'));
  });
  if (!validEvidence || lesson.content.trim().length < 20) throw new Error('Lesson does not have enough verified evidence to be tested');
  db.prepare("UPDATE os_lessons SET status = 'tested', updated_at = ? WHERE workspace_id = ? AND id = ?").run(nowIso(), workspaceId, lessonId);
  recordLessonEvent(workspaceId, lessonId, 'evaluate', actor, { result: 'tested' });
  audit(db, { workspaceId, actor, action: 'lesson.evaluate', subject: lessonId, detail: { result: 'tested' } });
  return getLesson(workspaceId, lessonId)!;
}

/** Promotion is an explicit operator action and writes provenance into memory. */
export function promoteLesson(workspaceId: string, lessonId: string, actor: string): LessonRecord {
  const db = getOsDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const lesson = getLesson(workspaceId, lessonId);
    if (!lesson) throw new Error('Lesson not found');
    if (lesson.status !== 'tested') throw new Error('Only an evaluated lesson can be promoted');
    const claim = db.prepare("UPDATE os_lessons SET status = 'promoted', version = version + 1, promoted_by = ?, promoted_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ? AND status = 'tested'")
      .run(actor.slice(0, 200), nowIso(), nowIso(), workspaceId, lessonId);
    if (Number(claim.changes ?? 0) !== 1) throw new Error('Lesson was already promoted or is no longer eligible');
    const reviewedAt = nowIso();
    const memory = addMemory({
      workspaceId, scope: 'semantic', scopeId: 'lessons', content: lesson.content,
      tags: ['lesson', 'verified'], provenance: `lesson:${lesson.id}`, actor,
      sourceClass: 'promoted-lesson', verificationStatus: 'verified', knowledgeStatus: 'active',
      reviewedBy: actor, reviewedAt, evidenceDigest: digest(lesson.evidence), evidenceRef: `lesson:${lesson.id}`,
    });
    db.prepare('UPDATE os_lessons SET memory_id = ? WHERE workspace_id = ? AND id = ?').run(memory.id, workspaceId, lessonId);
    recordLessonEvent(workspaceId, lessonId, 'promote', actor, { memoryId: memory.id, version: lesson.version + 1 });
    audit(db, { workspaceId, actor, action: 'lesson.promote', subject: lessonId, detail: { memoryId: memory.id, version: lesson.version + 1 } });
    const promoted = getLesson(workspaceId, lessonId)!;
    db.exec('COMMIT');
    return promoted;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw err;
  }
}

export function rejectLesson(workspaceId: string, lessonId: string, actor: string, reason: string): LessonRecord {
  const db = getOsDb();
  const lesson = getLesson(workspaceId, lessonId);
  if (!lesson) throw new Error('Lesson not found');
  if (lesson.status === 'promoted') throw new Error('A promoted lesson cannot be rejected; revoke the memory record instead');
  if (lesson.status !== 'candidate' && lesson.status !== 'tested') throw new Error(`A ${lesson.status} lesson cannot be rejected`);
  db.prepare("UPDATE os_lessons SET status = 'rejected', updated_at = ? WHERE workspace_id = ? AND id = ? AND status IN ('candidate', 'tested')").run(nowIso(), workspaceId, lessonId);
  recordLessonEvent(workspaceId, lessonId, 'reject', actor, { reason: reason.slice(0, 300) });
  audit(db, { workspaceId, actor, action: 'lesson.reject', subject: lessonId, detail: { reason: reason.slice(0, 300) } });
  return getLesson(workspaceId, lessonId)!;
}


/** Revocation is explicit, admin-gated at the API, and removes the promoted memory. */
export function revokeLesson(workspaceId: string, lessonId: string, actor: string, reason: string): LessonRecord {
  const db = getOsDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const lesson = getLesson(workspaceId, lessonId);
    if (!lesson) throw new Error('Lesson not found');
    if (lesson.status !== 'promoted') throw new Error('Only a promoted lesson can be revoked');
    if (lesson.memoryId) deleteMemory(workspaceId, lesson.memoryId, actor, { inTransaction: true, skipLinkedLessons: true });
    db.prepare("UPDATE os_lessons SET status = 'revoked', revoked_by = ?, revoked_at = ?, revocation_reason = ?, updated_at = ?, title = 'Revoked lesson', content = '[content erased on revocation]', evidence = '[]' WHERE workspace_id = ? AND id = ? AND status = 'promoted'")
      .run(actor.slice(0, 200), nowIso(), reason.slice(0, 500), nowIso(), workspaceId, lessonId);
    recordLessonEvent(workspaceId, lessonId, 'revoke', actor, { reason: reason.slice(0, 300), memoryId: lesson.memoryId });
    audit(db, { workspaceId, actor, action: 'lesson.revoke', subject: lessonId, detail: { reason: reason.slice(0, 300), memoryId: lesson.memoryId } });
    const revoked = getLesson(workspaceId, lessonId)!;
    db.exec('COMMIT');
    return revoked;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw err;
  }
}

function lessonApplicationView(row: Record<string, string | null>): LessonApplication {
  return {
    id: String(row['id']), workspaceId: String(row['workspace_id']), lessonId: String(row['lesson_id']),
    missionId: String(row['mission_id']), taskId: row['task_id'] ?? null, actor: String(row['actor']),
    appliedAt: String(row['applied_at']), source: String(row['source']), evidenceDigest: String(row['evidence_digest'] ?? ''),
  };
}

/** Bind a promoted lesson to a real mission before the lesson is claimed as used. */
export function recordLessonApplication(workspaceId: string, lessonId: string, input: { missionId: string; taskId?: string; source?: string }, actor: string): LessonApplication {
  const db = getOsDb();
  const lesson = getLesson(workspaceId, lessonId);
  if (!lesson) throw new Error('Lesson not found');
  if (lesson.status !== 'promoted') throw new Error('Only a promoted lesson can be applied');
  const mission = db.prepare('SELECT id, requested_by FROM os_missions WHERE workspace_id = ? AND id = ?').get(workspaceId, input.missionId) as { id: string; requested_by: string } | undefined;
  if (!mission) throw new Error('Mission not found');
  if (actor !== 'system' && mission.requested_by !== actor) throw new Error('A lesson can only be applied to a mission owned by the caller');
  if (input.taskId) {
    const task = db.prepare('SELECT id FROM os_tasks WHERE workspace_id = ? AND mission_id = ? AND id = ?').get(workspaceId, input.missionId, input.taskId) as { id: string } | undefined;
    if (!task) throw new Error('Task does not belong to the mission');
  }
  const existing = db.prepare('SELECT * FROM os_lesson_applications WHERE workspace_id = ? AND lesson_id = ? AND mission_id = ? AND task_id IS ?')
    .get(workspaceId, lessonId, input.missionId, input.taskId ?? null) as Record<string, string | null> | undefined;
  if (existing) return lessonApplicationView(existing);
  const id = newId('lsa');
  const appliedAt = nowIso();
  const source = input.source ?? 'explicit';
  const evidenceDigest = digest({ lessonId, missionId: input.missionId, taskId: input.taskId ?? null, source });
  db.prepare('INSERT INTO os_lesson_applications (id, workspace_id, lesson_id, mission_id, task_id, actor, applied_at, source, evidence_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, lessonId, input.missionId, input.taskId ?? null, actor.slice(0, 200), appliedAt, source, evidenceDigest);
  recordLessonEvent(workspaceId, lessonId, 'apply', actor, { missionId: input.missionId, taskId: input.taskId ?? null, source });
  audit(db, { workspaceId, actor, action: 'lesson.apply', subject: lessonId, detail: { missionId: input.missionId, taskId: input.taskId ?? null, source, evidenceDigest } });
  return { id, workspaceId, lessonId, missionId: input.missionId, taskId: input.taskId ?? null, actor, appliedAt, source, evidenceDigest };
}

export function listLessonApplications(workspaceId: string, lessonId: string): LessonApplication[] {
  const rows = getOsDb().prepare('SELECT * FROM os_lesson_applications WHERE workspace_id = ? AND lesson_id = ? ORDER BY applied_at DESC LIMIT 100').all(workspaceId, lessonId) as unknown as Array<Record<string, string | null>>;
  return rows.map(lessonApplicationView);
}

/**
 * Record an outcome only after a real lesson application and a terminal mission
 * outcome exist. A caller-supplied `success` flag is intentionally not accepted:
 * success is derived from persisted mission verification, never self-reported.
 */
export function recordLessonOutcome(workspaceId: string, lessonId: string, input: { applicationId: string; evidence?: unknown }, actor: string): LessonRecord {
  const db = getOsDb();
  const lesson = getLesson(workspaceId, lessonId);
  if (!lesson) throw new Error('Lesson not found');
  if (lesson.status !== 'promoted') throw new Error('Only a promoted lesson can receive outcomes');
  if (typeof input.applicationId !== 'string' || !input.applicationId.trim()) {
    throw new Error('A recorded lesson application is required before an outcome');
  }
  const application = db.prepare('SELECT * FROM os_lesson_applications WHERE workspace_id = ? AND lesson_id = ? AND id = ?').get(workspaceId, lessonId, input.applicationId) as Record<string, string | null> | undefined;
  if (!application) throw new Error('A recorded lesson application is required before an outcome');
  const mission = db.prepare('SELECT id, status, outcome_status, requested_by FROM os_missions WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, String(application['mission_id'])) as { id: string; status: string; outcome_status: string; requested_by: string } | undefined;
  if (!mission) throw new Error('Mission not found');
  if (actor !== 'system' && mission.requested_by !== actor) throw new Error('Only the mission owner can confirm a lesson outcome');
  if (!['completed', 'failed'].includes(mission.status)) throw new Error('Mission has not reached a terminal state');
  const success = mission.status === 'completed' && mission.outcome_status === 'verified';
  const inconclusive = !success && !(mission.status === 'failed' || mission.outcome_status === 'failed');
  const ownsTransaction = !db.isTransaction;
  if (ownsTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    const claim = db.prepare('UPDATE os_lesson_applications SET outcome_recorded_at = ? WHERE workspace_id = ? AND lesson_id = ? AND id = ? AND outcome_recorded_at IS NULL')
      .run(nowIso(), workspaceId, lessonId, String(application['id']));
    if (Number(claim.changes ?? 0) !== 1) {
      throw new Error('This lesson application already has a recorded outcome; outcomes cannot be replayed.');
    }
    db.prepare(`UPDATE os_lessons SET
        outcome_count = outcome_count + 1,
        success_count = success_count + ?,
        inconclusive_count = inconclusive_count + ?,
        effectiveness = CAST(success_count + ? AS REAL) / (outcome_count + 1),
        updated_at = ? WHERE workspace_id = ? AND id = ?`)
      .run(success ? 1 : 0, inconclusive ? 1 : 0, success ? 1 : 0, nowIso(), workspaceId, lessonId);
    recordLessonEvent(workspaceId, lessonId, 'outcome', actor, {
      success, inconclusive, missionId: mission.id, taskId: application['task_id'] ?? null,
      applicationId: application['id'], outcomeStatus: mission.outcome_status, evidence: input.evidence ?? null,
    });
    audit(db, { workspaceId, actor, action: 'lesson.outcome', subject: lessonId, detail: { success, inconclusive, missionId: mission.id, applicationId: application['id'], outcomeStatus: mission.outcome_status } });
    if (ownsTransaction) db.exec('COMMIT');
  } catch (error) {
    if (ownsTransaction) { try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ } }
    throw error;
  }
  return getLesson(workspaceId, lessonId)!;
}
