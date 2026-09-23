/** Public PlugShare station permalinks (official, no API key). */
export const PLUGSHARE_LOCATION_URL = "https://www.plugshare.com/location";
export const PLUGSHARE_ACCESS_URL = "https://developer.plugshare.com/access";

const ENV_TOKEN = String(process.env.NEXT_PUBLIC_PLUGSHARE_TOKEN ?? "").trim();

/** Accept Bearer/Basic/raw API keys. Never invent credentials. */
export function normalizePlugshareToken(value: string): string {
  return value.trim();
}

export function isPlugshareToken(value: string): boolean {
  return normalizePlugshareToken(value).length >= 8;
}

export function envPlugshareToken(): string {
  return isPlugshareToken(ENV_TOKEN) ? ENV_TOKEN : "";
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
