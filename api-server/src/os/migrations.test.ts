import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env['WORA_OS_DB'] = ':memory:';
process.env['NODE_ENV'] = 'test';
const { getOsDb, resetOsDbForTests, nowIso } = await import('./db.js');
const { MIGRATIONS, migrationStatus, rollbackLastMigration, runVersionedMigrations, validateMigrationRegistry } = await import('./migrations.js');

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
