import { unstable_cache } from "next/cache";

/**
 * Contacto del operador en la cabecera User-Agent de las llamadas a APIs
 * públicas (Overpass, Photon) — lo piden sus políticas de uso, para poder
 * avisar al operador de una app en vez de bloquearla sin aviso. Configurable
 * por entorno (PROVIDER_CONTACT en .env.example); si no se define, se manda
 * un valor por defecto que igual identifica la app, aunque sin forma de
 * contactar al operador — hay que rellenarlo antes de producción real.
 */
const CONTACT = process.env.PROVIDER_CONTACT?.trim() || "sin contacto configurado — ver PROVIDER_CONTACT";
const USER_AGENT = `Voltia/1.0 (EV trip planner; ${CONTACT})`;

/**
 * Caché de proveedores externos, en dos capas:
 *  1. Un Map en memoria del proceso — instantáneo, pero se pierde en cada
 *     invocación serverless fría (Vercel no garantiza reusar el proceso).
 *  2. `unstable_cache` de Next, que persiste entre invocaciones (Data Cache
 *     de Next.js) — así una ruta repetida no vuelve a llamar a OSRM/Overpass
 *     dentro de la ventana de `cacheTtlMs`, incluso en una función nueva.
 */
const memoryCache = new Map<string, { at: number; value: unknown }>();

function memoryHit<T>(key: string, ttlMs: number): T | undefined {
  const hit = memoryCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  return undefined;
}

/** Espera indicada por `Retry-After` (segundos o fecha HTTP), acotada a 10s. */
function retryAfterMs(res: Response, fallbackMs: number): number {
  const header = res.headers.get("retry-after");
  if (!header) return fallbackMs;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds)) return Math.min(10_000, Math.max(0, asSeconds * 1000));
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.min(10_000, Math.max(0, asDate - Date.now()));
  return fallbackMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch con 1 reintento en 429/5xx (respetando `Retry-After` si viene), y
 * el User-Agent del operador salvo que el caller ya haya puesto uno.
 */
async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const headers = { accept: "application/json", "user-agent": USER_AGENT, ...(init.headers ?? {}) };
  const attempt = () => fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });

  const res = await attempt();
  if (res.status !== 429 && res.status < 500) return res;

  await sleep(retryAfterMs(res, 500));
  return attempt();
}

async function rawJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const res = await fetchWithRetry(url, init, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; cacheTtlMs?: number; cacheKey?: string } = {},
): Promise<T> {
  const { timeoutMs = 15000, cacheTtlMs, cacheKey, ...rest } = init;
  if (!cacheTtlMs) return rawJson<T>(url, rest, timeoutMs);

  const key = cacheKey ?? url;
  const fromMemory = memoryHit<T>(key, cacheTtlMs);
  if (fromMemory !== undefined) return fromMemory;

  const revalidate = Math.max(1, Math.round(cacheTtlMs / 1000));
  const cached = unstable_cache(() => rawJson<T>(url, rest, timeoutMs), [key], { revalidate });
  const value = await cached();
  memoryCache.set(key, { at: Date.now(), value });
  return value;
}

export async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<string> {
  const { timeoutMs = 20000, ...rest } = init;
  const res = await fetchWithRetry(url, rest, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}
