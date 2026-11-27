import path from 'node:path';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';

export function runtimeRoot(): string {
  return process.env['WORA_RUNTIME_ROOT']?.trim() || path.join(process.cwd(), 'data', 'runtime');
}

export function sessionDir(workspaceId: string, sessionId: string): string {
  const safeWorkspace = workspaceId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'workspace';
  const safeSession = sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'session';
  const dir = path.join(runtimeRoot(), safeWorkspace, safeSession);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function assertInside(root: string, target: string): void {
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path escapes the runtime session');
}

function deepestExisting(target: string): string {
  let probe = target;
  for (;;) {
    try { lstatSync(probe); return probe; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(probe);
    if (parent === probe) return probe;
    probe = parent;
  }
}

export function resolveSessionPath(root: string, relative: string): string {
  const canonicalRoot = realpathSync(root);
  const target = path.resolve(canonicalRoot, relative || '.');
  assertInside(canonicalRoot, target);
  const existing = deepestExisting(target);
  const realExisting = realpathSync(existing);
  assertInside(canonicalRoot, realExisting);
  const canonical = path.resolve(realExisting, path.relative(existing, target));
  assertInside(canonicalRoot, canonical);
  if (existsSync(target)) assertInside(canonicalRoot, realpathSync(target));
  return canonical;
}
