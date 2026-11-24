/**
 * WORA extensions — versioned manifest standard (schema_version 1.0).
 *
 * Manifests are inert data: they are parsed, validated, bounded and stored.
 * Nothing in this module executes a package. Unknown fields are rejected so a
 * repository cannot smuggle behaviour through undeclared keys.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const SCHEMA_VERSION = '1.0' as const;
/** WORA API version this build implements; compared against manifest compatibility ranges. */
export const WORA_VERSION = '4.1.0';

export const PACKAGE_KINDS = ['skill', 'plugin'] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];

export const SKILL_TYPES = ['knowledge', 'task', 'tool', 'workflow'] as const;
export const PLUGIN_TYPES = ['mcp', 'http', 'native'] as const;
export const SCOPES = ['instance', 'organization', 'project', 'agent', 'user'] as const;
export type PackageScope = (typeof SCOPES)[number];

export const TRUST_LEVELS = ['official', 'verified', 'community', 'untrusted'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/* ─── Permissions catalog ───────────────────────────────── */
export type PermissionSensitivity = 'low' | 'medium' | 'high' | 'unknown';

export const PERMISSION_CATALOG: Record<string, PermissionSensitivity> = {
  'repository.read': 'low',
  'repository.write': 'medium',
  'workspace:read': 'low',
  'workspace:write': 'medium',
  'memory:read': 'low',
  'memory:write': 'medium',
  'host:read': 'low',
  'host:exec': 'high',
  'web:read': 'medium',
  'browser.navigate': 'medium',
  'browser.interact': 'high',
  'network.request': 'high',
  'secrets.read': 'high',
  'filesystem.read': 'low',
  'filesystem.write': 'high',
  'database.read': 'medium',
  'database.write': 'high',
  'payments.charge': 'high',
  'messages.send': 'medium',
};

export function permissionSensitivity(permission: string): PermissionSensitivity {
  return PERMISSION_CATALOG[permission] ?? 'unknown';
}

export function requiresExplicitApproval(permissions: readonly string[]): boolean {
  return permissions.some((permission) => {
    const sensitivity = permissionSensitivity(permission);
    return sensitivity === 'high' || sensitivity === 'unknown';
  });
}

/* ─── Semver (bounded implementation, no dependency) ────── */
export interface Semver { major: number; minor: number; patch: number; prerelease: string | null }

const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?$/u;

export function parseSemver(value: string): Semver | null {
  const match = SEMVER.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}

export function compareSemver(a: Semver, b: Semver): number {
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch) || ((a.prerelease ? 1 : 0) - (b.prerelease ? 1 : 0));
}

interface PartialVersion { major: number; minor: number | null; patch: number | null }

function parsePartial(value: string): PartialVersion | null {
  const match = /^(\d{1,6})(?:\.(\d{1,6}|x|\*))?(?:\.(\d{1,6}|x|\*))?$/iu.exec(value.trim());
  if (!match) return null;
  const part = (raw: string | undefined) => (raw === undefined || raw === 'x' || raw === '*' ? null : Number(raw));
  return { major: Number(match[1]), minor: part(match[2]), patch: part(match[3]) };
}

function at(major: number, minor: number, patch: number): Semver {
  return { major, minor, patch, prerelease: null };
}

function comparatorHolds(version: Semver, token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed || trimmed === '*' || trimmed === 'x' || trimmed === 'latest') return true;
  if (trimmed.startsWith('^')) {
    const base = parsePartial(trimmed.slice(1));
    if (!base) return false;
    const floor = at(base.major, base.minor ?? 0, base.patch ?? 0);
    if (compareSemver(version, floor) < 0) return false;
    const ceiling = base.major > 0 ? at(base.major + 1, 0, 0)
      : base.minor !== null && base.minor > 0 ? at(0, base.minor + 1, 0)
      : at(0, 0, (base.patch ?? 0) + 1);
    return compareSemver(version, ceiling) < 0;
  }
  if (trimmed.startsWith('~')) {
    const base = parsePartial(trimmed.slice(1));
    if (!base) return false;
    const floor = at(base.major, base.minor ?? 0, base.patch ?? 0);
    const ceiling = at(base.major, (base.minor ?? 0) + 1, 0);
    return compareSemver(version, floor) >= 0 && compareSemver(version, ceiling) < 0;
  }
  const operator = /^(>=|<=|>|<|=)\s*/u.exec(trimmed)?.[1] ?? '';
  const base = parsePartial(trimmed.slice(operator.length));
  if (!base) return false;
  const low = at(base.major, base.minor ?? 0, base.patch ?? 0);
  if (base.minor === null) {
    return operator === '<' ? version.major < base.major
      : operator === '>' ? version.major > base.major
      : version.major === base.major;
  }
  if (base.patch === null) {
    return operator === '<' ? version.major < base.major || (version.major === base.major && version.minor < base.minor)
      : operator === '>' ? version.major > base.major || (version.major === base.major && version.minor > base.minor)
      : version.major === base.major && version.minor === base.minor;
  }
  switch (operator) {
    case '>=': return compareSemver(version, low) >= 0;
    case '<=': return compareSemver(version, low) <= 0;
    case '>': return compareSemver(version, low) > 0;
    case '<': return compareSemver(version, low) < 0;
    default: return compareSemver(version, low) === 0;
  }
}

/** Supports `*`, exact, `^`, `~`, comparators, `x` ranges, hyphen ranges and `||`. */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseSemver(version);
  if (!parsed || !range.trim()) return false;
  if (parsed.prerelease && !/[<>=^~]|\d-\w|prerelease/u.test(range)) return false;
  return range.split('||').some((alternative) => {
    const hyphen = /^\s*([^\s]+)\s+-\s+([^\s]+)\s*$/u.exec(alternative);
    if (hyphen) return comparatorHolds(parsed, `>=${hyphen[1]}`) && comparatorHolds(parsed, `<=${hyphen[2]}`);
    return alternative.split(/[\s,]+/u).filter(Boolean).every((token) => comparatorHolds(parsed, token));
  });
}

/* ─── Bounded JSON helpers ──────────────────────────────── */
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_INSTRUCTIONS_CHARS = 24_000;

const jsonValue = (depth: number): z.ZodTypeAny => depth > 6
  ? z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()])
  : z.union([
    z.string().max(2_000), z.number().finite(), z.boolean(), z.null(),
    z.array(jsonValue(depth + 1)).max(60),
    z.record(z.string().max(80), jsonValue(depth + 1)),
  ]);

export const jsonObjectSchema = z.record(z.string().max(80), jsonValue(0));

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,80}$/u);
const versionString = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/u);
const rangeString = z.string().trim().min(1).max(80);
const permissionString = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.:-]{1,60}$/u);
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u);
const toolIdString = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,80}$/u);
const httpUrl = z.string().url().max(500).refine(
  (value) => value.startsWith('https://') || value.startsWith('http://localhost') || value.startsWith('http://127.0.0.1'),
  'Only https URLs (or localhost for development) are accepted',
);

const dependencySchema = z.strictObject({
  id: identifier,
  version: rangeString,
});

const ioFieldSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  required: z.boolean().optional(),
});

const securitySchema = z.strictObject({
  risk_level: z.enum(['low', 'medium', 'high']).optional(),
  network: z.boolean().optional(),
  data_access: z.array(z.string().max(80)).max(12).optional(),
});

const commonShape = {
  schema_version: z.literal(SCHEMA_VERSION),
  id: identifier,
  name: z.string().trim().min(2).max(120),
  version: versionString,
  description: z.string().trim().min(10).max(2_000),
  author: z.string().trim().min(1).max(120),
  maintainer: z.string().trim().max(160).optional(),
  category: z.string().trim().min(1).max(60).default('general'),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  capabilities: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  permissions: z.array(permissionString).max(24).default([]),
  scope: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
  dependencies: z.array(dependencySchema).max(20).default([]),
  compatibility: z.strictObject({ wora: rangeString }).optional(),
  auto_load: z.boolean().default(false),
  security: securitySchema.optional(),
  metadata: jsonObjectSchema.optional(),
};

const requirementsSchema = z.strictObject({
  tools: z.array(toolIdString).max(24).default([]),
  permissions: z.array(permissionString).max(24).default([]),
  secrets: z.array(secretName).max(12).default([]),
  wora: rangeString.optional(),
  runtime: z.string().trim().max(120).optional(),
}).default({ tools: [], permissions: [], secrets: [] });

/**
 * A deliberately small, non-executable execution policy. A skill may influence
 * presentation and evidence requirements, but it can never name a tool,
 * permission, path, command, or approval bypass. Unknown keys are rejected.
 */
export const skillExecutionPolicySchema = z.strictObject({
  summary_sentences: z.number().int().min(1).max(5).optional(),
  require_evidence: z.boolean().optional(),
}).default({});
export type SkillExecutionPolicy = z.infer<typeof skillExecutionPolicySchema>;

export const skillManifestSchema = z.strictObject({
  ...commonShape,
  kind: z.literal('skill').optional(),
  type: z.enum(SKILL_TYPES),
  instructions: z.string().trim().min(40).max(MAX_INSTRUCTIONS_CHARS),
  requirements: requirementsSchema,
  execution_policy: skillExecutionPolicySchema,
  inputs: z.array(ioFieldSchema).max(20).default([]),
  outputs: z.array(ioFieldSchema).max(20).default([]),
  verification: z.array(z.string().trim().min(3).max(400)).min(1).max(20),
  failure_handling: z.string().trim().max(2_000).optional(),
  handoff: z.string().trim().max(1_000).optional(),
});

const pluginToolSchema = z.strictObject({
  id: toolIdString,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(3).max(1_000),
  input_schema: jsonObjectSchema.default({ type: 'object', properties: {} }),
  output_schema: jsonObjectSchema.optional(),
  permissions: z.array(permissionString).max(12).default([]),
  timeout_ms: z.number().int().min(500).max(120_000).default(15_000),
  risk: z.enum(['low', 'medium', 'high']).default('medium'),
  path: z.string().trim().max(300).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  /** Optional machine-readable meaning/units/side-effects contract. */
  semantic_contract: jsonObjectSchema.optional(),
});

export const pluginManifestSchema = z.strictObject({
  ...commonShape,
  kind: z.literal('plugin').optional(),
  type: z.enum(PLUGIN_TYPES),
  entrypoint: z.strictObject({
    transport: z.enum(['stdio', 'http']),
    command: z.string().trim().max(120).optional(),
    args: z.array(z.string().max(300)).max(24).default([]),
    url: httpUrl.optional(),
    env: z.array(secretName).max(12).default([]),
  }),
  required_secrets: z.array(secretName).max(12).default([]),
  configuration: z.strictObject({
    schema: jsonObjectSchema.optional(),
  }).default({}),
  tools: z.array(pluginToolSchema).max(60).default([]),
  health: z.strictObject({
    type: z.enum(['mcp', 'http']),
    path: z.string().trim().max(300).optional(),
    timeout_ms: z.number().int().min(500).max(30_000).default(8_000),
  }),
  lifecycle: z.strictObject({
    install: z.string().max(500).optional(),
    uninstall: z.string().max(500).optional(),
  }).optional(),
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PackageManifest = SkillManifest | PluginManifest;

/* ─── Validation & security review ──────────────────────── */
export type ExecutionModel = 'instructions-only' | 'mcp-stdio' | 'mcp-http' | 'http-api' | 'native-adapter';

export interface SecurityReview {
  trust: TrustLevel;
  permissions: Array<{ name: string; sensitivity: PermissionSensitivity }>;
  requiresApproval: boolean;
  secrets: string[];
  lifecycleHooks: boolean;
  networkAccess: boolean;
  executesCode: boolean;
  executionModel: ExecutionModel;
  notes: string[];
}

export interface ValidationResult {
  ok: boolean;
  kind: PackageKind;
  manifest: PackageManifest | null;
  errors: Array<{ path: string; message: string }>;
  warnings: string[];
  security: SecurityReview | null;
  checksum: string | null;
}

const SAFE_COMMAND = /^(?:node|npx|python3|uvx|deno)$/u;
const allowedCommands = () => new Set((process.env['WORA_MCP_COMMAND_ALLOWLIST'] ?? 'node,npx,python3,uvx,deno')
  .split(',').map((value) => value.trim()).filter(Boolean));

function collectPermissions(manifest: PackageManifest, kind: PackageKind): string[] {
  if (kind === 'skill') {
    const skill = manifest as SkillManifest;
    return [...new Set([...skill.permissions, ...skill.requirements.permissions])];
  }
  const plugin = manifest as PluginManifest;
  const toolPermissions = plugin.tools.flatMap((tool) => tool.permissions);
  return [...new Set([...plugin.permissions, ...toolPermissions])];
}

function securityOf(manifest: PackageManifest, kind: PackageKind, trust: TrustLevel): SecurityReview {
  const permissions = collectPermissions(manifest, kind).map((name) => ({ name, sensitivity: permissionSensitivity(name) }));
  const warnings: string[] = [];
  let executionModel: ExecutionModel = 'instructions-only';
  let secrets: string[] = [];
  let lifecycleHooks = false;
  let networkAccess = Boolean((manifest as SkillManifest).security?.network);
  if (kind === 'plugin') {
    const plugin = manifest as PluginManifest;
    if (plugin.type === 'mcp' && plugin.entrypoint.transport === 'stdio') executionModel = 'mcp-stdio';
    else if (plugin.type === 'mcp') executionModel = 'mcp-http';
    else if (plugin.type === 'http') executionModel = 'http-api';
    else executionModel = 'native-adapter';
    if (plugin.lifecycle && (plugin.lifecycle.install || plugin.lifecycle.uninstall)) {
      warnings.push('Manifest declares lifecycle hooks. WORA records them but never executes install/uninstall scripts.');
    }
    if (plugin.type === 'native' && trust !== 'official') {
      warnings.push('Native adapters are only loaded from code shipped with WORA; external native plugins are not executed.');
    }
    secrets = [...new Set([...plugin.required_secrets, ...plugin.entrypoint.env])];
    lifecycleHooks = Boolean(plugin.lifecycle?.install || plugin.lifecycle?.uninstall);
    networkAccess = plugin.type === 'mcp' || plugin.type === 'http';
  } else {
    secrets = [...(manifest as SkillManifest).requirements.secrets];
  }
  const executesCode = executionModel === 'mcp-stdio' || executionModel === 'native-adapter';
  return {
    trust,
    permissions,
    requiresApproval: requiresExplicitApproval(permissions.map((permission) => permission.name)) || executesCode,
    secrets,
    lifecycleHooks,
    networkAccess,
    executesCode,
    executionModel,
    notes: warnings,
  };
}

/** Deterministic checksum over the validated manifest plus its instruction body. */
export function checksumOf(manifest: PackageManifest, instructions = ''): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value as Record<string, unknown>).sort()
        .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  return `sha256:${createHash('sha256').update(canonical({ manifest, instructions })).digest('hex')}`;
}

export function validateManifest(kind: PackageKind, raw: unknown, trust: TrustLevel = 'community'): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const warnings: string[] = [];
  if (Buffer.byteLength(JSON.stringify(raw ?? null)) > MAX_MANIFEST_BYTES) {
    return { ok: false, kind, manifest: null, errors: [{ path: '', message: `Manifest exceeds ${MAX_MANIFEST_BYTES} bytes` }], warnings, security: null, checksum: null };
  }
  const parsed = kind === 'skill' ? skillManifestSchema.safeParse(raw) : pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push({ path: issue.path.join('.'), message: issue.message });
    return { ok: false, kind, manifest: null, errors, warnings, security: null, checksum: null };
  }
  const manifest = parsed.data as PackageManifest;
  if (manifest.compatibility && !satisfies(WORA_VERSION, manifest.compatibility.wora)) {
    errors.push({ path: 'compatibility.wora', message: `Requires WORA ${manifest.compatibility.wora}; this build is ${WORA_VERSION}` });
  }
  if (kind === 'skill' && (manifest as SkillManifest).requirements.wora && !satisfies(WORA_VERSION, (manifest as SkillManifest).requirements.wora!)) {
    errors.push({ path: 'requirements.wora', message: `Requires WORA ${(manifest as SkillManifest).requirements.wora}; this build is ${WORA_VERSION}` });
  }
  if (kind === 'plugin') {
    const plugin = manifest as PluginManifest;
    if (plugin.type === 'mcp' && plugin.entrypoint.transport === 'stdio') {
      const command = plugin.entrypoint.command ?? '';
      if (!command) errors.push({ path: 'entrypoint.command', message: 'A stdio MCP plugin must declare a command' });
      else if (!SAFE_COMMAND.test(command) || !allowedCommands().has(command)) {
        errors.push({ path: 'entrypoint.command', message: `Command "${command}" is not in the MCP command allowlist` });
      }
      // Inline evaluation would turn a manifest into arbitrary code without a script on disk.
      const inlineFlag = /^(?:-e|--eval|-p|--print|-c|--command|--interactive|-i)$/u;
      for (const arg of plugin.entrypoint.args) {
        if (inlineFlag.test(arg) || arg.startsWith('--eval=')) {
          errors.push({ path: 'entrypoint.args', message: `Inline evaluation flag "${arg}" is not allowed in an MCP command` });
        }
      }
    }
    if (plugin.type === 'mcp' && plugin.entrypoint.transport === 'http' && !plugin.entrypoint.url) {
      errors.push({ path: 'entrypoint.url', message: 'An HTTP MCP plugin must declare a URL' });
    }
    if (plugin.type === 'http' && !plugin.entrypoint.url) {
      errors.push({ path: 'entrypoint.url', message: 'An HTTP integration must declare a URL' });
    }
    if (plugin.type === 'http') {
      for (const tool of plugin.tools) {
        if (!tool.path) errors.push({ path: `tools.${tool.id}.path`, message: 'HTTP integration tools must declare a path' });
      }
    }
    if (plugin.type === 'native' && trust !== 'official') {
      errors.push({ path: 'type', message: 'External native plugins are not supported; native adapters ship with WORA' });
    }
    const seen = new Set<string>();
    for (const tool of plugin.tools) {
      if (seen.has(tool.id)) errors.push({ path: `tools.${tool.id}`, message: 'Duplicate tool id inside the plugin' });
      seen.add(tool.id);
    }
    if (plugin.tools.length === 0) warnings.push('Plugin declares no tools; it will install but expose no capabilities.');
  }
  const security = securityOf(manifest, kind, trust);
  if (security.permissions.some((permission) => permission.sensitivity === 'unknown')) {
    warnings.push('Manifest requests permissions outside the known catalog; they require explicit approval.');
  }
  const instructions = kind === 'skill' ? (manifest as SkillManifest).instructions : '';
  return {
    ok: errors.length === 0,
    kind,
    manifest: errors.length === 0 ? manifest : null,
    errors,
    warnings,
    security: errors.length === 0 ? security : null,
    checksum: errors.length === 0 ? checksumOf(manifest, instructions) : null,
  };
}

/** Runtime guard used by every read path before a stored manifest is trusted again. */
export function readStoredManifest(kind: PackageKind, raw: string): PackageManifest | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = validateManifest(kind, parsed);
    return result.ok ? result.manifest : null;
  } catch {
    return null;
  }
}
