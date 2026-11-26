import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {
  acquireWriterLease, ensureWriterLeaseTable, getOsDb, releaseWriterLease, renewWriterLease, resetOsDbForTests,
} from './db.js';

test('sqlite: a second writer is rejected until the first lease expires', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wora-lease-test-'));
  const db = new DatabaseSync(path.join(dir, 'wora.db'));
  try {
    ensureWriterLeaseTable(db);
    const first = acquireWriterLease(db, { ownerId: 'owner-a', host: 'host-a', pid: 1, now: 1_000, ttlMs: 1_000 });
    assert.equal(first, 'owner-a');
    assert.throws(
      () => acquireWriterLease(db, { ownerId: 'owner-b', host: 'host-b', pid: 2, now: 1_500, ttlMs: 1_000 }),
      /lease is held/,
    );
    assert.equal(renewWriterLease(db, 'owner-a', 1_500, 1_000), true);
    assert.throws(
      () => acquireWriterLease(db, { ownerId: 'owner-b', host: 'host-b', pid: 2, now: 2_000, ttlMs: 1_000 }),
      /lease is held/,
    );
    const second = acquireWriterLease(db, { ownerId: 'owner-b', host: 'host-b', pid: 2, now: 2_600, ttlMs: 1_000 });
    assert.equal(second, 'owner-b');
    releaseWriterLease(db, 'owner-b');
    const third = acquireWriterLease(db, { ownerId: 'owner-c', host: 'host-c', pid: 3, now: 3_000, ttlMs: 1_000 });
    assert.equal(third, 'owner-c');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sqlite: an older epoch cannot renew or release a newer owner lease', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wora-lease-epoch-'));
  const db = new DatabaseSync(path.join(dir, 'wora.db'));
  try {
    ensureWriterLeaseTable(db);
    acquireWriterLease(db, { ownerId: 'epoch-a', host: 'host-a', pid: 1, now: 1_000, ttlMs: 500 });
    const first = db.prepare('SELECT epoch FROM os_runtime_leases WHERE id = ?').get('os-sqlite-writer') as { epoch: number };
    assert.equal(Number(first.epoch), 1);
    acquireWriterLease(db, { ownerId: 'epoch-b', host: 'host-b', pid: 2, now: 2_000, ttlMs: 500 });
    const second = db.prepare('SELECT epoch FROM os_runtime_leases WHERE id = ?').get('os-sqlite-writer') as { epoch: number };
    assert.equal(Number(second.epoch), 2);
    assert.equal(renewWriterLease(db, 'epoch-a', 2_100, 500, Number(first.epoch)), false);
    releaseWriterLease(db, 'epoch-a', Number(first.epoch));
    const owner = db.prepare('SELECT owner_id FROM os_runtime_leases WHERE id = ?').get('os-sqlite-writer') as { owner_id: string };
    assert.equal(owner.owner_id, 'epoch-b');
    assert.equal(renewWriterLease(db, 'epoch-b', 2_100, 500, Number(second.epoch)), true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sqlite: getOsDb takes a file-backed writer lease and releases it on reset', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wora-lease-singleton-'));
  const previous = process.env['WORA_OS_DB'];
  process.env['WORA_OS_DB'] = path.join(dir, 'wora.db');
  try {
    const db = getOsDb();
    const row = db.prepare('SELECT owner_id, hostname, pid FROM os_runtime_leases WHERE id = ?').get('os-sqlite-writer') as { owner_id: string; hostname: string; pid: number } | undefined;
    assert.ok(row);
    assert.match(row.owner_id, /^wora:/u);
    assert.equal(row.pid, process.pid);
  } finally {
    resetOsDbForTests();
    if (previous === undefined) delete process.env['WORA_OS_DB'];
    else process.env['WORA_OS_DB'] = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sqlite: getOsDb refuses writes after another owner takes the lease', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wora-lease-takeover-'));
  const dbPath = path.join(dir, 'wora.db');
  const previous = process.env['WORA_OS_DB'];
  process.env['WORA_OS_DB'] = dbPath;
  try {
    getOsDb();
    const other = new DatabaseSync(dbPath);
    try {
      other.prepare('UPDATE os_runtime_leases SET owner_id = ?, epoch = epoch + 1 WHERE id = ?').run('takeover-owner', 'os-sqlite-writer');
    } finally {
      other.close();
    }
    assert.throws(() => getOsDb(), /lease was lost/);
  } finally {
    resetOsDbForTests();
    if (previous === undefined) delete process.env['WORA_OS_DB'];
    else process.env['WORA_OS_DB'] = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sqlite: production compose uses one API replica for the shared SQLite volume', () => {
  const compose = readFileSync(path.resolve(process.cwd(), '../docker-compose.prod.yml'), 'utf8');
  assert.doesNotMatch(compose, /replicas:\s*2/u);
  assert.match(compose, /replicas:\s*1/u);
  assert.match(compose, /SQLite/u);
});


function runLeaseProbe(args: string[]): Promise<{ code: number | null; output: string }> {
  const tsx = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  const probe = path.resolve(process.cwd(), 'src', 'os', 'lease-probe.ts');
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [probe, ...args], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('sqlite: two processes racing for the lease produce exactly one writer', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wora-lease-race-'));
  const dbPath = path.join(dir, 'wora.db');
  const barrier = path.join(dir, 'go');
  try {
    const first = runLeaseProbe([dbPath, 'race-a', 'acquire', barrier]);
    const second = runLeaseProbe([dbPath, 'race-b', 'acquire', barrier]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    writeFileSync(barrier, 'go');
    const results = await Promise.all([first, second]);
    assert.equal(results.filter((result) => result.code === 0).length, 1, JSON.stringify(results));
    assert.equal(results.filter((result) => result.code === 2).length, 1, JSON.stringify(results));
    assert.ok(results.some((result) => result.output.includes('ACQUIRED')));
    assert.ok(results.some((result) => result.output.includes('DENIED')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sqlite: an expired owner cannot renew after another process takes over', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wora-lease-stale-'));
  const dbPath = path.join(dir, 'wora.db');
  const release = path.join(dir, 'release');
  const go = path.join(dir, 'go');
  writeFileSync(go, 'go');
  try {
    const holder = runLeaseProbe([dbPath, 'stale-a', 'hold', release]);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const contender = await runLeaseProbe([dbPath, 'stale-b', 'acquire', go]);
    assert.equal(contender.code, 0, contender.output);
    assert.match(contender.output, /ACQUIRED/);
    writeFileSync(release, 'release');
    const held = await holder;
    assert.equal(held.code, 0, held.output);
    assert.match(held.output, /RENEW:false/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
