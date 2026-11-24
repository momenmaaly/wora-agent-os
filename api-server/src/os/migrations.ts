/**
 * Versioned, additive SQLite migrations.
 *
 * Every migration runs in a transaction and is recorded in
 * `os_schema_migrations` plus `PRAGMA user_version`. Migrations in this
 * repository are additive: rolling one back would drop operator data, so the
 * rollback strategy is "restore the pre-migration backup"; `rollbackLastMigration`
 * reports that instead of deleting columns or tables.
 */
import { nowIso } from './db.js';
import type { OsDatabase } from './db.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: OsDatabase, baseline: (db: OsDatabase) => void) => void;
  destructiveDown?: (db: OsDatabase) => void;
}

const hasColumn = (db: OsDatabase, table: string, column: string): boolean =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);

const addColumn = (db: OsDatabase, table: string, column: string, definition: string): void => {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline-guarded-columns',
    up: (db, baseline) => baseline(db),
  },
  {
    version: 2,
    name: 'approval-review-transparency',
    up: (db) => {
      addColumn(db, 'os_approvals', 'target', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'os_approvals', 'consequences', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'os_approvals', 'resource_impact', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'os_approvals', 'summary_version', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'os_approvals', 'review_digest', "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    version: 3,
    name: 'revocable-session-registry',
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS security_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
        revoked_at TEXT, revoked_by TEXT, last_seen_at TEXT
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_security_sessions_user ON security_sessions(user_id, expires_at)');
    },
  },
  {
    version: 4,
    name: 'mission-correlation-id',
    up: (db) => addColumn(db, 'os_missions', 'correlation_id', 'TEXT'),
  },
  {
    version: 5,
    name: 'dynamic-team-orchestration',
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS os_team_plans (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
        mission_id TEXT NOT NULL UNIQUE REFERENCES os_missions(id) ON DELETE CASCADE,
        strategy TEXT NOT NULL, requirements TEXT NOT NULL DEFAULT '[]',
        decisions TEXT NOT NULL DEFAULT '[]', team TEXT NOT NULL DEFAULT '[]',
        graph TEXT NOT NULL DEFAULT '{}', gaps TEXT NOT NULL DEFAULT '[]',
        explanation TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_team_plans_ws ON os_team_plans(workspace_id, created_at)');
      db.exec(`CREATE TABLE IF NOT EXISTS os_selection_decisions (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
        mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES os_tasks(id) ON DELETE CASCADE,
        requirement_id TEXT NOT NULL, selected_agent_id TEXT,
        candidates TEXT NOT NULL DEFAULT '[]', explanation TEXT NOT NULL DEFAULT '{}',
        confidence REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        UNIQUE(mission_id, task_id)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_selection_decisions_task ON os_selection_decisions(workspace_id, mission_id, task_id)');
      db.exec(`CREATE TABLE IF NOT EXISTS os_agent_performance (
        workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL, task_category TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, verified_successes INTEGER NOT NULL DEFAULT 0,
        verified_failures INTEGER NOT NULL DEFAULT 0, total_duration_ms INTEGER NOT NULL DEFAULT 0,
        last_failure_at TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id, agent_id, task_category)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_agent_performance_agent ON os_agent_performance(workspace_id, agent_id)');
    },
  },
  {
    version: 6,
    name: 'scientific-decision-records',
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS os_decision_records (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
        mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_decision_records_mission ON os_decision_records(workspace_id, mission_id, created_at)');
    },
  },
  {
    version: 7,
    name: 'mission-leases-and-worker-coordination',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS os_mission_leases (
        mission_id TEXT PRIMARY KEY REFERENCES os_missions(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_mission_leases_expiry ON os_mission_leases(expires_at)');
    },
  },
  {
    version: 8,
    name: 'skill-context-provenance',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS ext_skill_contexts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        mission_id TEXT,
        task_id TEXT,
        agent_id TEXT NOT NULL,
        digest TEXT NOT NULL,
        token_budget INTEGER NOT NULL,
        tokens_used INTEGER NOT NULL,
        selected TEXT NOT NULL DEFAULT '[]',
        omitted TEXT NOT NULL DEFAULT '[]',
        context_text TEXT NOT NULL DEFAULT '',
        policy TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_ext_skill_contexts_mission ON ext_skill_contexts(workspace_id, mission_id, created_at)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_ext_skill_contexts_task ON ext_skill_contexts(workspace_id, task_id, created_at)');
    },
  },
];

function tableExists(db: OsDatabase, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function ensureRegistry(db: OsDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS os_schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, rolled_back_at TEXT
  )`);
}

export function migrationStatus(db: OsDatabase): { version: number; applied: Array<{ version: number; name: string; appliedAt: string; rolledBackAt: string | null }>; pending: number[] } {
  ensureRegistry(db);
  const rows = db.prepare('SELECT version, name, applied_at, rolled_back_at FROM os_schema_migrations ORDER BY version').all() as Array<Record<string, string | null>>;
  const applied = rows.map((row) => ({ version: Number(row['version']), name: String(row['name']), appliedAt: String(row['applied_at']), rolledBackAt: row['rolled_back_at'] == null ? null : String(row['rolled_back_at']) }));
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0);
  return { version, applied, pending: MIGRATIONS.filter((migration) => migration.version > version).map((migration) => migration.version) };
}

export function runVersionedMigrations(db: OsDatabase, baseline: (db: OsDatabase) => void): { applied: number[]; version: number } {
  ensureRegistry(db);
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0);
  const applied: number[] = [];
  for (const migration of MIGRATIONS.filter((candidate) => candidate.version > current).sort((a, b) => a.version - b.version)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.up(db, baseline);
      db.prepare('INSERT OR REPLACE INTO os_schema_migrations (version, name, applied_at, rolled_back_at) VALUES (?, ?, ?, NULL)')
        .run(migration.version, migration.name, nowIso());
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
      applied.push(migration.version);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { applied, version: migrationStatus(db).version };
}

/**
 * Additive migrations are not destructively reversible. A deployment rolls
 * back by restoring the pre-migration database backup; this function records
 * the decision and reports the required action.
 */
export function rollbackLastMigration(db: OsDatabase): { rolledBack: boolean; version: number; reason: string } {
  const status = migrationStatus(db);
  const last = status.applied.filter((migration) => !migration.rolledBackAt).at(-1);
  if (!last) return { rolledBack: false, version: status.version, reason: 'No applied migration to roll back' };
  const migration = MIGRATIONS.find((candidate) => candidate.version === last.version);
  if (!migration?.destructiveDown) {
    return { rolledBack: false, version: status.version, reason: `Migration ${last.version} is additive; restore the pre-migration database backup instead of dropping data` };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    migration.destructiveDown(db);
    db.prepare('UPDATE os_schema_migrations SET rolled_back_at = ? WHERE version = ?').run(nowIso(), last.version);
    const previous = status.applied.filter((candidate) => candidate.version < last.version && !candidate.rolledBackAt).at(-1)?.version ?? 0;
    db.exec(`PRAGMA user_version = ${previous}`);
    db.exec('COMMIT');
    return { rolledBack: true, version: previous, reason: `Migration ${last.version} rolled back` };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
    return { rolledBack: false, version: status.version, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function hasTable(db: OsDatabase, name: string): boolean {
  return tableExists(db, name);
}
