import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

process.env['WORA_OS_DB'] = ':memory:';
process.env['NODE_ENV'] = 'test';
process.env['AUTH_SECRET'] = 'router-session-secret-0123456789abcdef';
const { createOsRouter } = await import('./router.js');
const { issueManagedSession } = await import('../lib/session-store.js');
const { revokeSession } = await import('../lib/session-store.js');
const { resetOsDbForTests } = await import('./db.js');
const express = (await import('express')).default;
let server: Server;
let baseUrl = '';
before(async () => {
  const app = express();
  app.use('/api/os', createOsRouter({ production: true }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/os`;
});
after(() => { server?.close(); resetOsDbForTests(); });

test('a revoked managed session is rejected by the OS API immediately', async () => {
  const session = issueManagedSession('user_revoke', process.env['AUTH_SECRET']!, 60);
  const headers = { Authorization: `Bearer ${session.token}` };
  const before = await fetch(`${baseUrl}/state`, { headers });
  assert.equal(before.status, 200);
  assert.equal(revokeSession(session.sessionId, 'user_revoke'), true);
  const after = await fetch(`${baseUrl}/state`, { headers });
  assert.equal(after.status, 401);
  assert.equal((await after.json() as Record<string, unknown>)['code'], 'SESSION_REVOKED');
});

test('a legacy sid-less session remains readable during migration', async () => {
  const { issueSessionToken } = await import('../lib/session.js');
  const token = issueSessionToken('user_legacy', process.env['AUTH_SECRET']!, 60);
  const response = await fetch(`${baseUrl}/state`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
});
