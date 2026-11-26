/**
 * Process-level resource isolation for stdio MCP servers.
 *
 * This is NOT a filesystem or network sandbox. It enforces CPU time, address
 * space, file size, open files and process count with the OS `prlimit` utility
 * when available, and reports the exact enforced limits. Filesystem confinement
 * is limited to a temporary HOME/cwd; network access is not restricted. A true
 * sandbox (bubblewrap/nsjail/container) must be supplied by the deployment.
 */
import { existsSync } from 'node:fs';

export interface IsolationStatus {
  mode: 'resource-limits' | 'none';
  tool: 'prlimit' | null;
  limits: Record<string, number>;
  limitations: string[];
}

const PRLIMIT = ['/usr/bin/prlimit', '/bin/prlimit'].find((candidate) => existsSync(candidate)) ?? null;

/**
 * Environment variables that can turn a declared secret into code execution
 * or redirect a runtime's module/config loading. They are never inherited by
 * a stdio MCP child, even when a manifest declares them.
 */
export const DANGEROUS_MCP_ENV = new Set([
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE',
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  'PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'PYTHONINSPECT',
  'BASH_ENV', 'ENV', 'SHELLOPTS', 'PS4',
  'PATH', 'HOME', 'TMPDIR', 'SHELL', 'IFS',
]);

export function isDangerousMcpEnv(name: string): boolean {
  return DANGEROUS_MCP_ENV.has(name.trim().toUpperCase());
}

function positiveInt(name: string, fallback: number, max: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 && raw <= max ? raw : fallback;
}

export function isolationStatus(): IsolationStatus {
  if (!PRLIMIT || process.env['WORA_MCP_RESOURCE_LIMITS'] === '0') {
    return { mode: 'none', tool: null, limits: {}, limitations: ['No OS resource limiter is configured; stdio MCP servers inherit API process limits.'] };
  }
  return {
    mode: 'resource-limits', tool: 'prlimit',
    limits: {
      addressSpaceBytes: positiveInt('WORA_MCP_MEMORY_MB', 2_048, 16_384) * 1024 * 1024,
      cpuSeconds: positiveInt('WORA_MCP_CPU_SECONDS', 60, 3_600),
      fileSizeBytes: positiveInt('WORA_MCP_FSIZE_MB', 32, 1_024) * 1024 * 1024,
      openFiles: positiveInt('WORA_MCP_NOFILE', 1_024, 8_192),
      processes: positiveInt('WORA_MCP_NPROC', 4_096, 8_192),
    },
    limitations: [
      'Filesystem access is not namespaced; the child runs with a temporary HOME/cwd but can read paths allowed to the API user.',
      'Network access is not restricted by prlimit.',
      'A container, bubblewrap or nsjail runner is required for a real sandbox.',
    ],
  };
}

export function resourceLimitedCommand(
  command: string,
  args: string[],
  overrides: { addressSpaceBytes?: number } = {},
): { command: string; args: string[]; isolation: IsolationStatus } {
  const status = isolationStatus();
  if (status.mode !== 'resource-limits' || !PRLIMIT) return { command, args, isolation: status };
  const limits: Record<string, number> = { ...status.limits, ...overrides };
  return {
    command: PRLIMIT,
    args: [
      `--as=${limits['addressSpaceBytes']}`,
      `--cpu=${limits['cpuSeconds']}`,
      `--fsize=${limits['fileSizeBytes']}`,
      `--nofile=${limits['openFiles']}`,
      `--nproc=${limits['processes']}`,
      '--',
      command,
      ...args,
    ],
    isolation: { ...status, limits },
  };
}
