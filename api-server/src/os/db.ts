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
`;

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

let instance: OsDatabase | null = null;

export function getOsDb(): OsDatabase {
  if (instance) return instance;
  const target = process.env['WORA_OS_DB']?.trim() || path.join(process.cwd(), 'data', 'wora-os.db');
  if (target !== ':memory:') mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  instance = db;
  return db;
}

/** Reset the singleton (tests only). */
export function resetOsDbForTests(): void {
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
