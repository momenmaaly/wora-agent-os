/**
 * WORA OS — secret redaction.
 *
 * High-confidence credential signatures and secret-named environment values are
 * removed before evidence, verification records, artifacts, approvals or audit
 * details are persisted or returned. Redaction is deliberately conservative:
 * it only targets signatures and values that are very unlikely to be ordinary
 * prose, and it never mutates the caller's object.
 */
export interface SecretPattern {
  id: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { id: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/ },
  { id: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: 'github-pat', pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { id: 'openai-key', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { id: 'private-key', pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { id: 'slack-token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { id: 'stripe-secret', pattern: /sk_(?:live|test)_[0-9A-Za-z]{16,}/ },
];

const SECRET_ENV_NAME = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY|APIKEY|CREDENTIAL|ACCESS_KEY|AUTH_KEY)(?:_|$)/i;
const PLACEHOLDER = /^(?:changeme|change-me|example|placeholder|test|dummy|none|null|undefined|your[-_ ].*)$/i;

function envSecrets(env: NodeJS.ProcessEnv | undefined): Array<{ name: string; value: string }> {
  if (!env) return [];
  return Object.entries(env)
    .filter(([name, value]) => Boolean(value) && SECRET_ENV_NAME.test(name) && value!.length >= 8 && !PLACEHOLDER.test(value!))
    .map(([name, value]) => ({ name, value: value! }))
    .sort((a, b) => b.value.length - a.value.length);
}

function redactString(text: string, env: Array<{ name: string; value: string }>, redactions: Set<string>): string {
  let result = text;
  for (const signature of SECRET_PATTERNS) {
    const flags = signature.pattern.flags.includes('g') ? signature.pattern.flags : `${signature.pattern.flags}g`;
    const pattern = new RegExp(signature.pattern.source, flags);
    if (pattern.test(result)) {
      result = result.replace(pattern, `[REDACTED:${signature.id}]`);
      redactions.add(signature.id);
    }
  }
  for (const entry of env) {
    if (result.includes(entry.value)) {
      result = result.split(entry.value).join(`[REDACTED:env:${entry.name}]`);
      redactions.add(`env:${entry.name}`);
    }
  }
  return result;
}

export function redactSecrets<T>(value: T, options: { env?: NodeJS.ProcessEnv } = {}): { value: T; redactions: string[] } {
  const redactions = new Set<string>();
  const env = envSecrets(options.env ?? process.env);
  const walk = (input: unknown, depth = 0): unknown => {
    if (depth > 30) return input;
    if (typeof input === 'string') return redactString(input, env, redactions);
    if (Array.isArray(input)) return input.map((entry) => walk(entry, depth + 1));
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, entry]) => [key, walk(entry, depth + 1)]));
    }
    return input;
  };
  return { value: walk(value) as T, redactions: [...redactions] };
}

export function redactText(text: string): string {
  return redactSecrets(text).value;
}
