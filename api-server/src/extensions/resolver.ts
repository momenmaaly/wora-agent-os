/**
 * WORA extensions — dependency resolution and the installation lifecycle.
 *
 * Resolution is computed before anything is written, reports every problem it
 * finds, refuses cycles and version conflicts, and never replaces or downgrades
 * a published version silently. Installing an unapproved high-impact package
 * leaves it in `pending_approval` with no tools registered.
 */
import {
  compareSemver, parseSemver, permissionSensitivity, satisfies, validateManifest,
  type PackageKind, type PackageManifest, type PackageScope, type PluginManifest, type SkillManifest,
} from './manifest.js';
import {
  createInstallation, extensionAudit, findPackageByKey, getInstallation, getPackage, getVersion,
  listInstallations, listDependencies, listPackages, listVersions, removeInstallation, replaceDependencies,
  updateInstallation, type InstallationDependency, type InstallationRecord, type PackageRecord, type PackageVersionRecord,
} from './store.js';
import { secretExists } from './secrets.js';
import { getTool } from '../os/tools.js';

export interface PlanNode {
  packageId: string;
  kind: PackageKind;
  key: string;
  name: string;
  version: string;
  isRoot: boolean;
  manifest: PackageManifest;
  permissions: string[];
  secrets: string[];
  missingSecrets: string[];
  requiresApproval: boolean;
  existingInstallationId: string | null;
}

export interface InstallPlan {
  root: PlanNode;
  nodes: PlanNode[];
  missing: Array<{ key: string; constraint: string; requiredBy: string }>;
  conflicts: Array<{ key: string; detail: string }>;
  cycles: string[][];
  missingTools: Array<{ key: string; tool: string }>;
  missingSecrets: string[];
  permissions: Array<{ name: string; sensitivity: string }>;
  requiresApproval: boolean;
  warnings: string[];
  canInstall: boolean;
  scope: PackageScope;
  scopeId: string;
  version: string;
  downgrade: boolean;
}

export class ResolverError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = 'ResolverError';
  }
}

function permissionsOf(manifest: PackageManifest, kind: PackageKind): string[] {
  if (kind === 'skill') {
    const skill = manifest as SkillManifest;
    return [...new Set([...skill.permissions, ...skill.requirements.permissions])];
  }
  const plugin = manifest as PluginManifest;
  return [...new Set([...plugin.permissions, ...plugin.tools.flatMap((tool) => tool.permissions)])];
}

function secretsOf(manifest: PackageManifest, kind: PackageKind): string[] {
  if (kind === 'skill') return [...(manifest as SkillManifest).requirements.secrets];
  const plugin = manifest as PluginManifest;
  return [...new Set([...plugin.required_secrets, ...plugin.entrypoint.env])];
}

function requiredTools(manifest: PackageManifest, kind: PackageKind): string[] {
  if (kind === 'skill') return (manifest as SkillManifest).requirements.tools;
  return [];
}

function declaredToolIds(manifest: PackageManifest, kind: PackageKind): string[] {
  if (kind === 'skill') return [];
  return (manifest as PluginManifest).tools.map((tool) => `${manifest.id}.${tool.id}`);
}

function findDependency(workspaceId: string, key: string, preferred?: PackageKind): PackageRecord | null {
  const direct = preferred ? findPackageByKey(workspaceId, preferred, key) : null;
  return direct ?? findPackageByKey(workspaceId, 'skill', key) ?? findPackageByKey(workspaceId, 'plugin', key);
}

export function buildInstallPlan(input: {
  workspaceId: string;
  packageId: string;
  version?: string;
  scope: PackageScope;
  scopeId?: string;
  targetInstallationId?: string;
  allowDowngrade?: boolean;
}): InstallPlan {
  const pkg = getPackage(input.workspaceId, input.packageId);
  if (!pkg) throw new ResolverError('PACKAGE_NOT_FOUND', 'Package not found', 404);
  const version = input.version ?? pkg.latestVersion;
  const rootVersion = getVersion(input.workspaceId, pkg.id, version);
  if (!rootVersion) throw new ResolverError('VERSION_NOT_FOUND', `Version ${version} is not available for ${pkg.key}`, 404);
  const scopeId = input.scopeId ?? '';
  const warnings: string[] = [];
  if (input.scope === 'user') warnings.push('A user-scoped installation applies to a single user only.');
  const missing: InstallPlan['missing'] = [];
  const conflicts: InstallPlan['conflicts'] = [];
  const cycles: string[][] = [];
  const missingTools: InstallPlan['missingTools'] = [];
  const nodes = new Map<string, PlanNode>();
  const constraints = new Map<string, Array<{ constraint: string; requiredBy: string }>>();
  const stack: string[] = [];
  let downgrade = false;

  const rootManifest = rootVersion.manifest;
  if (!rootManifest.scope.includes(input.scope)) {
    conflicts.push({ key: pkg.key, detail: `Package does not support ${input.scope} scope (declared: ${rootManifest.scope.join(', ')})` });
  }

  function visit(key: string, versionConstraint: string | null, requiredBy: string, isRoot: boolean, preferred: PackageKind | undefined, depth: number): void {
    if (depth > 20) { conflicts.push({ key, detail: 'Dependency graph is deeper than 20 levels' }); return; }
    if (stack.includes(key)) { cycles.push([...stack.slice(stack.indexOf(key)), key]); return; }
    const dependency = findDependency(input.workspaceId, key, preferred);
    if (!dependency) {
      if (!isRoot) missing.push({ key, constraint: versionConstraint ?? '*', requiredBy });
      return;
    }
    const available = listVersions(input.workspaceId, dependency.id).filter((entry) => !entry.yanked);
    const matching = available.filter((entry) => !versionConstraint || satisfies(entry.version, versionConstraint));
    if (!matching.length) {
      if (!isRoot) missing.push({ key, constraint: versionConstraint ?? '*', requiredBy });
      else conflicts.push({ key, detail: `No published version satisfies ${versionConstraint ?? '*'}` });
      return;
    }
    matching.sort((a, b) => {
      const left = parseSemver(a.version); const right = parseSemver(b.version);
      return left && right ? compareSemver(right, left) : 0;
    });
    const chosen = matching[0]!;
    const current = constraints.get(key) ?? [];
    current.push({ constraint: versionConstraint ?? '*', requiredBy });
    constraints.set(key, current);
    const violated = current.find((entry) => !satisfies(chosen.version, entry.constraint));
    if (violated) {
      conflicts.push({ key, detail: `Resolved ${chosen.version}, but ${violated.requiredBy} requires ${violated.constraint}` });
      return;
    }
    const existing = nodes.get(key);
    if (existing) {
      if (existing.version !== chosen.version) {
        conflicts.push({ key, detail: `Requested ${existing.version} by another dependency and ${chosen.version} by ${requiredBy}` });
      }
      return;
    }
    const node: PlanNode = {
      packageId: dependency.id, kind: dependency.kind, key: dependency.key, name: dependency.name,
      version: chosen.version, isRoot, manifest: chosen.manifest,
      permissions: permissionsOf(chosen.manifest, dependency.kind),
      secrets: secretsOf(chosen.manifest, dependency.kind),
      missingSecrets: secretsOf(chosen.manifest, dependency.kind).filter((name) => !secretExists(input.workspaceId, name)),
      requiresApproval: permissionsOf(chosen.manifest, dependency.kind).some((permission) => {
        const sensitivity = permissionSensitivity(permission);
        return sensitivity === 'high' || sensitivity === 'unknown';
      }) || (dependency.kind === 'plugin' && (() => {
        const plugin = chosen.manifest as PluginManifest;
        return plugin.type === 'native' || (plugin.type === 'mcp' && plugin.entrypoint.transport === 'stdio');
      })()),
      existingInstallationId: null,
    };
    nodes.set(key, node);
    stack.push(key);
    for (const dep of chosen.manifest.dependencies) visit(dep.id, dep.version, key, false, undefined, depth + 1);
    stack.pop();
  }

  visit(pkg.key, `=${version}`, 'root', true, pkg.kind, 0);
  const rootNode = nodes.get(pkg.key);
  if (!rootNode) throw new ResolverError('RESOLUTION_FAILED', 'Could not resolve the root package version');

  // Existing installations: same scope is an update; a newer current version is a downgrade.
  const existing = listInstallations(input.workspaceId, { packageId: pkg.id }).find((row) => row.scope === input.scope && row.scopeId === scopeId);
  if (existing) {
    rootNode.existingInstallationId = existing.id;
    const current = parseSemver(existing.version);
    const target = parseSemver(version);
    if (current && target && compareSemver(target, current) < 0) {
      downgrade = true;
      if (!input.allowDowngrade) conflicts.push({ key: pkg.key, detail: `Version ${version} is older than the installed ${existing.version}; use rollback explicitly` });
    }
  }

  const allPermissions = [...new Set([...nodes.values()].flatMap((node) => node.permissions))]
    .map((name) => ({ name, sensitivity: permissionSensitivity(name) }));
  const declared = new Set([...nodes.values()].flatMap((node) => declaredToolIds(node.manifest, node.kind)));
  for (const node of nodes.values()) {
    for (const tool of requiredTools(node.manifest, node.kind)) {
      if (!getTool(tool, input.workspaceId) && !declared.has(tool)) missingTools.push({ key: node.key, tool });
    }
    const result = validateManifest(node.kind, node.manifest, 'community');
    warnings.push(...result.warnings.map((warning) => `${node.key}: ${warning}`));
  }
  const missingSecrets = [...new Set([...nodes.values()].flatMap((node) => node.missingSecrets))];
  const requiresApproval = [...nodes.values()].some((node) => node.requiresApproval);
  const canInstall = missing.length === 0 && conflicts.length === 0 && cycles.length === 0 && missingTools.length === 0;
  return {
    root: rootNode, nodes: [...nodes.values()], missing, conflicts, cycles, missingTools, missingSecrets,
    permissions: allPermissions, requiresApproval, warnings, canInstall, scope: input.scope, scopeId, version, downgrade,
  };
}

/** Persist an approved plan: dependencies first, then the root, then tool registration. */
export function applyInstallPlan(input: {
  workspaceId: string; plan: InstallPlan; actor: string; approvePermissions: boolean; autoLoad?: boolean;
}): InstallationRecord {
  const { plan, workspaceId, actor } = input;
  if (!plan.canInstall) throw new ResolverError('PLAN_INVALID', 'The installation plan has unresolved problems', 422);
  const approved = plan.requiresApproval ? input.approvePermissions : true;
  const deps: InstallationDependency[] = [];
  const created: string[] = [];
  try {
    for (const node of plan.nodes) {
      const existing = listInstallations(workspaceId, { packageId: node.packageId }).find((row) => row.scope === plan.scope && row.scopeId === plan.scopeId);
      const needsSecrets = node.kind === 'plugin' && node.missingSecrets.length > 0;
      const record = createInstallation({
        workspaceId,
        packageId: node.packageId,
        version: node.version,
        scope: plan.scope,
        scopeId: plan.scopeId,
        enabled: !node.isRoot ? false : approved && !needsSecrets,
        autoLoad: input.autoLoad ?? node.manifest.auto_load,
        status: approved ? 'installed' : 'pending_approval',
        permissionsApproved: approved,
        actor,
      });
      if (!existing) created.push(record.id);
      if (node.isRoot) {
        if (record.id !== existing?.id) {
          extensionAudit(workspaceId, actor, 'extension.install', record.id, {
            package: node.key, version: node.version, scope: plan.scope, scopeId: plan.scopeId,
            approved, requiresApproval: plan.requiresApproval, autoLoad: input.autoLoad ?? node.manifest.auto_load,
          });
        }
      }
      deps.push({
        depKey: node.key, constraint: `=${node.version}`, resolvedVersion: node.version, satisfied: true,
        detail: node.isRoot ? 'root package' : 'resolved dependency',
      });
    }
    const rootInstallation = listInstallations(workspaceId, { packageId: plan.root.packageId })
      .find((row) => row.scope === plan.scope && row.scopeId === plan.scopeId);
    if (!rootInstallation) throw new ResolverError('INSTALL_FAILED', 'Installation record was not created', 500);
    replaceDependencies(workspaceId, rootInstallation.id, deps);
    return rootInstallation;
  } catch (error) {
    // A failed multi-package install must not leave a dependency enabled or
    // visible as an active capability. Mark created rows removed and clear
    // their resources; existing installations are never touched.
    for (const id of created) {
      try { removeInstallation(workspaceId, id, 'install-rollback'); } catch { /* best-effort cleanup */ }
    }
    extensionAudit(workspaceId, actor, 'extension.install.rollback', plan.root.key, {
      scope: plan.scope, scopeId: plan.scopeId, cleaned: created.length,
      error: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
    });
    throw error;
  }
}

export function assertNoDependents(workspaceId: string, installation: InstallationRecord, packageKey: string): void {
  const others = listInstallations(workspaceId).filter((row) => row.id !== installation.id);
  const dependents = others.filter((row) => listDependencies(row.id).some((dep) => dep.depKey === packageKey && dep.satisfied));
  if (dependents.length) {
    const packageIds = new Map(listPackages(workspaceId).map((pkg) => [pkg.id, pkg.key]));
    const names = [...new Set(dependents.map((row) => packageIds.get(row.packageId) ?? row.packageId))];
    throw new ResolverError('DEPENDENTS_EXIST', `Uninstall ${names.join(', ')} first — it depends on this package`, 409);
  }
}

export function uninstallPackage(workspaceId: string, installationId: string, actor: string): boolean {
  const installation = getInstallation(workspaceId, installationId);
  if (!installation) throw new ResolverError('INSTALLATION_NOT_FOUND', 'Installation not found', 404);
  const pkg = getPackage(workspaceId, installation.packageId);
  if (!pkg) throw new ResolverError('PACKAGE_NOT_FOUND', 'Package not found', 404);
  assertNoDependents(workspaceId, installation, pkg.key);
  const removed = removeInstallation(workspaceId, installationId, actor);
  if (removed) {
    extensionAudit(workspaceId, actor, 'extension.uninstall', installationId, { package: pkg.key, version: installation.version });
  }
  return removed;
}

export function planToView(plan: InstallPlan) {
  return {
    root: { key: plan.root.key, name: plan.root.name, version: plan.root.version, kind: plan.root.kind },
    scope: plan.scope,
    scopeId: plan.scopeId,
    version: plan.version,
    nodes: plan.nodes.map((node) => ({
      key: node.key, name: node.name, kind: node.kind, version: node.version, isRoot: node.isRoot,
      permissions: node.permissions, secrets: node.secrets, missingSecrets: node.missingSecrets,
      requiresApproval: node.requiresApproval, existingInstallationId: node.existingInstallationId,
    })),
    missing: plan.missing,
    conflicts: plan.conflicts,
    cycles: plan.cycles,
    missingTools: plan.missingTools,
    missingSecrets: plan.missingSecrets,
    permissions: plan.permissions,
    requiresApproval: plan.requiresApproval,
    warnings: plan.warnings,
    canInstall: plan.canInstall,
    downgrade: plan.downgrade,
  };
}

/** The version an installation should move to (latest compatible, never older). */
export function nextVersion(workspaceId: string, installation: InstallationRecord): PackageVersionRecord | null {
  const pkg = getPackage(workspaceId, installation.packageId);
  if (!pkg) return null;
  const current = parseSemver(installation.version);
  const candidates = listVersions(workspaceId, pkg.id).filter((entry) => {
    if (entry.yanked) return false;
    const candidate = parseSemver(entry.version);
    return Boolean(candidate && (!current || compareSemver(candidate, current) > 0));
  });
  candidates.sort((a, b) => {
    const left = parseSemver(a.version); const right = parseSemver(b.version);
    return left && right ? compareSemver(right, left) : 0;
  });
  return candidates[0] ?? null;
}

export function markInstallationError(workspaceId: string, installationId: string, actor: string): void {
  updateInstallation(workspaceId, installationId, { status: 'error' }, actor);
}
