/**
 * WORA extensions — plugin runtime.
 *
 * Turns approved installations into tool registrations and executes them.
 * Skills are never "run": their instructions are resolved into the agent's
 * capability profile. Plugins execute in their declared isolation model —
 * MCP child process, HTTP MCP, or an HTTP API — never inside the API process.
 */
import { validateManifest, type PluginManifest } from './manifest.js';
import {
  extensionAudit, getInstallation, getPackage, getRegisteredTool, getVersion, listInstallations,
  listRegisteredTools, replaceTools, setToolHealth, upsertMcpServer, getMcpServerForInstallation,
  setMcpHealth, type InstallationRecord, type RegisteredTool,
} from './store.js';
import { revealSecret } from './secrets.js';
import { callMcpTool, probeMcp, type McpOptions } from './mcp.js';
import { validateAgainstSchema } from './json-schema.js';
import { safeFetch } from '../lib/safe-fetch.js';
import type { PluginToolDefinition, ToolContext } from '../os/tools.js';
import { logger } from '../lib/logger.js';

const MAX_HTTP_BODY = 256 * 1024;
const MAX_HTTP_RESPONSE = 512 * 1024;

export class PluginRuntimeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PluginRuntimeError';
  }
}

function sanitizeToolKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'tool';
}

function manifestFor(workspaceId: string, installation: InstallationRecord): PluginManifest | null {
  const pkg = getPackage(workspaceId, installation.packageId);
  if (!pkg || pkg.kind !== 'plugin') return null;
  const version = getVersion(workspaceId, pkg.id, installation.version);
  if (!version) return null;
  const result = validateManifest('plugin', version.manifest);
  return result.ok ? result.manifest as PluginManifest : null;
}

function pluginEnv(workspaceId: string, manifest: PluginManifest): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of new Set([...manifest.required_secrets, ...manifest.entrypoint.env])) {
    const value = revealSecret(workspaceId, name);
    if (value !== null) env[name] = value;
  }
  return env;
}

function mcpOptions(
  workspaceId: string,
  manifest: PluginManifest,
  timeoutMs: number,
  trust: 'official' | 'verified' | 'community' | 'untrusted' = 'community',
  signal?: AbortSignal,
): McpOptions {
  const env = pluginEnv(workspaceId, manifest);
  if (manifest.entrypoint.transport === 'http') {
    const token = Object.values(env)[0];
    return {
      transport: 'http',
      url: manifest.entrypoint.url ?? null,
      env: token ? { MCP_HTTP_TOKEN: token } : {},
      timeoutMs,
      trust,
      signal,
    };
  }
  return {
    transport: 'stdio',
    command: manifest.entrypoint.command ?? null,
    args: manifest.entrypoint.args,
    env,
    timeoutMs,
    trust,
    signal,
  };
}

function toolExecutionMode(manifest: PluginManifest): RegisteredTool['executionMode'] | null {
  if (manifest.type === 'mcp' && manifest.entrypoint.transport === 'stdio') return 'mcp-stdio';
  if (manifest.type === 'mcp') return 'mcp-http';
  if (manifest.type === 'http') return 'http-api';
  return null;
}

/**
 * Reconcile the tool/MCP rows of one installation with its approved state.
 * Disabled, unapproved or revoked installations expose no tools at all.
 */
export function syncInstallationResources(workspaceId: string, installationId: string): { tools: number; mcp: boolean } {
  const installation = getInstallation(workspaceId, installationId);
  if (!installation || installation.status === 'removed') return { tools: 0, mcp: false };
  const pkg = getPackage(workspaceId, installation.packageId);
  if (!pkg) return { tools: 0, mcp: false };
  if (pkg.kind === 'skill') return { tools: 0, mcp: false };
  const manifest = manifestFor(workspaceId, installation);
  if (!manifest) {
    replaceTools(workspaceId, installationId, pkg.key, pkg.id, []);
    return { tools: 0, mcp: false };
  }
  const mode = toolExecutionMode(manifest);
  const active = installation.status === 'installed' && installation.enabled
    && installation.permissionsApproved && pkg.status !== 'revoked' && mode !== null;
  if (!active || !mode) {
    // Keep existing registrations so a revoked capability is reported as an
    // explicit denial rather than an unknown tool. executePluginTool refuses
    // to run anything while the installation is disabled or unapproved.
    const existing = listRegisteredTools(workspaceId).filter((tool) => tool.installationId === installationId).length;
    return { tools: existing, mcp: false };
  }
  const tools = manifest.tools.map((tool) => ({
    toolId: `${pkg.key}.${tool.id}`,
    toolKey: tool.id,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
    outputSchema: tool.output_schema,
    permissions: [...new Set([...manifest.permissions, ...tool.permissions])],
    timeoutMs: tool.timeout_ms,
    risk: tool.risk,
    executionMode: mode,
  }));
  replaceTools(workspaceId, installationId, pkg.key, pkg.id, tools);
  let mcp = false;
  if (manifest.type === 'mcp') {
    upsertMcpServer(workspaceId, {
      installationId,
      name: manifest.name,
      transport: manifest.entrypoint.transport,
      command: manifest.entrypoint.command ?? null,
      args: manifest.entrypoint.args,
      url: manifest.entrypoint.url ?? null,
      envKeys: [...new Set([...manifest.required_secrets, ...manifest.entrypoint.env])],
    });
    mcp = true;
  }
  return { tools: tools.length, mcp };
}

/** Health probe (and optional tool discovery) for an MCP-backed plugin. */
export async function checkInstallationHealth(workspaceId: string, installationId: string, actor: string, discover = true) {
  const installation = getInstallation(workspaceId, installationId);
  if (!installation) throw new PluginRuntimeError('INSTALLATION_NOT_FOUND', 'Installation not found');
  const pkg = getPackage(workspaceId, installation.packageId);
  if (!pkg || pkg.kind !== 'plugin') throw new PluginRuntimeError('NOT_A_PLUGIN', 'Installation is not a plugin');
  if (
    installation.status !== 'installed' || !installation.enabled || !installation.permissionsApproved
    || pkg.status === 'revoked' || pkg.status === 'missing'
  ) {
    throw new PluginRuntimeError('INSTALLATION_NOT_ACTIVE', 'Health checks require an installed, enabled, approved and non-revoked plugin');
  }
  const manifest = manifestFor(workspaceId, installation);
  if (!manifest) throw new PluginRuntimeError('MANIFEST_INVALID', 'Stored manifest no longer validates');
  if (manifest.type !== 'mcp') {
    return { ok: true, skipped: true, reason: 'HTTP integrations are checked when a tool is called', tools: [], latencyMs: 0, error: null };
  }
  const server = getMcpServerForInstallation(workspaceId, installationId);
  const probe = await probeMcp(mcpOptions(workspaceId, manifest, manifest.health.timeout_ms, pkg.trust));
  if (server) {
    setMcpHealth(workspaceId, server.id, {
      status: probe.ok ? 'ready' : 'error', health: probe.ok ? 'healthy' : 'error',
      error: probe.error ?? '', discoveredTools: probe.tools.length,
    });
  }
  if (probe.ok && discover && installation.enabled && installation.permissionsApproved && manifest.tools.length === 0) {
    const mode = toolExecutionMode(manifest);
    if (mode) {
      replaceTools(workspaceId, installationId, pkg.key, pkg.id, probe.tools.map((tool) => ({
        toolId: `${pkg.key}.${sanitizeToolKey(tool.name)}`,
        toolKey: tool.name,
        name: tool.name,
        description: tool.description || `${manifest.name} — ${tool.name}`,
        inputSchema: tool.inputSchema,
        permissions: manifest.permissions,
        timeoutMs: 20_000,
        risk: 'medium',
        executionMode: mode,
      })));
    }
  }
  for (const tool of listRegisteredTools(workspaceId).filter((entry) => entry.installationId === installationId)) {
    setToolHealth(workspaceId, tool.toolId, probe.ok ? 'healthy' : 'error');
  }
  extensionAudit(workspaceId, actor, 'extension.mcp.health', installationId, {
    plugin: pkg.key, ok: probe.ok, latencyMs: probe.latencyMs, tools: probe.tools.length,
  });
  return { ...probe, skipped: false };
}

/** Rebuild registrations for every installation (boot, sync, permission changes). */
export function refreshAllInstallations(workspaceId: string): void {
  for (const installation of listInstallations(workspaceId)) {
    try { syncInstallationResources(workspaceId, installation.id); }
    catch (error) { logger.warn({ err: error, installationId: installation.id }, 'extension resource refresh failed'); }
  }
}

export function pluginToolDefinitions(workspaceId: string): PluginToolDefinition[] {
  const installations = new Map(listInstallations(workspaceId).map((row) => [row.id, row]));
  return listRegisteredTools(workspaceId, { activeOnly: true }).flatMap((tool) => {
    // Registered even when disabled so the orchestrator can report an explicit
    // capability denial instead of an unknown tool. executePluginTool still
    // refuses to run unless the installation is enabled and approved.
    const installation = installations.get(tool.installationId);
    if (!installation || installation.status === 'removed' || !installation.permissionsApproved) return [];
    return [{
      id: tool.toolId,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      permissions: tool.permissions,
      risk: tool.risk,
      timeoutMs: tool.timeoutMs,
      pluginId: tool.pluginKey,
    }];
  });
}

async function callHttpTool(workspaceId: string, manifest: PluginManifest, tool: RegisteredTool, input: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const base = manifest.entrypoint.url;
  if (!base) throw new PluginRuntimeError('PLUGIN_NO_URL', 'HTTP integration has no base URL');
  const declaration = manifest.tools.find((entry) => entry.id === tool.toolKey);
  if (!declaration?.path) throw new PluginRuntimeError('PLUGIN_NO_PATH', `Tool ${tool.toolKey} has no declared path`);
  const baseUrl = new URL(base);
  const target = new URL(declaration.path, baseUrl);
  if (target.origin !== baseUrl.origin) throw new PluginRuntimeError('PLUGIN_ORIGIN_DENIED', 'Tool path must stay on the plugin origin');
  const method = declaration.method ?? 'POST';
  const headers: Record<string, string> = { accept: 'application/json, text/plain' };
  const secretName = [...new Set([...manifest.required_secrets, ...manifest.entrypoint.env])][0];
  const token = secretName ? revealSecret(workspaceId, secretName) : null;
  if (token) headers['authorization'] = `Bearer ${token}`;
  let body: string | undefined;
  if (method === 'GET' || method === 'DELETE') {
    if (input && typeof input === 'object') {
      for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 40)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') target.searchParams.set(key, String(value));
      }
    }
  } else {
    headers['content-type'] = 'application/json';
    const serialized = JSON.stringify(input ?? {});
    if (serialized.length > MAX_HTTP_BODY) throw new PluginRuntimeError('PLUGIN_INPUT_TOO_LARGE', 'Tool input exceeds the plugin limit');
    body = serialized;
  }
  const response = await safeFetch(target.toString(), {
    method,
    headers,
    body,
    timeoutMs,
    maxBytes: MAX_HTTP_RESPONSE,
    allowRedirects: false,
    allowedPorts: new Set(['', baseUrl.port, baseUrl.port || (baseUrl.protocol === 'https:' ? '443' : '80')]),
    signal,
  });
  const text = response.body.toString('utf8');
  if (response.status < 200 || response.status >= 300) throw new PluginRuntimeError('PLUGIN_HTTP_ERROR', `Plugin responded with HTTP ${response.status}`);
  const contentType = response.contentType;
  if (contentType.includes('application/json')) {
    try { return JSON.parse(text) as unknown; } catch { return { raw: text }; }
  }
  return { raw: text, contentType };
}

/** Execute a registered plugin tool. Called through runTool (which already enforced permissions). */
export async function executePluginTool(workspaceId: string, toolId: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  const tool = getRegisteredTool(workspaceId, toolId);
  if (!tool || tool.status !== 'active') throw new PluginRuntimeError('TOOL_NOT_FOUND', `Unknown plugin tool ${toolId}`);
  const installation = getInstallation(workspaceId, tool.installationId);
  if (!installation || installation.status !== 'installed' || !installation.enabled || !installation.permissionsApproved) {
    extensionAudit(workspaceId, ctx.actor, 'extension.tool.denied', toolId, { reason: 'installation-not-active' });
    throw new PluginRuntimeError('TOOL_REVOKED', `Plugin tool ${toolId} is not active`);
  }
  const pkg = getPackage(workspaceId, tool.packageId);
  if (!pkg || pkg.status === 'revoked') {
    extensionAudit(workspaceId, ctx.actor, 'extension.tool.denied', toolId, { reason: 'package-revoked' });
    throw new PluginRuntimeError('TOOL_REVOKED', `Package ${pkg?.key ?? ''} has been revoked`);
  }
  const missing = tool.permissions.filter((permission) => !ctx.permissions.has(permission) && !ctx.permissions.has('*'));
  if (missing.length) {
    extensionAudit(workspaceId, ctx.actor, 'extension.tool.denied', toolId, { reason: 'permissions', missing });
    throw new PluginRuntimeError('TOOL_FORBIDDEN', `Missing permission(s): ${missing.join(', ')}`);
  }
  const inputIssues = validateAgainstSchema(tool.inputSchema, input ?? {});
  if (inputIssues.length) {
    extensionAudit(workspaceId, ctx.actor, 'extension.tool.denied', toolId, { reason: 'input-schema', issues: inputIssues.slice(0, 6) });
    throw new PluginRuntimeError('TOOL_INPUT_INVALID', `Invalid input for ${toolId}: ${inputIssues.slice(0, 6).join('; ')}`);
  }
  const manifest = manifestFor(workspaceId, installation);
  if (!manifest) throw new PluginRuntimeError('MANIFEST_INVALID', 'Stored plugin manifest no longer validates');
  const timeoutMs = Math.min(tool.timeoutMs, 120_000);
  const started = Date.now();
  try {
    let output: unknown;
    if (tool.executionMode === 'http-api') {
      output = await callHttpTool(workspaceId, manifest, tool, input, timeoutMs, ctx.signal);
    } else {
      const result = await callMcpTool(mcpOptions(workspaceId, manifest, timeoutMs, pkg.trust, ctx.signal), tool.toolKey, input);
      const envelope = result as { isError?: unknown; content?: unknown } | null;
      if (envelope?.isError === true) {
        const message = Array.isArray(envelope.content)
          ? envelope.content.map((part) => (part as { text?: unknown }).text).filter((text): text is string => typeof text === 'string').join(' ').slice(0, 500)
          : 'MCP tool reported an error';
        throw new PluginRuntimeError('MCP_TOOL_ERROR', message || 'MCP tool reported an error');
      }
      output = result;
    }
    setToolHealth(workspaceId, toolId, 'healthy');
    extensionAudit(workspaceId, ctx.actor, 'extension.tool.execute', toolId, {
      plugin: pkg.key, version: installation.version, ok: true, durationMs: Date.now() - started,
      missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null,
    });
    return output;
  } catch (error) {
    setToolHealth(workspaceId, toolId, 'error');
    extensionAudit(workspaceId, ctx.actor, 'extension.tool.execute', toolId, {
      plugin: pkg.key, version: installation.version, ok: false, durationMs: Date.now() - started,
      error: (error instanceof Error ? error.message : 'tool failed').slice(0, 300),
      missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null,
    });
    throw error;
  }
}

/** Human-readable health of a plugin installation, without starting anything. */
export function installationHealth(workspaceId: string, installationId: string) {
  const installation = getInstallation(workspaceId, installationId);
  if (!installation) return null;
  const server = getMcpServerForInstallation(workspaceId, installationId);
  const tools = listRegisteredTools(workspaceId).filter((tool) => tool.installationId === installationId);
  return {
    installation,
    mcp: server ? { id: server.id, transport: server.transport, status: server.status, health: server.health, lastCheckAt: server.lastCheckAt, lastError: server.lastError, discoveredTools: server.discoveredTools } : null,
    tools: tools.map((tool) => ({ toolId: tool.toolId, name: tool.name, health: tool.health, status: tool.status, executionMode: tool.executionMode })),
  };
}
