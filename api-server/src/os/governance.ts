/**
 * WORA OS — governance: human approvals, autonomy policy, device pairing.
 *
 * Autonomy policy (per workspace, stored in os_settings):
 *   balanced  (default) — low/medium risk tools run autonomously; high-risk tools pause for approval
 *   autopilot           — the user explicitly opts high-risk tools into autonomy as well
 * Denials and approvals are recorded in the audit log; approval records carry the exact
 * tool input so the human decides on the real payload, not a paraphrase.
 *
 * Device connections: no local agent binary is bundled yet, so pairing is a real but
 * incomplete handshake — request → one-time code → redeem (from the future agent) → revoke.
 * The API never pretends an unredeemed device was inspected.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getOsDb, newId, nowIso, audit, parseJson, type OsDatabase } from './db.js';

export type AutonomyPolicy = 'balanced' | 'autopilot';
export type ApprovalStatus = 'pending' | 'approved' | 'denied';

const AUTONOMY_KEY = 'autonomy_policy';
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('base64url');

/* ─── Autonomy policy ───────────────────────────────────── */
export function getAutonomyPolicy(workspaceId: string): AutonomyPolicy {
  const row = getOsDb().prepare('SELECT value FROM os_settings WHERE workspace_id = ? AND key = ?').get(workspaceId, AUTONOMY_KEY) as { value?: string } | undefined;
  return row?.value === 'autopilot' ? 'autopilot' : 'balanced';
}

export function setAutonomyPolicy(workspaceId: string, policy: AutonomyPolicy, actor: string): AutonomyPolicy {
  const db = getOsDb();
  db.prepare('INSERT INTO os_settings (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(workspaceId, AUTONOMY_KEY, policy, nowIso());
  audit(db, { workspaceId, actor, action: 'settings.autonomy', subject: AUTONOMY_KEY, detail: { policy } });
  return policy;
}

/** Balanced policy gates every high-risk tool; autopilot opts out explicitly. */
export function requiresHumanApproval(workspaceId: string, risk: string): boolean {
  if (risk !== 'high') return false;
  return getAutonomyPolicy(workspaceId) !== 'autopilot';
}

/* ─── Approvals ─────────────────────────────────────────── */
export interface ApprovalRecord {
  id: string; kind: string; missionId: string | null; taskId: string | null; toolId: string | null;
  actionSummary: string; risk: string; toolInput: Record<string, unknown>; requestedBy: string;
  status: ApprovalStatus; decisionNote: string; decidedBy: string | null; decidedAt: string | null; createdAt: string;
}

const approvalView = (row: Record<string, string | null>): ApprovalRecord => ({
  id: String(row['id']), kind: String(row['kind']), missionId: row['mission_id'] ?? null, taskId: row['task_id'] ?? null, toolId: row['tool_id'] ?? null,
  actionSummary: String(row['action_summary']), risk: String(row['risk']), toolInput: parseJson(row['tool_input'], {}), requestedBy: String(row['requested_by']),
  status: String(row['status']) as ApprovalStatus, decisionNote: String(row['decision_note'] ?? ''), decidedBy: row['decided_by'] ?? null, decidedAt: row['decided_at'] ?? null, createdAt: String(row['created_at']),
});

export function createApproval(input: {
  workspaceId: string; missionId?: string | null; taskId?: string | null; toolId?: string | null;
  actionSummary: string; risk: string; toolInput?: unknown; requestedBy?: string; kind?: string;
}): ApprovalRecord {
  const db = getOsDb();
  const id = newId('apr');
  db.prepare(`INSERT INTO os_approvals (id, workspace_id, kind, mission_id, task_id, tool_id, action_summary, risk, tool_input, requested_by, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .run(id, input.workspaceId, input.kind ?? 'tool-execution', input.missionId ?? null, input.taskId ?? null, input.toolId ?? null,
      input.actionSummary.slice(0, 500), input.risk, JSON.stringify(input.toolInput ?? {}).slice(0, 20_000), input.requestedBy ?? 'orchestrator', nowIso());
  audit(db, { workspaceId: input.workspaceId, actor: input.requestedBy ?? 'orchestrator', action: 'approval.request', subject: id, detail: { toolId: input.toolId ?? null, missionId: input.missionId ?? null, risk: input.risk } });
  return approvalView(db.prepare('SELECT * FROM os_approvals WHERE id = ?').get(id) as Record<string, string>);
}

/** Latest approval for a task (any status). */
export function getTaskApproval(workspaceId: string, taskId: string): ApprovalRecord | null {
  const row = getOsDb().prepare('SELECT * FROM os_approvals WHERE workspace_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 1').get(workspaceId, taskId) as Record<string, string> | undefined;
  return row ? approvalView(row) : null;
}

export function listMissionApprovals(workspaceId: string, missionId: string): ApprovalRecord[] {
  const rows = getOsDb().prepare('SELECT * FROM os_approvals WHERE workspace_id = ? AND mission_id = ? ORDER BY created_at DESC LIMIT 20').all(workspaceId, missionId) as unknown as Array<Record<string, string>>;
  return rows.map(approvalView);
}

export function listApprovals(workspaceId: string, opts: { status?: ApprovalStatus | 'all'; limit?: number } = {}): ApprovalRecord[] {
  const limit = Math.min(opts.limit ?? 50, 200);
  const status = opts.status ?? 'pending';
  const db = getOsDb();
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM os_approvals WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, limit)
    : db.prepare('SELECT * FROM os_approvals WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, status, limit);
  return (rows as unknown as Array<Record<string, string>>).map(approvalView);
}

export function decideApproval(workspaceId: string, approvalId: string, decision: 'approved' | 'denied', note: string, actor: string): ApprovalRecord {
  const db = getOsDb();
  const row = db.prepare('SELECT * FROM os_approvals WHERE workspace_id = ? AND id = ?').get(workspaceId, approvalId) as Record<string, string> | undefined;
  if (!row) throw new Error('Approval not found');
  if (row['status'] !== 'pending') throw new Error('Approval already decided');
  db.prepare('UPDATE os_approvals SET status = ?, decision_note = ?, decided_by = ?, decided_at = ? WHERE id = ?')
    .run(decision, note.slice(0, 500), actor, nowIso(), approvalId);
  audit(db, { workspaceId, actor, action: decision === 'approved' ? 'approval.approve' : 'approval.deny', subject: approvalId, detail: { note: note.slice(0, 300), toolId: row['tool_id'] ?? null, missionId: row['mission_id'] ?? null } });
  return approvalView(db.prepare('SELECT * FROM os_approvals WHERE id = ?').get(approvalId) as Record<string, string>);
}

/* ─── Revocable device connections ──────────────────────── */
export type DeviceStatus = 'pending' | 'paired' | 'revoked';
export interface DeviceRecord {
  id: string; name: string; platform: string; status: DeviceStatus; fingerprint: string;
  permissions: string[]; createdAt: string; pairedAt: string | null; revokedAt: string | null; lastSeenAt: string | null;
}

const deviceView = (row: Record<string, string | null>): DeviceRecord => ({
  id: String(row['id']), name: String(row['name']), platform: String(row['platform']), status: String(row['status']) as DeviceStatus,
  fingerprint: String(row['fingerprint'] ?? ''), permissions: parseJson(row['permissions'], ['host:read']), createdAt: String(row['created_at']),
  pairedAt: row['paired_at'] ?? null, revokedAt: row['revoked_at'] ?? null, lastSeenAt: row['last_seen_at'] ?? null,
});

/** Creates a pending device record and a one-time pairing code (returned once, stored hashed). */
export function requestDevicePairing(workspaceId: string, input: { name: string; platform: string }, actor: string): { device: DeviceRecord; pairingCode: string } {
  const db = getOsDb();
  const id = newId('dev');
  const pairingCode = randomBytes(9).toString('base64url').replace(/[^a-zA-Z0-9]/g, 'k').slice(0, 12).toUpperCase();
  db.prepare(`INSERT INTO os_devices (id, workspace_id, name, platform, pairing_code_hash, status, created_at)
              VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
    .run(id, workspaceId, input.name.trim().slice(0, 80) || 'جهاز بدون اسم', input.platform.trim().slice(0, 40) || 'unknown', sha256(pairingCode), nowIso());
  audit(db, { workspaceId, actor, action: 'device.pair.request', subject: id, detail: { name: input.name, platform: input.platform } });
  return { device: deviceView(db.prepare('SELECT * FROM os_devices WHERE id = ?').get(id) as Record<string, string>), pairingCode };
}

/** The future local agent redeems the one-time code to complete pairing. Codes are single-use. */
export function redeemDevicePairing(workspaceId: string, input: { deviceId: string; code: string; fingerprint: string }, actor: string, global = false): DeviceRecord {
  const db = getOsDb();
  const row = (global
    ? db.prepare('SELECT * FROM os_devices WHERE id = ?').get(input.deviceId)
    : db.prepare('SELECT * FROM os_devices WHERE workspace_id = ? AND id = ?').get(workspaceId, input.deviceId)) as Record<string, string> | undefined;
  if (!row) throw new Error('Device not found');
  workspaceId = String(row['workspace_id']);
  if (row['status'] === 'revoked') throw new Error('Device connection was revoked — request a new pairing');
  if (row['status'] === 'paired') throw new Error('Device already paired');
  const candidate = Buffer.from(sha256(input.code.trim().toUpperCase()));
  const expected = Buffer.from(String(row['pairing_code_hash'] ?? ''));
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    audit(db, { workspaceId, actor, action: 'device.pair.failed', subject: String(row['id']), detail: { reason: 'code mismatch' } });
    throw new Error('Invalid pairing code');
  }
  db.prepare("UPDATE os_devices SET status = 'paired', fingerprint = ?, pairing_code_hash = '', paired_at = ?, last_seen_at = ? WHERE id = ?")
    .run(input.fingerprint.trim().slice(0, 128), nowIso(), nowIso(), input.deviceId);
  audit(db, { workspaceId, actor, action: 'device.pair.redeem', subject: input.deviceId, detail: { fingerprint: input.fingerprint.slice(0, 64) } });
  return deviceView(db.prepare('SELECT * FROM os_devices WHERE id = ?').get(input.deviceId) as Record<string, string>);
}

export function revokeDevice(workspaceId: string, deviceId: string, actor: string): DeviceRecord {
  const db = getOsDb();
  const row = db.prepare('SELECT * FROM os_devices WHERE workspace_id = ? AND id = ?').get(workspaceId, deviceId) as Record<string, string> | undefined;
  if (!row) throw new Error('Device not found');
  if (row['status'] === 'revoked') return deviceView(row);
  db.prepare("UPDATE os_devices SET status = 'revoked', revoked_at = ? WHERE id = ?").run(nowIso(), deviceId);
  audit(db, { workspaceId, actor, action: 'device.revoke', subject: deviceId, detail: { name: row['name'] } });
  return deviceView(db.prepare('SELECT * FROM os_devices WHERE id = ?').get(deviceId) as Record<string, string>);
}

/** Global device lookup by id (id is an unguessable record locator, not an authority). */
export function findDeviceById(deviceId: string): DeviceRecord | null {
  const row = getOsDb().prepare('SELECT * FROM os_devices WHERE id = ?').get(deviceId) as Record<string, string> | undefined;
  return row ? deviceView(row) : null;
}

/** Heartbeat from an already-paired device agent; the fingerprint is the credential. */
export function deviceHeartbeat(deviceId: string, input: { fingerprint: string }): { ok: true; lastSeenAt: string; workspaceId: string } {
  const db = getOsDb();
  const row = db.prepare('SELECT * FROM os_devices WHERE id = ?').get(deviceId) as Record<string, string> | undefined;
  if (!row) throw new Error('Device not found');
  const workspaceId = String(row['workspace_id']);
  if (row['status'] === 'revoked') { const err = new Error('Connection revoked by user') as Error & { code?: string }; err.code = 'revoked'; throw err; }
  if (row['status'] !== 'paired') { const err = new Error('Device not paired yet') as Error & { code?: string }; err.code = 'not_paired'; throw err; }
  if (String(row['fingerprint'] ?? '') !== input.fingerprint.trim()) { const err = new Error('Fingerprint mismatch') as Error & { code?: string }; err.code = 'fingerprint'; throw err; }
  const now = nowIso();
  db.prepare('UPDATE os_devices SET last_seen_at = ? WHERE id = ?').run(now, deviceId);
  audit(db, { workspaceId, actor: `device:${input.fingerprint.slice(0, 16)}`, action: 'device.heartbeat', subject: deviceId, detail: {} });
  return { ok: true, lastSeenAt: now, workspaceId };
}

export function listDevices(workspaceId: string): DeviceRecord[] {
  const rows = getOsDb().prepare('SELECT * FROM os_devices WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50').all(workspaceId) as unknown as Array<Record<string, string>>;
  return rows.map(deviceView);
}
