/**
 * Persistent browser sessions for WORA.
 *
 * Each browser session owns a dedicated Playwright runner and a session-scoped
 * directory. Production runs the runner and Chromium inside an isolated Docker
 * container; development may use a child process. The API only exchanges JSON
 * messages with the runner; Chromium never runs inside the API process.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOsDb, newId, nowIso, parseJson, audit } from '../os/db.js';
import { redactSecrets } from '../os/secrets.js';
import { sessionDir } from './paths.js';
import { addRuntimeArtifact, MAX_SESSIONS_PER_WORKSPACE, writeSessionFile, type RuntimeSession } from './cloud.js';
import { browserSandboxMode, cleanupDockerBrowserContainers, dockerBrowserAvailability, ensureBrowserNetwork, removeDockerBrowser, startDockerBrowser, type BrowserSandboxMode } from './browser-docker.js';
import net from 'node:net';
import { startBrowserProxy, type BrowserProxyHandle } from './browser-proxy.js';
import { financialIntent } from './financial.js';
import { assertSafeOutboundUrl } from '../lib/safe-fetch.js';
import { assertRuntimeSessionAccess } from './auth.js';

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
interface Runner { child: ChildProcessWithoutNullStreams; pending: Map<string, Pending>; buffer: string; session: RuntimeSession; lastActionAt: number; provider: BrowserProvider; containerName?: string }

type BrowserProvider = 'docker' | 'process';
const runners = new Map<string, Runner>();
const proxies = new Map<string, BrowserProxyHandle>();

function browserProvider(): BrowserProvider {
  const configured = (process.env['WORA_BROWSER_PROVIDER'] ?? '').trim().toLowerCase();
  if (configured === 'docker') return 'docker';
  if (configured === 'process') {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('The unsandboxed process browser provider is disabled in production. Use WORA_BROWSER_PROVIDER=docker.');
    }
    return 'process';
  }
  if (configured) throw new Error(`Unknown WORA_BROWSER_PROVIDER: ${configured}`);
  return process.env['NODE_ENV'] === 'production' ? 'docker' : 'process';
}

function proxyTestOptions(): { allowPrivateForTests: boolean; testAllowedHosts?: ReadonlySet<string> } {
  const allow = process.env['NODE_ENV'] === 'test' && process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] === '1';
  const hosts = (process.env['WORA_TEST_PROXY_ALLOWED_HOSTS'] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  return { allowPrivateForTests: allow, ...(hosts.length ? { testAllowedHosts: new Set(hosts) } : {}) };
}

async function browserProxyFor(host: string, allowedClients?: net.BlockList, blockedClient?: string, cacheKey = host): Promise<BrowserProxyHandle> {
  const existing = proxies.get(cacheKey);
  if (existing) return existing;
  const proxy = await startBrowserProxy({ host, ...proxyTestOptions(), ...(allowedClients ? { allowedClients } : {}), ...(blockedClient ? { blockedClient } : {}) });
  proxies.set(cacheKey, proxy);
  return proxy;
}

function logUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2_000);
  } catch { return value.slice(0, 500); }
}

function browserExecutable(): string | null {
  const configured = process.env['WORA_BROWSER_EXECUTABLE_PATH'];
  if (configured) return existsSync(configured) ? configured : null;
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']
    .find((candidate) => existsSync(candidate)) ?? null;
}

export interface BrowserAvailability { available: boolean; executable: string | null; reason: string; provider: BrowserProvider; isolated: boolean; sandbox: 'chromium' | 'container' | 'none'; containerImage?: string }

export async function browserAvailability(): Promise<BrowserAvailability> {
  let provider: BrowserProvider;
  try { provider = browserProvider(); } catch (error) {
    return { available: false, executable: null, reason: error instanceof Error ? error.message : String(error), provider: 'process', isolated: false, sandbox: 'none' };
  }
  if (provider === 'docker') {
    let sandbox: 'chromium' | 'container';
    try { sandbox = browserSandboxMode(); }
    catch (error) { return { available: false, executable: null, reason: error instanceof Error ? error.message : String(error), provider, isolated: true, sandbox: 'chromium' }; }
    const docker = await dockerBrowserAvailability();
    return { available: docker.available, executable: null, reason: docker.reason, provider, isolated: true, sandbox, containerImage: docker.image };
  }
  const executable = browserExecutable();
  return {
    available: Boolean(executable), executable,
    reason: executable
      ? 'Development-only host browser process. It is non-isolated and must not be used in production.'
      : 'No Chromium executable was found. Set WORA_BROWSER_EXECUTABLE_PATH or install Chromium.',
    provider, isolated: false, sandbox: 'none',
  };
}

function apiRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [moduleDir, path.resolve(moduleDir, '..'), path.resolve(moduleDir, '..', '..')]) {
    if (existsSync(path.join(candidate, 'dist', 'browser-runner.mjs')) || existsSync(path.join(candidate, 'src', 'runtime', 'browser-runner.ts'))) return candidate;
  }
  return process.cwd();
}

function runnerCommand(): { command: string; args: string[] } {
  const root = apiRoot();
  const source = path.join(root, 'src', 'runtime', 'browser-runner.ts');
  const bundled = path.join(root, 'dist', 'browser-runner.mjs');
  if (process.env['NODE_ENV'] === 'production' && existsSync(bundled)) return { command: process.execPath, args: [bundled] };
  const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
  if (existsSync(tsx)) return { command: tsx, args: [source] };
  return { command: process.execPath, args: ['--import', 'tsx', source] };
}

function killChild(child: ChildProcessWithoutNullStreams | null): void {
  if (!child) return;
  try { child.stdin.destroy(); } catch { /* closed */ }
  try { child.stdout.destroy(); } catch { /* closed */ }
  try { child.stderr.destroy(); } catch { /* closed */ }
  try { process.kill(-(child.pid ?? 0), 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* exited */ } }
  try { child.unref(); } catch { /* already gone */ }
}

async function stopRunner(runner: Runner): Promise<void> {
  if (runner.containerName) await removeDockerBrowser(runner.containerName);
  killChild(runner.child);
  if (runner.child.exitCode !== null || runner.child.signalCode !== null) return;
  await Promise.race([
    once(runner.child, 'exit').then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => { setTimeout(resolve, 1000); }),
  ]);
}

function cleanupBrowserTmp(session: RuntimeSession): void {
  const dir = session.metadata['browserTmpDir'];
  if (typeof dir === 'string' && dir.startsWith(os.tmpdir() + path.sep) && dir.includes('wora-b-')) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function event(session: RuntimeSession, kind: string, action: string, detail: Record<string, unknown> = {}): void {
  getOsDb().prepare('INSERT INTO os_runtime_events (id, workspace_id, session_id, kind, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('rte'), session.workspaceId, session.id, kind, action, JSON.stringify(redactSecrets(detail).value).slice(0, 20_000), nowIso());
}

function rowToRuntimeSession(row: Record<string, string | number | null>): RuntimeSession {
  return {
    id: String(row['id']), workspaceId: String(row['workspace_id']),
    missionId: row['mission_id'] == null ? null : String(row['mission_id']),
    taskId: row['task_id'] == null ? null : String(row['task_id']),
    kind: 'browser', provider: 'browser', status: String(row['status']) as RuntimeSession['status'],
    workspaceDir: String(row['workspace_dir']), limits: parseJson(String(row['limits'] ?? '{}'), { cpus: 1, memoryMb: 512, pids: 128, timeoutMs: 30_000, diskMb: 512 }),
    metadata: parseJson(String(row['metadata'] ?? '{}'), {}), createdBy: String(row['created_by']), error: String(row['error'] ?? ''),
    expiresAt: Number(row['expires_at']), createdAt: String(row['created_at']),
    startedAt: row['started_at'] == null ? null : String(row['started_at']), endedAt: row['ended_at'] == null ? null : String(row['ended_at']),
  };
}

export function getBrowserSession(workspaceId: string, sessionId: string): RuntimeSession | null {
  const row = getOsDb().prepare("SELECT * FROM os_runtime_sessions WHERE workspace_id = ? AND id = ? AND kind = 'browser'").get(workspaceId, sessionId) as Record<string, string | number | null> | undefined;
  return row ? rowToRuntimeSession(row) : null;
}

export function listBrowserSessions(workspaceId: string, missionId?: string): RuntimeSession[] {
  const rows = missionId
    ? getOsDb().prepare("SELECT * FROM os_runtime_sessions WHERE workspace_id = ? AND mission_id = ? AND kind = 'browser' ORDER BY created_at DESC LIMIT 50").all(workspaceId, missionId)
    : getOsDb().prepare("SELECT * FROM os_runtime_sessions WHERE workspace_id = ? AND kind = 'browser' ORDER BY created_at DESC LIMIT 50").all(workspaceId);
  return (rows as Array<Record<string, string | number | null>>).map(rowToRuntimeSession);
}

export async function createBrowserSession(input: { workspaceId: string; actor: string; missionId?: string; taskId?: string; ttlMinutes?: number }): Promise<RuntimeSession> {
  const availability = await browserAvailability();
  if (!availability.available) throw new Error(availability.reason);
  const active = getOsDb().prepare("SELECT COUNT(*) AS c FROM os_runtime_sessions WHERE workspace_id = ? AND status IN ('starting','running')").get(input.workspaceId) as { c?: number };
  if (Number(active.c ?? 0) >= MAX_SESSIONS_PER_WORKSPACE) throw new Error(`Active cloud session limit reached (${MAX_SESSIONS_PER_WORKSPACE})`);
  const id = newId('brt');
  const dir = sessionDir(input.workspaceId, id);
  const browserTmpDir = mkdtempSync(path.join(os.tmpdir(), 'wora-b-'));
  const now = nowIso();
  const expiresAt = Date.now() + Math.min(Math.max(input.ttlMinutes ?? 30, 1), 120) * 60_000;
  getOsDb().prepare(`INSERT INTO os_runtime_sessions
    (id, workspace_id, mission_id, task_id, kind, provider, status, workspace_dir, limits, metadata, created_by, error, expires_at, created_at, started_at, ended_at)
    VALUES (?, ?, ?, ?, 'browser', 'browser', 'starting', ?, ?, '{}', ?, '', ?, ?, NULL, NULL)`)
    .run(id, input.workspaceId, input.missionId ?? null, input.taskId ?? null, dir, JSON.stringify({ cpus: 1, memoryMb: 512, pids: 128, timeoutMs: 30_000, diskMb: 512 }), input.actor, expiresAt, now);
  const session = getBrowserSession(input.workspaceId, id)!;
  event(session, 'lifecycle', 'browser.starting', { executable: availability.executable });
  let child: ChildProcessWithoutNullStreams | null = null;
  let containerName: string | undefined;
  try {
    let proxyUrl: string;
    let sandbox: 'chromium' | 'container' | 'none';
    if (availability.provider === 'docker') {
      const mode: BrowserSandboxMode = browserSandboxMode();
      const network = await ensureBrowserNetwork();
      const [subnetAddress, subnetBits] = network.subnet.split('/');
      const allowedClients = new net.BlockList();
      allowedClients.addSubnet(subnetAddress!, Number(subnetBits), 'ipv4');
      proxyUrl = (await browserProxyFor(network.gateway, allowedClients, network.gateway, `${network.gateway}:${network.subnet}`)).url;
      const started = startDockerBrowser({ session, sessionDir: dir, proxyUrl, mode });
      child = started.child;
      containerName = started.containerName;
      sandbox = mode;
    } else {
      proxyUrl = (await browserProxyFor('127.0.0.1')).url;
      sandbox = 'none';
      const command = runnerCommand();
      child = spawn(command.command, command.args, {
        cwd: dir,
        env: {
          PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
          NODE_ENV: process.env['NODE_ENV'] ?? 'production',
          HOME: dir, TMPDIR: browserTmpDir,
          WORA_BROWSER_SESSION_DIR: dir,
          WORA_BROWSER_PROXY_URL: proxyUrl,
          WORA_BROWSER_NO_SANDBOX: '1',
          ...(availability.executable ? { WORA_BROWSER_EXECUTABLE_PATH: availability.executable } : {}),
          ...(process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] ? { WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS: process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] } : {}),
          ...(process.env['WORA_TEST_ALLOWED_PORTS'] ? { WORA_TEST_ALLOWED_PORTS: process.env['WORA_TEST_ALLOWED_PORTS'] } : {}),
          ...(process.env['WORA_BROWSER_EXECUTABLE_PATH'] ? { WORA_BROWSER_EXECUTABLE_PATH: process.env['WORA_BROWSER_EXECUTABLE_PATH'] } : {}),
          WORA_BROWSER_TMP_DIR: browserTmpDir,
        },
        detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    const runner: Runner = { child: child!, pending: new Map(), buffer: '', session, lastActionAt: Date.now(), provider: availability.provider, ...(containerName ? { containerName } : {}) };
    runners.set(id, runner);
    child!.stdout.on('data', (chunk: Buffer) => consume(runner, chunk));
    child!.stderr.on('data', (chunk: Buffer) => {
      const text = redactSecrets(chunk.toString('utf8')).value.slice(0, 1000);
      if (text.trim()) event(session, 'browser', 'browser.stderr', { text });
    });
    child!.once('exit', (code, signal) => {
      runners.delete(id);
      for (const pending of runner.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`Browser process exited (${code ?? signal ?? 'unknown'})`)); }
      runner.pending.clear();
      const current = getBrowserSession(input.workspaceId, id);
      if (current && !['stopped', 'expired', 'failed', 'interrupted'].includes(current.status)) {
        getOsDb().prepare("UPDATE os_runtime_sessions SET status = 'interrupted', ended_at = ?, error = ? WHERE id = ?").run(nowIso(), `Browser process exited (${code ?? signal ?? 'unknown'})`, id);
        event(current, 'lifecycle', 'browser.interrupted', { code });
      }
    });
    const ping = await request(runner, 'ping', {}, 90_000);
    if (!ping) throw new Error('Browser child did not acknowledge ping');
    getOsDb().prepare("UPDATE os_runtime_sessions SET status = 'running', started_at = ?, metadata = ? WHERE id = ?")
      .run(nowIso(), JSON.stringify({ browser: 'chromium', provider: availability.provider, isolated: availability.isolated, sandbox, executable: availability.executable, containerName: containerName ?? null, pid: child!.pid, browserTmpDir, network: availability.isolated ? 'internal-proxy-only' : 'host' }), id);
    const running = getBrowserSession(input.workspaceId, id)!;
    event(running, 'lifecycle', 'browser.running', { executable: availability.executable, provider: availability.provider, isolated: availability.isolated, sandbox });
    audit(getOsDb(), { workspaceId: input.workspaceId, actor: input.actor, action: 'runtime.browser.start', subject: id, detail: { executable: availability.executable, provider: availability.provider, isolated: availability.isolated, sandbox, missionId: input.missionId ?? null } });
    return running;
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error)).value;
    if (containerName) await removeDockerBrowser(containerName);
    killChild(child);
    try { rmSync(browserTmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    getOsDb().prepare("UPDATE os_runtime_sessions SET status = 'failed', error = ?, ended_at = ? WHERE id = ?").run(message.slice(0, 2000), nowIso(), id);
    event(session, 'lifecycle', 'browser.failed', { error: message });
    throw new Error(`Browser session failed to start: ${message}`);
  }
}

function consume(runner: Runner, chunk: Buffer): void {
  runner.buffer += chunk.toString('utf8');
  const lines = runner.buffer.split('\n');
  runner.buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let message: { id?: string; ok?: boolean; result?: unknown; error?: string };
    try { message = JSON.parse(line) as typeof message; } catch { continue; }
    if (!message.id) continue;
    const pending = runner.pending.get(message.id);
    if (!pending) continue;
    runner.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error ?? 'Browser action failed'));
  }
}

function request(runner: Runner, action: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
  if (runner.child.exitCode !== null || runner.child.killed) return Promise.reject(new Error('Browser process is not running'));
  const id = newId('breq');
  runner.lastActionAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      runner.pending.delete(id);
      try { process.kill(-(runner.child.pid ?? 0), 'SIGKILL'); } catch { try { runner.child.kill('SIGKILL'); } catch { /* exited */ } }
      reject(new Error(`Browser action ${action} timed out after ${timeoutMs}ms`));
    }, Math.min(Math.max(timeoutMs, 1000), 90_000));
    timer.unref?.();
    runner.pending.set(id, { resolve, reject, timer });
    runner.child.stdin.write(`${JSON.stringify({ id, action, params })}\n`);
  });
}

async function action(workspaceId: string, sessionId: string, actionName: string, params: Record<string, unknown>, timeoutMs = 30_000, actor = 'browser', financialApproved = false): Promise<Record<string, unknown>> {
  const session = getBrowserSession(workspaceId, sessionId);
  if (!session) throw new Error('Browser session not found in this workspace');
  assertRuntimeSessionAccess(workspaceId, session, actor);
  if (session.status !== 'running') throw new Error(`Browser session is ${session.status}, not running`);
  const runner = runners.get(sessionId);
  if (!runner) {
    getOsDb().prepare("UPDATE os_runtime_sessions SET status = 'interrupted', ended_at = ?, error = ? WHERE id = ?").run(nowIso(), 'Browser child process is not available; start a new session.', sessionId);
    throw new Error('Browser session is disconnected; start a new browser session');
  }
  const financialAction = actionName === 'click' || actionName === 'type' || actionName === 'select' ? actionName : null;
  const intent = financialAction ? financialIntent(financialAction, params) : { required: false, reason: '' };
  if (intent.required && !financialApproved) {
    event(session, 'browser', 'browser.financial_denied', { action: actionName, reason: intent.reason });
    audit(getOsDb(), { workspaceId, actor, action: 'runtime.browser.financial_denied', subject: sessionId, detail: { action: actionName, reason: intent.reason } });
    throw new Error(`FINANCIAL_APPROVAL_REQUIRED: ${intent.reason}`);
  }
  const result = await request(runner, actionName, intent.required ? { ...params, financialApproved: true } : params, timeoutMs) as Record<string, unknown>;
  const patch: Record<string, unknown> = { lastAction: actionName, lastActionAt: nowIso() };
  if (typeof result['url'] === 'string') patch['currentUrl'] = logUrl(result['url']);
  if (typeof result['title'] === 'string') patch['currentTitle'] = result['title'].slice(0, 500);
  getOsDb().prepare('UPDATE os_runtime_sessions SET metadata = ? WHERE id = ?').run(JSON.stringify({ ...session.metadata, ...patch }), sessionId);
  event(session, 'browser', `browser.${actionName}`, { url: logUrl(result['url']), title: result['title'] ?? null, status: result['status'] ?? null });
  audit(getOsDb(), { workspaceId, actor, action: `runtime.browser.${actionName}`, subject: sessionId, detail: { url: logUrl(result['url']), title: result['title'] ?? null } });
  return result;
}

export async function browserOpen(workspaceId: string, sessionId: string, url: string, actor = 'browser'): Promise<Record<string, unknown>> {
  const safe = assertSafeOutboundUrl(url).toString();
  return action(workspaceId, sessionId, 'open', { url: safe }, 45_000, actor);
}

export async function browserInspect(workspaceId: string, sessionId: string, actor = 'browser'): Promise<Record<string, unknown>> {
  return action(workspaceId, sessionId, 'inspect', {}, 20_000, actor);
}

export async function browserClick(workspaceId: string, sessionId: string, input: { selector?: string; text?: string }, actor = 'browser', financialApproved = false): Promise<Record<string, unknown>> {
  return action(workspaceId, sessionId, 'click', input, 30_000, actor, financialApproved);
}

export async function browserType(workspaceId: string, sessionId: string, input: { selector: string; text: string; submit?: boolean }, actor = 'browser', financialApproved = false): Promise<Record<string, unknown>> {
  return action(workspaceId, sessionId, 'type', input, 30_000, actor, financialApproved);
}

export async function browserSelect(workspaceId: string, sessionId: string, input: { selector: string; value: string }, actor = 'browser', financialApproved = false): Promise<Record<string, unknown>> {
  return action(workspaceId, sessionId, 'select', input, 20_000, actor, financialApproved);
}

export async function browserScroll(workspaceId: string, sessionId: string, delta = 600, actor = 'browser'): Promise<Record<string, unknown>> {
  return action(workspaceId, sessionId, 'scroll', { delta }, 20_000, actor);
}

export async function browserWait(workspaceId: string, sessionId: string, timeoutMs = 1000, actor = 'browser'): Promise<Record<string, unknown>> {
  return action(workspaceId, sessionId, 'wait', { timeoutMs }, timeoutMs + 5_000, actor);
}

export async function browserScreenshot(workspaceId: string, sessionId: string, input: { fullPage?: boolean; name?: string } = {}, actor = 'browser'): Promise<Record<string, unknown>> {
  const result = await action(workspaceId, sessionId, 'screenshot', { fullPage: input.fullPage !== false }, 30_000, actor);
  const session = getBrowserSession(workspaceId, sessionId)!;
  const artifact = addRuntimeArtifact({
    workspaceId, sessionId, missionId: session.missionId,
    name: input.name ?? `browser-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    kind: 'screenshot', mimeType: 'image/png', storagePath: path.join(session.workspaceDir, String(result['path'] ?? '')),
  });
  return { ...result, artifactId: artifact.id, artifact: { id: artifact.id, name: artifact.name, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes } };
}

export async function browserResearch(workspaceId: string, sessionId: string, input: { url: string; filename?: string }, actor = 'browser'): Promise<Record<string, unknown>> {
  const opened = await browserOpen(workspaceId, sessionId, input.url, actor);
  const inspected = await browserInspect(workspaceId, sessionId, actor);
  const screenshot = await browserScreenshot(workspaceId, sessionId, { fullPage: true, name: 'research-screenshot.png' }, actor);
  const markdown = String(inspected['markdown'] ?? '');
  const filename = input.filename ?? 'research-summary.md';
  const written = writeSessionFile({ workspaceId, sessionId, path: filename, content: markdown, actor });
  const session = getBrowserSession(workspaceId, sessionId)!;
  const document = addRuntimeArtifact({ workspaceId, sessionId, missionId: session.missionId, name: filename, kind: 'markdown', mimeType: 'text/markdown; charset=utf-8', storagePath: path.join(session.workspaceDir, filename) });
  return {
    sessionId, url: opened['url'] ?? input.url, finalUrl: inspected['url'] ?? opened['url'], title: inspected['title'] ?? opened['title'] ?? '',
    status: opened['status'] ?? null, headings: inspected['headings'] ?? [], navigation: inspected['navigation'] ?? [],
    markdown, file: written, documentArtifactId: document.id, screenshotArtifactId: screenshot['artifactId'],
    screenshotPath: screenshot['path'] ?? null, screenshotBytes: screenshot['bytes'] ?? null,
  };
}

async function closeIdleBrowserProxies(): Promise<void> {
  const active = getOsDb().prepare("SELECT COUNT(*) AS c FROM os_runtime_sessions WHERE kind = 'browser' AND status IN ('starting','running')").get() as { c?: number };
  if (Number(active.c ?? 0) > 0) return;
  for (const proxy of proxies.values()) await proxy.close().catch(() => undefined);
  proxies.clear();
}

export async function closeBrowserSession(input: { workspaceId: string; sessionId: string; actor: string; reason?: string; internal?: boolean }): Promise<RuntimeSession> {
  const session = getBrowserSession(input.workspaceId, input.sessionId);
  if (!session) throw new Error('Browser session not found in this workspace');
  assertRuntimeSessionAccess(input.workspaceId, session, input.actor, input.internal === true);
  const runner = runners.get(session.id);
  if (runner) {
    await request(runner, 'close', {}, 10_000).catch(() => undefined);
    await stopRunner(runner);
    runners.delete(session.id);
  }
  const ended = nowIso();
  cleanupBrowserTmp(session);
  getOsDb().prepare("UPDATE os_runtime_sessions SET status = 'stopped', ended_at = ? WHERE id = ?").run(ended, session.id);
  event(session, 'lifecycle', 'browser.stopped', { reason: input.reason ?? 'requested' });
  audit(getOsDb(), { workspaceId: input.workspaceId, actor: input.actor, action: 'runtime.browser.stop', subject: session.id, detail: { reason: input.reason ?? 'requested' } });
  await closeIdleBrowserProxies();
  return { ...session, status: 'stopped', endedAt: ended };
}

export async function expireBrowserSessions(workspaceId?: string): Promise<number> {
  const rows = workspaceId
    ? getOsDb().prepare("SELECT * FROM os_runtime_sessions WHERE workspace_id = ? AND kind = 'browser' AND status IN ('starting','running') AND expires_at <= ?").all(workspaceId, Date.now())
    : getOsDb().prepare("SELECT * FROM os_runtime_sessions WHERE kind = 'browser' AND status IN ('starting','running') AND expires_at <= ?").all(Date.now());
  let count = 0;
  for (const row of rows as Array<Record<string, string | number | null>>) {
    const session = rowToRuntimeSession(row);
    await closeBrowserSession({ workspaceId: session.workspaceId, sessionId: session.id, actor: 'system', reason: 'expired', internal: true }).catch(() => undefined);
    count += 1;
  }
  return count;
}

/** Called at API boot: children from the previous owner are gone. */
export async function recoverBrowserSessions(): Promise<number> {
  const rows = getOsDb().prepare("SELECT * FROM os_runtime_sessions WHERE kind = 'browser' AND status IN ('starting','running')").all() as Array<Record<string, string | number | null>>;
  for (const row of rows) {
    const session = rowToRuntimeSession(row);
    getOsDb().prepare("UPDATE os_runtime_sessions SET status = 'interrupted', ended_at = ?, error = ? WHERE id = ?").run(nowIso(), 'Browser owner restarted; state preserved for inspection but not claimed as completed.', session.id);
    cleanupBrowserTmp(session);
    event(session, 'lifecycle', 'browser.interrupted', { reason: 'owner restart' });
  }
  await cleanupDockerBrowserContainers();
  await closeIdleBrowserProxies();
  return rows.length;
}

export async function closeAllBrowserSessionsForTests(): Promise<void> {
  for (const runner of runners.values()) {
    if (runner.containerName) await removeDockerBrowser(runner.containerName);
    killChild(runner.child);
  }
  runners.clear();
  for (const proxy of proxies.values()) await proxy.close().catch(() => undefined);
  proxies.clear();
}
