/** Pure HTTP security predicates shared by the server and its tests. */
export function isStateChangingMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export function isCrossSiteBrowserMutation(method: string, secFetchSite?: string | null): boolean {
  return isStateChangingMethod(method) && secFetchSite?.toLowerCase() === 'cross-site';
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: ReadonlySet<string>, options: { production: boolean; allowLocalhost: boolean }): boolean {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return !options.production && options.allowLocalhost && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
