/**
 * WORA OS — sandboxed workspace root for generated files and artifacts.
 * Everything WORA writes to disk lives under WORA_WORKSPACE/<workspaceId>.
 */
import path from 'node:path';
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';

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


/**
 * Open a workspace file without following a final-component symlink and verify
 * the opened descriptor still resolves inside the workspace. This closes the
 * final-component race between resolveInWorkspace() and readFileSync/writeFileSync.
 * Ancestor directory swaps remain a local-filesystem risk; the descriptor check
 * detects them before data is returned or written.
 */
export function openWorkspaceFile(
  workspaceId: string,
  relative: string,
  access: 'read' | 'write' = 'read',
  mode = 0o600,
): { fd: number; path: string } {
  const root = realpathSync(workspacePath(workspaceId));
  const target = resolveInWorkspace(workspaceId, relative);
  const flags = access === 'read'
    ? constants.O_RDONLY | constants.O_NOFOLLOW
    : constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
  const fd = openSync(target, flags, mode);
  try {
    const openedPath = process.platform === 'linux'
      ? realpathSync(`/proc/self/fd/${fd}`)
      : realpathSync(target);
    assertInside(root, openedPath);
    return { fd, path: openedPath };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
