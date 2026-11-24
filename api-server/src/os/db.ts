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
import { runVersionedMigrations } from './migrations.js';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from './secrets.js';
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
  correlation_id TEXT,
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
  fallback_tools TEXT NOT NULL DEFAULT '[]',
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
  target TEXT NOT NULL DEFAULT '',
  consequences TEXT NOT NULL DEFAULT '',
  resource_impact TEXT NOT NULL DEFAULT '',
  summary_version TEXT NOT NULL DEFAULT '',
  review_digest TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT 'high',
  action_class TEXT NOT NULL DEFAULT 'C',
  scope TEXT NOT NULL DEFAULT '',
  payload_digest TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  amount_usd REAL,
  tool_input TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL DEFAULT 'orchestrator',
  status TEXT NOT NULL DEFAULT 'pending',
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  decided_at TEXT,
  consumed_at TEXT,
  consumed_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_approvals_ws ON os_approvals(workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_os_approvals_task ON os_approvals(task_id);

CREATE TABLE IF NOT EXISTS security_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_sessions_user ON security_sessions(user_id, expires_at);

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

CREATE TABLE IF NOT EXISTS os_benchmark_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  suite_version TEXT NOT NULL,
  results TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_benchmark_runs_ws ON os_benchmark_runs(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS os_lessons (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT,
  task_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'candidate',
  confidence REAL NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  provenance TEXT NOT NULL,
  created_by TEXT NOT NULL,
  promoted_by TEXT,
  promoted_at TEXT,
  memory_id TEXT,
  revoked_by TEXT,
  revoked_at TEXT,
  revocation_reason TEXT NOT NULL DEFAULT '',
  outcome_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  effectiveness REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS os_lesson_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_lesson_events_lesson ON os_lesson_events(workspace_id, lesson_id, created_at);
CREATE INDEX IF NOT EXISTS idx_os_lessons_ws ON os_lessons(workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_os_lessons_mission ON os_lessons(workspace_id, mission_id);
CREATE TABLE IF NOT EXISTS os_plan_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  strategy TEXT NOT NULL,
  plan TEXT NOT NULL,
  comparison TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, mission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_os_plan_versions_mission ON os_plan_versions(workspace_id, mission_id, version);
CREATE TABLE IF NOT EXISTS os_problem_profiles (
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
  profile TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, mission_id)
);
CREATE TABLE IF NOT EXISTS os_problem_models (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL UNIQUE REFERENCES os_missions(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_problem_models_ws ON os_problem_models(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS os_capability_compositions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL UNIQUE REFERENCES os_missions(id) ON DELETE CASCADE,
  graph TEXT NOT NULL DEFAULT '{}',
  selected_strategy TEXT NOT NULL DEFAULT '',
  strategies TEXT NOT NULL DEFAULT '[]',
  gaps TEXT NOT NULL DEFAULT '[]',
  explanation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_capability_compositions_ws ON os_capability_compositions(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS os_verifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES os_tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE,
  objective TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  expected_output TEXT NOT NULL DEFAULT '',
  actual_output TEXT NOT NULL DEFAULT 'null',
  evidence TEXT NOT NULL DEFAULT '[]',
  checks TEXT NOT NULL DEFAULT '[]',
  result TEXT NOT NULL,
  independence TEXT NOT NULL DEFAULT 'deterministic-review',
  failure_reason TEXT NOT NULL DEFAULT '',
  verifier TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_verifications_mission ON os_verifications(workspace_id, mission_id, created_at);
CREATE INDEX IF NOT EXISTS idx_os_verifications_task ON os_verifications(workspace_id, task_id, created_at);

CREATE TABLE IF NOT EXISTS os_team_plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL UNIQUE REFERENCES os_missions(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  requirements TEXT NOT NULL DEFAULT '[]',
  decisions TEXT NOT NULL DEFAULT '[]',
  team TEXT NOT NULL DEFAULT '[]',
  graph TEXT NOT NULL DEFAULT '{}',
  gaps TEXT NOT NULL DEFAULT '[]',
  explanation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_team_plans_ws ON os_team_plans(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS os_selection_decisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES os_tasks(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL,
  selected_agent_id TEXT,
  candidates TEXT NOT NULL DEFAULT '[]',
  explanation TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(mission_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_os_selection_decisions_task ON os_selection_decisions(workspace_id, mission_id, task_id);

CREATE TABLE IF NOT EXISTS os_agent_performance (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_category TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_successes INTEGER NOT NULL DEFAULT 0,
  verified_failures INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  last_failure_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, agent_id, task_category)
);
CREATE INDEX IF NOT EXISTS idx_os_agent_performance_agent ON os_agent_performance(workspace_id, agent_id);

CREATE TABLE IF NOT EXISTS os_decision_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_decision_records_mission ON os_decision_records(workspace_id, mission_id, created_at);

CREATE TABLE IF NOT EXISTS os_task_leases (
  task_id TEXT PRIMARY KEY REFERENCES os_tasks(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_task_leases_expiry ON os_task_leases(expires_at);
CREATE INDEX IF NOT EXISTS idx_os_task_leases_mission ON os_task_leases(workspace_id, mission_id);

CREATE TABLE IF NOT EXISTS os_mission_leases (
  mission_id TEXT PRIMARY KEY REFERENCES os_missions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_mission_leases_expiry ON os_mission_leases(expires_at);

CREATE TABLE IF NOT EXISTS os_task_checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES os_tasks(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  output_digest TEXT NOT NULL DEFAULT '',
  evidence_digest TEXT NOT NULL DEFAULT '',
  checkpoint TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_os_task_checkpoints_task ON os_task_checkpoints(workspace_id, task_id, created_at);

CREATE TABLE IF NOT EXISTS os_runtime_leases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  pid INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 0
);
`;

/** Guarded, idempotent column additions for databases created before these columns existed. */
function migrate(db: OsDatabase): void {
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);
  if (!has('os_playbooks', 'reuse_count')) db.exec('ALTER TABLE os_playbooks ADD COLUMN reuse_count INTEGER NOT NULL DEFAULT 0');
  if (!has('os_runtime_leases', 'epoch')) db.exec('ALTER TABLE os_runtime_leases ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0');
  if (!has('os_memory', 'visibility')) db.exec("ALTER TABLE os_memory ADD COLUMN visibility TEXT NOT NULL DEFAULT 'workspace'");
  if (!has('os_memory', 'owner_id')) db.exec("ALTER TABLE os_memory ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''");
  if (!has('os_memory', 'expires_at')) db.exec('ALTER TABLE os_memory ADD COLUMN expires_at TEXT');
  if (!has('os_agents', 'version')) db.exec('ALTER TABLE os_agents ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  if (!has('os_approvals', 'action_class')) db.exec("ALTER TABLE os_approvals ADD COLUMN action_class TEXT NOT NULL DEFAULT 'C'");
  if (!has('os_approvals', 'scope')) db.exec("ALTER TABLE os_approvals ADD COLUMN scope TEXT NOT NULL DEFAULT ''");
  if (!has('os_approvals', 'payload_digest')) db.exec("ALTER TABLE os_approvals ADD COLUMN payload_digest TEXT NOT NULL DEFAULT ''");
  if (!has('os_approvals', 'expires_at')) db.exec('ALTER TABLE os_approvals ADD COLUMN expires_at TEXT');
  if (!has('os_approvals', 'amount_usd')) db.exec('ALTER TABLE os_approvals ADD COLUMN amount_usd REAL');
  if (!has('os_approvals', 'consumed_at')) db.exec('ALTER TABLE os_approvals ADD COLUMN consumed_at TEXT');
  if (!has('os_missions', 'correlation_id')) db.exec('ALTER TABLE os_missions ADD COLUMN correlation_id TEXT');
  if (!has('os_approvals', 'consumed_by')) db.exec('ALTER TABLE os_approvals ADD COLUMN consumed_by TEXT');
  if (!has('os_approvals', 'target')) db.exec("ALTER TABLE os_approvals ADD COLUMN target TEXT NOT NULL DEFAULT ''");
  if (!has('os_approvals', 'consequences')) db.exec("ALTER TABLE os_approvals ADD COLUMN consequences TEXT NOT NULL DEFAULT ''");
  if (!has('os_approvals', 'resource_impact')) db.exec("ALTER TABLE os_approvals ADD COLUMN resource_impact TEXT NOT NULL DEFAULT ''");
  if (!has('os_approvals', 'summary_version')) db.exec("ALTER TABLE os_approvals ADD COLUMN summary_version TEXT NOT NULL DEFAULT ''");
  if (!has('os_approvals', 'review_digest')) db.exec("ALTER TABLE os_approvals ADD COLUMN review_digest TEXT NOT NULL DEFAULT ''");
  if (!has('os_lessons', 'memory_id')) db.exec('ALTER TABLE os_lessons ADD COLUMN memory_id TEXT');
  if (!has('os_lessons', 'revoked_by')) db.exec('ALTER TABLE os_lessons ADD COLUMN revoked_by TEXT');
  if (!has('os_lessons', 'revoked_at')) db.exec('ALTER TABLE os_lessons ADD COLUMN revoked_at TEXT');
  if (!has('os_lessons', 'revocation_reason')) db.exec("ALTER TABLE os_lessons ADD COLUMN revocation_reason TEXT NOT NULL DEFAULT ''");
  if (!has('os_lessons', 'outcome_count')) db.exec('ALTER TABLE os_lessons ADD COLUMN outcome_count INTEGER NOT NULL DEFAULT 0');
  if (!has('os_lessons', 'success_count')) db.exec('ALTER TABLE os_lessons ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0');
  if (!has('os_lessons', 'effectiveness')) db.exec('ALTER TABLE os_lessons ADD COLUMN effectiveness REAL NOT NULL DEFAULT 0');
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
  expires_at INTEGER NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 0
);
`;

let instance: OsDatabase | null = null;
let writerLeaseOwner: string | null = null;
let writerLeaseDb: OsDatabase | null = null;
let writerLeaseTimer: NodeJS.Timeout | null = null;
let leaseExitHookRegistered = false;
let writerLeaseLost = false;
let writerLeaseEpoch: number | null = null;

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
  epoch: number;
}

export function ensureWriterLeaseTable(db: OsDatabase): void {
  // Bootstrap table creation can race with another process. Let SQLite wait
  // briefly instead of failing before the lease transaction is attempted.
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(WRITER_LEASE_SCHEMA);
  const columns = db.prepare('PRAGMA table_info(os_runtime_leases)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'epoch')) {
    db.exec('ALTER TABLE os_runtime_leases ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0');
  }
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
  // SELECT + conditional upsert must be one write transaction. Without
  // BEGIN IMMEDIATE two processes can both observe an empty/expired lease and
  // then overwrite each other's ownership.
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT owner_id, hostname, pid, expires_at, epoch FROM os_runtime_leases WHERE id = ?').get(WRITER_LEASE_ID) as WriterLeaseRow | undefined;
    if (row && row.owner_id !== owner && row.expires_at > now) {
      throw new Error(
        `SQLite writer lease is held by ${row.hostname}:${row.pid} until ${new Date(row.expires_at).toISOString()}; ` +
        'run a single API replica with this database, or migrate to PostgreSQL before scaling out',
      );
    }
    const result = db.prepare(
      'INSERT INTO os_runtime_leases (id, owner_id, hostname, pid, acquired_at, heartbeat_at, expires_at, epoch) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, 1) ' +
      'ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, hostname = excluded.hostname, pid = excluded.pid, ' +
      'acquired_at = excluded.acquired_at, heartbeat_at = excluded.heartbeat_at, expires_at = excluded.expires_at, ' +
      'epoch = os_runtime_leases.epoch + 1 ' +
      'WHERE os_runtime_leases.owner_id = excluded.owner_id OR os_runtime_leases.expires_at <= ?',
    ).run(WRITER_LEASE_ID, owner, host, pid, new Date(now).toISOString(), new Date(now).toISOString(), now + ttlMs, now);
    if (Number(result.changes) !== 1) {
      throw new Error('SQLite writer lease was acquired by another process');
    }
    db.exec('COMMIT');
    return owner;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction already closed */ }
    throw error;
  }
}

export function renewWriterLease(db: OsDatabase, ownerId: string, now = Date.now(), ttlMs = WRITER_LEASE_TTL_MS, epoch?: number): boolean {
  const result = epoch === undefined
    ? db.prepare('UPDATE os_runtime_leases SET heartbeat_at = ?, expires_at = ? WHERE id = ? AND owner_id = ? AND expires_at > ?')
      .run(new Date(now).toISOString(), now + ttlMs, WRITER_LEASE_ID, ownerId, now)
    : db.prepare('UPDATE os_runtime_leases SET heartbeat_at = ?, expires_at = ? WHERE id = ? AND owner_id = ? AND expires_at > ? AND epoch = ?')
      .run(new Date(now).toISOString(), now + ttlMs, WRITER_LEASE_ID, ownerId, now, epoch);
  return Number(result.changes) === 1;
}

export function releaseWriterLease(db: OsDatabase, ownerId: string, epoch?: number): void {
  try {
    if (epoch === undefined) db.prepare('DELETE FROM os_runtime_leases WHERE id = ? AND owner_id = ?').run(WRITER_LEASE_ID, ownerId);
    else db.prepare('DELETE FROM os_runtime_leases WHERE id = ? AND owner_id = ? AND epoch = ?').run(WRITER_LEASE_ID, ownerId, epoch);
  } catch { /* best effort */ }
}

function stopWriterLease(db: OsDatabase): void {
  if (writerLeaseTimer) {
    clearInterval(writerLeaseTimer);
    writerLeaseTimer = null;
  }
  if (writerLeaseDb === db && writerLeaseOwner) releaseWriterLease(db, writerLeaseOwner, writerLeaseEpoch ?? undefined);
  writerLeaseDb = null;
  writerLeaseOwner = null;
  writerLeaseEpoch = null;
}

function loseWriterLease(db: OsDatabase): void {
  writerLeaseLost = true;
  stopWriterLease(db);
  if (instance === db) instance = null;
  try { db.close(); } catch { /* best effort */ }
}

function assertWriterLease(db: OsDatabase): void {
  if (db !== writerLeaseDb || !writerLeaseOwner || writerLeaseEpoch === null) return;
  const row = db.prepare('SELECT owner_id, epoch FROM os_runtime_leases WHERE id = ?').get(WRITER_LEASE_ID) as { owner_id: string; epoch: number } | undefined;
  if (!row || row.owner_id !== writerLeaseOwner || Number(row.epoch) !== writerLeaseEpoch) {
    loseWriterLease(db);
    throw new Error('SQLite writer lease was lost; restart the API process before writing');
  }
}

function startWriterLease(db: OsDatabase): void {
  if (writerLeaseOwner && writerLeaseDb === db) return;
  const owner = acquireWriterLease(db);
  writerLeaseOwner = owner;
  writerLeaseDb = db;
  const lease = db.prepare('SELECT epoch FROM os_runtime_leases WHERE id = ? AND owner_id = ?').get(WRITER_LEASE_ID, owner) as { epoch: number } | undefined;
  writerLeaseEpoch = lease ? Number(lease.epoch) : null;
  writerLeaseTimer = setInterval(() => {
    if (writerLeaseDb !== db || !writerLeaseOwner) return;
    let renewed = false;
    try { renewed = renewWriterLease(db, writerLeaseOwner, Date.now(), WRITER_LEASE_TTL_MS, writerLeaseEpoch ?? undefined); } catch { renewed = false; }
    if (!renewed) loseWriterLease(db);
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
  if (instance) {
    assertWriterLease(instance);
    return instance;
  }
  if (writerLeaseLost) throw new Error('SQLite writer lease was lost; restart the API process before writing');
  const target = process.env['WORA_OS_DB']?.trim() || path.join(process.cwd(), 'data', 'wora-os.db');
  if (target !== ':memory:') mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    // The API takes the advisory singleton writer lease. Workers are separate
    // write clients: SQLite WAL serializes their transactions, and task/mission
    // leases prevent duplicate side effects. This lets an API and one or more
    // workers share the file without the API lease blocking every worker.
    const role = (process.env['WORA_OS_ROLE'] ?? 'api').trim().toLowerCase();
    if (target !== ':memory:' && role !== 'worker') {
      ensureWriterLeaseTable(db);
      startWriterLease(db);
    }
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);
    runVersionedMigrations(db, migrate);
    instance = db;
    return db;
  } catch (error) {
    stopWriterLease(db);
    try { db.close(); } catch { /* best effort */ }
    throw error;
  }
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
  writerLeaseEpoch = null;
  writerLeaseLost = false;
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
  ).run(newId('aud'), entry.workspaceId, entry.actor, entry.action, entry.subject, JSON.stringify(redactSecrets(entry.detail ?? {}).value), nowIso());
}
