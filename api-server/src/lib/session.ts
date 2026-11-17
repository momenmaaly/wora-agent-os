import { createHmac, timingSafeEqual } from 'node:crypto';

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Verify the workspace's two-part HMAC tokens or HS256 JWTs. */
export function verifySessionToken(token: string, secret: string, requireExpiry = false): { userId: string; displayName?: string } | null {
  if (!secret || token.length > 4_096) return null;
  const parts = token.split('.');
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !/^[\w-]+$/.test(part))) return null;
  const signature = parts.pop()!;
  const expected = createHmac('sha256', secret).update(parts.join('.')).digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const decode = (encoded: string) => JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (parts.length === 2 && decode(parts[0]!)?.alg !== 'HS256') return null;
    const payload = decode(parts[parts.length - 1]!) as { sub?: unknown; userId?: unknown; name?: unknown; exp?: unknown; nbf?: unknown } | null;
    if (!payload || typeof payload !== 'object') return null;
    const now = Date.now() / 1_000;
    if (requireExpiry || payload.exp !== undefined) {
      if (typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= now) return null;
    }
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isSafeInteger(payload.nbf) || payload.nbf > now)) return null;
    const userId = payload.sub ?? payload.userId;
    if (typeof userId !== 'string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(userId)) return null;
    return { userId, displayName: typeof payload.name === 'string' ? payload.name : undefined };
  } catch {
    return null;
  }
}
