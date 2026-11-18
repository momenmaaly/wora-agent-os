import { deepEqual, equal, ok, throws } from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { issueSessionToken, verifySessionToken } from './session.js';

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
  // Only explicitly non-production verification can accept legacy sessions without expiry.
  equal(verifySessionToken(sign({ sub: 'studio-user' }), secret)?.userId, 'studio-user');
});

test('the operator issuer signs short-lived sessions only for valid workspace IDs', () => {
  const now = Date.now();
  const token = issueSessionToken('release-owner', secret, 120);
  const verified = verifySessionToken(token, secret, true);
  equal(verified?.userId, 'release-owner');
  ok(verified?.expiresAt && verified.expiresAt > now + 7_198_000 && verified.expiresAt <= Date.now() + 7_200_000);
  for (const minutes of [0, 481, 1.5, Infinity]) throws(() => issueSessionToken('release-owner', secret, minutes));
  throws(() => issueSessionToken('invalid id', secret, 30));
});
