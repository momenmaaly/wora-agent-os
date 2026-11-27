/**
 * Isolated execution providers for the WORA cloud computer.
 *
 * Docker is the only production-grade provider: the container is the isolation
 * boundary, the session directory is the only host mount, and the default
 * network mode is `none`. The process provider is an explicitly non-isolated
 * development fallback for environments without a Docker daemon; it is never
 * selected in production unless an operator opts in.
 */
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getOsDb } from '../os/db.js';
import { runtimeRoot, sessionDir } from './paths.js';

const execFileAsync = promisify(execFile);

export interface RuntimeLimits {
  cpus: number;
  memoryMb: number;
  pids: number;
  timeoutMs: number;
  diskMb: number;
}

export interface RuntimeDetection {
  id: 'docker' | 'process';
  label: string;
  available: boolean;
  operational: boolean;
  isolated: boolean;
  reason: string;
  details: Record<string, unknown>;
}

export interface RuntimeExecInput {
  sessionId: string;
  workspaceId: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface RuntimeExecResult {
  sessionId: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  provider: RuntimeProvider['id'];
}

export interface RuntimeCreateInput {
  sessionId: string;
  workspaceId: string;
  limits: RuntimeLimits;
  image?: string;
  allowNetwork?: boolean;
}

export interface RuntimeProvider {
  readonly id: 'docker' | 'process';
  detect(): Promise<RuntimeDetection>;
  create(input: RuntimeCreateInput): Promise<Record<string, unknown>>;
  exec(input: RuntimeExecInput): Promise<RuntimeExecResult>;
  stop(session: { sessionId: string; workspaceId: string; metadata: Record<string, unknown> }): Promise<void>;
}

const PRLIMIT = existsSync('/usr/bin/prlimit') ? '/usr/bin/prlimit' : '';
const MAX_OUTPUT = 256 * 1024;
const SAFE_ENV = (home: string): NodeJS.ProcessEnv => ({
  PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: home,
  TMPDIR: path.join(home, 'tmp'),
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  NODE_ENV: 'production',
  CI: '1',
});

function appendCapped(target: Buffer[], chunk: Buffer, state: { total: number }): void {
  if (state.total >= MAX_OUTPUT) return;
  const remaining = MAX_OUTPUT - state.total;
  target.push(chunk.subarray(0, remaining));
  state.total += Math.min(chunk.byteLength, remaining);
}

function processAllowed(): boolean {
  return process.env['NODE_ENV'] !== 'production' || process.env['WORA_CLOUD_ALLOW_PROCESS_PROVIDER'] === '1';
}

export const processProvider: RuntimeProvider = {
  id: 'process',
  async detect() {
    const enabled = processAllowed();
    return {
      id: 'process', label: 'Local process sandbox', available: enabled, operational: enabled, isolated: false,
      reason: enabled
        ? 'Development provider enabled. Commands run in a child process with a session-scoped directory and resource limits, but without a kernel filesystem/network jail.'
        : 'Disabled in production. Set WORA_CLOUD_ALLOW_PROCESS_PROVIDER=1 only for a controlled development deployment.',
      details: { prlimit: Boolean(PRLIMIT), cwd: runtimeRoot(), kernelIsolation: false },
    };
  },
  async create(input) {
    const dir = sessionDir(input.workspaceId, input.sessionId);
    return { workspaceDir: dir, container: null, isolated: false, network: 'host' };
  },
  async exec(input) {
    const dir = sessionDir(input.workspaceId, input.sessionId);
    const cwd = input.cwd ? path.resolve(dir, input.cwd) : dir;
    if (cwd !== dir && !cwd.startsWith(dir + path.sep)) throw new Error('Command cwd escapes the runtime session');
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 30_000, 1_000), 120_000);
    const limits = { as: 6 * 1024 * 1024 * 1024, cpu: Math.ceil(timeoutMs / 1000), nofile: 512, nproc: 4096 };
    const command = PRLIMIT
      ? PRLIMIT
      : '/bin/sh';
    const args = PRLIMIT
      ? [`--as=${limits.as}`, `--cpu=${limits.cpu}`, `--nofile=${limits.nofile}`, `--nproc=${limits.nproc}`, '--', '/bin/sh', '-lc', input.command]
      : ['-lc', input.command];
    const home = dir;
    const child = spawn(command, args, {
      cwd, env: SAFE_ENV(home), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const started = Date.now();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const outState = { total: 0 };
    const errState = { total: 0 };
    child.stdout?.on('data', (chunk: Buffer) => appendCapped(stdout, chunk, outState));
    child.stderr?.on('data', (chunk: Buffer) => appendCapped(stderr, chunk, errState));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* exited */ } }
    }, timeoutMs);
    timer.unref?.();
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('error', () => resolve({ code: null, signal: 'SIGTERM' }));
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timer);
    const stdoutText = Buffer.concat(stdout).toString('utf8');
    const stderrText = Buffer.concat(stderr).toString('utf8');
    return {
      sessionId: input.sessionId, command: input.command, cwd: path.relative(dir, cwd) || '.',
      exitCode: timedOut ? null : result.code, signal: result.signal,
      stdout: stdoutText, stderr: stderrText, durationMs: Date.now() - started,
      timedOut, truncated: outState.total >= MAX_OUTPUT || errState.total >= MAX_OUTPUT, provider: 'process',
    };
  },
  async stop() { /* no persistent process is created by the process provider */ },
};

export const dockerProvider: RuntimeProvider = {
  id: 'docker',
  async detect() {
    try {
      const { stdout } = await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5_000 });
      const server = stdout.trim();
      let image = false;
      try { await execFileAsync('docker', ['image', 'inspect', process.env['WORA_CLOUD_IMAGE'] ?? 'node:22-alpine'], { timeout: 5_000 }); image = true; } catch { image = false; }
      return {
        id: 'docker', label: 'Docker isolated container', available: Boolean(server), operational: Boolean(server) && image, isolated: true,
        reason: !server ? 'Docker daemon is not reachable.' : image ? 'Docker and the configured runtime image are available.' : 'Docker is available but the runtime image is missing; set WORA_CLOUD_IMAGE or enable WORA_CLOUD_DOCKER_PULL=1.',
        details: { serverVersion: server, image: process.env['WORA_CLOUD_IMAGE'] ?? 'node:22-alpine', imagePresent: image },
      };
    } catch (error) {
      return { id: 'docker', label: 'Docker isolated container', available: false, operational: false, isolated: true, reason: error instanceof Error ? error.message : 'Docker is unavailable', details: {} };
    }
  },
  async create(input) {
    const dir = sessionDir(input.workspaceId, input.sessionId);
    const image = input.image ?? process.env['WORA_CLOUD_IMAGE'] ?? 'node:22-alpine';
    const name = `wora-cloud-${input.sessionId.replace(/[^A-Za-z0-9_.-]/g, '-')}`;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
    try { await execFileAsync('docker', ['image', 'inspect', image], { timeout: 5_000 }); }
    catch {
      if (process.env['WORA_CLOUD_DOCKER_PULL'] !== '1') throw new Error(`Docker image ${image} is not present; enable WORA_CLOUD_DOCKER_PULL=1`);
      await execFileAsync('docker', ['pull', image], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    }
    const limits = input.limits;
    const network = input.allowNetwork === true ? 'bridge' : 'none';
    await execFileAsync('docker', [
      'run', '-d', '--name', name,
      '--label', `wora.session=${input.sessionId}`,
      '--label', `wora.workspace=${input.workspaceId}`,
      '--network', network,
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', String(limits.pids),
      '--memory', `${limits.memoryMb}m`,
      '--cpus', String(limits.cpus),
      '--user', `${uid}:${gid}`,
      '-v', `${dir}:/workspace:rw`,
      '-w', '/workspace',
      image, 'sh', '-lc', 'while :; do sleep 3600; done',
    ], { timeout: 60_000 });
    return { workspaceDir: dir, container: name, isolated: true, network, image };
  },
  async exec(input) {
    const session = getRuntimeSessionForProvider(input.workspaceId, input.sessionId);
    const container = String(session?.metadata?.['container'] ?? '');
    if (!container) throw new Error('Docker session has no container');
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 30_000, 1_000), 120_000);
    const seconds = Math.ceil(timeoutMs / 1000);
    const cwd = input.cwd ? path.posix.normalize(`/workspace/${input.cwd}`) : '/workspace';
    if (!cwd.startsWith('/workspace')) throw new Error('Command cwd escapes the runtime session');
    const started = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync('docker', [
        'exec', '-i', container, 'timeout', '-s', 'KILL', String(seconds), '/bin/sh', '-lc', `cd '${cwd.replace(/'/g, `'\\''`)}' && ${input.command}`,
      ], { timeout: timeoutMs + 2_000, maxBuffer: MAX_OUTPUT, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
      return {
        sessionId: input.sessionId, command: input.command, cwd: path.relative('/workspace', cwd) || '.',
        exitCode: 0, signal: null, stdout, stderr, durationMs: Date.now() - started, timedOut: false,
        truncated: stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT, provider: 'docker',
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; killed?: boolean; signal?: string; code?: string };
      const timedOut = Boolean(err.killed) || err.code === 'ETIMEDOUT' || Number(err.code) === 124 || Number(err.code) === 137 || /timed out/i.test(String(err.stderr ?? ''));
      return {
        sessionId: input.sessionId, command: input.command, cwd: path.relative('/workspace', cwd) || '.',
        exitCode: typeof err.code === 'number' ? err.code : null, signal: err.signal ?? null,
        stdout: err.stdout ?? '', stderr: err.stderr ?? '', durationMs: Date.now() - started,
        timedOut, truncated: false, provider: 'docker',
      };
    }
  },
  async stop(session) {
    const container = String(session.metadata?.['container'] ?? `wora-cloud-${session.sessionId.replace(/[^A-Za-z0-9_.-]/g, '-')}`);
    try { await execFileAsync('docker', ['rm', '-f', container], { timeout: 20_000 }); } catch { /* already gone */ }
  },
};

function getRuntimeSessionForProvider(workspaceId: string, sessionId: string): { metadata: Record<string, unknown> } | null {
  try {
    const row = getOsDb().prepare('SELECT metadata FROM os_runtime_sessions WHERE workspace_id = ? AND id = ?').get(workspaceId, sessionId) as { metadata?: string } | undefined;
    return row ? { metadata: JSON.parse(row.metadata ?? '{}') as Record<string, unknown> } : null;
  } catch { return null; }
}

export function availableProviders(): RuntimeProvider[] {
  return [dockerProvider, processProvider];
}

export function selectProviderSync(): RuntimeProvider | null {
  const configured = (process.env['WORA_CLOUD_PROVIDER'] ?? 'auto').trim().toLowerCase();
  if (configured === 'docker') return dockerProvider;
  if (configured === 'process') return processProvider;
  return null;
}
