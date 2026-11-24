/**
 * WORA secret store — encrypted values for extensions and integrations.
 *
 * New writes use the deployment keyring (`security/keyring.ts`) and bind each
 * ciphertext to its workspace, name and purpose with AES-GCM AAD. Existing
 * legacy rows remain readable through the previous AUTH_SECRET/local-key
 * derivation; migration and rotation are explicit, audited operations.
 *
 * Reads return metadata only. Plaintext is available to the runtime through
 * `revealSecret` and never reaches an HTTP response or a log line.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getOsDb, newId, nowIso, audit } from '../os/db.js';
import { ensureExtensionSchema } from './schema.js';
import { sanitizeEnv } from '../lib/config.js';
import { activeKey, keyFor, keyringStatus, requireManagedKey } from '../security/keyring.js';

const keyFile = () => process.env['WORA_EXT_KEY_FILE']?.trim() || path.join(process.cwd(), 'data', '.ext-secret-key');
const NEW_FORMAT = 'aes-256-gcm-v2';

let cachedLegacyKey: Buffer | null = null;

/** Previous derivation, retained only to read and explicitly migrate old rows. */
function legacyKey(): Buffer {
  if (cachedLegacyKey) return cachedLegacyKey;
  const root = sanitizeEnv(process.env['AUTH_SECRET']);
  if (root) {
    cachedLegacyKey = Buffer.from(hkdfSync('sha256', Buffer.from(root, 'utf8'), Buffer.from('wora-extensions', 'utf8'), Buffer.from('package-secrets-v1', 'utf8'), 32));
    return cachedLegacyKey;
  }
  const file = keyFile();
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
  }
  const raw = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  if (raw.byteLength !== 32) throw new Error('Extension secret key file is invalid');
  cachedLegacyKey = raw;
  return cachedLegacyKey;
}

export function resetSecretKeyForTests(): void {
  cachedLegacyKey = null;
}

export interface SecretMetadata {
  id: string;
  name: string;
  purpose: string;
  keyId: string | null;
  format: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface SecretRow {
  id: string; workspace_id: string; name: string; purpose: string;
  ciphertext: string; iv: string; tag: string; key_id: string | null; format: string | null; aad: string | null;
}

function secretAad(workspaceId: string, name: string, purpose: string): string {
  return `wora:extension-secret:${workspaceId}:${name}:${purpose}`;
}

function encrypt(value: string, aad: string, keyId?: string): { ciphertext: string; iv: string; tag: string; keyId: string } {
  const selected = keyId ? { id: keyId, key: keyFor(keyId) } : activeKey();
  if (!selected.key) throw new Error(`Secret key ${selected.id} is not configured`);
  const { id, key } = selected;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), keyId: id };
}

function decryptRow(row: SecretRow): string {
  if (row.format === NEW_FORMAT && row.key_id) {
    const key = keyFor(row.key_id);
    if (!key) throw new Error(`Secret key ${row.key_id} is not configured`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
      decipher.setAAD(Buffer.from(secretAad(row.workspace_id, row.name, row.purpose), 'utf8'));
      decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Secret failed authentication');
    }
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', legacyKey(), Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Secret failed authentication');
  }
}

export function putSecret(input: { workspaceId: string; name: string; value: string; purpose?: string; actor: string }): SecretMetadata {
  ensureExtensionSchema();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.name)) throw new Error('Secret names must be uppercase identifiers (A-Z, 0-9, _)');
  if (!input.value || input.value.length > 8_000) throw new Error('Secret value is empty or too large');
  requireManagedKey();
  const purpose = input.purpose ?? 'plugin';
  const aad = secretAad(input.workspaceId, input.name, purpose);
  const sealed = encrypt(input.value, aad);
  const db = getOsDb();
  const ts = nowIso();
  const existing = db.prepare('SELECT id, created_at FROM ext_secrets WHERE workspace_id = ? AND name = ?')
    .get(input.workspaceId, input.name) as { id: string; created_at: string } | undefined;
  const id = existing?.id ?? newId('sec');
  db.prepare(
    `INSERT INTO ext_secrets (id, workspace_id, name, purpose, ciphertext, iv, tag, key_id, format, version, aad, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
       key_id = excluded.key_id, format = excluded.format, version = excluded.version, aad = excluded.aad,
       purpose = excluded.purpose, updated_at = excluded.updated_at`,
  ).run(id, input.workspaceId, input.name, purpose, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyId, NEW_FORMAT, aad,
    input.actor, existing?.created_at ?? ts, ts);
  audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'extension.secret.write', subject: input.name, detail: { purpose, keyId: sealed.keyId } });
  return { id, name: input.name, purpose, keyId: sealed.keyId, format: NEW_FORMAT, createdBy: input.actor, createdAt: existing?.created_at ?? ts, updatedAt: ts };
}

export function listSecrets(workspaceId: string): SecretMetadata[] {
  ensureExtensionSchema();
  const rows = getOsDb().prepare('SELECT id, name, purpose, key_id, format, created_by, created_at, updated_at FROM ext_secrets WHERE workspace_id = ? ORDER BY name')
    .all(workspaceId) as Array<Record<string, string | null>>;
  return rows.map((row) => ({
    id: row['id'] ?? '', name: row['name'] ?? '', purpose: row['purpose'] ?? '',
    keyId: row['key_id'] ?? null, format: row['format'] ?? 'legacy-aes-gcm',
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
  const row = getOsDb().prepare('SELECT * FROM ext_secrets WHERE workspace_id = ? AND name = ?')
    .get(workspaceId, name) as SecretRow | undefined;
  if (!row) return null;
  try { return decryptRow(row); } catch { return null; }
}

/** Internal migration/rotation path: preserves the failure reason for an operator. */
export function revealSecretOrThrow(workspaceId: string, name: string): string {
  ensureExtensionSchema();
  const row = getOsDb().prepare('SELECT * FROM ext_secrets WHERE workspace_id = ? AND name = ?')
    .get(workspaceId, name) as SecretRow | undefined;
  if (!row) throw new Error('Secret not found');
  return decryptRow(row);
}

export function secretExists(workspaceId: string, name: string): boolean {
  ensureExtensionSchema();
  return Boolean(getOsDb().prepare('SELECT 1 FROM ext_secrets WHERE workspace_id = ? AND name = ?').get(workspaceId, name));
}

export function secretKeyStatus() {
  return { ...keyringStatus(), legacyFallback: Boolean(sanitizeEnv(process.env['AUTH_SECRET']) || existsSync(keyFile())) };
}

export interface RotationResult {
  dryRun: boolean;
  targetKeyId: string;
  scanned: number;
  rotated: number;
  skipped: number;
  failed: number;
  details: Array<{ workspaceId: string; name: string; from: string; to: string; status: 'rotated' | 'skipped' | 'failed'; error?: string }>;
}

/**
 * Re-encrypt secrets under a configured key. `migrateLegacy` also upgrades
 * legacy rows to the active format. Dry-run never writes. The whole batch is
 * one SQLite transaction, so a failure leaves every row unchanged.
 */
export function rotateSecrets(input: { workspaceId?: string; toKeyId?: string; actor: string; dryRun?: boolean; migrateLegacy?: boolean }): RotationResult {
  ensureExtensionSchema();
  const target = input.toKeyId ?? keyringStatus().active;
  if (!keyFor(target)) throw new Error(`Target secret key ${target} is not configured`);
  const db = getOsDb();
  const rows = (input.workspaceId
    ? db.prepare('SELECT * FROM ext_secrets WHERE workspace_id = ? ORDER BY workspace_id, name').all(input.workspaceId)
    : db.prepare('SELECT * FROM ext_secrets ORDER BY workspace_id, name').all()) as unknown as SecretRow[];
  const result: RotationResult = { dryRun: Boolean(input.dryRun), targetKeyId: target, scanned: rows.length, rotated: 0, skipped: 0, failed: 0, details: [] };
  const updates: Array<{ row: SecretRow; sealed: ReturnType<typeof encrypt>; aad: string }> = [];
  for (const row of rows) {
    const from = row.format === NEW_FORMAT && row.key_id ? row.key_id : 'legacy';
    try {
      if (row.format === NEW_FORMAT && row.key_id === target && !input.migrateLegacy) {
        result.skipped += 1;
        result.details.push({ workspaceId: row.workspace_id, name: row.name, from, to: target, status: 'skipped' });
        continue;
      }
      const plaintext = decryptRow(row);
      const aad = secretAad(row.workspace_id, row.name, row.purpose);
      updates.push({ row, sealed: encrypt(plaintext, aad, target), aad });
      result.rotated += 1;
      result.details.push({ workspaceId: row.workspace_id, name: row.name, from, to: target, status: 'rotated' });
    } catch (error) {
      result.failed += 1;
      result.details.push({ workspaceId: row.workspace_id, name: row.name, from, to: target, status: 'failed', error: (error instanceof Error ? error.message : 'rotation failed').slice(0, 200) });
    }
  }
  if (result.dryRun || !updates.length) return result;
  if (result.failed) throw new Error(`Rotation aborted: ${result.failed} secret(s) could not be decrypted; no rows were changed`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const update of updates) {
      db.prepare('UPDATE ext_secrets SET ciphertext = ?, iv = ?, tag = ?, key_id = ?, format = ?, version = version + 1, aad = ?, updated_at = ? WHERE id = ?')
        .run(update.sealed.ciphertext, update.sealed.iv, update.sealed.tag, update.sealed.keyId, NEW_FORMAT, update.aad, nowIso(), update.row.id);
    }
    audit(db, { workspaceId: input.workspaceId ?? '*', actor: input.actor, action: 'extension.secret.rotate', subject: target, detail: { scanned: result.scanned, rotated: result.rotated, skipped: result.skipped, legacyMigration: Boolean(input.migrateLegacy) } });
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

/** Explicit, reversible-by-backup migration for rows written before key IDs existed. */
export function migrateLegacySecrets(input: { workspaceId?: string; actor: string; dryRun?: boolean }): RotationResult {
  return rotateSecrets({ ...input, migrateLegacy: true });
}
