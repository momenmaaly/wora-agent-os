import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';

process.env['WORA_OS_DB'] = ':memory:';
process.env['NODE_ENV'] = 'test';
process.env['AUTH_SECRET'] = 'legacy-test-auth-secret-for-migration-only';
const KEY1 = randomBytes(32).toString('base64');
const KEY2 = randomBytes(32).toString('base64');
process.env['WORA_SECRET_KEYS'] = JSON.stringify({ active: 'v1', keys: { v1: KEY1, v2: KEY2 } });

const store = await import('../extensions/secrets.js');
const { getOsDb, resetOsDbForTests } = await import('../os/db.js');
const { resetExtensionSchemaForTests } = await import('../extensions/schema.js');
const { resetKeyringForTests, loadKeyring, keyringStatus } = await import('./keyring.js');
const { openField, sealField, sealJson, openJson, isSealedField } = await import('./field-crypto.js');

const WS = 'workspace-a';
after(() => { resetOsDbForTests(); resetExtensionSchemaForTests(); resetKeyringForTests(); });

function legacyCipher(value: string): { ciphertext: string; iv: string; tag: string } {
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(process.env['AUTH_SECRET']!, 'utf8'), Buffer.from('wora-extensions', 'utf8'), Buffer.from('package-secrets-v1', 'utf8'), 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

test('new secrets are encrypted with a key id and never expose plaintext in metadata or ciphertext', () => {
  const secret = 'sk-live-this-value-must-never-appear';
  const metadata = store.putSecret({ workspaceId: WS, name: 'DEPLOY_TOKEN', value: secret, purpose: 'test', actor: 'tester' });
  assert.equal(metadata.keyId, 'v1');
  assert.equal(metadata.format, 'aes-256-gcm-v2');
  const row = getOsDb().prepare('SELECT ciphertext, iv, tag, key_id, format FROM ext_secrets WHERE workspace_id = ? AND name = ?').get(WS, 'DEPLOY_TOKEN') as Record<string, string>;
  assert.ok(!JSON.stringify(row).includes(secret));
  assert.equal(row['key_id'], 'v1');
  assert.equal(store.revealSecret(WS, 'DEPLOY_TOKEN'), secret);
  assert.ok(!JSON.stringify(store.listSecrets(WS)).includes(secret));
});

test('workspace isolation, tampering and AAD renaming fail closed', () => {
  store.putSecret({ workspaceId: WS, name: 'BOUND_SECRET', value: 'bound-value', actor: 'tester' });
  assert.equal(store.revealSecret('workspace-b', 'BOUND_SECRET'), null);
  getOsDb().prepare('UPDATE ext_secrets SET ciphertext = ? WHERE workspace_id = ? AND name = ?')
    .run(Buffer.from('tampered').toString('base64'), WS, 'BOUND_SECRET');
  assert.equal(store.revealSecret(WS, 'BOUND_SECRET'), null);
  assert.throws(() => store.revealSecretOrThrow(WS, 'BOUND_SECRET'), /authentication|decrypt|invalid/i);

  store.putSecret({ workspaceId: WS, name: 'RENAMED_SECRET', value: 'rename-value', actor: 'tester' });
  getOsDb().prepare('UPDATE ext_secrets SET name = ? WHERE workspace_id = ? AND name = ?').run('RENAMED_OTHER', WS, 'RENAMED_SECRET');
  assert.equal(store.revealSecret(WS, 'RENAMED_OTHER'), null, 'AAD binds the secret name');
  getOsDb().prepare('DELETE FROM ext_secrets WHERE workspace_id = ? AND name IN (?, ?)').run(WS, 'BOUND_SECRET', 'RENAMED_OTHER');
});

test('legacy rows are readable, dry-run leaves them unchanged, and explicit migration upgrades them', () => {
  const legacy = legacyCipher('legacy-value');
  getOsDb().prepare(`INSERT INTO ext_secrets (id, workspace_id, name, purpose, ciphertext, iv, tag, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('sec_legacy', WS, 'LEGACY_TOKEN', 'plugin', legacy.ciphertext, legacy.iv, legacy.tag, 'legacy', new Date().toISOString(), new Date().toISOString());
  assert.equal(store.revealSecret(WS, 'LEGACY_TOKEN'), 'legacy-value');
  const before = getOsDb().prepare('SELECT ciphertext, format FROM ext_secrets WHERE id = ?').get('sec_legacy') as { ciphertext: string; format: string };
  const dry = store.migrateLegacySecrets({ workspaceId: WS, actor: 'migration-test', dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.rotated >= 1);
  assert.deepEqual(getOsDb().prepare('SELECT ciphertext, format FROM ext_secrets WHERE id = ?').get('sec_legacy'), before);
  const migrated = store.migrateLegacySecrets({ workspaceId: WS, actor: 'migration-test' });
  assert.ok(migrated.rotated >= 1);
  const afterRow = getOsDb().prepare('SELECT ciphertext, format, key_id FROM ext_secrets WHERE id = ?').get('sec_legacy') as { ciphertext: string; format: string; key_id: string };
  assert.notEqual(afterRow.ciphertext, before.ciphertext);
  assert.equal(afterRow.format, 'aes-256-gcm-v2');
  assert.equal(afterRow.key_id, 'v1');
  assert.equal(store.revealSecret(WS, 'LEGACY_TOKEN'), 'legacy-value');
});

test('rotation re-encrypts under a configured key and supports dry-run', () => {
  store.putSecret({ workspaceId: WS, name: 'ROTATE_ME', value: 'rotation-value', actor: 'tester' });
  resetKeyringForTests();
  process.env['WORA_SECRET_KEYS'] = JSON.stringify({ active: 'v2', keys: { v1: KEY1, v2: KEY2 } });
  const dry = store.rotateSecrets({ workspaceId: WS, toKeyId: 'v2', actor: 'rotator', dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.rotated >= 1);
  const stillV1 = getOsDb().prepare('SELECT key_id FROM ext_secrets WHERE workspace_id = ? AND name = ?').get(WS, 'ROTATE_ME') as { key_id: string };
  assert.equal(stillV1.key_id, 'v1');
  const rotated = store.rotateSecrets({ workspaceId: WS, toKeyId: 'v2', actor: 'rotator' });
  assert.ok(rotated.rotated >= 1);
  assert.equal(store.revealSecret(WS, 'ROTATE_ME'), 'rotation-value');
  const nowV2 = getOsDb().prepare('SELECT key_id FROM ext_secrets WHERE workspace_id = ? AND name = ?').get(WS, 'ROTATE_ME') as { key_id: string };
  assert.equal(nowV2.key_id, 'v2');
});

test('rotation encrypts under the requested key even when it is not active', () => {
  resetKeyringForTests();
  process.env['WORA_SECRET_KEYS'] = JSON.stringify({ active: 'v1', keys: { v1: KEY1, v2: KEY2 } });
  store.putSecret({ workspaceId: WS, name: 'TARGET_ROTATION', value: 'target-value', actor: 'tester' });
  const rotated = store.rotateSecrets({ workspaceId: WS, toKeyId: 'v2', actor: 'rotator' });
  assert.ok(rotated.rotated >= 1);
  const row = getOsDb().prepare('SELECT key_id FROM ext_secrets WHERE workspace_id = ? AND name = ?').get(WS, 'TARGET_ROTATION') as { key_id: string };
  assert.equal(row.key_id, 'v2');
  assert.equal(store.revealSecret(WS, 'TARGET_ROTATION'), 'target-value');
});

test('a missing key fails closed instead of returning ciphertext as plaintext', () => {
  resetKeyringForTests();
  process.env['WORA_SECRET_KEYS'] = JSON.stringify({ active: 'v1', keys: { v1: KEY1 } });
  const row = getOsDb().prepare('SELECT key_id FROM ext_secrets WHERE workspace_id = ? AND name = ?').get(WS, 'ROTATE_ME') as { key_id: string };
  assert.equal(row.key_id, 'v2');
  assert.equal(store.revealSecret(WS, 'ROTATE_ME'), null);
  assert.throws(() => store.revealSecretOrThrow(WS, 'ROTATE_ME'), /not configured/);
});

test('keyring rejects malformed keys and status never returns key material', () => {
  resetKeyringForTests();
  assert.throws(() => loadKeyring({ WORA_SECRET_KEY: Buffer.from('short').toString('base64') }), /32 bytes/);
  const status = keyringStatus();
  assert.ok(!JSON.stringify(status).includes(KEY1));
  assert.ok(!JSON.stringify(status).includes(KEY2));
});

test('sealed operational fields authenticate their context and remain legacy-readable', () => {
  const sealed = sealField('{"amount":42}', 'approval:workspace-a:apr_1');
  assert.equal(isSealedField(sealed), true);
  assert.ok(!sealed.includes('{"amount":42}'));
  assert.equal(openField(sealed, 'approval:workspace-a:apr_1'), '{"amount":42}');
  assert.throws(() => openField(sealed, 'approval:workspace-a:apr_2'), /authentication/);
  assert.equal(openField('{"legacy":true}', 'any-context'), '{"legacy":true}');
  const json = sealJson({ target: 'test' }, 'task:workspace-a:tsk_1');
  assert.deepEqual(openJson(json, 'task:workspace-a:tsk_1', {}), { target: 'test' });
});
