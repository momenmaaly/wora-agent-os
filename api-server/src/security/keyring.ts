/**
 * WORA secret keyring.
 *
 * Keys are supplied by the deployment, never generated into source or committed.
 * Supported sources, in order:
 *   WORA_SECRET_KEYS       JSON: {"active":"v2","keys":{"v1":"base64...","v2":"base64..."}}
 *   WORA_SECRET_KEY        one base64 32-byte key, labelled env-v1
 *   WORA_SECRET_KEY_FILE   0600 JSON keyring file (same shape as WORA_SECRET_KEYS)
 *
 * A local 0600 key file is generated only for development/test when no key is
 * configured. Production should configure an explicit keyring; the status
 * endpoint reports the source and key IDs, never key material.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sanitizeEnv } from '../lib/config.js';

export interface Keyring {
  active: string;
  keys: Map<string, Buffer>;
  source: 'env-json' | 'env-single' | 'file' | 'generated-file';
}

const KEY_ID = /^[A-Za-z0-9._-]{1,40}$/u;
let cached: Keyring | null = null;

function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const bytes = /^[0-9a-f]{64}$/iu.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (bytes.byteLength !== 32) throw new Error('Secret keys must decode to exactly 32 bytes');
  return bytes;
}

function parseKeyringJson(raw: string): { active: string; keys: Map<string, Buffer> } {
  const parsed = JSON.parse(raw) as { active?: unknown; keys?: unknown };
  if (!parsed || typeof parsed !== 'object' || typeof parsed.active !== 'string' || !parsed.keys || typeof parsed.keys !== 'object') {
    throw new Error('Secret keyring must contain an active key id and a keys object');
  }
  if (!KEY_ID.test(parsed.active)) throw new Error('Invalid active secret key id');
  const keys = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(parsed.keys as Record<string, unknown>)) {
    if (!KEY_ID.test(id) || typeof value !== 'string') throw new Error('Invalid secret key entry');
    keys.set(id, decodeKey(value));
  }
  if (!keys.has(parsed.active)) throw new Error('Active secret key id is not present in the keyring');
  return { active: parsed.active, keys };
}

function defaultFile(): string {
  return process.env['WORA_SECRET_KEY_FILE']?.trim() || path.join(process.cwd(), 'data', '.wora-secret-key');
}

function loadFile(file: string): Keyring {
  if (!existsSync(file) && process.env['NODE_ENV'] === 'production') {
    throw new Error('No managed secret keyring is configured; set WORA_SECRET_KEYS, WORA_SECRET_KEY or WORA_SECRET_KEY_FILE');
  }
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    const key = randomBytes(32).toString('base64');
    const body = JSON.stringify({ active: 'generated-v1', keys: { 'generated-v1': key } });
    writeFileSync(file, body, { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
    return { ...parseKeyringJson(body), source: 'generated-file' };
  }
  const body = readFileSync(file, 'utf8').trim();
  return { ...parseKeyringJson(body), source: 'file' };
}

export function loadKeyring(env: NodeJS.ProcessEnv = process.env): Keyring {
  if (cached) return cached;
  const json = sanitizeEnv(env['WORA_SECRET_KEYS']);
  if (json) { cached = { ...parseKeyringJson(json), source: 'env-json' }; return cached; }
  const single = sanitizeEnv(env['WORA_SECRET_KEY']);
  if (single) {
    cached = { active: 'env-v1', keys: new Map([['env-v1', decodeKey(single)]]), source: 'env-single' };
    return cached;
  }
  cached = loadFile(defaultFile());
  return cached;
}

export function resetKeyringForTests(): void {
  cached = null;
}

export function keyFor(id: string): Buffer | null {
  return loadKeyring().keys.get(id) ?? null;
}

export function activeKey(): { id: string; key: Buffer } {
  const ring = loadKeyring();
  const key = ring.keys.get(ring.active);
  if (!key) throw new Error('Active secret key is unavailable');
  return { id: ring.active, key };
}

export function keyringStatus(): { active: string; ids: string[]; source: Keyring['source']; productionExplicit: boolean } {
  const ring = loadKeyring();
  return {
    active: ring.active,
    ids: [...ring.keys.keys()].sort(),
    source: ring.source,
    productionExplicit: ring.source === 'env-json' || ring.source === 'env-single' || ring.source === 'file',
  };
}

/** Production callers can refuse to write secrets when only a generated local key exists. */
export function requireManagedKey(): void {
  if (process.env['NODE_ENV'] !== 'development' && process.env['NODE_ENV'] !== 'test' && !keyringStatus().productionExplicit) {
    throw new Error('A managed secret keyring is required outside development/test');
  }
}
