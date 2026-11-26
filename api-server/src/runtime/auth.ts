/**
 * Runtime session authorization.
 *
 * A workspace ID is not proof of ownership. Every user-facing runtime entry
 * point must pass the authenticated actor through here. Internal lifecycle
 * operations opt in explicitly with `internal: true`; that flag is never part
 * of a tool schema or an HTTP request body.
 */
import { getOsDb } from '../os/db.js';
import { getWorkspaceRole } from '../os/roles.js';

export class RuntimeAccessError extends Error {
  readonly status = 403;
  readonly code = 'RUNTIME_SESSION_FORBIDDEN';

  constructor(message = 'Runtime session is not accessible to this actor') {
    super(message);
    this.name = 'RuntimeAccessError';
  }
}

export interface RuntimeSessionOwnership {
  workspaceId: string;
  createdBy: string;
  missionId?: string | null;
}

export function canAccessRuntimeSession(
  workspaceId: string,
  session: RuntimeSessionOwnership,
  actor: string,
  internal = false,
): boolean {
  if (internal) return true;
  if (!actor || !workspaceId || session.workspaceId !== workspaceId) return false;
  if (session.createdBy === actor) return true;
  if (session.missionId) {
    const mission = getOsDb().prepare('SELECT requested_by FROM os_missions WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, session.missionId) as { requested_by?: string } | undefined;
    if (mission?.requested_by === actor) return true;
  }
  const role = getWorkspaceRole(workspaceId, actor);
  return role === 'admin' || role === 'owner';
}

export function assertRuntimeSessionAccess(
  workspaceId: string,
  session: RuntimeSessionOwnership,
  actor: string,
  internal = false,
): void {
  if (!canAccessRuntimeSession(workspaceId, session, actor, internal)) {
    throw new RuntimeAccessError();
  }
}
