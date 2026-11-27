/**
 * WORA cloud computer session manager.
 *
 * The provider owns the execution boundary; this module owns ownership,
 * lifecycle, limits, event history, session file access, artifacts and cleanup.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getOsDb, newId, nowIso, parseJson, audit } from '../os/db.js';
import { redactSecrets } from '../os/secrets.js';
import { resolveSessionPath, sessionDir } from './paths.js';
import { dockerProvider, processProvider, type RuntimeDetection, type RuntimeExecResult, type RuntimeLimits, type RuntimeProvider } from './providers.js';
import { assertRuntimeSessionAccess, canAccessRuntimeSession } from './auth.js';

export type RuntimeKind = 'computer' | 'browser';
export type RuntimeStatus = 'starting' | 'running' | 'stopped' | 'failed' | 'expired' | 'interrupted';

export interface RuntimeSession {
  id: string;
  workspaceId: string;
  missionId: string | null;
  taskId: string | null;
  kind: RuntimeKind;
  provider: RuntimeProvider['id'] | 'browser';
  status: RuntimeStatus;
  workspaceDir: string;
  limits: RuntimeLimits;
  metadata: Record<string, unknown>;
  createdBy: string;
  error: string;
  expiresAt: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

const DEFAULT_LIMITS: RuntimeLimits = { cpus: 1, memoryMb: 512, pids: 128, timeoutMs: 30_000, diskMb: 512 };
const configuredMaxSessions = Number(process.env['WORA_CLOUD_MAX_SESSIONS'] ?? 8);
export const MAX_SESSIONS_PER_WORKSPACE = Number.isInteger(configuredMaxSessions) && configuredMaxSessions > 0 ? configuredMaxSessions : 8;

const rowToSession = (row: Record<string, string | number | null>): RuntimeSession => ({
  id: String(row['id']), workspaceId: String(row['workspace_id']),
  missionId: row['mission_id'] == null ? null : String(row['mission_id']),
  taskId: row['task_id'] == null ? null : String(row['task_id']),
  kind: String(row['kind']) as RuntimeKind, provider: String(row['provider']) as RuntimeProvider['id'] | 'browser',
  status: String(row['status']) as RuntimeStatus, workspaceDir: String(row['workspace_dir']),
  limits: parseJson<RuntimeLimits>(String(row['limits'] ?? '{}'), DEFAULT_LIMITS),
  metadata: parseJson<Record<string, unknown>>(String(row['metadata'] ?? '{}'), {}),
  createdBy: String(row['created_by']), error: String(row['error'] ?? ''),
  expiresAt: Number(row['expires_at']), createdAt: String(row['created_at']),
  startedAt: row['started_at'] == null ? null : String(row['started_at']),
  endedAt: row['ended_at'] == null ? null : String(row['ended_at']),
});

function event(session: RuntimeSession, kind: string, action: string, detail: Record<string, unknown> = {}): void {
  getOsDb().prepare('INSERT INTO os_runtime_events (id, workspace_id, session_id, kind, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('rte'), session.workspaceId, session.id, kind, action, JSON.stringify(redactSecrets(detail).value).slice(0, 20_000), nowIso());
}

function providerFor(id: RuntimeSession['provider']): RuntimeProvider {
  if (id === 'browser') throw new Error('Browser sessions are managed by the browser runtime, not the computer provider');
  return id === 'docker' ? dockerProvider : processProvider;
}

export async function detectProviders(): Promise<RuntimeDetection[]> {
  const [docker, processDetection] = await Promise.all([dockerProvider.detect(), processProvider.detect()]);
  return [docker, processDetection];
}

export async function selectProvider(): Promise<{ provider: RuntimeProvider; detection: RuntimeDetection }> {
  const configured = (process.env['WORA_CLOUD_PROVIDER'] ?? 'auto').trim().toLowerCase();
  const detections = await detectProviders();
  const docker = detections.find((entry) => entry.id === 'docker')!;
  const processDetection = detections.find((entry) => entry.id === 'process')!;
  if (configured === 'docker') {
    if (!docker.operational) throw new Error(`Docker runtime is not operational: ${docker.reason}`);
    return { provider: dockerProvider, detection: docker };
  }
  if (configured === 'process') {
    if (!processDetection.available) throw new Error(`Process runtime is not available: ${processDetection.reason}`);
    return { provider: processProvider, detection: processDetection };
  }
  if (docker.operational) return { provider: dockerProvider, detection: docker };
  if (processDetection.available) return { provider: processProvider, detection: processDetection };
  throw new Error(`No cloud computer provider is operational. Docker: ${docker.reason} Process: ${processDetection.reason}`);
}

export async function runtimeStatus(workspaceId?: string): Promise<Record<string, unknown>> {
  const detections = await detectProviders();
  const db = getOsDb();
  const active = workspaceId
    ? db.prepare("SELECT COUNT(*) AS c FROM os_runtime_sessions WHERE workspace_id = ? AND status IN ('starting','running')").get(workspaceId) as { c?: number }
    : db.prepare("SELECT COUNT(*) AS c FROM os_runtime_sessions WHERE status IN ('starting','running')").get() as { c?: number };
  const failed = workspaceId
    ? db.prepare("SELECT COUNT(*) AS c FROM os_runtime_sessions WHERE workspace_id = ? AND status = 'failed'").get(workspaceId) as { c?: number }
    : db.prepare("SELECT COUNT(*) AS c FROM os_runtime_sessions WHERE status = 'failed'").get() as { c?: number };
  const byProvider = workspaceId
    ? db.prepare("SELECT provider, kind, COUNT(*) AS c FROM os_runtime_sessions WHERE workspace_id = ? AND status IN ('starting','running') GROUP BY provider, kind").all(workspaceId) as Array<Record<string, string | number>>
    : db.prepare("SELECT provider, kind, COUNT(*) AS c FROM os_runtime_sessions WHERE status IN ('starting','running') GROUP BY provider, kind").all() as Array<Record<string, string | number>>;
  const configured = (process.env['WORA_CLOUD_PROVIDER'] ?? 'auto').trim().toLowerCase();
  const selectedDetection = configured === 'docker' || configured === 'process'
    ? detections.find((entry) => entry.id === configured)
    : detections.find((entry) => entry.operational);
  const operational = selectedDetection?.operational === true;
  return {
    configuredProvider: configured,
    operational,
    isolated: selectedDetection?.isolated ?? false,
    selected: selectedDetection?.id ?? null,
    providers: detections,
    activeSessions: Number(active.c ?? 0),
    failedSessions: Number(failed.c ?? 0),
    activeByProvider: byProvider.map((row) => ({ provider: row['provider'], kind: row['kind'], count: Number(row['c']) })),
    limits: DEFAULT_LIMITS,
    maxSessionsPerWorkspace: MAX_SESSIONS_PER_WORKSPACE,
    truth: operational ? 'The selected provider is operational; isolation depends on the selected provider.' : 'The selected provider is not operational. The cloud computer cannot start sessions.',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;
}

export async function createComputerSession(input: {
  workspaceId: string; actor: string; missionId?: string; taskId?: string; kind?: RuntimeKind;
  ttlMinutes?: number; limits?: Partial<RuntimeLimits>; allowNetwork?: boolean;
}): Promise<RuntimeSession> {
  const db = getOsDb();
  if (input.kind === 'browser') throw new Error('Use createBrowserSession for browser sessions');
  const active = db.prepare("SELECT COUNT(*) AS c FROM os_runtime_sessions WHERE workspace_id = ? AND status IN ('starting','running')").get(input.workspaceId) as { c?: number };
  if (Number(active.c ?? 0) >= MAX_SESSIONS_PER_WORKSPACE) throw new Error(`Active cloud session limit reached (${MAX_SESSIONS_PER_WORKSPACE})`);
  const selected = await selectProvider();
  const id = newId('rt');
  const limits: RuntimeLimits = {
    cpus: clamp(input.limits?.cpus ?? DEFAULT_LIMITS.cpus, 0.25, 2),
    memoryMb: clamp(input.limits?.memoryMb ?? DEFAULT_LIMITS.memoryMb, 128, 2048),
    pids: clamp(input.limits?.pids ?? DEFAULT_LIMITS.pids, 16, 512),
    timeoutMs: clamp(input.limits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs, 1_000, 120_000),
    diskMb: clamp(input.limits?.diskMb ?? DEFAULT_LIMITS.diskMb, 64, 2048),
  };
  const ttlMinutes = clamp(input.ttlMinutes ?? 60, 1, 24 * 60);
  const dir = sessionDir(input.workspaceId, id);
  const now = nowIso();
  const session: RuntimeSession = {
    id, workspaceId: input.workspaceId, missionId: input.missionId ?? null, taskId: input.taskId ?? null,
    kind: input.kind ?? 'computer', provider: selected.provider.id, status: 'starting', workspaceDir: dir,
    limits, metadata: {}, createdBy: input.actor, error: '', expiresAt: Date.now() + ttlMinutes * 60_000,
    createdAt: now, startedAt: null, endedAt: null,
  };
  db.prepare(`INSERT INTO os_runtime_sessions
    (id, workspace_id, mission_id, task_id, kind, provider, status, workspace_dir, limits, metadata, created_by, error, expires_at, created_at, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, NULL, NULL)`)
    .run(session.id, session.workspaceId, session.missionId, session.taskId, session.kind, session.provider, session.status, session.workspaceDir, JSON.stringify(session.limits), '{}', session.createdBy, session.expiresAt, session.createdAt);
  event(session, 'lifecycle', 'session.starting', { provider: session.provider, isolated: selected.detection.isolated, limits });
  try {
    const metadata = await selected.provider.create({ sessionId: id, workspaceId: input.workspaceId, limits, allowNetwork: input.allowNetwork === true });
    const started = nowIso();
    session.status = 'running'; session.startedAt = started; session.metadata = metadata;
    db.prepare("UPDATE os_runtime_sessions SET status = 'running', metadata = ?, started_at = ?, error = '' WHERE id = ?")
      .run(JSON.stringify(metadata), started, id);
    event(session, 'lifecycle', 'session.running', { provider: session.provider, metadata: { isolated: metadata['isolated'], network: metadata['network'], container: metadata['container'] ?? null } });
    audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'runtime.session.start', subject: id, detail: { provider: session.provider, kind: session.kind, isolated: selected.detection.isolated, missionId: session.missionId } });
    return { ...session, metadata };
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error)).value;
    db.prepare("UPDATE os_runtime_sessions SET status = 'failed', error = ?, ended_at = ? WHERE id = ?").run(message.slice(0, 2000), nowIso(), id);
    event(session, 'lifecycle', 'session.failed', { error: message });
    audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'runtime.session.failed', subject: id, detail: { provider: session.provider, error: message.slice(0, 500) } });
    throw new Error(`Cloud session failed to start: ${message}`);
  }
}

export function getRuntimeSession(workspaceId: string, sessionId: string): RuntimeSession | null {
  const row = getOsDb().prepare('SELECT * FROM os_runtime_sessions WHERE workspace_id = ? AND id = ?').get(workspaceId, sessionId) as Record<string, string | number | null> | undefined;
  return row ? rowToSession(row) : null;
}

export function getComputerSession(workspaceId: string, sessionId: string): RuntimeSession | null {
  const session = getRuntimeSession(workspaceId, sessionId);
  return session?.kind === 'computer' ? session : null;
}

export function listComputerSessions(workspaceId: string, filter: { missionId?: string; kind?: RuntimeKind; status?: RuntimeStatus; limit?: number; actor: string; internal?: boolean }): RuntimeSession[] {
  const clauses = ['workspace_id = ?', "kind = 'computer'"]; const values: Array<string | number> = [workspaceId];
  if (filter.missionId) { clauses.push('mission_id = ?'); values.push(filter.missionId); }
  if (filter.kind) { clauses.push('kind = ?'); values.push(filter.kind); }
  if (filter.status) { clauses.push('status = ?'); values.push(filter.status); }
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = getOsDb().prepare(`SELECT * FROM os_runtime_sessions WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).all(...values, limit) as Array<Record<string, string | number | null>>;
  const sessions = rows.map(rowToSession);
  return filter.actor && filter.internal !== true
    ? sessions.filter((session) => canAccessRuntimeSession(workspaceId, session, filter.actor))
    : sessions;
}

function requireRunningSession(workspaceId: string, sessionId: string, actor: string, internal = false): RuntimeSession {
  const session = getRuntimeSession(workspaceId, sessionId);
  if (!session) throw new Error('Cloud session not found in this workspace');
  assertRuntimeSessionAccess(workspaceId, session, actor, internal);
  if (session.status !== 'running') throw new Error(`Cloud session is ${session.status}, not running`);
  if (session.expiresAt <= Date.now()) throw new Error('Cloud session has expired');
  return session;
}

export async function execComputer(input: {
  workspaceId: string; actor: string; sessionId: string; command: string; cwd?: string; timeoutMs?: number;
}): Promise<RuntimeExecResult> {
  const session = requireRunningSession(input.workspaceId, input.sessionId, input.actor);
  if (session.kind === 'browser') throw new Error('Use browser tools for a browser session');
  const provider = providerFor(session.provider);
  const result = await provider.exec({ sessionId: session.id, workspaceId: input.workspaceId, command: input.command, cwd: input.cwd, timeoutMs: Math.min(input.timeoutMs ?? session.limits.timeoutMs, session.limits.timeoutMs) });
  event(session, 'exec', 'command.completed', {
    command: input.command.slice(0, 1000), exitCode: result.exitCode, timedOut: result.timedOut,
    durationMs: result.durationMs, stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr),
    stdoutPreview: result.stdout.slice(0, 1000), stderrPreview: result.stderr.slice(0, 1000),
  });
  audit(getOsDb(), { workspaceId: input.workspaceId, actor: input.actor, action: 'runtime.exec', subject: session.id, detail: { command: input.command.slice(0, 500), exitCode: result.exitCode, timedOut: result.timedOut } });
  return result;
}

export function writeSessionFile(input: { workspaceId: string; sessionId: string; path: string; content: string; actor: string; internal?: boolean }): { path: string; bytes: number } {
  const session = requireRunningSession(input.workspaceId, input.sessionId, input.actor, input.internal === true);
  if (Buffer.byteLength(input.content, 'utf8') > 2 * 1024 * 1024) throw new Error('File content exceeds the 2 MB cloud write limit');
  const target = resolveSessionPath(session.workspaceDir, input.path);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, input.content, 'utf8'); } finally { closeSync(fd); }
  const bytes = statSync(target).size;
  event(session, 'file', 'file.write', { path: input.path, bytes });
  audit(getOsDb(), { workspaceId: input.workspaceId, actor: input.actor, action: 'runtime.file.write', subject: session.id, detail: { path: input.path, bytes } });
  return { path: input.path, bytes };
}

export function readSessionFile(input: { workspaceId: string; sessionId: string; path: string; maxBytes?: number; actor: string; internal?: boolean }): { path: string; content: string; bytes: number; truncated: boolean } {
  const session = requireRunningSession(input.workspaceId, input.sessionId, input.actor, input.internal === true);
  const target = resolveSessionPath(session.workspaceDir, input.path);
  const stat = statSync(target);
  if (!stat.isFile()) throw new Error('Path is not a file');
  const cap = Math.min(input.maxBytes ?? 256_000, 1_000_000);
  const raw = readFileSync(target);
  event(session, 'file', 'file.read', { path: input.path, bytes: raw.byteLength });
  return { path: input.path, content: raw.subarray(0, cap).toString('utf8'), bytes: raw.byteLength, truncated: raw.byteLength > cap };
}

export function listSessionFiles(workspaceId: string, sessionId: string, dir: string, actor: string, internal = false): Array<{ name: string; type: string; size: number | null }> {
  const session = requireRunningSession(workspaceId, sessionId, actor, internal);
  const target = resolveSessionPath(session.workspaceDir, dir);
  const stat = statSync(target);
  if (!stat.isDirectory()) throw new Error('Path is not a directory');
  return readdirSync(target, { withFileTypes: true }).slice(0, 500).map((entry) => {
    let size: number | null = null;
    try { size = entry.isFile() ? statSync(path.join(target, entry.name)).size : null; } catch { size = null; }
    return { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size };
  });
}

export function addRuntimeArtifact(input: {
  workspaceId: string; sessionId: string; missionId?: string | null; name: string; kind: string; mimeType: string; storagePath: string;
}): { id: string; name: string; kind: string; mimeType: string; sizeBytes: number; createdAt: string; path: string } {
  const session = getRuntimeSession(input.workspaceId, input.sessionId);
  if (!session) throw new Error('Cloud session not found');
  const target = resolveSessionPath(session.workspaceDir, path.relative(session.workspaceDir, input.storagePath));
  const stat = statSync(target);
  if (!stat.isFile()) throw new Error('Artifact path is not a file');
  const id = newId('rta');
  const createdAt = nowIso();
  getOsDb().prepare('INSERT INTO os_runtime_artifacts (id, workspace_id, session_id, mission_id, name, kind, mime_type, size_bytes, storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.workspaceId, session.id, input.missionId ?? session.missionId ?? null, input.name, input.kind, input.mimeType, stat.size, target, createdAt);
  audit(getOsDb(), { workspaceId: input.workspaceId, actor: 'runtime', action: 'runtime.artifact.create', subject: id, detail: { sessionId: session.id, kind: input.kind, bytes: stat.size } });
  return { id, name: input.name, kind: input.kind, mimeType: input.mimeType, sizeBytes: stat.size, createdAt, path: target };
}

export function listRuntimeArtifacts(workspaceId: string, filter: { missionId?: string; sessionId?: string; limit?: number; actor: string; internal?: boolean }): Array<{ id: string; sessionId: string; name: string; kind: string; mimeType: string; sizeBytes: number; createdAt: string }> {
  const clauses = ['workspace_id = ?']; const values: Array<string | number> = [workspaceId];
  if (filter.missionId) { clauses.push('mission_id = ?'); values.push(filter.missionId); }
  if (filter.sessionId) { clauses.push('session_id = ?'); values.push(filter.sessionId); }
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = getOsDb().prepare(`SELECT * FROM os_runtime_artifacts WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).all(...values, limit) as Array<Record<string, string | number>>;
  const visible = filter.internal !== true
    ? rows.filter((row) => {
      const session = getRuntimeSession(workspaceId, String(row['session_id']));
      return Boolean(session && canAccessRuntimeSession(workspaceId, session, filter.actor));
    })
    : rows;
  return visible.map((row) => ({ id: String(row['id']), sessionId: String(row['session_id']), name: String(row['name']), kind: String(row['kind']), mimeType: String(row['mime_type']), sizeBytes: Number(row['size_bytes']), createdAt: String(row['created_at']) }));
}

export function getRuntimeArtifact(workspaceId: string, artifactId: string, actor: string, internal = false): { row: Record<string, string | number>; absolutePath: string } | null {
  const row = getOsDb().prepare('SELECT * FROM os_runtime_artifacts WHERE workspace_id = ? AND id = ?').get(workspaceId, artifactId) as Record<string, string | number> | undefined;
  if (!row) return null;
  const session = getRuntimeSession(workspaceId, String(row['session_id']));
  if (!session) return null;
  assertRuntimeSessionAccess(workspaceId, session, actor, internal);
  const absolutePath = resolveSessionPath(session.workspaceDir, path.relative(session.workspaceDir, String(row['storage_path'])));
  return existsSync(absolutePath) ? { row, absolutePath } : null;
}

export function listRuntimeEvents(workspaceId: string, sessionId: string, limit = 100): Array<Record<string, unknown>> {
  const rows = getOsDb().prepare('SELECT id, kind, action, detail, created_at FROM os_runtime_events WHERE workspace_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, sessionId, Math.min(Math.max(limit, 1), 500)) as Array<Record<string, string>>;
  return rows.map((row) => ({ id: row['id'], kind: row['kind'], action: row['action'], detail: redactSecrets(parseJson(row['detail'], {})).value, createdAt: row['created_at'] }));
}

export async function stopComputerSession(input: { workspaceId: string; sessionId: string; actor: string; reason?: string; internal?: boolean }): Promise<RuntimeSession> {
  const session = getComputerSession(input.workspaceId, input.sessionId);
  if (!session) throw new Error('Cloud session not found in this workspace');
  assertRuntimeSessionAccess(input.workspaceId, session, input.actor, input.internal === true);
  if (['stopped', 'expired', 'failed', 'interrupted'].includes(session.status)) return session;
  try { await providerFor(session.provider).stop({ sessionId: session.id, workspaceId: session.workspaceId, metadata: session.metadata }); } catch (error) {
    event(session, 'lifecycle', 'session.stop_failed', { error: error instanceof Error ? error.message : String(error) });
  }
  const ended = nowIso();
  getOsDb().prepare("UPDATE os_runtime_sessions SET status = 'stopped', ended_at = ? WHERE id = ?").run(ended, session.id);
  event(session, 'lifecycle', 'session.stopped', { reason: input.reason ?? 'requested' });
  audit(getOsDb(), { workspaceId: input.workspaceId, actor: input.actor, action: 'runtime.session.stop', subject: session.id, detail: { reason: input.reason ?? 'requested' } });
  return { ...session, status: 'stopped', endedAt: ended };
}

export async function expireRuntimeSessions(workspaceId?: string): Promise<number> {
  const db = getOsDb();
  const rows = workspaceId
    ? db.prepare("SELECT * FROM os_runtime_sessions WHERE workspace_id = ? AND kind = 'computer' AND status IN ('starting','running') AND expires_at <= ?").all(workspaceId, Date.now())
    : db.prepare("SELECT * FROM os_runtime_sessions WHERE kind = 'computer' AND status IN ('starting','running') AND expires_at <= ?").all(Date.now());
  let count = 0;
  for (const row of rows as Array<Record<string, string | number | null>>) {
    const session = rowToSession(row);
    try { await providerFor(session.provider).stop({ sessionId: session.id, workspaceId: session.workspaceId, metadata: session.metadata }); } catch { /* best effort */ }
    db.prepare("UPDATE os_runtime_sessions SET status = 'expired', ended_at = ? WHERE id = ?").run(nowIso(), session.id);
    event(session, 'lifecycle', 'session.expired', {});
    count += 1;
  }
  return count;
}

/** Mark sessions whose in-process owner disappeared and release provider resources. */
export async function recoverRuntimeSessions(workspaceId?: string): Promise<number> {
  const db = getOsDb();
  const rows = workspaceId
    ? db.prepare("SELECT * FROM os_runtime_sessions WHERE workspace_id = ? AND kind = 'computer' AND status IN ('starting','running')").all(workspaceId)
    : db.prepare("SELECT * FROM os_runtime_sessions WHERE kind = 'computer' AND status IN ('starting','running')").all();
  let count = 0;
  for (const row of rows as Array<Record<string, string | number | null>>) {
    const session = rowToSession(row);
    try { await providerFor(session.provider).stop({ sessionId: session.id, workspaceId: session.workspaceId, metadata: session.metadata }); } catch { /* best effort */ }
    db.prepare("UPDATE os_runtime_sessions SET status = 'interrupted', ended_at = ?, error = ? WHERE id = ?").run(nowIso(), 'Runtime owner restarted; session state is not claimed as completed.', session.id);
    event(session, 'lifecycle', 'session.interrupted', { reason: 'owner restart' });
    count += 1;
  }
  return count;
}

export function runtimeDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 32);
}

/** Stop sessions for a terminal mission after artifacts have been persisted. */
export async function cleanupMissionSessions(workspaceId: string, missionId: string, actor: string): Promise<number> {
  const sessions = listComputerSessions(workspaceId, { missionId, limit: 200, actor, internal: true }).filter((session) => ['starting', 'running'].includes(session.status));
  let count = 0;
  for (const session of sessions) {
    try { await stopComputerSession({ workspaceId, sessionId: session.id, actor, reason: 'mission finalized', internal: true }); count += 1; } catch { /* one bad session must not block finalization */ }
  }
  return count;
}
