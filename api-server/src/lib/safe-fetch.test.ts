import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SafeFetchError, assertSafeUrl, isBlockedAddress, isBlockedHostname,
  resolveRedirectTarget, safeFetch, safeLookup, safeLookupWithResolver, validateResolvedAddresses,
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

/* ─── Local fixture tests: actual socket, redirects, streaming, decompression ─── */
import { createServer, type RequestListener, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';

async function withLocalServer(handler: RequestListener, run: (port: number) => Promise<void>): Promise<void> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const previous = process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'];
  process.env['NODE_ENV'] = 'test';
  process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = '1';
  try {
    await run(port);
  } finally {
    if (previous === undefined) delete process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'];
    else process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('ssrf: actual socket connects to the validated lookup address', async () => {
  await withLocalServer((_req, res) => { res.end('socket-ok'); }, async (port) => {
    const result = await safeFetch(`http://127.0.0.1:${port}/`, {
      allowedPorts: new Set([String(port)]),
      timeoutMs: 2_000,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.toString('utf8'), 'socket-ok');
  });
});

test('ssrf: methods, request bodies and response headers are supported', async () => {
  await withLocalServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      res.setHeader('x-fixture', 'yes');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ method: req.method, body, authorization: req.headers.authorization ?? null }));
    });
  }, async (port) => {
    const result = await safeFetch(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-secret' },
      body: '{"hello":"world"}',
      allowedPorts: new Set([String(port)]),
      timeoutMs: 2_000,
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-fixture'], 'yes');
    assert.deepEqual(JSON.parse(result.body.toString('utf8')), {
      method: 'POST', body: '{"hello":"world"}', authorization: 'Bearer fixture-secret',
    });
  });
});

test('ssrf: streaming cap applies to a normal response', async () => {
  await withLocalServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('x'.repeat(4_096));
  }, async (port) => {
    await assert.rejects(
      safeFetch(`http://127.0.0.1:${port}/large`, { allowedPorts: new Set([String(port)]), maxBytes: 128, timeoutMs: 2_000 }),
      (error: unknown) => error instanceof SafeFetchError && error.code === 'RESPONSE_TOO_LARGE',
    );
  });
});

test('ssrf: streaming cap applies after gzip decompression', async () => {
  await withLocalServer((_req, res) => {
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' });
    res.end(gzipSync('x'.repeat(16_384)));
  }, async (port) => {
    await assert.rejects(
      safeFetch(`http://127.0.0.1:${port}/gzip`, { allowedPorts: new Set([String(port)]), maxBytes: 512, timeoutMs: 2_000 }),
      (error: unknown) => error instanceof SafeFetchError && error.code === 'RESPONSE_TOO_LARGE',
    );
  });
});

test('ssrf: redirects are followed, revalidated and sensitive headers are stripped cross-origin', async () => {
  let redirectedAuthorization: string | null = 'not-called';
  const targetServer = createServer((req, res) => {
    redirectedAuthorization = req.headers.authorization ?? null;
    res.end('target-ok');
  });
  await new Promise<void>((resolve) => targetServer.listen(0, '127.0.0.1', resolve));
  const targetAddress = targetServer.address();
  const targetPort = typeof targetAddress === 'object' && targetAddress ? targetAddress.port : 0;
  const sourceServer = createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/target` });
    res.end();
  });
  await new Promise<void>((resolve) => sourceServer.listen(0, '127.0.0.1', resolve));
  const sourceAddress = sourceServer.address();
  const sourcePort = typeof sourceAddress === 'object' && sourceAddress ? sourceAddress.port : 0;
  const previous = process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'];
  process.env['NODE_ENV'] = 'test';
  process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = '1';
  try {
    const target = await safeFetch(`http://127.0.0.1:${sourcePort}/redirect`, {
      headers: { authorization: 'Bearer should-not-leak' },
      allowedPorts: new Set([String(sourcePort), String(targetPort)]),
      timeoutMs: 2_000,
    });
    assert.equal(target.status, 200);
    assert.equal(target.body.toString('utf8'), 'target-ok');
    assert.equal(redirectedAuthorization, null);
  } finally {
    if (previous === undefined) delete process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'];
    else process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = previous;
    await new Promise<void>((resolve) => sourceServer.close(() => resolve()));
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  }
});

test('ssrf: redirects can be disabled for secret-bearing plugin/MCP calls', async () => {
  await withLocalServer((_req, res) => {
    res.writeHead(302, { location: '/target' });
    res.end();
  }, async (port) => {
    await assert.rejects(
      safeFetch(`http://127.0.0.1:${port}/redirect`, {
        allowRedirects: false,
        allowedPorts: new Set([String(port)]),
        timeoutMs: 2_000,
      }),
      (error: unknown) => error instanceof SafeFetchError && error.code === 'REDIRECT_DISABLED',
    );
  });
});

test('ssrf: DNS rebinding results are rejected if any resolved address is private', async () => {
  await new Promise<void>((resolve, reject) => {
    safeLookupWithResolver(
      'rebind.example',
      { all: true },
      (error) => {
        try {
          assert.ok(error instanceof SafeFetchError);
          assert.equal(error.code, 'BLOCKED_ADDRESS');
          resolve();
        } catch (assertion) { reject(assertion); }
      },
      (_hostname, _options, callback) => callback(null, [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
      false,
    );
  });
  assert.throws(() => validateResolvedAddresses([
    { address: '93.184.216.34', family: 4 },
    { address: '169.254.169.254', family: 4 },
  ]), /BLOCKED_ADDRESS/);
});

test('ssrf: AbortSignal cancels an in-flight request', async () => {
  await withLocalServer((_req, res) => {
    setTimeout(() => res.end('too-late'), 2_000).unref?.();
  }, async (port) => {
    const controller = new AbortController();
    const pending = safeFetch(`http://127.0.0.1:${port}/slow`, {
      allowedPorts: new Set([String(port)]),
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, (error: unknown) => error instanceof SafeFetchError && error.code === 'ABORTED');
  });
});
