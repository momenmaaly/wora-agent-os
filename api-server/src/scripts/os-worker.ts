/**
 * Opt-in WORA OS worker process. Requires a file-backed WORA_OS_DB and a
 * workspace id. It does not start an API listener and does not deploy anything.
 *
 * WORA_OS_ROLE=worker is set before the database module loads. Workers are
 * separate SQLite write clients; mission/task leases prevent duplicate work.
 */
process.env['WORA_OS_ROLE'] = 'worker';

const workspaceId = process.env['WORA_OS_WORKSPACE_ID'] ?? process.argv[2] ?? '';
if (!workspaceId) {
  console.error('WORA_OS_WORKSPACE_ID (or argv[2]) is required');
  process.exit(2);
}
if (process.env['WORA_OS_DB'] === ':memory:') {
  console.error('The worker needs a file-backed WORA_OS_DB; :memory: cannot be shared with the API process');
  process.exit(2);
}
const { startWorker, workerStatus } = await import('../os/worker.js');
const intervalMs = Number(process.env['WORA_OS_WORKER_INTERVAL_MS'] ?? 15_000);
const handle = startWorker({ workspaceId, intervalMs, actor: 'os-worker', maxMissions: 1 });
console.log(JSON.stringify({ event: 'worker.started', workspaceId, intervalMs, pid: process.pid, status: workerStatus() }));
const shutdown = () => { handle.stop(); void handle.done.finally(() => process.exit(0)); };
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
await handle.done;
