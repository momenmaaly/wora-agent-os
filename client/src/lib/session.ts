const SESSION_KEY = 'wora:authToken';

function isSessionToken(value?: string): value is string {
  return Boolean(value && value.length <= 4_096 && /^[\w-]+(?:\.[\w-]+){1,2}$/u.test(value));
}

export function isSessionError(code: string | null) {
  return code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID' || code === 'SESSION_EXPIRED' || code === 'SESSION_REVOKED';
}

/** A short-lived application session supplied by the deployment's identity layer. */
export function readSessionToken(): string | undefined {
  for (const storage of ['sessionStorage', 'localStorage'] as const) {
    try {
      const token = window[storage].getItem(SESSION_KEY)?.trim();
      if (isSessionToken(token)) return token;
    } catch { /* Storage can be disabled without preventing use of the demo. */ }
  }
  return undefined;
}

/** Accept only a session already verified by the API. Never persist new tokens to localStorage. */
export async function connectWorkspace(raw: string, signal: AbortSignal): Promise<void> {
  const token = raw.trim();
  if (!isSessionToken(token)) throw new Error('AUTH_INVALID');
  const url = new URL('/api/session', import.meta.env?.VITE_API_URL?.trim() || window.location.origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('API_UNAVAILABLE');
  }
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(7_000)]),
    cache: 'no-store', redirect: 'error', credentials: 'omit',
  });
  if (response.status === 401) throw new Error('AUTH_INVALID');
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('API_UNAVAILABLE');
  const session: unknown = await response.json();
  if (!session || typeof session !== 'object' || !('userId' in session) || typeof session.userId !== 'string'
    || !('expiresAt' in session) || typeof session.expiresAt !== 'number' || !Number.isSafeInteger(session.expiresAt)
    || session.expiresAt <= Date.now()) throw new Error('API_UNAVAILABLE');
  signal.throwIfAborted();
  try { window.sessionStorage.setItem(SESSION_KEY, token); }
  catch { throw new Error('STORAGE_UNAVAILABLE'); }
}

export async function revokeWorkspaceSession(): Promise<boolean> {
  const token = readSessionToken();
  if (!token) return false;
  try {
    const url = new URL('/api/session/revoke', import.meta.env?.VITE_API_URL?.trim() || window.location.origin);
    const response = await fetch(url, {
      method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000), cache: 'no-store', redirect: 'error', credentials: 'omit',
    });
    return response.ok || response.status === 400;
  } catch { return false; }
}

export function clearWorkspaceSession() {
  for (const storage of ['sessionStorage', 'localStorage'] as const) {
    try { window[storage].removeItem(SESSION_KEY); }
    catch { /* Storage may be disabled. */ }
  }
}

const PREVIEW_SESSION_KEY = 'wora:previewSession';
let previewSession: string | undefined;

function isPreviewSession(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 && /^[\w-]+\.[\w-]+$/u.test(value);
}

export function readPreviewSession(): string | undefined {
  if (previewSession) return previewSession;
  try {
    const saved = window.localStorage.getItem(PREVIEW_SESSION_KEY);
    if (isPreviewSession(saved)) return saved;
  } catch { /* The tab can keep its preview token without storage. */ }
  return previewSession;
}

export function rememberPreviewSession(value: unknown) {
  if (!isPreviewSession(value)) return;
  previewSession = value;
  try { window.localStorage.setItem(PREVIEW_SESSION_KEY, value); }
  catch { /* Ephemeral browser-only fallback. */ }
}
