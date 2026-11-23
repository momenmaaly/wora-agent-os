/**
 * WORA OS — workspace roles (RBAC v1).
 *
 * Four roles, ranked: viewer < member < admin < owner.
 *   viewer — read-only (every GET); mutating calls return 403
 *   member — day-to-day OS use: launch missions, manage agents/memory/playbooks
 *   admin  — + workspace settings: autonomy policy, device pair/revoke, agent/playbook deletion,
 *            managing member/viewer roles (cannot touch owner/admin rows or grant owner)
 *   owner  — + full role management including admin grants
 *
 * Bootstrapping: a workspace with no role rows grants its first actor the owner
 * role (production: the signed-in user; preview/dev without rows: shared sandbox = owner).
 * Production workspaces are per-user (`wora-{userId}`), so first-user-owner is correct there.
 *
 * Agent-level and tool-level permissions remain enforced in runTool; this gate
 * governs WHO may call OS mutations at all.
 */
import { getOsDb, nowIso, audit } from './db.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
const RANK: Record<WorkspaceRole, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

export function roleRank(role: WorkspaceRole): number {
  return RANK[role];
}

export function getWorkspaceRole(workspaceId: string, userId: string): WorkspaceRole {
  const db = getOsDb();
  const row = db.prepare('SELECT role FROM os_workspace_roles WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId) as { role?: string } | undefined;
  if (row?.role) return normalizeRole(row.role);
  // Bootstrap: first actor becomes owner of a workspace with no roles yet.
  const any = db.prepare('SELECT COUNT(*) AS c FROM os_workspace_roles WHERE workspace_id = ?').get(workspaceId) as { c: number };
  if (any.c > 0) return 'viewer'; // roles exist, this actor has none → least privilege
  const ts = nowIso();
  db.prepare('INSERT INTO os_workspace_roles (workspace_id, user_id, role, granted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(workspaceId, userId, 'owner', 'bootstrap', ts, ts);
  return 'owner';
}

function normalizeRole(raw: string): WorkspaceRole {
  return raw === 'admin' || raw === 'member' || raw === 'viewer' || raw === 'owner' ? raw : 'viewer';
}

export function listWorkspaceRoles(workspaceId: string): Array<{ userId: string; role: WorkspaceRole; grantedBy: string; createdAt: string; updatedAt: string }> {
  const rows = getOsDb().prepare('SELECT * FROM os_workspace_roles WHERE workspace_id = ? ORDER BY role, user_id').all(workspaceId) as Array<{ user_id: string; role: string; granted_by: string; created_at: string; updated_at: string }>;
  return rows.map((row) => ({ userId: row.user_id, role: normalizeRole(row.role), grantedBy: row.granted_by, createdAt: row.created_at, updatedAt: row.updated_at }));
}

/** Grants/changes a role. Owner may grant anything; admin may grant member/viewer only, and may never touch owner/admin rows. */
export function setWorkspaceRole(workspaceId: string, targetUserId: string, role: WorkspaceRole, actor: string): { userId: string; role: WorkspaceRole } {
  const db = getOsDb();
  const actorRole = getWorkspaceRole(workspaceId, actor);
  if (actorRole !== 'owner' && actorRole !== 'admin') throw new Error('Only owner/admin can manage roles');
  if (actor === targetUserId) throw new Error('You cannot change your own role — ask another owner');
  if (actorRole === 'admin' && (role === 'owner' || role === 'admin')) throw new Error('Only the owner can grant owner/admin');
  const ts = nowIso();
  db.prepare(`INSERT INTO os_workspace_roles (workspace_id, user_id, role, granted_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, updated_at = excluded.updated_at`)
    .run(workspaceId, targetUserId.slice(0, 120), role, actor, ts, ts);
  audit(db, { workspaceId, actor, action: 'roles.set', subject: targetUserId, detail: { role } });
  return { userId: targetUserId, role };
}

export function removeWorkspaceRole(workspaceId: string, targetUserId: string, actor: string): boolean {
  const db = getOsDb();
  const actorRole = getWorkspaceRole(workspaceId, actor);
  if (actorRole !== 'owner' && actorRole !== 'admin') throw new Error('Only owner/admin can manage roles');
  if (actor === targetUserId) throw new Error('You cannot remove your own role');
  const target = db.prepare('SELECT role FROM os_workspace_roles WHERE workspace_id = ? AND user_id = ?').get(workspaceId, targetUserId) as { role?: string } | undefined;
  if (!target) return false;
  const targetRole = normalizeRole(String(target.role));
  if (actorRole === 'admin' && (targetRole === 'owner' || targetRole === 'admin')) throw new Error('Only the owner can remove owner/admin');
  if (actorRole === 'owner' && targetRole === 'owner' && targetUserId === actor) throw new Error('The owner cannot remove their own owner role');
  db.prepare('DELETE FROM os_workspace_roles WHERE workspace_id = ? AND user_id = ?').run(workspaceId, targetUserId);
  audit(db, { workspaceId, actor, action: 'roles.remove', subject: targetUserId, detail: { was: targetRole } });
  return true;
}
