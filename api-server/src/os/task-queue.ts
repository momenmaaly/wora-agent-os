/**
 * WORA OS — durable task leases and checkpoints.
 *
 * A task is claimed atomically before execution. Only one owner can hold an
 * active lease; a second worker receives null instead of executing the same
 * task. Leases expire so a crashed worker can be replaced. Checkpoints are
 * written before and after an attempt so a restart can distinguish a clean
 * retry from an uncertain side effect.
 */
import { createHash } from 'node:crypto';
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';

export type CheckpointStatus = 'started' | 'completed' | 'failed' | 'blocked';

export interface TaskLease {
  taskId: string;
  missionId: string;
  workspaceId: string;
  ownerId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: number;
  updatedAt: string;
}

export interface TaskCheckpoint {
  id: string;
  taskId: string;
  missionId: string;
  workspaceId: string;
  runId: string;
  attempt: number;
  status: CheckpointStatus;
  outputDigest: string;
  evidenceDigest: string;
  checkpoint: unknown;
  createdAt: string;
  updatedAt: string;
}

const digest = (value: unknown): string => {
  try { return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 32); }
  catch { return ''; }
};

const leaseView = (row: Record<string, string | number>): TaskLease => ({
  taskId: String(row['task_id']), missionId: String(row['mission_id']), workspaceId: String(row['workspace_id']),
  ownerId: String(row['owner_id']), acquiredAt: String(row['acquired_at']), heartbeatAt: String(row['heartbeat_at']),
  expiresAt: Number(row['expires_at']), updatedAt: String(row['updated_at']),
});

const checkpointView = (row: Record<string, string | number>): TaskCheckpoint => ({
  id: String(row['id']), taskId: String(row['task_id']), missionId: String(row['mission_id']), workspaceId: String(row['workspace_id']),
  runId: String(row['run_id']), attempt: Number(row['attempt']), status: String(row['status']) as CheckpointStatus,
  outputDigest: String(row['output_digest'] ?? ''), evidenceDigest: String(row['evidence_digest'] ?? ''),
  checkpoint: parseJson(String(row['checkpoint'] ?? '{}'), {}), createdAt: String(row['created_at']), updatedAt: String(row['updated_at']),
});

/**
 * Claim a task for one owner. The transaction is the concurrency boundary:
 * two processes racing here cannot both receive the same active lease.
 */
export function claimTask(input: {
  workspaceId: string; taskId: string; ownerId: string; ttlMs?: number; missionId?: string;
}): TaskLease | null {
  const db = getOsDb();
  const ttlMs = Math.min(Math.max(input.ttlMs ?? 30_000, 1_000), 10 * 60_000);
  db.exec('BEGIN IMMEDIATE');
  try {
    const task = db.prepare('SELECT id, mission_id, workspace_id, status FROM os_tasks WHERE workspace_id = ? AND id = ?')
      .get(input.workspaceId, input.taskId) as { id: string; mission_id: string; workspace_id: string; status: string } | undefined;
    if (!task) { db.exec('ROLLBACK'); return null; }
    if (task.status === 'completed' || task.status === 'cancelled') { db.exec('ROLLBACK'); return null; }
    if (input.missionId && task.mission_id !== input.missionId) { db.exec('ROLLBACK'); return null; }
    const mission = db.prepare('SELECT status FROM os_missions WHERE workspace_id = ? AND id = ?')
      .get(input.workspaceId, task.mission_id) as { status?: string } | undefined;
    if (!mission || mission.status === 'completed' || mission.status === 'cancelled' || mission.status === 'paused') {
      db.exec('ROLLBACK');
      return null;
    }
    const existing = db.prepare('SELECT * FROM os_task_leases WHERE task_id = ?').get(input.taskId) as Record<string, string | number> | undefined;
    const now = Date.now();
    if (existing && Number(existing['expires_at']) > now && String(existing['owner_id']) !== input.ownerId) {
      db.exec('ROLLBACK');
      return null;
    }
    if (existing && Number(existing['expires_at']) > now && String(existing['owner_id']) === input.ownerId) {
      db.exec('COMMIT');
      return leaseView(existing);
    }
    const timestamp = nowIso();
    const lease: TaskLease = {
      taskId: input.taskId, missionId: task.mission_id, workspaceId: input.workspaceId, ownerId: input.ownerId,
      acquiredAt: timestamp, heartbeatAt: timestamp, expiresAt: now + ttlMs, updatedAt: timestamp,
    };
    db.prepare(`INSERT INTO os_task_leases (task_id, mission_id, workspace_id, owner_id, acquired_at, heartbeat_at, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET mission_id = excluded.mission_id, workspace_id = excluded.workspace_id,
        owner_id = excluded.owner_id, acquired_at = excluded.acquired_at, heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
      .run(lease.taskId, lease.missionId, lease.workspaceId, lease.ownerId, lease.acquiredAt, lease.heartbeatAt, lease.expiresAt, lease.updatedAt);
    db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('assigned', timestamp, input.taskId);
    audit(db, { workspaceId: input.workspaceId, actor: input.ownerId, action: 'task.lease.claim', subject: input.taskId, detail: { missionId: task.mission_id, expiresAt: lease.expiresAt } });
    db.exec('COMMIT');
    return lease;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw err;
  }
}

export function heartbeatTask(input: { workspaceId: string; taskId: string; ownerId: string; ttlMs?: number }): boolean {
  const db = getOsDb();
  const now = Date.now();
  const ttlMs = Math.min(Math.max(input.ttlMs ?? 30_000, 1_000), 10 * 60_000);
  const update = db.prepare('UPDATE os_task_leases SET heartbeat_at = ?, expires_at = ?, updated_at = ? WHERE workspace_id = ? AND task_id = ? AND owner_id = ? AND expires_at > ?')
    .run(nowIso(), now + ttlMs, nowIso(), input.workspaceId, input.taskId, input.ownerId, now);
  return Number(update.changes ?? 0) === 1;
}

export function releaseTaskLease(input: { workspaceId: string; taskId: string; ownerId: string }): boolean {
  const db = getOsDb();
  const row = db.prepare('SELECT owner_id FROM os_task_leases WHERE workspace_id = ? AND task_id = ?').get(input.workspaceId, input.taskId) as { owner_id?: string } | undefined;
  if (!row || String(row.owner_id) !== input.ownerId) return false;
  db.prepare('DELETE FROM os_task_leases WHERE task_id = ?').run(input.taskId);
  audit(db, { workspaceId: input.workspaceId, actor: input.ownerId, action: 'task.lease.release', subject: input.taskId, detail: {} });
  return true;
}

export function getTaskLease(workspaceId: string, taskId: string): TaskLease | null {
  const row = getOsDb().prepare('SELECT * FROM os_task_leases WHERE workspace_id = ? AND task_id = ?').get(workspaceId, taskId) as Record<string, string | number> | undefined;
  return row ? leaseView(row) : null;
}

export function listTaskLeases(workspaceId: string, missionId?: string): TaskLease[] {
  const db = getOsDb();
  const rows = missionId
    ? db.prepare('SELECT * FROM os_task_leases WHERE workspace_id = ? AND mission_id = ? ORDER BY acquired_at DESC').all(workspaceId, missionId)
    : db.prepare('SELECT * FROM os_task_leases WHERE workspace_id = ? ORDER BY acquired_at DESC LIMIT 100').all(workspaceId);
  return (rows as unknown as Array<Record<string, string | number>>).map(leaseView);
}

export function checkpointTask(input: {
  workspaceId: string; taskId: string; missionId: string; runId: string; attempt: number;
  status: CheckpointStatus; output?: unknown; evidence?: unknown; checkpoint?: unknown;
}): TaskCheckpoint {
  const db = getOsDb();
  const task = db.prepare('SELECT mission_id, workspace_id FROM os_tasks WHERE id = ?').get(input.taskId) as { mission_id?: string; workspace_id?: string } | undefined;
  if (!task || task.workspace_id !== input.workspaceId || task.mission_id !== input.missionId) throw new Error('Checkpoint task does not belong to the supplied workspace and mission');
  const existing = db.prepare('SELECT status FROM os_task_checkpoints WHERE task_id = ? AND run_id = ?').get(input.taskId, input.runId) as { status?: string } | undefined;
  if (existing?.status === 'completed' && input.status !== 'completed') throw new Error('A completed checkpoint cannot be downgraded');
  if (existing?.status === 'failed' && input.status === 'started') throw new Error('A failed checkpoint cannot be reopened as started');
  const now = nowIso();
  const id = newId('ckp');
  db.prepare(`INSERT INTO os_task_checkpoints
    (id, task_id, mission_id, workspace_id, run_id, attempt, status, output_digest, evidence_digest, checkpoint, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, run_id) DO UPDATE SET attempt = excluded.attempt, status = excluded.status,
      output_digest = excluded.output_digest, evidence_digest = excluded.evidence_digest,
      checkpoint = excluded.checkpoint, updated_at = excluded.updated_at`)
    .run(id, input.taskId, input.missionId, input.workspaceId, input.runId, input.attempt, input.status,
      digest(input.output), digest(input.evidence), JSON.stringify(input.checkpoint ?? {}).slice(0, 20_000), now, now);
  const row = db.prepare('SELECT * FROM os_task_checkpoints WHERE task_id = ? AND run_id = ?').get(input.taskId, input.runId) as Record<string, string | number>;
  return checkpointView(row);
}

export function latestTaskCheckpoint(workspaceId: string, taskId: string): TaskCheckpoint | null {
  const row = getOsDb().prepare('SELECT * FROM os_task_checkpoints WHERE workspace_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 1').get(workspaceId, taskId) as Record<string, string | number> | undefined;
  return row ? checkpointView(row) : null;
}

export function listTaskCheckpoints(workspaceId: string, taskId: string): TaskCheckpoint[] {
  const rows = getOsDb().prepare('SELECT * FROM os_task_checkpoints WHERE workspace_id = ? AND task_id = ? ORDER BY created_at ASC LIMIT 100').all(workspaceId, taskId);
  return (rows as unknown as Array<Record<string, string | number>>).map(checkpointView);
}

/** Expired leases are returned to the queue with an honest blocked state. */
export function recoverExpiredTaskLeases(workspaceId?: string): number {
  const db = getOsDb();
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = workspaceId
      ? db.prepare('SELECT * FROM os_task_leases WHERE workspace_id = ? AND expires_at <= ?').all(workspaceId, now)
      : db.prepare('SELECT * FROM os_task_leases WHERE expires_at <= ?').all(now);
    let recovered = 0;
    for (const row of rows as unknown as Array<Record<string, string | number>>) {
      const taskId = String(row['task_id']);
      db.prepare('DELETE FROM os_task_leases WHERE task_id = ?').run(taskId);
      db.prepare("UPDATE os_tasks SET status = 'blocked', detail = 'lease_expired — task was interrupted and requires a safe retry', updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'cancelled')")
        .run(nowIso(), taskId);
      audit(db, { workspaceId: String(row['workspace_id']), actor: 'system', action: 'task.lease.expired', subject: taskId, detail: { ownerId: row['owner_id'], expiresAt: row['expires_at'] } });
      recovered += 1;
    }
    db.exec('COMMIT');
    return recovered;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw err;
  }
}

/** A process restart invalidates every in-memory owner, not just expired leases. */
export function clearMissionLeases(workspaceId: string, missionId: string): number {
  const db = getOsDb();
  const result = db.prepare('DELETE FROM os_task_leases WHERE workspace_id = ? AND mission_id = ?').run(workspaceId, missionId);
  return Number(result.changes ?? 0);
}

export interface ExecutionLimits {
  maxConcurrentTasks: number;
  leaseTtlMs: number;
  maxAttempts: number;
}

const EXECUTION_LIMITS_KEY = 'execution_limits';
const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = { maxConcurrentTasks: 4, leaseTtlMs: 30_000, maxAttempts: 2 };

export function getExecutionLimits(workspaceId: string): ExecutionLimits {
  const row = getOsDb().prepare('SELECT value FROM os_settings WHERE workspace_id = ? AND key = ?').get(workspaceId, EXECUTION_LIMITS_KEY) as { value?: string } | undefined;
  const parsed = parseJson<Partial<ExecutionLimits>>(row?.value, {});
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min ? Math.min(value, max) : fallback;
  return {
    maxConcurrentTasks: number(parsed.maxConcurrentTasks, DEFAULT_EXECUTION_LIMITS.maxConcurrentTasks, 1, 8),
    leaseTtlMs: number(parsed.leaseTtlMs, DEFAULT_EXECUTION_LIMITS.leaseTtlMs, 1_000, 10 * 60_000),
    maxAttempts: number(parsed.maxAttempts, DEFAULT_EXECUTION_LIMITS.maxAttempts, 1, 5),
  };
}

export function setExecutionLimits(workspaceId: string, input: Partial<ExecutionLimits>, actor: string): ExecutionLimits {
  const current = getExecutionLimits(workspaceId);
  const next: ExecutionLimits = {
    maxConcurrentTasks: input.maxConcurrentTasks ?? current.maxConcurrentTasks,
    leaseTtlMs: input.leaseTtlMs ?? current.leaseTtlMs,
    maxAttempts: input.maxAttempts ?? current.maxAttempts,
  };
  if (!Number.isInteger(next.maxConcurrentTasks) || next.maxConcurrentTasks < 1 || next.maxConcurrentTasks > 8) throw new Error('maxConcurrentTasks must be an integer between 1 and 8');
  if (!Number.isInteger(next.leaseTtlMs) || next.leaseTtlMs < 1_000 || next.leaseTtlMs > 10 * 60_000) throw new Error('leaseTtlMs must be an integer between 1000 and 600000');
  if (!Number.isInteger(next.maxAttempts) || next.maxAttempts < 1 || next.maxAttempts > 5) throw new Error('maxAttempts must be an integer between 1 and 5');
  const db = getOsDb();
  db.prepare('INSERT INTO os_settings (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(workspaceId, EXECUTION_LIMITS_KEY, JSON.stringify(next), nowIso());
  audit(db, { workspaceId, actor, action: 'settings.execution_limits', subject: EXECUTION_LIMITS_KEY, detail: next });
  return next;
}

/* ─── Mission-level leases ─────────────────────────────── */
export interface MissionLease {
  missionId: string;
  workspaceId: string;
  ownerId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: number;
  updatedAt: string;
}

const missionLeaseView = (row: Record<string, string | number>): MissionLease => ({
  missionId: String(row['mission_id']), workspaceId: String(row['workspace_id']), ownerId: String(row['owner_id']),
  acquiredAt: String(row['acquired_at']), heartbeatAt: String(row['heartbeat_at']),
  expiresAt: Number(row['expires_at']), updatedAt: String(row['updated_at']),
});

/**
 * Claim a mission before an executor starts it. This is the mission-level
 * duplicate-execution boundary above task leases. It is safe across processes
 * sharing SQLite because the SELECT and conditional upsert run in one
 * BEGIN IMMEDIATE transaction.
 */
export function claimMissionLease(input: { workspaceId: string; missionId: string; ownerId: string; ttlMs?: number }): MissionLease | null {
  const db = getOsDb();
  const ttlMs = Math.min(Math.max(input.ttlMs ?? 30_000, 1_000), 10 * 60_000);
  db.exec('BEGIN IMMEDIATE');
  try {
    const mission = db.prepare('SELECT status FROM os_missions WHERE workspace_id = ? AND id = ?')
      .get(input.workspaceId, input.missionId) as { status?: string } | undefined;
    if (!mission || ['completed', 'cancelled', 'paused'].includes(mission.status ?? '')) { db.exec('ROLLBACK'); return null; }
    const existing = db.prepare('SELECT * FROM os_mission_leases WHERE mission_id = ?').get(input.missionId) as Record<string, string | number> | undefined;
    const now = Date.now();
    if (existing && Number(existing['expires_at']) > now && String(existing['owner_id']) !== input.ownerId) {
      db.exec('ROLLBACK');
      return null;
    }
    if (existing && Number(existing['expires_at']) > now && String(existing['owner_id']) === input.ownerId) {
      db.exec('COMMIT');
      return missionLeaseView(existing);
    }
    const ts = nowIso();
    const lease: MissionLease = {
      missionId: input.missionId, workspaceId: input.workspaceId, ownerId: input.ownerId,
      acquiredAt: ts, heartbeatAt: ts, expiresAt: now + ttlMs, updatedAt: ts,
    };
    db.prepare(`INSERT INTO os_mission_leases (mission_id, workspace_id, owner_id, acquired_at, heartbeat_at, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id) DO UPDATE SET workspace_id = excluded.workspace_id, owner_id = excluded.owner_id,
        acquired_at = excluded.acquired_at, heartbeat_at = excluded.heartbeat_at, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
      .run(lease.missionId, lease.workspaceId, lease.ownerId, lease.acquiredAt, lease.heartbeatAt, lease.expiresAt, lease.updatedAt);
    audit(db, { workspaceId: input.workspaceId, actor: input.ownerId, action: 'mission.lease.claim', subject: input.missionId, detail: { expiresAt: lease.expiresAt } });
    db.exec('COMMIT');
    return lease;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw error;
  }
}

export function heartbeatMissionLease(input: { workspaceId: string; missionId: string; ownerId: string; ttlMs?: number }): boolean {
  const now = Date.now();
  const ttlMs = Math.min(Math.max(input.ttlMs ?? 30_000, 1_000), 10 * 60_000);
  const result = getOsDb().prepare('UPDATE os_mission_leases SET heartbeat_at = ?, expires_at = ?, updated_at = ? WHERE workspace_id = ? AND mission_id = ? AND owner_id = ? AND expires_at > ?')
    .run(nowIso(), now + ttlMs, nowIso(), input.workspaceId, input.missionId, input.ownerId, now);
  return Number(result.changes ?? 0) === 1;
}

export function releaseMissionLease(input: { workspaceId: string; missionId: string; ownerId: string }): boolean {
  const db = getOsDb();
  const result = db.prepare('DELETE FROM os_mission_leases WHERE workspace_id = ? AND mission_id = ? AND owner_id = ?')
    .run(input.workspaceId, input.missionId, input.ownerId);
  if (Number(result.changes ?? 0) === 1) {
    audit(db, { workspaceId: input.workspaceId, actor: input.ownerId, action: 'mission.lease.release', subject: input.missionId, detail: {} });
    return true;
  }
  return false;
}

export function getMissionLease(workspaceId: string, missionId: string): MissionLease | null {
  const row = getOsDb().prepare('SELECT * FROM os_mission_leases WHERE workspace_id = ? AND mission_id = ?').get(workspaceId, missionId) as Record<string, string | number> | undefined;
  return row ? missionLeaseView(row) : null;
}

export function listMissionLeases(workspaceId: string): MissionLease[] {
  const rows = getOsDb().prepare('SELECT * FROM os_mission_leases WHERE workspace_id = ? ORDER BY acquired_at DESC LIMIT 100').all(workspaceId);
  return (rows as unknown as Array<Record<string, string | number>>).map(missionLeaseView);
}

export function recoverExpiredMissionLeases(workspaceId?: string): number {
  const db = getOsDb();
  const now = Date.now();
  const rows = workspaceId
    ? db.prepare('SELECT * FROM os_mission_leases WHERE workspace_id = ? AND expires_at <= ?').all(workspaceId, now)
    : db.prepare('SELECT * FROM os_mission_leases WHERE expires_at <= ?').all(now);
  let recovered = 0;
  for (const row of rows as unknown as Array<Record<string, string | number>>) {
    const result = db.prepare('DELETE FROM os_mission_leases WHERE mission_id = ? AND owner_id = ? AND expires_at <= ?')
      .run(String(row['mission_id']), String(row['owner_id']), now);
    if (Number(result.changes ?? 0) === 1) {
      audit(db, { workspaceId: String(row['workspace_id']), actor: 'system', action: 'mission.lease.expired', subject: String(row['mission_id']), detail: { ownerId: row['owner_id'], expiresAt: row['expires_at'] } });
      recovered += 1;
    }
  }
  return recovered;
}
