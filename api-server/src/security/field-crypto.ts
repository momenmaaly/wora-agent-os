/**
 * Envelope encryption for sensitive operational fields.
 *
 * New values are AES-256-GCM ciphertexts prefixed with `wora:enc:v1:<keyId>`.
 * Existing plaintext rows remain readable for migration; the migration helper
 * rewrites them explicitly rather than at read time.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { activeKey, keyFor } from './keyring.js';

const PREFIX = 'wora:enc:v1:';
const IV_BYTES = 12;

export function isSealedField(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function sealField(plaintext: string, aad: string): string {
  if (plaintext.length > 256_000) throw new Error('Field is too large to seal');
  const { id, key } = activeKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${PREFIX}${id}:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function openField(value: string | null | undefined, aad: string): string | null {
  if (value == null) return null;
  if (!isSealedField(value)) return value;
  const rest = value.slice(PREFIX.length);
  const [keyId, ivRaw, tagRaw, cipherRaw] = rest.split(':');
  if (!keyId || !ivRaw || !tagRaw || !cipherRaw) throw new Error('Malformed sealed field');
  const key = keyFor(keyId);
  if (!key) throw new Error(`Secret key ${keyId} is not configured; cannot decrypt field`);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(cipherRaw, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Sealed field failed authentication');
  }
}

export function sealJson(value: unknown, aad: string): string {
  return sealField(JSON.stringify(value ?? {}), aad);
}

export function openJson<T>(value: string | null | undefined, aad: string, fallback: T): T {
  const opened = openField(value, aad);
  if (opened == null) return fallback;
  try { return JSON.parse(opened) as T; } catch { return fallback; }
}

export function fieldAad(kind: string, workspaceId: string, id: string): string {
  return `wora:${kind}:${workspaceId}:${id}`;
}
