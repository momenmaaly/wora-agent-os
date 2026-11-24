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
import { listVerifications } from './verification.js';
import { addMemory } from './memory.js';

export type LessonStatus = 'candidate' | 'tested' | 'promoted' | 'rejected';

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
  createdAt: string;
  updatedAt: string;
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 32);

const view = (row: Record<string, string | number>): LessonRecord => ({
  id: String(row['id']), workspaceId: String(row['workspace_id']), missionId: (row['mission_id'] as string | null) ?? null,
  taskId: (row['task_id'] as string | null) ?? null, title: String(row['title']), content: String(row['content']),
  evidence: parseJson<unknown[]>(String(row['evidence'] ?? '[]'), []), status: String(row['status']) as LessonStatus,
  confidence: Number(row['confidence']), version: Number(row['version']), provenance: String(row['provenance']),
  createdBy: String(row['created_by']), promotedBy: (row['promoted_by'] as string | null) ?? null,
  promotedAt: (row['promoted_at'] as string | null) ?? null, createdAt: String(row['created_at']), updatedAt: String(row['updated_at']),
});

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
    .filter((verification) => verification.result === 'passed' && verification.checks.some((check) => check.id === 'artifact-integrity' && check.status === 'passed'));
  const created: LessonRecord[] = [];
  for (const verification of verifications) {
    const task = db.prepare('SELECT id, title, objective, tool FROM os_tasks WHERE workspace_id = ? AND id = ?').get(workspaceId, verification.taskId) as { id: string; title: string; objective: string; tool: string | null } | undefined;
    if (!task) continue;
    const existing = db.prepare('SELECT id FROM os_lessons WHERE workspace_id = ? AND mission_id = ? AND task_id = ?').get(workspaceId, missionId, task.id) as { id?: string } | undefined;
    if (existing?.id) continue;
    const title = `Lesson: ${task.title}`.slice(0, 200);
    const content = [
      `When the objective is: ${task.objective}`,
      `A verified approach used ${task.tool ?? 'no external tool'} and passed independent checks.`,
      `Evidence: verification ${verification.id}, artifact digest ${String(verification.checks.find((check) => check.id === 'artifact-integrity')?.evidence ?? '')}.`,
      'Reuse only when the same preconditions and acceptance criteria hold; re-verify on the new task.',
    ].join('\n').slice(0, 4_000);
    const evidence = [{ verificationId: verification.id, runId: verification.runId, result: verification.result, checks: verification.checks.map((check) => check.id) }];
    const id = newId('lsn');
    const ts = nowIso();
    db.prepare(`INSERT INTO os_lessons (id, workspace_id, mission_id, task_id, title, content, evidence, status, confidence, version, provenance, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?, 1, ?, ?, ?, ?)`)
      .run(id, workspaceId, missionId, task.id, title, content, JSON.stringify(evidence), 0.7, `mission:${missionId}/verification:${verification.id}`, actor, ts, ts);
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
    return record['result'] === 'passed' && typeof record['verificationId'] === 'string' && Array.isArray(record['checks']) && record['checks'].includes('artifact-integrity');
  });
  if (!validEvidence || lesson.content.trim().length < 20) throw new Error('Lesson does not have enough verified evidence to be tested');
  db.prepare("UPDATE os_lessons SET status = 'tested', updated_at = ? WHERE workspace_id = ? AND id = ?").run(nowIso(), workspaceId, lessonId);
  audit(db, { workspaceId, actor, action: 'lesson.evaluate', subject: lessonId, detail: { result: 'tested' } });
  return getLesson(workspaceId, lessonId)!;
}

/** Promotion is an explicit operator action and writes provenance into memory. */
export function promoteLesson(workspaceId: string, lessonId: string, actor: string): LessonRecord {
  const db = getOsDb();
  const lesson = getLesson(workspaceId, lessonId);
  if (!lesson) throw new Error('Lesson not found');
  if (lesson.status !== 'tested') throw new Error('Only an evaluated lesson can be promoted');
  const memory = addMemory({
    workspaceId, scope: 'semantic', scopeId: 'lessons', content: lesson.content,
    tags: ['lesson', 'verified'], provenance: `lesson:${lesson.id}`, actor,
  });
  db.prepare("UPDATE os_lessons SET status = 'promoted', version = version + 1, promoted_by = ?, promoted_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?")
    .run(actor.slice(0, 200), nowIso(), nowIso(), workspaceId, lessonId);
  audit(db, { workspaceId, actor, action: 'lesson.promote', subject: lessonId, detail: { memoryId: memory.id, version: lesson.version + 1 } });
  return getLesson(workspaceId, lessonId)!;
}

export function rejectLesson(workspaceId: string, lessonId: string, actor: string, reason: string): LessonRecord {
  const db = getOsDb();
  const lesson = getLesson(workspaceId, lessonId);
  if (!lesson) throw new Error('Lesson not found');
  if (lesson.status === 'promoted') throw new Error('A promoted lesson cannot be rejected; revoke the memory record instead');
  db.prepare("UPDATE os_lessons SET status = 'rejected', updated_at = ? WHERE workspace_id = ? AND id = ?").run(nowIso(), workspaceId, lessonId);
  audit(db, { workspaceId, actor, action: 'lesson.reject', subject: lessonId, detail: { reason: reason.slice(0, 300) } });
  return getLesson(workspaceId, lessonId)!;
}
