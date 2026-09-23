const cache = new Map<string, { at: number; value: unknown }>();

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; cacheTtlMs?: number; cacheKey?: string } = {},
): Promise<T> {
  const { timeoutMs = 15000, cacheTtlMs, cacheKey, ...rest } = init;
  const key = cacheKey ?? url;
  if (cacheTtlMs) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheTtlMs) return hit.value as T;
  }
  const res = await fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  const value = (await res.json()) as T;
  if (cacheTtlMs) cache.set(key, { at: Date.now(), value });
  return value;
}

export async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<string> {
  const { timeoutMs = 20000, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}
