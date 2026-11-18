const SESSION_KEY = 'wora:authToken';

/** A short-lived application session supplied by the deployment's identity layer. */
export function readSessionToken(): string | undefined {
  for (const storage of ['sessionStorage', 'localStorage'] as const) {
    try {
      const token = window[storage].getItem(SESSION_KEY)?.trim();
      if (token && token.length <= 4_096 && /^[\w-]+(?:\.[\w-]+){1,2}$/.test(token)) return token;
    } catch { /* Storage can be disabled without preventing use of the demo. */ }
  }
  return undefined;
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
