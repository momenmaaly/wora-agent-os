import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SafeFetchError, assertSafeUrl, isBlockedAddress, isBlockedHostname,
  resolveRedirectTarget, safeFetch, safeLookup,
} from './safe-fetch.js';

test('ssrf: blocks loopback, private, link-local, CGNAT, multicast and reserved IPv4', () => {
  const blocked = [
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.254',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '192.0.2.10',
    '198.51.100.10', '203.0.113.10', '224.0.0.1', '240.0.0.1', '255.255.255.255',
  ];
  for (const address of blocked) assert.equal(isBlockedAddress(address), true, address);
});

test('ssrf: allows public IPv4 and IPv6 destinations', () => {
  const allowed = ['93.184.216.34', '1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'];
  for (const address of allowed) assert.equal(isBlockedAddress(address), false, address);
});

test('ssrf: blocks loopback, link-local, unique-local, documentation and mapped IPv6', () => {
  const blocked = [
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', '2002::1',
    '64:ff9b::7f00:1', '3fff::1', '2001:0::1',
  ];
  for (const address of blocked) assert.equal(isBlockedAddress(address), true, address);
});

test('ssrf: rejects local, internal, single-label and metadata hostnames', () => {
  const blocked = ['localhost', 'localhost.', 'metadata.google.internal', 'foo.local', 'db.internal', 'intranet', 'api.svc', 'node.cluster.local'];
  for (const host of blocked) assert.equal(isBlockedHostname(host), true, host);
  assert.equal(isBlockedHostname('example.com'), false);
  assert.equal(isBlockedHostname('api.github.com'), false);
});

test('ssrf: URL policy rejects non-web schemes, credentials and non-web ports', () => {
  assert.throws(() => assertSafeUrl('file:///etc/passwd'), /UNSAFE_SCHEME/);
  assert.throws(() => assertSafeUrl('ftp://example.com/file'), /UNSAFE_SCHEME/);
  assert.throws(() => assertSafeUrl('http://user:pass@example.com/'), /UNSAFE_CREDENTIALS/);
  assert.throws(() => assertSafeUrl('http://example.com:8080/'), /UNSAFE_PORT/);
  assert.throws(() => assertSafeUrl('http://127.0.0.1/'), /BLOCKED_HOST/);
  assert.throws(() => assertSafeUrl('http://169.254.169.254/latest/meta-data'), /BLOCKED_HOST/);
  assert.throws(() => assertSafeUrl('http://[::1]/'), /BLOCKED_HOST/);
  assert.throws(() => assertSafeUrl('http://[::ffff:127.0.0.1]/'), /BLOCKED_HOST/);
  assert.throws(() => assertSafeUrl('http://2130706433/'), /BLOCKED_HOST/);
  assert.throws(() => assertSafeUrl('http://0177.0.0.1/'), /BLOCKED_HOST/);
  assert.equal(assertSafeUrl('https://example.com/path?q=1').hostname, 'example.com');
  assert.equal(assertSafeUrl('https://93.184.216.34/').hostname, '93.184.216.34');
  assert.equal(assertSafeUrl('https://[2606:4700:4700::1111]/').hostname, '[2606:4700:4700::1111]');
});

test('ssrf: redirects are revalidated and cannot downgrade HTTPS', () => {
  const current = new URL('https://example.com/start');
  assert.throws(() => resolveRedirectTarget(current, 'http://127.0.0.1/secret'), /BLOCKED_HOST/);
  assert.throws(() => resolveRedirectTarget(current, 'http://169.254.169.254/latest/meta-data'), /BLOCKED_HOST/);
  assert.throws(() => resolveRedirectTarget(current, 'http://example.com/next'), /REDIRECT_DOWNGRADE/);
  assert.equal(resolveRedirectTarget(current, 'https://example.com/next').toString(), 'https://example.com/next');
});

test('ssrf: safeFetch refuses blocked destinations before any request', async () => {
  await assert.rejects(safeFetch('http://127.0.0.1/'), (error: unknown) => error instanceof SafeFetchError && error.code === 'BLOCKED_HOST');
  await assert.rejects(safeFetch('http://169.254.169.254/latest/meta-data'), (error: unknown) => error instanceof SafeFetchError && error.code === 'BLOCKED_HOST');
  await assert.rejects(safeFetch('http://metadata.google.internal/'), (error: unknown) => error instanceof SafeFetchError && error.code === 'BLOCKED_HOST');
  await assert.rejects(safeFetch('file:///etc/passwd'), (error: unknown) => error instanceof SafeFetchError && error.code === 'UNSAFE_SCHEME');
});

test('ssrf: DNS lookup rejects blocked literals without resolving them', async () => {
  await new Promise<void>((resolve, reject) => {
    safeLookup('127.0.0.1', { all: false }, (error) => {
      try {
        assert.ok(error instanceof SafeFetchError);
        assert.equal(error.code, 'BLOCKED_HOST');
        resolve();
      } catch (assertion) {
        reject(assertion);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    safeLookup('metadata.google.internal', { all: false }, (error) => {
      try {
        assert.ok(error instanceof SafeFetchError);
        assert.equal(error.code, 'BLOCKED_HOST');
        resolve();
      } catch (assertion) {
        reject(assertion);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    safeLookup('93.184.216.34', { all: false }, (error, address) => {
      try {
        assert.equal(error, null);
        assert.equal(address, '93.184.216.34');
        resolve();
      } catch (assertion) {
        reject(assertion);
      }
    });
  });
});
