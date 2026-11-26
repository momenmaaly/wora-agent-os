/**
 * Generate a production secret keyring exactly once. The key is written with
 * mode 0600 and is never printed. Refuses to overwrite an existing keyring.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const file = process.env['WORA_SECRET_KEY_FILE']?.trim() || '/app/data/.wora-secret-key';
if (existsSync(file)) {
  console.log(JSON.stringify({ event: 'keyring.exists', file }));
  process.exit(0);
}
mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
const key = randomBytes(32).toString('base64');
writeFileSync(file, JSON.stringify({ active: 'v1', keys: { v1: key } }), { mode: 0o600 });
chmodSync(file, 0o600);
console.log(JSON.stringify({ event: 'keyring.created', file, active: 'v1' }));
