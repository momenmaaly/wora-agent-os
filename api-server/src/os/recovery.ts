/** Workspace-scoped recoverability report and explicit recovery operation. */
import { getOsDb } from './db.js';
import { markInterruptedMissions } from './orchestrator.js';
import { recoverExpiredTaskLeases } from './task-queue.js';

export interface RecoveryReport {
  workspaceId: string;
  interruptedMissions: number;
  blockedTasks: number;
  activeLeases: number;
  expiredLeases: number;
  startedCheckpoints: number;
  pendingApprovals: number;
  resumable: boolean;
}

export function recoveryReport(workspaceId: string): RecoveryReport {
  const db = getOsDb();
  const one = (sql: string, ...params: Array<string | number>): number => Number((db.prepare(sql).get(...params) as { c?: number } | undefined)?.c ?? 0);
  const interruptedMissions = one("SELECT COUNT(*) AS c FROM os_missions WHERE workspace_id = ? AND status IN ('running', 'planning')", workspaceId);
  const blockedTasks = one("SELECT COUNT(*) AS c FROM os_tasks WHERE workspace_id = ? AND status = 'blocked'", workspaceId);
  const activeLeases = one('SELECT COUNT(*) AS c FROM os_task_leases WHERE workspace_id = ? AND expires_at > ?', workspaceId, Date.now());
  const expiredLeases = one('SELECT COUNT(*) AS c FROM os_task_leases WHERE workspace_id = ? AND expires_at <= ?', workspaceId, Date.now());
  const startedCheckpoints = one("SELECT COUNT(*) AS c FROM os_task_checkpoints WHERE workspace_id = ? AND status = 'started'", workspaceId);
  const pendingApprovals = one("SELECT COUNT(*) AS c FROM os_approvals WHERE workspace_id = ? AND status = 'pending'", workspaceId);
  return {
    workspaceId, interruptedMissions, blockedTasks, activeLeases, expiredLeases, startedCheckpoints, pendingApprovals,
    resumable: interruptedMissions > 0 || blockedTasks > 0 || expiredLeases > 0,
  };
}

export function recoverWorkspace(workspaceId: string): { before: RecoveryReport; after: RecoveryReport; recoveredLeases: number; recoveredMissions: number } {
  const before = recoveryReport(workspaceId);
  const recoveredLeases = recoverExpiredTaskLeases(workspaceId);
  const recoveredMissions = markInterruptedMissions(workspaceId);
  return { before, after: recoveryReport(workspaceId), recoveredLeases, recoveredMissions };
}
