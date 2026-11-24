/**
 * Bounded outbound HTTP fetch with SSRF protections.
 *
 * Every URL is validated, every hostname is resolved through a lookup callback
 * that rejects private, loopback, link-local, reserved and metadata addresses,
 * and the validated address is the one Node connects to. Redirects are followed
 * manually and revalidated one by one. No credentials, non-HTTP schemes or
 * non-web ports are accepted by default.
 *
 * The response body is streamed and capped after decompression. Plugin and MCP
 * callers disable redirects so credentials are never forwarded to a new origin.
 */
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';

export type SafeFetchErrorCode =
  | 'INVALID_URL'
  | 'UNSAFE_SCHEME'
  | 'UNSAFE_PORT'
  | 'UNSAFE_CREDENTIALS'
  | 'BLOCKED_HOST'
  | 'BLOCKED_ADDRESS'
  | 'NO_ADDRESS'
  | 'REDIRECT_LIMIT'
  | 'REDIRECT_LOOP'
  | 'REDIRECT_DOWNGRADE'
  | 'REDIRECT_DISABLED'
  | 'UNSUPPORTED_ENCODING'
  | 'RESPONSE_TOO_LARGE'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'REQUEST_FAILED';

export class SafeFetchError extends Error {
  constructor(readonly code: SafeFetchErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SafeFetchError';
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string | Buffer;
  allowRedirects?: boolean;
  allowedPorts?: ReadonlySet<string>;
  signal?: AbortSignal;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

const MAX_URL_LENGTH = 2_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const ALLOWED_PORTS = new Set(['', '80', '443']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.home.arpa',
  '.lan',
  '.svc',
  '.cluster.local',
];

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.azure.internal',
  'instance-data',
  'instance-data.ec2.internal',
]);

/** Test-only loopback allowance. Never enable this in a production environment. */
function allowPrivateForTests(): boolean {
  return process.env['NODE_ENV'] === 'test' && process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] === '1';
}

function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = ((value << 8) + octet) >>> 0;
  }
  return value;
}

function inV4Range(value: number, base: string, bits: number): boolean {
  const baseValue = ipv4ToInt(base);
  if (baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

const BLOCKED_V4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

export function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true;
  return BLOCKED_V4_RANGES.some(([base, bits]) => inV4Range(value, base, bits));
}

function parseIpv6(address: string): number[] | null {
  let value = normalizeHost(address).split('%')[0] ?? '';
  if (!value.includes(':')) return null;
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    if (lastColon < 0) return null;
    const ipv4 = value.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const numeric = ipv4ToInt(ipv4);
    if (numeric === null) return null;
    const high = ((numeric >>> 16) & 0xffff).toString(16);
    const low = (numeric & 0xffff).toString(16);
    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  let groups: string[];
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  } else {
    groups = value.split(':');
  }
  if (groups.length !== 8) return null;
  const parsed = groups.map((group) => {
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return Number.NaN;
    return Number.parseInt(group, 16);
  });
  return parsed.some((group) => Number.isNaN(group)) ? null : parsed;
}

function mappedIpv4(groups: number[]): string | null {
  if (!groups.slice(0, 5).every((group) => group === 0) || groups[5] !== 0xffff) return null;
  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

export function isBlockedIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (!groups) return true;
  const mapped = mappedIpv4(groups);
  if (mapped) return isBlockedIpv4(mapped);

  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  const third = groups[2] ?? 0;

  // Unspecified, loopback, IPv4-compatible and other non-global space.
  if ((first & 0xe000) !== 0x2000) return true;
  if (first === 0x2002) return true;
  if (first === 0x3fff && (second & 0xf000) === 0) return true;
  if (first === 0x0064 && second === 0xff9b) return true;
  if (first === 0x0100 && second === 0 && third === 0) return true;

  if (first === 0x2001) {
    if (second === 0x0000 || second === 0x0002 || second === 0x0003) return true;
    if (second === 0x0004 && third === 0x0112) return true;
    if (second === 0x0db8) return true;
    if ((second & 0xfff0) === 0x0010) return true;
    if ((second & 0xfff0) === 0x0020) return true;
    if ((second & 0xfff0) === 0x0030) return true;
  }
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const host = normalizeHost(address);
  const version = isIP(host);
  if (version === 4) return isBlockedIpv4(host);
  if (version === 6) return isBlockedIpv6(host);
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (isIP(host) !== 0) return isBlockedAddress(host);
  // Single-label names are internal by convention; require a dotted FQDN.
  if (!host.includes('.')) return true;
  return false;
}

export function assertSafeUrl(raw: string, allowedPorts: ReadonlySet<string> = ALLOWED_PORTS): URL {
  if (!raw || raw.length > MAX_URL_LENGTH) throw new SafeFetchError('INVALID_URL', 'URL is empty or too long');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('INVALID_URL', 'URL is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('UNSAFE_SCHEME', 'Only http and https URLs are allowed');
  }
  if (url.username || url.password) {
    throw new SafeFetchError('UNSAFE_CREDENTIALS', 'URLs with embedded credentials are not allowed');
  }
  if (!allowedPorts.has(url.port)) {
    throw new SafeFetchError('UNSAFE_PORT', 'Only approved ports are allowed');
  }
  const host = normalizeHost(url.hostname);
  if (!allowPrivateForTests() && isBlockedHostname(host)) {
    throw new SafeFetchError('BLOCKED_HOST', `Destination host ${host} is not allowed`);
  }
  return url;
}

/** Validate a redirect target against the original scheme and the same URL policy. */
export function resolveRedirectTarget(current: URL, location: string, allowedPorts: ReadonlySet<string> = ALLOWED_PORTS): URL {
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw new SafeFetchError('INVALID_URL', 'Redirect target is not a valid URL');
  }
  assertSafeUrl(next.toString(), allowedPorts);
  if (current.protocol === 'https:' && next.protocol !== 'https:') {
    throw new SafeFetchError('REDIRECT_DOWNGRADE', 'HTTPS to HTTP redirects are not allowed');
  }
  return next;
}

type Resolver = (hostname: string, options: { all: true; verbatim: true }, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/** Validate a resolver result. Exported so tests can exercise a rebinding sequence. */
export function validateResolvedAddresses(addresses: LookupAddress[], allowPrivate = false): LookupAddress[] {
  if (addresses.length === 0) throw new SafeFetchError('NO_ADDRESS', 'Destination hostname has no addresses');
  if (!allowPrivate) {
    const blocked = addresses.find((entry) => isBlockedAddress(entry.address));
    if (blocked) throw new SafeFetchError('BLOCKED_ADDRESS', 'Destination resolves to a blocked address');
  }
  return addresses;
}

/** DNS lookup callback that validates every resolved address and pins the chosen one. */
export function safeLookupWithResolver(
  hostname: string,
  options: { all?: boolean },
  callback: (error: NodeJS.ErrnoException | SafeFetchError | null, address: string | LookupAddress[], family?: number) => void,
  resolver: Resolver = dnsLookup as unknown as Resolver,
  allowPrivate = allowPrivateForTests(),
): void {
  const host = normalizeHost(hostname);
  if (!allowPrivate && isBlockedHostname(host)) {
    callback(new SafeFetchError('BLOCKED_HOST', `Destination host ${host} is not allowed`), '');
    return;
  }
  resolver(host, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(new SafeFetchError('NO_ADDRESS', 'Destination hostname could not be resolved'), '');
      return;
    }
    let resolved: LookupAddress[];
    try {
      resolved = validateResolvedAddresses(addresses, allowPrivate);
    } catch (validationError) {
      callback(validationError as SafeFetchError, '');
      return;
    }
    if (options.all) {
      callback(null, resolved);
      return;
    }
    const chosen = resolved[0];
    if (!chosen) {
      callback(new SafeFetchError('NO_ADDRESS', 'Destination hostname has no addresses'), '');
      return;
    }
    callback(null, chosen.address, chosen.family);
  });
}

export const safeLookup: LookupFunction = (hostname, options, callback) => {
  safeLookupWithResolver(hostname, options, callback);
};

function requestOnce(url: URL, options: Required<Pick<SafeFetchOptions, 'timeoutMs' | 'maxBytes'>> & SafeFetchOptions): Promise<{ result: SafeFetchResult; location: string | null }> {
  return new Promise((resolve, reject) => {
    const host = normalizeHost(url.hostname);
    const method = options.method ?? 'GET';
    const body = options.body;
    const headers: Record<string, string> = {
      accept: 'text/html,text/plain,application/json',
      'user-agent': 'WORA-OS/1.0 (+authorized-research)',
      connection: 'close',
      ...(options.headers ?? {}),
    };
    if (body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-length')) {
      headers['content-length'] = String(Buffer.byteLength(body));
    }
    const requestOptions: RequestOptions = {
      protocol: url.protocol,
      hostname: host,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      lookup: (hostname, lookupOptions, callback) => safeLookupWithResolver(hostname, lookupOptions, callback),
      agent: false,
      ...(isIP(host) === 0 ? { servername: host } : {}),
    };
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let abortListener: (() => void) | null = null;
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const clearAbort = () => {
      if (abortListener && options.signal) options.signal.removeEventListener('abort', abortListener);
      abortListener = null;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimer();
      clearAbort();
      reject(error);
    };
    const done = (value: { result: SafeFetchResult; location: string | null }) => {
      if (settled) return;
      settled = true;
      clearTimer();
      clearAbort();
      resolve(value);
    };
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = transport(requestOptions, (response: IncomingMessage) => {
      const status = response.statusCode ?? 0;
      const location = typeof response.headers.location === 'string' ? response.headers.location : null;
      if (REDIRECT_STATUSES.has(status)) {
        response.resume();
        done({
          result: {
            url: url.toString(), status, contentType: '',
            headers: response.headers, body: Buffer.alloc(0),
          },
          location,
        });
        return;
      }

      const encoding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase();
      let stream: Readable = response;
      if (encoding === 'gzip' || encoding === 'x-gzip') stream = response.pipe(createGunzip());
      else if (encoding === 'deflate') stream = response.pipe(createInflate());
      else if (encoding === 'br') stream = response.pipe(createBrotliDecompress());
      else if (encoding && encoding !== 'identity') {
        response.destroy();
        fail(new SafeFetchError('UNSUPPORTED_ENCODING', `Unsupported content-encoding ${encoding}`));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > options.maxBytes) {
          fail(new SafeFetchError('RESPONSE_TOO_LARGE', 'Response exceeds the size limit'));
          stream.destroy();
          response.destroy();
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        done({
          result: {
            url: url.toString(),
            status,
            contentType: String(response.headers['content-type'] ?? ''),
            headers: response.headers,
            body: Buffer.concat(chunks),
          },
          location: null,
        });
      });
      stream.on('error', () => fail(new SafeFetchError('REQUEST_FAILED', 'Response stream failed')));
      response.on('aborted', () => fail(new SafeFetchError('REQUEST_FAILED', 'Response was aborted')));
      response.on('error', () => fail(new SafeFetchError('REQUEST_FAILED', 'Response stream failed')));
    });
    request.on('error', () => fail(new SafeFetchError('REQUEST_FAILED', 'Outbound request failed')));
    timer = setTimeout(() => {
      request.destroy();
      fail(new SafeFetchError('TIMEOUT', 'Outbound request timed out'));
    }, options.timeoutMs);
    timer.unref();
    if (options.signal) {
      if (options.signal.aborted) {
        request.destroy();
        fail(new SafeFetchError('ABORTED', 'Outbound request was aborted'));
        return;
      }
      abortListener = () => {
        request.destroy();
        fail(new SafeFetchError('ABORTED', 'Outbound request was aborted'));
      };
      options.signal.addEventListener('abort', abortListener, { once: true });
    }
    request.end(body);
  });
}

function stripSensitiveHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers;
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !SENSITIVE_HEADERS.has(key.toLowerCase())));
}

/** Fetch a URL with SSRF validation, manual redirects and a hard byte cap. */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const allowRedirects = options.allowRedirects !== false;
  const allowedPorts = options.allowedPorts ?? ALLOWED_PORTS;
  let current = assertSafeUrl(url, allowedPorts);
  let currentOptions = options;
  const visited = new Set<string>();
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (visited.has(current.toString())) throw new SafeFetchError('REDIRECT_LOOP', 'Redirect loop detected');
    visited.add(current.toString());
    const { result, location } = await requestOnce(current, { ...currentOptions, timeoutMs, maxBytes });
    if (!REDIRECT_STATUSES.has(result.status)) return result;
    if (!allowRedirects) throw new SafeFetchError('REDIRECT_DISABLED', 'Redirects are disabled for this request');
    if (!location) throw new SafeFetchError('INVALID_URL', 'Redirect response has no Location header');
    const next = resolveRedirectTarget(current, location, allowedPorts);
    if (next.origin !== current.origin) {
      currentOptions = { ...currentOptions, headers: stripSensitiveHeaders(currentOptions.headers) };
    }
    current = next;
  }
  throw new SafeFetchError('REDIRECT_LIMIT', 'Too many redirects');
}
