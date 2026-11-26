/**
 * Connection-time browser proxy security tests.
 *
 * These exercise the real proxy listener and a real local HTTP server. No
 * browser mock is involved: the proxy resolves, validates and connects itself.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import net from 'node:net';
import { startBrowserProxy, resolveBrowserTarget, type BrowserProxyHandle } from './browser-proxy.js';

let target: Server;
let targetPort = 0;
let proxy: BrowserProxyHandle;
let restrictedProxy: BrowserProxyHandle;
let blockedClientProxy: BrowserProxyHandle;

before(async () => {
  target = createServer((req, res) => {
    if (req.url === '/host') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`host:${String(req.headers.host ?? '')}`);
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`real-target:${req.url ?? '/'}`);
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', () => resolve()));
  const address = target.address();
  targetPort = typeof address === 'object' && address ? address.port : 0;
  proxy = await startBrowserProxy({ allowPrivateForTests: true, allowedPorts: new Set([80, 443, targetPort]) });
  restrictedProxy = await startBrowserProxy({ allowPrivateForTests: true, testAllowedHosts: new Set(['127.0.0.1']), allowedPorts: new Set([80, 443, targetPort]) });
  const allowed = new net.BlockList();
  allowed.addSubnet('10.0.0.0', 8, 'ipv4');
  blockedClientProxy = await startBrowserProxy({ allowPrivateForTests: true, allowedPorts: new Set([80, 443, targetPort]), allowedClients: allowed });
});

after(async () => {
  await proxy.close();
  await restrictedProxy.close();
  await blockedClientProxy.close();
  await new Promise<void>((resolve) => target.close(() => resolve()));
});

function proxyRequest(url: string, handle: BrowserProxyHandle = proxy, hostHeader?: string): Promise<{ status: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const address = handle.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const request = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: url, headers: { host: hostHeader ?? new URL(url).host } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body, location: response.headers.location }));
    });
    request.on('error', reject);
    request.end();
  });
}

function connectRequest(host: string, port: number, handle: BrowserProxyHandle = restrictedProxy): Promise<string> {
  return new Promise((resolve, reject) => {
    const address = handle.server.address();
    const proxyPort = typeof address === 'object' && address ? address.port : 0;
    const socket = net.connect(proxyPort, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    let settled = false;
    const finish = () => { if (settled) return; settled = true; socket.destroy(); resolve(data); };
    socket.on('data', (chunk: string) => { data += chunk; finish(); });
    socket.on('error', (error) => { if (!settled) { settled = true; reject(error); } });
    socket.on('connect', () => socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`));
    socket.on('end', finish);
    socket.on('close', finish);
  });
}

test('proxy forwards an allowed destination and strips proxy credentials', async () => {
  const response = await proxyRequest(`http://127.0.0.1:${targetPort}/allowed`);
  assert.equal(response.status, 200);
  assert.match(response.body, /real-target:\/allowed/u);
});

test('proxy blocks loopback, IPv6 loopback, link-local metadata and private DNS answers', async () => {
  await assert.rejects(resolveBrowserTarget('127.0.0.1', targetPort, { allowPrivateForTests: false, allowedPorts: new Set([targetPort]) }), /blocked address|BLOCKED_TARGET/u);
  await assert.rejects(resolveBrowserTarget('::1', targetPort, { allowPrivateForTests: false, allowedPorts: new Set([targetPort]) }), /blocked address|BLOCKED_TARGET/u);
  await assert.rejects(resolveBrowserTarget('::ffff:127.0.0.1', targetPort, { allowPrivateForTests: false, allowedPorts: new Set([targetPort]) }), /blocked address|BLOCKED_TARGET/u);
  await assert.rejects(resolveBrowserTarget('169.254.169.254', 80, { allowPrivateForTests: false }), /BLOCKED_TARGET/u);
  await assert.rejects(resolveBrowserTarget('metadata.google.internal', 80, { allowPrivateForTests: false }), /BLOCKED_TARGET/u);
  await assert.rejects(resolveBrowserTarget('example.com', 80, {
    allowPrivateForTests: false,
    lookup: async () => [{ address: '10.12.0.7', family: 4 }],
  }), /resolved to blocked address/u);
});

test('DNS rebinding is revalidated on every connection', async () => {
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    return calls === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
  };
  const first = await resolveBrowserTarget('rebind.example', 80, { allowPrivateForTests: false, lookup });
  assert.equal(first.address, '93.184.216.34');
  await assert.rejects(resolveBrowserTarget('rebind.example', 80, { allowPrivateForTests: false, lookup }), /resolved to blocked address/u);
  assert.equal(calls, 2);
});

test('a redirect target is validated again and cannot reach metadata', async () => {
  const redirect = await proxyRequest(`http://127.0.0.1:${targetPort}/redirect`, restrictedProxy);
  assert.equal(redirect.status, 302);
  assert.match(redirect.location ?? '', /169\.254\.169\.254/u);
  const blocked = await proxyRequest('http://169.254.169.254/latest/meta-data/', restrictedProxy);
  assert.equal(blocked.status, 403);
});

test('proxy ignores a client-supplied Host header and binds it to the validated target', async () => {
  const response = await proxyRequest(`http://127.0.0.1:${targetPort}/host`, proxy, 'metadata.google.internal');
  assert.equal(response.status, 200);
  assert.match(response.body, new RegExp(`host:127\.0\.0\.1:${targetPort}`, 'u'));
});

test('proxy refuses clients outside the authorized browser subnet', async () => {
  const response = await proxyRequest(`http://127.0.0.1:${targetPort}/allowed`, blockedClientProxy);
  assert.equal(response.status, 403);
  const denied = await connectRequest('127.0.0.1', targetPort, blockedClientProxy);
  assert.match(denied, /^HTTP\/1\.1 403/u);
});

test('plain HTTP WebSocket upgrades are refused instead of bypassing URL validation', async () => {
  const address = proxy.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const data = await new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let text = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => { text += chunk; });
    socket.on('error', reject);
    socket.on('close', () => resolve(text));
    socket.on('connect', () => socket.write('GET http://127.0.0.1/ws HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
  });
  assert.match(data, /^HTTP\/1\.1 405/u);
});

test('CONNECT refuses private destinations and accepts an explicitly allowed test target', async () => {
  const denied = await connectRequest('metadata.google.internal', 80);
  assert.match(denied, /^HTTP\/1\.1 403/u);
  const allowed = await connectRequest('127.0.0.1', targetPort);
  assert.match(allowed, /^HTTP\/1\.1 200/u);
});
