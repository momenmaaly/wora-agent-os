# WORA Durable Autonomous Runtime

**Status:** durable task leases, checkpoints, pause/resume/cancel and restart recovery are implemented and tested.
**Source:** `api-server/src/os/task-queue.ts`, `orchestrator.ts`, `db.ts`, `router.ts`.

## 1. Task leases

`os_task_leases` has one row per claimed task:

- `owner_id`, `mission_id`, `workspace_id`.
- `acquired_at`, `heartbeat_at`, `expires_at`.
- Primary key on `task_id`.

`claimTask` uses `BEGIN IMMEDIATE`. A second owner receives `null` while the first lease is live. An expired lease can be recovered; the task is marked `blocked` with `lease_expired` until a safe retry.

## 2. Heartbeats

The orchestrator starts a heartbeat timer while a task is executing and stops it in `finally`. The interval is one third of the lease TTL, with a minimum of one second. Heartbeats extend the lease only for the owning worker.

## 3. Checkpoints

`os_task_checkpoints` records `started`, `completed`, `failed` or `blocked` for each run:

- run id, attempt, output digest, evidence digest and bounded checkpoint JSON.
- unique `(task_id, run_id)`.

The orchestrator writes `started` before execution and a terminal state after review. If a process dies after `started` but before completion, a retry marks the task `side_effect_uncertain` instead of risking a duplicate external effect.

## 4. Pause, resume, cancel

- `POST /api/os/missions/:id/pause` sets `paused`; execution stops at the next task boundary.
- `POST /api/os/missions/:id/resume` sets `running` and executes again.
- `POST /api/os/missions/:id/cancel` sets `cancelled`, marks unfinished tasks cancelled and clears all leases.
- `GET /api/os/missions/:id/leases` exposes current leases.
- `GET /api/os/tasks/:id/checkpoints` exposes checkpoint history.

## 5. Restart recovery

`markInterruptedMissions` now:

- recovers expired leases;
- clears stale mission leases;
- marks in-flight runs interrupted;
- marks unfinished tasks blocked with an honest restart reason;
- leaves completed tasks untouched so resume is idempotent.

## 6. Safe parallelism

The lease transaction is the concurrency boundary. Multiple workers may claim different tasks from the same mission, and two workers cannot both receive the same active task lease. The current mission executor still processes its own claimed tasks sequentially; the durable claim layer is the foundation for a fully concurrent scheduler.

## 7. Tests

`api-server/src/os/task-queue.test.ts` covers exclusive claims, idempotent same-owner claims, heartbeat authorization, expiry recovery, checkpoints, uncertain side effects, pause/resume, cancellation and restart recovery.

## 8. Limits

- A running tool call is not aborted mid-flight; pause/cancel take effect at the next boundary.
- Per-task wall-clock timeout is inherited from the tool registry timeout, not a separate task-level deadline.
- There is no priority queue, fair scheduling, or automatic retry backoff policy yet.
- The fully concurrent mission scheduler is not implemented; multi-worker claim safety is.

## 9. Opt-in worker (2026-11-24)

`api-server/src/os/worker.ts` adds a deliberately small worker for resumable failed missions:

- `runWorkerOnce({ workspaceId, maxMissions })` selects failed missions with interrupted/blocked or failed tasks and executes them once;
- `startWorker({ workspaceId, intervalMs })` polls until stopped or aborted;
- `workerSnapshot(workspaceId)` is exposed at `GET /api/os/runtime/status`;
- `npm run worker:os` starts a separate process with a file-backed `WORA_OS_DB` and `WORA_OS_WORKSPACE_ID`.

The worker is **opt-in**. The API process does not spawn it automatically. It is not a distributed scheduler: SQLite remains a single-writer store, there is no mission-level lease, and task leases are the duplicate-side-effect boundary. Use one worker per database unless serialized writes are acceptable. A PostgreSQL adapter and a real distributed queue remain future work.

## 10. Deployment architecture for continuous execution

The verified architecture is a **single API process plus an optional single worker process** sharing one file-backed SQLite database:

```
reverse proxy / TLS
        |
   WORA API (AUTH_SECRET, extension keyring)
        |  same WORA_OS_DB file
   WORA worker (npm run worker:os)
        |
   workspace volume
```

- Run the API and worker on the same host or a host with a reliable shared filesystem and SQLite locking.
- Do not run multiple SQLite writers against the same file without accepting serialized writes and testing contention.
- The worker requires `WORA_OS_DB` to be a file path, not `:memory:`, and `WORA_OS_WORKSPACE_ID`.
- The API boot recovery and worker recovery are idempotent for completed tasks; an in-flight tool call is not aborted mid-flight.
- This is not a claim of 24/7 distributed operation. A PostgreSQL adapter, mission-level lease and external queue are required before horizontal scaling.
