/**
 * WORA extensions — typed client for /api/os/extensions.
 * Session handling is shared with the OS client; no secret ever reaches this layer.
 */
import { readSessionToken } from '../lib/session.js';

const BASE = (import.meta.env['VITE_OS_API'] as string | undefined)?.replace(/\/$/, '') ?? '';

export class ExtensionApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown = null) {
    super(message);
    this.name = 'ExtensionApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = readSessionToken() ?? '';
  const response = await fetch(`${BASE}/api/os/extensions${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(session ? { authorization: `Bearer ${session}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
      ? String((payload as { error: string }).error) : `Request failed (HTTP ${response.status})`;
    throw new ExtensionApiError(message, response.status, payload);
  }
  return payload as T;
}

export type Sensitivity = 'low' | 'medium' | 'high' | 'unknown';
export type TrustLevel = 'official' | 'verified' | 'community' | 'untrusted';
export type ScopeName = 'instance' | 'organization' | 'project' | 'agent' | 'user';

export interface ExtensionSummary {
  marketplaces: number; skills: number; plugins: number; installed: number; enabled: number;
  pendingApproval: number; tools: number; mcpServers: number; secrets: number; snapshots: number;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  builtinSkills: number; builtinMarketplace: string;
  scopes: ScopeName[]; skillTypes: string[]; pluginTypes: string[];
}

export interface PermissionInfo { name: string; sensitivity: Sensitivity }

export interface PackageVersionInfo {
  version: string; checksum: string; publishedAt: string; yanked: boolean; sourceSha: string;
}

export interface PackageInstallationInfo {
  id: string; scope: ScopeName; scopeId: string; version: string; enabled: boolean;
  status: string; permissionsApproved: boolean; autoLoad: boolean; installedAt: string;
  updateAvailable: string | null;
}

export interface PackageToolDeclaration {
  id: string; name: string; description: string; permissions: string[];
  timeout_ms: number; risk: 'low' | 'medium' | 'high'; path?: string; method?: string;
  input_schema: Record<string, unknown>;
}

export interface SecurityReview {
  trust: TrustLevel;
  permissions: Array<{ name: string; sensitivity: Sensitivity }>;
  requiresApproval: boolean;
  secrets: string[];
  lifecycleHooks: boolean;
  networkAccess: boolean;
  executesCode: boolean;
  executionModel: string;
  notes: string[];
}

export interface ExtensionPackage {
  id: string; kind: 'skill' | 'plugin'; key: string; name: string; latestVersion: string;
  category: string; tags: string[]; description: string; author: string; type: string;
  capabilities: string[]; scope: ScopeName[]; permissions: Array<{ name: string; sensitivity: Sensitivity }>;
  requiresApproval: boolean; executionModel: string; secrets: string[];
  compatibility: { wora?: string } | null;
  dependencies: Array<{ id: string; version: string }>;
  requirements: { tools?: string[]; permissions?: string[]; secrets?: string[]; wora?: string } | null;
  tools: PackageToolDeclaration[];
  trust: TrustLevel; status: 'available' | 'missing' | 'revoked'; checksum: string; autoLoad: boolean;
  marketplace: { id: string; name: string; trust: TrustLevel; url: string; pinned: boolean } | null;
  versions: PackageVersionInfo[];
  installations: PackageInstallationInfo[];
  installed: boolean; enabled: boolean;
  security: SecurityReview | null;
  warnings: string[];
}

export interface PlanNode {
  key: string; name: string; kind: 'skill' | 'plugin'; version: string; isRoot: boolean;
  permissions: string[]; secrets: string[]; missingSecrets: string[]; requiresApproval: boolean;
  existingInstallationId: string | null;
}

export interface InstallPlanView {
  root: { key: string; name: string; version: string; kind: 'skill' | 'plugin' };
  scope: ScopeName; scopeId: string; version: string;
  nodes: PlanNode[];
  missing: Array<{ key: string; constraint: string; requiredBy: string }>;
  conflicts: Array<{ key: string; detail: string }>;
  cycles: string[][];
  missingTools: Array<{ key: string; tool: string }>;
  missingSecrets: string[];
  permissions: Array<{ name: string; sensitivity: Sensitivity }>;
  requiresApproval: boolean;
  warnings: string[];
  canInstall: boolean;
  downgrade: boolean;
}

export interface Installation {
  id: string; workspaceId: string; packageId: string; version: string; scope: ScopeName; scopeId: string;
  enabled: boolean; autoLoad: boolean; status: string; permissionsApproved: boolean;
  approvedBy: string | null; approvedAt: string | null; installedBy: string; installedAt: string;
  updatedAt: string; removedAt: string | null;
  package: { id: string; key: string; name: string; kind: 'skill' | 'plugin'; status: string; latestVersion: string } | null;
  updateAvailable: string | null;
  tools: Array<{ toolId: string; name: string; health: string; status: string; risk: string; permissions: string[] }>;
  mcp: { id: string; transport: string; status: string; health: string; lastCheckAt: string | null; lastError: string; discoveredTools: number } | null;
}

export interface Marketplace {
  id: string; workspaceId: string; name: string; url: string; provider: 'git' | 'local' | 'builtin';
  ref: string; refType: 'branch' | 'tag' | 'commit'; path: string; scope: ScopeName; scopeId: string;
  autoLoad: boolean; trust: TrustLevel; secretName: string | null; secretConfigured: boolean;
  status: 'pending' | 'ready' | 'error' | 'disabled'; lastSyncAt: string | null; lastCommit: string | null;
  lastError: string; packageCount: number; pinned: boolean; readOnly: boolean;
  createdBy: string; createdAt: string; updatedAt: string;
  packages?: Array<{ id: string; kind: 'skill' | 'plugin'; key: string; name: string; version: string; status: string }>;
}

export interface MarketplaceSync {
  id: string; marketplaceId: string; status: 'running' | 'ok' | 'error'; startedAt: string;
  finishedAt: string | null; commitSha: string | null; added: number; changed: number; removed: number;
  error: string; log: string[];
}

export interface PluginToolRecord {
  id: string; workspaceId: string; installationId: string; packageId: string; pluginKey: string;
  toolKey: string; toolId: string; name: string; description: string;
  inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> | null;
  permissions: string[]; timeoutMs: number; risk: 'low' | 'medium' | 'high';
  executionMode: string; status: string; health: string; audit: boolean; active?: boolean;
}

export interface McpServer {
  id: string; workspaceId: string; installationId: string; name: string; transport: 'stdio' | 'http';
  command: string | null; args: string[]; url: string | null; envKeys: string[];
  status: string; health: string; lastCheckAt: string | null; lastError: string; discoveredTools: number;
  packageKey: string | null; packageName: string | null; enabled: boolean; installationStatus: string;
}

export interface AgentPolicy {
  agentId: string; organizationId: string | null; projectIds: string[];
  deniedPackages: string[]; deniedTools: string[]; deniedPermissions: string[]; extraPermissions: string[];
  autoLoad: boolean; updatedAt: string;
}

export interface CapabilityProfile {
  workspaceId: string; agentId: string; agentName: string; specialization: string; role: string;
  model: { provider?: string; model?: string }; limits: { maxTokens?: number; timeoutMs?: number };
  permissions: string[]; tools: string[];
  skills: Array<{ packageId: string; installationId: string; key: string; name: string; version: string; type: string; scope: string; scopeId: string; instructionDigest: string; permissions: string[]; tools: string[]; autoLoad: boolean }>;
  plugins: Array<{ packageId: string; installationId: string; key: string; name: string; version: string; type: string; executionMode: string; scope: string; scopeId: string; tools: string[]; permissions: string[]; secretsReady: boolean; autoLoad: boolean }>;
  blocked: Array<{ key: string; kind: string; installationId: string; reason: string }>;
  conflicts: string[];
  autoLoad: { skills: string[]; plugins: string[] };
  installationIds: string[];
  digest: string; resolvedAt: string;
}

export interface ValidationResponse {
  ok: boolean; kind: 'skill' | 'plugin'; errors: Array<{ path: string; message: string }>;
  warnings: string[]; security: SecurityReview | null; checksum: string | null;
  permissionReview: Array<{ name: string; sensitivity: Sensitivity }>;
}

export interface SecretMetadata { id: string; name: string; purpose: string; createdBy: string; createdAt: string; updatedAt: string }
export interface AuditEntry { id: string; actor: string; action: string; subject: string; detail: Record<string, unknown>; createdAt: string }
export interface CapabilitySnapshot { id: string; missionId: string | null; taskId: string | null; agentId: string; digest: string; profile: Record<string, unknown>; createdAt: string }

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const extensionsApi = {
  summary: () => request<ExtensionSummary>(''),
  permissions: () => request<{ permissions: PermissionInfo[]; note: string }>('/permissions'),
  packages: (query: Record<string, string> = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)));
    const suffix = params.toString();
    return request<ExtensionPackage[]>(`/packages${suffix ? `?${suffix}` : ''}`);
  },
  package: (id: string) => request<ExtensionPackage>(`/packages/${encodeURIComponent(id)}`),
  plan: (id: string, body: { scope: ScopeName; scopeId?: string; version?: string }) => request<InstallPlanView>(`/packages/${encodeURIComponent(id)}/plan`, json(body)),
  install: (id: string, body: { scope: ScopeName; scopeId?: string; version?: string; autoLoad?: boolean; approvePermissions?: boolean }) =>
    request<{ installation: Installation; plan: InstallPlanView; requiresApproval: boolean }>(`/packages/${encodeURIComponent(id)}/install`, json(body)),
  revoke: (id: string) => request<ExtensionPackage>(`/packages/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),

  installations: (query: Record<string, string> = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)));
    const suffix = params.toString();
    return request<Installation[]>(`/installations${suffix ? `?${suffix}` : ''}`);
  },
  installation: (id: string) => request<Installation>(`/installations/${encodeURIComponent(id)}`),
  approve: (id: string) => request<Installation>(`/installations/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  enable: (id: string) => request<{ installation: Installation; health: { ok: boolean; error?: string | null; tools?: Array<{ name: string }> } | null }>(`/installations/${encodeURIComponent(id)}/enable`, { method: 'POST' }),
  disable: (id: string) => request<Installation>(`/installations/${encodeURIComponent(id)}/disable`, { method: 'POST' }),
  update: (id: string, body: { version?: string; approvePermissions?: boolean; autoLoad?: boolean }) =>
    request<{ installation: Installation; plan: InstallPlanView }>(`/installations/${encodeURIComponent(id)}/update`, json(body)),
  rollback: (id: string, body: { version: string; approvePermissions?: boolean }) =>
    request<{ installation: Installation; plan: InstallPlanView }>(`/installations/${encodeURIComponent(id)}/rollback`, json(body)),
  uninstall: (id: string) => request<void>(`/installations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  health: (id: string) => request<{ ok: boolean; skipped?: boolean; error?: string | null; tools: Array<{ name: string }> }>(`/installations/${encodeURIComponent(id)}/health`, { method: 'POST' }),

  marketplaces: () => request<Marketplace[]>('/marketplaces'),
  marketplace: (id: string) => request<{ marketplace: Marketplace; syncs: MarketplaceSync[]; packages: ExtensionPackage[] }>(`/marketplaces/${encodeURIComponent(id)}`),
  previewMarketplace: (body: { url: string; ref?: string; refType?: string; path?: string; secretName?: string }) => request<{ packages: Array<{ kind: string; key: string; name: string; version: string; path: string; ok: boolean; errors: Array<{ path: string; message: string }> }>; commit: string | null; provider: string }>('/marketplaces/preview', json(body)),
  addMarketplace: (body: { name?: string; url: string; ref?: string; refType?: string; path?: string; scope?: ScopeName; scopeId?: string; autoLoad?: boolean; trust?: TrustLevel; credential?: string; secretName?: string }) =>
    request<{ marketplace: Marketplace; sync: { added: number; changed: number; commit: string | null; warnings: string[] } }>('/marketplaces', json(body)),
  updateMarketplace: (id: string, body: Record<string, unknown>) => request<Marketplace>(`/marketplaces/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeMarketplace: (id: string) => request<void>(`/marketplaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  syncMarketplace: (id: string) => request<{ added: number; changed: number; removed: number; commit: string | null; warnings: string[]; log: string[]; packages: ExtensionPackage[] }>(`/marketplaces/${encodeURIComponent(id)}/sync`, { method: 'POST' }),
  syncs: (id: string) => request<MarketplaceSync[]>(`/marketplaces/${encodeURIComponent(id)}/syncs`),

  tools: () => request<{ core: Array<{ id: string; name: string; description: string; risk: string }>; plugin: PluginToolRecord[]; registered: number }>('/tools'),
  mcp: () => request<McpServer[]>('/mcp'),
  mcpHealth: (id: string) => request<{ ok: boolean; error?: string | null; tools: Array<{ name: string }> }>(`/mcp/${encodeURIComponent(id)}/health`, { method: 'POST' }),

  validate: (kind: 'skill' | 'plugin', manifest: unknown) => request<ValidationResponse>('/validate', json({ kind, manifest })),
  createPackage: (kind: 'skill' | 'plugin', manifest: unknown) => request<ExtensionPackage>('/packages/create', json({ kind, manifest })),

  capabilities: (agentId: string) => request<{ profile: CapabilityProfile; policy: AgentPolicy }>(`/agents/${encodeURIComponent(agentId)}/capabilities`),
  setPolicy: (agentId: string, patch: Partial<Omit<AgentPolicy, 'agentId' | 'updatedAt'>>) =>
    request<{ policy: AgentPolicy; profile: CapabilityProfile }>(`/agents/${encodeURIComponent(agentId)}/policy`, { method: 'PUT', body: JSON.stringify(patch) }),
  resolve: (agentId: string, body: { missionId?: string; taskId?: string } = {}) =>
    request<CapabilityProfile>(`/agents/${encodeURIComponent(agentId)}/resolve`, json(body)),
  executeTool: (agentId: string, toolId: string, input: unknown) =>
    request<{ ok: boolean; output?: unknown; error?: string; durationMs: number; profile?: CapabilityProfile }>(`/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolId)}/execute`, json({ input })),

  secrets: () => request<SecretMetadata[]>('/secrets'),
  addSecret: (body: { name: string; value: string; purpose?: string }) => request<SecretMetadata>('/secrets', json(body)),
  deleteSecret: (name: string) => request<void>(`/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  audit: (limit = 50) => request<AuditEntry[]>(`/audit?limit=${limit}`),
  snapshots: (query: { missionId?: string; agentId?: string } = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)));
    const suffix = params.toString();
    return request<CapabilitySnapshot[]>(`/snapshots${suffix ? `?${suffix}` : ''}`);
  },
};
