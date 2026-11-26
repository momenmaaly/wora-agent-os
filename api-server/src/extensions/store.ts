/**
 * WORA extensions — persistence repositories.
 *
 * Every query is workspace-scoped. Mutations are transactional where several
 * rows must agree (sync results, installation resources, uninstall cleanup).
 */
import { getOsDb, newId, nowIso, parseJson, audit } from '../os/db.js';
import { ensureExtensionSchema } from './schema.js';
import {
  checksumOf, compareSemver, parseSemver, readStoredManifest, satisfies,
  type PackageKind, type PackageManifest, type PackageScope, type PluginManifest, type SkillExecutionPolicy,
  type SkillManifest, type TrustLevel,
} from './manifest.js';

export interface MarketplaceRecord {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  provider: 'git' | 'local' | 'builtin';
  ref: string;
  refType: 'branch' | 'tag' | 'commit';
  path: string;
  scope: PackageScope;
  scopeId: string;
  autoLoad: boolean;
  trust: TrustLevel;
  secretName: string | null;
  status: 'pending' | 'ready' | 'error' | 'disabled';
  lastSyncAt: string | null;
  lastCommit: string | null;
  lastError: string;
  packageCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceSyncRecord {
  id: string;
  marketplaceId: string;
  status: 'running' | 'ok' | 'error';
  startedAt: string;
  finishedAt: string | null;
  commitSha: string | null;
  added: number;
  changed: number;
  removed: number;
  error: string;
  log: string[];
}

export interface PackageRecord {
  id: string;
  workspaceId: string;
  marketplaceId: string;
  kind: PackageKind;
  key: string;
  name: string;
  latestVersion: string;
  category: string;
  tags: string[];
  manifest: PackageManifest;
  checksum: string;
  trust: TrustLevel;
  status: 'available' | 'missing' | 'revoked';
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface PackageVersionRecord {
  id: string;
  version: string;
  manifest: PackageManifest;
  checksum: string;
  instructions: string;
  sourceSha: string;
  yanked: boolean;
  publishedAt: string;
}

export interface InstallationRecord {
  id: string;
  workspaceId: string;
  packageId: string;
  version: string;
  scope: PackageScope;
  scopeId: string;
  enabled: boolean;
  autoLoad: boolean;
  status: 'installed' | 'disabled' | 'pending_approval' | 'removed' | 'error';
  permissionsApproved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  installedBy: string;
  installedAt: string;
  updatedAt: string;
  removedAt: string | null;
}

export interface InstallationDependency {
  depKey: string;
  constraint: string;
  resolvedVersion: string | null;
  satisfied: boolean;
  detail: string;
}

export interface RegisteredTool {
  id: string;
  workspaceId: string;
  installationId: string;
  packageId: string;
  pluginKey: string;
  toolKey: string;
  toolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  semanticContract: Record<string, unknown> | null;
  permissions: string[];
  timeoutMs: number;
  risk: 'low' | 'medium' | 'high';
  executionMode: 'mcp-stdio' | 'mcp-http' | 'http-api';
  status: 'active' | 'disabled';
  health: 'unknown' | 'healthy' | 'error';
  audit: boolean;
}

export interface McpServerRecord {
  id: string;
  workspaceId: string;
  installationId: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  args: string[];
  url: string | null;
  envKeys: string[];
  status: 'stopped' | 'ready' | 'error';
  health: 'unknown' | 'healthy' | 'error';
  lastCheckAt: string | null;
  lastError: string;
  discoveredTools: number;
}

export interface AgentPolicyRecord {
  agentId: string;
  organizationId: string | null;
  projectIds: string[];
  deniedPackages: string[];
  deniedTools: string[];
  deniedPermissions: string[];
  extraPermissions: string[];
  autoLoad: boolean;
  updatedAt: string;
}

export interface CapabilitySnapshotRecord {
  id: string;
  missionId: string | null;
  taskId: string | null;
  agentId: string;
  digest: string;
  profile: Record<string, unknown>;
  createdAt: string;
}

export function extensionAudit(workspaceId: string, actor: string, action: string, subject: string, detail: Record<string, unknown> = {}): void {
  ensureExtensionSchema();
  const db = getOsDb();
  db.prepare('INSERT INTO ext_audit (id, workspace_id, actor, action, subject, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('xau'), workspaceId, actor, action, subject, JSON.stringify(detail), nowIso());
  // Mirror into the OS audit trail so operators see one timeline.
  audit(db, { workspaceId, actor, action, subject, detail });
}

/* ─── Marketplaces ──────────────────────────────────────── */
type MarketplaceRow = Record<string, string | number | null>;

function marketplaceFromRow(row: MarketplaceRow): MarketplaceRecord {
  return {
    id: String(row['id']),
    workspaceId: String(row['workspace_id']),
    name: String(row['name']),
    url: String(row['url']),
    provider: String(row['provider']) as MarketplaceRecord['provider'],
    ref: String(row['ref']),
    refType: String(row['ref_type']) as MarketplaceRecord['refType'],
    path: String(row['path'] ?? ''),
    scope: String(row['scope']) as PackageScope,
    scopeId: String(row['scope_id'] ?? ''),
    autoLoad: Number(row['auto_load']) === 1,
    trust: String(row['trust']) as TrustLevel,
    secretName: row['secret_name'] ? String(row['secret_name']) : null,
    status: String(row['status']) as MarketplaceRecord['status'],
    lastSyncAt: row['last_sync_at'] ? String(row['last_sync_at']) : null,
    lastCommit: row['last_commit'] ? String(row['last_commit']) : null,
    lastError: String(row['last_error'] ?? ''),
    packageCount: Number(row['package_count'] ?? 0),
    createdBy: String(row['created_by']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export function createMarketplace(input: {
  workspaceId: string; name: string; url: string; provider?: MarketplaceRecord['provider'];
  ref?: string; refType?: MarketplaceRecord['refType']; path?: string; scope?: PackageScope; scopeId?: string;
  autoLoad?: boolean; trust?: TrustLevel; secretName?: string | null; actor: string;
}): MarketplaceRecord {
  ensureExtensionSchema();
  if ((input.trust ?? 'community') === 'official' && input.provider !== 'builtin') {
    throw new Error('Official trust is reserved for the bundled WORA catalog');
  }
  const db = getOsDb();
  const id = newId('mkt');
  const ts = nowIso();
  db.prepare(
    `INSERT INTO ext_marketplaces (id, workspace_id, name, url, provider, ref, ref_type, path, scope, scope_id, auto_load, trust, secret_name, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(id, input.workspaceId, input.name, input.url, input.provider ?? 'git', input.ref ?? 'main', input.refType ?? 'branch',
    input.path ?? '', input.scope ?? 'instance', input.scopeId ?? '', input.autoLoad ? 1 : 0, input.trust ?? 'community',
    input.secretName ?? null, input.actor, ts, ts);
  extensionAudit(input.workspaceId, input.actor, 'extension.marketplace.create', id, { url: input.url, ref: input.ref ?? 'main' });
  return getMarketplace(input.workspaceId, id)!;
}

export function getMarketplace(workspaceId: string, id: string): MarketplaceRecord | null {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT * FROM ext_marketplaces WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as MarketplaceRow | undefined;
  return row ? marketplaceFromRow(row) : null;
}

export function listMarketplaces(workspaceId: string): MarketplaceRecord[] {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT * FROM ext_marketplaces WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId) as MarketplaceRow[];
  return rows.map(marketplaceFromRow);
}

export function updateMarketplace(workspaceId: string, id: string, patch: {
  name?: string; ref?: string; refType?: MarketplaceRecord['refType']; path?: string; scope?: PackageScope; scopeId?: string;
  autoLoad?: boolean; trust?: TrustLevel; secretName?: string | null; status?: MarketplaceRecord['status'];
}, actor: string): MarketplaceRecord | null {
  const current = getMarketplace(workspaceId, id);
  if (!current) return null;
  if (patch.trust === 'official' && current.provider !== 'builtin') {
    throw new Error('Official trust is reserved for the bundled WORA catalog');
  }
  getOsDb().prepare(
    `UPDATE ext_marketplaces SET name = ?, ref = ?, ref_type = ?, path = ?, scope = ?, scope_id = ?, auto_load = ?, trust = ?, secret_name = ?, status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
  ).run(patch.name ?? current.name, patch.ref ?? current.ref, patch.refType ?? current.refType, patch.path ?? current.path,
    patch.scope ?? current.scope, patch.scopeId ?? current.scopeId, (patch.autoLoad ?? current.autoLoad) ? 1 : 0,
    patch.trust ?? current.trust, patch.secretName === undefined ? current.secretName : patch.secretName,
    patch.status ?? current.status, nowIso(), workspaceId, id);
  extensionAudit(workspaceId, actor, 'extension.marketplace.update', id, { fields: Object.keys(patch) });
  return getMarketplace(workspaceId, id);
}

export function deleteMarketplace(workspaceId: string, id: string, actor: string): boolean {
  ensureExtensionSchema();
  const db = getOsDb();
  const installed = db.prepare(
    `SELECT COUNT(*) AS c FROM ext_installations i JOIN ext_packages p ON p.id = i.package_id
     WHERE i.workspace_id = ? AND p.marketplace_id = ? AND i.status != 'removed'`,
  ).get(workspaceId, id) as { c: number };
  if (installed.c > 0) throw new Error('Uninstall packages from this marketplace before removing it');
  const result = db.prepare('DELETE FROM ext_marketplaces WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
  if (Number(result.changes) > 0) extensionAudit(workspaceId, actor, 'extension.marketplace.delete', id);
  return Number(result.changes) > 0;
}

export function setMarketplaceSyncResult(workspaceId: string, id: string, result: {
  status: MarketplaceRecord['status']; commit?: string | null; error?: string; packageCount?: number;
}): void {
  ensureExtensionSchema();
  getOsDb().prepare(
    `UPDATE ext_marketplaces SET status = ?, last_commit = ?, last_error = ?, last_sync_at = ?, package_count = COALESCE(?, package_count), updated_at = ? WHERE workspace_id = ? AND id = ?`,
  ).run(result.status, result.commit ?? null, (result.error ?? '').slice(0, 2_000), nowIso(), result.packageCount ?? null, nowIso(), workspaceId, id);
}

/* ─── Sync history ──────────────────────────────────────── */
export function startSync(workspaceId: string, marketplaceId: string): string {
  ensureExtensionSchema();
  const id = newId('syn');
  getOsDb().prepare(
    `INSERT INTO ext_marketplace_syncs (id, workspace_id, marketplace_id, status, started_at, log) VALUES (?, ?, ?, 'running', ?, '[]')`,
  ).run(id, workspaceId, marketplaceId, nowIso());
  return id;
}

export function finishSync(workspaceId: string, syncId: string, result: {
  status: 'ok' | 'error'; commitSha?: string | null; added?: number; changed?: number; removed?: number; error?: string; log?: string[];
}): void {
  ensureExtensionSchema();
  getOsDb().prepare(
    `UPDATE ext_marketplace_syncs SET status = ?, finished_at = ?, commit_sha = ?, added = ?, changed = ?, removed = ?, error = ?, log = ? WHERE id = ? AND workspace_id = ?`,
  ).run(result.status, nowIso(), result.commitSha ?? null, result.added ?? 0, result.changed ?? 0, result.removed ?? 0,
    (result.error ?? '').slice(0, 2_000), JSON.stringify((result.log ?? []).slice(0, 200)), syncId, workspaceId);
}

export function listSyncs(workspaceId: string, marketplaceId: string, limit = 20): MarketplaceSyncRecord[] {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT * FROM ext_marketplace_syncs WHERE workspace_id = ? AND marketplace_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(workspaceId, marketplaceId, Math.min(limit, 100)) as Array<Record<string, string | number | null>>;
  return rows.map((row) => ({
    id: String(row['id']), marketplaceId: String(row['marketplace_id']), status: String(row['status']) as MarketplaceSyncRecord['status'],
    startedAt: String(row['started_at']), finishedAt: row['finished_at'] ? String(row['finished_at']) : null,
    commitSha: row['commit_sha'] ? String(row['commit_sha']) : null,
    added: Number(row['added'] ?? 0), changed: Number(row['changed'] ?? 0), removed: Number(row['removed'] ?? 0),
    error: String(row['error'] ?? ''), log: parseJson<string[]>(String(row['log'] ?? '[]'), []),
  }));
}

/* ─── Packages & versions ───────────────────────────────── */
type PackageRow = Record<string, string | number | null>;

function packageFromRow(row: PackageRow): PackageRecord {
  const kind = String(row['kind']) as PackageKind;
  return {
    id: String(row['id']),
    workspaceId: String(row['workspace_id']),
    marketplaceId: String(row['marketplace_id']),
    kind,
    key: String(row['package_key']),
    name: String(row['name']),
    latestVersion: String(row['latest_version']),
    category: String(row['category']),
    tags: parseJson<string[]>(String(row['tags'] ?? '[]'), []),
    manifest: readStoredManifest(kind, String(row['manifest'])) ?? ({} as PackageManifest),
    checksum: String(row['checksum']),
    trust: String(row['trust']) as TrustLevel,
    status: String(row['status']) as PackageRecord['status'],
    sourcePath: String(row['source_path'] ?? ''),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export function listPackages(workspaceId: string, filter: { kind?: PackageKind; marketplaceId?: string; status?: PackageRecord['status'] } = {}): PackageRecord[] {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT * FROM ext_packages WHERE workspace_id = ? ORDER BY name ASC').all(workspaceId) as PackageRow[];
  return rows.map(packageFromRow).filter((pkg) => (!filter.kind || pkg.kind === filter.kind)
    && (!filter.marketplaceId || pkg.marketplaceId === filter.marketplaceId)
    && (!filter.status || pkg.status === filter.status));
}

export function getPackage(workspaceId: string, id: string): PackageRecord | null {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT * FROM ext_packages WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as PackageRow | undefined;
  return row ? packageFromRow(row) : null;
}

export function findPackageByKey(workspaceId: string, kind: PackageKind, key: string): PackageRecord | null {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT * FROM ext_packages WHERE workspace_id = ? AND kind = ? AND package_key = ? AND status != ? LIMIT 1')
    .get(workspaceId, kind, key, 'revoked') as PackageRow | undefined;
  return row ? packageFromRow(row) : null;
}

export function upsertPackage(input: {
  workspaceId: string; marketplaceId: string; kind: PackageKind; manifest: PackageManifest;
  instructions?: string; sourcePath?: string; sourceSha?: string; trust: TrustLevel;
}): { packageId: string; created: boolean; changed: boolean; conflict: boolean; version: string } {
  ensureExtensionSchema();
  const db = getOsDb();
  const manifest = input.manifest;
  const checksum = checksumOf(manifest, input.instructions ?? '');
  const ts = nowIso();
  const existing = db.prepare('SELECT * FROM ext_packages WHERE marketplace_id = ? AND kind = ? AND package_key = ?')
    .get(input.marketplaceId, input.kind, manifest.id) as PackageRow | undefined;
  let packageId: string;
  let created = false;
  let changed = false;
  let conflict = false;
  if (!existing) {
    packageId = newId('pkg');
    db.prepare(
      `INSERT INTO ext_packages (id, workspace_id, marketplace_id, kind, package_key, name, latest_version, category, tags, manifest, checksum, trust, status, source_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
    ).run(packageId, input.workspaceId, input.marketplaceId, input.kind, manifest.id, manifest.name, manifest.version,
      manifest.category, JSON.stringify(manifest.tags), JSON.stringify(manifest), checksum, input.trust, input.sourcePath ?? '', ts, ts);
    created = true;
  } else {
    packageId = String(existing['id']);
    const previousVersion = String(existing['latest_version']);
    const previous = parseSemver(previousVersion);
    const next = parseSemver(manifest.version);
    const latest = previous && next && compareSemver(next, previous) > 0 ? manifest.version : previousVersion;
    const previousChecksum = String(existing['checksum']);
    changed = previousChecksum !== checksum || String(existing['status']) === 'missing';
    db.prepare(
      `UPDATE ext_packages SET name = ?, latest_version = ?, category = ?, tags = ?, manifest = ?, checksum = ?, trust = ?, status = 'available', source_path = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    ).run(manifest.name, latest, manifest.category, JSON.stringify(manifest.tags), JSON.stringify(manifest), checksum,
      input.trust, input.sourcePath ?? '', ts, packageId, input.workspaceId);
  }
  const versionRow = db.prepare('SELECT id, checksum FROM ext_package_versions WHERE package_id = ? AND version = ?')
    .get(packageId, manifest.version) as { id: string; checksum: string } | undefined;
  if (!versionRow) {
    db.prepare(
      `INSERT INTO ext_package_versions (id, package_id, version, manifest, checksum, instructions, source_sha, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId('ver'), packageId, manifest.version, JSON.stringify(manifest), checksum, input.instructions ?? '', input.sourceSha ?? '', ts);
    changed = true;
  } else if (versionRow.checksum !== checksum) {
    // A published version is immutable: never silently replace content that an
    // installation may already be running.
    conflict = true;
  }
  return { packageId, created, changed, conflict, version: manifest.version };
}

/** Packages that disappeared from a repository are flagged, never deleted silently. */
export function markMissingPackages(workspaceId: string, marketplaceId: string, seenKeys: Set<string>): number {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT id, kind, package_key FROM ext_packages WHERE workspace_id = ? AND marketplace_id = ?')
    .all(workspaceId, marketplaceId) as Array<{ id: string; kind: string; package_key: string }>;
  let removed = 0;
  for (const row of rows) {
    if (seenKeys.has(`${row.kind}:${row.package_key}`)) continue;
    const installed = getOsDb().prepare("SELECT COUNT(*) AS c FROM ext_installations WHERE package_id = ? AND status != 'removed'").get(row.id) as { c: number };
    getOsDb().prepare("UPDATE ext_packages SET status = ?, updated_at = ? WHERE id = ?").run(installed.c > 0 ? 'missing' : 'revoked', nowIso(), row.id);
    removed += 1;
  }
  return removed;
}

export function listVersions(workspaceId: string, packageId: string): PackageVersionRecord[] {
  ensureExtensionSchema();
  const pkg = getPackage(workspaceId, packageId);
  if (!pkg) return [];
  const rows = getOsDb().prepare('SELECT * FROM ext_package_versions WHERE package_id = ? ORDER BY published_at DESC').all(packageId) as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    id: String(row['id']), version: String(row['version']),
    manifest: readStoredManifest(pkg.kind, String(row['manifest'])) ?? ({} as PackageManifest),
    checksum: String(row['checksum']), instructions: String(row['instructions'] ?? ''),
    sourceSha: String(row['source_sha'] ?? ''), yanked: Number(row['yanked']) === 1, publishedAt: String(row['published_at']),
  }));
}

export function getVersion(workspaceId: string, packageId: string, version: string): PackageVersionRecord | null {
  return listVersions(workspaceId, packageId).find((entry) => entry.version === version) ?? null;
}

export function resolveVersion(workspaceId: string, packageId: string, constraint: string): PackageVersionRecord | null {
  const pkg = getPackage(workspaceId, packageId);
  if (!pkg) return null;
  const versions = listVersions(workspaceId, packageId).filter((entry) => !entry.yanked && satisfies(entry.version, constraint));
  versions.sort((a, b) => {
    const left = parseSemver(a.version); const right = parseSemver(b.version);
    return left && right ? compareSemver(right, left) : 0;
  });
  return versions[0] ?? null;
}

/* ─── Installations ─────────────────────────────────────── */
type InstallationRow = Record<string, string | number | null>;

function installationFromRow(row: InstallationRow): InstallationRecord {
  return {
    id: String(row['id']), workspaceId: String(row['workspace_id']), packageId: String(row['package_id']),
    version: String(row['version']), scope: String(row['scope']) as PackageScope, scopeId: String(row['scope_id'] ?? ''),
    enabled: Number(row['enabled']) === 1, autoLoad: Number(row['auto_load']) === 1,
    status: String(row['status']) as InstallationRecord['status'],
    permissionsApproved: Number(row['permissions_approved']) === 1,
    approvedBy: row['approved_by'] ? String(row['approved_by']) : null,
    approvedAt: row['approved_at'] ? String(row['approved_at']) : null,
    installedBy: String(row['installed_by']), installedAt: String(row['installed_at']),
    updatedAt: String(row['updated_at']), removedAt: row['removed_at'] ? String(row['removed_at']) : null,
  };
}

export function listInstallations(workspaceId: string, filter: { packageId?: string; agentId?: string } = {}): InstallationRecord[] {
  ensureExtensionSchema();
  const rows = getOsDb().prepare("SELECT * FROM ext_installations WHERE workspace_id = ? AND status != 'removed' ORDER BY installed_at DESC")
    .all(workspaceId) as InstallationRow[];
  return rows.map(installationFromRow).filter((row) => (!filter.packageId || row.packageId === filter.packageId)
    && (!filter.agentId || (row.scope === 'agent' && row.scopeId === filter.agentId)));
}

export function getInstallation(workspaceId: string, id: string): InstallationRecord | null {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT * FROM ext_installations WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as InstallationRow | undefined;
  return row ? installationFromRow(row) : null;
}

export function findInstallation(workspaceId: string, packageId: string, scope: PackageScope, scopeId: string): InstallationRecord | null {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT * FROM ext_installations WHERE workspace_id = ? AND package_id = ? AND scope = ? AND scope_id = ?')
    .get(workspaceId, packageId, scope, scopeId) as InstallationRow | undefined;
  return row ? installationFromRow(row) : null;
}

export function createInstallation(input: {
  workspaceId: string; packageId: string; version: string; scope: PackageScope; scopeId: string;
  enabled: boolean; autoLoad: boolean; status: InstallationRecord['status']; permissionsApproved: boolean;
  actor: string;
}): InstallationRecord {
  ensureExtensionSchema();
  const db = getOsDb();
  const existing = findInstallation(input.workspaceId, input.packageId, input.scope, input.scopeId);
  const ts = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE ext_installations SET version = ?, enabled = ?, auto_load = ?, status = ?, permissions_approved = ?, updated_at = ?, removed_at = NULL WHERE id = ?`,
    ).run(input.version, input.enabled ? 1 : 0, input.autoLoad ? 1 : 0, input.status, input.permissionsApproved ? 1 : 0, ts, existing.id);
    return getInstallation(input.workspaceId, existing.id)!;
  }
  const id = newId('ins');
  db.prepare(
    `INSERT INTO ext_installations (id, workspace_id, package_id, version, scope, scope_id, enabled, auto_load, status, permissions_approved, installed_by, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.workspaceId, input.packageId, input.version, input.scope, input.scopeId,
    input.enabled ? 1 : 0, input.autoLoad ? 1 : 0, input.status, input.permissionsApproved ? 1 : 0, input.actor, ts, ts);
  return getInstallation(input.workspaceId, id)!;
}

export function updateInstallation(workspaceId: string, id: string, patch: {
  version?: string; enabled?: boolean; autoLoad?: boolean; status?: InstallationRecord['status'];
  permissionsApproved?: boolean; approvedBy?: string | null; approvedAt?: string | null;
}, actor: string): InstallationRecord | null {
  const current = getInstallation(workspaceId, id);
  if (!current) return null;
  getOsDb().prepare(
    `UPDATE ext_installations SET version = ?, enabled = ?, auto_load = ?, status = ?, permissions_approved = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
  ).run(patch.version ?? current.version, (patch.enabled ?? current.enabled) ? 1 : 0, (patch.autoLoad ?? current.autoLoad) ? 1 : 0,
    patch.status ?? current.status, (patch.permissionsApproved ?? current.permissionsApproved) ? 1 : 0,
    patch.approvedBy === undefined ? current.approvedBy : patch.approvedBy,
    patch.approvedAt === undefined ? current.approvedAt : patch.approvedAt, nowIso(), workspaceId, id);
  extensionAudit(workspaceId, actor, 'extension.installation.update', id, { fields: Object.keys(patch) });
  return getInstallation(workspaceId, id);
}

export function replaceDependencies(workspaceId: string, installationId: string, dependencies: InstallationDependency[]): void {
  ensureExtensionSchema();
  const db = getOsDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM ext_installation_deps WHERE installation_id = ?').run(installationId);
    const insert = db.prepare(
      `INSERT INTO ext_installation_deps (id, installation_id, workspace_id, dep_key, constraint_range, resolved_version, satisfied, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const dep of dependencies) {
      insert.run(newId('dep'), installationId, workspaceId, dep.depKey, dep.constraint, dep.resolvedVersion,
        dep.satisfied ? 1 : 0, dep.detail.slice(0, 500));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listDependencies(installationId: string): InstallationDependency[] {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT * FROM ext_installation_deps WHERE installation_id = ? ORDER BY dep_key').all(installationId) as Array<Record<string, string | number | null>>;
  return rows.map((row) => ({
    depKey: String(row['dep_key']), constraint: String(row['constraint_range']),
    resolvedVersion: row['resolved_version'] ? String(row['resolved_version']) : null,
    satisfied: Number(row['satisfied']) === 1, detail: String(row['detail'] ?? ''),
  }));
}

export function removeInstallation(workspaceId: string, id: string, actor: string): boolean {
  ensureExtensionSchema();
  const db = getOsDb();
  const current = getInstallation(workspaceId, id);
  if (!current) return false;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM ext_tools WHERE installation_id = ?').run(id);
    db.prepare('DELETE FROM ext_mcp_servers WHERE installation_id = ?').run(id);
    db.prepare('DELETE FROM ext_installation_deps WHERE installation_id = ?').run(id);
    db.prepare("UPDATE ext_installations SET status = 'removed', enabled = 0, removed_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
      .run(nowIso(), nowIso(), id, workspaceId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  extensionAudit(workspaceId, actor, 'extension.installation.remove', id, { packageId: current.packageId, scope: current.scope });
  return true;
}

/* ─── Plugin tools ──────────────────────────────────────── */
export function replaceTools(workspaceId: string, installationId: string, pluginKey: string, packageId: string, tools: Array<{
  toolId: string; toolKey: string; name: string; description: string; inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>; semanticContract?: Record<string, unknown>; permissions: string[]; timeoutMs: number; risk: 'low' | 'medium' | 'high';
  executionMode: RegisteredTool['executionMode'];
}>): RegisteredTool[] {
  ensureExtensionSchema();
  const db = getOsDb();
  const ts = nowIso();
  const created: RegisteredTool[] = [];
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM ext_tools WHERE installation_id = ?').run(installationId);
    const insert = db.prepare(
      `INSERT INTO ext_tools (id, workspace_id, installation_id, package_id, plugin_key, tool_key, tool_id, name, description, input_schema, output_schema, semantic_contract, permissions, timeout_ms, risk, execution_mode, status, health, audit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'unknown', 1, ?, ?)`,
    );
    for (const tool of tools) {
      const id = newId('tl');
      insert.run(id, workspaceId, installationId, packageId, pluginKey, tool.toolKey, tool.toolId, tool.name, tool.description,
        JSON.stringify(tool.inputSchema), tool.outputSchema ? JSON.stringify(tool.outputSchema) : null,
        tool.semanticContract ? JSON.stringify(tool.semanticContract) : null, JSON.stringify(tool.permissions), tool.timeoutMs, tool.risk, tool.executionMode, ts, ts);
      created.push({
        id, workspaceId, installationId, packageId, pluginKey, toolKey: tool.toolKey, toolId: tool.toolId,
        name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema ?? null, semanticContract: tool.semanticContract ?? null, permissions: tool.permissions, timeoutMs: tool.timeoutMs,
        risk: tool.risk, executionMode: tool.executionMode, status: 'active', health: 'unknown', audit: true,
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return created;
}

type ToolRow = Record<string, string | number | null>;

function toolFromRow(row: ToolRow): RegisteredTool {
  return {
    id: String(row['id']), workspaceId: String(row['workspace_id']), installationId: String(row['installation_id']),
    packageId: String(row['package_id']), pluginKey: String(row['plugin_key']), toolKey: String(row['tool_key']),
    toolId: String(row['tool_id']), name: String(row['name']), description: String(row['description']),
    inputSchema: parseJson<Record<string, unknown>>(String(row['input_schema'] ?? '{}'), {}),
    outputSchema: row['output_schema'] ? parseJson<Record<string, unknown>>(String(row['output_schema']), {}) : null,
    semanticContract: row['semantic_contract'] ? parseJson<Record<string, unknown>>(String(row['semantic_contract']), {}) : null,
    permissions: parseJson<string[]>(String(row['permissions'] ?? '[]'), []),
    timeoutMs: Number(row['timeout_ms'] ?? 15_000), risk: String(row['risk']) as RegisteredTool['risk'],
    executionMode: String(row['execution_mode']) as RegisteredTool['executionMode'],
    status: String(row['status']) as RegisteredTool['status'], health: String(row['health']) as RegisteredTool['health'],
    audit: Number(row['audit']) === 1,
  };
}

export function listRegisteredTools(workspaceId: string, filter: { activeOnly?: boolean } = {}): RegisteredTool[] {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT * FROM ext_tools WHERE workspace_id = ? ORDER BY tool_id').all(workspaceId) as ToolRow[];
  return rows.map(toolFromRow).filter((tool) => !filter.activeOnly || tool.status === 'active');
}

export function getRegisteredTool(workspaceId: string, toolId: string): RegisteredTool | null {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT * FROM ext_tools WHERE workspace_id = ? AND tool_id = ?').get(workspaceId, toolId) as ToolRow | undefined;
  return row ? toolFromRow(row) : null;
}

export function setToolHealth(workspaceId: string, toolId: string, health: RegisteredTool['health']): void {
  ensureExtensionSchema();
  getOsDb().prepare('UPDATE ext_tools SET health = ?, updated_at = ? WHERE workspace_id = ? AND tool_id = ?').run(health, nowIso(), workspaceId, toolId);
}

/* ─── MCP servers ───────────────────────────────────────── */
export function upsertMcpServer(workspaceId: string, input: {
  installationId: string; name: string; transport: 'stdio' | 'http'; command?: string | null;
  args?: string[]; url?: string | null; envKeys?: string[];
}): McpServerRecord {
  ensureExtensionSchema();
  const db = getOsDb();
  const ts = nowIso();
  const existing = db.prepare('SELECT id FROM ext_mcp_servers WHERE installation_id = ?').get(input.installationId) as { id: string } | undefined;
  const id = existing?.id ?? newId('mcp');
  db.prepare(
    `INSERT INTO ext_mcp_servers (id, workspace_id, installation_id, name, transport, command, args, url, env_keys, status, health, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', 'unknown', ?, ?)
     ON CONFLICT(installation_id) DO UPDATE SET name = excluded.name, transport = excluded.transport, command = excluded.command,
       args = excluded.args, url = excluded.url, env_keys = excluded.env_keys, updated_at = excluded.updated_at`,
  ).run(id, workspaceId, input.installationId, input.name, input.transport, input.command ?? null,
    JSON.stringify(input.args ?? []), input.url ?? null, JSON.stringify(input.envKeys ?? []), ts, ts);
  return getMcpServer(workspaceId, id)!;
}

export function getMcpServer(workspaceId: string, id: string): McpServerRecord | null {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT * FROM ext_mcp_servers WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  return {
    id: String(row['id']), workspaceId: String(row['workspace_id']), installationId: String(row['installation_id']),
    name: String(row['name']), transport: String(row['transport']) as 'stdio' | 'http',
    command: row['command'] ? String(row['command']) : null, args: parseJson<string[]>(String(row['args'] ?? '[]'), []),
    url: row['url'] ? String(row['url']) : null, envKeys: parseJson<string[]>(String(row['env_keys'] ?? '[]'), []),
    status: String(row['status']) as McpServerRecord['status'], health: String(row['health']) as McpServerRecord['health'],
    lastCheckAt: row['last_check_at'] ? String(row['last_check_at']) : null,
    lastError: String(row['last_error'] ?? ''), discoveredTools: Number(row['discovered_tools'] ?? 0),
  };
}

export function getMcpServerForInstallation(workspaceId: string, installationId: string): McpServerRecord | null {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT id FROM ext_mcp_servers WHERE workspace_id = ? AND installation_id = ?').get(workspaceId, installationId) as { id: string } | undefined;
  return row ? getMcpServer(workspaceId, row.id) : null;
}

export function listMcpServers(workspaceId: string): McpServerRecord[] {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT id FROM ext_mcp_servers WHERE workspace_id = ? ORDER BY name').all(workspaceId) as Array<{ id: string }>;
  return rows.map((row) => getMcpServer(workspaceId, row.id)).filter((row): row is McpServerRecord => Boolean(row));
}

export function setMcpHealth(workspaceId: string, id: string, patch: {
  status: McpServerRecord['status']; health: McpServerRecord['health']; error?: string; discoveredTools?: number;
}): void {
  ensureExtensionSchema();
  getOsDb().prepare(
    `UPDATE ext_mcp_servers SET status = ?, health = ?, last_error = ?, discovered_tools = COALESCE(?, discovered_tools), last_check_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
  ).run(patch.status, patch.health, (patch.error ?? '').slice(0, 1_000), patch.discoveredTools ?? null, nowIso(), nowIso(), workspaceId, id);
}

/* ─── Agent policies & snapshots ────────────────────────── */
export function getAgentPolicy(workspaceId: string, agentId: string): AgentPolicyRecord {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT * FROM ext_agent_policies WHERE workspace_id = ? AND agent_id = ?')
    .get(workspaceId, agentId) as Record<string, string | number | null> | undefined;
  if (!row) {
    return { agentId, organizationId: null, projectIds: [], deniedPackages: [], deniedTools: [], deniedPermissions: [], extraPermissions: [], autoLoad: true, updatedAt: '' };
  }
  return {
    agentId, organizationId: row['organization_id'] ? String(row['organization_id']) : null,
    projectIds: parseJson<string[]>(String(row['project_ids'] ?? '[]'), []),
    deniedPackages: parseJson<string[]>(String(row['denied_packages'] ?? '[]'), []),
    deniedTools: parseJson<string[]>(String(row['denied_tools'] ?? '[]'), []),
    deniedPermissions: parseJson<string[]>(String(row['denied_permissions'] ?? '[]'), []),
    extraPermissions: parseJson<string[]>(String(row['extra_permissions'] ?? '[]'), []),
    autoLoad: Number(row['auto_load']) === 1, updatedAt: String(row['updated_at'] ?? ''),
  };
}

export function setAgentPolicy(workspaceId: string, agentId: string, patch: Partial<Omit<AgentPolicyRecord, 'agentId' | 'updatedAt'>>, actor: string): AgentPolicyRecord {
  const current = getAgentPolicy(workspaceId, agentId);
  const next = { ...current, ...patch };
  getOsDb().prepare(
    `INSERT INTO ext_agent_policies (workspace_id, agent_id, organization_id, project_ids, denied_packages, denied_tools, denied_permissions, extra_permissions, auto_load, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, agent_id) DO UPDATE SET organization_id = excluded.organization_id, project_ids = excluded.project_ids,
       denied_packages = excluded.denied_packages, denied_tools = excluded.denied_tools, denied_permissions = excluded.denied_permissions,
       extra_permissions = excluded.extra_permissions, auto_load = excluded.auto_load, updated_at = excluded.updated_at`,
  ).run(workspaceId, agentId, next.organizationId ?? null, JSON.stringify(next.projectIds), JSON.stringify(next.deniedPackages),
    JSON.stringify(next.deniedTools), JSON.stringify(next.deniedPermissions), JSON.stringify(next.extraPermissions), next.autoLoad ? 1 : 0, nowIso());
  extensionAudit(workspaceId, actor, 'extension.agent-policy.update', agentId, { fields: Object.keys(patch) });
  return getAgentPolicy(workspaceId, agentId);
}

export function saveCapabilitySnapshot(input: {
  workspaceId: string; missionId?: string | null; taskId?: string | null; agentId: string;
  digest: string; profile: Record<string, unknown>;
}): string {
  ensureExtensionSchema();
  const id = newId('cap');
  getOsDb().prepare(
    'INSERT INTO ext_capability_snapshots (id, workspace_id, mission_id, task_id, agent_id, digest, profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, input.workspaceId, input.missionId ?? null, input.taskId ?? null, input.agentId, input.digest, JSON.stringify(input.profile), nowIso());
  return id;
}

export function listCapabilitySnapshots(workspaceId: string, filter: { missionId?: string; agentId?: string; limit?: number } = {}): CapabilitySnapshotRecord[] {
  ensureExtensionSchema();
  const clauses = ['workspace_id = ?'];
  const values: Array<string | number> = [workspaceId];
  if (filter.missionId) { clauses.push('mission_id = ?'); values.push(filter.missionId); }
  if (filter.agentId) { clauses.push('agent_id = ?'); values.push(filter.agentId); }
  values.push(Math.min(Math.max(filter.limit ?? 50, 1), 200));
  const rows = getOsDb().prepare(`SELECT * FROM ext_capability_snapshots WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as Array<Record<string, string | null>>;
  return rows.map((row) => ({
      id: String(row['id']), missionId: row['mission_id'] ?? null, taskId: row['task_id'] ?? null,
      agentId: String(row['agent_id']), digest: String(row['digest']),
      profile: parseJson<Record<string, unknown>>(String(row['profile']), {}), createdAt: String(row['created_at']),
    }));
}

/* ─── Skill context provenance ─────────────────────────── */
export interface SkillContextSelected {
  key: string; version: string; instructionDigest: string; score: number; tokens: number;
  matched: string[]; reason: string; scope: string; scopeId: string; autoLoad: boolean;
}
export interface SkillContextOmitted { key: string; reason: string }
export interface SkillContextRecord {
  id: string;
  workspaceId: string;
  missionId: string | null;
  taskId: string | null;
  agentId: string;
  digest: string;
  tokenBudget: number;
  tokensUsed: number;
  selected: SkillContextSelected[];
  omitted: SkillContextOmitted[];
  contextText: string;
  policy: SkillExecutionPolicy;
  createdAt: string;
}

export function saveSkillContext(input: {
  workspaceId: string; missionId?: string | null; taskId?: string | null; agentId: string;
  digest: string; tokenBudget: number; tokensUsed: number;
  selected: SkillContextSelected[]; omitted: SkillContextOmitted[]; contextText: string;
  policy: SkillExecutionPolicy;
}): string {
  ensureExtensionSchema();
  const id = newId('skc');
  getOsDb().prepare(
    `INSERT INTO ext_skill_contexts (id, workspace_id, mission_id, task_id, agent_id, digest, token_budget, tokens_used, selected, omitted, context_text, policy, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.workspaceId, input.missionId ?? null, input.taskId ?? null, input.agentId, input.digest,
    input.tokenBudget, input.tokensUsed, JSON.stringify(input.selected), JSON.stringify(input.omitted),
    input.contextText.slice(0, 24_000), JSON.stringify(input.policy), nowIso());
  return id;
}

export function listSkillContexts(workspaceId: string, filter: {
  missionId?: string; taskId?: string; agentId?: string; limit?: number;
} = {}): SkillContextRecord[] {
  ensureExtensionSchema();
  const clauses = ['workspace_id = ?'];
  const values: Array<string | number> = [workspaceId];
  if (filter.missionId) { clauses.push('mission_id = ?'); values.push(filter.missionId); }
  if (filter.taskId) { clauses.push('task_id = ?'); values.push(filter.taskId); }
  if (filter.agentId) { clauses.push('agent_id = ?'); values.push(filter.agentId); }
  values.push(Math.min(Math.max(filter.limit ?? 100, 1), 500));
  const rows = getOsDb().prepare(`SELECT * FROM ext_skill_contexts WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as Array<Record<string, string | number | null>>;
  return rows.map((row) => ({
    id: String(row['id']), workspaceId: String(row['workspace_id']),
    missionId: row['mission_id'] ? String(row['mission_id']) : null,
    taskId: row['task_id'] ? String(row['task_id']) : null,
    agentId: String(row['agent_id']), digest: String(row['digest']),
    tokenBudget: Number(row['token_budget'] ?? 0), tokensUsed: Number(row['tokens_used'] ?? 0),
    selected: parseJson<SkillContextSelected[]>(String(row['selected'] ?? '[]'), []),
    omitted: parseJson<SkillContextOmitted[]>(String(row['omitted'] ?? '[]'), []),
    contextText: String(row['context_text'] ?? ''),
    policy: parseJson<SkillExecutionPolicy>(String(row['policy'] ?? '{}'), {}),
    createdAt: String(row['created_at']),
  }));
}

/* ─── Summary & audit ───────────────────────────────────── */
export function extensionSummary(workspaceId: string) {
  ensureExtensionSchema();
  const db = getOsDb();
  const count = (sql: string) => (db.prepare(sql).get(workspaceId) as { c: number }).c;
  return {
    marketplaces: count('SELECT COUNT(*) c FROM ext_marketplaces WHERE workspace_id = ?'),
    skills: count("SELECT COUNT(*) c FROM ext_packages WHERE workspace_id = ? AND kind = 'skill'"),
    plugins: count("SELECT COUNT(*) c FROM ext_packages WHERE workspace_id = ? AND kind = 'plugin'"),
    installed: count("SELECT COUNT(*) c FROM ext_installations WHERE workspace_id = ? AND status != 'removed'"),
    enabled: count("SELECT COUNT(*) c FROM ext_installations WHERE workspace_id = ? AND status != 'removed' AND enabled = 1"),
    pendingApproval: count("SELECT COUNT(*) c FROM ext_installations WHERE workspace_id = ? AND status = 'pending_approval'"),
    tools: count("SELECT COUNT(*) c FROM ext_tools WHERE workspace_id = ? AND status = 'active'"),
    mcpServers: count('SELECT COUNT(*) c FROM ext_mcp_servers WHERE workspace_id = ?'),
    secrets: count('SELECT COUNT(*) c FROM ext_secrets WHERE workspace_id = ?'),
    snapshots: count('SELECT COUNT(*) c FROM ext_capability_snapshots WHERE workspace_id = ?'),
  };
}

export function listExtensionAudit(workspaceId: string, limit = 50): Array<{ id: string; actor: string; action: string; subject: string; detail: Record<string, unknown>; createdAt: string }> {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT * FROM ext_audit WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, Math.min(limit, 200)) as Array<Record<string, string>>;
  return rows.map((row) => ({
    id: row['id'] ?? '', actor: row['actor'] ?? '', action: row['action'] ?? '', subject: row['subject'] ?? '',
    detail: parseJson<Record<string, unknown>>(row['detail'] ?? '{}', {}), createdAt: row['created_at'] ?? '',
  }));
}

export type { SkillManifest, PluginManifest };

export function setPackageStatus(workspaceId: string, packageId: string, status: PackageRecord['status']): void {
  ensureExtensionSchema();
  getOsDb().prepare('UPDATE ext_packages SET status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?').run(status, nowIso(), workspaceId, packageId);
}
