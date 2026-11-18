import { isStrongSecret, sanitizeEnv } from '../lib/config.js';
import { issueSessionToken } from '../lib/session.js';

const [userId, minutes = '120', ...extra] = process.argv.slice(2);
const secret = sanitizeEnv(process.env['AUTH_SECRET']);
if (!isStrongSecret(secret)) {
  console.error('Set the same strong AUTH_SECRET as the production API in this terminal/environment.');
  process.exit(1);
}
try {
  if (!userId || !/^\d{1,3}$/u.test(minutes) || extra.length) throw new Error('Invalid arguments');
  process.stdout.write(`${issueSessionToken(userId, secret, Number(minutes))}\n`);
} catch {
  console.error('Usage: node dist/issue-session.mjs <stable-workspace-id> [minutes: 1–480]. IDs: 3–64 letters, digits, underscores or dashes.');
  process.exit(1);
}
