import { execFileSync } from 'node:child_process';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { loadKeyring, requireManagedKey } from '../security/keyring.js';
import { dockerProvider } from './providers.js';

/**
 * Fail closed before the API opens a socket when the isolated runtime or its
 * deployment prerequisites are missing. This is intentionally separate from
 * the non-secret environment checks in lib/config.ts.
 */
export async function assertProductionRuntimeReady(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env['NODE_ENV'] === 'development' || env['NODE_ENV'] === 'test') return;

  const root = env['WORA_RUNTIME_ROOT'];
  if (!root) throw new Error('Runtime readiness: WORA_RUNTIME_ROOT is required');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  accessSync(root, constants.R_OK | constants.W_OK);

  try { execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 5_000 }); }
  catch { throw new Error('Runtime readiness: git is required for marketplace synchronization'); }

  loadKeyring(env);
  requireManagedKey();

  const docker = await dockerProvider.detect();
  if (!docker.operational) {
    throw new Error(`Runtime readiness: Docker runtime is not operational: ${docker.reason}`);
  }

  const { browserAvailability } = await import('./browser.js');
  const browser = await browserAvailability();
  if (!browser.available) {
    throw new Error(`Runtime readiness: isolated browser is not operational: ${browser.reason}`);
  }
}
