/**
 * WORA OS — real process-boundary recovery.
 *
 * Starts the API and a worker as separate OS processes over one SQLite file,
 * kills the worker with SIGKILL while a task is executing, then starts a new
 * worker. The idempotent read tool must retry safely, completed work must not
 * duplicate, and the dependent task must run only after the prerequisite is
 * verified.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-process-'));
const DB_PATH = path.join(TMP, 'wora.db');
const WORKSPACE = path.join(TMP, 'workspace');
mkdirSync(WORKSPACE, { recursive: true });
const TSX = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const API_PORT = 44000 + Math.floor(Math.random() * 1000);
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const WS = 'wora-preview';
let TEST_FETCH_PORT = '';

function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    WORA_OS_DB: DB_PATH,
    WORA_WORKSPACE: WORKSPACE,
    WORA_OS_WORKSPACE_ID: WS,
    WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS: '1',
    WORA_TEST_ALLOWED_PORTS: TEST_FETCH_PORT,
    WORA_MCP_RESOURCE_LIMITS: '0',
    ...extra,
  };
}

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function api(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-workspace': WS, ...(init?.headers ?? {}) },
  });
}

async function startApi(): Promise<ChildProcess> {
  const child = spawn(TSX, ['src/scripts/preview-server.ts'], {
    cwd: process.cwd(), env: childEnv({ PORT: String(API_PORT), PREVIEW_HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  await waitFor('API health', async () => {
    try { return (await api('/api/os/missions')).ok ? true : null; } catch { return null; }
  }, 20_000).catch((error) => { throw new Error(`${error.message}\nAPI output:\n${output}`); });
  return child;
}

function startWorker(): ChildProcess {
  const child = spawn(TSX, ['src/scripts/os-worker.ts'], {
    cwd: process.cwd(), env: childEnv({ WORA_OS_WORKER_INTERVAL_MS: '200' }),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (chunk: Buffer) => { process.stderr.write(`[worker] ${chunk.toString('utf8')}`); });
  child.stderr.on('data', (chunk: Buffer) => { process.stderr.write(`[worker:err] ${chunk.toString('utf8')}`); });
  return child;
}

async function stop(child: ChildProcess | null, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    try { child.kill(signal); } catch { resolve(); }
    setTimeout(resolve, 3_000).unref();
  });
}

let slowServer: Server | null = null;

test('worker SIGKILL mid-task is recovered by a new process without duplicate completed work', async () => {
  slowServer = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('slow research source');
    }, 3_500);
  });
  await new Promise<void>((resolve) => slowServer!.listen(0, '127.0.0.1', resolve));
  const slowPort = (slowServer!.address() as { port: number }).port;
  TEST_FETCH_PORT = String(slowPort);
  mkdirSync(path.join(WORKSPACE, WS), { recursive: true });
  writeFileSync(path.join(WORKSPACE, WS, 'after-research.txt'), 'dependent artifact', 'utf8');

  const apiProcess = await startApi();
  let worker: ChildProcess | null = null;
  try {
    const created = await api('/api/os/missions', {
      method: 'POST',
      body: JSON.stringify({ objective: `research http://127.0.0.1:${slowPort}/slow and summarize it`, execute: false }),
    });
    assert.equal(created.status, 202);
    const mission = await created.json() as { id: string; tasks: Array<{ id: string; tool: string }> };
    assert.equal(mission.tasks.length, 1);
    assert.equal(mission.tasks[0]!.tool, 'web.fetch_read');

    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA busy_timeout = 5000;');
    const now = new Date().toISOString();
    const secondTaskId = `tsk_process_${Date.now()}`;
    db.prepare(`INSERT INTO os_tasks
      (id, mission_id, workspace_id, order_index, title, objective, specialization, status, agent_id, depends_on, acceptance, tool, tool_input, detail, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'Read the dependent artifact', 'Read after research', 'security_engineer', 'planned', NULL, ?, ?, 'fs.workspace_read', ?, 'dependent fixture', ?, ?)`)
      .run(secondTaskId, mission.id, WS, JSON.stringify([mission.tasks[0]!.id]),
        JSON.stringify(['Artifact read after the prerequisite completes']),
        JSON.stringify({ path: 'after-research.txt' }), now, now);
    db.prepare('INSERT INTO os_settings (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(WS, 'execution_limits', JSON.stringify({ maxConcurrentTasks: 2, leaseTtlMs: 1_200, maxAttempts: 2 }), now);
    db.close();

    worker = startWorker();
    await waitFor('first task running', async () => {
      const response = await api(`/api/os/missions/${mission.id}`);
      if (!response.ok) return null;
      const detail = await response.json() as { tasks: Array<{ status: string }> };
      if (detail.tasks[0]?.status === 'failed' || detail.tasks[0]?.status === 'blocked') {
        throw new Error(`first task did not start: ${JSON.stringify(detail)}`);
      }
      return detail.tasks[0]?.status === 'running' ? true : null;
    }, 15_000);
    try { process.kill(-worker.pid!, 'SIGKILL'); } catch { /* process group already gone */ }
    worker.kill('SIGKILL');
    await new Promise((resolve) => worker!.once('exit', resolve));

    // The killed worker's mission and task leases expire. A fresh process must
    // reclaim the running mission and retry the idempotent read.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    worker = startWorker();
    const detail = await waitFor('mission completion after worker restart', async () => {
      const response = await api(`/api/os/missions/${mission.id}`);
      if (!response.ok) return null;
      const value = await response.json() as { status: string; tasks: Array<{ id: string; status: string; tool: string; detail?: string }> };
      if (['failed', 'cancelled'].includes(value.status) || value.tasks.some((task) => task.status === 'failed')) {
        throw new Error(`mission did not recover: ${JSON.stringify(value)}`);
      }
      return value.status === 'completed' ? value : null;
    }, 20_000).catch(async (error) => {
      const response = await api(`/api/os/missions/${mission.id}`);
      throw new Error(`${error.message}\nfinal detail: ${await response.text()}`);
    });

    assert.equal(detail.tasks.length, 2);
    assert.equal(detail.tasks[0]!.tool, 'web.fetch_read');
    assert.equal(detail.tasks[0]!.status, 'completed');
    assert.equal(detail.tasks[1]!.status, 'completed');

    const inspect = new DatabaseSync(DB_PATH);
    try {
      const runs = inspect.prepare('SELECT status FROM os_runs WHERE task_id = ? ORDER BY started_at').all(detail.tasks[0]!.id) as Array<{ status: string }>;
      assert.ok(runs.some((run) => run.status === 'interrupted'), 'the killed attempt is recorded as interrupted');
      assert.ok(runs.some((run) => run.status === 'completed'), 'the recovered attempt completed');
      const checkpoints = inspect.prepare('SELECT status FROM os_task_checkpoints WHERE task_id = ? ORDER BY created_at').all(detail.tasks[0]!.id) as Array<{ status: string }>;
      assert.ok(checkpoints.some((checkpoint) => checkpoint.status === 'started'));
      assert.ok(checkpoints.some((checkpoint) => checkpoint.status === 'completed'));
      const handoffs = inspect.prepare('SELECT COUNT(*) AS c FROM os_handoffs WHERE mission_id = ?').get(mission.id) as { c: number };
      assert.equal(Number(handoffs.c), 2);
      const missionLeases = inspect.prepare('SELECT COUNT(*) AS c FROM os_mission_leases WHERE mission_id = ?').get(mission.id) as { c: number };
      assert.equal(Number(missionLeases.c), 0, 'normal completion releases the mission lease');
    } finally {
      inspect.close();
    }
  } finally {
    await stop(worker, 'SIGKILL');
    await stop(apiProcess, 'SIGTERM');
    if (slowServer) await new Promise<void>((resolve) => slowServer!.close(() => resolve()));
    rmSync(TMP, { recursive: true, force: true });
  }
});
