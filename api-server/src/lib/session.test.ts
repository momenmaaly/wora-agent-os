import { deepEqual, equal } from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifySessionToken } from './session.js';

const secret = 'test-only-signing-fixture';
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
function sign(payload: object, header?: object) {
  const data = header ? `${encode(header)}.${encode(payload)}` : encode(payload);
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

const expires = Math.floor(Date.now() / 1_000) + 60;

test('live Studio verification accepts signed HMAC and HS256 sessions with a valid expiry', () => {
  deepEqual(verifySessionToken(sign({ sub: 'studio-user', exp: expires }), secret, true), { userId: 'studio-user', displayName: undefined, expiresAt: expires * 1_000 });
  deepEqual(verifySessionToken(sign({ userId: 'studio-user', name: 'User', exp: expires }, { alg: 'HS256' }), secret, true), { userId: 'studio-user', displayName: 'User', expiresAt: expires * 1_000 });
});

test('unverifiable, expired, malformed, or undated sessions are refused for live Studio', () => {
  const payload = { sub: 'studio-user', exp: expires };
  equal(verifySessionToken(sign(payload), 'wrong-test-secret', true), null);
  equal(verifySessionToken(sign(payload, { alg: 'none' }), secret, true), null);
  equal(verifySessionToken(sign({ ...payload, exp: expires - 120 }), secret, true), null);
  equal(verifySessionToken(sign({ ...payload, exp: String(expires) }), secret, true), null);
  equal(verifySessionToken(sign({ ...payload, sub: ['studio-user'] }), secret, true), null);
  equal(verifySessionToken(sign({ ...payload, nbf: expires }), secret, true), null);
  equal(verifySessionToken(sign({ sub: 'studio-user' }), secret, true), null);
  // Existing workspace sockets may still accept legacy signed sessions without expiry.
  equal(verifySessionToken(sign({ sub: 'studio-user' }), secret)?.userId, 'studio-user');
});
