/** Accept a pasted KEY=value or wrapped value without truncating URI query parameters. */
export function sanitizeEnv(raw?: string): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim();
  const assignment = value.match(/^[A-Z][A-Z0-9_]{1,39}=(.*)$/s);
  if (assignment?.[1] !== undefined) value = assignment[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value || undefined;
}

export function isStrongSecret(value: string | undefined): value is string {
  return Boolean(value && Buffer.byteLength(value, 'utf8') >= 32 && !/^(?:change[-_ ]?me|your[-_ ]|replace[-_ ])/i.test(value));
}

export function configuredOrigins(value: string | undefined): string[] {
  return sanitizeEnv(value)?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
}

function isBrowserOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.origin === value && !url.hostname.includes('*') && (url.protocol === 'https:' || (local && url.protocol === 'http:'));
  } catch { return false; }
}

export function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return sanitizeEnv(env['NODE_ENV']) !== 'development';
}

/** Fail before opening sockets. Report keys only, never the configuration values. */
export function productionConfigProblems(env: NodeJS.ProcessEnv): string[] {
  if (!isProductionEnv(env)) return [];
  const problems: string[] = [];
  const auth = sanitizeEnv(env['AUTH_SECRET']);
  if (!isStrongSecret(auth)) problems.push('AUTH_SECRET');
  const admin = sanitizeEnv(env['ADMIN_API_KEY']);
  if (admin && (!isStrongSecret(admin) || admin === auth)) problems.push('ADMIN_API_KEY');
  const mongo = sanitizeEnv(env['MONGO_URI']);
  // Mongo connection strings can contain a list of replica set hosts, which URL cannot parse.
  if (!mongo || !/^mongodb(?:\+srv)?:\/\/[^\s]+$/u.test(mongo)) problems.push('MONGO_URI');
  const redis = sanitizeEnv(env['REDIS_URL']);
  try {
    const url = new URL(redis ?? '');
    if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname) problems.push('REDIS_URL');
  } catch { problems.push('REDIS_URL'); }
  const origins = configuredOrigins(env['ALLOWED_ORIGINS']);
  if (!origins.length || !origins.every(isBrowserOrigin)) problems.push('ALLOWED_ORIGINS');
  return problems;
}
