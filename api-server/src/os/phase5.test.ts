/**
 * WORA Phase 5 — unified problem solving and capability composition.
 *
 * These tests execute the real deterministic model, capability registry,
 * Git marketplace, package installation, plugin runtime, orchestrator,
 * governance, verification and persistence layers. No UI state is mocked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-phase5-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['WORA_EXTENSIONS_LOCAL_ROOTS'] = TMP;
process.env['NODE_ENV'] = 'test';
process.env['AUTH_SECRET'] = 'test-secret-0123456789abcdef0123456789abcdef';
process.env['WORA_MCP_STDIO_MODE'] = 'official';
process.env['WORA_MCP_RESOURCE_LIMITS'] = '0';
process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = '1';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { initExtensions } = await import('../extensions/index.js');
const { ensureExtensionSchema } = await import('../extensions/schema.js');
const { registerMarketplace, syncMarketplace } = await import('../extensions/marketplace.js');
const { buildInstallPlan, applyInstallPlan, uninstallPackage } = await import('../extensions/resolver.js');
const { syncInstallationResources } = await import('../extensions/runtime.js');
const { resolveCapabilities } = await import('../extensions/capabilities.js');
const store = await import('../extensions/store.js');
const { updateInstallation, setToolHealth } = await import('../extensions/store.js');
const { ensureSeedAgents, listAgents } = await import('./registry.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { modelProblem } = await import('./problem-model.js');
const { composeMissionPlan, getComposition } = await import('./capability-composition.js');
const { issueSessionToken } = await import('../lib/session.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS = 'wora-phase5';
const GAP_WS = 'wora-phase5-gap';
const MARKET = path.join(TMP, 'marketplace');
const installs: Record<string, string> = {};
let businessId = '';
let httpServer: Server | null = null;
let httpPort = 0;

function git(args: string[], cwd = MARKET): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writePackage(relative: string, value: unknown): void {
  const file = path.join(MARKET, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function skillManifest() {
  return {
    schema_version: '1.0',
    id: 'test.requirements',
    name: 'Requirements Analysis',
    version: '1.0.0',
    type: 'knowledge',
    description: 'A real test skill for tracing requirements, constraints and open questions.',
    author: 'WORA Tests',
    category: 'testing',
    tags: ['requirements', 'analysis'],
    capabilities: ['requirements'],
    permissions: ['memory:read'],
    scope: ['instance', 'agent', 'project'],
    dependencies: [],
    auto_load: true,
    instructions: '# Requirements Analysis\n\nRead the objective, separate stated facts from assumptions, and record open questions before any capability executes. Never invent a requirement.',
    requirements: { tools: ['text.extract_summary'], permissions: ['memory:read'], secrets: [] },
    verification: ['Every requirement is traceable to the objective'],
    failure_handling: 'Report the missing requirement instead of guessing.',
    handoff: 'Pass the structured requirements to the next capability.',
  };
}

function httpPlugin(id: string, name: string, pathName: string) {
  return {
    schema_version: '1.0',
    id,
    name,
    version: '1.0.0',
    type: 'http',
    description: id.includes('primary')
      ? 'Real local HTTP primary echo plugin used to test composition and an intentional execution failure.'
      : 'Real local HTTP fallback echo plugin used only as a schema-compatible replacement.',
    author: 'WORA Tests',
    category: 'testing',
    tags: ['echo', 'integration'],
    capabilities: ['echo'],
    permissions: [],
    scope: ['instance', 'agent'],
    dependencies: [],
    entrypoint: { transport: 'http', url: `http://127.0.0.1:${httpPort}`, args: [], env: [] },
    required_secrets: [],
    configuration: {},
    tools: [{
      id: 'echo', name: `${name} Echo`, description: 'Echoes the input text with a deterministic marker.',
      input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      permissions: [], timeout_ms: 5_000, risk: 'low', path: pathName, method: 'POST',
    }],
    health: { type: 'http', path: '/health', timeout_ms: 2_000 },
    security: { risk_level: 'low', network: true, data_access: [] },
  };
}

function installPackage(packageId: string, agentId: string): string {
  const plan = buildInstallPlan({ workspaceId: WS, packageId, scope: 'agent', scopeId: agentId });
  assert.equal(plan.canInstall, true, JSON.stringify(plan.conflicts));
  const installation = applyInstallPlan({ workspaceId: WS, plan, actor: 'phase5-test', approvePermissions: true });
  syncInstallationResources(WS, installation.id);
  return installation.id;
}

test.before(async () => {
  httpServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/fail') {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: 'intentional primary failure' }));
        return;
      }
      if (req.url === '/echo') {
        const parsed = JSON.parse(body || '{}') as { text?: unknown };
        res.end(JSON.stringify({ ok: true, text: parsed.text ?? '', source: 'fallback' }));
        return;
      }
      res.end(JSON.stringify({ ok: true, status: 'healthy' }));
    });
  });
  await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  httpPort = typeof address === 'object' && address ? address.port : 0;

  mkdirSync(MARKET, { recursive: true });
  git(['init', '--quiet']);
  git(['config', 'user.email', 'tests@wora.local']);
  git(['config', 'user.name', 'WORA Tests']);
  git(['config', 'commit.gpgsign', 'false']);
  writePackage('wora/skills/test-requirements/skill.json', skillManifest());
  writePackage('wora/plugins/test-aaa-primary/plugin.json', httpPlugin('test.aaa-primary', 'Primary Echo', '/fail'));
  writePackage('wora/plugins/test-zzz-fallback/plugin.json', httpPlugin('test.zzz-fallback', 'Fallback Echo', '/echo'));
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'phase5 test marketplace']);
  git(['branch', '-M', 'main']);

  ensureExtensionSchema();
  initExtensions();
  ensureSeedAgents(WS);
  ensureSeedAgents(GAP_WS);
  businessId = listAgents(WS).find((agent) => agent.specialization === 'business_analyst')!.id;
  const { marketplace } = await registerMarketplace({
    workspaceId: WS, name: 'Phase 5 test marketplace', url: `file://${MARKET}`, ref: 'main', refType: 'branch',
    trust: 'verified', actor: 'phase5-test', autoLoad: true,
  });
  await syncMarketplace(WS, marketplace.id, 'phase5-test');
  const skill = store.findPackageByKey(WS, 'skill', 'test.requirements')!;
  const primary = store.findPackageByKey(WS, 'plugin', 'test.aaa-primary')!;
  const fallback = store.findPackageByKey(WS, 'plugin', 'test.zzz-fallback')!;
  installs['skill'] = installPackage(skill.id, businessId);
  installs['primary'] = installPackage(primary.id, businessId);
  installs['fallback'] = installPackage(fallback.id, businessId);
  setExecutionLimits(WS, { maxAttempts: 1 }, 'phase5-test');
});

test.after(() => {
  httpServer?.close();
  rmSync(TMP, { recursive: true, force: true });
});

test('Phase 5 A — unified model separates stated facts, assumptions and unknowns', () => {
  const model = modelProblem({ workspaceId: WS, objective: 'Analyze requirements and echo the result through the plugin integration.' });
  assert.equal(model.schemaVersion, '1.0');
  assert.ok(model.facts.length >= 1);
  assert.ok(model.facts.every((fact) => fact.provenance === 'user-objective' && fact.confidence === 1));
  assert.ok(model.assumptions.every((assumption) => assumption.provenance === 'assumption'));
  assert.ok(model.provenance.includes('objective:user-provided'));
  assert.ok(model.needs.includes('integration'));
  assert.ok(model.needs.includes('verification'));
  assert.ok(model.desiredOutcome.length > 0);
});

test('Phase 5 B — composition uses only approved capabilities and names compatible fallbacks', () => {
  const composed = composeMissionPlan({
    workspaceId: WS,
    objective: 'Analyze requirements and echo the result through the plugin integration, then compute descriptive statistics for [12, 15, 11, 18, 14, 13, 16].',
    track: 'composite',
  });
  assert.ok(composed.graph.nodes.some((node) => node.tool === 'text.extract_summary'));
  assert.ok(composed.graph.nodes.some((node) => node.tool === 'test.aaa-primary.echo'));
  assert.ok(composed.graph.nodes.some((node) => node.tool === 'stats.describe'));
  const pluginNode = composed.graph.nodes.find((node) => node.tool === 'test.aaa-primary.echo')!;
  assert.ok(pluginNode.fallbackTools.includes('test.zzz-fallback.echo'));
  assert.ok(pluginNode.permissions.every((permission) => pluginNode.permissionsApproved.includes(permission)));
  assert.equal(composed.strategy.selected?.id, 'full-composition');
  assert.ok(composed.strategy.candidates.length >= 2);
  assert.ok(composed.strategy.explanation.includes('Selected'));
  assert.ok(composed.tasks.some((task) => task.tool === 'test.aaa-primary.echo' && task.fallbackTools?.includes('test.zzz-fallback.echo')));

  const withoutData = composeMissionPlan({ workspaceId: WS, objective: 'Compute descriptive statistics for the result.', track: 'composite' });
  assert.ok(!withoutData.graph.nodes.some((node) => node.tool === 'stats.describe'), 'statistics are not run on invented sample data');
  assert.ok(withoutData.graph.gaps.some((gap) => gap.missing.includes('statistics')));
});

test('Phase 5 C — a composite mission loads the skill, executes core and plugin tools, and records evidence', { timeout: 60_000 }, async () => {
  const missionId = createMission({
    workspaceId: WS,
    objective: 'Analyze requirements and echo the result through the plugin integration, then compute descriptive statistics for [12, 15, 11, 18, 14, 13, 16].',
    track: 'composite', actor: 'phase5-test',
  });
  await executeMission(missionId, 'phase5-test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.ok(detail.problemModel);
  assert.ok(detail.composition);
  assert.equal(detail.composition!.selectedStrategy, 'full-composition');
  assert.ok(detail.tasks.some((task) => task.tool === 'text.extract_summary' && task.status === 'completed'));
  assert.ok(detail.tasks.some((task) => task.tool === 'stats.describe' && task.status === 'completed'));
  assert.ok(detail.tasks.some((task) => task.tool?.startsWith('test.') && task.status === 'completed'));
  assert.ok(detail.skillContexts.some((context) => context.selected.some((selected) => selected.key === 'test.requirements')));
  assert.ok(detail.decisions.some((decision) => decision.kind === 'composition-strategy'));
  assert.ok(detail.verifications.some((verification) => verification.result === 'passed'));
  const pluginTask = detail.tasks.find((task) => task.tool?.startsWith('test.') && task.status === 'completed')!;
  const completedRun = pluginTask.runs.find((run) => run.status === 'completed')!;
  const output = (completedRun.evidence[0] as unknown as { output?: Record<string, unknown> }).output;
  assert.equal(output?.['ok'], true);
});

test('Phase 5 D — a failed capability is replaced only by a compatible, authorized fallback', { timeout: 60_000 }, async () => {
  setToolHealth(WS, 'test.aaa-primary.echo', 'healthy');
  const missionId = createMission({
    workspaceId: WS,
    objective: 'Echo the plugin integration result through the primary plugin path.',
    track: 'composite', actor: 'phase5-test',
  });
  await executeMission(missionId, 'phase5-test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  const replacement = detail.decisions.find((decision) => decision.kind === 'capability-replacement');
  assert.ok(replacement, 'a replacement decision must be recorded');
  assert.equal((replacement!.payload as Record<string, unknown>)['fromTool'], 'test.aaa-primary.echo');
  assert.equal((replacement!.payload as Record<string, unknown>)['toTool'], 'test.zzz-fallback.echo');
  assert.equal((replacement!.payload as Record<string, unknown>)['inputSchemaEquivalent'], true);
  assert.equal((replacement!.payload as Record<string, unknown>)['outputSchemaEquivalent'], true);
  const task = detail.tasks.find((entry) => entry.tool === 'test.zzz-fallback.echo');
  assert.ok(task && task.status === 'completed', 'the compatible fallback completed the task');
  assert.equal(detail.verifications.filter((verification) => verification.result === 'passed').length >= 1, true);
});

test('Phase 5 E — a missing integration is reported as a gap, never fabricated', { timeout: 30_000 }, async () => {
  const composed = composeMissionPlan({
    workspaceId: GAP_WS,
    objective: 'Analyze requirements and echo the result through a missing plugin integration.',
    track: 'composite',
  });
  assert.ok(composed.graph.gaps.some((gap) => gap.missing.includes('integration')));
  assert.ok(composed.tasks.some((task) => task.title === 'Report the capability gap honestly'));
  assert.ok(!composed.graph.nodes.some((node) => node.capabilityKind === 'plugin'));
  const missionId = createMission({
    workspaceId: GAP_WS,
    objective: 'Analyze requirements and echo the result through a missing plugin integration.',
    track: 'composite', actor: 'phase5-test',
  });
  await executeMission(missionId, 'phase5-test');
  const detail = getMissionDetail(GAP_WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.ok(detail.composition?.gaps.some((gap) => gap.missing.includes('integration')));
  assert.ok(detail.tasks.some((task) => task.detail.includes('composition-gap')));
  assert.ok(!detail.tasks.some((task) => task.tool?.startsWith('test.')), 'no unapproved plugin tool was invoked');
});

test('Phase 5 F — disabling and uninstalling a plugin revokes access and cleans registrations', () => {
  updateInstallation(WS, installs['primary']!, { enabled: false }, 'phase5-test');
  updateInstallation(WS, installs['fallback']!, { enabled: false }, 'phase5-test');
  const profile = resolveCapabilities(WS, businessId);
  assert.ok(!profile.tools.includes('test.aaa-primary.echo'));
  assert.ok(!profile.tools.includes('test.zzz-fallback.echo'));
  assert.ok(profile.blocked.some((entry) => entry.key === 'test.aaa-primary' && /disabled/.test(entry.reason)));
  const composed = composeMissionPlan({ workspaceId: WS, objective: 'Echo the plugin integration result.', track: 'composite' });
  assert.ok(composed.graph.gaps.some((gap) => gap.missing.includes('integration')));
  assert.ok(!composed.tasks.some((task) => task.tool?.startsWith('test.')));
  assert.equal(uninstallPackage(WS, installs['fallback']!, 'phase5-test'), true);
  assert.equal(store.listRegisteredTools(WS).some((tool) => tool.toolId === 'test.zzz-fallback.echo'), false);
  assert.equal(getComposition(WS, 'missing-mission'), null);
});

test('Phase 5 G — problem and composition APIs enforce session auth and return real data', { timeout: 30_000 }, async () => {
  ensureSeedAgents('wora-apiuser');
  const app = express();
  app.use('/api/os', createOsRouter({ production: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const token = issueSessionToken('apiuser', process.env['AUTH_SECRET']!, 60);
  const call = async (route: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/os${route}`, {
      ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = text;
    try { body = JSON.parse(text) as unknown; } catch { /* keep text */ }
    return { status: response.status, body: body as Record<string, unknown> };
  };
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/os/problems/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objective: 'Analyze requirements' }) });
    assert.equal(unauthorized.status, 401);
    const analyzed = await call('/problems/analyze', { method: 'POST', body: JSON.stringify({ objective: 'Analyze requirements and echo the result through a plugin integration.' }) });
    assert.equal(analyzed.status, 200);
    assert.equal(analyzed.body['schemaVersion'], '1.0');
    assert.ok(Array.isArray(analyzed.body['facts']));
    assert.ok((analyzed.body['needs'] as string[]).includes('integration'));
    const composed = await call('/problems/compose', { method: 'POST', body: JSON.stringify({ objective: 'Analyze requirements and echo the result through a plugin integration.', track: 'composite' }) });
    assert.equal(composed.status, 200);
    assert.ok(Array.isArray((composed.body['graph'] as Record<string, unknown>)['nodes']));
    assert.ok((composed.body['strategy'] as Record<string, unknown>)['selected'] !== undefined);
    assert.ok(Array.isArray(composed.body['tasks']));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
