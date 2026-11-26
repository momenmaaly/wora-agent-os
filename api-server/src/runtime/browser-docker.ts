/**
 * Isolated browser container management.
 *
 * The browser container gets a read-only image, only the session workspace as a
 * writable bind mount, no capabilities, resource limits, an internal network and
 * a connection-time validating proxy. Production uses Chromium's own sandbox by
 * default; an explicit container-only mode exists for controlled test hosts
 * where user namespaces are unavailable.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RuntimeSession } from './cloud.js';

const execFileAsync = promisify(execFile);
const NETWORK = 'wora-browser-egress';
const DEFAULT_IMAGE = 'wora-browser-runtime:1.0.0';
const probeCache = new Map<string, { available: boolean; reason: string; checkedAt: number }>();

export type BrowserSandboxMode = 'chromium' | 'container';

export function browserImage(): string {
  return (process.env['WORA_BROWSER_IMAGE'] ?? DEFAULT_IMAGE).trim();
}

export function browserSandboxMode(): BrowserSandboxMode {
  const configured = (process.env['WORA_BROWSER_SANDBOX'] ?? '').trim().toLowerCase();
  if (configured === 'container') {
    if (process.env['NODE_ENV'] === 'production' && process.env['WORA_BROWSER_ALLOW_CONTAINER_SANDBOX'] !== '1') {
      throw new Error('Container sandbox mode is disabled in production; set WORA_BROWSER_SANDBOX=chromium or explicitly allow the container-only mode.');
    }
    return 'container';
  }
  return 'chromium';
}

export function dockerBrowserConfigured(): boolean {
  return (process.env['WORA_BROWSER_PROVIDER'] ?? '').trim().toLowerCase() === 'docker';
}

export async function dockerCommand(args: string[], timeoutMs = 15_000): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync('docker', args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
}

export function browserContainerSecurityArgs(mode: BrowserSandboxMode): string[] {
  const args = ['--read-only', '--tmpfs', '/tmp:rw,exec,nosuid,size=256m', '--cap-drop', 'ALL', '--pids-limit', '256', '--memory', '1g', '--cpus', '1', '--stop-timeout', '5'];
  if (mode === 'container') args.push('--security-opt', 'no-new-privileges');
  return args;
}

export async function dockerBrowserAvailability(): Promise<{ available: boolean; reason: string; image: string }> {
  const image = browserImage();
  try { await dockerCommand(['info', '--format', '{{.ServerVersion}}'], 5_000); }
  catch (error) { return { available: false, reason: `Docker daemon is not reachable: ${error instanceof Error ? error.message : String(error)}`, image }; }
  try { await dockerCommand(['image', 'inspect', image], 5_000); }
  catch { return { available: false, reason: `Browser image ${image} is missing. Build it with the browser-runtime Dockerfile.`, image }; }
  let mode: BrowserSandboxMode;
  try { mode = browserSandboxMode(); }
  catch (error) { return { available: false, reason: error instanceof Error ? error.message : String(error), image }; }
  const key = `${image}:${mode}`;
  const cached = probeCache.get(key);
  if (cached && Date.now() - cached.checkedAt < 60_000) return { available: cached.available, reason: cached.reason, image };
  const probe = await dockerBrowserProbe(mode, image);
  probeCache.set(key, { ...probe, checkedAt: Date.now() });
  return { ...probe, image };
}

async function dockerBrowserProbe(mode: BrowserSandboxMode, image: string): Promise<{ available: boolean; reason: string }> {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 10001;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 10001;
  const args = ['run', '--rm', '--network', 'none', '--user', `${uid}:${gid}`, ...browserContainerSecurityArgs(mode), '--entrypoint', '/usr/bin/chromium', image,
    '--headless', '--no-first-run', '--disable-gpu', ...(mode === 'container' ? ['--no-sandbox'] : []), '--dump-dom', 'about:blank'];
  try {
    const result = await dockerCommand(args, 25_000);
    return { available: true, reason: result.stdout.trim() ? 'Chromium sandbox and container boundary are operational.' : 'Chromium probe returned no DOM output.' };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { available: false, reason: `Chromium container probe failed (${mode} sandbox): ${text.slice(0, 500)}`, };
  }
}

export async function ensureBrowserNetwork(): Promise<{ gateway: string; subnet: string }> {
  try { await dockerCommand(['network', 'inspect', NETWORK], 5_000); }
  catch {
    await dockerCommand(['network', 'create', '--internal', '--label', 'wora.runtime=browser', NETWORK], 20_000).catch((error) => {
      throw new Error(`Could not create the isolated browser network: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  const { stdout } = await dockerCommand(['network', 'inspect', NETWORK, '--format', '{{(index .IPAM.Config 0).Gateway}}|{{(index .IPAM.Config 0).Subnet}}'], 5_000);
  const [gateway, subnet] = stdout.trim().split('|');
  if (!gateway || !subnet || !subnet.includes('/')) throw new Error('The isolated browser network has no IPv4 gateway or subnet');
  return { gateway, subnet };
}

export function browserContainerName(sessionId: string): string {
  return `wora-browser-${sessionId.replace(/[^a-zA-Z0-9_.-]/gu, '').slice(0, 60)}`;
}

export interface DockerBrowserStart {
  child: ChildProcessWithoutNullStreams;
  containerName: string;
}

export function startDockerBrowser(input: {
  session: RuntimeSession;
  sessionDir: string;
  proxyUrl: string;
  proxySocketPath?: string;
  mode: BrowserSandboxMode;
}): DockerBrowserStart {
  const containerName = browserContainerName(input.session.id);
  void execFileAsync('docker', ['rm', '-f', containerName], { timeout: 10_000 }).catch(() => undefined);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 10001;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 10001;
  const args = [
    'run', '-i', '--rm', '--name', containerName, '--hostname', 'wora-browser',
    '--network', NETWORK, '--user', `${uid}:${gid}`,
    ...browserContainerSecurityArgs(input.mode),
    '-v', `${input.sessionDir}:/workspace:rw`,
    '-w', '/workspace',
    '-e', 'WORA_BROWSER_SESSION_DIR=/workspace',
    '-e', 'HOME=/tmp',
    '-e', `NODE_ENV=${process.env['NODE_ENV'] ?? 'production'}`,
    '-e', 'TMPDIR=/tmp',
    '-e', `WORA_BROWSER_PROXY_URL=${input.proxyUrl}`,
    ...(input.proxySocketPath ? ['-e', `WORA_BROWSER_PROXY_SOCKET=/workspace/${path.basename(input.proxySocketPath)}`] : []),
    ...(process.env['NODE_ENV'] === 'test' && process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] === '1' ? [
      '-e', 'WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS=1',
      ...(process.env['WORA_TEST_ALLOWED_PORTS'] ? ['-e', `WORA_TEST_ALLOWED_PORTS=${process.env['WORA_TEST_ALLOWED_PORTS']}`] : []),
    ] : []),
    '-e', `WORA_BROWSER_NO_SANDBOX=${input.mode === 'container' ? '1' : '0'}`,
    '-e', `WORA_BROWSER_SANDBOX=${input.mode}`,
    '--label', 'wora.runtime=browser',
    '--label', `wora.session=${input.session.id}`,
    browserImage(),
  ];
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  return { child, containerName };
}

export async function removeDockerBrowser(containerName: string): Promise<void> {
  await execFileAsync('docker', ['rm', '-f', containerName], { timeout: 10_000 }).catch(() => undefined);
}

export async function cleanupDockerBrowserContainers(): Promise<number> {
  try {
    const { stdout } = await dockerCommand(['ps', '-aq', '--filter', 'label=wora.runtime=browser'], 5_000);
    const ids = stdout.split(/\s+/u).filter(Boolean);
    for (const id of ids) await execFileAsync('docker', ['rm', '-f', id], { timeout: 10_000 }).catch(() => undefined);
    return ids.length;
  } catch { return 0; }
}
