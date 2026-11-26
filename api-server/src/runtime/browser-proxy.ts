/**
 * Connection-time outbound proxy for browser traffic.
 *
 * Chromium is configured to send every HTTP(S) request through this proxy.
 * The proxy resolves the destination itself, rejects private/loopback/link-local
 * addresses and cloud metadata names, then connects to the exact validated
 * address. Redirects and new page requests are separate proxy requests, so each
 * one is validated again at connection time.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import type { Duplex } from 'node:stream';
import { isBlockedAddress, isBlockedHostname } from '../lib/safe-fetch.js';

const DEFAULT_PORTS = new Set([80, 443]);

export interface BrowserTarget {
  host: string;
  port: number;
  addresses: string[];
  address: string;
  family: 4 | 6;
}

export interface BrowserProxyOptions {
  host?: string;
  port?: number;
  /** Test-only escape hatch. Never enable outside the test process. */
  allowPrivateForTests?: boolean;
  /** Test-only exact host allowlist, used with allowPrivateForTests. */
  testAllowedHosts?: ReadonlySet<string>;
  allowedPorts?: ReadonlySet<number>;
  /** Restrict callers to an address range (for example the browser Docker subnet). */
  allowedClients?: net.BlockList;
  /** Listen on a Unix socket shared with the isolated browser container. */
  socketPath?: string;
  /** Reject this caller even when it falls inside allowedClients (the Docker gateway). */
  blockedClient?: string;
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface BrowserProxyHandle {
  url: string;
  server: http.Server;
  close(): Promise<void>;
}

function configuredPorts(): ReadonlySet<number> {
  const ports = new Set(DEFAULT_PORTS);
  if (process.env['NODE_ENV'] === 'test' && process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] === '1') {
    for (const raw of (process.env['WORA_TEST_ALLOWED_PORTS'] ?? '').split(',')) {
      const port = Number(raw.trim());
      if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port);
    }
  }
  return ports;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
}

export async function resolveBrowserTarget(host: string, port: number, options: BrowserProxyOptions = {}): Promise<BrowserTarget> {
  const normalized = normalizeHost(host);
  if (!normalized || normalized.length > 253 || port < 1 || port > 65535) throw new Error('BLOCKED_TARGET: invalid destination');
  const ports = options.allowedPorts ?? configuredPorts();
  if (!ports.has(port)) throw new Error(`BLOCKED_TARGET: port ${port} is not allowed`);

  const testAllowed = options.allowPrivateForTests === true && (!options.testAllowedHosts || options.testAllowedHosts.has(normalized));
  if (!testAllowed && isBlockedHostname(normalized)) throw new Error(`BLOCKED_TARGET: host ${normalized} is not allowed`);

  const lookup = options.lookup ?? ((name: string) => dnsLookup(name, { all: true, verbatim: true }));
  let addresses: Array<{ address: string; family: number }>;
  if (net.isIP(normalized)) {
    addresses = [{ address: normalized, family: net.isIP(normalized) }];
  } else {
    try { addresses = await lookup(normalized); }
    catch { throw new Error(`BLOCKED_TARGET: DNS resolution failed for ${normalized}`); }
  }
  const usable = addresses.filter((entry) => Number.isInteger(entry.family) && (entry.family === 4 || entry.family === 6));
  if (usable.length === 0) throw new Error(`BLOCKED_TARGET: no usable address for ${normalized}`);
  // Reject the whole answer if any address is internal. Accepting only the
  // public member would make the result depend on DNS answer ordering.
  for (const entry of usable) {
    if (isBlockedAddress(entry.address) && !testAllowed) throw new Error(`BLOCKED_TARGET: ${normalized} resolved to blocked address ${entry.address}`);
  }
  const chosen = usable[0]!;
  return { host: normalized, port, addresses: usable.map((entry) => entry.address), address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

function strippedHeaders(raw: http.IncomingHttpHeaders, targetHost: string): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    if (lower === 'proxy-authorization' || lower === 'proxy-connection' || lower === 'connection' || lower === 'host') continue;
    if (lower === 'forwarded' || lower.startsWith('x-forwarded-') || lower === 'via') continue;
    if (value !== undefined) headers[key] = value;
  }
  // The proxy client must not be able to select a different virtual host on the
  // resolved IP. The host header always follows the validated absolute URL.
  headers['host'] = targetHost;
  return headers;
}

function mappedIpv4(address: string): string | null {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address.trim());
  return match?.[1] ?? null;
}

function clientAllowed(address: string | undefined, options: BrowserProxyOptions): boolean {
  if (!options.allowedClients) return true;
  if (!address) return false;
  const normalized = mappedIpv4(address) ?? normalizeHost(address);
  if (options.blockedClient && normalizeHost(options.blockedClient) === normalized) return false;
  const family = net.isIP(normalized);
  if (family !== 4 && family !== 6) return false;
  return options.allowedClients.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
}

function deny(socket: Duplex, status: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse, options: BrowserProxyOptions): void {
  if (!clientAllowed(req.socket.remoteAddress, options)) { res.writeHead(403, { connection: 'close' }); res.end('Proxy client is not authorized'); return; }
  let targetUrl: URL;
  try { targetUrl = new URL(req.url ?? ''); }
  catch { res.writeHead(400, { connection: 'close' }); res.end('Bad proxy request'); return; }
  if (targetUrl.protocol !== 'http:') { res.writeHead(400, { connection: 'close' }); res.end('Only http absolute requests are proxied; https must use CONNECT'); return; }
  if (targetUrl.username || targetUrl.password) { res.writeHead(403, { connection: 'close' }); res.end('Credentials are not allowed'); return; }
  void resolveBrowserTarget(targetUrl.hostname, Number(targetUrl.port || 80), options).then((target) => {
    const upstream = http.request({
      host: target.address,
      port: target.port,
      method: req.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: strippedHeaders(req.headers, targetUrl.host),
      timeout: 30_000,
      agent: false,
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', (error) => {
      if (!res.headersSent) res.writeHead(502, { connection: 'close' });
      res.end(`Upstream error: ${error.message}`);
    });
    req.pipe(upstream);
  }).catch((error: unknown) => {
    res.writeHead(403, { connection: 'close', 'content-type': 'text/plain; charset=utf-8' });
    res.end(error instanceof Error ? error.message : 'Blocked target');
  });
}

function proxyConnect(req: http.IncomingMessage, socket: Duplex, head: Buffer, options: BrowserProxyOptions): void {
  if (!clientAllowed((socket as net.Socket).remoteAddress, options)) { deny(socket, '403 Forbidden'); return; }
  const raw = req.url ?? '';
  const match = /^\[?([^\]]+?)\]?:(\d+)$/u.exec(raw);
  if (!match) { deny(socket, '400 Bad Request'); return; }
  const host = match[1]!;
  const port = Number(match[2]);
  if (head.length) { deny(socket, '400 Bad Request'); return; }
  void resolveBrowserTarget(host, port, options).then((target) => {
    const upstream = net.connect({ host: target.address, port: target.port });
    const fail = (status = '502 Bad Gateway') => { if (!upstream.destroyed) upstream.destroy(); deny(socket, status); };
    upstream.setTimeout(30_000, () => fail('504 Gateway Timeout'));
    upstream.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: WORA-Browser-Proxy\r\n\r\n');
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.once('error', () => fail());
    socket.once('error', () => { if (!upstream.destroyed) upstream.destroy(); });
    socket.once('close', () => { if (!upstream.destroyed) upstream.destroy(); });
  }).catch((error: unknown) => {
    deny(socket, `403 Forbidden`);
    void error;
  });
}

export async function startBrowserProxy(options: BrowserProxyOptions = {}): Promise<BrowserProxyHandle> {
  const server = http.createServer((req, res) => proxyRequest(req, res, options));
  server.on('connect', (req, socket, head) => proxyConnect(req, socket, head, options));
  // WebSocket/HTTP upgrades are deliberately refused. TLS WebSockets are still
  // proxied as validated CONNECT tunnels; plain ws:// must not bypass validation.
  server.on('upgrade', (_req, socket) => { deny(socket, '405 Method Not Allowed'); });
  server.on('clientError', (_error, socket) => { deny(socket, '400 Bad Request'); });
  if (options.socketPath) {
    if (existsSync(options.socketPath)) rmSync(options.socketPath, { force: true });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.socketPath!, () => resolve());
    });
    return {
      url: 'http://127.0.0.1:3128',
      server,
      close: () => new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => { try { rmSync(options.socketPath!, { force: true }); } catch { /* already removed */ } resolve(); });
      }),
    };
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Browser proxy failed to bind');
  return {
    url: `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`,
    server,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
