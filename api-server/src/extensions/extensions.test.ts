/**
 * WORA extensions — real backend tests.
 *
 * Everything runs against a real SQLite database, a real Git repository created
 * in a temp directory, a real HTTP plugin server and a real stdio MCP process.
 * No mocked registry, no simulated installation.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-ext-tests-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['WORA_EXT_KEY_FILE'] = path.join(TMP, 'ext-secret.key');
process.env['WORA_EXT_BUNDLED_DIR'] = path.join(TMP, 'bundled');
process.env['WORA_EXTENSIONS_LOCAL_ROOTS'] = TMP;
process.env['AUTH_SECRET'] = 'test-secret-0123456789abcdef0123456789abcdef';
process.env['NODE_ENV'] = 'test';
process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = '1';
process.env['WORA_MCP_STDIO_MODE'] = 'official';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { validateManifest, satisfies, permissionSensitivity } = await import('./manifest.js');
const store = await import('./store.js');
const { registerMarketplace, syncMarketplace, previewMarketplace } = await import('./marketplace.js');
const { fetchLocalRepository } = await import('./git.js');
const { buildInstallPlan, applyInstallPlan, planToView, uninstallPackage } = await import('./resolver.js');
const { resolveCapabilities, resolveAndSnapshot, executeForAgent } = await import('./capabilities.js');
const { createExtensionsRouter } = await import('./router.js');
const { syncInstallationResources, checkInstallationHealth } = await import('./runtime.js');
const { putSecret, listSecrets, revealSecret } = await import('./secrets.js');
const { seedBuiltinCatalog } = await import('./builtin.js');
const { ensureExtensionSchema } = await import('./schema.js');
const { initExtensions } = await import('./index.js');
const { createAgent, listAgents } = await import('../os/registry.js');
const { createMission, executeMission, getMissionDetail } = await import('../os/orchestrator.js');
const { issueSessionToken } = await import('../lib/session.js');
const { setWorkspaceRole } = await import('../os/roles.js');
const { createOsRouter } = await import('../os/router.js');
const { getOsDb } = await import('../os/db.js');
const express = (await import('express')).default;

const SECRET = process.env['AUTH_SECRET']!;
const MARKET = path.join(TMP, 'marketplace');
let httpPluginPort = 0;
let httpPluginServer: Server;

function git(args: string[], cwd = MARKET) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writePackage(relative: string, value: unknown) {
  const file = path.join(MARKET, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function skill(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: '1.0',
    id: 'test.knowledge',
    name: 'Test Knowledge',
    version: '1.0.0',
    type: 'knowledge',
    description: 'A real test skill used to verify the WORA extension lifecycle end to end.',
    author: 'WORA Tests',
    category: 'testing',
    tags: ['test', 'knowledge'],
    capabilities: ['testing'],
    permissions: ['memory:read'],
    scope: ['instance', 'agent', 'project'],
    dependencies: [{ id: 'test.base', version: '^1.0.0' }],
    instructions: '# Test Knowledge\n\nUse this skill to verify manifest validation, dependency resolution, installation and capability snapshots. It grants no tool by itself.',
    requirements: { tools: [], permissions: ['memory:read'], secrets: [] },
    verification: ['The dependency is installed alongside this skill'],
    failure_handling: 'Report the failing step instead of skipping it.',
    handoff: 'Hand the verified result to the test runner.',
    ...overrides,
  };
}

function baseSkill(overrides: Record<string, unknown> = {}) {
  return skill({
    id: 'test.base', name: 'Test Base', description: 'Base skill that test.knowledge depends on.',
    dependencies: [], instructions: '# Test Base\n\nBase knowledge skill with no dependencies. It exists to verify dependency resolution and uninstall ordering.', ...overrides,
  });
}

function httpPlugin(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: '1.0',
    id: 'test.http-plugin',
    name: 'Test HTTP Plugin',
    version: '1.0.0',
    type: 'http',
    description: 'A real HTTP integration plugin served by a local test server.',
    author: 'WORA Tests',
    category: 'testing',
    tags: ['test', 'http'],
    capabilities: ['echo'],
    permissions: [],
    scope: ['instance', 'agent'],
    dependencies: [],
    entrypoint: { transport: 'http', url: `http://127.0.0.1:${httpPluginPort}`, args: [], env: [] },
    required_secrets: [],
    configuration: {},
    tools: [{
      id: 'echo', name: 'Echo', description: 'Echoes the JSON body back.',
      input_schema: { type: 'object', properties: { text: { type: 'string' } } },
      permissions: [], timeout_ms: 5_000, risk: 'low', path: '/echo', method: 'POST',
    }],
    health: { type: 'http', timeout_ms: 3_000 },
    security: { risk_level: 'low', network: true, data_access: [] },
    ...overrides,
  };
}

function stdioProbePlugin(marker: string) {
  return {
    ...httpPlugin({
      id: 'test.stdio-probe',
      name: 'Stdio Probe',
      description: 'A test-only stdio plugin that writes a marker if it is ever spawned.',
    }),
    type: 'mcp',
    entrypoint: { transport: 'stdio', command: 'node', args: [marker], env: [] },
    health: { type: 'mcp', timeout_ms: 1_000 },
    security: { risk_level: 'low', network: false, data_access: ['none'] },
    tools: [{
      id: 'probe', name: 'Probe', description: 'Test probe tool.', input_schema: { type: 'object', properties: {} },
      permissions: [], timeout_ms: 1_000, risk: 'low',
    }],
  };
}

before(async () => {
  httpPluginServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, method: req.method, path: req.url, body: JSON.parse(body || '{}') }));
    });
  });
  await new Promise<void>((resolve) => httpPluginServer.listen(0, '127.0.0.1', resolve));
  const address = httpPluginServer.address();
  httpPluginPort = typeof address === 'object' && address ? address.port : 0;

  mkdirSync(MARKET, { recursive: true });
  git(['init', '--quiet']);
  git(['config', 'user.email', 'tests@wora.local']);
  git(['config', 'user.name', 'WORA Tests']);
  git(['config', 'commit.gpgsign', 'false']);
  writePackage('wora/skills/test-base/skill.json', baseSkill());
  writePackage('wora/skills/test-knowledge/skill.json', skill());
  writePackage('wora/plugins/test-http/plugin.json', httpPlugin());
  writePackage('wora/skills/test-removable/skill.json', skill({ id: 'test.removable', name: 'Removable', dependencies: [], description: 'Skill removed from the repository during synchronization.' }));
  writePackage('wora/plugins/bad-command/plugin.json', { ...httpPlugin({ id: 'test.bad-command' }), type: 'mcp', entrypoint: { transport: 'stdio', command: 'bash', args: ['-c', 'echo hi'], env: [] } });
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'initial marketplace']);
  git(['branch', '-M', 'main']);
  ensureExtensionSchema();
  initExtensions();
});

after(() => {
  httpPluginServer?.close();
  rmSync(TMP, { recursive: true, force: true });
});

/* ─── Manifest validation ─── */
test('marketplace: local roots and subpaths reject symlink escapes', () => {
  const outside = mkdtempSync(path.join(os.tmpdir(), 'wora-outside-market-'));
  const safe = path.join(TMP, 'safe-market');
  mkdirSync(safe, { recursive: true });
  try {
    symlinkSync(outside, path.join(TMP, 'escape-market'), 'dir');
    assert.throws(
      () => fetchLocalRepository({ url: path.join(TMP, 'escape-market'), ref: 'main', refType: 'branch' }),
      /LOCAL_ROOT_DENIED|inside WORA_EXTENSIONS_LOCAL_ROOTS|Path escapes/,
    );
    symlinkSync(outside, path.join(safe, 'escape'), 'dir');
    assert.throws(
      () => fetchLocalRepository({ url: safe, subPath: 'escape', ref: 'main', refType: 'branch' }),
      /INVALID_PATH|Path escapes/,
    );
  } finally {
    rmSync(path.join(TMP, 'escape-market'), { force: true });
    rmSync(path.join(safe, 'escape'), { force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('manifest: a valid skill validates, unknown fields are rejected, instructions are required', () => {
  const ok = validateManifest('skill', skill());
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.manifest?.id, 'test.knowledge');
  assert.ok(ok.checksum?.startsWith('sha256:'));

  const unknown = validateManifest('skill', { ...skill(), hidden_entrypoint: 'curl example.com' });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some((error) => /unrecognized/iu.test(error.message) || error.path.includes('hidden_entrypoint')));

  const noInstructions = validateManifest('skill', { ...skill(), instructions: 'short' });
  assert.equal(noInstructions.ok, false);
});

test('manifest: incompatible WORA version is refused and semver ranges behave', () => {
  const incompatible = validateManifest('skill', skill({ compatibility: { wora: '^9.0.0' } }));
  assert.equal(incompatible.ok, false);
  assert.ok(incompatible.errors.some((error) => error.path === 'compatibility.wora'));
  assert.equal(satisfies('1.4.2', '^1.0.0'), true);
  assert.equal(satisfies('2.0.0', '^1.0.0'), false);
  assert.equal(satisfies('1.2.9', '~1.2.0'), true);
  assert.equal(satisfies('1.3.0', '~1.2.0'), false);
  assert.equal(satisfies('1.5.0', '>=1.0.0 <2.0.0'), true);
});

test('manifest: inline evaluation and unlisted commands are rejected; code execution requires approval', () => {
  const inline = validateManifest('plugin', {
    ...httpPlugin({ id: 'test.inline' }), type: 'mcp',
    entrypoint: { transport: 'stdio', command: 'node', args: ['-e', 'process.exit(0)'], env: [] },
  }, 'community');
  assert.equal(inline.ok, false);
  assert.ok(inline.errors.some((error) => error.path === 'entrypoint.args'));

  const echo = validateManifest('plugin', {
    schema_version: '1.0', id: 'test.echo', name: 'Echo', version: '1.0.0', type: 'mcp',
    description: 'A local echo MCP plugin used by tests.', author: 'WORA Tests',
    permissions: [], scope: ['instance'], dependencies: [], auto_load: false,
    entrypoint: { transport: 'stdio', command: 'node', args: ['/tmp/echo.mjs'], env: [] },
    required_secrets: [], configuration: {}, tools: [], health: { type: 'mcp', timeout_ms: 1_000 },
  }, 'community');
  assert.equal(echo.ok, true, JSON.stringify(echo.errors));
  assert.equal(echo.security?.requiresApproval, true, 'executing a child process always needs explicit approval');
  assert.equal(echo.security?.executionModel, 'mcp-stdio');
});

test('manifest: permission sensitivity flags high-impact permissions', () => {
  assert.equal(permissionSensitivity('repository.read'), 'low');
  assert.equal(permissionSensitivity('host:exec'), 'high');
  assert.equal(permissionSensitivity('custom.unknown'), 'unknown');
  const sensitive = validateManifest('skill', skill({ permissions: ['host:exec'], requirements: { tools: [], permissions: ['host:exec'], secrets: [] } }));
  assert.equal(sensitive.ok, true);
  assert.equal(sensitive.security?.requiresApproval, true);
});

/* ─── Marketplace ─── */
test('marketplace: preview and registration discover real Git manifests and skip invalid ones', async () => {
  const ws = 'wora-ext-market';
  const preview = await previewMarketplace({ workspaceId: ws, name: 'Test market', url: `file://${MARKET}`, ref: 'main', refType: 'branch', actor: 'tester' });
  assert.ok(preview.packages.length >= 4);
  assert.ok(preview.packages.some((entry) => entry.key === 'test.knowledge' && entry.ok));
  assert.ok(preview.packages.some((entry) => !entry.ok), 'the invalid plugin is reported, not silently ignored');

  const { marketplace, sync } = await registerMarketplace({
    workspaceId: ws, name: 'Test market', url: `file://${MARKET}`, ref: 'main', refType: 'branch', actor: 'tester', autoLoad: true,
  });
  assert.equal(marketplace.status, 'ready');
  assert.equal(marketplace.provider, 'git');
  assert.equal(marketplace.autoLoad, true);
  assert.ok(sync.commit && sync.commit.length >= 7);
  const packages = store.listPackages(ws, { marketplaceId: marketplace.id });
  assert.ok(packages.some((pkg) => pkg.key === 'test.knowledge'));
  assert.ok(!packages.some((pkg) => pkg.key === 'test.bad-command'), 'invalid manifests are never stored');
});

test('marketplace: sync detects changes, never replaces a published version, and marks removals', async () => {
  const ws = 'wora-ext-sync';
  const { marketplace } = await registerMarketplace({ workspaceId: ws, name: 'Sync market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const removable = store.findPackageByKey(ws, 'skill', 'test.removable')!;
  const before = store.getPackage(ws, removable.id)!;
  const knowledge = store.findPackageByKey(ws, 'skill', 'test.knowledge')!;

  rmSync(path.join(MARKET, 'wora/skills/test-removable'), { recursive: true, force: true });
  writePackage('wora/skills/test-knowledge/skill.json', skill({ version: '1.1.0', description: 'A real test skill with a new published version and additional verification evidence.' }));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'publish 1.1.0 and remove one skill']);

  const result = await syncMarketplace(ws, marketplace.id, 'tester');
  assert.ok(result.changed >= 1);
  assert.equal(store.getPackage(ws, before.id)!.status, 'revoked', 'a removed, uninstalled package is flagged revoked');

  const versions = store.listVersions(ws, knowledge.id);
  assert.ok(versions.some((version) => version.version === '1.1.0'));
  assert.ok(versions.some((version) => version.version === '1.0.0'), 'the previous version is retained');

  // Republish 1.1.0 with different content: the stored version must not change.
  const stored = versions.find((version) => version.version === '1.1.0')!;
  writePackage('wora/skills/test-knowledge/skill.json', skill({ version: '1.1.0', description: 'A tampered republish of the same version that must never replace installed content.' }));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'tamper same version']);
  const second = await syncMarketplace(ws, marketplace.id, 'tester');
  const after = store.listVersions(ws, knowledge.id).find((version) => version.version === '1.1.0')!;
  assert.equal(after.checksum, stored.checksum, 'published version content is immutable');
  assert.ok(second.log.some((line) => line.includes('checksum mismatch')) || second.warnings.length > 0);
});

/* ─── Installation & resolution ─── */
test('install: dependency resolution installs the dependency and records the graph', async () => {
  const ws = 'wora-ext-install';
  const { marketplace } = await registerMarketplace({ workspaceId: ws, name: 'Install market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const root = store.findPackageByKey(ws, 'skill', 'test.knowledge')!;
  const plan = buildInstallPlan({ workspaceId: ws, packageId: root.id, scope: 'instance' });
  assert.equal(plan.canInstall, true, JSON.stringify(plan.conflicts));
  assert.equal(plan.nodes.length, 2);
  assert.ok(plan.nodes.some((node) => node.key === 'test.base' && !node.isRoot));

  const installation = applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true });
  assert.equal(installation.enabled, true);
  const deps = store.listDependencies(installation.id);
  assert.ok(deps.some((dep) => dep.depKey === 'test.base' && dep.satisfied));
  assert.ok(store.listInstallations(ws).some((row) => row.packageId === store.findPackageByKey(ws, 'skill', 'test.base')!.id));
  assert.equal(marketplace.id, store.getPackage(ws, root.id)!.marketplaceId);
});

test('install: missing dependency and version conflict block installation with a readable plan', async () => {
  const ws = 'wora-ext-conflict';
  await registerMarketplace({ workspaceId: ws, name: 'Conflict market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const broken = store.findPackageByKey(ws, 'skill', 'test.knowledge')!;
  const version = store.getVersion(ws, broken.id, broken.latestVersion)!;
  const manifest = structuredClone(version.manifest) as { dependencies: Array<{ id: string; version: string }> };
  manifest.dependencies = [{ id: 'test.missing', version: '^1.0.0' }];
  const stored = store.upsertPackage({
    workspaceId: ws, marketplaceId: broken.marketplaceId, kind: 'skill',
    manifest: { ...manifest, version: '9.9.9' } as unknown as Parameters<typeof store.upsertPackage>[0]['manifest'],
    instructions: 'A test skill that depends on a package that does not exist.', sourceSha: 'test', trust: 'community',
  });
  const plan = buildInstallPlan({ workspaceId: ws, packageId: stored.packageId, version: '9.9.9', scope: 'instance' });
  assert.equal(plan.canInstall, false);
  assert.ok(plan.missing.some((entry) => entry.key === 'test.missing'));
  assert.throws(() => applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true }), /unresolved/);
});

test('install: uninstall refuses while a dependent is installed, then cleans up tools', async () => {
  const ws = 'wora-ext-uninstall';
  await registerMarketplace({ workspaceId: ws, name: 'Uninstall market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const root = store.findPackageByKey(ws, 'skill', 'test.knowledge')!;
  const plan = buildInstallPlan({ workspaceId: ws, packageId: root.id, scope: 'instance' });
  const installation = applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true });
  const base = store.findPackageByKey(ws, 'skill', 'test.base')!;
  const baseInstallation = store.listInstallations(ws, { packageId: base.id })[0]!;
  assert.throws(() => uninstallPackage(ws, baseInstallation.id, 'tester'), /Uninstall test.knowledge first/);
  assert.equal(uninstallPackage(ws, installation.id, 'tester'), true);
  assert.equal(store.listInstallations(ws, { packageId: root.id }).length, 0);
  assert.equal(uninstallPackage(ws, baseInstallation.id, 'tester'), true);
});

/* ─── Capabilities ─── */
test('capabilities: scope, explicit deny, permissions and revocation all gate access', async () => {
  const ws = 'wora-ext-capabilities';
  const { marketplace } = await registerMarketplace({ workspaceId: ws, name: 'Capabilities market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const agentA = createAgent({ workspaceId: ws, name: 'Agent A', role: 'Generalist', specialization: 'generalist', actor: 'tester' });
  const agentB = createAgent({ workspaceId: ws, name: 'Agent B', role: 'Generalist', specialization: 'generalist', actor: 'tester' });

  const plugin = store.findPackageByKey(ws, 'plugin', 'test.http-plugin')!;
  const pluginPlan = buildInstallPlan({ workspaceId: ws, packageId: plugin.id, scope: 'agent', scopeId: agentA.id });
  const pluginInstallation = applyInstallPlan({ workspaceId: ws, plan: pluginPlan, actor: 'tester', approvePermissions: true });
  syncInstallationResources(ws, pluginInstallation.id);

  const profileA = resolveCapabilities(ws, agentA.id);
  assert.ok(profileA.plugins.some((entry) => entry.key === 'test.http-plugin'));
  assert.ok(profileA.tools.includes('test.http-plugin.echo'));
  const profileB = resolveCapabilities(ws, agentB.id);
  assert.equal(profileB.plugins.length, 0, 'agent scope does not leak to another agent');

  const skillPkg = store.findPackageByKey(ws, 'skill', 'test.knowledge')!;
  const skillPlan = buildInstallPlan({ workspaceId: ws, packageId: skillPkg.id, scope: 'instance' });
  applyInstallPlan({ workspaceId: ws, plan: skillPlan, actor: 'tester', approvePermissions: true });
  const withSkill = resolveCapabilities(ws, agentA.id);
  assert.ok(withSkill.skills.some((entry) => entry.key === 'test.knowledge'));
  assert.ok(withSkill.skills.find((entry) => entry.key === 'test.knowledge')!.instructions.includes('Test Knowledge'));

  store.setAgentPolicy(ws, agentA.id, { deniedPackages: ['test.knowledge'] }, 'tester');
  const denied = resolveCapabilities(ws, agentA.id);
  assert.ok(!denied.skills.some((entry) => entry.key === 'test.knowledge'));
  assert.ok(denied.blocked.some((entry) => entry.key === 'test.knowledge' && /denied/.test(entry.reason)));

  store.setAgentPolicy(ws, agentA.id, { deniedPackages: [], deniedTools: ['test.http-plugin.echo'] }, 'tester');
  const toolDenied = resolveCapabilities(ws, agentA.id);
  assert.ok(!toolDenied.tools.includes('test.http-plugin.echo'));

  store.setAgentPolicy(ws, agentA.id, { deniedTools: [] }, 'tester');
  const updated = store.updateInstallation(ws, pluginInstallation.id, { enabled: false, status: 'disabled' }, 'tester');
  assert.ok(updated);
  syncInstallationResources(ws, pluginInstallation.id);
  const revoked = resolveCapabilities(ws, agentA.id);
  assert.equal(revoked.plugins.length, 0, 'disabling revokes the capability immediately');
  assert.equal(revoked.tools.includes('test.http-plugin.echo'), false);
  assert.ok(revoked.blocked.some((entry) => entry.key === 'test.http-plugin'));
  assert.ok(marketplace.id);
});

test('capabilities: a permission the agent does not hold blocks the package instead of silently granting it', async () => {
  const ws = 'wora-ext-permissions';
  await registerMarketplace({ workspaceId: ws, name: 'Permission market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const agent = createAgent({ workspaceId: ws, name: 'Viewer Agent', role: 'Read only', specialization: 'generalist', permissions: [], actor: 'tester' });
  const skillPkg = store.findPackageByKey(ws, 'skill', 'test.knowledge')!;
  const plan = buildInstallPlan({ workspaceId: ws, packageId: skillPkg.id, scope: 'agent', scopeId: agent.id });
  applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true });
  const profile = resolveCapabilities(ws, agent.id);
  assert.equal(profile.skills.length, 0);
  assert.ok(profile.blocked.some((entry) => entry.key === 'test.knowledge' && /memory:read/.test(entry.reason)));
});

/* ─── Secrets ─── */
test('secrets: encrypted at rest, metadata-only listing, never returned in plaintext', () => {
  const ws = 'wora-ext-secrets';
  const secret = putSecret({ workspaceId: ws, name: 'TEST_TOKEN', value: 'super-secret-value', actor: 'tester' });
  assert.equal(secret.name, 'TEST_TOKEN');
  const listed = listSecrets(ws);
  assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(listed).includes('super-secret-value'), false);
  const row = getOsDb().prepare('SELECT ciphertext FROM ext_secrets WHERE workspace_id = ? AND name = ?').get(ws, 'TEST_TOKEN') as { ciphertext: string };
  assert.equal(row.ciphertext.includes('super-secret-value'), false);
  assert.equal(revealSecret(ws, 'TEST_TOKEN'), 'super-secret-value');
  assert.equal(revealSecret(ws, 'MISSING_TOKEN'), null);
});

/* ─── MCP & plugin runtime ─── */
test('mcp: the bundled reference server is discovered and executed through an agent profile', async () => {
  const ws = 'wora-ext-mcp';
  seedBuiltinCatalog(ws);
  const agent = createAgent({ workspaceId: ws, name: 'MCP Agent', role: 'Generalist', specialization: 'generalist', actor: 'tester' });
  const plugin = store.findPackageByKey(ws, 'plugin', 'wora.echo-mcp')!;
  const plan = buildInstallPlan({ workspaceId: ws, packageId: plugin.id, scope: 'agent', scopeId: agent.id });
  assert.equal(plan.requiresApproval, true);
  const installation = applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true });
  syncInstallationResources(ws, installation.id);
  const health = await checkInstallationHealth(ws, installation.id, 'tester', true);
  assert.equal(health.ok, true, health.error ?? '');
  assert.ok(health.tools.some((tool) => tool.name === 'echo'));

  const profile = resolveCapabilities(ws, agent.id);
  assert.ok(profile.tools.includes('wora.echo-mcp.echo'));
  const result = await executeForAgent({ workspaceId: ws, agentId: agent.id, toolId: 'wora.echo-mcp.echo', toolInput: { text: 'hello-mcp' }, actor: 'tester' });
  assert.equal(result.ok, true, result.error ?? '');
  const content = (result.output as { content?: Array<{ text?: string }> }).content;
  assert.equal(content?.[0]?.text, 'hello-mcp');
  const auditRow = getOsDb().prepare("SELECT COUNT(*) AS c FROM ext_audit WHERE workspace_id = ? AND action = 'extension.tool.execute'").get(ws) as { c: number };
  assert.ok(auditRow.c >= 1);
});

test('mcp: health checks never spawn pending, disabled, revoked or untrusted servers', async () => {
  const ws = 'wora-ext-health-guard';
  const catalog = seedBuiltinCatalog(ws);
  const agent = createAgent({ workspaceId: ws, name: 'Health Guard', role: 'Generalist', specialization: 'generalist', actor: 'tester' });
  const echo = store.findPackageByKey(ws, 'plugin', 'wora.echo-mcp')!;
  const marker = path.join(TMP, 'stdio-probe-marker');
  const probe = validateManifest('plugin', stdioProbePlugin(marker), 'community');
  assert.equal(probe.ok, true, JSON.stringify(probe.errors));
  store.upsertPackage({
    workspaceId: ws, marketplaceId: catalog.marketplaceId, kind: 'plugin', manifest: probe.manifest!,
    sourcePath: 'bundled/plugins/test.stdio-probe/plugin.json', sourceSha: 'test', trust: 'community',
  });
  const probePkg = store.findPackageByKey(ws, 'plugin', 'test.stdio-probe')!;
  const probePlan = buildInstallPlan({ workspaceId: ws, packageId: probePkg.id, scope: 'agent', scopeId: agent.id });
  const pending = applyInstallPlan({ workspaceId: ws, plan: probePlan, actor: 'tester', approvePermissions: false });
  syncInstallationResources(ws, pending.id);
  await assert.rejects(checkInstallationHealth(ws, pending.id, 'tester'), /Health checks require an installed/);
  assert.equal(existsSync(marker), false, 'a pending installation must not start its process');

  const approved = store.updateInstallation(ws, pending.id, { permissionsApproved: true, status: 'installed', enabled: true }, 'tester')!;
  syncInstallationResources(ws, approved.id);
  const previousMode = process.env['WORA_MCP_STDIO_MODE'];
  process.env['WORA_MCP_STDIO_MODE'] = 'disabled';
  try {
    const disabledHealth = await checkInstallationHealth(ws, approved.id, 'tester');
    assert.equal(disabledHealth.ok, false);
    assert.match(disabledHealth.error ?? '', /MCP_STDIO_DISABLED/);
    assert.equal(existsSync(marker), false, 'stdio must stay disabled by default');
  } finally {
    if (previousMode === undefined) delete process.env['WORA_MCP_STDIO_MODE'];
    else process.env['WORA_MCP_STDIO_MODE'] = previousMode;
  }

  store.updateInstallation(ws, approved.id, { enabled: false, status: 'disabled' }, 'tester');
  await assert.rejects(checkInstallationHealth(ws, approved.id, 'tester'), /Health checks require an installed/);
  store.updateInstallation(ws, approved.id, { enabled: true, status: 'installed' }, 'tester');
  store.setPackageStatus(ws, probePkg.id, 'revoked');
  await assert.rejects(checkInstallationHealth(ws, approved.id, 'tester'), /Health checks require an installed/);
  store.setPackageStatus(ws, probePkg.id, 'available');
  uninstallPackage(ws, approved.id, 'tester');
  await assert.rejects(checkInstallationHealth(ws, approved.id, 'tester'), /Health checks require an installed/);
  assert.equal(existsSync(marker), false, 'no rejected state may spawn the plugin');

  // The official echo server is trusted code, but a community stdio server is not.
  const echoPlan = buildInstallPlan({ workspaceId: ws, packageId: echo.id, scope: 'agent', scopeId: agent.id });
  const echoInstall = applyInstallPlan({ workspaceId: ws, plan: echoPlan, actor: 'tester', approvePermissions: true });
  syncInstallationResources(ws, echoInstall.id);
  store.upsertPackage({
    workspaceId: ws, marketplaceId: catalog.marketplaceId, kind: 'plugin', manifest: store.getVersion(ws, echo.id, echoInstall.version)!.manifest,
    sourcePath: 'bundled/plugins/wora.echo-mcp/plugin.json', sourceSha: 'test', trust: 'community',
  });
  const previousOfficial = process.env['WORA_MCP_STDIO_MODE'];
  process.env['WORA_MCP_STDIO_MODE'] = 'official';
  try {
    const untrustedHealth = await checkInstallationHealth(ws, echoInstall.id, 'tester');
    assert.equal(untrustedHealth.ok, false);
    assert.match(untrustedHealth.error ?? '', /MCP_STDIO_UNTRUSTED/);
  } finally {
    if (previousOfficial === undefined) delete process.env['WORA_MCP_STDIO_MODE'];
    else process.env['WORA_MCP_STDIO_MODE'] = previousOfficial;
  }
});

test('mcp: invalid tool input is rejected before any plugin process runs', async () => {
  const ws = 'wora-ext-mcp-invalid';
  seedBuiltinCatalog(ws);
  const agent = createAgent({ workspaceId: ws, name: 'MCP Validating Agent', role: 'Generalist', specialization: 'generalist', actor: 'tester' });
  const plugin = store.findPackageByKey(ws, 'plugin', 'wora.echo-mcp')!;
  const plan = buildInstallPlan({ workspaceId: ws, packageId: plugin.id, scope: 'agent', scopeId: agent.id });
  const installation = applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true });
  syncInstallationResources(ws, installation.id);
  await checkInstallationHealth(ws, installation.id, 'tester', true);
  const result = await executeForAgent({ workspaceId: ws, agentId: agent.id, toolId: 'wora.echo-mcp.echo', toolInput: { text: 42 }, actor: 'tester' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /expected string|Invalid input/);
  const denied = getOsDb().prepare("SELECT COUNT(*) AS c FROM ext_audit WHERE workspace_id = ? AND action = 'extension.tool.denied'").get(ws) as { c: number };
  assert.ok(denied.c >= 1);
});

test('plugin: an HTTP integration executes with a timeout and returns the real service response', async () => {
  const ws = 'wora-ext-http';
  await registerMarketplace({ workspaceId: ws, name: 'HTTP market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const agent = createAgent({ workspaceId: ws, name: 'HTTP Agent', role: 'Generalist', specialization: 'generalist', actor: 'tester' });
  const plugin = store.findPackageByKey(ws, 'plugin', 'test.http-plugin')!;
  const plan = buildInstallPlan({ workspaceId: ws, packageId: plugin.id, scope: 'agent', scopeId: agent.id });
  const installation = applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true });
  syncInstallationResources(ws, installation.id);
  const result = await executeForAgent({ workspaceId: ws, agentId: agent.id, toolId: 'test.http-plugin.echo', toolInput: { text: 'over-http' }, actor: 'tester' });
  assert.equal(result.ok, true, result.error ?? '');
  assert.equal((result.output as { body?: { text?: string } }).body?.text, 'over-http');
});

test('plugin: HTTP tools use the hardened outbound policy', async () => {
  const ws = 'wora-ext-http-ssrf';
  await registerMarketplace({ workspaceId: ws, name: 'HTTP SSRF market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const agent = createAgent({ workspaceId: ws, name: 'HTTP SSRF Agent', role: 'Generalist', specialization: 'generalist', actor: 'tester' });
  const plugin = store.findPackageByKey(ws, 'plugin', 'test.http-plugin')!;
  const plan = buildInstallPlan({ workspaceId: ws, packageId: plugin.id, scope: 'agent', scopeId: agent.id });
  const installation = applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true });
  syncInstallationResources(ws, installation.id);
  const previous = process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'];
  delete process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'];
  try {
    const result = await executeForAgent({ workspaceId: ws, agentId: agent.id, toolId: 'test.http-plugin.echo', toolInput: { text: 'blocked' }, actor: 'tester' });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /BLOCKED_HOST|blocked address|not allowed/);
  } finally {
    if (previous !== undefined) process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = previous;
  }
});

test('plugin: a tool cannot be executed without the agent capability profile', async () => {
  const ws = 'wora-ext-denied';
  await registerMarketplace({ workspaceId: ws, name: 'Denied market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const agent = createAgent({ workspaceId: ws, name: 'No Plugin Agent', role: 'Generalist', specialization: 'generalist', actor: 'tester' });
  const result = await executeForAgent({ workspaceId: ws, agentId: agent.id, toolId: 'test.http-plugin.echo', toolInput: { text: 'nope' }, actor: 'tester' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Unknown tool|not assigned|not active/);
  const denied = getOsDb().prepare("SELECT COUNT(*) AS c FROM ext_audit WHERE workspace_id = ? AND action = 'extension.capability.denied'").get(ws) as { c: number };
  assert.ok(denied.c >= 1);
});

/* ─── Mission integration & revocation ─── */
test('mission: a plugin tool task runs under the resolved profile and records a capability snapshot', async () => {
  const ws = 'wora-ext-mission';
  seedBuiltinCatalog(ws);
  // Use the seeded generalist: the orchestrator picks the least-loaded specialist,
  // so the capability must be assigned to the agent that will actually run the task.
  const agent = listAgents(ws, { specialization: 'generalist' })[0]!;
  const plugin = store.findPackageByKey(ws, 'plugin', 'wora.echo-mcp')!;
  const plan = buildInstallPlan({ workspaceId: ws, packageId: plugin.id, scope: 'agent', scopeId: agent.id });
  const installation = applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true });
  syncInstallationResources(ws, installation.id);

  const missionId = createMission({ workspaceId: ws, objective: 'run tool wora.echo-mcp.echo with {"text":"from-mission"}', actor: 'tester' });
  await executeMission(missionId, 'tester');
  const detail = getMissionDetail(ws, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[0]?.tool, 'wora.echo-mcp.echo');
  assert.equal(detail.tasks[0]?.status, 'completed');
  assert.ok(detail.capabilitySnapshots.length >= 1);
  const snapshot = detail.capabilitySnapshots[0]!;
  assert.ok(snapshot.digest);
  assert.ok((snapshot.profile['plugins'] as unknown[]).length >= 1);

  // Disable the plugin, then start a new mission that was planned while it was enabled.
  const queued = createMission({ workspaceId: ws, objective: 'run tool wora.echo-mcp.echo with {"text":"revoked"}', actor: 'tester' });
  store.updateInstallation(ws, installation.id, { enabled: false, status: 'disabled' }, 'tester');
  syncInstallationResources(ws, installation.id);
  await executeMission(queued, 'tester');
  const revoked = getMissionDetail(ws, queued)!;
  assert.equal(revoked.tasks[0]?.status, 'failed');
  assert.match(revoked.tasks[0]?.runs[0]?.issues.join(' ') ?? '', /not assigned|not active|disabled|not available/i);
});

test('install: update and rollback move between published versions without losing history', async () => {
  const ws = 'wora-ext-update';
  const { marketplace } = await registerMarketplace({ workspaceId: ws, name: 'Update market', url: `file://${MARKET}`, ref: 'main', actor: 'tester' });
  const pkg = store.findPackageByKey(ws, 'skill', 'test.knowledge')!;
  const initial = pkg.latestVersion;
  const plan = buildInstallPlan({ workspaceId: ws, packageId: pkg.id, version: initial, scope: 'instance' });
  const installation = applyInstallPlan({ workspaceId: ws, plan, actor: 'tester', approvePermissions: true });
  assert.equal(installation.version, initial);

  // Publish a newer version and synchronize.
  writePackage('wora/skills/test-knowledge/skill.json', skill({ version: '1.2.0', description: 'A newer test skill version used to verify update and rollback behaviour.' }));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'publish 1.2.0']);
  await syncMarketplace(ws, marketplace.id, 'tester');

  const updatePlan = buildInstallPlan({ workspaceId: ws, packageId: pkg.id, version: '1.2.0', scope: 'instance' });
  assert.equal(updatePlan.canInstall, true);
  const updated = store.updateInstallation(ws, installation.id, { version: '1.2.0' }, 'tester')!;
  assert.equal(updated.version, '1.2.0');
  const rolled = store.updateInstallation(ws, installation.id, { version: initial }, 'tester')!;
  assert.equal(rolled.version, initial);
  assert.ok(store.listVersions(ws, pkg.id).some((version) => version.version === '1.2.0'), 'history is retained');
});

/* ─── HTTP API, RBAC and the end-to-end flow ─── */
test('api: every extension route enforces authorization server-side', { timeout: 30_000 }, async () => {
  seedBuiltinCatalog('wora-rbac');
  const agent = createAgent({ workspaceId: 'wora-rbac', name: 'RBAC Agent', role: 'Generalist', specialization: 'generalist', actor: 'tester' });
  const app = express();
  app.use((req, res, next) => {
    const role = String(req.header('x-test-role') ?? 'viewer');
    res.locals['workspaceId'] = 'wora-rbac';
    res.locals['actor'] = `tester-${role}`;
    res.locals['role'] = role;
    next();
  });
  app.use(express.json());
  app.use('/extensions', createExtensionsRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const call = async (role: string, route: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/extensions${route}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-test-role': role, ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = text;
    try { body = JSON.parse(text) as unknown; } catch { /* text */ }
    return { status: response.status, body: body as Record<string, unknown> };
  };
  try {
    assert.equal((await call('viewer', '/packages')).status, 200);
    assert.equal((await call('viewer', '/packages/not-a-real-id/install', { method: 'POST', body: JSON.stringify({ scope: 'instance' }) })).status, 403);
    assert.equal((await call('member', '/marketplaces', { method: 'POST', body: JSON.stringify({ url: `file://${MARKET}`, name: 'Member market' }) })).status, 403);
    assert.equal((await call('member', '/secrets')).status, 403);
    assert.equal((await call('member', '/secrets', { method: 'POST', body: JSON.stringify({ name: 'MEMBER_TOKEN', value: 'x' }) })).status, 403);
    assert.equal((await call('member', `/agents/${agent.id}/policy`, { method: 'PUT', body: JSON.stringify({ extraPermissions: ['host.exec'] }) })).status, 403);
    assert.equal((await call('member', `/agents/${agent.id}/policy`, { method: 'PUT', body: JSON.stringify({ deniedTools: ['x'] }) })).status, 200);

    const echoPackage = (await call('admin', '/packages?kind=plugin&q=echo')).body as unknown as Array<{ id: string; key: string }>;
    const echo = echoPackage.find((pkg) => pkg.key === 'wora.echo-mcp');
    assert.ok(echo);
    const memberInstall = await call('member', `/packages/${echo.id}/install`, {
      method: 'POST', body: JSON.stringify({ scope: 'instance', approvePermissions: true }),
    });
    assert.equal(memberInstall.status, 403, JSON.stringify(memberInstall.body));
    assert.equal(memberInstall.body['code'], 'HIGH_RISK_PLUGIN_REQUIRES_ADMIN');

    const created = await call('admin', '/marketplaces', { method: 'POST', body: JSON.stringify({ url: `file://${MARKET}`, name: 'Admin market', credential: 'private-repo-token-value' }) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(JSON.stringify(created.body).includes('private-repo-token-value'), false);
    const marketplaces = await call('admin', '/marketplaces');
    assert.equal(JSON.stringify(marketplaces.body).includes('private-repo-token-value'), false);
    assert.ok((marketplaces.body as unknown as Array<{ secretConfigured: boolean }>).some((entry) => entry.secretConfigured));
    const marketId = ((created.body['marketplace'] as { id: string }).id);
    const badRef = await call('admin', `/marketplaces/${marketId}`, { method: 'PATCH', body: JSON.stringify({ ref: '--upload-pack=echo PWN' }) });
    assert.equal(badRef.status, 400, JSON.stringify(badRef.body));
    const outsideFile = await call('admin', '/marketplaces', { method: 'POST', body: JSON.stringify({ url: 'file:///etc', name: 'Outside' }) });
    assert.equal(outsideFile.status, 400, JSON.stringify(outsideFile.body));
    const privateGit = await call('admin', '/marketplaces', { method: 'POST', body: JSON.stringify({ url: 'https://127.0.0.1/repo.git', name: 'Private' }) });
    assert.equal(privateGit.status, 400, JSON.stringify(privateGit.body));

    const secret = await call('admin', '/secrets', { method: 'POST', body: JSON.stringify({ name: 'ADMIN_TOKEN', value: 'admin-secret-value' }) });
    assert.equal(secret.status, 201);
    assert.equal(JSON.stringify(secret.body).includes('admin-secret-value'), false);
    const secrets = await call('admin', '/secrets');
    assert.equal(secrets.status, 200);
    assert.equal(JSON.stringify(secrets.body).includes('admin-secret-value'), false);
    assert.equal((await call('member', '/secrets/key-status')).status, 403);
    const keyStatus = await call('admin', '/secrets/key-status');
    assert.equal(keyStatus.status, 200);
    assert.ok(!JSON.stringify(keyStatus.body).includes('admin-secret-value'));
    const dryRotation = await call('admin', '/secrets/rotate', { method: 'POST', body: JSON.stringify({ dryRun: true }) });
    assert.equal(dryRotation.status, 200, JSON.stringify(dryRotation.body));
    assert.equal(dryRotation.body['dryRun'], true);
    const migration = await call('admin', '/secrets/rotate', { method: 'POST', body: JSON.stringify({ migrateLegacy: true }) });
    assert.equal(migration.status, 200, JSON.stringify(migration.body));
    assert.equal(JSON.stringify(migration.body).includes('admin-secret-value'), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('api: an unauthenticated request is rejected in production mode', { timeout: 20_000 }, async () => {
  const app = express();
  app.use('/api/os', createOsRouter({ production: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/os/extensions`);
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('api: install → assign → enable → execute → mission → disable → uninstall', { timeout: 60_000 }, async () => {
  const app = express();
  app.use('/api/os', createOsRouter({ production: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const ownerToken = issueSessionToken('owneruser', SECRET, 60);

  const api = async (route: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/os${route}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerToken}`, ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = text;
    try { body = JSON.parse(text) as unknown; } catch { /* keep text */ }
    return { status: response.status, body: body as Record<string, unknown> };
  };

  try {
    const summary = await api('/extensions');
    assert.equal(summary.status, 200);
    assert.ok(Number(summary.body['skills']) >= 19, 'the official catalog is seeded with at least 19 skills');
    assert.equal(summary.body['role'], 'owner');

    const packages = await api('/extensions/packages?kind=skill');
    assert.equal(packages.status, 200);
    assert.ok((packages.body as unknown as unknown[]).length >= 19);

    // Owner registers a Git marketplace and synchronizes it.
    const registered = await api('/extensions/marketplaces', { method: 'POST', body: JSON.stringify({ url: `file://${MARKET}`, name: 'API market', autoLoad: true, trust: 'community' }) });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    const marketplaceId = (registered.body['marketplace'] as { id: string }).id;
    const synced = await api(`/extensions/marketplaces/${marketplaceId}/sync`, { method: 'POST' });
    assert.equal(synced.status, 200);

    // Secret write is metadata-only on read and absent from the audit payload.
    const secretWrite = await api('/extensions/secrets', { method: 'POST', body: JSON.stringify({ name: 'TEST_API_TOKEN', value: 'never-return-this-value' }) });
    assert.equal(secretWrite.status, 201);
    const secretRead = await api('/extensions/secrets');
    assert.equal(JSON.stringify(secretRead.body).includes('never-return-this-value'), false);
    const audit = await api('/extensions/audit?limit=100');
    assert.equal(JSON.stringify(audit.body).includes('never-return-this-value'), false);

    // Install the official echo MCP plugin for the generalist agent.
    const agents = await api('/agents');
    const generalist = (agents.body as unknown as Array<{ id: string; specialization: string }>).find((agent) => agent.specialization === 'generalist');
    assert.ok(generalist);
    const echoPackage = (await api('/extensions/packages?kind=plugin&q=echo')).body as unknown as Array<{ id: string; key: string }>;
    const echo = echoPackage.find((pkg) => pkg.key === 'wora.echo-mcp');
    assert.ok(echo);

    const installed = await api(`/extensions/packages/${echo.id}/install`, {
      method: 'POST', body: JSON.stringify({ scope: 'agent', scopeId: generalist.id, approvePermissions: true, autoLoad: true }),
    });
    assert.equal(installed.status, 201, JSON.stringify(installed.body));
    const installationId = (installed.body['installation'] as { id: string }).id;

    const enabled = await api(`/extensions/installations/${installationId}/enable`, { method: 'POST' });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
    assert.equal((enabled.body['health'] as { ok: boolean }).ok, true);

    const capabilities = await api(`/extensions/agents/${generalist.id}/capabilities`);
    assert.equal(capabilities.status, 200);
    const profile = capabilities.body['profile'] as { tools: string[]; plugins: unknown[]; digest: string };
    assert.ok(profile.tools.includes('wora.echo-mcp.echo'));
    assert.equal(profile.plugins.length, 1);

    const executed = await api(`/extensions/agents/${generalist.id}/tools/wora.echo-mcp.echo/execute`, {
      method: 'POST', body: JSON.stringify({ input: { text: 'api-hello' } }),
    });
    assert.equal(executed.status, 200, JSON.stringify(executed.body));
    assert.equal(executed.body['ok'], true);
    assert.equal(((executed.body['output'] as { content?: Array<{ text?: string }> }).content ?? [])[0]?.text, 'api-hello');

    // The generic tool endpoint must not bypass capability authorization.
    const bypass = await api('/tools/wora.echo-mcp.echo/execute', { method: 'POST', body: JSON.stringify({ input: { text: 'bypass' } }) });
    assert.equal(bypass.status, 403);

    // Core tools now require an explicit agent profile and the agent's allowlist.
    const diagnosticsAgent = (agents.body as unknown as Array<{ id: string; specialization: string }>).find((agent) => agent.specialization === 'computer_diagnostics');
    const productAgent = (agents.body as unknown as Array<{ id: string; specialization: string }>).find((agent) => agent.specialization === 'product_manager');
    const qaAgent = (agents.body as unknown as Array<{ id: string; specialization: string }>).find((agent) => agent.specialization === 'qa_engineer');
    assert.ok(diagnosticsAgent && productAgent && qaAgent);
    const noAgent = await api('/tools/system.diagnostics/execute', { method: 'POST', body: JSON.stringify({ input: {} }) });
    assert.equal(noAgent.status, 400);
    const deniedTool = await api('/tools/system.diagnostics/execute', { method: 'POST', body: JSON.stringify({ agentId: productAgent.id, input: {} }) });
    assert.equal(deniedTool.status, 403);
    assert.match(String(deniedTool.body['error']), /not enabled/);
    const allowedTool = await api('/tools/system.diagnostics/execute', { method: 'POST', body: JSON.stringify({ agentId: diagnosticsAgent.id, input: {} }) });
    assert.equal(allowedTool.status, 200, JSON.stringify(allowedTool.body));
    assert.equal(allowedTool.body['ok'], true);
    assert.equal(typeof (allowedTool.body['output'] as Record<string, unknown>)['cpus'], 'number');
    const highRisk = await api('/tools/host.exec/execute', { method: 'POST', body: JSON.stringify({ agentId: qaAgent.id, input: { command: 'node', args: ['--test', 'x'] } }) });
    assert.equal(highRisk.status, 403);

    // The extension execution route must enforce the same high-risk boundary.
    const extensionHighRisk = await api(`/extensions/agents/${qaAgent.id}/tools/host.exec/execute`, {
      method: 'POST', body: JSON.stringify({ input: { command: 'node', args: ['--test', 'x'] } }),
    });
    assert.equal(extensionHighRisk.status, 403, JSON.stringify(extensionHighRisk.body));
    assert.equal(extensionHighRisk.body['code'], 'HIGH_RISK_APPROVAL_REQUIRED');

    // A paused agent must not execute anything through the extension route.
    const paused = await api(`/agents/${diagnosticsAgent.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) });
    assert.equal(paused.status, 200, JSON.stringify(paused.body));
    const inactive = await api(`/extensions/agents/${diagnosticsAgent.id}/tools/system.diagnostics/execute`, {
      method: 'POST', body: JSON.stringify({ input: {} }),
    });
    assert.equal(inactive.status, 403, JSON.stringify(inactive.body));
    assert.equal(inactive.body['code'], 'AGENT_INACTIVE');
    const resumed = await api(`/agents/${diagnosticsAgent.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));

    // A mission uses the same tool under the resolved profile.
    const mission = await api('/missions', { method: 'POST', body: JSON.stringify({ objective: 'run tool wora.echo-mcp.echo with {"text":"mission-http"}' }) });
    assert.equal(mission.status, 202, JSON.stringify(mission.body));
    const missionId = String(mission.body['id']);
    let detail: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const current = await api(`/missions/${missionId}`);
      detail = current.body;
      if (detail['status'] === 'completed' || detail['status'] === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(detail['status'], 'completed', JSON.stringify(detail));
    const tasks = detail['tasks'] as Array<{ status: string; runs: Array<{ evidence: Array<Record<string, unknown>> }> }>;
    assert.equal(tasks[0]?.status, 'completed');
    assert.ok(tasks[0]?.runs[0]?.evidence[0]?.['capabilityDigest']);
    const snapshots = await api(`/extensions/snapshots?missionId=${missionId}`);
    assert.ok((snapshots.body as unknown as unknown[]).length >= 1);

    // Disable: access is revoked immediately.
    const disabled = await api(`/extensions/installations/${installationId}/disable`, { method: 'POST' });
    assert.equal(disabled.status, 200);
    const revoked = await api(`/extensions/agents/${generalist.id}/tools/wora.echo-mcp.echo/execute`, {
      method: 'POST', body: JSON.stringify({ input: { text: 'after-disable' } }),
    });
    assert.equal(revoked.status, 403);

    // Uninstall cleans up the registration.
    const removed = await api(`/extensions/installations/${installationId}`, { method: 'DELETE' });
    assert.equal(removed.status, 204);
    const afterRemoval = await api(`/extensions/agents/${generalist.id}/capabilities`);
    assert.equal(((afterRemoval.body['profile'] as { plugins: unknown[] }).plugins).length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('api: member cannot grant high-risk agent capabilities', { timeout: 30_000 }, async () => {
  const ws = 'wora-memberuser';
  seedBuiltinCatalog(ws);
  setWorkspaceRole(ws, 'memberuser', 'member', 'bootstrap');
  const token = issueSessionToken('memberuser', SECRET, 60);
  const app = express();
  app.use('/api/os', createOsRouter({ production: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const call = async (route: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/os${route}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = text;
    try { body = JSON.parse(text) as unknown; } catch { /* text */ }
    return { status: response.status, body: body as Record<string, unknown> };
  };
  try {
    const highRiskCreate = await call('/agents', {
      method: 'POST', body: JSON.stringify({ name: 'Member QA', role: 'QA', specialization: 'qa_engineer' }),
    });
    assert.equal(highRiskCreate.status, 403, JSON.stringify(highRiskCreate.body));
    assert.equal(highRiskCreate.body['code'], 'HIGH_RISK_CAPABILITY_REQUIRES_ADMIN');
    const lowRiskCreate = await call('/agents', {
      method: 'POST', body: JSON.stringify({ name: 'Member Generalist', role: 'Generalist', specialization: 'generalist' }),
    });
    assert.equal(lowRiskCreate.status, 201, JSON.stringify(lowRiskCreate.body));
    const agentId = String(lowRiskCreate.body['id']);
    const highRiskPatch = await call(`/agents/${agentId}`, {
      method: 'PATCH', body: JSON.stringify({ permissions: ['host:exec'], tools: ['host.exec'] }),
    });
    assert.equal(highRiskPatch.status, 403, JSON.stringify(highRiskPatch.body));
    assert.equal(highRiskPatch.body['code'], 'HIGH_RISK_CAPABILITY_REQUIRES_ADMIN');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('api: manifest validation is exposed and invalid packages are refused', { timeout: 20_000 }, async () => {
  const app = express();
  app.use('/api/os', createOsRouter({ production: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const token = issueSessionToken('owneruser', SECRET, 60);
  const api = async (route: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/os${route}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  try {
    const valid = await api('/extensions/validate', { method: 'POST', body: JSON.stringify({ kind: 'skill', manifest: skill() }) });
    assert.equal(valid.status, 200);
    assert.equal(valid.body['ok'], true);
    assert.ok((valid.body['permissionReview'] as unknown[]).length >= 1);

    const invalid = await api('/extensions/validate', { method: 'POST', body: JSON.stringify({ kind: 'plugin', manifest: { ...httpPlugin({ id: 'test.invalid' }), type: 'mcp', entrypoint: { transport: 'stdio', command: 'bash', args: [], env: [] } } }) });
    assert.equal(invalid.status, 200);
    assert.equal(invalid.body['ok'], false);

    const create = await api('/extensions/packages/create', { method: 'POST', body: JSON.stringify({ kind: 'skill', manifest: skill({ id: 'test.custom-local', name: 'Custom Local' }) }) });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    assert.equal(create.body['key'], 'test.custom-local');
    const duplicate = await api('/extensions/packages/create', { method: 'POST', body: JSON.stringify({ kind: 'skill', manifest: skill({ id: 'test.custom-local', name: 'Custom Local' }) }) });
    assert.equal(duplicate.status, 409);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
