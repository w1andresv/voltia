import type { LatLon } from "@/domain/types";
import { fetchJson } from "./http";
import { OsrmResponseSchema, type OsrmRoute } from "./routing.osrm";

/**
 * Mapbox Directions (perfil `driving`): red vial y velocidades más completas que
 * los servidores públicos de OSRM, así que distancias y tiempos quedan mucho más
 * cerca de los de Google Maps. Responde en el mismo formato que OSRM.
 * Límites: hasta 25 puntos; las alternativas solo salen con 2 puntos.
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
  opts: { excludeToll?: boolean } = {},
): Promise<OsrmRoute[]> {
  if (waypoints.length < 2) throw new MapboxRoutingError("Se necesitan origen y destino.");
  if (waypoints.length > 25) throw new MapboxRoutingError("Mapbox admite hasta 25 puntos.");
  const path = waypoints.map((w) => `${w.lon.toFixed(6)},${w.lat.toFixed(6)}`).join(";");
  const params = new URLSearchParams({
    alternatives: waypoints.length === 2 ? "true" : "false",
    geometries: "geojson",
    overview: "full",
    steps: "false",
    language: "es",
  });
  if (opts.excludeToll) params.set("exclude", "toll");
  // La clave de caché se arma ANTES de añadir el token, para no guardarlo en ella.
  const cacheKey = `mapbox-directions:${path}:${params.toString()}`;
  params.set("access_token", token);
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${path}?${params}`;
  const raw = await fetchJson<unknown>(url, { timeoutMs: 15000, cacheTtlMs: 90_000, cacheKey });
  const data = OsrmResponseSchema.parse(raw);
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new MapboxRoutingError(`Mapbox sin ruta (${data.code})`, data.code === "NoRoute");
  }
  return data.routes;
}
