import type { LatLon } from "@/domain/types";
import { fetchJson } from "./http";
import { OsrmResponseSchema, type OsrmRoute } from "./routing.osrm";

/**
 * Mapbox Directions, perfil `driving` (velocidades típicas, sin tráfico en vivo).
 * Se usa `driving` y no `driving-traffic` porque, con datos reales (Piedecuesta →
 * Vélez), `driving-traffic` elegía un atajo de 199 km con ~16 km por vía terciaria,
 * mientras `driving` da la ruta de 212 km casi toda por vías principales, que es
 * la que muestra Mapbox en su web. Para un viaje de horas planeado con antelación,
 * el tráfico de este momento no es un buen criterio de ruta.
 * Responde en el mismo formato que OSRM. Hasta 25 puntos; alternativas solo con 2.
 */
export class MapboxRoutingError extends Error {
  constructor(
    message: string,
    readonly noRoute = false,
  ) {
    super(message);
    this.name = "MapboxRoutingError";
  }
}

export type MapboxProfile = "driving-traffic" | "driving";

export interface MapboxCandidates {
  routes: OsrmRoute[];
  /** Km entre cada punto pedido y la vía donde Mapbox lo ubicó (origen, paradas, destino). */
  snapKm: number[];
}

/** Perfil para planificar: siempre `driving` (ver arriba). Se conserva el parámetro por compatibilidad. */
export function mapboxProfileFor(_waypointCount: number): MapboxProfile {
  return "driving";
}

/** Token para llamar a Mapbox desde el servidor (el público pk.* sirve). */
export function mapboxServerToken(): string {
  const token = (
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    ""
  ).trim();
  return /^[ps]k\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : "";
}

/**
 * Rutas candidatas de Mapbox. `excludeToll` pide una ruta que evite peajes
 * (Mapbox devuelve NoRoute si no existe ninguna).
 */
export async function fetchMapboxCandidates(
  waypoints: LatLon[],
  token: string,
  opts: {
    excludeToll?: boolean;
    profile?: MapboxProfile;
    excludePoints?: LatLon[];
    /** Pedir alternativas (Mapbox solo las da con 2 puntos). Por defecto, sí. */
    alternatives?: boolean;
  } = {},
): Promise<MapboxCandidates> {
  if (waypoints.length < 2) throw new MapboxRoutingError("Se necesitan origen y destino.");
  if (waypoints.length > 25) throw new MapboxRoutingError("Mapbox admite hasta 25 puntos.");
  const profile = opts.profile ?? mapboxProfileFor(waypoints.length);
  const path = waypoints.map((w) => `${w.lon.toFixed(6)},${w.lat.toFixed(6)}`).join(";");
  const params = new URLSearchParams({
    alternatives: opts.alternatives !== false && waypoints.length === 2 ? "true" : "false",
    geometries: "geojson",
    overview: "full",
    // steps=true: cada paso trae sus intersecciones con la clase vial del
    // proveedor (mapbox_streets_v8.class), base de la jerarquía de vías.
    steps: "true",
    // Metros y segundos entre cada par de puntos: velocidad por tramo para el consumo.
    annotations: "distance,duration",
    // Sin `language`: Mapbox exige steps=true para usarlo y, si no, rechaza la
    // petición entera (eso hacía caer todo a OSRM y dar 198 km en vez de 212).
  });
  const exclude = [
    ...(opts.excludeToll ? ["toll"] : []),
    // Mapbox admite hasta 50 puntos; formato point(lon lat).
    ...(opts.excludePoints ?? [])
      .slice(0, 50)
      .map((p) => `point(${p.lon.toFixed(5)} ${p.lat.toFixed(5)})`),
  ];
  if (exclude.length) params.set("exclude", exclude.join(","));
  // La clave de caché se arma ANTES de añadir el token, para no guardarlo en ella.
  const cacheKey = `mapbox-directions:${profile}:${path}:${params.toString()}`;
  params.set("access_token", token);
  // "%20" en vez de "+" para el espacio de point(lon lat): no depender de cómo decodifique el servidor.
  const query = params.toString().replace(/\+/g, "%20");
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${path}?${query}`;
  const raw = await fetchJson<unknown>(url, { timeoutMs: 15000, cacheTtlMs: 90_000, cacheKey });
  const data = OsrmResponseSchema.parse(raw);
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new MapboxRoutingError(`Mapbox sin ruta (${data.code})`, data.code === "NoRoute");
  }
  return {
    routes: data.routes,
    snapKm: (data.waypoints ?? []).map((w) => (w.distance ?? 0) / 1000),
  };
}

// Se arma con new RegExp (y no como literal /…/) porque los escáneres de secretos
// confunden el literal con un token real y lo "redactan", rompiendo el archivo.
const TOKEN_PARAM = new RegExp(`(${"access"}_${"token"}=)[^&\\s]*`, "g");
const MAPBOX_TOKEN = /\b[ps]k\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** Mensaje de error sin el token de Mapbox (viene dentro de la URL). */
export function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(TOKEN_PARAM, "$1***").replace(MAPBOX_TOKEN, "pk.***");
}
