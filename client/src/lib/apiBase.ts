/**
 * One API-origin contract for the browser.
 *
 * `VITE_API_URL` is the canonical shared API origin. `VITE_OS_API` is an
 * optional override for OS/extensions only, kept for deployments that split
 * those routes onto a separate origin. Empty means same-origin, which is the
 * default behind the Vite dev proxy and the production reverse proxy.
 */
export function resolveApiBase(override?: string, shared?: string): string {
  const configured = (override ?? '').trim() || (shared ?? '').trim();
  if (!configured) return '';
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('API base URL must be an absolute http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API base URL must use http or https');
  }
  if (url.username || url.password) {
    throw new Error('API base URL must not contain credentials');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API base URL must be an origin without a path, query or fragment');
  }
  return url.origin;
}
