/**
 * WORA OS — sandboxed workspace root for generated files and artifacts.
 * Everything WORA writes to disk lives under WORA_WORKSPACE/<workspaceId>.
 */
import path from 'node:path';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';

export function workspaceRoot(): string {
  return process.env['WORA_WORKSPACE']?.trim() || path.join(process.cwd(), 'data', 'workspace');
}

export function workspacePath(workspaceId: string): string {
  const safe = workspaceId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'workspace';
  const dir = path.join(workspaceRoot(), safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function assertInside(root: string, target: string): void {
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Path escapes the sandboxed workspace');
  }
}

function deepestExisting(target: string): string {
  let probe = target;
  for (;;) {
    try {
      lstatSync(probe);
      return probe;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(probe);
    if (parent === probe) return probe;
    probe = parent;
  }
}

/**
 * Resolve `relative` inside the workspace using canonical paths.
 *
 * The lexical check alone is not enough: an existing symlink (or a symlink in
 * an ancestor directory) can point outside the workspace. Resolve the deepest
 * existing component and append only the non-existent tail, then re-check the
 * final canonical target. This supports writes to new files without allowing
 * traversal or symlink escapes.
 */
export function resolveInWorkspace(workspaceId: string, relative: string): string {
  const root = realpathSync(workspacePath(workspaceId));
  const target = path.resolve(root, relative || '.');
  assertInside(root, target);

  const existing = deepestExisting(target);
  let realExisting: string;
  try {
    realExisting = realpathSync(existing);
  } catch {
    throw new Error('Path escapes the sandboxed workspace');
  }
  assertInside(root, realExisting);

  const canonical = path.resolve(realExisting, path.relative(existing, target));
  assertInside(root, canonical);

  if (existsSync(target)) {
    let realTarget: string;
    try {
      realTarget = realpathSync(target);
    } catch {
      throw new Error('Path escapes the sandboxed workspace');
    }
    assertInside(root, realTarget);
    return realTarget;
  }
  return canonical;
}
