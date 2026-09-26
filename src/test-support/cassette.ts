/**
 * Grabación de respuestas HTTP de los proveedores (Mapbox, Open-Meteo…) para
 * reproducir un plan sin red y de forma determinista. El grabador envuelve
 * `fetch` mientras corre el pipeline real; la reproducción devuelve las
 * mismas respuestas y falla ante cualquier petición que no esté grabada.
 *
 * Los tokens nunca se guardan: las URL se guardan con los parámetros
 * secretos reemplazados por "***" y la reproducción compara igual.
 */
import type { ConsolidatedStation } from "@/domain/stations/model";

export const CASSETTE_SCHEMA_VERSION = 1;

export interface CassetteInteraction {
  method: string;
  /** URL con los parámetros secretos redactados. */
  url: string;
  status: number;
  contentType: string | null;
  body: string;
}

export interface Cassette {
  schemaVersion: typeof CASSETTE_SCHEMA_VERSION;
  scenario: string;
  recordedAt: string;
  interactions: CassetteInteraction[];
  /** Versión del dataset consolidado de electrolineras usado al grabar. */
  stationsVersion: string;
  /** Solo las estaciones del corredor de alguna de las rutas grabadas. */
  stations: ConsolidatedStation[];
}

const SECRET_PARAMS = ["access_token", "api_key", "apikey", "key", "token"];

/** La URL con los parámetros secretos como "***". */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of SECRET_PARAMS) if (u.searchParams.has(k)) u.searchParams.set(k, "***");
    return u.toString();
  } catch {
    return url;
  }
}

type FetchInput = Parameters<typeof fetch>[0];

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function methodOf(input: FetchInput, init?: RequestInit): string {
  const fromRequest = typeof input === "object" && "method" in input ? input.method : undefined;
  return (init?.method ?? fromRequest ?? "GET").toUpperCase();
}

function keyOf(method: string, url: string): string {
  return `${method} ${redactUrl(url)}`;
}

/** Envuelve `realFetch` y agrega cada respuesta a `sink`. La respuesta sigue llegando al que llamó. */
export function recordingFetch(
  realFetch: typeof fetch,
  sink: CassetteInteraction[],
): typeof fetch {
  return async (input, init) => {
    const res = await realFetch(input, init);
    const body = await res.clone().text();
    sink.push({
      method: methodOf(input, init),
      url: redactUrl(urlOf(input)),
      status: res.status,
      contentType: res.headers.get("content-type"),
      body,
    });
    return res;
  };
}

export class UnrecordedRequestError extends Error {
  constructor(key: string) {
    super(`Petición fuera de la grabación (los tests no usan red): ${key}`);
    this.name = "UnrecordedRequestError";
  }
}

/**
 * `fetch` que responde con lo grabado. La misma petición puede repetirse; una
 * petición que no está grabada lanza UnrecordedRequestError.
 */
export function replayFetch(interactions: CassetteInteraction[]): typeof fetch {
  const byKey = new Map<string, CassetteInteraction>();
  for (const it of interactions) {
    const key = keyOf(it.method, it.url);
    if (!byKey.has(key)) byKey.set(key, it);
  }
  return async (input, init) => {
    const key = keyOf(methodOf(input, init), urlOf(input));
    const hit = byKey.get(key);
    if (!hit) throw new UnrecordedRequestError(key);
    const headers = hit.contentType ? { "content-type": hit.contentType } : undefined;
    return new Response(hit.body, { status: hit.status, headers });
  };
}

/**
 * Falla si el JSON serializado contiene alguno de los secretos dados, o un
 * `access_token` sin redactar. Se usa antes de escribir una grabación a disco.
 */
export function assertNoSecrets(serialized: string, secrets: (string | undefined)[]): void {
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value && value.length >= 8 && serialized.includes(value)) {
      throw new Error("La grabación contiene un secreto del entorno; no se escribe.");
    }
  }
  if (/access_token=(?!\*\*\*)/.test(serialized)) {
    throw new Error("La grabación contiene un access_token sin redactar; no se escribe.");
  }
}
