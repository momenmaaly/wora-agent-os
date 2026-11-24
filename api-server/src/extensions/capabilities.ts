/**
 * WORA extensions — agent capability profiles.
 *
 * An agent only receives capabilities that were explicitly installed, enabled,
 * approved and assigned to a scope it belongs to. Resolution is computed from
 * the database on every execution, so disabling a package or revoking a
 * permission takes effect on the next call — including for running missions.
 */
import { createHash } from 'node:crypto';
import { getAgent, type AgentRecord } from '../os/registry.js';
import { getTool, runTool, type ToolContext } from '../os/tools.js';
import {
  getAgentPolicy, getInstallation, getPackage, getVersion, listInstallations, listRegisteredTools,
  saveCapabilitySnapshot, extensionAudit, type InstallationRecord,
} from './store.js';
import { secretExists } from './secrets.js';
import { permissionSensitivity, type PluginManifest, type SkillManifest } from './manifest.js';

export interface ResolvedSkill {
  packageId: string;
  installationId: string;
  key: string;
  name: string;
  version: string;
  type: SkillManifest['type'];
  scope: string;
  scopeId: string;
  instructions: string;
  instructionDigest: string;
  permissions: string[];
  tools: string[];
  autoLoad: boolean;
}

export interface ResolvedPlugin {
  packageId: string;
  installationId: string;
  key: string;
  name: string;
  version: string;
  type: PluginManifest['type'];
  executionMode: string;
  scope: string;
  scopeId: string;
  tools: string[];
  permissions: string[];
  secretsReady: boolean;
  autoLoad: boolean;
}

export interface BlockedCapability {
  key: string;
  kind: 'skill' | 'plugin';
  installationId: string;
  reason: string;
}

export interface CapabilityProfile {
  workspaceId: string;
  agentId: string;
  agentName: string;
  agentStatus: AgentRecord['status'];
  active: boolean;
  specialization: string;
  role: string;
  model: AgentRecord['model'];
  limits: AgentRecord['limits'];
  permissions: string[];
  tools: string[];
  skills: ResolvedSkill[];
  plugins: ResolvedPlugin[];
  blocked: BlockedCapability[];
  conflicts: string[];
  autoLoad: { skills: string[]; plugins: string[] };
  installationIds: string[];
  digest: string;
  resolvedAt: string;
}

function instructionsDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function appliesToAgent(installation: InstallationRecord, agentId: string, policy: ReturnType<typeof getAgentPolicy>, actor?: string): boolean {
  switch (installation.scope) {
    case 'instance': return true;
    case 'agent': return installation.scopeId === agentId;
    case 'organization': return Boolean(policy.organizationId && installation.scopeId === policy.organizationId);
    case 'project': return policy.projectIds.includes(installation.scopeId);
    case 'user': return Boolean(actor && installation.scopeId === actor);
    default: return false;
  }
}

export function resolveCapabilities(workspaceId: string, agentId: string, options: { actor?: string } = {}): CapabilityProfile {
  const agent = getAgent(workspaceId, agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  const active = agent.status === 'active';
  const policy = getAgentPolicy(workspaceId, agentId);
  const deniedPermissions = new Set(policy.deniedPermissions);
  const basePermissions = [...new Set([...agent.permissions, ...policy.extraPermissions])]
    .filter((permission) => !deniedPermissions.has(permission));
  const basePermissionSet = new Set(basePermissions);
  const deniedTools = new Set(policy.deniedTools);
  const blocked: BlockedCapability[] = [];
  const conflicts: string[] = [];
  const skills: ResolvedSkill[] = [];
  const plugins: ResolvedPlugin[] = [];
  const installationIds: string[] = [];

  const installations = listInstallations(workspaceId)
    .filter((installation) => appliesToAgent(installation, agentId, policy, options.actor));

  for (const installation of installations) {
    const pkg = getPackage(workspaceId, installation.packageId);
    if (!pkg) continue;
    if (policy.deniedPackages.includes(pkg.key)) {
      blocked.push({ key: pkg.key, kind: pkg.kind, installationId: installation.id, reason: 'denied by agent policy' });
      continue;
    }
    if (pkg.status === 'revoked' || pkg.status === 'missing') {
      blocked.push({ key: pkg.key, kind: pkg.kind, installationId: installation.id, reason: `package is ${pkg.status}` });
      continue;
    }
    if (installation.status !== 'installed' || !installation.enabled) {
      blocked.push({ key: pkg.key, kind: pkg.kind, installationId: installation.id, reason: `installation is ${installation.status}${installation.enabled ? '' : ' (disabled)'}` });
      continue;
    }
    if (!installation.permissionsApproved) {
      blocked.push({ key: pkg.key, kind: pkg.kind, installationId: installation.id, reason: 'permissions were not approved' });
      continue;
    }
    const version = getVersion(workspaceId, pkg.id, installation.version);
    if (!version) {
      blocked.push({ key: pkg.key, kind: pkg.kind, installationId: installation.id, reason: `installed version ${installation.version} is unavailable` });
      continue;
    }
    if (pkg.kind === 'skill') {
      const manifest = version.manifest as SkillManifest;
      const required = [...new Set([...manifest.permissions, ...manifest.requirements.permissions])];
      const missing = required.filter((permission) => !basePermissionSet.has(permission));
      if (missing.length) {
        blocked.push({ key: pkg.key, kind: 'skill', installationId: installation.id, reason: `missing permission(s): ${missing.join(', ')}` });
        conflicts.push(`${pkg.key} needs ${missing.join(', ')}`);
        continue;
      }
      const instructions = version.instructions || manifest.instructions;
      skills.push({
        packageId: pkg.id, installationId: installation.id, key: pkg.key, name: manifest.name,
        version: installation.version, type: manifest.type, scope: installation.scope, scopeId: installation.scopeId,
        instructions, instructionDigest: instructionsDigest(instructions), permissions: required,
        tools: manifest.requirements.tools, autoLoad: installation.autoLoad && policy.autoLoad,
      });
      installationIds.push(installation.id);
      continue;
    }
    const manifest = version.manifest as PluginManifest;
    if (manifest.type === 'native' && pkg.trust !== 'official') {
      blocked.push({ key: pkg.key, kind: 'plugin', installationId: installation.id, reason: 'native adapters must ship with WORA' });
      continue;
    }
    const required = [...new Set([...manifest.permissions, ...manifest.tools.flatMap((tool) => tool.permissions)])];
    const missingPermissions = required.filter((permission) => !basePermissionSet.has(permission));
    if (missingPermissions.length) {
      blocked.push({ key: pkg.key, kind: 'plugin', installationId: installation.id, reason: `missing permission(s): ${missingPermissions.join(', ')}` });
      conflicts.push(`${pkg.key} needs ${missingPermissions.join(', ')}`);
      continue;
    }
    const secrets = [...new Set([...manifest.required_secrets, ...manifest.entrypoint.env])];
    const missingSecrets = secrets.filter((name) => !secretExists(workspaceId, name));
    const tools = listRegisteredTools(workspaceId, { activeOnly: true })
      .filter((tool) => tool.installationId === installation.id)
      .map((tool) => tool.toolId)
      .filter((toolId) => !deniedTools.has(toolId));
    if (missingSecrets.length) {
      blocked.push({ key: pkg.key, kind: 'plugin', installationId: installation.id, reason: `missing secret(s): ${missingSecrets.join(', ')}` });
      conflicts.push(`${pkg.key} is waiting for ${missingSecrets.join(', ')}`);
      continue;
    }
    if (!tools.length) {
      blocked.push({ key: pkg.key, kind: 'plugin', installationId: installation.id, reason: 'no tools are registered (run a health check)' });
      continue;
    }
    plugins.push({
      packageId: pkg.id, installationId: installation.id, key: pkg.key, name: manifest.name,
      version: installation.version, type: manifest.type,
      executionMode: manifest.type === 'mcp' ? `mcp-${manifest.entrypoint.transport}` : manifest.type,
      scope: installation.scope, scopeId: installation.scopeId, tools, permissions: required,
      secretsReady: true, autoLoad: installation.autoLoad && policy.autoLoad,
    });
    installationIds.push(installation.id);
  }

  const pluginTools = [...new Set(plugins.flatMap((plugin) => plugin.tools))];
  const tools = [...new Set([...agent.tools, ...pluginTools])].filter((toolId) => !deniedTools.has(toolId));
  const permissions = [...new Set([...basePermissions, ...skills.flatMap((skill) => skill.permissions), ...plugins.flatMap((plugin) => plugin.permissions)])]
    .filter((permission) => !deniedPermissions.has(permission));
  const profile: Omit<CapabilityProfile, 'digest'> = {
    workspaceId, agentId, agentName: agent.name, agentStatus: agent.status, active, specialization: agent.specialization, role: agent.role,
    model: agent.model, limits: agent.limits, permissions, tools, skills, plugins, blocked, conflicts,
    autoLoad: {
      skills: skills.filter((skill) => skill.autoLoad).map((skill) => `${skill.key}@${skill.version}`),
      plugins: plugins.filter((plugin) => plugin.autoLoad).map((plugin) => `${plugin.key}@${plugin.version}`),
    },
    installationIds,
    resolvedAt: new Date().toISOString(),
  };
  const digest = createHash('sha256').update(JSON.stringify({
    agentId, agentStatus: agent.status, active, permissions: [...permissions].sort(), tools: [...tools].sort(),
    skills: skills.map((skill) => `${skill.key}@${skill.version}:${skill.instructionDigest}`).sort(),
    plugins: plugins.map((plugin) => `${plugin.key}@${plugin.version}:${plugin.tools.join(',')}`).sort(),
    blocked: blocked.map((entry) => `${entry.key}:${entry.reason}`).sort(),
  })).digest('hex').slice(0, 32);
  return { ...profile, digest };
}

/** Resolve and persist the exact snapshot a mission/task ran with. */
export function resolveAndSnapshot(workspaceId: string, agentId: string, options: {
  missionId?: string | null; taskId?: string | null; actor?: string;
} = {}): CapabilityProfile {
  const profile = resolveCapabilities(workspaceId, agentId, { actor: options.actor });
  const stored = {
    agentId: profile.agentId,
    agentName: profile.agentName,
    agentStatus: profile.agentStatus,
    active: profile.active,
    specialization: profile.specialization,
    model: profile.model,
    limits: profile.limits,
    permissions: profile.permissions,
    tools: profile.tools,
    skills: profile.skills.map((skill) => ({
      key: skill.key, version: skill.version, type: skill.type, scope: skill.scope, scopeId: skill.scopeId,
      instructionDigest: skill.instructionDigest, permissions: skill.permissions, tools: skill.tools, autoLoad: skill.autoLoad,
    })),
    plugins: profile.plugins.map((plugin) => ({
      key: plugin.key, version: plugin.version, type: plugin.type, executionMode: plugin.executionMode,
      scope: plugin.scope, scopeId: plugin.scopeId, tools: plugin.tools, permissions: plugin.permissions, autoLoad: plugin.autoLoad,
    })),
    blocked: profile.blocked,
    conflicts: profile.conflicts,
    autoLoad: profile.autoLoad,
    digest: profile.digest,
    resolvedAt: profile.resolvedAt,
  };
  saveCapabilitySnapshot({
    workspaceId, missionId: options.missionId ?? null, taskId: options.taskId ?? null,
    agentId, digest: profile.digest, profile: stored,
  });
  return profile;
}

export function authorizeTool(workspaceId: string, profile: CapabilityProfile, toolId: string): { allowed: boolean; reason: string | null; pluginTool: boolean } {
  const definition = getTool(toolId, workspaceId);
  if (!definition) return { allowed: false, reason: `Unknown tool "${toolId}"`, pluginTool: false };
  const pluginTool = definition.source === 'plugin';
  if (!profile.tools.includes(toolId)) {
    return {
      allowed: false,
      reason: pluginTool
        ? `Tool "${toolId}" is not assigned to this agent`
        : `Tool "${toolId}" is not enabled for this agent`,
      pluginTool,
    };
  }
  if (pluginTool && !profile.plugins.some((plugin) => plugin.tools.includes(toolId))) {
    return { allowed: false, reason: `Tool "${toolId}" belongs to a plugin that is not active for this agent`, pluginTool };
  }
  const required = definition.permissions ?? [];
  const missing = required.filter((permission) => !profile.permissions.includes(permission));
  if (definition.permission && !profile.permissions.includes(definition.permission)) missing.push(definition.permission);
  if (missing.length) return { allowed: false, reason: `Missing permission(s): ${missing.join(', ')}`, pluginTool };
  return { allowed: true, reason: null, pluginTool };
}

/** Execute a tool through the resolved profile, re-checking authorization first. */
export async function executeForAgent(input: {
  workspaceId: string; agentId: string; toolId: string; toolInput: unknown;
  actor?: string; missionId?: string; taskId?: string;
}) {
  const agent = getAgent(input.workspaceId, input.agentId);
  if (!agent) {
    return { ok: false as const, tool: input.toolId, error: `Agent ${input.agentId} not found`, code: 'AGENT_NOT_FOUND', durationMs: 0 };
  }
  if (agent.status !== 'active') {
    extensionAudit(input.workspaceId, input.actor ?? agent.name, 'extension.capability.denied', input.toolId, {
      agentId: input.agentId, reason: `agent is ${agent.status}`, code: 'AGENT_INACTIVE',
    });
    return { ok: false as const, tool: input.toolId, error: `Agent ${input.agentId} is ${agent.status}`, code: 'AGENT_INACTIVE', durationMs: 0 };
  }
  const profile = resolveAndSnapshot(input.workspaceId, input.agentId, {
    missionId: input.missionId, taskId: input.taskId, actor: input.actor,
  });
  const definition = getTool(input.toolId, input.workspaceId);
  if (definition?.risk === 'high') {
    extensionAudit(input.workspaceId, input.actor ?? profile.agentName, 'extension.capability.denied', input.toolId, {
      agentId: input.agentId, reason: 'high-risk tool requires orchestrator approval', code: 'HIGH_RISK_APPROVAL_REQUIRED',
    });
    return { ok: false as const, tool: input.toolId, error: 'High-risk tools require an approved orchestrator task', code: 'HIGH_RISK_APPROVAL_REQUIRED', durationMs: 0, profile };
  }
  const decision = authorizeTool(input.workspaceId, profile, input.toolId);
  if (!decision.allowed) {
    extensionAudit(input.workspaceId, input.actor ?? profile.agentName, 'extension.capability.denied', input.toolId, {
      agentId: input.agentId, reason: decision.reason, digest: profile.digest,
    });
    return { ok: false as const, error: decision.reason, profile };
  }
  const ctx: ToolContext = {
    workspaceId: input.workspaceId,
    actor: profile.agentName,
    permissions: new Set(profile.permissions),
    toolAllowlist: new Set(profile.tools),
    missionId: input.missionId,
    taskId: input.taskId,
  };
  const result = await runTool(input.toolId, input.toolInput, ctx);
  return { ...result, profile };
}

/** Sensitive permissions requested by a package, for the approval UI. */
export function permissionReview(permissions: readonly string[]) {
  return permissions.map((name) => ({ name, sensitivity: permissionSensitivity(name) }));
}
