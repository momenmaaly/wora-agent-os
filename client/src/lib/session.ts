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
