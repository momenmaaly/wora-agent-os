# WORA Concurrent Mission Scheduler

**Status:** implemented on the existing durable lease layer.
**Source:** `api-server/src/os/orchestrator.ts`, `task-queue.ts`, tests.

## What is real

- `executeMission(missionId, actor, { concurrency })` starts up to eight workers.
- Every task is claimed through `claimTask` inside a `BEGIN IMMEDIATE` transaction. A second worker receives `null`.
- Workers heartbeat the lease while a tool runs; an expired lease is recoverable.
- Dependencies are read from live `os_tasks` state, not a stale in-memory set. A dependent task is never claimed before every dependency is `completed`.
- A failed dependency blocks dependents; independent tasks continue.
- Cancellation is checked before and after a tool run. A cancelled run is recorded as cancelled and its result is not accepted.
- Orphaned `planned`/`assigned`/`running` tasks with no active lease are finalized as blocked instead of leaving a mission permanently running.
- Per-workspace limits are persisted in `os_settings` under `execution_limits`: `maxConcurrentTasks` (1–8), `leaseTtlMs` (1s–10m) and `maxAttempts` (1–5).

## APIs

- `POST /api/os/missions/:id/execute` with optional `{ "concurrency": 1..8 }`.
- `GET /api/os/settings/execution-limits`.
- `POST /api/os/settings/execution-limits` (admin).
- `GET /api/os/missions/:id/leases`.
- `GET /api/os/tasks/:id/checkpoints`.

## Evidence

`task-queue.test.ts` covers exclusive claims, heartbeat expiry, checkpoint transitions, side-effect uncertainty, pause/resume, cancellation, restart recovery, completed-task protection, two independent tasks under concurrency 2, and dependency ordering under concurrency 4.

## Limits

- Workers run inside one API process. SQLite remains the single-writer boundary.
- There is no separate scheduler daemon or cross-process supervisor.
- The scheduler does not claim linear speedup. Parallel execution is only for tasks whose dependencies are satisfied.
- Retries use the existing attempt limit and the same resolved agent; agent reassignment is not implemented.
