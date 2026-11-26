/**
 * WORA extensions — pure view helpers (unit-tested without a DOM).
 */
import type { CapabilityProfile, ExtensionPackage, InstallPlanView, Sensitivity, ScopeName } from './api.js';

export interface PackageFilters {
  query: string;
  kind: 'skill' | 'plugin';
  category: string;
  marketplace: string;
  scope: string;
  installed: boolean;
  enabled: boolean;
}

export function filterPackages(packages: ExtensionPackage[], filters: PackageFilters): ExtensionPackage[] {
  const query = filters.query.trim().toLowerCase();
  return packages.filter((pkg) => {
    if (pkg.kind !== filters.kind) return false;
    if (query) {
      const haystack = [pkg.key, pkg.name, pkg.description, pkg.author, pkg.tags.join(' '), pkg.capabilities.join(' ')].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filters.category && pkg.category !== filters.category) return false;
    if (filters.marketplace && pkg.marketplace?.id !== filters.marketplace) return false;
    if (filters.scope && !pkg.installations.some((installation) => installation.scope === filters.scope)) return false;
    if (filters.installed && !pkg.installed) return false;
    if (filters.enabled && !pkg.enabled) return false;
    return true;
  });
}

export function categoriesOf(packages: ExtensionPackage[], kind: 'skill' | 'plugin'): string[] {
  return [...new Set(packages.filter((pkg) => pkg.kind === kind).map((pkg) => pkg.category))].sort();
}

export function permissionTone(sensitivity: Sensitivity): 'low' | 'medium' | 'high' | 'unknown' {
  return sensitivity;
}

export function scopeKey(scope: ScopeName): string {
  return `ext.scope${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
}

export interface ProfileSummary {
  skills: number;
  plugins: number;
  tools: number;
  blocked: number;
  autoLoaded: number;
}

export function summarizeProfile(profile: CapabilityProfile | null): ProfileSummary {
  if (!profile) return { skills: 0, plugins: 0, tools: 0, blocked: 0, autoLoaded: 0 };
  return {
    skills: profile.skills.length,
    plugins: profile.plugins.length,
    tools: profile.tools.length,
    blocked: profile.blocked.length,
    autoLoaded: profile.autoLoad.skills.length + profile.autoLoad.plugins.length,
  };
}

export function planBlockers(plan: InstallPlanView | null): string[] {
  if (!plan) return [];
  const blockers: string[] = [];
  for (const missing of plan.missing) blockers.push(`missing:${missing.key}@${missing.constraint}`);
  for (const conflict of plan.conflicts) blockers.push(`conflict:${conflict.key}:${conflict.detail}`);
  for (const cycle of plan.cycles) blockers.push(`cycle:${cycle.join('>')}`);
  for (const tool of plan.missingTools) blockers.push(`tool:${tool.tool}`);
  for (const secret of plan.missingSecrets) blockers.push(`secret:${secret}`);
  return blockers;
}

export function parseToolInput(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: true, value: {} };
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'not-an-object' };
    return { ok: true, value };
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
}

export function skillTemplate(): string {
  return JSON.stringify({
    schema_version: '1.0',
    id: 'workspace.my-skill',
    name: 'My Skill',
    version: '1.0.0',
    type: 'knowledge',
    description: 'Describe the responsibility, scope and limits of this skill.',
    author: 'My organization',
    category: 'custom',
    tags: ['custom'],
    capabilities: ['custom-capability'],
    permissions: ['memory:read'],
    scope: ['instance', 'project', 'agent'],
    dependencies: [],
    auto_load: false,
    execution_policy: {},
    instructions: '# My Skill\n\n## Responsibility\nState what this skill owns.\n\n## Workflow\n1. First verifiable step.\n2. Second verifiable step.\n\n## Verification\nState how completion is proven.',
    requirements: { tools: [], permissions: ['memory:read'], secrets: [] },
    verification: ['Completion is proven by evidence, not by assertion'],
    failure_handling: 'Report the failing step and stop.',
    handoff: 'Hand the verified result to the requesting agent.',
  }, null, 2);
}

export function pluginTemplate(): string {
  return JSON.stringify({
    schema_version: '1.0',
    id: 'workspace.my-http-plugin',
    name: 'My HTTP Plugin',
    version: '1.0.0',
    type: 'http',
    description: 'Describe the external service this plugin integrates with.',
    author: 'My organization',
    category: 'custom',
    tags: ['custom'],
    capabilities: ['integration'],
    permissions: [],
    scope: ['instance', 'project', 'agent'],
    dependencies: [],
    auto_load: false,
    entrypoint: { transport: 'http', url: 'https://api.example.com', args: [], env: [] },
    required_secrets: ['MY_SERVICE_TOKEN'],
    configuration: {},
    tools: [{
      id: 'lookup',
      name: 'Lookup',
      description: 'Looks up a record from the external service.',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      permissions: [],
      timeout_ms: 15000,
      risk: 'medium',
      path: '/records/lookup',
      method: 'POST',
    }],
    health: { type: 'http', timeout_ms: 8000 },
    security: { risk_level: 'medium', network: true, data_access: ['external-service'] },
  }, null, 2);
}

export function displayScope(scope: string): string {
  return scope.replace(/_/gu, ' ');
}

export function isAdmin(role: string | undefined): boolean {
  return role === 'admin' || role === 'owner';
}

export function isMember(role: string | undefined): boolean {
  return role === 'admin' || role === 'owner' || role === 'member';
}
