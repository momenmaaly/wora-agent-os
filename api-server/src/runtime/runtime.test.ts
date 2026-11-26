/**
 * WORA Cloud Computer & Browser — real backend tests.
 *
 * The process provider, a real local Chromium child and a real HTTP page are
 * exercised. No mocked browser responses and no simulated screenshots.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-runtime-tests-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['WORA_RUNTIME_ROOT'] = path.join(TMP, 'runtime');
process.env['WORA_CLOUD_PROVIDER'] = 'process';
process.env['WORA_CLOUD_ALLOW_PROCESS_PROVIDER'] = '1';
process.env['WORA_BROWSER_EXECUTABLE_PATH'] = '/usr/bin/chromium';
process.env['WORA_BROWSER_PROVIDER'] = 'process';
process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = '1';
process.env['AUTH_SECRET'] = 'test-secret-0123456789abcdef0123456789abcdef';
process.env['NODE_ENV'] = 'test';

const { addRuntimeArtifact, createComputerSession, execComputer, expireRuntimeSessions, getComputerSession, listComputerSessions, listSessionFiles, readSessionFile, stopComputerSession, writeSessionFile, listRuntimeArtifacts, getRuntimeArtifact, runtimeStatus } = await import('./cloud.js');
const { browserOpen, browserInspect, browserClick, browserType, browserSelect, browserScroll, browserWait, browserScreenshot, browserResearch, closeBrowserSession, closeAllBrowserSessionsForTests, createBrowserSession, expireBrowserSessions, getBrowserSession, listBrowserSessions } = await import('./browser.js');
const { getOsDb } = await import('../os/db.js');
const { createMission, executeMission, getMissionDetail } = await import('../os/orchestrator.js');
const { ensureSeedAgents } = await import('../os/registry.js');
const { listApprovals, decideApproval, getApproval } = await import('../os/governance.js');
const { issueSessionToken } = await import('../lib/session.js');
const { getWorkspaceRole, setWorkspaceRole } = await import('../os/roles.js');
const { runTool } = await import('../os/tools.js');
const { createOsRouter } = await import('../os/router.js');
const express = (await import('express')).default;

const WS = 'wora-runtime-test';
let docPort = 0;
let docServer: Server;
let docUrl = '';

before(async () => {
  docServer = createServer((req, res) => {
    if (req.url === '/next') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Next page</title><main><h1>Next</h1><p>Second page content.</p></main>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>WORA Runtime Docs</title></head><body>
      <header><nav><a href="/next">Next page</a><a href="/checkout">Buy now</a></nav></header>
      <main><h1>Runtime documentation</h1><h2>Navigation and content</h2>
      <p>This page is served by a real local HTTP server for browser automation tests.</p>
      <form><input id="query" name="query" value=""><input id="card-number" name="card-number" value=""><select id="kind"><option value="a">A</option><option value="b">B</option></select><button type="button" id="buy">Buy now</button></form>
      <form id="checkout-form" action="/complete-purchase"><input id="email" name="email" value=""><input type="hidden" name="total" value="49.99"><button type="submit" id="submit-order">Submit</button></form>
      </main></body></html>`);
  });
  await new Promise<void>((resolve) => docServer.listen(0, '127.0.0.1', () => { docPort = (docServer.address() as { port: number }).port; resolve(); }));
  process.env['WORA_TEST_ALLOWED_PORTS'] = String(docPort);
  docUrl = `http://127.0.0.1:${docPort}/`;
});

after(async () => {
  await closeAllBrowserSessionsForTests();
  docServer.closeAllConnections();
  await Promise.race([new Promise<void>((resolve) => docServer.close(() => resolve())), new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
  rmSync(TMP, { recursive: true, force: true });
});

test('migration creates durable runtime tables with indexes', () => {
  const db = getOsDb();
  for (const table of ['os_runtime_sessions', 'os_runtime_events', 'os_runtime_artifacts']) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), `${table} exists`);
  }
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number }).user_version);
  assert.ok(version >= 15);
});

test('process provider starts a session, executes and confines files', async () => {
  const session = await createComputerSession({ workspaceId: WS, actor: 'test', missionId: 'msn-runtime-test' });
  assert.equal(session.status, 'running');
  assert.equal(session.provider, 'process');
  assert.equal(session.metadata['isolated'], false);
  const run = await execComputer({ workspaceId: WS, actor: 'test', sessionId: session.id, command: 'printf "cloud-ok"' });
  assert.equal(run.exitCode, 0);
  assert.equal(run.stdout, 'cloud-ok');
  const write = writeSessionFile({ workspaceId: WS, sessionId: session.id, path: 'notes/result.md', content: '# Result\n\nReal cloud file.', actor: 'test' });
  assert.ok(write.bytes > 0);
  const read = readSessionFile({ workspaceId: WS, sessionId: session.id, path: 'notes/result.md', actor: 'test' });
  assert.match(read.content, /Real cloud file/u);
  assert.throws(() => readSessionFile({ workspaceId: WS, sessionId: session.id, path: '../../../../etc/passwd', actor: 'test' }), /escapes|ENOENT|not a file/u);
  assert.throws(() => writeSessionFile({ workspaceId: WS, sessionId: session.id, path: '../escape.txt', content: 'x', actor: 'test' }), /escapes/u);
  const other = await createComputerSession({ workspaceId: WS, actor: 'test', missionId: 'msn-runtime-test' });
  assert.throws(() => readSessionFile({ workspaceId: WS, sessionId: other.id, path: 'notes/result.md', actor: 'test' }), /ENOENT/u);
  await stopComputerSession({ workspaceId: WS, sessionId: session.id, actor: 'test' });
  await stopComputerSession({ workspaceId: WS, sessionId: other.id, actor: 'test' });
  assert.equal(getComputerSession(WS, session.id)?.status, 'stopped');
});

test('process provider enforces command timeout', async () => {
  const session = await createComputerSession({ workspaceId: WS, actor: 'test' });
  const run = await execComputer({ workspaceId: WS, actor: 'test', sessionId: session.id, command: 'sleep 3', timeoutMs: 1000 });
  assert.equal(run.timedOut, true);
  assert.equal(run.exitCode, null);
  await stopComputerSession({ workspaceId: WS, sessionId: session.id, actor: 'test' });
});

test('provider unavailability is reported instead of simulated', async () => {
  process.env['WORA_CLOUD_PROVIDER'] = 'docker';
  const previousImage = process.env['WORA_CLOUD_IMAGE'];
  process.env['WORA_CLOUD_IMAGE'] = 'wora-missing-image-for-test:never';
  try {
    await assert.rejects(() => createComputerSession({ workspaceId: WS, actor: 'test' }), /Docker runtime is not operational/u);
  } finally {
    process.env['WORA_CLOUD_PROVIDER'] = 'process';
    if (previousImage === undefined) delete process.env['WORA_CLOUD_IMAGE']; else process.env['WORA_CLOUD_IMAGE'] = previousImage;
  }
  const status = await runtimeStatus();
  assert.equal(typeof status['operational'], 'boolean');
  assert.ok(Array.isArray(status['providers']));
});

test('production refuses the unsandboxed process browser provider', async () => {
  const previousEnv = process.env['NODE_ENV'];
  const previousProvider = process.env['WORA_BROWSER_PROVIDER'];
  process.env['NODE_ENV'] = 'production';
  process.env['WORA_BROWSER_PROVIDER'] = 'process';
  try {
    const { browserAvailability } = await import('./browser.js');
    const availability = await browserAvailability();
    assert.equal(availability.available, false);
    assert.match(availability.reason, /disabled in production/iu);
  } finally {
    process.env['NODE_ENV'] = previousEnv;
    if (previousProvider === undefined) delete process.env['WORA_BROWSER_PROVIDER']; else process.env['WORA_BROWSER_PROVIDER'] = previousProvider;
  }
});

test('the browser manager rejects a private URL in production before any session action', async () => {
  const previousEnv = process.env['NODE_ENV'];
  const previousProvider = process.env['WORA_BROWSER_PROVIDER'];
  process.env['NODE_ENV'] = 'production';
  process.env['WORA_BROWSER_PROVIDER'] = 'docker';
  try {
    await assert.rejects(() => browserOpen(WS, 'missing-session', 'http://169.254.169.254/latest/meta-data/'), /blocked|private|not allowed|BLOCKED_TARGET/iu);
  } finally {
    process.env['NODE_ENV'] = previousEnv;
    if (previousProvider === undefined) delete process.env['WORA_BROWSER_PROVIDER']; else process.env['WORA_BROWSER_PROVIDER'] = previousProvider;
  }
});

test('browser unavailability fails closed instead of simulating a session', async () => {
  const previous = process.env['WORA_BROWSER_EXECUTABLE_PATH'];
  process.env['WORA_BROWSER_EXECUTABLE_PATH'] = '/nonexistent/chromium';
  try {
    await assert.rejects(() => createBrowserSession({ workspaceId: WS, actor: 'test' }), /No Chromium executable/u);
  } finally {
    process.env['WORA_BROWSER_EXECUTABLE_PATH'] = previous;
  }
});

test('browser runs in a real Chromium child, navigates, inspects, types, selects and screenshots', async () => {
  const session = await createBrowserSession({ workspaceId: WS, actor: 'test', missionId: 'msn-browser-test' });
  assert.equal(session.status, 'running');
  const opened = await browserOpen(WS, session.id, docUrl, 'test');
  assert.equal(opened['title'], 'WORA Runtime Docs');
  assert.ok(Number(opened['status']) >= 200 && Number(opened['status']) < 400);
  const inspected = await browserInspect(WS, session.id, 'test');
  assert.match(String(inspected['markdown']), /Runtime documentation/u);
  assert.ok(Array.isArray(inspected['navigation']) && (inspected['navigation'] as unknown[]).length > 0);
  await browserType(WS, session.id, { selector: '#query', text: 'cloud computer' }, 'test');
  await browserSelect(WS, session.id, { selector: '#kind', value: 'b' }, 'test');
  await assert.rejects(() => browserClick(WS, session.id, { selector: '#submit-order' }, 'test'), /FINANCIAL_APPROVAL_REQUIRED/u);
  await assert.rejects(() => browserType(WS, session.id, { selector: '#email', text: 'buyer@example.test', submit: true }, 'test'), /FINANCIAL_APPROVAL_REQUIRED/u);
  await browserType(WS, session.id, { selector: '#email', text: 'buyer@example.test' }, 'test');
  const shot = await browserScreenshot(WS, session.id, { name: 'runtime-proof.png' }, 'test');
  assert.ok(Number(shot['bytes']) > 0);
  const artifact = getRuntimeArtifact(WS, String(shot['artifactId']), 'test');
  assert.ok(artifact);
  assert.equal(readFileSync(artifact!.absolutePath).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await assert.rejects(() => browserClick(WS, session.id, { text: 'Buy now' }, 'test'), /FINANCIAL_APPROVAL_REQUIRED/u);
  const next = await browserClick(WS, session.id, { text: 'Next page' }, 'test');
  assert.equal(next['title'], 'Next page');
  await closeBrowserSession({ workspaceId: WS, sessionId: session.id, actor: 'test' });
  assert.equal(getBrowserSession(WS, session.id)?.status, 'stopped');
});

test('browser research writes a Markdown document and records both artifacts', async () => {
  const session = await createBrowserSession({ workspaceId: WS, actor: 'test' });
  const result = await browserResearch(WS, session.id, { url: docUrl, filename: 'research.md' }, 'test');
  assert.ok(String(result['markdown']).length > 40);
  assert.ok(result['documentArtifactId']);
  assert.ok(result['screenshotArtifactId']);
  const artifacts = listRuntimeArtifacts(WS, { sessionId: session.id });
  assert.equal(artifacts.length, 2);
  assert.ok(artifacts.some((entry) => entry.kind === 'screenshot' && entry.sizeBytes > 0));
  await closeBrowserSession({ workspaceId: WS, sessionId: session.id, actor: 'test' });
});

test('agent tool execution cannot enable network access for a cloud computer', async () => {
  const { runTool } = await import('../os/tools.js');
  const result = await runTool('cloud.computer_start', { kind: 'computer', allowNetwork: true }, {
    workspaceId: WS, actor: 'test', permissions: new Set(['runtime:execute']),
  });
  assert.equal(result.ok, false);
  assert.match(String(result.error), /restricted to an explicit admin API request/u);
});

test('expired sessions are released and marked expired, not left running', async () => {
  const browser = await createBrowserSession({ workspaceId: WS, actor: 'test' });
  const computer = await createComputerSession({ workspaceId: WS, actor: 'test' });
  getOsDb().prepare('UPDATE os_runtime_sessions SET expires_at = ? WHERE id IN (?, ?)').run(Date.now() - 1, browser.id, computer.id);
  await Promise.all([expireBrowserSessions(WS), expireRuntimeSessions(WS)]);
  assert.equal(getBrowserSession(WS, browser.id)?.status, 'stopped');
  assert.equal(getComputerSession(WS, computer.id)?.status, 'expired');
});

test('mission lifecycle resolves the browser agent, executes real tools and stops sessions', async () => {
  const missionId = createMission({ workspaceId: WS, objective: `Open ${docUrl} in a browser, inspect its documentation content, write a Markdown summary and capture a screenshot.`, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId);
  assert.ok(detail);
  assert.equal(detail!.status, 'completed');
  const tools = detail!.tasks.map((task) => task.tool);
  assert.deepEqual(tools, ['browser.open', 'browser.inspect', 'cloud.write_file', 'browser.screenshot', 'browser.close']);
  const screenshotTask = detail!.tasks.find((task) => task.tool === 'browser.screenshot');
  assert.equal(screenshotTask?.status, 'completed');
  const artifacts = listRuntimeArtifacts(WS, { missionId });
  assert.ok(artifacts.some((artifact) => artifact.kind === 'screenshot'));
  assert.ok(artifacts.some((artifact) => artifact.kind === 'markdown'));
  const sessions = listBrowserSessions(WS, missionId);
  assert.ok(sessions.length >= 1);
  assert.ok(sessions.every((session) => session.status === 'stopped'));
  const computerSessions = listComputerSessions(WS, { missionId });
  assert.equal(computerSessions.length, 0, 'browser sessions are not reported as cloud computers');
  assert.equal(getComputerSession(WS, sessions[0]!.id), null, 'computer lookup rejects a browser session');
});

test('financial browser actions are blocked until a payload-bound class C approval is consumed', async () => {
  ensureSeedAgents(WS);
  const session = await createBrowserSession({ workspaceId: WS, actor: 'test' });
  await browserOpen(WS, session.id, docUrl, 'test');
  await assert.rejects(() => browserClick(WS, session.id, { text: 'Buy now' }, 'test'), /FINANCIAL_APPROVAL_REQUIRED/u);
  await assert.rejects(() => browserType(WS, session.id, { selector: '#card-number', text: '4242 4242 4242 4242' }, 'test'), /FINANCIAL_APPROVAL_REQUIRED/u);

  const missionId = createMission({ workspaceId: WS, objective: 'Complete an approval-gated browser purchase', actor: 'test' });
  const db = getOsDb();
  db.prepare('DELETE FROM os_tasks WHERE mission_id = ?').run(missionId);
  const taskId = `tsk-fin-${Date.now()}`;
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO os_tasks
    (id, mission_id, workspace_id, order_index, title, objective, specialization, status, agent_id, depends_on, acceptance, tool, tool_input, detail, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, 'browser_automation', 'planned', NULL, '[]', ?, 'browser.click', ?, 'financial fixture', ?, ?)`)
    .run(taskId, missionId, WS, 'Purchase', 'Purchase from the test page', JSON.stringify(['The approved browser click completes']), JSON.stringify({ sessionId: session.id, text: 'Buy now' }), ts, ts);

  await executeMission(missionId, 'test');
  const waiting = getMissionDetail(WS, missionId)!;
  assert.ok(['blocked', 'running', 'paused', 'awaiting_approval'].includes(waiting.status), `unexpected mission status ${waiting.status}`);
  assert.ok(['blocked', 'pending'].includes(waiting.tasks[0]!.status), `unexpected task status ${waiting.tasks[0]!.status}`);
  const approval = listApprovals(WS, { status: 'pending', limit: 10 }).find((entry) => entry.missionId === missionId);
  assert.ok(approval, 'a pending approval must be created for the financial click');
  assert.equal(approval!.actionClass, 'C');
  assert.equal(approval!.risk, 'high');
  assert.equal(approval!.toolId, 'browser.click');

  decideApproval(WS, approval!.id, 'approved', 'approved by security test', 'admin');
  await executeMission(missionId, 'test');
  const done = getMissionDetail(WS, missionId)!;
  assert.equal(done.tasks[0]!.status, 'completed');
  const consumed = listApprovals(WS, { status: 'all', limit: 10 }).find((entry) => entry.id === approval!.id);
  assert.ok(consumed?.consumedAt, 'the approval must be consumed exactly at execution');
  await closeBrowserSession({ workspaceId: WS, sessionId: session.id, actor: 'test' });
});
test('runtime ownership rejects another user across computer, browser, files and artifacts', { timeout: 60_000 }, async () => {
  const ownershipWs = 'wora-runtime-ownership';
  getWorkspaceRole(ownershipWs, 'alice');
  setWorkspaceRole(ownershipWs, 'bob', 'member', 'alice');
  setWorkspaceRole(ownershipWs, 'adminuser', 'admin', 'alice');

  const computer = await createComputerSession({ workspaceId: ownershipWs, actor: 'alice', missionId: 'msn-ownership' });
  const written = writeSessionFile({ workspaceId: ownershipWs, sessionId: computer.id, path: 'private.txt', content: 'alice-only', actor: 'alice' });
  assert.ok(written.bytes > 0);
  assert.deepEqual(listSessionFiles(ownershipWs, computer.id, '.', 'alice').map((entry) => entry.name), ['private.txt']);
  const artifact = addRuntimeArtifact({
    workspaceId: ownershipWs, sessionId: computer.id, missionId: 'msn-ownership',
    name: 'private.txt', kind: 'file', mimeType: 'text/plain', storagePath: `${computer.workspaceDir}/private.txt`,
  });

  await assert.rejects(() => execComputer({ workspaceId: ownershipWs, actor: 'bob', sessionId: computer.id, command: 'printf bob' }), /not accessible|forbidden/iu);
  assert.throws(() => writeSessionFile({ workspaceId: ownershipWs, sessionId: computer.id, path: 'bob.txt', content: 'bob', actor: 'bob' }), /not accessible|forbidden/iu);
  assert.throws(() => readSessionFile({ workspaceId: ownershipWs, sessionId: computer.id, path: 'private.txt', actor: 'bob' }), /not accessible|forbidden/iu);
  assert.throws(() => listSessionFiles(ownershipWs, computer.id, '.', 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => stopComputerSession({ workspaceId: ownershipWs, sessionId: computer.id, actor: 'bob' }), /not accessible|forbidden/iu);
  assert.throws(() => getRuntimeArtifact(ownershipWs, artifact.id, 'bob'), /not accessible|forbidden/iu);
  assert.equal(getRuntimeArtifact('wora-other-workspace', artifact.id, 'alice'), null);
  await assert.rejects(() => execComputer({ workspaceId: 'wora-other-workspace', actor: 'alice', sessionId: computer.id, command: 'printf cross' }), /not found/iu);

  const bobTool = await runTool('cloud.exec', { sessionId: computer.id, command: 'printf tool-bob' }, {
    workspaceId: ownershipWs, actor: 'bob', requestedBy: 'bob', permissions: new Set(['runtime:execute']),
  });
  assert.equal(bobTool.ok, false);
  assert.match(String(bobTool.error), /not accessible|forbidden/iu);
  const aliceTool = await runTool('cloud.exec', { sessionId: computer.id, command: 'printf tool-alice' }, {
    workspaceId: ownershipWs, actor: 'alice', requestedBy: 'alice', permissions: new Set(['runtime:execute']),
  });
  assert.equal(aliceTool.ok, true, String(aliceTool.error));
  const adminTool = await runTool('cloud.exec', { sessionId: computer.id, command: 'printf tool-admin' }, {
    workspaceId: ownershipWs, actor: 'adminuser', requestedBy: 'adminuser', permissions: new Set(['runtime:execute']),
  });
  assert.equal(adminTool.ok, true, String(adminTool.error));
  assert.ok(getRuntimeArtifact(ownershipWs, artifact.id, 'alice'));

  const legacyMission = createMission({ workspaceId: ownershipWs, objective: 'Legacy agent session ownership check', actor: 'alice' });
  const legacySession = await createComputerSession({ workspaceId: ownershipWs, actor: 'legacy-agent', missionId: legacyMission });
  const legacyRun = await execComputer({ workspaceId: ownershipWs, actor: 'alice', sessionId: legacySession.id, command: 'printf legacy-owner' });
  assert.equal(legacyRun.stdout, 'legacy-owner');
  await assert.rejects(() => execComputer({ workspaceId: ownershipWs, actor: 'bob', sessionId: legacySession.id, command: 'printf legacy-bob' }), /not accessible|forbidden/iu);
  await stopComputerSession({ workspaceId: ownershipWs, sessionId: legacySession.id, actor: 'alice' });

  const browser = await createBrowserSession({ workspaceId: ownershipWs, actor: 'alice', missionId: 'msn-ownership' });
  await browserOpen(ownershipWs, browser.id, docUrl, 'alice');
  await assert.rejects(() => browserOpen(ownershipWs, browser.id, docUrl, 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => browserInspect(ownershipWs, browser.id, 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => browserScreenshot(ownershipWs, browser.id, { name: 'bob.png' }, 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => browserClick(ownershipWs, browser.id, { text: 'Next page' }, 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => browserType(ownershipWs, browser.id, { selector: '#query', text: 'bob' }, 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => browserSelect(ownershipWs, browser.id, { selector: '#kind', value: 'b' }, 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => browserScroll(ownershipWs, browser.id, 100, 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => browserWait(ownershipWs, browser.id, 100, 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => browserResearch(ownershipWs, browser.id, { url: docUrl }, 'bob'), /not accessible|forbidden/iu);
  await assert.rejects(() => closeBrowserSession({ workspaceId: ownershipWs, sessionId: browser.id, actor: 'bob' }), /not accessible|forbidden/iu);
  assert.ok(await browserInspect(ownershipWs, browser.id, 'adminuser'));
  await browserScreenshot(ownershipWs, browser.id, { name: 'alice.png' }, 'alice');
  await closeBrowserSession({ workspaceId: ownershipWs, sessionId: browser.id, actor: 'alice' });
  await stopComputerSession({ workspaceId: ownershipWs, sessionId: computer.id, actor: 'alice' });
});

test('runtime API enforces workspace session authorization', async () => {
  const app = express();
  app.use('/api/os', createOsRouter({ production: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const token = issueSessionToken('runtime-user', process.env['AUTH_SECRET']!, 10);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const status = await fetch(`http://127.0.0.1:${port}/api/os/runtime/status`, { headers });
  assert.equal(status.status, 200);
  const body = await status.json() as { cloud?: { providers?: unknown[] }; browser?: { available?: boolean } };
  assert.ok(Array.isArray(body.cloud?.providers));
  assert.equal(typeof body.browser?.available, 'boolean');
  const started = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions`, { method: 'POST', headers, body: JSON.stringify({ kind: 'computer' }) });
  assert.equal(started.status, 201);
  const session = await started.json() as { id: string };
  const foreign = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${session.id}`, { headers: { ...headers, authorization: 'Bearer invalid' } });
  assert.equal(foreign.status, 401);
  const stopped = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${session.id}/stop`, { method: 'POST', headers, body: JSON.stringify({ reason: 'test' }) });
  assert.equal(stopped.status, 200);

  const browserStart = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions`, { method: 'POST', headers, body: JSON.stringify({ kind: 'browser' }) });
  assert.equal(browserStart.status, 201);
  const browser = await browserStart.json() as { id: string };
  const opened = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${browser.id}/browser`, { method: 'POST', headers, body: JSON.stringify({ action: 'open', url: docUrl }) });
  assert.equal(opened.status, 200);
  const denied = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${browser.id}/browser`, { method: 'POST', headers, body: JSON.stringify({ action: 'click', text: 'Buy now' }) });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json() as { code?: string }).code, 'FINANCIAL_APPROVAL_REQUIRED');
  const requested = await fetch(`http://127.0.0.1:${port}/api/os/runtime/browser-approvals`, { method: 'POST', headers, body: JSON.stringify({ action: 'click', sessionId: browser.id, text: 'Buy now' }) });
  assert.equal(requested.status, 201);
  const approval = await requested.json() as { id: string };
  const secondStart = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions`, { method: 'POST', headers, body: JSON.stringify({ kind: 'browser' }) });
  assert.equal(secondStart.status, 201);
  const second = await secondStart.json() as { id: string };
  const secondOpen = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${second.id}/browser`, { method: 'POST', headers, body: JSON.stringify({ action: 'open', url: docUrl }) });
  assert.equal(secondOpen.status, 200);
  decideApproval('wora-runtime-user', approval.id, 'approved', 'api security test', 'admin');
  const wrongSession = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${second.id}/browser`, { method: 'POST', headers, body: JSON.stringify({ action: 'click', text: 'Buy now', approvalId: approval.id }) });
  assert.equal(wrongSession.status, 403, 'an approval bound to one browser session must not unlock another');
  const clicked = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${browser.id}/browser`, { method: 'POST', headers, body: JSON.stringify({ action: 'click', text: 'Buy now', approvalId: approval.id }) });
  assert.equal(clicked.status, 200);
  assert.ok(getApproval('wora-runtime-user', approval.id)?.consumedAt, 'the API must consume the approval');
  const replay = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${browser.id}/browser`, { method: 'POST', headers, body: JSON.stringify({ action: 'click', text: 'Buy now', approvalId: approval.id }) });
  assert.equal(replay.status, 403);
  const browserStop = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${browser.id}/stop`, { method: 'POST', headers, body: JSON.stringify({ reason: 'test' }) });
  assert.equal(browserStop.status, 200);
  const secondStop = await fetch(`http://127.0.0.1:${port}/api/os/runtime/sessions/${second.id}/stop`, { method: 'POST', headers, body: JSON.stringify({ reason: 'test' }) });
  assert.equal(secondStop.status, 200);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
