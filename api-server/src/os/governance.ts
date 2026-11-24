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
import { classifyAction, type ActionClass, type ActionClassificationInput, type ActionRisk } from './actions.js';
import { redactSecrets } from './secrets.js';
import { fieldAad, openJson, sealJson } from '../security/field-crypto.js';
import { assertSafeReview, buildActionReview, type ActionReview } from './action-summary.js';

export type AutonomyPolicy = 'balanced' | 'autopilot';
export type ApprovalStatus = 'pending' | 'approved' | 'denied';

const AUTONOMY_KEY = 'autonomy_policy';
const ACTION_BUDGET_KEY = 'action_budget';
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('base64url');

export interface ActionBudget {
  maxAmountUsd: number;
  maxApprovalsPerMission: number;
  approvalTtlMinutes: number;
}

const DEFAULT_ACTION_BUDGET: ActionBudget = {
  maxAmountUsd: 0,
  maxApprovalsPerMission: 10,
  approvalTtlMinutes: 60,
};

/** Stable canonical JSON so a payload digest does not depend on key order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function payloadDigest(value: unknown): string {
  return sha256(JSON.stringify(canonical(value ?? {})));
}

/** Invalid or missing expiry timestamps fail closed where an approval is required. */
export function isApprovalExpired(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return !Number.isFinite(parsed) || parsed <= Date.now();
}

export function actionScope(missionId?: string | null, taskId?: string | null, toolId?: string | null): string {
  if (!missionId && !taskId && !toolId) return 'workspace';
  return `mission:${missionId ?? 'none'}:task:${taskId ?? 'none'}:tool:${toolId ?? 'none'}`;
}

export function extractAmount(toolInput: unknown): number | undefined {
  if (!toolInput || typeof toolInput !== 'object') return undefined;
  const record = toolInput as Record<string, unknown>;
  for (const key of ['amountUsd', 'amount', 'budgetUsd', 'costUsd']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

export function getActionBudget(workspaceId: string): ActionBudget {
  const row = getOsDb().prepare('SELECT value FROM os_settings WHERE workspace_id = ? AND key = ?').get(workspaceId, ACTION_BUDGET_KEY) as { value?: string } | undefined;
  const parsed = parseJson<Partial<ActionBudget>>(row?.value, {});
  const number = (value: unknown, fallback: number, min: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
  return {
    maxAmountUsd: number(parsed.maxAmountUsd, DEFAULT_ACTION_BUDGET.maxAmountUsd, 0),
    maxApprovalsPerMission: Math.min(number(parsed.maxApprovalsPerMission, DEFAULT_ACTION_BUDGET.maxApprovalsPerMission, 1), 10_000),
    approvalTtlMinutes: Math.min(number(parsed.approvalTtlMinutes, DEFAULT_ACTION_BUDGET.approvalTtlMinutes, 1), 10_080),
  };
}

export function setActionBudget(workspaceId: string, budget: Partial<ActionBudget>, actor: string): ActionBudget {
  const current = getActionBudget(workspaceId);
  const next: ActionBudget = {
    maxAmountUsd: budget.maxAmountUsd ?? current.maxAmountUsd,
    maxApprovalsPerMission: budget.maxApprovalsPerMission ?? current.maxApprovalsPerMission,
    approvalTtlMinutes: budget.approvalTtlMinutes ?? current.approvalTtlMinutes,
  };
  if (!Number.isFinite(next.maxAmountUsd) || next.maxAmountUsd < 0) throw new Error('maxAmountUsd must be a non-negative number');
  if (!Number.isInteger(next.maxApprovalsPerMission) || next.maxApprovalsPerMission < 1) throw new Error('maxApprovalsPerMission must be a positive integer');
  if (!Number.isFinite(next.approvalTtlMinutes) || next.approvalTtlMinutes < 1 || next.approvalTtlMinutes > 10_080) throw new Error('approvalTtlMinutes must be between 1 and 10080');
  const db = getOsDb();
  db.prepare('INSERT INTO os_settings (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(workspaceId, ACTION_BUDGET_KEY, JSON.stringify(next), nowIso());
  audit(db, { workspaceId, actor, action: 'settings.action_budget', subject: ACTION_BUDGET_KEY, detail: next });
  return next;
}

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

/** High-risk actions always require approval. Autopilot cannot bypass class C. */
export function requiresHumanApproval(workspaceId: string, risk: string, action?: Omit<ActionClassificationInput, 'risk'>): boolean {
  void workspaceId;
  const normalized: ActionRisk = risk === 'high' || risk === 'medium' || risk === 'low' ? risk : 'high';
  if (normalized === 'high') return true;
  if (!action) return false;
  return classifyAction({ ...action, risk: normalized }).class === 'C';
}

/* ─── Approvals ─────────────────────────────────────────── */
export interface ApprovalRecord {
  id: string; kind: string; missionId: string | null; taskId: string | null; toolId: string | null;
  actionSummary: string; target: string; consequences: string; resourceImpact: string; summaryVersion: string;
  reviewDigest: string; risk: string; actionClass: ActionClass; scope: string; payloadDigest: string;
  expiresAt: string | null; amountUsd: number | null; toolInput: Record<string, unknown>; requestedBy: string;
  status: ApprovalStatus; decisionNote: string; decidedBy: string | null; decidedAt: string | null;
  consumedAt: string | null; consumedBy: string | null; createdAt: string;
}

const approvalView = (row: Record<string, string | null>): ApprovalRecord => redactSecrets({
  id: String(row['id']), kind: String(row['kind']), missionId: row['mission_id'] ?? null, taskId: row['task_id'] ?? null, toolId: row['tool_id'] ?? null,
  actionSummary: String(row['action_summary']),
  target: String(row['target'] ?? ''), consequences: String(row['consequences'] ?? ''),
  resourceImpact: String(row['resource_impact'] ?? ''), summaryVersion: String(row['summary_version'] ?? ''),
  reviewDigest: String(row['review_digest'] ?? ''),
  risk: String(row['risk']),
  actionClass: (String(row['action_class'] ?? 'C')) as ActionClass,
  scope: String(row['scope'] ?? ''),
  payloadDigest: String(row['payload_digest'] ?? ''),
  expiresAt: row['expires_at'] ?? null,
  amountUsd: row['amount_usd'] === null || row['amount_usd'] === undefined ? null : Number(row['amount_usd']),
  toolInput: openJson<Record<string, unknown>>(row['tool_input'], fieldAad('approval-tool-input', String(row['workspace_id'] ?? ''), String(row['id'])), {}), requestedBy: String(row['requested_by']),
  status: String(row['status']) as ApprovalStatus, decisionNote: String(row['decision_note'] ?? ''), decidedBy: row['decided_by'] ?? null, decidedAt: row['decided_at'] ?? null,
  consumedAt: row['consumed_at'] ?? null, consumedBy: row['consumed_by'] ?? null, createdAt: String(row['created_at']),
}).value;

export function createApproval(input: {
  workspaceId: string; missionId?: string | null; taskId?: string | null; toolId?: string | null;
  actionSummary: string; risk: string; toolInput?: unknown; requestedBy?: string; kind?: string;
  actionClass?: ActionClass; scope?: string; payloadDigest?: string; expiresAt?: string; amountUsd?: number;
  toolDescription?: string | null; toolPermissions?: string[] | null; review?: ActionReview;
}): ApprovalRecord {
  const db = getOsDb();
  const id = newId('apr');
  const budget = getActionBudget(input.workspaceId);
  const actionClass = input.actionClass ?? (input.risk === 'high' ? 'C' : input.risk === 'medium' ? 'B' : 'A');
  const amountUsd = input.amountUsd ?? extractAmount(input.toolInput);
  if (amountUsd !== undefined && (!Number.isFinite(amountUsd) || amountUsd < 0)) throw new Error('Action amount must be a finite non-negative number');
  if (amountUsd !== undefined && amountUsd > budget.maxAmountUsd) {
    throw new Error(`Action amount ${amountUsd} exceeds the workspace action budget ${budget.maxAmountUsd}`);
  }
  if (actionClass === 'C' && input.missionId) {
    const count = db.prepare("SELECT COUNT(*) AS c FROM os_approvals WHERE workspace_id = ? AND mission_id = ? AND action_class = 'C'").get(input.workspaceId, input.missionId) as { c: number };
    if (Number(count.c) >= budget.maxApprovalsPerMission) {
      throw new Error(`Mission has reached the class C approval budget (${budget.maxApprovalsPerMission})`);
    }
  }
  const scope = input.scope ?? actionScope(input.missionId, input.taskId, input.toolId);
  const digest = payloadDigest(input.toolInput ?? {});
  const review = input.review ?? buildActionReview({
    toolId: input.toolId ?? null, toolInput: input.toolInput ?? {}, risk: input.risk,
    toolDescription: input.toolDescription ?? null, toolPermissions: input.toolPermissions ?? null,
  });
  assertSafeReview(review);
  const reviewDigest = payloadDigest({
    summary: review.summary, target: review.target, consequences: review.consequences,
    resourceImpact: review.resourceImpact, summaryVersion: review.summaryVersion, payloadDigest: digest,
  });
  if (input.payloadDigest && input.payloadDigest !== digest) throw new Error('Provided payload digest does not match the canonical tool input');
  const expiresAt = input.expiresAt ?? new Date(Date.now() + budget.approvalTtlMinutes * 60_000).toISOString();
  if (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    throw new Error('Approval expiry must be a valid future ISO timestamp');
  }
  if (Date.parse(expiresAt) > Date.now() + budget.approvalTtlMinutes * 60_000 + 1_000) {
    throw new Error('Approval expiry exceeds the workspace approval TTL');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
  db.prepare(`INSERT INTO os_approvals
    (id, workspace_id, kind, mission_id, task_id, tool_id, action_summary, target, consequences, resource_impact, summary_version, review_digest, risk, action_class, scope, payload_digest, expires_at, amount_usd, tool_input, requested_by, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .run(id, input.workspaceId, input.kind ?? 'tool-execution', input.missionId ?? null, input.taskId ?? null, input.toolId ?? null,
      review.summary.slice(0, 500), review.target.slice(0, 500), review.consequences.slice(0, 1_000), review.resourceImpact.slice(0, 500),
      review.summaryVersion, reviewDigest, input.risk, actionClass, scope, digest, expiresAt, amountUsd ?? null,
      sealJson(input.toolInput ?? {}, fieldAad('approval-tool-input', input.workspaceId, id)), input.requestedBy ?? 'orchestrator', nowIso());
  audit(db, { workspaceId: input.workspaceId, actor: input.requestedBy ?? 'orchestrator', action: 'approval.request', subject: id, detail: { toolId: input.toolId ?? null, missionId: input.missionId ?? null, risk: input.risk, actionClass, scope, payloadDigest: digest, expiresAt, amountUsd: amountUsd ?? null } });
  const created = approvalView(db.prepare('SELECT * FROM os_approvals WHERE id = ?').get(id) as Record<string, string>);
  db.exec('COMMIT');
  return created;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw err;
  }
}

export function getApproval(workspaceId: string, approvalId: string): ApprovalRecord | null {
  const row = getOsDb().prepare('SELECT * FROM os_approvals WHERE workspace_id = ? AND id = ?').get(workspaceId, approvalId) as Record<string, string> | undefined;
  return row ? approvalView(row) : null;
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
  if (row['requested_by'] === actor) throw new Error('The requester cannot approve or deny their own high-risk request');
  if (isApprovalExpired(row['expires_at'] as string | null)) throw new Error('Approval has expired');
  const now = nowIso();
  const update = db.prepare(`UPDATE os_approvals SET status = ?, decision_note = ?, decided_by = ?, decided_at = ?
    WHERE workspace_id = ? AND id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)`)
    .run(decision, note.slice(0, 500), actor, now, workspaceId, approvalId, now);
  if (Number(update.changes ?? 0) !== 1) {
    const latest = db.prepare('SELECT status, expires_at FROM os_approvals WHERE workspace_id = ? AND id = ?').get(workspaceId, approvalId) as { status?: string; expires_at?: string | null } | undefined;
    if (!latest) throw new Error('Approval not found');
    if (latest.status !== 'pending') throw new Error('Approval already decided');
    if (isApprovalExpired(latest.expires_at)) throw new Error('Approval has expired');
    throw new Error('Approval could not be decided');
  }
  audit(db, { workspaceId, actor, action: decision === 'approved' ? 'approval.approve' : 'approval.deny', subject: approvalId, detail: { note: note.slice(0, 300), toolId: row['tool_id'] ?? null, missionId: row['mission_id'] ?? null, actionClass: row['action_class'] ?? null, scope: row['scope'] ?? null } });
  return approvalView(db.prepare('SELECT * FROM os_approvals WHERE workspace_id = ? AND id = ?').get(workspaceId, approvalId) as Record<string, string>);
}

/**
 * Consume an approved action exactly once. The approval is bound to the exact
 * canonical payload, scope, mission/task and action class. Any mismatch or an
 * expired/consumed approval fails closed.
 */
export function consumeApproval(workspaceId: string, approvalId: string, input: {
  payload: unknown; scope: string; actionClass: ActionClass; actor: string;
  missionId?: string | null; taskId?: string | null;
}): ApprovalRecord {
  const db = getOsDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT * FROM os_approvals WHERE workspace_id = ? AND id = ?').get(workspaceId, approvalId) as Record<string, string> | undefined;
    if (!row) throw new Error('Approval not found');
    if (row['status'] !== 'approved') throw new Error(`Approval is ${row['status']}, not approved`);
    if (row['consumed_at']) throw new Error('Approval was already consumed');
    if (isApprovalExpired(row['expires_at'] as string | null)) throw new Error('Approval has expired');
    if (String(row['action_class'] ?? 'C') !== input.actionClass) throw new Error('Approval action class does not match');
    if (String(row['scope'] ?? '') !== input.scope) throw new Error('Approval scope does not match');
    if (String(row['payload_digest'] ?? '') !== payloadDigest(input.payload)) throw new Error('Approval payload digest does not match');
    const storedInput = openJson<Record<string, unknown>>(row['tool_input'], fieldAad('approval-tool-input', workspaceId, approvalId), {});
    if (payloadDigest(storedInput) !== String(row['payload_digest'] ?? '')) throw new Error('Stored approval payload failed its integrity check');
    if (row['review_digest']) {
      const expectedReview = payloadDigest({
        summary: String(row['action_summary'] ?? ''), target: String(row['target'] ?? ''),
        consequences: String(row['consequences'] ?? ''), resourceImpact: String(row['resource_impact'] ?? ''),
        summaryVersion: String(row['summary_version'] ?? ''), payloadDigest: String(row['payload_digest'] ?? ''),
      });
      if (String(row['review_digest']) !== expectedReview) throw new Error('Approval review failed its integrity check');
    }
    if (input.missionId && row['mission_id'] !== input.missionId) throw new Error('Approval mission does not match');
    if (input.taskId && row['task_id'] !== input.taskId) throw new Error('Approval task does not match');
    const amount = row['amount_usd'] === null || row['amount_usd'] === undefined ? undefined : Number(row['amount_usd']);
    if (amount !== undefined && (!Number.isFinite(amount) || amount > getActionBudget(workspaceId).maxAmountUsd)) {
      throw new Error(`Approval amount ${String(amount)} exceeds the current workspace action budget`);
    }
    const consumedAt = nowIso();
    const update = db.prepare("UPDATE os_approvals SET consumed_at = ?, consumed_by = ? WHERE workspace_id = ? AND id = ? AND consumed_at IS NULL AND status = 'approved'")
      .run(consumedAt, input.actor.slice(0, 200), workspaceId, approvalId);
    if (Number(update.changes ?? 0) !== 1) throw new Error('Approval was already consumed');
    audit(db, { workspaceId, actor: input.actor, action: 'approval.consume', subject: approvalId, detail: { missionId: input.missionId ?? null, taskId: input.taskId ?? null, scope: input.scope, actionClass: input.actionClass } });
    const consumed = approvalView(db.prepare('SELECT * FROM os_approvals WHERE workspace_id = ? AND id = ?').get(workspaceId, approvalId) as Record<string, string>);
    db.exec('COMMIT');
    return consumed;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw err;
  }
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
