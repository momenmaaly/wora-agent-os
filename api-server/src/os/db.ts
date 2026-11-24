/**
 * WORA OS — persistent store (SQLite via node:sqlite).
 *
 * A deliberately small, synchronous, transactional data layer. Every OS record
 * (missions, tasks, runs, handoffs, agents, memory, organizations, artifacts,
 * audit) lives here, so execution survives restarts and is fully inspectable.
 *
 * The schema is normalized enough to be honest, and all access goes through
 * this module so a PostgreSQL adapter can replace it later without touching
 * callers. Set WORA_OS_DB=:memory: for an isolated in-memory database (tests),
 * or a file path (default: <cwd>/data/wora-os.db) for persistence.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

export type OsDatabase = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS os_agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  specialization TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  tools TEXT NOT NULL DEFAULT '[]',
  permissions TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT '{}',
  limits TEXT NOT NULL DEFAULT '{}',
  instructions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'os',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_agents_ws ON os_agents(workspace_id, specialization);

CREATE TABLE IF NOT EXISTS os_missions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning',
  requested_by TEXT NOT NULL DEFAULT 'user',
  summary TEXT NOT NULL DEFAULT '',
  artifact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_missions_ws ON os_missions(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS os_tasks (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  specialization TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  agent_id TEXT,
  depends_on TEXT NOT NULL DEFAULT '[]',
  acceptance TEXT NOT NULL DEFAULT '[]',
  tool TEXT,
  tool_input TEXT NOT NULL DEFAULT '{}',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_tasks_mission ON os_tasks(mission_id, order_index);

CREATE TABLE IF NOT EXISTS os_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES os_tasks(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '[]',
  issues TEXT NOT NULL DEFAULT '[]',
  attempt INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_os_runs_task ON os_runs(task_id);

CREATE TABLE IF NOT EXISTS os_handoffs (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  from_specialization TEXT NOT NULL,
  to_specialization TEXT NOT NULL,
  contract TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_handoffs_mission ON os_handoffs(mission_id);

CREATE TABLE IF NOT EXISTS os_memory (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL DEFAULT 'user',
  agent_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_memory_scope ON os_memory(workspace_id, scope, scope_id);

CREATE TABLE IF NOT EXISTS os_organizations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  structure TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_orgs_ws ON os_organizations(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS os_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  org_id TEXT,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS os_artifacts (
  id TEXT PRIMARY KEY,
  mission_id TEXT,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_artifacts_mission ON os_artifacts(mission_id);

CREATE TABLE IF NOT EXISTS os_audit (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_audit_ws ON os_audit(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS os_approvals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'tool-execution',
  mission_id TEXT,
  task_id TEXT,
  tool_id TEXT,
  action_summary TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'high',
  tool_input TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL DEFAULT 'orchestrator',
  status TEXT NOT NULL DEFAULT 'pending',
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_approvals_ws ON os_approvals(workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_os_approvals_task ON os_approvals(task_id);

CREATE TABLE IF NOT EXISTS os_devices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'جهاز بدون اسم',
  platform TEXT NOT NULL DEFAULT 'unknown',
  fingerprint TEXT NOT NULL DEFAULT '',
  pairing_code_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  permissions TEXT NOT NULL DEFAULT '["host:read"]',
  created_at TEXT NOT NULL,
  paired_at TEXT,
  revoked_at TEXT,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_os_devices_ws ON os_devices(workspace_id, status);

CREATE TABLE IF NOT EXISTS os_settings (
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS os_playbooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  tool_input TEXT NOT NULL DEFAULT '{}',
  validation TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'validated',
  success_runs INTEGER NOT NULL DEFAULT 1,
  created_from_mission TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_playbooks_ws ON os_playbooks(workspace_id, tool_id);

CREATE TABLE IF NOT EXISTS os_memory_versions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_memory_versions_ws ON os_memory_versions(workspace_id, memory_id, created_at);

CREATE TABLE IF NOT EXISTS os_workspace_roles (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  granted_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS os_agent_versions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_agent_versions ON os_agent_versions(workspace_id, agent_id, version);

CREATE TABLE IF NOT EXISTS os_boards (
  workspace_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS os_twins (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  kpis TEXT NOT NULL DEFAULT '[]',
  events TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_twins_ws ON os_twins(workspace_id, entity_type);

CREATE TABLE IF NOT EXISTS os_ai_usage (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'brain',
  agent_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens_est INTEGER NOT NULL DEFAULT 0,
  output_tokens_est INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  audit_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_ai_usage_created ON os_ai_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_os_ai_usage_provider ON os_ai_usage(provider, model);

CREATE TABLE IF NOT EXISTS os_runtime_leases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  pid INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

/** Guarded, idempotent column additions for databases created before these columns existed. */
function migrate(db: OsDatabase): void {
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);
  if (!has('os_playbooks', 'reuse_count')) db.exec('ALTER TABLE os_playbooks ADD COLUMN reuse_count INTEGER NOT NULL DEFAULT 0');
  if (!has('os_memory', 'visibility')) db.exec("ALTER TABLE os_memory ADD COLUMN visibility TEXT NOT NULL DEFAULT 'workspace'");
  if (!has('os_memory', 'owner_id')) db.exec("ALTER TABLE os_memory ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''");
  if (!has('os_memory', 'expires_at')) db.exec('ALTER TABLE os_memory ADD COLUMN expires_at TEXT');
  if (!has('os_agents', 'version')) db.exec('ALTER TABLE os_agents ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

const WRITER_LEASE_ID = 'os-sqlite-writer';
const WRITER_LEASE_TTL_MS = 30_000;
const WRITER_LEASE_HEARTBEAT_MS = 5_000;
const WRITER_LEASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS os_runtime_leases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  pid INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

let instance: OsDatabase | null = null;
let writerLeaseOwner: string | null = null;
let writerLeaseDb: OsDatabase | null = null;
let writerLeaseTimer: NodeJS.Timeout | null = null;
let leaseExitHookRegistered = false;

export interface WriterLeaseOptions {
  ownerId?: string;
  host?: string;
  pid?: number;
  now?: number;
  ttlMs?: number;
}

interface WriterLeaseRow {
  owner_id: string;
  hostname: string;
  pid: number;
  expires_at: number;
}

export function ensureWriterLeaseTable(db: OsDatabase): void {
  db.exec(WRITER_LEASE_SCHEMA);
}

/**
 * Claim the single-writer lease for a file-backed SQLite database.
 * A second API process sharing the same database fails fast instead of
 * competing for writes or marking another process's missions interrupted.
 */
export function acquireWriterLease(db: OsDatabase, options: WriterLeaseOptions = {}): string {
  ensureWriterLeaseTable(db);
  const owner = options.ownerId ?? `wora:${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const host = options.host ?? hostname();
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? WRITER_LEASE_TTL_MS;
  const row = db.prepare('SELECT owner_id, hostname, pid, expires_at FROM os_runtime_leases WHERE id = ?').get(WRITER_LEASE_ID) as WriterLeaseRow | undefined;
  if (row && row.owner_id !== owner && row.expires_at > now) {
    throw new Error(
      `SQLite writer lease is held by ${row.hostname}:${row.pid} until ${new Date(row.expires_at).toISOString()}; ` +
      'run a single API replica with this database, or migrate to PostgreSQL before scaling out',
    );
  }
  db.prepare(
    'INSERT INTO os_runtime_leases (id, owner_id, hostname, pid, acquired_at, heartbeat_at, expires_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, hostname = excluded.hostname, pid = excluded.pid, ' +
    'acquired_at = excluded.acquired_at, heartbeat_at = excluded.heartbeat_at, expires_at = excluded.expires_at',
  ).run(WRITER_LEASE_ID, owner, host, pid, new Date(now).toISOString(), new Date(now).toISOString(), now + ttlMs);
  return owner;
}

export function renewWriterLease(db: OsDatabase, ownerId: string, now = Date.now(), ttlMs = WRITER_LEASE_TTL_MS): boolean {
  const result = db.prepare('UPDATE os_runtime_leases SET heartbeat_at = ?, expires_at = ? WHERE id = ? AND owner_id = ?')
    .run(new Date(now).toISOString(), now + ttlMs, WRITER_LEASE_ID, ownerId);
  return Number(result.changes) === 1;
}

export function releaseWriterLease(db: OsDatabase, ownerId: string): void {
  try { db.prepare('DELETE FROM os_runtime_leases WHERE id = ? AND owner_id = ?').run(WRITER_LEASE_ID, ownerId); } catch { /* best effort */ }
}

function startWriterLease(db: OsDatabase): void {
  if (writerLeaseOwner && writerLeaseDb === db) return;
  const owner = acquireWriterLease(db);
  writerLeaseOwner = owner;
  writerLeaseDb = db;
  writerLeaseTimer = setInterval(() => {
    if (writerLeaseDb !== db || !writerLeaseOwner) return;
    try { renewWriterLease(db, writerLeaseOwner); } catch { /* the next boot will fail closed */ }
  }, WRITER_LEASE_HEARTBEAT_MS);
  writerLeaseTimer.unref();
  if (!leaseExitHookRegistered) {
    leaseExitHookRegistered = true;
    process.once('exit', () => {
      if (writerLeaseDb && writerLeaseOwner) releaseWriterLease(writerLeaseDb, writerLeaseOwner);
    });
  }
}

export function getOsDb(): OsDatabase {
  if (instance) return instance;
  const target = process.env['WORA_OS_DB']?.trim() || path.join(process.cwd(), 'data', 'wora-os.db');
  if (target !== ':memory:') mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  if (target !== ':memory:') startWriterLease(db);
  instance = db;
  return db;
}

/** Reset the singleton (tests only). */
export function resetOsDbForTests(): void {
  if (writerLeaseTimer) {
    clearInterval(writerLeaseTimer);
    writerLeaseTimer = null;
  }
  if (writerLeaseDb && writerLeaseOwner) releaseWriterLease(writerLeaseDb, writerLeaseOwner);
  writerLeaseDb = null;
  writerLeaseOwner = null;
  if (instance) {
    try { instance.close(); } catch { /* ignore */ }
    instance = null;
  }
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function audit(db: OsDatabase, entry: { workspaceId: string; actor: string; action: string; subject: string; detail?: unknown }): void {
  db.prepare(
    'INSERT INTO os_audit (id, workspace_id, actor, action, subject, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(newId('aud'), entry.workspaceId, entry.actor, entry.action, entry.subject, JSON.stringify(entry.detail ?? {}), nowIso());
}
