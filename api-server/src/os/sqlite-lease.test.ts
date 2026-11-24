import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('sqlite: production compose uses one API replica for the shared SQLite volume', () => {
  const compose = readFileSync(path.resolve(process.cwd(), '../docker-compose.prod.yml'), 'utf8');
  assert.doesNotMatch(compose, /replicas:\s*2/u);
  assert.match(compose, /replicas:\s*1/u);
  assert.match(compose, /SQLite/u);
});
