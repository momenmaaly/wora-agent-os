/**
 * WORA OS — sandboxed workspace root for generated files and artifacts.
 * Everything WORA writes to disk lives under WORA_WORKSPACE/<workspaceId>.
 */
import path from 'node:path';
import { mkdirSync, realpathSync } from 'node:fs';

export function workspaceRoot(): string {
  return process.env['WORA_WORKSPACE']?.trim() || path.join(process.cwd(), 'data', 'workspace');
}

export function workspacePath(workspaceId: string): string {
  const safe = workspaceId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'workspace';
  const dir = path.join(workspaceRoot(), safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve `relative` inside the workspace, rejecting traversal. */
export function resolveInWorkspace(workspaceId: string, relative: string): string {
  const root = realpathSync(workspacePath(workspaceId));
  const target = path.resolve(root, relative || '.');
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Path escapes the sandboxed workspace');
  }
  return target;
}
