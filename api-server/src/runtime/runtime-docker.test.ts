/**
 * Real Docker integration tests.
 *
 * These run only when WORA_DOCKER_INTEGRATION=1 and a Docker daemon is
 * available. They create and inspect real containers; nothing is simulated.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const ENABLED = process.env['WORA_DOCKER_INTEGRATION'] === '1' && existsSync('/var/run/docker.sock');
const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-docker-tests-'));
process.env['NODE_ENV'] = 'test';
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['WORA_RUNTIME_ROOT'] = path.join(TMP, 'runtime');
process.env['WORA_CLOUD_PROVIDER'] = 'docker';
process.env['WORA_CLOUD_IMAGE'] = process.env['WORA_CLOUD_IMAGE'] ?? 'node:22-alpine';
process.env['AUTH_SECRET'] = 'test-secret-0123456789abcdef0123456789abcdef';
process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = '1';
process.env['WORA_BROWSER_EXECUTABLE_PATH'] = '/usr/bin/chromium';

const WS = 'wora-docker-test';
let docServer: Server;
let docPort = 0;
let docUrl = '';

before(async () => {
  if (!ENABLED) return;
  docServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Docker Browser Test</title><h1>Docker browser evidence</h1><p>Reached through the isolated network proxy.</p>');
  });
  await new Promise<void>((resolve) => docServer.listen(0, '0.0.0.0', () => resolve()));
  const address = docServer.address();
  docPort = typeof address === 'object' && address ? address.port : 0;
  process.env['WORA_TEST_ALLOWED_PORTS'] = String(docPort);
});

after(async () => {
  if (!ENABLED) { rmSync(TMP, { recursive: true, force: true }); return; }
  const { closeAllBrowserSessionsForTests } = await import('./browser.js');
  await closeAllBrowserSessionsForTests().catch(() => undefined);
  docServer?.closeAllConnections();
  await new Promise<void>((resolve) => docServer?.close(() => resolve()) ?? resolve());
  rmSync(TMP, { recursive: true, force: true });
});

test('real Docker cloud computer: create, exec, files, isolation, limits and cleanup', { skip: !ENABLED, timeout: 180_000 }, async () => {
  const { createComputerSession, execComputer, getComputerSession, readSessionFile, stopComputerSession, writeSessionFile } = await import('./cloud.js');
  const session = await createComputerSession({ workspaceId: WS, actor: 'docker-test', ttlMinutes: 5 });
  assert.equal(session.provider, 'docker');
  assert.equal(session.status, 'running');
  const container = String(session.metadata['container'] ?? '');
  assert.ok(container.startsWith('wora-cloud-'));
  const running = await execFileAsync('docker', ['inspect', container, '--format', '{{.State.Running}}'], { timeout: 10_000 });
  assert.equal(running.stdout.trim(), 'true');

  const run = await execComputer({ workspaceId: WS, sessionId: session.id, actor: 'docker-test', command: "printf 'docker-ok' && printf 'err-ok' >&2" });
  assert.equal(run.exitCode, 0);
  assert.match(run.stdout, /docker-ok/u);
  assert.match(run.stderr, /err-ok/u);

  writeSessionFile({ workspaceId: WS, sessionId: session.id, actor: 'docker-test', path: 'proof.txt', content: 'workspace-only' });
  const read = readSessionFile({ workspaceId: WS, sessionId: session.id, path: 'proof.txt' });
  assert.equal(read.content, 'workspace-only');
  assert.throws(() => writeSessionFile({ workspaceId: WS, sessionId: session.id, actor: 'docker-test', path: '../escape.txt', content: 'x' }), /escape|outside|workspace|invalid/iu);

  const noNetwork = await execComputer({ workspaceId: WS, sessionId: session.id, actor: 'docker-test', command: "node -e \"fetch('http://example.com',{signal:AbortSignal.timeout(2000)}).then(()=>process.exit(0)).catch(()=>process.exit(7))\"", timeoutMs: 8_000 });
  assert.notEqual(noNetwork.exitCode, 0, 'network=none must prevent egress');

  const readonly = await execComputer({ workspaceId: WS, sessionId: session.id, actor: 'docker-test', command: 'touch /host-write-test' });
  assert.notEqual(readonly.exitCode, 0, 'the container root filesystem must be read-only');

  const timed = await execComputer({ workspaceId: WS, sessionId: session.id, actor: 'docker-test', command: 'sleep 3', timeoutMs: 1_000 });
  assert.equal(timed.timedOut, true);

  await stopComputerSession({ workspaceId: WS, sessionId: session.id, actor: 'docker-test', reason: 'integration complete' });
  assert.equal(getComputerSession(WS, session.id)?.status, 'stopped');
  await assert.rejects(execFileAsync('docker', ['inspect', container], { timeout: 10_000 }), /no such object|no such container/iu);
});

test('real Docker browser: internal network, proxy-only page access, screenshot and cleanup', { skip: !ENABLED, timeout: 240_000 }, async () => {
  const { closeBrowserSession, createBrowserSession, browserOpen, browserScreenshot } = await import('./browser.js');
  const { ensureBrowserNetwork } = await import('./browser-docker.js');
  process.env['WORA_BROWSER_PROVIDER'] = 'docker';
  process.env['WORA_BROWSER_SANDBOX'] = 'container';
  process.env['WORA_BROWSER_ALLOW_CONTAINER_SANDBOX'] = '1';
  process.env['WORA_BROWSER_IMAGE'] = process.env['WORA_TEST_BROWSER_IMAGE'] ?? 'wora-browser-runtime:1.0.0';
  const { gateway } = await ensureBrowserNetwork();
  const url = `http://${gateway}:${docPort}/`;
  const session = await createBrowserSession({ workspaceId: WS, actor: 'docker-test', ttlMinutes: 5 });
  assert.equal(session.metadata['provider'], 'docker');
  assert.equal(session.metadata['isolated'], true);
  const opened = await browserOpen(WS, session.id, url);
  assert.equal(opened['title'], 'Docker Browser Test');
  const screenshot = await browserScreenshot(WS, session.id, { name: 'docker-browser.png' });
  assert.ok(Number(screenshot['bytes']) > 0);
  const name = String(session.metadata['containerName'] ?? '');
  await assert.rejects(
    execFileAsync('docker', ['exec', name, 'node', '-e', "fetch('https://example.com',{signal:AbortSignal.timeout(2000)}).then(()=>process.exit(0)).catch(()=>process.exit(8))"], { timeout: 15_000 }),
    /exit code 8|Command failed/u,
    'the browser container must have no direct egress',
  );
  await closeBrowserSession({ workspaceId: WS, sessionId: session.id, actor: 'docker-test', reason: 'integration complete' });
  if (name) await assert.rejects(execFileAsync('docker', ['inspect', name], { timeout: 10_000 }), /no such object|no such container/iu);
});

test('secure Chromium sandbox mode fails closed when the host cannot provide it', { skip: !ENABLED, timeout: 120_000 }, async () => {
  const { browserAvailability } = await import('./browser.js');
  process.env['WORA_BROWSER_PROVIDER'] = 'docker';
  delete process.env['WORA_BROWSER_SANDBOX'];
  delete process.env['WORA_BROWSER_ALLOW_CONTAINER_SANDBOX'];
  process.env['WORA_BROWSER_IMAGE'] = process.env['WORA_TEST_BROWSER_IMAGE'] ?? 'wora-browser-runtime:1.0.0';
  const availability = await browserAvailability();
  if (!availability.available) {
    assert.match(availability.reason, /probe failed|not available|sandbox/iu);
    process.env['WORA_BROWSER_SANDBOX'] = 'container';
    process.env['WORA_BROWSER_ALLOW_CONTAINER_SANDBOX'] = '1';
    return;
  }
  assert.equal(availability.sandbox, 'chromium');
  assert.equal(availability.isolated, true);
  process.env['WORA_BROWSER_SANDBOX'] = 'container';
  process.env['WORA_BROWSER_ALLOW_CONTAINER_SANDBOX'] = '1';
});
