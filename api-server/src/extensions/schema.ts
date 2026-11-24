/**
 * WORA extensions — persistent schema (same SQLite database as the OS core).
 * No second database: every table is workspace-scoped and foreign-keyed.
 */
import { getOsDb } from '../os/db.js';

export const EXTENSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS ext_marketplaces (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'git',
  ref TEXT NOT NULL DEFAULT 'main',
  ref_type TEXT NOT NULL DEFAULT 'branch',
  path TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'instance',
  scope_id TEXT NOT NULL DEFAULT '',
  auto_load INTEGER NOT NULL DEFAULT 0,
  trust TEXT NOT NULL DEFAULT 'community',
  secret_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_sync_at TEXT,
  last_commit TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  package_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, url, ref, path)
);
CREATE INDEX IF NOT EXISTS idx_ext_marketplaces_ws ON ext_marketplaces(workspace_id, status);

CREATE TABLE IF NOT EXISTS ext_marketplace_syncs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  marketplace_id TEXT NOT NULL REFERENCES ext_marketplaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  commit_sha TEXT,
  added INTEGER NOT NULL DEFAULT 0,
  changed INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  log TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_ext_syncs_marketplace ON ext_marketplace_syncs(marketplace_id, started_at);

CREATE TABLE IF NOT EXISTS ext_packages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  marketplace_id TEXT NOT NULL REFERENCES ext_marketplaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  package_key TEXT NOT NULL,
  name TEXT NOT NULL,
  latest_version TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  manifest TEXT NOT NULL,
  checksum TEXT NOT NULL,
  trust TEXT NOT NULL DEFAULT 'community',
  status TEXT NOT NULL DEFAULT 'available',
  source_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (marketplace_id, kind, package_key)
);
CREATE INDEX IF NOT EXISTS idx_ext_packages_ws ON ext_packages(workspace_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_ext_packages_key ON ext_packages(workspace_id, package_key);

CREATE TABLE IF NOT EXISTS ext_package_versions (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES ext_packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  checksum TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  source_sha TEXT NOT NULL DEFAULT '',
  yanked INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  UNIQUE (package_id, version)
);

CREATE TABLE IF NOT EXISTS ext_installations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  package_id TEXT NOT NULL REFERENCES ext_packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  auto_load INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'installed',
  permissions_approved INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT,
  approved_at TEXT,
  installed_by TEXT NOT NULL DEFAULT 'user',
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE (workspace_id, package_id, scope, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_ext_installations_ws ON ext_installations(workspace_id, status, enabled);

CREATE TABLE IF NOT EXISTS ext_installation_deps (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES ext_installations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  dep_key TEXT NOT NULL,
  constraint_range TEXT NOT NULL,
  resolved_version TEXT,
  satisfied INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ext_deps_installation ON ext_installation_deps(installation_id);

CREATE TABLE IF NOT EXISTS ext_agent_policies (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  organization_id TEXT,
  project_ids TEXT NOT NULL DEFAULT '[]',
  denied_packages TEXT NOT NULL DEFAULT '[]',
  denied_tools TEXT NOT NULL DEFAULT '[]',
  denied_permissions TEXT NOT NULL DEFAULT '[]',
  extra_permissions TEXT NOT NULL DEFAULT '[]',
  auto_load INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, agent_id)
);

CREATE TABLE IF NOT EXISTS ext_tools (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  installation_id TEXT NOT NULL REFERENCES ext_installations(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  plugin_key TEXT NOT NULL,
  tool_key TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema TEXT NOT NULL DEFAULT '{}',
  output_schema TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  timeout_ms INTEGER NOT NULL DEFAULT 15000,
  risk TEXT NOT NULL DEFAULT 'medium',
  execution_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  health TEXT NOT NULL DEFAULT 'unknown',
  audit INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, tool_id)
);
CREATE INDEX IF NOT EXISTS idx_ext_tools_ws ON ext_tools(workspace_id, status);

CREATE TABLE IF NOT EXISTS ext_mcp_servers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  installation_id TEXT NOT NULL REFERENCES ext_installations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  command TEXT,
  args TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  env_keys TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'stopped',
  health TEXT NOT NULL DEFAULT 'unknown',
  last_check_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  discovered_tools INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (installation_id)
);

CREATE TABLE IF NOT EXISTS ext_secrets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'plugin',
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  key_id TEXT,
  format TEXT NOT NULL DEFAULT 'legacy-aes-gcm',
  version INTEGER NOT NULL DEFAULT 1,
  aad TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS ext_audit (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ext_audit_ws ON ext_audit(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS ext_capability_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT,
  task_id TEXT,
  agent_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  profile TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ext_snapshots_mission ON ext_capability_snapshots(workspace_id, mission_id);
CREATE INDEX IF NOT EXISTS idx_ext_snapshots_agent ON ext_capability_snapshots(workspace_id, agent_id, created_at);
`;

let ready = false;

function addSecretColumns(db: ReturnType<typeof getOsDb>): void {
  const columns = (db.prepare('PRAGMA table_info(ext_secrets)').all() as Array<{ name: string }>).map((column) => column.name);
  const add = (name: string, ddl: string) => {
    if (!columns.includes(name)) db.exec(`ALTER TABLE ext_secrets ADD COLUMN ${ddl}`);
  };
  add('key_id', 'key_id TEXT');
  add('format', "format TEXT NOT NULL DEFAULT 'legacy-aes-gcm'");
  add('version', 'version INTEGER NOT NULL DEFAULT 1');
  add('aad', "aad TEXT NOT NULL DEFAULT ''");
}

export function ensureExtensionSchema(): void {
  if (ready) return;
  const db = getOsDb();
  db.exec(EXTENSION_SCHEMA);
  addSecretColumns(db);
  ready = true;
}

/** Tests only: force the schema guard to re-run after a database reset. */
export function resetExtensionSchemaForTests(): void {
  ready = false;
}
