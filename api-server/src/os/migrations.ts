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
import { redactSecrets } from './secrets.js';

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

type ScrubTarget = { table: string; columns: string[]; sealedColumns?: string[] };

const LEGACY_SCRUB_TARGETS: ScrubTarget[] = [
  { table: 'os_memory', columns: ['content', 'tags', 'provenance'] },
  { table: 'os_memory_versions', columns: ['content', 'tags'] },
  { table: 'os_lessons', columns: ['title', 'content', 'evidence', 'provenance', 'revocation_reason'] },
  { table: 'os_lesson_events', columns: ['detail'] },
  { table: 'os_playbooks', columns: ['name', 'keywords', 'tool_input', 'validation'] },
  { table: 'os_missions', columns: ['objective', 'summary', 'outcome_evidence'] },
  { table: 'os_tasks', columns: ['title', 'objective', 'detail', 'tool_input'], sealedColumns: ['tool_input'] },
  { table: 'os_approvals', columns: ['action_summary', 'target', 'consequences', 'resource_impact', 'tool_input'], sealedColumns: ['tool_input'] },
  { table: 'os_verifications', columns: ['objective', 'expected_output', 'actual_output', 'evidence', 'checks', 'failure_reason'] },
  { table: 'os_runs', columns: ['summary', 'evidence', 'issues'] },
  { table: 'os_reasoning_models', columns: ['model'] },
  { table: 'os_problem_models', columns: ['model'] },
  { table: 'os_capability_compositions', columns: ['graph', 'strategies', 'gaps', 'explanation'] },
  { table: 'os_artifacts', columns: ['content'] },
  { table: 'os_audit', columns: ['detail'] },
];

/**
 * Redacts secrets from rows that predate the redaction boundary. This is an
 * in-place presentation-layer scrub, not encryption: content that was never
 * stored in a recognized secret format remains readable in the database file.
 */
export function scrubLegacySecrets(db: OsDatabase): { updated: number } {
  let updated = 0;
  for (const target of LEGACY_SCRUB_TARGETS) {
    if (!tableExists(db, target.table)) continue;
    const columns = target.columns.filter((column) => hasColumn(db, target.table, column));
    if (!columns.length) continue;
    const select = `SELECT rowid AS scrub_rowid, ${columns.join(', ')} FROM ${target.table}`;
    const update = db.prepare(`UPDATE ${target.table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE rowid = ?`);
    const rows = db.prepare(select).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      let changed = false;
      const next: Array<string | null> = columns.map((column) => {
        const value = row[column];
        if (typeof value !== 'string') return value === null || value === undefined ? null : String(value);
        if (target.sealedColumns?.includes(column) && value.startsWith('wora:enc:v1:')) return value;
        const redacted = redactSecrets(value).value;
        if (redacted !== value) changed = true;
        return redacted;
      });
      if (changed) {
        update.run(...next, Number(row['scrub_rowid']));
        updated += 1;
      }
    }
  }
  return { updated };
}

/**
 * Enforce the approval-expiry contract at the database edge. Kept as a shared
 * helper because a database may have applied the cloud runtime migration under
 * the historical version 15 before this guard existed.
 */
export function applyApprovalExpiryGuard(db: OsDatabase): void {
  db.prepare(`UPDATE os_approvals
    SET status = 'expired',
        decision_note = 'Invalidated by approval-expiry migration: legacy approval had no usable expiry',
        decided_by = 'system:approval-expiry-migration',
        decided_at = ?
    WHERE status = 'pending'
      AND (expires_at IS NULL OR trim(expires_at) = ''
        OR julianday(expires_at) IS NULL
        OR julianday(expires_at) <= julianday('now'))`).run(nowIso());
  db.exec('DROP TRIGGER IF EXISTS os_approvals_pending_expiry_required');
  db.exec('DROP TRIGGER IF EXISTS os_approvals_pending_expiry_update_required');
  db.exec(`CREATE TRIGGER os_approvals_pending_expiry_required
    BEFORE INSERT ON os_approvals
    WHEN NEW.status = 'pending'
      AND (NEW.expires_at IS NULL OR trim(NEW.expires_at) = ''
        OR julianday(NEW.expires_at) IS NULL
        OR julianday(NEW.expires_at) <= julianday('now'))
    BEGIN SELECT RAISE(ABORT, 'pending approval requires a valid future expires_at'); END`);
  db.exec(`CREATE TRIGGER os_approvals_pending_expiry_update_required
    BEFORE UPDATE OF status, expires_at ON os_approvals
    WHEN NEW.status = 'pending'
      AND (NEW.expires_at IS NULL OR trim(NEW.expires_at) = ''
        OR julianday(NEW.expires_at) IS NULL
        OR julianday(NEW.expires_at) <= julianday('now'))
    BEGIN SELECT RAISE(ABORT, 'pending approval requires a valid future expires_at'); END`);
}

type CloudAgentUpgrade = {
  specialization: string;
  previousTools: string[];
  previousPermissions: string[];
  tools: string[];
  permissions: string[];
};

// Exact defaults that existed before the cloud runtime migration. Comparing
// against them distinguishes an untouched agent from a user-customized one.
const CLOUD_AGENT_UPGRADES: CloudAgentUpgrade[] = [
  {
    specialization: 'browser_automation',
    previousTools: ['web.fetch_read'],
    previousPermissions: ['web:read'],
    tools: ['web.fetch_read', 'browser.open', 'browser.inspect', 'browser.screenshot', 'browser.click', 'browser.type', 'browser.select', 'browser.scroll', 'browser.wait', 'browser.research', 'browser.close', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'],
    permissions: ['web:read', 'browser:read', 'browser:interact', 'runtime:read', 'runtime:write', 'runtime:execute'],
  },
  {
    specialization: 'research',
    previousTools: ['web.fetch_read', 'text.extract_summary'],
    previousPermissions: ['web:read', 'memory:read'],
    tools: ['web.fetch_read', 'browser.open', 'browser.inspect', 'browser.screenshot', 'browser.research', 'browser.close', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'],
    permissions: ['web:read', 'browser:read', 'runtime:read', 'runtime:write'],
  },
  {
    specialization: 'software_engineer',
    previousTools: ['fs.workspace_read', 'security.scan', 'host.exec'],
    previousPermissions: ['workspace:read', 'workspace:write', 'host:exec'],
    tools: ['fs.workspace_read', 'security.scan', 'host.exec', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'],
    permissions: ['workspace:read', 'workspace:write', 'host:exec', 'runtime:read', 'runtime:write', 'runtime:execute'],
  },
  {
    specialization: 'qa_engineer',
    previousTools: ['host.exec', 'fs.workspace_read'],
    previousPermissions: ['workspace:read', 'host:exec'],
    tools: ['host.exec', 'fs.workspace_read', 'cloud.exec', 'cloud.read_file', 'cloud.list_files'],
    permissions: ['workspace:read', 'host:exec', 'runtime:read', 'runtime:execute'],
  },
  {
    specialization: 'system_administrator',
    previousTools: ['system.diagnostics', 'fs.workspace_list'],
    previousPermissions: ['host:read'],
    tools: ['system.diagnostics', 'fs.workspace_list', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'],
    permissions: ['host:read', 'runtime:read', 'runtime:write', 'runtime:execute'],
  },
];
const CLOUD_AGENT_UPGRADE_BY_SPECIALIZATION = new Map(CLOUD_AGENT_UPGRADES.map((upgrade) => [upgrade.specialization, upgrade]));

function parseAgentArray(raw: string): string[] | null {
  try {
    const value = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
  } catch {
    return null;
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function containsAll(current: string[], required: string[]): boolean {
  return required.every((item) => current.includes(item));
}

function appendNewCapabilities(current: string[], previous: string[], target: string[]): string[] {
  const additions = target.filter((item) => !previous.includes(item) && !current.includes(item));
  return additions.length ? [...current, ...additions] : current;
}

/**
 * Apply the cloud runtime capability defaults without overwriting user choices.
 *
 * - An untouched seed/catalog agent gets the new defaults.
 * - An agent that only added capabilities keeps its additions and receives the
 *   new cloud capabilities.
 * - An agent that removed a capability keeps the narrowed allow-list; the
 *   migration never re-adds a capability the user deliberately removed.
 */
function applyCloudAgentCapabilities(db: OsDatabase): void {
  const rows = db.prepare("SELECT id, specialization, tools, permissions FROM os_agents WHERE source IN ('seed', 'catalog')").all() as Array<{
    id: string;
    specialization: string;
    tools: string;
    permissions: string;
  }>;
  const update = db.prepare('UPDATE os_agents SET tools = ?, permissions = ?, updated_at = ? WHERE id = ?');
  for (const row of rows) {
    const upgrade = CLOUD_AGENT_UPGRADE_BY_SPECIALIZATION.get(row.specialization);
    if (!upgrade) continue;
    const tools = parseAgentArray(row.tools);
    const permissions = parseAgentArray(row.permissions);
    if (!tools || !permissions) continue;
    const newTools = upgrade.tools.filter((item) => !upgrade.previousTools.includes(item));
    const newPermissions = upgrade.permissions.filter((item) => !upgrade.previousPermissions.includes(item));
    // If any new cloud capability is already present, this agent has already
    // seen the cloud migration. A missing capability is then a user removal,
    // not an un-upgraded default, so preserve the allow-list exactly.
    const alreadyCloudEnabled = tools.some((item) => newTools.includes(item));
    const alreadyRuntimeEnabled = permissions.some((item) => newPermissions.includes(item));
    const nextTools = sameStringSet(tools, upgrade.previousTools)
      ? [...upgrade.tools]
      : alreadyCloudEnabled
        ? tools
        : containsAll(tools, upgrade.previousTools)
          ? appendNewCapabilities(tools, upgrade.previousTools, upgrade.tools)
          : tools;
    const nextPermissions = sameStringSet(permissions, upgrade.previousPermissions)
      ? [...upgrade.permissions]
      : alreadyRuntimeEnabled
        ? permissions
        : containsAll(permissions, upgrade.previousPermissions)
          ? appendNewCapabilities(permissions, upgrade.previousPermissions, upgrade.permissions)
          : permissions;
    if (JSON.stringify(nextTools) === JSON.stringify(tools) && JSON.stringify(nextPermissions) === JSON.stringify(permissions)) continue;
    update.run(JSON.stringify(nextTools), JSON.stringify(nextPermissions), nowIso(), row.id);
  }
}

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
  {
    version: 9,
    name: 'unified-problem-and-capability-composition',
    up(db) {
      addColumn(db, 'os_tasks', 'fallback_tools', "TEXT NOT NULL DEFAULT '[]'");
      db.exec(`CREATE TABLE IF NOT EXISTS os_problem_models (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        mission_id TEXT NOT NULL UNIQUE REFERENCES os_missions(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_problem_models_ws ON os_problem_models(workspace_id, created_at)');
      db.exec(`CREATE TABLE IF NOT EXISTS os_capability_compositions (
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
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_capability_compositions_ws ON os_capability_compositions(workspace_id, created_at)');
    },
  },
  {
    version: 10,
    name: 'semantic-contracts-and-outcome-verification',
    up(db) {
      if (tableExists(db, 'ext_tools')) addColumn(db, 'ext_tools', 'semantic_contract', 'TEXT');
      addColumn(db, 'os_tasks', 'input_bindings', "TEXT NOT NULL DEFAULT '[]'");
      addColumn(db, 'os_missions', 'outcome_status', "TEXT NOT NULL DEFAULT 'unverified'");
      addColumn(db, 'os_missions', 'outcome_evidence', "TEXT NOT NULL DEFAULT '{}'");
    },
  },
  {
    version: 11,
    name: 'evidence-grounded-reasoning-model-history',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS os_reasoning_models (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        parent_version INTEGER,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, mission_id, version)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_reasoning_models_mission ON os_reasoning_models(workspace_id, mission_id, version)');
    },
  },
  {
    version: 12,
    name: 'data-analyst-forecast-capability',
    up(db) {
      const rows = db.prepare("SELECT id, tools FROM os_agents WHERE specialization = 'data_analyst' AND source = 'seed'").all() as Array<{ id: string; tools: string }>;
      const update = db.prepare('UPDATE os_agents SET tools = ?, updated_at = ? WHERE id = ?');
      for (const row of rows) {
        const tools = JSON.parse(row.tools || '[]') as unknown;
        if (!Array.isArray(tools) || tools.includes('forecast.linear')) continue;
        update.run(JSON.stringify([...tools, 'forecast.linear']), nowIso(), row.id);
      }
    },
  },
  {
    version: 13,
    name: 'memory-security-and-trust-foundation',
    up(db) {
      addColumn(db, 'os_memory', 'source_class', "TEXT NOT NULL DEFAULT 'legacy'");
      addColumn(db, 'os_memory', 'verification_status', "TEXT NOT NULL DEFAULT 'unverified'");
      addColumn(db, 'os_memory', 'knowledge_status', "TEXT NOT NULL DEFAULT 'active'");
      addColumn(db, 'os_memory', 'reviewed_by', 'TEXT');
      addColumn(db, 'os_memory', 'reviewed_at', 'TEXT');
      addColumn(db, 'os_memory', 'evidence_digest', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'os_memory', 'content_digest', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'os_lessons', 'inconclusive_count', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'os_playbooks', 'created_by', "TEXT NOT NULL DEFAULT 'system'");
      db.exec(`CREATE TABLE IF NOT EXISTS os_lesson_applications (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL REFERENCES os_lessons(id) ON DELETE CASCADE,
        mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
        task_id TEXT,
        actor TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'explicit',
        evidence_digest TEXT NOT NULL DEFAULT '',
        UNIQUE(workspace_id, lesson_id, mission_id, task_id)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_lesson_applications_lesson ON os_lesson_applications(workspace_id, lesson_id, applied_at)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_lesson_applications_mission ON os_lesson_applications(workspace_id, mission_id)');
      db.exec(`CREATE TABLE IF NOT EXISTS os_memory_retrievals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        mission_id TEXT,
        purpose TEXT NOT NULL,
        query_digest TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        scope_ids TEXT NOT NULL DEFAULT '{}',
        selected_ids TEXT NOT NULL DEFAULT '[]',
        limit_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_memory_retrievals_ws ON os_memory_retrievals(workspace_id, created_at)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_os_memory_retrievals_mission ON os_memory_retrievals(workspace_id, mission_id, created_at)');
      const agentRows = db.prepare('SELECT id, tools FROM os_agents').all() as Array<{ id: string; tools: string }>;
      const updateAgent = db.prepare('UPDATE os_agents SET tools = ?, updated_at = ? WHERE id = ?');
      for (const row of agentRows) {
        const tools = JSON.parse(row.tools || '[]') as unknown;
        if (!Array.isArray(tools)) continue;
        const filtered = tools.filter((tool) => tool !== 'memory.search' && tool !== 'memory.write');
        if (filtered.length !== tools.length) updateAgent.run(JSON.stringify(filtered), nowIso(), row.id);
      }
    },
  },
  {
    version: 14,
    name: 'lesson-outcome-idempotency-and-legacy-secret-scrub',
    up(db) {
      addColumn(db, 'os_lesson_applications', 'outcome_recorded_at', 'TEXT');
      scrubLegacySecrets(db);
    },
  },
  {
    version: 15,
    name: 'approval-expiry-required',
    up(db) {
      applyApprovalExpiryGuard(db);
    },
  },
  {
    version: 16,
    name: 'cloud-computer-browser-runtime',
    up(db) {
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

      applyCloudAgentCapabilities(db);
    },
  },
  {
    version: 17,
    name: 'approval-expiry-reconciliation',
    up(db) {
      // A database that applied the cloud runtime before this stack merged may
      // already report version 15. Re-run the shared, idempotent guard so the
      // approval contract is present without renumbering published history.
      applyApprovalExpiryGuard(db);
    },
  },
  {
    version: 18,
    name: 'scientific-graph-and-formulation-capabilities',
    up(db) {
      // Existing untouched OR seed agents need the new graph and formulation
      // tools. A narrowed or customized allow-list is preserved.
      const rows = db.prepare("SELECT id, tools FROM os_agents WHERE specialization = 'operations_research' AND source IN ('seed', 'catalog')").all() as Array<{ id: string; tools: string }>;
      const update = db.prepare('UPDATE os_agents SET tools = ?, updated_at = ? WHERE id = ?');
      const required = ['or.solve_lp', 'or.assignment', 'or.employee_schedule', 'sim.monte_carlo'];
      const additions = ['graph.shortest_path', 'meta.formulate_scientific_problem', 'forecast.linear', 'decision.weighted_matrix'];
      for (const row of rows) {
        const tools = parseAgentArray(row.tools);
        if (!tools || !required.every((tool) => tools.includes(tool))) continue;
        const next = [...new Set([...tools, ...additions])];
        if (next.length !== tools.length) update.run(JSON.stringify(next), nowIso(), row.id);
      }
    },
  },
  {
    version: 19,
    name: 'advanced-optimization-routing-simulation-capabilities',
    up(db) {
      // Grant the advanced flow, routing, Pareto, Bayesian and simulation tools
      // only to untouched OR seed/catalog agents. Customized allow-lists stay
      // exactly as the administrator left them.
      const rows = db.prepare("SELECT id, tools FROM os_agents WHERE specialization = 'operations_research' AND source IN ('seed', 'catalog')").all() as Array<{ id: string; tools: string }>;
      const update = db.prepare('UPDATE os_agents SET tools = ?, updated_at = ? WHERE id = ?');
      const required = ['or.solve_lp', 'or.assignment', 'or.employee_schedule', 'sim.monte_carlo'];
      const additions = ['graph.max_flow', 'graph.min_cost_flow', 'graph.bipartite_matching', 'routing.tsp', 'routing.vrp', 'decision.pareto', 'stats.bayes_update', 'sim.queue', 'sim.scenario_compare'];
      for (const row of rows) {
        const tools = parseAgentArray(row.tools);
        if (!tools || !required.every((tool) => tools.includes(tool))) continue;
        const next = [...new Set([...tools, ...additions])];
        if (next.length !== tools.length) update.run(JSON.stringify(next), nowIso(), row.id);
      }
    },
  },
];

const HISTORICAL_MIGRATION_NAMES: Record<number, string[]> = {
  15: ['approval-expiry-required', 'cloud-computer-browser-runtime'],
};

function acceptedMigrationName(version: number, name: string): boolean {
  const expected = MIGRATIONS.find((migration) => migration.version === version);
  if (!expected) return false;
  return expected.name === name || (HISTORICAL_MIGRATION_NAMES[version]?.includes(name) ?? false);
}

/**
 * Compare the scalar `PRAGMA user_version` with the append-only registry.
 * Historical version 15 is accepted under either published name; everything
 * else must match the current registry exactly.
 */
export function migrationStateIssues(db: OsDatabase): string[] {
  ensureRegistry(db);
  const issues: string[] = [];
  const rawVersion = (db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version;
  const current = Number(rawVersion ?? 0);
  if (!Number.isInteger(current) || current < 0) {
    return [`PRAGMA user_version is not a valid non-negative integer: ${String(rawVersion)}`];
  }
  const latest = MIGRATIONS.at(-1)?.version ?? 0;
  if (current > latest) issues.push(`PRAGMA user_version is ${current}, but this build only knows migrations through ${latest}`);
  const rows = db.prepare('SELECT version, name, rolled_back_at FROM os_schema_migrations ORDER BY version').all() as Array<{
    version: number;
    name: string;
    rolled_back_at: string | null;
  }>;
  const active = new Map<number, string>();
  for (const row of rows) {
    const version = Number(row.version);
    if (!Number.isInteger(version) || version < 1) {
      issues.push(`os_schema_migrations contains an invalid version: ${String(row.version)}`);
      continue;
    }
    if (row.rolled_back_at) {
      issues.push(`Migration ${version} (${row.name}) is marked rolled back; additive migrations cannot be rolled back in place`);
      continue;
    }
    if (active.has(version)) {
      issues.push(`Migration version ${version} appears more than once in os_schema_migrations`);
      continue;
    }
    active.set(version, row.name);
    if (!MIGRATIONS.some((migration) => migration.version === version)) {
      issues.push(`Migration ${version} (${row.name}) is recorded in os_schema_migrations but is unknown to this build`);
    } else if (!acceptedMigrationName(version, row.name)) {
      issues.push(`Migration ${version} is recorded as "${row.name}", but this build expects "${MIGRATIONS.find((migration) => migration.version === version)?.name}"`);
    }
    if (version > current) {
      issues.push(`Migration ${version} (${row.name}) is recorded as applied, but PRAGMA user_version is only ${current}`);
    }
  }
  if (current > 0) {
    for (let version = 1; version <= current; version += 1) {
      if (!active.has(version)) issues.push(`PRAGMA user_version is ${current}, but migration ${version} is missing from os_schema_migrations`);
    }
  }
  return issues;
}

export function validateMigrationState(db: OsDatabase): void {
  const issues = migrationStateIssues(db);
  if (!issues.length) return;
  throw new Error(`Migration state is inconsistent:\n- ${issues.join('\n- ')}\nRestore the pre-migration database backup or repair os_schema_migrations; do not delete applied rows.`);
}

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

export function validateMigrationRegistry(): void {
  const versions = new Set<number>();
  for (const migration of MIGRATIONS) {
    if (!Number.isInteger(migration.version) || migration.version < 1) throw new Error(`Invalid migration version ${String(migration.version)}`);
    if (!migration.name.trim()) throw new Error(`Migration ${migration.version} has an empty name`);
    if (versions.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version}`);
    versions.add(migration.version);
  }
}

export function runVersionedMigrations(db: OsDatabase, baseline: (db: OsDatabase) => void): { applied: number[]; version: number } {
  validateMigrationRegistry();
  ensureRegistry(db);
  validateMigrationState(db);
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
  validateMigrationState(db);
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
