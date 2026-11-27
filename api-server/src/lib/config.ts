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

/** Production runtime settings that must be explicit and isolated. */
export function productionRuntimeConfigProblems(env: NodeJS.ProcessEnv): string[] {
  if (!isProductionEnv(env)) return [];
  const problems: string[] = [];
  const cloud = sanitizeEnv(env['WORA_CLOUD_PROVIDER'])?.toLowerCase();
  if (cloud !== 'docker') problems.push('WORA_CLOUD_PROVIDER=docker');
  if (sanitizeEnv(env['WORA_CLOUD_ALLOW_PROCESS_PROVIDER']) === '1') problems.push('WORA_CLOUD_ALLOW_PROCESS_PROVIDER');
  const browser = sanitizeEnv(env['WORA_BROWSER_PROVIDER'])?.toLowerCase();
  if (browser !== 'docker') problems.push('WORA_BROWSER_PROVIDER=docker');
  const dockerHost = sanitizeEnv(env['DOCKER_HOST']) ?? '';
  if (!dockerHost) problems.push('DOCKER_HOST');
  else if (/^unix:\/\/\/var\/run\/docker\.sock$/u.test(dockerHost) && sanitizeEnv(env['WORA_ALLOW_HOST_DOCKER_SOCKET']) !== '1') {
    problems.push('DOCKER_HOST must point at the dedicated runtime host (set WORA_ALLOW_HOST_DOCKER_SOCKET=1 only for a controlled host install)');
  } else if (dockerHost.startsWith('tcp://')) {
    if (sanitizeEnv(env['DOCKER_TLS_VERIFY']) !== '1') problems.push('DOCKER_TLS_VERIFY=1');
    if (!sanitizeEnv(env['DOCKER_CERT_PATH'])) problems.push('DOCKER_CERT_PATH');
  }
  const runtimeRoot = sanitizeEnv(env['WORA_RUNTIME_ROOT']);
  if (!runtimeRoot || !runtimeRoot.startsWith('/')) problems.push('WORA_RUNTIME_ROOT (absolute path required)');
  if (sanitizeEnv(env['WORA_OS_DB']) === ':memory:') problems.push('WORA_OS_DB (file-backed database required)');
  if (!sanitizeEnv(env['WORA_SECRET_KEYS']) && !sanitizeEnv(env['WORA_SECRET_KEY']) && !sanitizeEnv(env['WORA_SECRET_KEY_FILE'])) {
    problems.push('WORA_SECRET_KEYS, WORA_SECRET_KEY or WORA_SECRET_KEY_FILE');
  }
  return problems;
}
