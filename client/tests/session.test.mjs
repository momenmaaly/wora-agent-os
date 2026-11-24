import { deepEqual, equal, rejects } from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { clearWorkspaceSession, connectWorkspace, readSessionToken, revokeWorkspaceSession } from '../src/lib/session.ts';

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

const key = 'wora:authToken';
const token = 'fixture_session.signature';
let sent;
beforeEach(() => {
  globalThis.window = { location: { origin: 'https://workspace.example.invalid' }, sessionStorage: memoryStorage(), localStorage: memoryStorage() };
  sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push([url.href, init]);
    return Response.json({ userId: 'workspace-fixture', expiresAt: Date.now() + 60_000 });
  };
});

test('verify a token before storing it, without persisting in local storage or following redirects', async () => {
  await connectWorkspace(` ${token} `, new AbortController().signal);
  equal(sent.length, 1);
  equal(sent[0][0], 'https://workspace.example.invalid/api/session');
  deepEqual({ ...sent[0][1], signal: undefined }, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: undefined, cache: 'no-store', redirect: 'error', credentials: 'omit',
  });
  equal(readSessionToken(), token);
  equal(window.localStorage.getItem(key), null);
});

test('do not persist sessions with malformed, unauthorized, inaccessible or insecure validation', async () => {
  const signal = new AbortController().signal;
  await rejects(connectWorkspace('not a token', signal), /AUTH_INVALID/);
  equal(sent.length, 0);
  globalThis.fetch = async () => Response.json({ code: 'AUTH_INVALID' }, { status: 401 });
  await rejects(connectWorkspace(token, signal), /AUTH_INVALID/);
  globalThis.fetch = async () => new Response('<html><title>Wrong service</title></html>', { headers: { 'content-type': 'text/html' } });
  await rejects(connectWorkspace(token, signal), /API_UNAVAILABLE/);
  window.location.origin = 'http://workspace.example.invalid';
  globalThis.fetch = async () => { throw new Error('Unexpected fetch to insecure API'); };
  await rejects(connectWorkspace(token, signal), /API_UNAVAILABLE/);
  equal(readSessionToken(), undefined);
});

test('sign out removes only the workspace token, including legacy storage', () => {
  window.sessionStorage.setItem(key, token);
  window.localStorage.setItem(key, 'old.signature');
  window.localStorage.setItem('wora:projectOS:v6', 'serialized local projects');
  clearWorkspaceSession();
  equal(readSessionToken(), undefined);
  equal(window.localStorage.getItem('wora:projectOS:v6'), 'serialized local projects');
});

test('sign out asks the API to revoke a managed session before clearing local storage', async () => {
  window.sessionStorage.setItem(key, token);
  globalThis.fetch = async (url, init) => {
    sent.push([url.href, init]);
    return new Response(null, { status: 204 });
  };
  equal(await revokeWorkspaceSession(), true);
  equal(sent[0][0], 'https://workspace.example.invalid/api/session/revoke');
  equal(sent[0][1].method, 'POST');
  equal(sent[0][1].headers.Authorization, `Bearer ${token}`);
  globalThis.fetch = async () => new Response(null, { status: 400 });
  equal(await revokeWorkspaceSession(), true, 'legacy sid-less sessions still clear locally');
  clearWorkspaceSession();
  equal(readSessionToken(), undefined);
});
