/**
 * Server-side scope and target authorization for extensions.
 *
 * Client-supplied scope IDs are never trusted. Installation scopes and agent
 * policy targets must name an entity that exists in the same workspace, and
 * instance-wide changes require an administrator.
 */
import { getOsDb } from '../os/db.js';
import { getAgent } from '../os/registry.js';
import { listWorkspaceRoles, roleRank, type WorkspaceRole } from '../os/roles.js';
import type { PackageScope } from './manifest.js';

export class ExtensionScopeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 403,
  ) {
    super(message);
    this.name = 'ExtensionScopeError';
  }
}

function projectExists(workspaceId: string, projectId: string): boolean {
  return Boolean(getOsDb().prepare('SELECT 1 FROM os_projects WHERE workspace_id = ? AND id = ?').get(workspaceId, projectId));
}

function organizationExists(workspaceId: string, organizationId: string): boolean {
  return Boolean(getOsDb().prepare('SELECT 1 FROM os_organizations WHERE workspace_id = ? AND id = ?').get(workspaceId, organizationId));
}

function workspaceUserExists(workspaceId: string, userId: string): boolean {
  return listWorkspaceRoles(workspaceId).some((member) => member.userId === userId);
}

/** Validate an installation scope before a plan is applied. */
export function assertInstallScope(input: {
  workspaceId: string;
  actor: string;
  role: WorkspaceRole;
  scope: PackageScope;
  scopeId?: string;
}): void {
  const scopeId = (input.scopeId ?? '').trim();
  if (input.scope === 'instance') {
    if (scopeId) throw new ExtensionScopeError('SCOPE_TARGET_INVALID', 'Instance scope does not accept a target ID', 400);
    if (roleRank(input.role) < roleRank('admin')) {
      throw new ExtensionScopeError('INSTANCE_SCOPE_REQUIRES_ADMIN', 'Only an admin or owner can install at instance scope');
    }
    return;
  }
  if (!scopeId) throw new ExtensionScopeError('SCOPE_TARGET_REQUIRED', `Scope "${input.scope}" requires an explicit target`, 400);
  if (roleRank(input.role) < roleRank('member')) {
    throw new ExtensionScopeError('SCOPE_FORBIDDEN', 'Member role is required to assign scoped capabilities');
  }
  switch (input.scope) {
    case 'user':
      if (scopeId !== input.actor && roleRank(input.role) < roleRank('admin')) {
        throw new ExtensionScopeError('USER_SCOPE_FORBIDDEN', 'You may only install for your own user scope');
      }
      if (!workspaceUserExists(input.workspaceId, scopeId)) {
        throw new ExtensionScopeError('USER_SCOPE_TARGET_FORBIDDEN', 'The target user is not a member of this workspace');
      }
      return;
    case 'project':
      if (!projectExists(input.workspaceId, scopeId)) {
        throw new ExtensionScopeError('PROJECT_SCOPE_TARGET_FORBIDDEN', 'The target project does not exist in this workspace');
      }
      return;
    case 'agent':
      if (!getAgent(input.workspaceId, scopeId)) {
        throw new ExtensionScopeError('AGENT_SCOPE_TARGET_FORBIDDEN', 'The target agent does not exist in this workspace');
      }
      return;
    case 'organization':
      if (roleRank(input.role) < roleRank('admin')) {
        throw new ExtensionScopeError('ORGANIZATION_SCOPE_REQUIRES_ADMIN', 'Only an admin or owner can install at organization scope');
      }
      if (!organizationExists(input.workspaceId, scopeId)) {
        throw new ExtensionScopeError('ORGANIZATION_SCOPE_TARGET_FORBIDDEN', 'The target organization does not exist in this workspace');
      }
      return;
    default:
      throw new ExtensionScopeError('SCOPE_INVALID', 'Unsupported installation scope', 400);
  }
}

/** Validate agent policy targets; a policy cannot point at arbitrary rows. */
export function assertPolicyTargets(input: {
  workspaceId: string;
  role: WorkspaceRole;
  organizationId?: string | null;
  projectIds?: string[];
}): void {
  if (input.organizationId !== undefined && input.organizationId !== null) {
    if (roleRank(input.role) < roleRank('admin')) {
      throw new ExtensionScopeError('ORGANIZATION_SCOPE_REQUIRES_ADMIN', 'Only an admin or owner can bind an agent policy to an organization');
    }
    if (!organizationExists(input.workspaceId, input.organizationId)) {
      throw new ExtensionScopeError('ORGANIZATION_SCOPE_TARGET_FORBIDDEN', 'The target organization does not exist in this workspace');
    }
  }
  for (const projectId of input.projectIds ?? []) {
    if (!projectExists(input.workspaceId, projectId)) {
      throw new ExtensionScopeError('PROJECT_SCOPE_TARGET_FORBIDDEN', `Project "${projectId}" does not exist in this workspace`);
    }
  }
}
