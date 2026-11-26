/**
 * WORA extensions — REST surface (/api/os/extensions).
 *
 * Mounted inside the OS router, so workspace resolution, session auth, RBAC and
 * rate limiting are inherited. Reads are open to viewers; installs and agent
 * capability changes require member; marketplace credentials, permission
 * approvals, revocations and secret writes require admin. Every mutation is
 * authorized here, server-side, and audited.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { roleRank, type WorkspaceRole } from '../os/roles.js';
import { getAgent } from '../os/registry.js';
import { listTools as listCoreTools } from '../os/tools.js';
import {
  PERMISSION_CATALOG, PLUGIN_TYPES, SCOPES, SKILL_TYPES, TRUST_LEVELS, permissionSensitivity, validateManifest,
  type PackageKind, type PackageManifest,
} from './manifest.js';
import {
  createMarketplace, deleteMarketplace, extensionSummary, findPackageByKey, getInstallation, getMcpServer,
  getMcpServerForInstallation, getPackage, listCapabilitySnapshots, listExtensionAudit,
  listInstallations, listMarketplaces, listMcpServers, listPackages, listRegisteredTools, listSyncs, listVersions,
  setAgentPolicy, getAgentPolicy, setPackageStatus, updateInstallation, updateMarketplace, getMarketplace,
  upsertPackage, extensionAudit, listSkillContexts,
  type InstallationRecord, type PackageRecord,
} from './store.js';
import { MarketplaceError, normalizePath, normalizeRef, previewMarketplace, registerMarketplace, syncMarketplace } from './marketplace.js';
import {
  ResolverError, applyInstallPlan, buildInstallPlan, nextVersion, planToView, uninstallPackage,
} from './resolver.js';
import {
  PluginRuntimeError, checkInstallationHealth, installationHealth, pluginToolDefinitions,
  refreshAllInstallations, syncInstallationResources,
} from './runtime.js';
import {
  authorizeTool, executeForAgent, resolveAndSnapshot, resolveCapabilities,
} from './capabilities.js';
import { deleteSecret, listSecrets, migrateLegacySecrets, putSecret, rotateSecrets, secretKeyStatus } from './secrets.js';
import { builtinSkillCount, BUILTIN_MARKETPLACE_URL } from './builtin.js';
import { matchCapabilities } from './capability-intelligence.js';
import { logger } from '../lib/logger.js';

const SCOPES_SCHEMA = z.enum(SCOPES);
const KIND_SCHEMA = z.enum(['skill', 'plugin']);
const permissionName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.:-]{1,60}$/u);
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{3,80}$/u);
const agentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u);

const marketplaceSchema = z.strictObject({
  name: z.string().trim().max(120).optional(),
  url: z.string().trim().min(1).max(500),
  ref: z.string().trim().max(200).optional(),
  refType: z.enum(['branch', 'tag', 'commit']).optional(),
  path: z.string().trim().max(200).optional(),
  scope: SCOPES_SCHEMA.optional(),
  scopeId: z.string().trim().max(120).optional(),
  autoLoad: z.boolean().optional(),
  trust: z.enum(TRUST_LEVELS).optional(),
  secretName: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u).optional(),
  credential: z.string().min(1).max(4_000).optional(),
});

const installSchema = z.strictObject({
  scope: SCOPES_SCHEMA,
  scopeId: z.string().trim().max(120).optional(),
  version: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/u).optional(),
  autoLoad: z.boolean().optional(),
  approvePermissions: z.boolean().optional(),
});

const policySchema = z.strictObject({
  organizationId: z.string().trim().max(120).nullable().optional(),
  projectIds: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  deniedPackages: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  deniedTools: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  deniedPermissions: z.array(permissionName).max(100).optional(),
  extraPermissions: z.array(permissionName).max(100).optional(),
  autoLoad: z.boolean().optional(),
}).strict();

const validateSchema = z.strictObject({
  kind: KIND_SCHEMA,
  manifest: z.record(z.string(), z.unknown()),
});

const executeSchema = z.strictObject({ input: z.unknown().optional() });

const secretSchema = z.strictObject({
  name: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  value: z.string().min(1).max(8_000),
  purpose: z.string().trim().max(60).optional(),
});

const updateSchema = z.strictObject({
  version: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/u).optional(),
  approvePermissions: z.boolean().optional(),
  autoLoad: z.boolean().optional(),
});

const rollbackSchema = z.strictObject({
  version: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/u),
  approvePermissions: z.boolean().optional(),
});

const param = (req: Request, name: string): string => {
  const value = (req.params as Record<string, unknown>)[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return String(value[0] ?? '');
  return '';
};

const buckets = new Map<string, { count: number; resetAt: number }>();
function allowRequest(workspaceId: string, limit = 90): boolean {
  const now = Date.now();
  const bucket = buckets.get(workspaceId);
  if (!bucket || bucket.resetAt < now) { buckets.set(workspaceId, { count: 1, resetAt: now + 60_000 }); return true; }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

const asyncWrap = (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };

function packageView(workspaceId: string, pkg: PackageRecord) {
  const marketplace = getMarketplace(workspaceId, pkg.marketplaceId);
  const installations = listInstallations(workspaceId, { packageId: pkg.id });
  const versions = listVersions(workspaceId, pkg.id);
  const review = validateManifest(pkg.kind, pkg.manifest, pkg.trust);
  const manifest = pkg.manifest as unknown as Record<string, unknown>;
  const latestInstallation = installations[0] ?? null;
  return {
    id: pkg.id,
    kind: pkg.kind,
    key: pkg.key,
    name: pkg.name,
    latestVersion: pkg.latestVersion,
    category: pkg.category,
    tags: pkg.tags,
    description: typeof manifest['description'] === 'string' ? manifest['description'] : '',
    author: typeof manifest['author'] === 'string' ? manifest['author'] : '',
    type: typeof manifest['type'] === 'string' ? manifest['type'] : '',
    capabilities: Array.isArray(manifest['capabilities']) ? manifest['capabilities'] : [],
    scope: Array.isArray(manifest['scope']) ? manifest['scope'] : [],
    permissions: review.security?.permissions ?? [],
    requiresApproval: review.security?.requiresApproval ?? false,
    executionModel: review.security?.executionModel ?? 'instructions-only',
    secrets: review.security?.secrets ?? [],
    compatibility: typeof manifest['compatibility'] === 'object' && manifest['compatibility'] ? manifest['compatibility'] : null,
    dependencies: Array.isArray(manifest['dependencies']) ? manifest['dependencies'] : [],
    requirements: typeof manifest['requirements'] === 'object' && manifest['requirements'] ? manifest['requirements'] : null,
    tools: pkg.kind === 'plugin' && Array.isArray(manifest['tools']) ? manifest['tools'] : [],
    trust: pkg.trust,
    status: pkg.status,
    checksum: pkg.checksum,
    autoLoad: Boolean(manifest['auto_load']),
    marketplace: marketplace ? { id: marketplace.id, name: marketplace.name, trust: marketplace.trust, url: marketplace.url, pinned: marketplace.refType !== 'branch' } : null,
    versions: versions.map((version) => ({ version: version.version, checksum: version.checksum, publishedAt: version.publishedAt, yanked: version.yanked, sourceSha: version.sourceSha })),
    installations: installations.map((installation) => ({
      id: installation.id, scope: installation.scope, scopeId: installation.scopeId, version: installation.version,
      enabled: installation.enabled, status: installation.status, permissionsApproved: installation.permissionsApproved,
      autoLoad: installation.autoLoad, installedAt: installation.installedAt, updateAvailable: nextVersion(workspaceId, installation)?.version ?? null,
    })),
    installed: installations.length > 0,
    enabled: installations.some((installation) => installation.enabled),
    latestInstallation,
    security: review.security,
    warnings: review.warnings,
  };
}

function installationView(workspaceId: string, installation: InstallationRecord) {
  const pkg = getPackage(workspaceId, installation.packageId);
  const tools = listRegisteredTools(workspaceId).filter((tool) => tool.installationId === installation.id);
  const server = getMcpServerForInstallation(workspaceId, installation.id);
  return {
    ...installation,
    package: pkg ? { id: pkg.id, key: pkg.key, name: pkg.name, kind: pkg.kind, status: pkg.status, latestVersion: pkg.latestVersion } : null,
    updateAvailable: nextVersion(workspaceId, installation)?.version ?? null,
    tools: tools.map((tool) => ({ toolId: tool.toolId, name: tool.name, health: tool.health, status: tool.status, risk: tool.risk, permissions: tool.permissions })),
    mcp: server ? { id: server.id, transport: server.transport, status: server.status, health: server.health, lastCheckAt: server.lastCheckAt, lastError: server.lastError, discoveredTools: server.discoveredTools } : null,
  };
}

export function createExtensionsRouter(): Router {
  const router = Router();

  const workspace = (res: Response) => res.locals['workspaceId'] as string;
  const actor = (res: Response) => (res.locals['actor'] as string) ?? 'user';
  const role = (res: Response) => (res.locals['role'] as WorkspaceRole) ?? 'viewer';

  function denied(res: Response, minimum: 'member' | 'admin'): boolean {
    if (roleRank(role(res)) >= roleRank(minimum)) return false;
    res.status(403).json({ error: minimum === 'admin' ? 'يتطلب دور المشرف — Admin role required' : 'يتطلب دور العضو — Member role required', code: 'ROLE_REQUIRED' });
    return true;
  }

  function isAdmin(res: Response): boolean {
    return roleRank(role(res)) >= roleRank('admin');
  }

  function mutationAllowed(res: Response, limit = 90): boolean {
    if (!allowRequest(workspace(res), limit)) {
      res.status(429).json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' });
      return false;
    }
    return true;
  }

  function workspaceCatalog(ws: string, who: string) {
    const url = `workspace://${ws}/custom`;
    return listMarketplaces(ws).find((row) => row.url === url)
      ?? createMarketplace({ workspaceId: ws, name: 'Workspace packages', url, provider: 'builtin', ref: 'local', refType: 'tag', trust: 'community', actor: who });
  }

  /* ─── Capability intelligence & skill provenance ─── */
  const capabilityMatchSchema = z.strictObject({
    objective: z.string().trim().min(3).max(4_000),
    agentId: agentIdSchema.optional(),
    requiredCapabilities: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  });

  router.post('/capabilities/match', asyncWrap((req, res) => {
    if (!mutationAllowed(res, 60)) return;
    const body = capabilityMatchSchema.parse(req.body ?? {});
    const match = matchCapabilities({ workspaceId: workspace(res), objective: body.objective, agentId: body.agentId, requiredCapabilities: body.requiredCapabilities });
    extensionAudit(workspace(res), actor(res), 'extension.capability.match', body.agentId ?? 'auto', {
      objective: body.objective.slice(0, 300), selected: match.selected?.tool ?? null,
      kind: match.selected?.kind ?? null, gap: match.gap?.missing ?? null, score: match.selected?.score ?? null,
    });
    res.json(match);
  }));

  router.get('/skill-contexts', asyncWrap((req, res) => {
    const query = z.object({
      missionId: z.string().trim().max(80).optional(),
      taskId: z.string().trim().max(80).optional(),
      agentId: agentIdSchema.optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }).parse(req.query ?? {});
    res.json(listSkillContexts(workspace(res), query));
  }));

  /* ─── Summary & catalogs ─── */
  router.get('/', asyncWrap((_req, res) => {
    res.json({
      ...extensionSummary(workspace(res)),
      role: role(res),
      builtinSkills: builtinSkillCount(),
      builtinMarketplace: BUILTIN_MARKETPLACE_URL,
      scopes: SCOPES,
      skillTypes: SKILL_TYPES,
      pluginTypes: PLUGIN_TYPES,
    });
  }));

  router.get('/permissions', asyncWrap((_req, res) => {
    res.json({
      permissions: Object.entries(PERMISSION_CATALOG).map(([name, sensitivity]) => ({ name, sensitivity })),
      note: 'Permissions outside this catalog are reported as unknown and require explicit approval.',
    });
  }));

  /* ─── Marketplaces ─── */
  router.get('/marketplaces', asyncWrap((_req, res) => {
    const ws = workspace(res);
    res.json(listMarketplaces(ws).map((marketplace) => ({
      ...marketplace,
      secretConfigured: Boolean(marketplace.secretName),
      pinned: marketplace.refType !== 'branch',
      readOnly: marketplace.provider === 'builtin',
      packages: listPackages(ws, { marketplaceId: marketplace.id }).map((pkg) => ({
        id: pkg.id, kind: pkg.kind, key: pkg.key, name: pkg.name, version: pkg.latestVersion, status: pkg.status,
      })),
    })));
  }));

  router.post('/marketplaces/preview', asyncWrap(async (req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res)) return;
    const body = marketplaceSchema.parse(req.body ?? {});
    if (body.trust === 'official') { res.status(403).json({ error: 'Official trust is reserved for the bundled WORA catalog', code: 'TRUST_DENIED' }); return; }
    const preview = await previewMarketplace({
      workspaceId: workspace(res), name: body.name ?? body.url, url: body.url, ref: body.ref,
      refType: body.refType, path: body.path, trust: body.trust, secretName: body.secretName, actor: actor(res),
    });
    res.json(preview);
  }));

  router.post('/marketplaces', asyncWrap(async (req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res, 20)) return;
    const body = marketplaceSchema.parse(req.body ?? {});
    if (body.trust === 'official') { res.status(403).json({ error: 'Official trust is reserved for the bundled WORA catalog', code: 'TRUST_DENIED' }); return; }
    let secretName = body.secretName ?? null;
    if (body.credential) {
      const name = `MARKETPLACE_${Buffer.from(body.url).toString('base64url').replace(/[^A-Z0-9]/giu, '').toUpperCase().slice(0, 24) || 'CREDENTIAL'}`;
      putSecret({ workspaceId: workspace(res), name, value: body.credential, purpose: 'marketplace', actor: actor(res) });
      secretName = name;
    }
    const result = await registerMarketplace({
      workspaceId: workspace(res), name: body.name ?? body.url, url: body.url, ref: body.ref,
      refType: body.refType, path: body.path, scope: body.scope, scopeId: body.scopeId,
      autoLoad: body.autoLoad, trust: body.trust, secretName, actor: actor(res),
    });
    refreshAllInstallations(workspace(res));
    res.status(201).json({
      marketplace: { ...result.marketplace, secretConfigured: Boolean(result.marketplace.secretName), pinned: result.marketplace.refType !== 'branch' },
      sync: result.sync,
    });
  }));

  router.get('/marketplaces/:id', asyncWrap((req, res) => {
    const ws = workspace(res);
    const marketplace = getMarketplace(ws, param(req, 'id'));
    if (!marketplace) { res.status(404).json({ error: 'Marketplace not found' }); return; }
    res.json({
      marketplace: { ...marketplace, secretConfigured: Boolean(marketplace.secretName), pinned: marketplace.refType !== 'branch', readOnly: marketplace.provider === 'builtin' },
      syncs: listSyncs(ws, marketplace.id),
      packages: listPackages(ws, { marketplaceId: marketplace.id }).map((pkg) => packageView(ws, pkg)),
    });
  }));

  router.patch('/marketplaces/:id', asyncWrap((req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res)) return;
    const ws = workspace(res);
    const marketplace = getMarketplace(ws, param(req, 'id'));
    if (!marketplace) { res.status(404).json({ error: 'Marketplace not found' }); return; }
    if (marketplace.provider === 'builtin') { res.status(409).json({ error: 'The official catalog is read-only' }); return; }
    const body = marketplaceSchema.partial().parse(req.body ?? {});
    if (body.trust === 'official') { res.status(403).json({ error: 'Official trust is reserved for the bundled WORA catalog', code: 'TRUST_DENIED' }); return; }
    const refType = body.refType ?? marketplace.refType;
    const ref = body.ref !== undefined ? normalizeRef(body.ref, refType) : body.refType ? normalizeRef(marketplace.ref, refType) : undefined;
    const path = body.path !== undefined ? normalizePath(body.path) : undefined;
    const updated = updateMarketplace(ws, marketplace.id, {
      name: body.name, ref, refType: body.refType, path, scope: body.scope,
      scopeId: body.scopeId, autoLoad: body.autoLoad, trust: body.trust,
      status: body.autoLoad === false ? marketplace.status : undefined,
    }, actor(res));
    res.json(updated);
  }));

  router.delete('/marketplaces/:id', asyncWrap((req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res)) return;
    const ws = workspace(res);
    const marketplace = getMarketplace(ws, param(req, 'id'));
    if (!marketplace) { res.status(404).json({ error: 'Marketplace not found' }); return; }
    if (marketplace.provider === 'builtin') { res.status(409).json({ error: 'The official catalog cannot be removed' }); return; }
    res.status(deleteMarketplace(ws, marketplace.id, actor(res)) ? 204 : 404).end();
  }));

  router.post('/marketplaces/:id/sync', asyncWrap(async (req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res, 20)) return;
    const result = await syncMarketplace(workspace(res), param(req, 'id'), actor(res));
    refreshAllInstallations(workspace(res));
    res.json({ ...result, packages: listPackages(workspace(res), { marketplaceId: result.marketplace.id }).map((pkg) => packageView(workspace(res), pkg)) });
  }));

  router.get('/marketplaces/:id/syncs', asyncWrap((req, res) => {
    res.json(listSyncs(workspace(res), param(req, 'id')));
  }));

  /* ─── Packages ─── */
  router.get('/packages', asyncWrap((req, res) => {
    const ws = workspace(res);
    const kind = typeof req.query['kind'] === 'string' && (req.query['kind'] === 'skill' || req.query['kind'] === 'plugin') ? req.query['kind'] as PackageKind : undefined;
    const query = typeof req.query['q'] === 'string' ? req.query['q'].trim().toLowerCase().slice(0, 120) : '';
    const category = typeof req.query['category'] === 'string' ? req.query['category'].slice(0, 60) : '';
    const marketplaceId = typeof req.query['marketplace'] === 'string' ? req.query['marketplace'].slice(0, 80) : '';
    const installedFilter = req.query['installed'] === 'true' ? true : req.query['installed'] === 'false' ? false : null;
    const enabledFilter = req.query['enabled'] === 'true' ? true : req.query['enabled'] === 'false' ? false : null;
    const scopeFilter = typeof req.query['scope'] === 'string' ? req.query['scope'] : '';
    const views = listPackages(ws, { kind, marketplaceId: marketplaceId || undefined }).map((pkg) => packageView(ws, pkg));
    const filtered = views.filter((view) => {
      if (query && ![view.key, view.name, view.description, view.tags.join(' ')].join(' ').toLowerCase().includes(query)) return false;
      if (category && view.category !== category) return false;
      if (installedFilter !== null && view.installed !== installedFilter) return false;
      if (enabledFilter !== null && view.enabled !== enabledFilter) return false;
      if (scopeFilter && !view.installations.some((installation) => installation.scope === scopeFilter)) return false;
      return true;
    });
    res.json(filtered);
  }));

  router.get('/packages/:id', asyncWrap((req, res) => {
    const ws = workspace(res);
    const pkg = getPackage(ws, param(req, 'id'));
    if (!pkg) { res.status(404).json({ error: 'Package not found' }); return; }
    res.json(packageView(ws, pkg));
  }));

  router.post('/packages/:id/plan', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    const body = installSchema.parse(req.body ?? {});
    const plan = buildInstallPlan({
      workspaceId: workspace(res), packageId: param(req, 'id'), version: body.version,
      scope: body.scope, scopeId: body.scopeId ?? '',
    });
    res.json(planToView(plan));
  }));

  router.post('/packages/:id/install', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 40)) return;
    const ws = workspace(res);
    const body = installSchema.parse(req.body ?? {});
    const pkg = getPackage(ws, param(req, 'id'));
    if (!pkg) { res.status(404).json({ error: 'Package not found' }); return; }
    if (pkg.status === 'revoked') { res.status(409).json({ error: 'This package has been revoked', code: 'PACKAGE_REVOKED' }); return; }
    const plan = buildInstallPlan({ workspaceId: ws, packageId: pkg.id, version: body.version, scope: body.scope, scopeId: body.scopeId ?? '' });
    if (!plan.canInstall) { res.status(422).json({ error: 'Installation plan has unresolved problems', plan: planToView(plan) }); return; }
    if (plan.requiresApproval && !isAdmin(res)) {
      res.status(403).json({ error: 'High-risk plugin installation requires an admin', code: 'HIGH_RISK_PLUGIN_REQUIRES_ADMIN', plan: planToView(plan) });
      return;
    }
    const installation = applyInstallPlan({
      workspaceId: ws, plan, actor: actor(res), approvePermissions: body.approvePermissions ?? false, autoLoad: body.autoLoad,
    });
    syncInstallationResources(ws, installation.id);
    res.status(201).json({
      installation: installationView(ws, getInstallation(ws, installation.id)!),
      plan: planToView(plan),
      requiresApproval: plan.requiresApproval && !(body.approvePermissions ?? false),
    });
  }));

  router.post('/packages/:id/revoke', asyncWrap((req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res, 20)) return;
    const ws = workspace(res);
    const pkg = getPackage(ws, param(req, 'id'));
    if (!pkg) { res.status(404).json({ error: 'Package not found' }); return; }
    setPackageStatus(ws, pkg.id, 'revoked');
    for (const installation of listInstallations(ws, { packageId: pkg.id })) {
      updateInstallation(ws, installation.id, { enabled: false, status: 'disabled' }, actor(res));
      syncInstallationResources(ws, installation.id);
    }
    refreshAllInstallations(ws);
    res.json(packageView(ws, getPackage(ws, pkg.id)!));
  }));

  /* ─── Installations ─── */
  router.get('/installations', asyncWrap((req, res) => {
    const ws = workspace(res);
    const packageId = typeof req.query['packageId'] === 'string' ? req.query['packageId'] : undefined;
    res.json(listInstallations(ws, { packageId }).map((installation) => installationView(ws, installation)));
  }));

  router.get('/installations/:id', asyncWrap((req, res) => {
    const ws = workspace(res);
    const installation = getInstallation(ws, param(req, 'id'));
    if (!installation) { res.status(404).json({ error: 'Installation not found' }); return; }
    res.json({ ...installationView(ws, installation), health: installationHealth(ws, installation.id) });
  }));

  router.post('/installations/:id/approve', asyncWrap((req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res, 30)) return;
    const ws = workspace(res);
    const installation = getInstallation(ws, param(req, 'id'));
    if (!installation) { res.status(404).json({ error: 'Installation not found' }); return; }
    const updated = updateInstallation(ws, installation.id, {
      permissionsApproved: true, approvedBy: actor(res), approvedAt: new Date().toISOString(),
      status: 'installed', enabled: false,
    }, actor(res));
    syncInstallationResources(ws, installation.id);
    res.json(installationView(ws, updated!));
  }));

  router.post('/installations/:id/enable', asyncWrap(async (req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 40)) return;
    const ws = workspace(res);
    const installation = getInstallation(ws, param(req, 'id'));
    if (!installation) { res.status(404).json({ error: 'Installation not found' }); return; }
    if (!installation.permissionsApproved) { res.status(409).json({ error: 'Permissions must be approved before enabling', code: 'APPROVAL_REQUIRED' }); return; }
    const pkg = getPackage(ws, installation.packageId);
    if (!pkg || pkg.status === 'revoked' || pkg.status === 'missing') { res.status(409).json({ error: 'Package is revoked or missing', code: 'PACKAGE_REVOKED' }); return; }
    const plan = buildInstallPlan({ workspaceId: ws, packageId: pkg.id, version: installation.version, scope: installation.scope, scopeId: installation.scopeId });
    if (!plan.canInstall) { res.status(409).json({ error: 'Dependencies are no longer satisfiable', plan: planToView(plan) }); return; }
    if (plan.requiresApproval && !isAdmin(res)) {
      res.status(403).json({ error: 'Enabling a high-risk plugin requires an admin', code: 'HIGH_RISK_PLUGIN_REQUIRES_ADMIN', plan: planToView(plan) });
      return;
    }
    if (plan.missingSecrets.length) {
      res.status(409).json({ error: `Missing secret(s): ${plan.missingSecrets.join(', ')}`, code: 'SECRETS_REQUIRED', secrets: plan.missingSecrets });
      return;
    }
    const updated = updateInstallation(ws, installation.id, { enabled: true, status: 'installed' }, actor(res));
    syncInstallationResources(ws, installation.id);
    const health = pkg.kind === 'plugin' ? await checkInstallationHealth(ws, installation.id, actor(res), true) : null;
    res.json({ ...installationView(ws, updated!), health });
  }));

  router.post('/installations/:id/disable', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 60)) return;
    const ws = workspace(res);
    const installation = getInstallation(ws, param(req, 'id'));
    if (!installation) { res.status(404).json({ error: 'Installation not found' }); return; }
    const updated = updateInstallation(ws, installation.id, { enabled: false, status: 'disabled' }, actor(res));
    syncInstallationResources(ws, installation.id);
    res.json(installationView(ws, updated!));
  }));

  router.post('/installations/:id/update', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 40)) return;
    const ws = workspace(res);
    const body = updateSchema.parse(req.body ?? {});
    const installation = getInstallation(ws, param(req, 'id'));
    if (!installation) { res.status(404).json({ error: 'Installation not found' }); return; }
    const pkg = getPackage(ws, installation.packageId);
    if (!pkg) { res.status(404).json({ error: 'Package not found' }); return; }
    const target = body.version ?? nextVersion(ws, installation)?.version;
    if (!target) { res.status(409).json({ error: 'No newer version is available', code: 'NO_UPDATE' }); return; }
    const plan = buildInstallPlan({ workspaceId: ws, packageId: pkg.id, version: target, scope: installation.scope, scopeId: installation.scopeId, targetInstallationId: installation.id });
    if (!plan.canInstall) { res.status(422).json({ error: 'Update plan has unresolved problems', plan: planToView(plan) }); return; }
    if (plan.requiresApproval && !isAdmin(res)) {
      res.status(403).json({ error: 'Updating to a high-risk plugin version requires an admin', code: 'HIGH_RISK_PLUGIN_REQUIRES_ADMIN', plan: planToView(plan) });
      return;
    }
    if (plan.requiresApproval && !body.approvePermissions) {
      res.status(409).json({ error: 'The new version requests sensitive permissions and needs approval', code: 'APPROVAL_REQUIRED', plan: planToView(plan) });
      return;
    }
    const updated = updateInstallation(ws, installation.id, {
      version: target, autoLoad: body.autoLoad, permissionsApproved: plan.requiresApproval ? true : installation.permissionsApproved,
      ...(plan.requiresApproval ? { approvedBy: actor(res), approvedAt: new Date().toISOString() } : {}),
    }, actor(res));
    syncInstallationResources(ws, installation.id);
    res.json({ installation: installationView(ws, updated!), plan: planToView(plan) });
  }));

  router.post('/installations/:id/rollback', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 30)) return;
    const ws = workspace(res);
    const body = rollbackSchema.parse(req.body ?? {});
    const installation = getInstallation(ws, param(req, 'id'));
    if (!installation) { res.status(404).json({ error: 'Installation not found' }); return; }
    const plan = buildInstallPlan({
      workspaceId: ws, packageId: installation.packageId, version: body.version,
      scope: installation.scope, scopeId: installation.scopeId, targetInstallationId: installation.id, allowDowngrade: true,
    });
    if (!plan.canInstall) { res.status(422).json({ error: 'Rollback plan has unresolved problems', plan: planToView(plan) }); return; }
    if (plan.requiresApproval && !isAdmin(res)) {
      res.status(403).json({ error: 'Rolling back to a high-risk plugin version requires an admin', code: 'HIGH_RISK_PLUGIN_REQUIRES_ADMIN', plan: planToView(plan) });
      return;
    }
    if (plan.requiresApproval && !body.approvePermissions) {
      res.status(409).json({ error: 'The target version requests sensitive permissions and needs approval', code: 'APPROVAL_REQUIRED', plan: planToView(plan) });
      return;
    }
    const updated = updateInstallation(ws, installation.id, { version: body.version }, actor(res));
    syncInstallationResources(ws, installation.id);
    res.json({ installation: installationView(ws, updated!), plan: planToView(plan) });
  }));

  router.delete('/installations/:id', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 30)) return;
    const ws = workspace(res);
    res.status(uninstallPackage(ws, param(req, 'id'), actor(res)) ? 204 : 404).end();
  }));

  router.post('/installations/:id/health', asyncWrap(async (req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 30)) return;
    const ws = workspace(res);
    const installation = getInstallation(ws, param(req, 'id'));
    if (!installation) { res.status(404).json({ error: 'Installation not found' }); return; }
    res.json(await checkInstallationHealth(ws, installation.id, actor(res), true));
  }));

  /* ─── Agent capabilities ─── */
  router.get('/agents/:agentId/capabilities', asyncWrap((req, res) => {
    const ws = workspace(res);
    const agentId = agentIdSchema.parse(param(req, 'agentId'));
    if (!getAgent(ws, agentId)) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json({ profile: resolveCapabilities(ws, agentId, { actor: actor(res) }), policy: getAgentPolicy(ws, agentId) });
  }));

  router.put('/agents/:agentId/policy', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 40)) return;
    const ws = workspace(res);
    const agentId = agentIdSchema.parse(param(req, 'agentId'));
    if (!getAgent(ws, agentId)) { res.status(404).json({ error: 'Agent not found' }); return; }
    const body = policySchema.parse(req.body ?? {});
    if (body.extraPermissions?.length && denied(res, 'admin')) return;
    const policy = setAgentPolicy(ws, agentId, body, actor(res));
    res.json({ policy, profile: resolveCapabilities(ws, agentId, { actor: actor(res) }) });
  }));

  router.post('/agents/:agentId/resolve', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 60)) return;
    const ws = workspace(res);
    const agentId = agentIdSchema.parse(param(req, 'agentId'));
    if (!getAgent(ws, agentId)) { res.status(404).json({ error: 'Agent not found' }); return; }
    const body = z.strictObject({ missionId: z.string().max(80).optional(), taskId: z.string().max(80).optional() }).parse(req.body ?? {});
    res.json(resolveAndSnapshot(ws, agentId, { missionId: body.missionId, taskId: body.taskId, actor: actor(res) }));
  }));

  router.post('/agents/:agentId/tools/:toolId/execute', asyncWrap(async (req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 40)) return;
    const ws = workspace(res);
    const agentId = agentIdSchema.parse(param(req, 'agentId'));
    if (!getAgent(ws, agentId)) { res.status(404).json({ error: 'Agent not found' }); return; }
    const toolId = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,80}$/u).parse(param(req, 'toolId'));
    const body = executeSchema.parse(req.body ?? {});
    const profile = resolveCapabilities(ws, agentId, { actor: actor(res) });
    const decision = authorizeTool(ws, profile, toolId);
    if (!decision.allowed) {
      res.status(403).json({ error: decision.reason ?? 'Tool is not authorized for this agent', code: 'TOOL_FORBIDDEN', digest: profile.digest });
      return;
    }
    const result = await executeForAgent({ workspaceId: ws, agentId, toolId, toolInput: body.input ?? {}, actor: actor(res) });
    const deniedByPolicy = result.code === 'AGENT_INACTIVE' || result.code === 'HIGH_RISK_APPROVAL_REQUIRED' || result.code === 'AGENT_NOT_FOUND';
    res.status(result.ok ? 200 : deniedByPolicy ? 403 : 422).json(result);
  }));

  /* ─── Tools & MCP diagnostics ─── */
  router.get('/tools', asyncWrap((_req, res) => {
    const ws = workspace(res);
    const core = listCoreTools().filter((tool) => (tool as { source?: string }).source !== 'plugin');
    res.json({
      core,
      plugin: listRegisteredTools(ws).map((tool) => {
        const installation = getInstallation(ws, tool.installationId);
        return {
          ...tool,
          active: Boolean(installation && installation.enabled && installation.status === 'installed' && installation.permissionsApproved),
        };
      }),
      registered: pluginToolDefinitions(ws).length,
    });
  }));

  router.get('/mcp', asyncWrap((_req, res) => {
    const ws = workspace(res);
    res.json(listMcpServers(ws).map((server) => {
      const installation = getInstallation(ws, server.installationId);
      const pkg = installation ? getPackage(ws, installation.packageId) : null;
      return {
        ...server, packageKey: pkg?.key ?? null, packageName: pkg?.name ?? null,
        enabled: installation?.enabled ?? false, installationStatus: installation?.status ?? 'unknown',
      };
    }));
  }));

  router.post('/mcp/:id/health', asyncWrap(async (req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 30)) return;
    const ws = workspace(res);
    const server = getMcpServer(ws, param(req, 'id'));
    if (!server) { res.status(404).json({ error: 'MCP server not found' }); return; }
    res.json(await checkInstallationHealth(ws, server.installationId, actor(res), true));
  }));

  /* ─── Validation, creation, secrets, audit ─── */
  router.post('/validate', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    const body = validateSchema.parse(req.body ?? {});
    const result = validateManifest(body.kind, body.manifest, 'community');
    res.json({
      ...result,
      permissionReview: (result.security?.permissions ?? []).map((permission) => ({ ...permission, sensitivity: permissionSensitivity(permission.name) })),
    });
  }));

  router.post('/packages/create', asyncWrap((req, res) => {
    if (denied(res, 'member')) return;
    if (!mutationAllowed(res, 20)) return;
    const ws = workspace(res);
    const body = z.strictObject({
      kind: KIND_SCHEMA,
      manifest: z.record(z.string(), z.unknown()),
      publish: z.boolean().optional(),
    }).parse(req.body ?? {});
    if (body.publish) {
      res.status(501).json({ error: 'Publishing to a remote marketplace is not implemented in this deployment', code: 'PUBLISH_UNSUPPORTED' });
      return;
    }
    const result = validateManifest(body.kind, body.manifest, 'community');
    if (!result.ok || !result.manifest) { res.status(422).json({ error: 'Manifest validation failed', errors: result.errors, warnings: result.warnings }); return; }
    if (findPackageByKey(ws, body.kind, result.manifest.id)) {
      res.status(409).json({ error: 'A package with this id already exists in this workspace', code: 'PACKAGE_EXISTS' });
      return;
    }
    const catalog = workspaceCatalog(ws, actor(res));
    const instructions = body.kind === 'skill' ? String((result.manifest as { instructions?: unknown }).instructions ?? '') : '';
    const upserted = upsertPackage({
      workspaceId: ws, marketplaceId: catalog.id, kind: body.kind, manifest: result.manifest as PackageManifest,
      instructions, sourcePath: `workspace/${body.kind}/${result.manifest.id}`, sourceSha: 'workspace', trust: 'community',
    });
    if (upserted.conflict) { res.status(409).json({ error: 'This version already exists with different content', code: 'VERSION_CONFLICT' }); return; }
    extensionAudit(ws, actor(res), 'extension.package.create', upserted.packageId, { kind: body.kind, key: result.manifest.id });
    res.status(201).json(packageView(ws, getPackage(ws, upserted.packageId)!));
  }));

  router.get('/secrets', asyncWrap((_req, res) => {
    if (denied(res, 'admin')) return;
    res.json(listSecrets(workspace(res)).map((secret) => ({ ...secret, value: undefined })));
  }));

  router.post('/secrets', asyncWrap((req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res, 20)) return;
    const body = secretSchema.parse(req.body ?? {});
    const secret = putSecret({ workspaceId: workspace(res), name: body.name, value: body.value, purpose: body.purpose, actor: actor(res) });
    res.status(201).json(secret);
  }));

  router.get('/secrets/key-status', asyncWrap((_req, res) => {
    if (denied(res, 'admin')) return;
    res.json(secretKeyStatus());
  }));

  router.post('/secrets/rotate', asyncWrap((req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res, 20)) return;
    const body = z.strictObject({
      toKeyId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/u).optional(),
      dryRun: z.boolean().optional(),
      migrateLegacy: z.boolean().optional(),
    }).parse(req.body ?? {});
    const result = body.migrateLegacy
      ? migrateLegacySecrets({ workspaceId: workspace(res), actor: actor(res), dryRun: body.dryRun })
      : rotateSecrets({ workspaceId: workspace(res), toKeyId: body.toKeyId, actor: actor(res), dryRun: body.dryRun });
    res.json(result);
  }));

  router.delete('/secrets/:name', asyncWrap((req, res) => {
    if (denied(res, 'admin')) return;
    if (!mutationAllowed(res, 20)) return;
    const name = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u).parse(param(req, 'name'));
    res.status(deleteSecret(workspace(res), name, actor(res)) ? 204 : 404).end();
  }));

  router.get('/audit', asyncWrap((req, res) => {
    const limit = Math.min(Math.max(Number(req.query['limit'] ?? 50) || 50, 1), 200);
    res.json(listExtensionAudit(workspace(res), limit));
  }));

  router.get('/snapshots', asyncWrap((req, res) => {
    const missionId = typeof req.query['missionId'] === 'string' ? req.query['missionId'].slice(0, 80) : undefined;
    const agentId = typeof req.query['agentId'] === 'string' ? req.query['agentId'].slice(0, 80) : undefined;
    res.json(listCapabilitySnapshots(workspace(res), { missionId, agentId }));
  }));

  router.get('/agents', asyncWrap((req, res) => {
    const ws = workspace(res);
    const agentId = typeof req.query['agentId'] === 'string' ? req.query['agentId'] : '';
    if (!agentId) { res.json({ agents: [] }); return; }
    res.json({ agentId, policy: getAgentPolicy(ws, agentId), profile: resolveCapabilities(ws, agentId, { actor: actor(res) }) });
  }));

  /* ─── Errors ─── */
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Validation failed', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
      return;
    }
    if (error instanceof ResolverError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    if (error instanceof MarketplaceError) { res.status(error.code === 'NO_PACKAGES' ? 422 : 400).json({ error: error.message, code: error.code }); return; }
    if (error instanceof PluginRuntimeError) {
      const status = error.code === 'INSTALLATION_NOT_ACTIVE' ? 409 : 422;
      res.status(status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof Error && /not found/iu.test(error.message)) { res.status(404).json({ error: error.message }); return; }
    logger.error({ err: error }, 'extensions router error');
    res.status(500).json({ error: 'Internal extensions error' });
  });

  return router;
}
