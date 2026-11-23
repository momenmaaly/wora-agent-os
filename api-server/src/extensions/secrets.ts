/**
 * WORA extensions — secret isolation.
 *
 * Values are encrypted with AES-256-GCM before they touch SQLite. The key is
 * derived from AUTH_SECRET (HKDF-SHA256) or, in a deployment without one, from
 * a 0600 local key file, so secrets are never stored in clear text. Reads
 * return metadata only; plaintext is available to the runtime through
 * `revealSecret` and never reaches an HTTP response or a log line.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getOsDb, newId, nowIso, audit } from '../os/db.js';
import { ensureExtensionSchema } from './schema.js';
import { sanitizeEnv } from '../lib/config.js';

const keyFile = () => process.env['WORA_EXT_KEY_FILE']?.trim() || path.join(process.cwd(), 'data', '.ext-secret-key');

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const root = sanitizeEnv(process.env['AUTH_SECRET']);
  if (root) {
    cachedKey = Buffer.from(hkdfSync('sha256', Buffer.from(root, 'utf8'), Buffer.from('wora-extensions', 'utf8'), Buffer.from('package-secrets-v1', 'utf8'), 32));
    return cachedKey;
  }
  const file = keyFile();
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
  }
  const raw = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  if (raw.byteLength !== 32) throw new Error('Extension secret key file is invalid');
  cachedKey = raw;
  return cachedKey;
}

export function resetSecretKeyForTests(): void {
  cachedKey = null;
}

export interface SecretMetadata {
  id: string;
  name: string;
  purpose: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function putSecret(input: { workspaceId: string; name: string; value: string; purpose?: string; actor: string }): SecretMetadata {
  ensureExtensionSchema();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.name)) throw new Error('Secret names must be uppercase identifiers (A-Z, 0-9, _)');
  if (!input.value || input.value.length > 8_000) throw new Error('Secret value is empty or too large');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(input.value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const db = getOsDb();
  const ts = nowIso();
  const existing = db.prepare('SELECT id, created_at FROM ext_secrets WHERE workspace_id = ? AND name = ?')
    .get(input.workspaceId, input.name) as { id: string; created_at: string } | undefined;
  const id = existing?.id ?? newId('sec');
  db.prepare(
    `INSERT INTO ext_secrets (id, workspace_id, name, purpose, ciphertext, iv, tag, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
       purpose = excluded.purpose, updated_at = excluded.updated_at`,
  ).run(id, input.workspaceId, input.name, input.purpose ?? 'plugin', ciphertext.toString('base64'),
    iv.toString('base64'), tag.toString('base64'), input.actor, existing?.created_at ?? ts, ts);
  audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'extension.secret.write', subject: input.name, detail: { purpose: input.purpose ?? 'plugin' } });
  return { id, name: input.name, purpose: input.purpose ?? 'plugin', createdBy: input.actor, createdAt: existing?.created_at ?? ts, updatedAt: ts };
}

export function listSecrets(workspaceId: string): SecretMetadata[] {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT id, name, purpose, created_by, created_at, updated_at FROM ext_secrets WHERE workspace_id = ? ORDER BY name')
    .all(workspaceId) as Array<Record<string, string>>;
  return rows.map((row) => ({
    id: row['id'] ?? '', name: row['name'] ?? '', purpose: row['purpose'] ?? '',
    createdBy: row['created_by'] ?? '', createdAt: row['created_at'] ?? '', updatedAt: row['updated_at'] ?? '',
  }));
}

export function deleteSecret(workspaceId: string, name: string, actor: string): boolean {
  ensureExtensionSchema();
  const db = getOsDb();
  const result = db.prepare('DELETE FROM ext_secrets WHERE workspace_id = ? AND name = ?').run(workspaceId, name);
  if (Number(result.changes) > 0) audit(db, { workspaceId, actor, action: 'extension.secret.delete', subject: name });
  return Number(result.changes) > 0;
}

/** Internal only: used by the marketplace and plugin runtime, never returned over HTTP. */
export function revealSecret(workspaceId: string, name: string): string | null {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT ciphertext, iv, tag FROM ext_secrets WHERE workspace_id = ? AND name = ?')
    .get(workspaceId, name) as { ciphertext: string; iv: string; tag: string } | undefined;
  if (!row) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function secretExists(workspaceId: string, name: string): boolean {
  ensureExtensionSchema();
  return Boolean(getOsDb().prepare('SELECT 1 FROM ext_secrets WHERE workspace_id = ? AND name = ?').get(workspaceId, name));
}
