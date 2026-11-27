import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

process.env['WORA_OS_DB'] = ':memory:';
process.env['NODE_ENV'] = 'test';
const { getOsDb, resetOsDbForTests, nowIso, initializeBaselineSchema } = await import('./db.js');
const { ensureSeedAgents, listAgents, updateAgent } = await import('./registry.js');
const {
  MIGRATIONS,
  migrationStatus,
  migrationStateIssues,
  rollbackLastMigration,
  runVersionedMigrations,
  validateMigrationRegistry,
} = await import('./migrations.js');

type AgentFixture = {
  id: string;
  specialization: string;
  source: string;
  tools: string[];
  permissions: string[];
};

const REGISTRY_SQL = `CREATE TABLE IF NOT EXISTS os_schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, rolled_back_at TEXT
)`;

function registryRecord(db: DatabaseSync, version: number, name: string): void {
  db.exec(REGISTRY_SQL);
  db.prepare('INSERT OR REPLACE INTO os_schema_migrations (version, name, applied_at, rolled_back_at) VALUES (?, ?, ?, NULL)')
    .run(version, name, nowIso());
  db.exec(`PRAGMA user_version = ${version}`);
}

function applyMigration(db: DatabaseSync, migration: (typeof MIGRATIONS)[number]): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    migration.up(db, initializeBaselineSchema);
    db.prepare('INSERT OR REPLACE INTO os_schema_migrations (version, name, applied_at, rolled_back_at) VALUES (?, ?, ?, NULL)')
      .run(migration.version, migration.name, nowIso());
    db.exec(`PRAGMA user_version = ${migration.version}`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  }
}

function migrateThrough(db: DatabaseSync, target: number): void {
  db.exec('PRAGMA foreign_keys = ON');
  initializeBaselineSchema(db);
  db.exec(REGISTRY_SQL);
  for (const migration of MIGRATIONS.filter((candidate) => candidate.version <= target)) applyMigration(db, migration);
}

function insertAgent(db: DatabaseSync, fixture: AgentFixture): void {
  const ts = nowIso();
  db.prepare(`INSERT INTO os_agents
    (id, workspace_id, name, role, specialization, skills, tools, permissions, model, limits, instructions, status, source, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?, '{}', '{}', '', 'active', ?, 1, ?, ?)`)
    .run(fixture.id, 'ws-test', fixture.id, 'test role', fixture.specialization, JSON.stringify(fixture.tools), JSON.stringify(fixture.permissions), fixture.source, ts, ts);
}

function insertApproval(db: DatabaseSync, id: string, status: string, expiresAt: string | null): void {
  db.prepare(`INSERT INTO os_approvals
    (id, workspace_id, action_summary, status, expires_at, created_at)
    VALUES (?, 'ws-test', 'fixture approval', ?, ?, ?)`)
    .run(id, status, expiresAt, nowIso());
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function hasTrigger(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name));
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
}

function indexNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((index) => index.name).filter((name) => name.startsWith('idx_'));
}

function assertRuntimeSchema(db: DatabaseSync): void {
  assert.deepEqual(tableColumns(db, 'os_runtime_sessions'), [
    'id', 'workspace_id', 'mission_id', 'task_id', 'kind', 'provider', 'status', 'workspace_dir',
    'limits', 'metadata', 'created_by', 'error', 'expires_at', 'created_at', 'started_at', 'ended_at',
  ]);
  assert.deepEqual(tableColumns(db, 'os_runtime_events'), ['id', 'workspace_id', 'session_id', 'kind', 'action', 'detail', 'created_at']);
  assert.deepEqual(tableColumns(db, 'os_runtime_artifacts'), ['id', 'workspace_id', 'session_id', 'mission_id', 'name', 'kind', 'mime_type', 'size_bytes', 'storage_path', 'created_at']);
  assert.deepEqual(indexNames(db, 'os_runtime_sessions').sort(), ['idx_os_runtime_sessions_expiry', 'idx_os_runtime_sessions_mission', 'idx_os_runtime_sessions_ws']);
  assert.deepEqual(indexNames(db, 'os_runtime_events').sort(), ['idx_os_runtime_events_session', 'idx_os_runtime_events_ws']);
  assert.deepEqual(indexNames(db, 'os_runtime_artifacts').sort(), ['idx_os_runtime_artifacts_mission', 'idx_os_runtime_artifacts_session']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
}

const HISTORICAL_CLOUD_UPDATES: Array<[string, string[], string[]]> = [
  ['browser_automation',
    ['web.fetch_read', 'browser.open', 'browser.inspect', 'browser.screenshot', 'browser.click', 'browser.type', 'browser.select', 'browser.scroll', 'browser.wait', 'browser.research', 'browser.close', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'],
    ['web:read', 'browser:read', 'browser:interact', 'runtime:read', 'runtime:write', 'runtime:execute']],
  ['research',
    ['web.fetch_read', 'browser.open', 'browser.inspect', 'browser.screenshot', 'browser.research', 'browser.close', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'],
    ['web:read', 'browser:read', 'runtime:read', 'runtime:write']],
  ['software_engineer',
    ['fs.workspace_read', 'security.scan', 'host.exec', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'],
    ['workspace:read', 'workspace:write', 'host:exec', 'runtime:read', 'runtime:write', 'runtime:execute']],
  ['qa_engineer',
    ['host.exec', 'fs.workspace_read', 'cloud.exec', 'cloud.read_file', 'cloud.list_files'],
    ['workspace:read', 'host:exec', 'runtime:read', 'runtime:execute']],
  ['system_administrator',
    ['system.diagnostics', 'fs.workspace_list', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'],
    ['host:read', 'runtime:read', 'runtime:write', 'runtime:execute']],
];

/**
 * Verbatim historical version 15 implementation from PR #12 commit e21cfd9.
 * This is intentionally not the current migration 16: the fixture must be a
 * database that actually applied the old cloud migration, not a registry stub.
 */
function applyHistoricalCloudMigration15(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS os_runtime_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    mission_id TEXT,
    task_id TEXT,
    kind TEXT NOT NULL DEFAULT 'computer',
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'starting',
    workspace_dir TEXT NOT NULL,
    limits TEXT NOT NULL DEFAULT '{}',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    error TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_os_runtime_sessions_ws ON os_runtime_sessions(workspace_id, status, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_os_runtime_sessions_mission ON os_runtime_sessions(workspace_id, mission_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_os_runtime_sessions_expiry ON os_runtime_sessions(expires_at)');
  db.exec(`CREATE TABLE IF NOT EXISTS os_runtime_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES os_runtime_sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_os_runtime_events_session ON os_runtime_events(session_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_os_runtime_events_ws ON os_runtime_events(workspace_id, created_at)');
  db.exec(`CREATE TABLE IF NOT EXISTS os_runtime_artifacts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES os_runtime_sessions(id) ON DELETE CASCADE,
    mission_id TEXT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_os_runtime_artifacts_session ON os_runtime_artifacts(session_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_os_runtime_artifacts_mission ON os_runtime_artifacts(workspace_id, mission_id, created_at)');
  const update = db.prepare("UPDATE os_agents SET tools = ?, permissions = ?, updated_at = ? WHERE specialization = ? AND source IN ('seed', 'catalog')");
  for (const [specialization, tools, permissions] of HISTORICAL_CLOUD_UPDATES) {
    update.run(JSON.stringify(tools), JSON.stringify(permissions), nowIso(), specialization);
  }
}

function realisticThrough14(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateThrough(db, 14);
  return db;
}

function historicalCloudFixture(): DatabaseSync {
  const db = realisticThrough14();
  insertAgent(db, { id: 'agent-seed-default', specialization: 'browser_automation', source: 'seed', tools: ['web.fetch_read'], permissions: ['web:read'] });
  insertAgent(db, { id: 'agent-seed-custom', specialization: 'browser_automation', source: 'seed', tools: ['web.fetch_read'], permissions: ['web:read'] });
  insertAgent(db, { id: 'agent-catalog-default', specialization: 'browser_automation', source: 'catalog', tools: ['web.fetch_read'], permissions: ['web:read'] });
  insertAgent(db, { id: 'agent-catalog-custom', specialization: 'browser_automation', source: 'catalog', tools: ['catalog.tool'], permissions: ['catalog:read'] });
  insertAgent(db, { id: 'agent-user-custom', specialization: 'browser_automation', source: 'user', tools: ['user.tool'], permissions: ['user:read'] });
  db.exec('BEGIN IMMEDIATE');
  try {
    applyHistoricalCloudMigration15(db);
    registryRecord(db, 15, 'cloud-computer-browser-runtime');
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  }
  const ts = nowIso();
  db.prepare(`INSERT INTO os_runtime_sessions
    (id, workspace_id, mission_id, task_id, kind, provider, status, workspace_dir, limits, metadata, created_by, error, expires_at, created_at, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('rt-existing', 'ws-test', 'msn-existing', 'task-existing', 'computer', 'docker', 'running', '/workspace/rt-existing', '{"cpu":1}', '{"image":"node:22-alpine"}', 'fixture', '', 1893456000000, ts, ts, null);
  db.prepare(`INSERT INTO os_runtime_events (id, workspace_id, session_id, kind, action, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('evt-existing', 'ws-test', 'rt-existing', 'session', 'started', '{"keep":true}', ts);
  db.prepare(`INSERT INTO os_runtime_artifacts (id, workspace_id, session_id, mission_id, name, kind, mime_type, size_bytes, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('art-existing', 'ws-test', 'rt-existing', 'msn-existing', 'proof.txt', 'file', 'text/plain', 11, '/workspace/rt-existing/proof.txt', ts);
  db.prepare('UPDATE os_agents SET tools = ?, permissions = ?, version = 2 WHERE id = ?')
    .run(JSON.stringify(['web.fetch_read', 'browser.open', 'browser.inspect', 'browser.screenshot', 'browser.click', 'browser.type', 'browser.select', 'browser.scroll', 'browser.wait', 'browser.research', 'browser.close', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files', 'or.solve_lp']), JSON.stringify(['web:read', 'browser:read', 'browser:interact', 'runtime:read', 'runtime:write']), 'agent-seed-custom');
  insertApproval(db, 'approval-null', 'pending', null);
  insertApproval(db, 'approval-past', 'pending', '2020-01-01T00:00:00.000Z');
  insertApproval(db, 'approval-valid', 'pending', '2099-01-01T00:00:00.000Z');
  return db;
}

after(() => resetOsDbForTests());

test('migration registry versions are unique and strictly ordered', () => {
  validateMigrationRegistry();
  const versions = MIGRATIONS.map((migration) => migration.version);
  assert.equal(new Set(versions).size, versions.length);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
  assert.deepEqual(migrationStateIssues(getOsDb()), []);
});

test('fresh databases record every versioned migration and both feature sets', () => {
  const db = getOsDb();
  const status = migrationStatus(db);
  assert.equal(status.version, 19);
  assert.deepEqual(status.pending, []);
  assert.deepEqual(status.applied.map((migration) => migration.version), MIGRATIONS.map((migration) => migration.version));
  assert.equal(hasTable(db, 'os_runtime_sessions'), true);
  assert.equal(hasTable(db, 'os_runtime_events'), true);
  assert.equal(hasTable(db, 'os_runtime_artifacts'), true);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_required'), true);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_update_required'), true);
  assertRuntimeSchema(db);
});

test('seed agents are user-editable through the registry API before migration', () => {
  const workspaceId = 'ws-agent-customization';
  ensureSeedAgents(workspaceId);
  const browser = listAgents(workspaceId, { specialization: 'browser_automation' })[0];
  assert.ok(browser);
  assert.equal(browser.source, 'seed');
  const updated = updateAgent(workspaceId, browser.id, { tools: ['web.fetch_read'], permissions: ['web:read'] }, 'user');
  assert.ok(updated);
  assert.deepEqual(updated.tools, ['web.fetch_read']);
  assert.deepEqual(updated.permissions, ['web:read']);
});

test('realistic version 14 upgrade preserves data and protects default, additive, narrowed, catalog and custom agents', () => {
  const db = realisticThrough14();
  insertAgent(db, { id: 'seed-default', specialization: 'browser_automation', source: 'seed', tools: ['web.fetch_read'], permissions: ['web:read'] });
  insertAgent(db, { id: 'seed-additive', specialization: 'browser_automation', source: 'seed', tools: ['web.fetch_read', 'or.solve_lp'], permissions: ['web:read', 'decision:read'] });
  insertAgent(db, { id: 'seed-narrowed', specialization: 'software_engineer', source: 'seed', tools: ['fs.workspace_read', 'security.scan'], permissions: ['workspace:read'] });
  insertAgent(db, { id: 'catalog-default', specialization: 'browser_automation', source: 'catalog', tools: ['web.fetch_read'], permissions: ['web:read'] });
  insertAgent(db, { id: 'catalog-custom', specialization: 'browser_automation', source: 'catalog', tools: ['catalog.tool'], permissions: ['catalog:read'] });
  insertAgent(db, { id: 'user-custom', specialization: 'browser_automation', source: 'user', tools: ['user.tool'], permissions: ['user:read'] });
  db.prepare('INSERT INTO os_missions (id, workspace_id, objective, status, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('msn-existing', 'ws-test', 'preserve me', 'planning', 'test', nowIso(), nowIso());
  const result = runVersionedMigrations(db, initializeBaselineSchema);
  assert.deepEqual(result.applied, [15, 16, 17, 18, 19]);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM os_missions WHERE id = ?').get('msn-existing') as { c: number }).c, 1);
  assertRuntimeSchema(db);
  const agent = (id: string) => JSON.parse(JSON.stringify(db.prepare('SELECT tools, permissions FROM os_agents WHERE id = ?').get(id))) as { tools: string; permissions: string };
  const defaultAgent = agent('seed-default');
  assert.deepEqual(JSON.parse(defaultAgent.tools), HISTORICAL_CLOUD_UPDATES[0]![1]!);
  assert.deepEqual(JSON.parse(defaultAgent.permissions), HISTORICAL_CLOUD_UPDATES[0]![2]!);
  const additive = agent('seed-additive');
  assert.ok(JSON.parse(additive.tools).includes('cloud.exec'));
  assert.ok(JSON.parse(additive.tools).includes('or.solve_lp'));
  assert.ok(JSON.parse(additive.permissions).includes('runtime:execute'));
  assert.ok(JSON.parse(additive.permissions).includes('decision:read'));
  const narrowed = agent('seed-narrowed');
  assert.deepEqual(JSON.parse(narrowed.tools), ['fs.workspace_read', 'security.scan']);
  assert.deepEqual(JSON.parse(narrowed.permissions), ['workspace:read']);
  const catalogDefault = agent('catalog-default');
  assert.deepEqual(JSON.parse(catalogDefault.tools), HISTORICAL_CLOUD_UPDATES[0]![1]!);
  assert.deepEqual(JSON.parse(catalogDefault.permissions), HISTORICAL_CLOUD_UPDATES[0]![2]!);
  assert.deepEqual(JSON.parse(agent('catalog-custom').tools), ['catalog.tool']);
  assert.deepEqual(JSON.parse(agent('catalog-custom').permissions), ['catalog:read']);
  assert.deepEqual(JSON.parse(agent('user-custom').tools), ['user.tool']);
  assert.deepEqual(JSON.parse(agent('user-custom').permissions), ['user:read']);
});

test('historical version 15 approval migration upgrades to cloud runtime without losing approval enforcement', () => {
  const db = realisticThrough14();
  insertApproval(db, 'approval-null', 'pending', null);
  insertApproval(db, 'approval-past', 'pending', '2020-01-01T00:00:00.000Z');
  applyMigration(db, MIGRATIONS.find((migration) => migration.version === 15)!);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_required'), true);
  const result = runVersionedMigrations(db, initializeBaselineSchema);
  assert.deepEqual(result.applied, [16, 17, 18, 19]);
  assert.equal(result.version, 19);
  assertRuntimeSchema(db);
  const rows = db.prepare('SELECT id, status FROM os_approvals ORDER BY id').all() as Array<{ id: string; status: string }>;
  assert.deepEqual(rows.map((row) => row.status), ['expired', 'expired']);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_update_required'), true);
});

test('historical version 15 cloud migration with real runtime data preserves every record and avoids duplicate schema objects', () => {
  const db = historicalCloudFixture();
  assertRuntimeSchema(db);
  const beforeSessions = db.prepare('SELECT id, workspace_id, mission_id, task_id, kind, provider, status, workspace_dir, limits, metadata, created_by, error, expires_at, created_at, started_at, ended_at FROM os_runtime_sessions ORDER BY id').all();
  const beforeEvents = db.prepare('SELECT id, workspace_id, session_id, kind, action, detail, created_at FROM os_runtime_events ORDER BY id').all();
  const beforeArtifacts = db.prepare('SELECT id, workspace_id, session_id, mission_id, name, kind, mime_type, size_bytes, storage_path, created_at FROM os_runtime_artifacts ORDER BY id').all();
  const result = runVersionedMigrations(db, initializeBaselineSchema);
  assert.deepEqual(result.applied, [16, 17, 18, 19]);
  assert.equal(result.version, 19);
  assert.deepEqual(db.prepare('SELECT id, workspace_id, mission_id, task_id, kind, provider, status, workspace_dir, limits, metadata, created_by, error, expires_at, created_at, started_at, ended_at FROM os_runtime_sessions ORDER BY id').all(), beforeSessions);
  assert.deepEqual(db.prepare('SELECT id, workspace_id, session_id, kind, action, detail, created_at FROM os_runtime_events ORDER BY id').all(), beforeEvents);
  assert.deepEqual(db.prepare('SELECT id, workspace_id, session_id, mission_id, name, kind, mime_type, size_bytes, storage_path, created_at FROM os_runtime_artifacts ORDER BY id').all(), beforeArtifacts);
  assertRuntimeSchema(db);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_required'), true);
  assert.equal(hasTrigger(db, 'os_approvals_pending_expiry_update_required'), true);
  const approvals = (db.prepare('SELECT id, status FROM os_approvals ORDER BY id').all() as Array<{ id: string; status: string }>)
    .map((row) => ({ id: row.id, status: row.status }));
  assert.deepEqual(approvals, [
    { id: 'approval-null', status: 'expired' },
    { id: 'approval-past', status: 'expired' },
    { id: 'approval-valid', status: 'pending' },
  ]);
  assert.throws(() => db.prepare('INSERT INTO os_approvals (id, workspace_id, action_summary, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('approval-new-past', 'ws-test', 'fixture', 'pending', '2020-01-01T00:00:00.000Z', nowIso()), /valid future expires_at/u);
  const registry = db.prepare('SELECT version, name FROM os_schema_migrations ORDER BY version').all() as Array<{ version: number; name: string }>;
  assert.equal(registry.length, 19);
  assert.equal(registry.find((row) => row.version === 15)?.name, 'cloud-computer-browser-runtime');
  assert.equal(registry.find((row) => row.version === 16)?.name, 'cloud-computer-browser-runtime');
  assert.equal(registry.find((row) => row.version === 17)?.name, 'approval-expiry-reconciliation');
  assert.equal(registry.find((row) => row.version === 18)?.name, 'scientific-graph-and-formulation-capabilities');
  assert.equal(registry.find((row) => row.version === 19)?.name, 'advanced-optimization-routing-simulation-capabilities');
  assert.deepEqual(migrationStateIssues(db), []);
  const preservedCustom = JSON.parse((db.prepare('SELECT tools FROM os_agents WHERE id = ?').get('agent-seed-custom') as { tools: string }).tools) as string[];
  const preservedPermissions = JSON.parse((db.prepare('SELECT permissions FROM os_agents WHERE id = ?').get('agent-seed-custom') as { permissions: string }).permissions) as string[];
  assert.ok(preservedCustom.includes('or.solve_lp'));
  assert.equal(preservedCustom.includes('cloud.exec'), false);
  assert.ok(preservedPermissions.includes('runtime:read'));
  assert.equal(preservedPermissions.includes('runtime:execute'), false);
  assert.deepEqual(JSON.parse((db.prepare('SELECT tools FROM os_agents WHERE id = ?').get('agent-user-custom') as { tools: string }).tools), ['user.tool']);
});

test('final version 19 is idempotent and preserves existing runtime data', () => {
  const db = getOsDb();
  db.prepare(`INSERT INTO os_runtime_sessions
    (id, workspace_id, provider, status, workspace_dir, created_by, expires_at, created_at)
    VALUES ('rt-final', 'ws-test', 'docker', 'running', '/workspace/rt-final', 'test', 1893456000000, ?)`)
    .run(nowIso());
  const before = db.prepare('SELECT COUNT(*) AS c FROM os_runtime_sessions WHERE id = ?').get('rt-final') as { c: number };
  const result = runVersionedMigrations(db, initializeBaselineSchema);
  assert.deepEqual(result.applied, []);
  assert.equal(result.version, 19);
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS c FROM os_runtime_sessions WHERE id = ?').get('rt-final'), before);
  assert.deepEqual(migrationStateIssues(db), []);
});

test('contradictory migration states fail with actionable errors instead of skipping', () => {
  const ahead = realisticThrough14();
  ahead.exec('PRAGMA user_version = 20');
  assert.throws(() => runVersionedMigrations(ahead, initializeBaselineSchema), /only knows migrations through 19/u);

  const missing = realisticThrough14();
  missing.prepare('DELETE FROM os_schema_migrations WHERE version = ?').run(7);
  assert.throws(() => runVersionedMigrations(missing, initializeBaselineSchema), /migration 7 is missing/u);

  const wrongName = realisticThrough14();
  wrongName.prepare('UPDATE os_schema_migrations SET name = ? WHERE version = ?').run('unknown-name', 14);
  assert.throws(() => runVersionedMigrations(wrongName, initializeBaselineSchema), /recorded as "unknown-name"/u);

  const rolledBack = realisticThrough14();
  rolledBack.prepare('UPDATE os_schema_migrations SET rolled_back_at = ? WHERE version = ?').run(nowIso(), 14);
  assert.throws(() => runVersionedMigrations(rolledBack, initializeBaselineSchema), /marked rolled back/u);

  const registryAhead = realisticThrough14();
  registryAhead.prepare('INSERT INTO os_schema_migrations (version, name, applied_at, rolled_back_at) VALUES (?, ?, ?, NULL)').run(99, 'future', nowIso());
  assert.throws(() => runVersionedMigrations(registryAhead, initializeBaselineSchema), /unknown to this build/u);
});

test('historical version 15 aliases are accepted without rewriting published names', () => {
  const approval = realisticThrough14();
  applyMigration(approval, MIGRATIONS.find((migration) => migration.version === 15)!);
  assert.deepEqual(migrationStateIssues(approval), []);
  const cloud = realisticThrough14();
  cloud.exec('BEGIN IMMEDIATE');
  applyHistoricalCloudMigration15(cloud);
  registryRecord(cloud, 15, 'cloud-computer-browser-runtime');
  cloud.exec('COMMIT');
  assert.deepEqual(migrationStateIssues(cloud), []);
  assert.equal((cloud.prepare('SELECT name FROM os_schema_migrations WHERE version = 15').get() as { name: string }).name, 'cloud-computer-browser-runtime');
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
