/** Public PlugShare station permalinks (official, no API key). */
export const PLUGSHARE_LOCATION_URL = "https://www.plugshare.com/location";
export const PLUGSHARE_ACCESS_URL = "https://developer.plugshare.com/access";

/**
 * No NEXT_PUBLIC_ token here on purpose: an operator-wide PlugShare key is
 * server-only (PLUGSHARE_TOKEN, see src/infrastructure/config/env.ts) and
 * getPlugshareStatusFn (src/server/actions/chargers.ts) only reports whether
 * it's configured. A client-side default would ship that key to every
 * visitor's browser bundle.
 */

/** Accept Bearer/Basic/raw API keys. Never invent credentials. */
export function normalizePlugshareToken(value: string): string {
  return value.trim();
}

export function isPlugshareToken(value: string): boolean {
  return normalizePlugshareToken(value).length >= 8;
}

export function plugshareAuthHeader(token: string): string {
  const t = normalizePlugshareToken(token);
  if (/^(Bearer|Basic|Token)\s+/i.test(t)) return t;
  return `Bearer ${t}`;
}

export function plugshareLocationUrl(id: string | number): string {
  const n = String(id).replace(/^ps-/, "");
  return `${PLUGSHARE_LOCATION_URL}/${encodeURIComponent(n)}`;
}
