/**
 * Durable session registry for revocable signed sessions.
 *
 * Tokens remain stateless HMAC credentials, but a token carrying a session id
 * is accepted only while its registry row exists, matches the subject and has
 * not expired or been revoked. Legacy tokens without a session id remain
 * readable for migration; new sessions always carry one.
 */
import { randomUUID } from 'node:crypto';
import { getOsDb, nowIso } from '../os/db.js';
import { issueSessionToken, verifySessionToken } from './session.js';

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: number;
  revokedAt: string | null;
  revokedBy: string | null;
  lastSeenAt: string | null;
}

const view = (row: Record<string, string | number | null>): SessionRecord => ({
  id: String(row['id']), userId: String(row['user_id']), createdAt: String(row['created_at']),
  expiresAt: Number(row['expires_at']), revokedAt: row['revoked_at'] == null ? null : String(row['revoked_at']),
  revokedBy: row['revoked_by'] == null ? null : String(row['revoked_by']),
  lastSeenAt: row['last_seen_at'] == null ? null : String(row['last_seen_at']),
});

export function registerSession(input: { sessionId?: string; userId: string; expiresAt: number }): SessionRecord {
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now()) throw new Error('Session expiry must be in the future');
  const id = input.sessionId ?? `ses_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  getOsDb().prepare('INSERT INTO security_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, input.userId, nowIso(), input.expiresAt);
  return { id, userId: input.userId, createdAt: nowIso(), expiresAt: input.expiresAt, revokedAt: null, revokedBy: null, lastSeenAt: null };
}

export function getSession(sessionId: string): SessionRecord | null {
  const row = getOsDb().prepare('SELECT * FROM security_sessions WHERE id = ?').get(sessionId) as Record<string, string | number | null> | undefined;
  return row ? view(row) : null;
}

export function isSessionActive(sessionId: string, userId: string, now = Date.now()): boolean {
  const session = getSession(sessionId);
  if (!session || session.userId !== userId || session.revokedAt || session.expiresAt <= now) return false;
  try { getOsDb().prepare('UPDATE security_sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), sessionId); } catch { /* read path must not fail on a heartbeat write */ }
  return true;
}

export function revokeSession(sessionId: string, actor: string): boolean {
  const result = getOsDb().prepare('UPDATE security_sessions SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL')
    .run(nowIso(), actor.slice(0, 200), sessionId);
  return Number(result.changes) === 1;
}

export function issueManagedSession(userId: string, secret: string, minutes: number): { token: string; sessionId: string; expiresAt: number } {
  const sessionId = `ses_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const token = issueSessionToken(userId, secret, minutes, { sessionId });
  const verified = verifySessionToken(token, secret, true);
  if (!verified?.expiresAt) throw new Error('Managed session token did not carry an expiry');
  registerSession({ sessionId, userId, expiresAt: verified.expiresAt });
  return { token, sessionId, expiresAt: verified.expiresAt };
}
