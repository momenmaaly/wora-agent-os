/**
 * WORA OS — process-fault recovery at each durable boundary.
 *
 * Each test starts a real API and a real worker process against one SQLite
 * file, kills the worker at a named boundary, then starts a new worker and
 * asserts the outcome. No mocks are used for the database or worker loop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const TSX = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const WS = 'wora-preview';

interface Harness { root: string; dbPath: string; workspace: string; port: number; api: ChildProcess; base: string }

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function startHarness(): Promise<Harness> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wora-fault-'));
  const workspace = path.join(root, 'workspace');
  mkdirSync(path.join(workspace, WS), { recursive: true });
  const dbPath = path.join(root, 'wora.db');
  const port = 45000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, NODE_ENV: 'test', WORA_OS_DB: dbPath, WORA_WORKSPACE: workspace,
    WORA_OS_WORKSPACE_ID: WS, PORT: String(port), PREVIEW_HOST: '127.0.0.1',
  };
  const api = spawn(TSX, ['src/scripts/preview-server.ts'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  api.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  api.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  await waitFor('API health', async () => {
    try { return (await fetch(`${base}/api/os/missions`)).ok ? true : null; } catch { return null; }
  }, 20_000).catch((error) => { throw new Error(`${error.message}\n${output}`); });
  return { root, dbPath, workspace, port, api, base };
}

async function stop(child: ChildProcess | null, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    try { child.kill(signal); } catch { resolve(); }
    setTimeout(resolve, 3_000).unref();
  });
}

function startWorker(h: Harness, extra: Record<string, string> = {}): ChildProcess {
  const child = spawn(TSX, ['src/scripts/os-worker.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: 'test', WORA_OS_DB: h.dbPath, WORA_WORKSPACE: h.workspace,
      WORA_OS_WORKSPACE_ID: WS, WORA_OS_WORKER_INTERVAL_MS: '150', ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (chunk: Buffer) => { process.stderr.write(`[fault-worker] ${chunk.toString('utf8')}`); });
  child.stderr.on('data', (chunk: Buffer) => { process.stderr.write(`[fault-worker:err] ${chunk.toString('utf8')}`); });
  return child;
}

async function killGroup(child: ChildProcess): Promise<void> {
  try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
  child.kill('SIGKILL');
  if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once('exit', resolve));
}

async function request<T>(h: Harness, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${h.base}${pathname}`, {
    ...init, headers: { 'content-type': 'application/json', 'x-workspace': WS, ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function fixture(h: Harness, task: { tool: string; input: Record<string, unknown> }): Promise<string> {
  const created = await request<{ id: string; tasks: Array<{ id: string }> }>(h, '/api/os/missions', {
    method: 'POST', body: JSON.stringify({ objective: 'deterministic fault fixture', track: 'generic', execute: false }),
  });
  const db = new DatabaseSync(h.dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    const now = new Date().toISOString();
    const specialization = task.tool === 'scaffold.webapp' ? 'frontend_engineer' : task.tool === 'host.exec' ? 'qa_engineer' : 'security_engineer';
    db.prepare('UPDATE os_tasks SET tool = ?, tool_input = ?, specialization = ?, status = ?, acceptance = ?, detail = ? WHERE id = ?')
      .run(task.tool, JSON.stringify(task.input), specialization, 'planned', JSON.stringify(['Deterministic fixture passes']), 'fault fixture', created.tasks[0]!.id);
    db.prepare('INSERT INTO os_settings (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(WS, 'execution_limits', JSON.stringify({ maxConcurrentTasks: 2, leaseTtlMs: 1_000, maxAttempts: 1 }), now);
  } finally {
    db.close();
  }
  return created.id;
}

async function mission(h: Harness, id: string): Promise<{ status: string; tasks: Array<{ id: string; status: string; detail: string; runs: Array<{ status: string }> }>; approvals: Array<{ id: string; status: string }> }> {
  return request(h, `/api/os/missions/${id}`);
}

function cleanup(h: Harness, worker: ChildProcess | null): Promise<void> {
  return (async () => {
    await stop(worker, 'SIGKILL');
    await stop(h.api, 'SIGTERM');
    rmSync(h.root, { recursive: true, force: true });
  })();
}

test('kill after verification retries an idempotent tool and completes', async () => {
  const h = await startHarness();
  let worker: ChildProcess | null = null;
  try {
    writeFileSync(path.join(h.workspace, WS, 'fixture.txt'), 'fixture', 'utf8');
    const missionId = await fixture(h, { tool: 'fs.workspace_read', input: { path: 'fixture.txt' } });
    worker = startWorker(h, { WORA_TEST_KILL_AT: 'after-verification' });
    await waitFor('worker to die after verification', async () => worker!.exitCode !== null || worker!.signalCode !== null ? true : null);
    assert.notEqual(worker.exitCode, 0);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    worker = startWorker(h);
    const done = await waitFor('recovered mission', async () => {
      const value = await mission(h, missionId);
      return value.status === 'completed' ? value : null;
    }, 15_000).catch(async (error) => {
      throw new Error(`${error.message}\nfinal: ${JSON.stringify(await mission(h, missionId))}`);
    });
    assert.equal(done.tasks[0]!.status, 'completed');
    assert.ok(done.tasks[0]!.runs.length >= 2, 'the interrupted run and the safe retry are both recorded');
  } finally {
    await cleanup(h, worker);
  }
});

test('kill after handoff recovers the completed checkpoint without a duplicate handoff', async () => {
  const h = await startHarness();
  let worker: ChildProcess | null = null;
  try {
    writeFileSync(path.join(h.workspace, WS, 'fixture.txt'), 'fixture', 'utf8');
    const missionId = await fixture(h, { tool: 'fs.workspace_read', input: { path: 'fixture.txt' } });
    worker = startWorker(h, { WORA_TEST_KILL_AT: 'after-handoff' });
    await waitFor('worker to die after handoff', async () => worker!.exitCode !== null || worker!.signalCode !== null ? true : null);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    worker = startWorker(h);
    const done = await waitFor('recovered mission', async () => {
      const value = await mission(h, missionId);
      return value.status === 'completed' ? value : null;
    }, 15_000);
    assert.equal(done.tasks[0]!.status, 'completed');
    const db = new DatabaseSync(h.dbPath);
    try {
      const count = db.prepare('SELECT COUNT(*) AS c FROM os_handoffs WHERE mission_id = ?').get(missionId) as { c: number };
      assert.equal(Number(count.c), 1);
    } finally { db.close(); }
  } finally {
    await cleanup(h, worker);
  }
});

test('kill after the start checkpoint never repeats a non-idempotent tool', async () => {
  const h = await startHarness();
  let worker: ChildProcess | null = null;
  try {
    const missionId = await fixture(h, { tool: 'scaffold.webapp', input: { name: 'faultapp' } });
    worker = startWorker(h, { WORA_TEST_KILL_AT: 'after-start-checkpoint' });
    await waitFor('worker to die after start checkpoint', async () => worker!.exitCode !== null || worker!.signalCode !== null ? true : null);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    worker = startWorker(h);
    const blocked = await waitFor('side-effect-uncertain task', async () => {
      const value = await mission(h, missionId);
      const task = value.tasks[0]!;
      return task.status === 'blocked' && /side_effect_uncertain/u.test(task.detail) ? value : null;
    }, 15_000);
    const db = new DatabaseSync(h.dbPath);
    try {
      const checkpoints = db.prepare('SELECT status FROM os_task_checkpoints WHERE task_id = ?').all(blocked.tasks[0]!.id) as Array<{ status: string }>;
      assert.equal(checkpoints.filter((checkpoint) => checkpoint.status === 'started').length, 1);
      assert.equal(blocked.tasks[0]!.runs.length, 0, 'the non-idempotent tool was never executed');
    } finally { db.close(); }
  } finally {
    await cleanup(h, worker);
  }
});

test('kill while waiting for approval keeps one approval and resumes after a decision', async () => {
  const h = await startHarness();
  let worker: ChildProcess | null = null;
  try {
    writeFileSync(path.join(h.workspace, WS, 'approval.test.mjs'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('approval fixture passes', () => assert.equal(1, 1));
`, 'utf8');
    const missionId = await fixture(h, { tool: 'host.exec', input: { command: 'node', args: ['--test', 'approval.test.mjs'] } });
    worker = startWorker(h, { WORA_TEST_KILL_AT: 'after-approval-wait' });
    await waitFor('worker to die at approval boundary', async () => worker!.exitCode !== null || worker!.signalCode !== null ? true : null);
    const waiting = await mission(h, missionId);
    assert.equal(waiting.approvals.length, 1);
    assert.equal(waiting.approvals[0]!.status, 'pending');
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    worker = startWorker(h);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const stillWaiting = await mission(h, missionId);
    assert.equal(stillWaiting.approvals.length, 1, 'restart must not create a duplicate approval');
    await request(h, `/api/os/approvals/${stillWaiting.approvals[0]!.id}/decide`, {
      method: 'POST', body: JSON.stringify({ decision: 'approved', note: 'test approval' }),
    });
    const done = await waitFor('mission after approval', async () => {
      const value = await mission(h, missionId);
      return value.status === 'completed' ? value : null;
    }, 20_000).catch(async (error) => {
      throw new Error(`${error.message}\nfinal: ${JSON.stringify(await mission(h, missionId))}`);
    });
    assert.equal(done.tasks[0]!.status, 'completed');
    const db = new DatabaseSync(h.dbPath);
    try {
      const count = db.prepare('SELECT COUNT(*) AS c FROM os_approvals WHERE mission_id = ?').get(missionId) as { c: number };
      assert.equal(Number(count.c), 1);
    } finally { db.close(); }
  } finally {
    await cleanup(h, worker);
  }
});

test('two worker processes cannot execute the same mission twice', async () => {
  const h = await startHarness();
  let workers: ChildProcess[] = [];
  try {
    writeFileSync(path.join(h.workspace, WS, 'fixture.txt'), 'fixture', 'utf8');
    const missionId = await fixture(h, { tool: 'fs.workspace_read', input: { path: 'fixture.txt' } });
    workers = [startWorker(h), startWorker(h)];
    const done = await waitFor('mission completed with two workers', async () => {
      const value = await mission(h, missionId);
      return value.status === 'completed' ? value : null;
    }, 15_000);
    assert.equal(done.tasks[0]!.runs.length, 1, 'only the mission-lease owner executes the task');
    const db = new DatabaseSync(h.dbPath);
    try {
      const handoffs = db.prepare('SELECT COUNT(*) AS c FROM os_handoffs WHERE mission_id = ?').get(missionId) as { c: number };
      assert.equal(Number(handoffs.c), 1);
    } finally { db.close(); }
  } finally {
    for (const worker of workers) await stop(worker, 'SIGKILL');
    await cleanup(h, null);
  }
});
