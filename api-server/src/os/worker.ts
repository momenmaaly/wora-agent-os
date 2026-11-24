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
import { getExecutionLimits, listTaskLeases } from './task-queue.js';
import { recoveryReport } from './recovery.js';

export interface WorkerStatus {
  mode: 'opt-in-single-process';
  durableStore: boolean;
  missionLease: false;
  taskLeases: true;
  checkpoints: true;
  independentWorkers: 'opt-in';
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
    mode: 'opt-in-single-process',
    durableStore: process.env['WORA_OS_DB'] !== ':memory:',
    missionLease: false,
    taskLeases: true,
    checkpoints: true,
    independentWorkers: 'opt-in',
    limitations: [
      'SQLite is a single-writer store; use one worker process per database file unless you accept serialized writes.',
      'There is no distributed mission lease; task leases prevent duplicate task side effects, not duplicate finalization.',
      'No paid queue or external service is required or configured.',
    ],
  };
}

function runnableMissions(workspaceId: string | null): Array<{ id: string; workspace_id: string; status: string }> {
  const db = getOsDb();
  const rows = workspaceId
    ? db.prepare("SELECT id, workspace_id, status FROM os_missions WHERE workspace_id = ? AND status = 'failed' ORDER BY updated_at ASC LIMIT 50").all(workspaceId)
    : db.prepare("SELECT id, workspace_id, status FROM os_missions WHERE status = 'failed' ORDER BY updated_at ASC LIMIT 50").all();
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
    const resumable = tasks.some((task) => task.status === 'blocked' && /interrupted|orphaned_assignment/u.test(task.detail))
      || tasks.some((task) => task.status === 'failed');
    if (!resumable) {
      result.skipped.push(mission.id);
      continue;
    }
    result.attempted.push(mission.id);
    try {
      await executeMission(mission.id, options.actor ?? 'os-worker');
      const status = (db.prepare('SELECT status FROM os_missions WHERE id = ?').get(mission.id) as { status?: string } | undefined)?.status;
      if (status === 'completed') result.completed.push(mission.id);
      else result.failed.push(mission.id);
    } catch {
      result.failed.push(mission.id);
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
    runnableMissions: runnableMissions(workspaceId).map((mission) => ({ id: mission.id, status: mission.status })),
  };
}
