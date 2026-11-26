/**
 * WORA extensions — Git marketplace registration and synchronization.
 *
 * Registering validates the repository before anything is persisted. Sync
 * discovers manifests, validates each one, records added/changed/removed
 * packages and never deletes an installed version. Auto-load only re-enables
 * already-approved installations; it never installs or executes anything.
 */
import {
  MAX_MANIFEST_BYTES, validateManifest, type PackageKind, type PackageManifest, type PackageScope, type SkillManifest, type TrustLevel,
} from './manifest.js';
import {
  createMarketplace, findPackageByKey, finishSync, getMarketplace, listPackages, markMissingPackages,
  setMarketplaceSyncResult, startSync, upsertPackage, type MarketplaceRecord,
} from './store.js';
import { fetchRepository, classifySource, MarketplaceError } from './git.js';

export { MarketplaceError } from './git.js';
import { revealSecret } from './secrets.js';

export interface MarketplaceInput {
  workspaceId: string;
  name: string;
  url: string;
  ref?: string;
  refType?: 'branch' | 'tag' | 'commit';
  path?: string;
  scope?: PackageScope;
  scopeId?: string;
  autoLoad?: boolean;
  trust?: TrustLevel;
  secretName?: string | null;
  actor: string;
}

export interface DiscoveredPackage {
  kind: PackageKind;
  key: string;
  name: string;
  version: string;
  path: string;
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
  warnings: string[];
  manifest: PackageManifest | null;
}

const SAFE_PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]*$/u;

export function normalizeRef(ref: string | undefined, refType: 'branch' | 'tag' | 'commit'): string {
  const value = (ref ?? 'main').trim();
  if (!value || value.length > 200) throw new MarketplaceError('INVALID_REF', 'Repository ref is empty or too long');
  if (value.startsWith('-')) throw new MarketplaceError('INVALID_REF', 'Repository refs may not begin with a dash');
  if (refType === 'commit' && !/^[a-f0-9]{7,64}$/iu.test(value)) throw new MarketplaceError('INVALID_REF', 'Pinned commits must be hexadecimal SHAs');
  if (/[\s~^:?*[\\]/u.test(value) || value.includes('..')) throw new MarketplaceError('INVALID_REF', 'Repository ref contains forbidden characters');
  return value;
}

export function normalizePath(value: string | undefined): string {
  const path = (value ?? '').trim().replace(/^\/+|\/+$/gu, '');
  if (!path) return '';
  if (path.length > 200 || !SAFE_PATH.test(path) || path.split('/').includes('..')) {
    throw new MarketplaceError('INVALID_PATH', 'Repository path must be a relative POSIX path inside the repository');
  }
  return path;
}

export function normalizeMarketplaceInput(input: MarketplaceInput) {
  const url = input.url.trim();
  const provider = classifySource(url);
  const refType = input.refType ?? 'branch';
  const ref = normalizeRef(input.ref, refType);
  const path = normalizePath(input.path);
  const name = input.name.trim().slice(0, 120) || url.split('/').slice(-1)[0]?.replace(/\.git$/u, '') || 'Marketplace';
  const trust = input.trust ?? 'community' as TrustLevel;
  if (trust === 'official') throw new MarketplaceError('TRUST_DENIED', 'Official trust is reserved for the bundled WORA catalog');
  return { url, provider, refType, ref, path, name, trust };
}

async function readSnapshot(input: { url: string; ref: string; refType: 'branch' | 'tag' | 'commit'; path: string; secret: string | null }) {
  return fetchRepository({ url: input.url, ref: input.ref, refType: input.refType, subPath: input.path, secret: input.secret });
}

/** Validate a repository without persisting a marketplace. */
export async function previewMarketplace(input: MarketplaceInput): Promise<{ packages: DiscoveredPackage[]; commit: string | null; provider: string; log: string[] }> {
  const normalized = normalizeMarketplaceInput(input);
  const secret = input.secretName ? revealSecret(input.workspaceId, input.secretName) : null;
  const snapshot = await readSnapshot({ ...normalized, secret });
  const packages = snapshot.files.map((file) => {
    let raw: unknown;
    try { raw = JSON.parse(file.manifestSource); }
    catch { return { kind: file.kind, key: file.manifestPath, name: file.manifestPath, version: '0.0.0', path: file.manifestPath, ok: false, errors: [{ path: '', message: 'Manifest is not valid JSON' }], warnings: [], manifest: null }; }
    const result = validateManifest(file.kind, raw, normalized.trust);
    return {
      kind: file.kind,
      key: result.manifest?.id ?? file.manifestPath,
      name: result.manifest?.name ?? file.manifestPath,
      version: result.manifest?.version ?? '0.0.0',
      path: file.manifestPath,
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
      manifest: result.manifest,
    };
  });
  if (!packages.length) throw new MarketplaceError('NO_PACKAGES', 'No skill.json or plugin.json manifests were found in this repository');
  return { packages, commit: snapshot.commit, provider: snapshot.provider, log: snapshot.log };
}

export async function registerMarketplace(input: MarketplaceInput): Promise<{ marketplace: MarketplaceRecord; sync: { added: number; changed: number; commit: string | null; warnings: string[] } }> {
  const normalized = normalizeMarketplaceInput(input);
  if (normalized.provider === 'local' && !process.env['WORA_EXTENSIONS_LOCAL_ROOTS']) {
    throw new MarketplaceError('LOCAL_ROOT_DENIED', 'Local marketplaces require WORA_EXTENSIONS_LOCAL_ROOTS to be configured');
  }
  const secret = input.secretName ? revealSecret(input.workspaceId, input.secretName) : null;
  if (input.secretName && !secret) throw new MarketplaceError('SECRET_NOT_FOUND', 'The configured marketplace credential does not exist');

  // Validate before persisting so a broken repository leaves no half-registered marketplace.
  const snapshot = await readSnapshot({ ...normalized, secret });
  if (!snapshot.files.length) throw new MarketplaceError('NO_PACKAGES', 'No skill.json or plugin.json manifests were found in this repository');

  const marketplace = createMarketplace({
    workspaceId: input.workspaceId,
    name: normalized.name,
    url: normalized.url,
    provider: normalized.provider,
    ref: normalized.ref,
    refType: normalized.refType,
    path: normalized.path,
    scope: input.scope ?? 'instance',
    scopeId: input.scopeId ?? '',
    autoLoad: input.autoLoad ?? false,
    trust: normalized.trust,
    secretName: input.secretName ?? null,
    actor: input.actor,
  });
  const sync = await applySnapshot(input.workspaceId, marketplace, snapshot.files, snapshot.commit, snapshot.log);
  return { marketplace: getMarketplace(input.workspaceId, marketplace.id)!, sync };
}

async function applySnapshot(
  workspaceId: string,
  marketplace: MarketplaceRecord,
  files: Awaited<ReturnType<typeof fetchRepository>>['files'],
  commit: string | null,
  log: string[],
): Promise<{ added: number; changed: number; commit: string | null; warnings: string[] }> {
  let added = 0;
  let changed = 0;
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (Buffer.byteLength(file.manifestSource) > MAX_MANIFEST_BYTES) {
      log.push(`${file.manifestPath}: manifest exceeds size limit — skipped`);
      continue;
    }
    let raw: unknown;
    try { raw = JSON.parse(file.manifestSource); }
    catch { log.push(`${file.manifestPath}: invalid JSON — skipped`); continue; }
    const result = validateManifest(file.kind, raw, marketplace.trust);
    if (!result.ok || !result.manifest) {
      log.push(`${file.manifestPath}: ${result.errors.map((error) => `${error.path || 'manifest'}: ${error.message}`).join('; ')}`);
      continue;
    }
    const manifest = result.manifest;
    const duplicate = findPackageByKey(workspaceId, file.kind, manifest.id);
    if (duplicate && duplicate.marketplaceId !== marketplace.id) {
      log.push(`${manifest.id}@${manifest.version}: package id already published by another marketplace — skipped`);
      warnings.push(`${manifest.id} is already provided by another marketplace`);
      continue;
    }
    const instructions = file.kind === 'skill' ? (manifest as SkillManifest).instructions : '';
    const upserted = upsertPackage({
      workspaceId,
      marketplaceId: marketplace.id,
      kind: file.kind,
      manifest,
      instructions,
      sourcePath: file.manifestPath,
      sourceSha: file.sourceSha,
      trust: marketplace.trust,
    });
    if (upserted.conflict) {
      log.push(`${manifest.id}@${manifest.version}: published content changed (checksum mismatch) — stored version kept`);
      warnings.push(`${manifest.id}@${manifest.version} was republished with different content; WORA kept the installed version`);
      seen.add(`${file.kind}:${manifest.id}`);
      continue;
    }
    if (upserted.created) added += 1;
    else if (upserted.changed) changed += 1;
    seen.add(`${file.kind}:${manifest.id}`);
    for (const warning of result.warnings) log.push(`${manifest.id}: ${warning}`);
  }
  const removed = markMissingPackages(workspaceId, marketplace.id, seen);
  const total = listPackages(workspaceId, { marketplaceId: marketplace.id }).filter((pkg) => pkg.status !== 'revoked').length;
  setMarketplaceSyncResult(workspaceId, marketplace.id, { status: 'ready', commit, packageCount: total });
  log.push(`${added} added · ${changed} changed · ${removed} removed · ${total} available`);
  return { added, changed, commit, warnings };
}

export async function syncMarketplace(workspaceId: string, marketplaceId: string, actor: string): Promise<{
  marketplace: MarketplaceRecord; added: number; changed: number; removed: number; commit: string | null; warnings: string[]; log: string[];
}> {
  const marketplace = getMarketplace(workspaceId, marketplaceId);
  if (!marketplace) throw new MarketplaceError('MARKETPLACE_NOT_FOUND', 'Marketplace not found');
  if (marketplace.provider === 'builtin') {
    throw new MarketplaceError('BUILTIN_MARKETPLACE', 'The WORA official catalog is managed by the server and cannot be synchronized');
  }
  if (marketplace.status === 'disabled') throw new MarketplaceError('MARKETPLACE_DISABLED', 'Marketplace is disabled');
  const secret = marketplace.secretName ? revealSecret(workspaceId, marketplace.secretName) : null;
  if (marketplace.secretName && !secret) {
    setMarketplaceSyncResult(workspaceId, marketplaceId, { status: 'error', error: 'Configured credential is missing' });
    throw new MarketplaceError('SECRET_NOT_FOUND', 'The marketplace credential is missing; set it again before synchronizing');
  }
  const syncId = startSync(workspaceId, marketplaceId);
  try {
    const snapshot = await readSnapshot({ url: marketplace.url, ref: marketplace.ref, refType: marketplace.refType, path: marketplace.path, secret });
    const result = await applySnapshot(workspaceId, marketplace, snapshot.files, snapshot.commit, snapshot.log);
    const removed = Math.max(0, snapshot.files.length - result.added - result.changed);
    finishSync(workspaceId, syncId, { status: 'ok', commitSha: snapshot.commit, added: result.added, changed: result.changed, removed, log: snapshot.log });
    return {
      marketplace: getMarketplace(workspaceId, marketplaceId)!,
      added: result.added, changed: result.changed, removed, commit: snapshot.commit,
      warnings: result.warnings, log: snapshot.log,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronization failed';
    setMarketplaceSyncResult(workspaceId, marketplaceId, { status: 'error', error: message });
    finishSync(workspaceId, syncId, { status: 'error', error: message });
    if (error instanceof MarketplaceError) throw error;
    throw new MarketplaceError('SYNC_FAILED', message);
  }
}
