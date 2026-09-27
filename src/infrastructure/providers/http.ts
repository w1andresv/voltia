import { unstable_cache } from "next/cache";

/**
 * Contacto del operador en la cabecera User-Agent de las llamadas a APIs
 * públicas (Overpass, Photon) — lo piden sus políticas de uso, para poder
 * avisar al operador de una app en vez de bloquearla sin aviso. Configurable
 * por entorno (PROVIDER_CONTACT en .env.example); si no se define, se manda
 * un valor por defecto que igual identifica la app, aunque sin forma de
 * contactar al operador — hay que rellenarlo antes de producción real.
 */
/**
 * Las cabeceras HTTP solo admiten caracteres de 1 byte (ByteString): una raya
 * "—" o una tilde hacen que fetch lance "Cannot convert argument to a ByteString"
 * ANTES de salir la petición. Se quitan acentos y se reemplaza lo demás.
 */
export function asciiHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2012-\u2015]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?");
}

const CONTACT =
  process.env.PROVIDER_CONTACT?.trim() || "sin contacto configurado - ver PROVIDER_CONTACT";
export const USER_AGENT = asciiHeader(`Voltia/1.0 (EV trip planner; ${CONTACT})`);

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
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const headers = { accept: "application/json", "user-agent": USER_AGENT, ...(init.headers ?? {}) };
  const attempt = () => fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });

  const res = await attempt();
  if (res.status !== 429 && res.status < 500) return res;

  await sleep(retryAfterMs(res, 500));
  return attempt();
}

const SECRET_PARAMS = ["access_token", "api_key", "apikey", "key", "token"];

/** La URL sin llaves/tokens en la query, para mensajes de error y logs. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of SECRET_PARAMS) if (u.searchParams.has(k)) u.searchParams.set(k, "***");
    return u.toString();
  } catch {
    return url.split("?")[0] ?? "";
  }
}

/** Máximo de caracteres de URL en un error: las de lotes llevan cientos de coordenadas. */
const MAX_URL_IN_ERROR = 140;

function shortUrl(url: string): string {
  return url.length > MAX_URL_IN_ERROR ? `${url.slice(0, MAX_URL_IN_ERROR)}…` : url;
}

async function httpError(res: Response, url: string): Promise<Error> {
  let body = "";
  try {
    body = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
  } catch {
    /* sin cuerpo */
  }
  return new Error(`HTTP ${res.status} ${shortUrl(safeUrl(url))}${body ? ` — ${body}` : ""}`);
}

async function rawJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const res = await fetchWithRetry(url, init, timeoutMs);
  if (!res.ok) throw await httpError(res, url);
  return (await res.json()) as T;
}

/**
 * Sin vencimiento para datos que no cambian (elevación del terreno): la Data
 * Cache de Next los conserva entre peticiones y despliegues, compartidos por
 * todos los usuarios (docs de Next: `revalidate: false`).
 */
export const CACHE_FOREVER = Number.POSITIVE_INFINITY;

function revalidateOf(ttlMs: number): number | false {
  return Number.isFinite(ttlMs) ? Math.max(1, Math.round(ttlMs / 1000)) : false;
}

/**
 * Etiqueta de la Data Cache para las respuestas con vencimiento (rutas, clima,
 * geocodificación, Blaze, matriz): el botón "Limpiar caché" las invalida. Las
 * que no vencen (elevación) no la llevan: no cambian y volver a pedirlas cuesta.
 */
export const PROVIDER_CACHE_TAG = "provider-data";

function cacheOptions(ttlMs: number): { revalidate: number | false; tags?: string[] } {
  const revalidate = revalidateOf(ttlMs);
  return revalidate === false ? { revalidate } : { revalidate, tags: [PROVIDER_CACHE_TAG] };
}

/** Vacía la caché en memoria de este proceso (la Data Cache se invalida con PROVIDER_CACHE_TAG). */
export function clearProviderMemory(): number {
  const n = memoryCache.size;
  memoryCache.clear();
  return n;
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

  const cached = unstable_cache(
    () => rawJson<T>(url, rest, timeoutMs),
    [key],
    cacheOptions(cacheTtlMs),
  );
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
  if (!res.ok) throw await httpError(res, url);
  return res.text();
}

/**
 * Bytes de una respuesta binaria (p. ej. una tesela PNG). Con `cacheTtlMs` se
 * guarda en la Data Cache de Next como base64, con la clave `cacheKey` (que no
 * debe llevar el token). Sin caché en memoria: quien llama decide qué retener.
 */
export async function fetchBytes(
  url: string,
  init: RequestInit & { timeoutMs?: number; cacheTtlMs?: number; cacheKey?: string } = {},
): Promise<Uint8Array> {
  const { timeoutMs = 15000, cacheTtlMs, cacheKey, ...rest } = init;
  const raw = async () => {
    const res = await fetchWithRetry(
      url,
      { ...rest, headers: { accept: "*/*", ...(rest.headers ?? {}) } },
      timeoutMs,
    );
    if (!res.ok) throw await httpError(res, url);
    return new Uint8Array(await res.arrayBuffer());
  };
  if (!cacheTtlMs) return raw();
  const cached = unstable_cache(
    async () => Buffer.from(await raw()).toString("base64"),
    [cacheKey ?? safeUrl(url)],
    cacheOptions(cacheTtlMs),
  );
  return new Uint8Array(Buffer.from(await cached(), "base64"));
}
