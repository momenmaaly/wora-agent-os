import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

process.env['WORA_OS_DB'] = ':memory:';
process.env['NODE_ENV'] = 'test';
const { getOsDb, resetOsDbForTests, nowIso } = await import('./db.js');
const { MIGRATIONS, migrationStatus, rollbackLastMigration, runVersionedMigrations, validateMigrationRegistry } = await import('./migrations.js');


function upgradeFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS os_schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, rolled_back_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS os_approvals (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, status TEXT NOT NULL,
    expires_at TEXT, decision_note TEXT, decided_by TEXT, decided_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS os_agents (
    id TEXT PRIMARY KEY, specialization TEXT NOT NULL, source TEXT NOT NULL,
    tools TEXT NOT NULL DEFAULT '[]', permissions TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
  )`);
  return db;
}

function markApplied(db: DatabaseSync, version: number, name: string): void {
  db.prepare('INSERT OR REPLACE INTO os_schema_migrations (version, name, applied_at, rolled_back_at) VALUES (?, ?, ?, NULL)')
    .run(version, name, nowIso());
  db.exec(`PRAGMA user_version = ${version}`);
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function hasTrigger(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name));
}

after(() => resetOsDbForTests());


test('migration registry versions are unique and strictly ordered', () => {
  validateMigrationRegistry();
  const versions = MIGRATIONS.map((migration) => migration.version);
  assert.equal(new Set(versions).size, versions.length);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
});

test('fresh databases record every versioned migration', () => {
  const db = getOsDb();
  const status = migrationStatus(db);
  assert.equal(status.version, MIGRATIONS.at(-1)!.version);
  assert.deepEqual(status.pending, []);
  assert.deepEqual(status.applied.map((migration) => migration.version), MIGRATIONS.map((migration) => migration.version));
});


test('upgrade from version 14 applies approval, cloud runtime and reconciliation', () => {
  const db = upgradeFixture();
  db.prepare('INSERT INTO os_agents (id, specialization, source, tools, permissions, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('agent-browser', 'browser_automation', 'seed', '[]', '[]', nowIso());
  markApplied(db, 14, 'lesson-outcome-idempotency-and-legacy-secret-scrub');
  const result = runVersionedMigrations(db, () => {});
  assert.deepEqual(result.applied, [15, 16, 17]);
  assert.equal(result.version, 17);
  assert.equal(hasTable(db, 'os_runtime_sessions'), true);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_required'), true);
  const agent = db.prepare('SELECT tools, permissions FROM os_agents WHERE id = ?').get('agent-browser') as { tools: string; permissions: string };
  assert.match(agent.tools, /browser\.open/u);
  assert.match(agent.permissions, /browser:interact/u);
});

test('upgrade from historical version 15 cloud migration preserves history and applies approval guard', () => {
  const db = upgradeFixture();
  db.prepare('INSERT INTO os_approvals (id, workspace_id, status, expires_at) VALUES (?, ?, ?, ?)')
    .run('legacy-null', 'ws', 'pending', null);
  db.prepare('INSERT INTO os_approvals (id, workspace_id, status, expires_at) VALUES (?, ?, ?, ?)')
    .run('legacy-past', 'ws', 'pending', '2020-01-01T00:00:00.000Z');
  markApplied(db, 15, 'cloud-computer-browser-runtime');
  const result = runVersionedMigrations(db, () => {});
  assert.deepEqual(result.applied, [16, 17]);
  assert.equal(result.version, 17);
  assert.equal(hasTable(db, 'os_runtime_sessions'), true);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_required'), true);
  const rows = db.prepare('SELECT id, status FROM os_approvals ORDER BY id').all() as Array<{ id: string; status: string }>;
  assert.deepEqual(rows.map((row) => row.status), ['expired', 'expired']);
  assert.throws(() => db.prepare('INSERT INTO os_approvals (id, workspace_id, status, expires_at) VALUES (?, ?, ?, ?)')
    .run('bad', 'ws', 'pending', '2020-01-01T00:00:00.000Z'), /valid future expires_at/u);
});

test('upgrade from historical version 15 approval migration still applies cloud runtime', () => {
  const db = upgradeFixture();
  db.prepare('INSERT INTO os_agents (id, specialization, source, tools, permissions, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('agent-browser', 'browser_automation', 'seed', '[]', '[]', nowIso());
  markApplied(db, 15, 'approval-expiry-required');
  const result = runVersionedMigrations(db, () => {});
  assert.deepEqual(result.applied, [16, 17]);
  assert.equal(result.version, 17);
  assert.equal(hasTable(db, 'os_runtime_sessions'), true);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_update_required'), true);
});

test('fresh final schema includes both approval and cloud runtime guarantees', () => {
  const db = getOsDb();
  assert.equal(hasTable(db, 'os_runtime_sessions'), true);
  assert.equal(hasTable(db, 'os_runtime_events'), true);
  assert.equal(hasTable(db, 'os_runtime_artifacts'), true);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_required'), true);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_update_required'), true);
});

test('running migrations again is idempotent', () => {
  const db = getOsDb();
  const result = runVersionedMigrations(db, () => {});
  assert.deepEqual(result.applied, []);
  assert.equal(result.version, MIGRATIONS.at(-1)!.version);
});

test('additive rollback refuses to destroy data and explains the backup strategy', () => {
  const db = getOsDb();
  db.prepare('INSERT INTO os_missions (id, workspace_id, objective, status, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('msn_migration_test', 'ws', 'keep me', 'planning', 'test', nowIso(), nowIso());
  const result = rollbackLastMigration(db);
  assert.equal(result.rolledBack, false);
  assert.match(result.reason, /restore the pre-migration database backup/u);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM os_missions').get() as { c: number }).c, 1);
  assert.equal(migrationStatus(db).version, MIGRATIONS.at(-1)!.version);
});
