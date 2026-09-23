import { routeOverlap } from "@/domain/geo";
import type { LatLon, RawRoute } from "@/domain/types";
import { fetchMapboxCandidates, mapboxServerToken } from "./routing.mapbox";
import { fetchOsrmCandidates, toRawRoute, type OsrmRoute } from "./routing.osrm";

/** Máximo de rutas que se presentan al planificar. */
export const MAX_ROUTES = 4;
/** Una alternativa se descarta si es más de un 50 % más larga o más lenta que la mejor. */
export const MAX_ALTERNATIVE_RATIO = 1.5;
/** Dos rutas que comparten más de este tramo se consideran la misma. */
export const SAME_ROUTE_OVERLAP = 0.9;

export interface RouteCandidate {
  route: OsrmRoute;
  noTolls: boolean;
}

function coords(r: OsrmRoute): LatLon[] {
  return r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
}

/**
 * Junta las candidatas de varias consultas en un conjunto presentable:
 *  1. quita duplicados (misma vía en ≥ 90 % del trayecto); si una ruta normal
 *     coincide con la pedida "sin peajes", se marca como sin peajes;
 *  2. descarta alternativas absurdas (> 50 % más largas o lentas que la mejor);
 *  3. ordena por tiempo de manejo y deja como máximo 4, rotuladas Ruta A, B, C, D.
 */
export function buildRouteSet(candidates: RouteCandidate[]): RawRoute[] {
  const kept: { route: OsrmRoute; noTolls: boolean; line: LatLon[] }[] = [];
  for (const c of candidates) {
    const line = coords(c.route);
    const same = kept.find(
      (k) =>
        routeOverlap(k.line, line) >= SAME_ROUTE_OVERLAP &&
        routeOverlap(line, k.line) >= SAME_ROUTE_OVERLAP,
    );
    if (same) {
      same.noTolls ||= c.noTolls;
      continue;
    }
    kept.push({ route: c.route, noTolls: c.noTolls, line });
  }
  if (kept.length === 0) return [];

  const minDistance = Math.min(...kept.map((k) => k.route.distance));
  const minDuration = Math.min(...kept.map((k) => k.route.duration));
  const sensible = kept
    .filter(
      (k) =>
        k.route.distance <= minDistance * MAX_ALTERNATIVE_RATIO &&
        k.route.duration <= minDuration * MAX_ALTERNATIVE_RATIO,
    )
    .sort((a, b) => a.route.duration - b.route.duration)
    .slice(0, MAX_ROUTES);

  const letters = ["A", "B", "C", "D"];
  return sensible.map((k, i) =>
    toRawRoute(k.route, {
      id: `route-${i}`,
      label: sensible.length > 1 ? `Ruta ${letters[i] ?? i + 1}` : "Ruta recomendada",
      noTolls: k.noTolls,
    }),
  );
}

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/access_token=[^&\s]+/g, "access_token=***");
}

/**
 * Rutas para el planificador. Con token de Mapbox pide en paralelo la ruta
 * normal (con sus alternativas) y una que evite peajes; sin token, o si Mapbox
 * falla, usa los servidores públicos de OSRM (hasta 3 alternativas).
 */
export async function fetchRoutes(waypoints: LatLon[]): Promise<RawRoute[]> {
  const token = mapboxServerToken();
  if (token) {
    const [main, noToll] = await Promise.allSettled([
      fetchMapboxCandidates(waypoints, token),
      fetchMapboxCandidates(waypoints, token, { excludeToll: true }),
    ]);
    if (main.status === "fulfilled") {
      const candidates: RouteCandidate[] = main.value.map((route) => ({ route, noTolls: false }));
      if (noToll.status === "fulfilled") {
        candidates.push(...noToll.value.map((route) => ({ route, noTolls: true })));
      }
      const routes = buildRouteSet(candidates);
      if (routes.length) return routes;
    } else {
      console.warn("[routing] Mapbox falló, uso OSRM:", redact(main.reason));
    }
  }
  const osrm = await fetchOsrmCandidates(waypoints);
  return buildRouteSet(osrm.map((route) => ({ route, noTolls: false })));
}
