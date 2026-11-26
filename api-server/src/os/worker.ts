/**
 * WORA OS — opt-in durable mission worker.
 *
 * This is not a distributed scheduler. It is a small, explicit worker loop over
 * the existing SQLite-backed missions, task leases and checkpoints. It can be
 * run as a separate process with `npm run worker:os`; the API process remains
 * usable without it. Task leases still prevent duplicate side effects when more
 * than one worker is started against the same database.
 */
import { getOsDb } from './db.js';
import { executeMission } from './orchestrator.js';
import { getExecutionLimits, listTaskLeases, claimMissionLease, releaseMissionLease, listMissionLeases } from './task-queue.js';
import { recoveryReport } from './recovery.js';

export interface WorkerStatus {
  mode: 'opt-in-worker';
  durableStore: boolean;
  missionLease: true;
  taskLeases: true;
  checkpoints: true;
  independentWorkers: 'supported-with-sqlite-serialization';
  limitations: string[];
}

export interface WorkerRunResult {
  workspaceId: string | null;
  attempted: string[];
  completed: string[];
  failed: string[];
  skipped: string[];
}

export function workerStatus(): WorkerStatus {
  return {
    mode: 'opt-in-worker',
    durableStore: process.env['WORA_OS_DB'] !== ':memory:',
    missionLease: true,
    taskLeases: true,
    checkpoints: true,
    independentWorkers: 'supported-with-sqlite-serialization',
    limitations: [
      'SQLite WAL serializes writes; workers are separate write clients protected by mission and task leases, not a distributed queue.',
      'Mission leases prevent two workers from executing the same mission, but there is no cross-host consensus or queue.',
      'A worker process killed mid-tool leaves a started checkpoint; idempotent tools may retry, side-effecting tools require manual review.',
      'No paid queue or external service is required or configured.',
    ],
  };
}

function runnableMissions(workspaceId: string | null): Array<{ id: string; workspace_id: string; status: string }> {
  const db = getOsDb();
  const rows = workspaceId
    ? db.prepare("SELECT id, workspace_id, status FROM os_missions WHERE workspace_id = ? AND status IN ('failed', 'running', 'planning') ORDER BY updated_at ASC LIMIT 50").all(workspaceId)
    : db.prepare("SELECT id, workspace_id, status FROM os_missions WHERE status IN ('failed', 'running', 'planning') ORDER BY updated_at ASC LIMIT 50").all();
  return rows as Array<{ id: string; workspace_id: string; status: string }>;
}

/** Execute at most `maxMissions` resumable failed missions once. */
export async function runWorkerOnce(options: { workspaceId?: string | null; actor?: string; maxMissions?: number } = {}): Promise<WorkerRunResult> {
  const workspaceId = options.workspaceId ?? null;
  const maxMissions = Math.min(Math.max(options.maxMissions ?? 1, 1), 10);
  const result: WorkerRunResult = { workspaceId, attempted: [], completed: [], failed: [], skipped: [] };
  const candidates = runnableMissions(workspaceId).slice(0, maxMissions);
  for (const mission of candidates) {
    const db = getOsDb();
    const tasks = db.prepare('SELECT status, detail FROM os_tasks WHERE mission_id = ?').all(mission.id) as Array<{ status: string; detail: string }>;
    const resumable = tasks.some((task) => ['created', 'planned', 'assigned', 'running'].includes(task.status))
      || tasks.some((task) => task.status === 'blocked' && /interrupted|orphaned_assignment|lease_expired/u.test(task.detail))
      || tasks.some((task) => task.status === 'failed');
    if (!resumable) {
      result.skipped.push(mission.id);
      continue;
    }
    const owner = options.actor === 'os-worker' ? `os-worker:${process.pid}:${mission.id}` : `${options.actor ?? 'worker'}:${process.pid}:${mission.id}`;
    const lease = claimMissionLease({ workspaceId: mission.workspace_id, missionId: mission.id, ownerId: owner, ttlMs: getExecutionLimits(mission.workspace_id).leaseTtlMs });
    if (!lease) { result.skipped.push(mission.id); continue; }
    result.attempted.push(mission.id);
    try {
      await executeMission(mission.id, options.actor ?? 'os-worker', {
        missionLeaseOwner: owner, skipMissionLease: true,
        missionLeaseTtlMs: getExecutionLimits(mission.workspace_id).leaseTtlMs,
      });
      const status = (db.prepare('SELECT status FROM os_missions WHERE id = ?').get(mission.id) as { status?: string } | undefined)?.status;
      if (status === 'completed') result.completed.push(mission.id);
      else result.failed.push(mission.id);
    } catch {
      result.failed.push(mission.id);
    } finally {
      releaseMissionLease({ workspaceId: mission.workspace_id, missionId: mission.id, ownerId: owner });
    }
  }
  return result;
}

export interface WorkerHandle {
  stop: () => void;
  done: Promise<void>;
}

/** Start an opt-in polling worker. Abort or stop() is graceful between cycles. */
export function startWorker(options: { workspaceId?: string | null; actor?: string; intervalMs?: number; maxMissions?: number; signal?: AbortSignal } = {}): WorkerHandle {
  const intervalMs = Math.min(Math.max(options.intervalMs ?? 15_000, 1_000), 3_600_000);
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  let stopped = false;
  const stop = () => { stopped = true; controller.abort(); };
  const done = (async () => {
    while (!stopped && !signal.aborted) {
      await runWorkerOnce({ workspaceId: options.workspaceId ?? null, actor: options.actor, maxMissions: options.maxMissions });
      if (stopped || signal.aborted) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        timer.unref?.();
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  })();
  return { stop, done };
}

export function workerSnapshot(workspaceId: string): Record<string, unknown> {
  return {
    ...workerStatus(),
    limits: getExecutionLimits(workspaceId),
    recovery: recoveryReport(workspaceId),
    activeLeases: listTaskLeases(workspaceId).length,
    activeMissionLeases: listMissionLeases(workspaceId).length,
    runnableMissions: runnableMissions(workspaceId).map((mission) => ({ id: mission.id, status: mission.status })),
  };
}
