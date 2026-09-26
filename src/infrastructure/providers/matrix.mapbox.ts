import { z } from "zod";
import type { LatLon } from "@/domain/types";
import { fetchJson } from "./http";

/**
 * Matrix API de Mapbox (perfil driving): distancias y tiempos por vía entre
 * varios orígenes y destinos. Hasta 25 coordenadas por consulta (verificar el
 * límite vigente del plan). Caché de 7 días: las vías cambian poco y la misma
 * ruta repite los mismos pares.
 */
export const MAPBOX_MATRIX_MAX_COORDINATES = 25;
const CACHE_TTL_MS = 7 * 24 * 3600_000;

const MatrixSchema = z
  .object({
    code: z.string(),
    message: z.string().optional(),
    distances: z.array(z.array(z.number().nullable())).optional(),
    durations: z.array(z.array(z.number().nullable())).optional(),
  })
  .passthrough();

export async function fetchMapboxMatrix(
  token: string,
  sources: LatLon[],
  destinations: LatLon[],
): Promise<{ distanceM: (number | null)[][]; durationS: (number | null)[][] }> {
  const coords = [...sources, ...destinations];
  if (coords.length > MAPBOX_MATRIX_MAX_COORDINATES) {
    throw new Error(
      `Matriz de Mapbox: ${coords.length} coordenadas (máximo ${MAPBOX_MATRIX_MAX_COORDINATES}).`,
    );
  }
  const path = coords.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const params = new URLSearchParams({
    sources: sources.map((_, i) => String(i)).join(";"),
    destinations: destinations.map((_, i) => String(sources.length + i)).join(";"),
    annotations: "distance,duration",
  });
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${path}?${params.toString()}&access_token=${token}`;
  const raw = await fetchJson<unknown>(url, {
    timeoutMs: 10_000,
    cacheTtlMs: CACHE_TTL_MS,
    cacheKey: `mapbox-matrix:${path}:${params.toString()}`,
  });
  const data = MatrixSchema.parse(raw);
  if (data.code !== "Ok" || !data.distances || !data.durations) {
    throw new Error(`Matriz de Mapbox: ${data.code}${data.message ? ` — ${data.message}` : ""}`);
  }
  return { distanceM: data.distances, durationS: data.durations };
}
