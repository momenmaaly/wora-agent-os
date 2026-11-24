/**
 * WORA Phase 6 — autonomous validation and reliability.
 *
 * These tests use real SQLite, a real local Git marketplace, real HTTP plugin
 * fixtures, the real orchestrator and the real verification/outcome path.
 * Fixtures are explicitly labelled; no production fake agents or tools exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-phase6-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['WORA_EXTENSIONS_LOCAL_ROOTS'] = TMP;
process.env['NODE_ENV'] = 'test';
process.env['AUTH_SECRET'] = 'test-secret-0123456789abcdef0123456789abcdef';
process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = '1';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { initExtensions } = await import('../extensions/index.js');
const { ensureExtensionSchema } = await import('../extensions/schema.js');
const { registerMarketplace, syncMarketplace } = await import('../extensions/marketplace.js');
const { buildInstallPlan, applyInstallPlan } = await import('../extensions/resolver.js');
const { syncInstallationResources } = await import('../extensions/runtime.js');
const store = await import('../extensions/store.js');
const { ensureSeedAgents, listAgents } = await import('./registry.js');
const { setExecutionLimits } = await import('./task-queue.js');
const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { getOsDb } = await import('./db.js');
const { getComposition } = await import('./capability-composition.js');
const { listMissionApprovals, decideApproval } = await import('./governance.js');
const { semanticContractFor, compareSemanticContracts } = await import('./semantic-contracts.js');
const { evaluatePhase6Scenarios, evaluateHeldOutScenarios } = await import('./evaluation-framework.js');
const { issueSessionToken } = await import('../lib/session.js');
const { createOsRouter } = await import('./router.js');
const express = (await import('express')).default;

const WS_SUCCESS = 'wora-phase6-success';
const WS_FAIL = 'wora-phase6-fail';
const MARKET = path.join(TMP, 'marketplace');
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

function semanticEchoContract() {
  return {
    schemaVersion: '1.0', id: 'test.echo.v1', version: '1.0.0',
    inputMeaning: 'UTF-8 text to echo', outputMeaning: 'The same UTF-8 text with an execution marker',
    inputUnits: { text: 'utf8-text' }, outputUnits: { text: 'utf8-text' },
    inputTypes: { text: 'string' }, outputTypes: { ok: 'boolean', text: 'string' },
    preconditions: ['text is present'], postconditions: ['returned text equals the supplied text'],
    sideEffects: 'none', deterministic: true, precision: { kind: 'exact' },
    errorBehavior: 'returns an execution error instead of fabricating text',
    security: { dataClasses: ['workspace-content'], network: true, requiredPermissions: [], maxRisk: 'low' },
    verification: ['output-contract', 'output-quality', 'secret-leak'],
    resource: { costClass: 'low', latencyClass: 'low' }, evidence: ['phase6 local HTTP fixture'], confidence: 0.9,
  };
}

function incompatibleManifest() {
  const manifest = pluginManifest('test.phase6-incompatible', 'Phase 6 Incompatible Currency', '/echo');
  const contract = semanticEchoContract();
  contract.id = 'test.currency.v1';
  contract.inputUnits = { text: 'currency' };
  contract.outputUnits = { text: 'currency' };
  contract.outputMeaning = 'A converted currency amount';
  manifest.tools[0]!.semantic_contract = contract;
  return manifest;
}

function skillManifest() {
  return {
    schema_version: '1.0', id: 'test.phase6.requirements', name: 'Phase 6 Requirements', version: '1.0.0',
    type: 'knowledge', description: 'Separates facts, assumptions and unknowns before execution.', author: 'WORA Tests',
    category: 'testing', tags: ['requirements', 'evidence'], capabilities: ['requirements'], permissions: ['memory:read'],
    scope: ['instance', 'agent'], dependencies: [], auto_load: true,
    instructions: 'Record stated facts separately from assumptions. Never invent missing evidence.',
    requirements: { tools: ['text.extract_summary'], permissions: ['memory:read'], secrets: [] },
    verification: ['Every claim is traceable'], failure_handling: 'Report the gap.', handoff: 'Pass structured evidence.',
  };
}

function pluginManifest(id: string, name: string, pathName: string) {
  return {
    schema_version: '1.0', id, name, version: '1.0.0', type: 'http',
    description: 'Real local HTTP echo plugin fixture used to test data dependencies, fallback and outcome verification.',
    author: 'WORA Tests', category: 'testing', tags: ['echo', 'integration'], capabilities: ['echo'], permissions: [],
    scope: ['instance', 'agent'], dependencies: [],
    entrypoint: { transport: 'http', url: `http://127.0.0.1:${httpPort}`, args: [], env: [] },
    required_secrets: [], configuration: {},
    tools: [{
      id: 'echo', name: `${name} Echo`, description: 'Echoes the supplied text; fails only when it contains FORCE_FAIL.',
      input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      semantic_contract: semanticEchoContract(), permissions: [], timeout_ms: 5_000, risk: 'low', path: pathName, method: 'POST',
    }],
    health: { type: 'http', path: '/health', timeout_ms: 2_000 },
    security: { risk_level: 'low', network: true, data_access: [] },
  };
}

function installPackage(workspaceId: string, packageId: string, agentId: string): string {
  const plan = buildInstallPlan({ workspaceId, packageId, scope: 'agent', scopeId: agentId });
  assert.equal(plan.canInstall, true, JSON.stringify(plan.conflicts));
  const installation = applyInstallPlan({ workspaceId, plan, actor: 'phase6-test', approvePermissions: true });
  syncInstallationResources(workspaceId, installation.id);
  return installation.id;
}

function runOutput(task: { runs: Array<{ status?: unknown; evidence?: unknown }> }): Record<string, unknown> {
  const run = task.runs.find((entry) => entry.status === 'completed');
  assert.ok(run, 'a completed run exists');
  const evidence = Array.isArray(run!.evidence) ? run!.evidence as Array<Record<string, unknown>> : [];
  const entry = evidence.find((item) => item['output'] !== undefined);
  assert.ok(entry, 'completed evidence contains the actual output');
  return entry!['output'] as Record<string, unknown>;
}

test.before(async () => {
  httpServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') { res.end(JSON.stringify({ ok: true })); return; }
      const parsed = JSON.parse(body || '{}') as { text?: unknown };
      const text = typeof parsed.text === 'string' ? parsed.text : '';
      if (req.url === '/fail' || text.includes('FORCE_FAIL') && req.url !== '/echo') {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: 'intentional phase6 primary failure' }));
        return;
      }
      res.end(JSON.stringify({ ok: true, text, source: 'phase6-fixture' }));
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
  writePackage('wora/skills/phase6-requirements/skill.json', skillManifest());
  writePackage('wora/plugins/phase6-primary/plugin.json', pluginManifest('test.phase6-primary', 'Phase 6 Primary', '/fail'));
  writePackage('wora/plugins/phase6-fallback/plugin.json', pluginManifest('test.phase6-fallback', 'Phase 6 Fallback', '/fail'));
  writePackage('wora/plugins/phase6-recovery/plugin.json', pluginManifest('test.phase6-recovery', 'Phase 6 Recovery', '/echo'));
  writePackage('wora/plugins/phase6-incompatible/plugin.json', incompatibleManifest());
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'phase6 test marketplace']);
  git(['branch', '-M', 'main']);

  ensureExtensionSchema();
  initExtensions();
  ensureSeedAgents(WS_SUCCESS);
  ensureSeedAgents(WS_FAIL);
  businessId = listAgents(WS_SUCCESS).find((agent) => agent.specialization === 'business_analyst')!.id;
  const failAgent = listAgents(WS_FAIL).find((agent) => agent.specialization === 'business_analyst')!.id;
  const { marketplace } = await registerMarketplace({
    workspaceId: WS_SUCCESS, name: 'Phase 6 test marketplace', url: `file://${MARKET}`, ref: 'main', refType: 'branch',
    trust: 'verified', actor: 'phase6-test', autoLoad: true,
  });
  await syncMarketplace(WS_SUCCESS, marketplace.id, 'phase6-test');
  const { marketplace: failMarketplace } = await registerMarketplace({
    workspaceId: WS_FAIL, name: 'Phase 6 failure marketplace', url: `file://${MARKET}`, ref: 'main', refType: 'branch',
    trust: 'verified', actor: 'phase6-test', autoLoad: true,
  });
  await syncMarketplace(WS_FAIL, failMarketplace.id, 'phase6-test');
  const skill = store.findPackageByKey(WS_SUCCESS, 'skill', 'test.phase6.requirements')!;
  const primary = store.findPackageByKey(WS_SUCCESS, 'plugin', 'test.phase6-primary')!;
  const fallback = store.findPackageByKey(WS_SUCCESS, 'plugin', 'test.phase6-fallback')!;
  const recovery = store.findPackageByKey(WS_SUCCESS, 'plugin', 'test.phase6-recovery')!;
  installPackage(WS_SUCCESS, skill.id, businessId);
  installPackage(WS_SUCCESS, recovery.id, businessId);
  const failSkill = store.findPackageByKey(WS_FAIL, 'skill', 'test.phase6.requirements')!;
  const failPrimary = store.findPackageByKey(WS_FAIL, 'plugin', 'test.phase6-primary')!;
  const failFallback = store.findPackageByKey(WS_FAIL, 'plugin', 'test.phase6-fallback')!;
  const failRecovery = store.findPackageByKey(WS_FAIL, 'plugin', 'test.phase6-recovery')!;
  const incompatible = store.findPackageByKey(WS_FAIL, 'plugin', 'test.phase6-incompatible')!;
  installPackage(WS_FAIL, failSkill.id, failAgent);
  installPackage(WS_FAIL, failPrimary.id, failAgent);
  installPackage(WS_FAIL, failFallback.id, failAgent);
  installPackage(WS_FAIL, failRecovery.id, failAgent);
  installPackage(WS_FAIL, incompatible.id, failAgent);
  setExecutionLimits(WS_SUCCESS, { maxAttempts: 1 }, 'phase6-test');
  setExecutionLimits(WS_FAIL, { maxAttempts: 1 }, 'phase6-test');
});

test.after(() => {
  httpServer?.close();
  rmSync(TMP, { recursive: true, force: true });
});

test('Phase 6 A — multi-capability mission passes real upstream output into a plugin and verifies the outcome', { timeout: 30_000 }, async () => {
  const objective = 'Analyze requirements and echo the result through the plugin integration. The result must be auditable. Compute descriptive statistics for [12, 15, 11, 18, 14, 13, 16]. Do not invent missing data.';
  const missionId = createMission({ workspaceId: WS_SUCCESS, objective, track: 'composite', actor: 'phase6-test' });
  await executeMission(missionId, 'phase6-test');
  const detail = getMissionDetail(WS_SUCCESS, missionId)!;
  assert.equal(detail.status, 'completed', detail.summary);
  assert.equal(detail.outcomeStatus, 'verified', JSON.stringify(detail.outcomeVerification));
  const context = detail.tasks.find((task) => task.tool === 'text.extract_summary')!;
  const plugin = detail.tasks.find((task) => task.tool === 'test.phase6-recovery.echo')!;
  const stats = detail.tasks.find((task) => task.tool === 'stats.describe')!;
  assert.ok(context && plugin && stats, `three real capability types executed: ${detail.tasks.map((task) => task.tool).join(', ')}`);
  assert.equal(context.status, 'completed');
  assert.equal(plugin.status, 'completed');
  assert.equal(stats.status, 'completed');
  assert.equal(plugin.inputBindings.length, 1);
  const contextOutput = runOutput(context);
  const pluginOutput = runOutput(plugin);
  assert.equal(pluginOutput['text'], contextOutput['summary']);
  assert.notEqual(pluginOutput['text'], objective);
  assert.equal(runOutput(stats)['count'], 7);
  const composition = getComposition(WS_SUCCESS, missionId)!;
  assert.equal(composition.gaps.length, 0);
  assert.ok(composition.graph.edges.length >= 2);
});

test('Phase 6 B — a failed plugin is replaced only after semantic compatibility, preserving upstream evidence', { timeout: 30_000 }, async () => {
  const objective = 'FORCE_FAIL analyze requirements and echo the result through the plugin integration.';
  const missionId = createMission({ workspaceId: WS_FAIL, objective, track: 'composite', actor: 'phase6-test' });
  const created = getMissionDetail(WS_FAIL, missionId)!;
  const pluginTask = created.tasks.find((task) => (task.tool ?? '').includes('echo'));
  assert.ok(pluginTask, 'composition selected a plugin');
  getOsDb().prepare('UPDATE os_tasks SET tool = ?, fallback_tools = ? WHERE id = ?')
    .run('test.phase6-primary.echo', JSON.stringify(['test.phase6-fallback.echo', 'test.phase6-recovery.echo']), pluginTask!.id);
  await executeMission(missionId, 'phase6-test');
  const detail = getMissionDetail(WS_FAIL, missionId)!;
  assert.equal(detail.status, 'completed', detail.summary);
  assert.equal(detail.outcomeStatus, 'verified', JSON.stringify(detail.outcomeVerification));
  const context = detail.tasks.find((task) => task.tool === 'text.extract_summary')!;
  const fallback = detail.tasks.find((task) => task.tool === 'test.phase6-recovery.echo')!;
  assert.equal(context.status, 'completed');
  assert.ok(fallback, 'fallback replaced the failed primary');
  assert.equal(fallback.status, 'completed');
  assert.equal(fallback.inputBindings.length, 1);
  assert.equal(runOutput(fallback)['text'], runOutput(context)['summary']);
  const decision = detail.decisions.find((entry) => entry.kind === 'capability-replacement');
  assert.ok(decision, 'replacement decision recorded');
  assert.ok(JSON.stringify(decision.payload).includes('semanticCompatible'));
});

test('Phase 6 C — a missing capability is reported as a gap and never marked fully verified', { timeout: 30_000 }, async () => {
  const objective = 'Prove the payment protocol is correct with SMT formal verification and a model checker. No such solver is installed.';
  const missionId = createMission({ workspaceId: WS_SUCCESS, objective, track: 'composite', actor: 'phase6-test' });
  await executeMission(missionId, 'phase6-test');
  const detail = getMissionDetail(WS_SUCCESS, missionId)!;
  assert.equal(detail.status, 'completed', detail.summary);
  assert.equal(detail.outcomeStatus, 'partially_verified', JSON.stringify(detail.outcomeVerification));
  const composition = getComposition(WS_SUCCESS, missionId)!;
  assert.ok(composition.gaps.some((gap) => gap.missing.includes('formal_verification')));
  assert.ok(detail.outcomeVerification?.reasons.some((reason) => /capability-gap|formal_verification/u.test(reason)));
  assert.ok(!detail.tasks.some((task) => /smt|model.?checker|proof/iu.test(task.tool ?? '')));
});

test('Phase 6 D — a protected action waits for a valid approval and records the outcome', { timeout: 60_000 }, async () => {
  const missionId = createMission({ workspaceId: WS_SUCCESS, objective: 'Build a working web application for a small team task board', actor: 'phase6-test' });
  await executeMission(missionId, 'phase6-test');
  let detail = getMissionDetail(WS_SUCCESS, missionId)!;
  assert.equal(detail.status, 'awaiting_approval');
  const pending = listMissionApprovals(WS_SUCCESS, missionId).find((approval) => approval.status === 'pending');
  assert.ok(pending, 'a protected action created a pending approval');
  assert.equal(detail.tasks.find((task) => task.tool === 'host.exec')?.runs.length ?? 0, 0, 'protected tool did not run before approval');
  decideApproval(WS_SUCCESS, pending!.id, 'approved', 'phase6 explicit human approval', 'reviewer');
  await executeMission(missionId, 'phase6-test');
  detail = getMissionDetail(WS_SUCCESS, missionId)!;
  assert.equal(detail.status, 'completed', detail.summary);
  assert.equal(detail.tasks.find((task) => task.tool === 'host.exec')?.status, 'completed');
  assert.ok(detail.approvals.some((approval) => approval.id === pending!.id && approval.consumedAt));
  assert.ok(['verified', 'partially_verified'].includes(detail.outcomeStatus));
});

test('Phase 6 E — semantic contracts reject unit, currency, side-effect, permission and precision lookalikes', () => {
  const base = semanticContractFor('stats.describe')!;
  const clone = () => JSON.parse(JSON.stringify(base)) as typeof base;
  assert.equal(compareSemanticContracts(base, clone()).compatible, true);
  const cases: Array<[string, (value: typeof base) => void, string]> = [
    ['different semantic id', (value) => { value.id = 'stats.currency.v1'; }, 'semantic-identity'],
    ['different currency/units', (value) => { value.inputUnits.series = 'currency'; }, 'input-units'],
    ['different output meaning', (value) => { value.outputMeaning = 'Currency conversion result'; }, 'output-meaning'],
    ['different side effect', (value) => { value.sideEffects = 'external_write'; }, 'side-effects'],
    ['extra permission', (value) => { value.security.requiredPermissions = ['secrets:read']; }, 'permissions'],
    ['weaker precision', (value) => { value.precision = { kind: 'unknown' }; }, 'precision'],
    ['missing verification', (value) => { value.verification = ['output-contract']; }, 'verification'],
    ['non-deterministic', (value) => { value.deterministic = false; }, 'determinism'],
    ['insufficient evidence', (value) => { value.confidence = 0.2; }, 'evidence-confidence'],
  ];
  for (const [label, mutate, expectedCheck] of cases) {
    const candidate = clone();
    mutate(candidate);
    const result = compareSemanticContracts(base, candidate);
    assert.equal(result.compatible, false, label);
    assert.ok(result.checks.some((check) => check.id === expectedCheck && check.status === 'failed'), `${label} failed ${expectedCheck}`);
  }
});

test('Phase 6 F — evaluation framework records reproducible development and held-out results', () => {
  const development = evaluatePhase6Scenarios();
  const heldOut = evaluateHeldOutScenarios();
  assert.equal(development.totals.scenarios, 13);
  assert.equal(heldOut.totals.scenarios, 4);
  assert.ok(development.totals.domainAccuracy >= 0.8, JSON.stringify(development.totals));
  assert.ok(development.totals.approvedOnly === 1);
  assert.ok(development.totals.dependencyOrdering === 1);
  assert.ok(development.totals.estimatedToolCalls > 0);
  assert.ok(heldOut.totals.scenarios === 4);
  // Held-out results are reported as-is; this assertion records the observed
  // pass count rather than changing the implementation to fit the scenarios.
  assert.ok(heldOut.totals.passed >= 3, JSON.stringify(heldOut.totals));
});

test('Phase 6 G — an optimization mission executes a real solver and independently verifies feasibility', { timeout: 30_000 }, async () => {
  const missionId = createMission({ workspaceId: WS_SUCCESS, objective: 'Optimize the allocation of 20 employees across 5 shifts respecting availability and minimizing labor cost', actor: 'phase6-test' });
  await executeMission(missionId, 'phase6-test');
  const detail = getMissionDetail(WS_SUCCESS, missionId)!;
  assert.equal(detail.status, 'completed', detail.summary);
  assert.equal(detail.outcomeStatus, 'verified', JSON.stringify(detail.outcomeVerification));
  const solver = detail.tasks.find((task) => task.tool === 'or.employee_schedule');
  assert.ok(solver, 'the real employee-schedule solver executed');
  assert.equal(solver!.status, 'completed');
  assert.equal(runOutput(solver!)['feasible'], true);
  assert.ok(detail.verifications.some((verification) => verification.checks.some((check) => check.id === 'property-schedule' && check.status === 'passed')));
  assert.ok(detail.outcomeVerification?.checks.some((check) => check.id.endsWith('-outcome') && check.status === 'passed'));
});

test('Phase 6 H — an incompatible semantic fallback is refused and the gap is recorded', { timeout: 30_000 }, async () => {
  const objective = 'Analyze requirements and echo the result through the plugin integration.';
  const missionId = createMission({ workspaceId: WS_FAIL, objective, track: 'composite', actor: 'phase6-test' });
  const created = getMissionDetail(WS_FAIL, missionId)!;
  const pluginTask = created.tasks.find((task) => (task.tool ?? '').includes('echo'))!;
  getOsDb().prepare('UPDATE os_tasks SET tool = ?, fallback_tools = ? WHERE id = ?')
    .run('test.phase6-primary.echo', JSON.stringify(['test.phase6-incompatible.echo']), pluginTask.id);
  await executeMission(missionId, 'phase6-test');
  const detail = getMissionDetail(WS_FAIL, missionId)!;
  assert.equal(detail.status, 'failed', detail.summary);
  const task = detail.tasks.find((entry) => entry.id === pluginTask.id)!;
  assert.equal(task.tool, 'test.phase6-primary.echo', 'the incompatible tool was not substituted');
  assert.equal(task.status, 'failed');
  const gap = detail.decisions.find((entry) => entry.kind === 'capability-replacement-gap');
  assert.ok(gap, 'replacement gap recorded');
  assert.ok(JSON.stringify(gap!.payload).includes('semantic compatibility'));
});

test('Phase 6 I — a missing upstream output blocks the dependent task instead of running it with stale input', { timeout: 30_000 }, async () => {
  const objective = 'Analyze requirements and echo the result through the plugin integration.';
  const missionId = createMission({ workspaceId: WS_SUCCESS, objective, track: 'composite', actor: 'phase6-test' });
  const created = getMissionDetail(WS_SUCCESS, missionId)!;
  const context = created.tasks.find((task) => task.tool === 'text.extract_summary')!;
  const plugin = created.tasks.find((task) => (task.tool ?? '').includes('echo'))!;
  getOsDb().prepare('UPDATE os_tasks SET status = ? WHERE id = ?').run('completed', context.id);
  getOsDb().prepare('UPDATE os_tasks SET input_bindings = ? WHERE id = ?').run(JSON.stringify([{ key: 'text', taskIndex: 0, path: ['summary'] }]), plugin.id);
  await executeMission(missionId, 'phase6-test');
  const detail = getMissionDetail(WS_SUCCESS, missionId)!;
  const blocked = detail.tasks.find((task) => task.id === plugin.id)!;
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.detail, /input_binding_failed/u);
  assert.equal(detail.status, 'failed');
});

test('Phase 6 J — the outcome endpoint is authenticated and returns the persisted verification', { timeout: 30_000 }, async () => {
  const apiWs = 'wora-owneruser';
  ensureSeedAgents(apiWs);
  const missionId = createMission({ workspaceId: apiWs, objective: 'Compute descriptive statistics for [3, 4, 5, 6]', actor: 'phase6-test' });
  await executeMission(missionId, 'phase6-test');
  const app = express();
  app.use('/api/os', createOsRouter({ production: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const anonymous = await fetch(`http://127.0.0.1:${port}/api/os/missions/${missionId}/outcome`);
    assert.equal(anonymous.status, 401);
    const token = issueSessionToken('owneruser', process.env['AUTH_SECRET']!, 60);
    const authorized = await fetch(`http://127.0.0.1:${port}/api/os/missions/${missionId}/outcome`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(authorized.status, 200);
    const body = await authorized.json() as { status?: string; checks?: unknown[] };
    assert.equal(body.status, 'verified');
    assert.ok((body.checks ?? []).length > 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
