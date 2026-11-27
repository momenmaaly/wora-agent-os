import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env['WORA_OS_DB'] = ':memory:';
process.env['NODE_ENV'] = 'test';

const { issueManagedSession, isSessionActive, revokeSession, registerSession, getSession } = await import('./session-store.js');
const { verifySessionToken, issueSessionToken } = await import('./session.js');
const { getOsDb, resetOsDbForTests } = await import('../os/db.js');

const SECRET = 'session-store-test-signing-secret-not-real';

after(() => resetOsDbForTests());

test('managed sessions carry an id, expire, and can be revoked', () => {
  const issued = issueManagedSession('reviewer', SECRET, 30);
  const verified = verifySessionToken(issued.token, SECRET, true);
  assert.equal(verified?.userId, 'reviewer');
  assert.equal(verified?.sessionId, issued.sessionId);
  assert.equal(isSessionActive(issued.sessionId, 'reviewer'), true);
  assert.equal(isSessionActive(issued.sessionId, 'another-user'), false, 'a session id is bound to its subject');
  assert.equal(revokeSession(issued.sessionId, 'admin'), true);
  assert.equal(isSessionActive(issued.sessionId, 'reviewer'), false);
  assert.equal(getSession(issued.sessionId)?.revokedBy, 'admin');
  assert.equal(revokeSession(issued.sessionId, 'admin'), false, 'revocation is idempotent but not repeated');
});

test('expired sessions are inactive even when the signature is valid', () => {
  const issued = issueManagedSession('expired-user', SECRET, 5);
  getOsDb().prepare('UPDATE security_sessions SET expires_at = ? WHERE id = ?').run(Date.now() - 1, issued.sessionId);
  assert.ok(verifySessionToken(issued.token, SECRET, true), 'the stateless signature remains valid until its own exp');
  assert.equal(isSessionActive(issued.sessionId, 'expired-user'), false);
});

test('a token without a managed session id remains a legacy token', () => {
  const legacy = issueSessionToken('legacy-user', SECRET, 10);
  const verified = verifySessionToken(legacy, SECRET, true);
  assert.equal(verified?.userId, 'legacy-user');
  assert.equal(verified?.sessionId, undefined);
});

test('session records do not store the bearer token', () => {
  const issued = issueManagedSession('privacy-user', SECRET, 10);
  const row = getOsDb().prepare('SELECT * FROM security_sessions WHERE id = ?').get(issued.sessionId) as Record<string, unknown>;
  assert.ok(!JSON.stringify(row).includes(issued.token));
  assert.ok(!JSON.stringify(row).includes(SECRET));
});

test('a revoked or expired session cannot be reused through the registry', () => {
  const issued = registerSession({ userId: 'bounded-user', expiresAt: Date.now() + 60_000 });
  assert.equal(isSessionActive(issued.id, 'bounded-user'), true);
  revokeSession(issued.id, 'bounded-user');
  assert.equal(isSessionActive(issued.id, 'bounded-user'), false);
});
