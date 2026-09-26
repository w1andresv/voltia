import { routeOverlap } from "@/domain/geo";
import {
  MAX_EXTRA_DISTANCE_RATIO,
  MAX_EXTRA_TIME_RATIO,
  accessZones,
  compareByHierarchy,
  findShortcuts,
  hierarchyCostS,
  minorRoadScore,
  roadMix,
  type RoadMix,
  type RoadSegment,
} from "@/domain/road-hierarchy";
import type { LatLon, RawRoute, RoutingEngine } from "@/domain/types";
import {
  MapboxRoutingError,
  fetchMapboxCandidates,
  mapboxProfileFor,
  mapboxServerToken,
  type MapboxProfile,
} from "./routing.mapbox";
import { classifyRoute, legBoundariesKm } from "./routing.classify";
import { fetchOsrmCandidates, toRawRoute, type OsrmRoute } from "./routing.osrm";

/** Máximo de rutas que se presentan al planificar. */
export const MAX_ROUTES = 4;
/** Una alternativa se descarta si es más de un 50 % más larga o más lenta que la mejor. */
export const MAX_ALTERNATIVE_RATIO = 1.5;
/** Dos rutas que comparten más de este tramo se consideran la misma. */
export const SAME_ROUTE_OVERLAP = 0.9;

export const OSRM_NO_TOKEN_WARNING =
  "Sin token de Mapbox en el servidor. La distancia usa OpenStreetMap (OSRM) y puede diferir de Google Maps.";
export const MAPBOX_DRIVING_FALLBACK_WARNING =
  "Mapbox tráfico no respondió; se usó el perfil driving (sin tráfico en vivo).";

export interface RouteCandidate {
  route: OsrmRoute;
  noTolls: boolean;
  /** Costo con jerarquía vial (s); sin él se usa la duración. */
  costS?: number;
  mix?: RoadMix;
  /** Km ponderados por vías menores fuera de los accesos. */
  minorScore?: number;
}

/** Rondas máximas de corrección de atajos y atajos excluidos por ronda. */
export const MAX_SHORTCUT_ROUNDS = 2;
export const SHORTCUTS_PER_ROUND = 3;

export interface ScoredCandidate extends RouteCandidate {
  segments: RoadSegment[];
  costS: number;
}

/** Clasifica una candidata por jerarquía vial y le calcula el costo. */
export function scoreCandidate(route: OsrmRoute, noTolls: boolean): ScoredCandidate {
  const segments = classifyRoute(route);
  const zones = accessZones(route.distance / 1000, legBoundariesKm(route));
  return {
    route,
    noTolls,
    segments,
    mix: segments.length ? roadMix(segments) : undefined,
    costS: segments.length ? hierarchyCostS(segments, zones) : route.duration,
    minorScore: segments.length ? minorRoadScore(segments, zones) : undefined,
  };
}

/** Dentro de la tolerancia frente a la más rápida (+15 % tiempo, +10 % km). */
export function withinTolerance(c: { route: OsrmRoute }, fastest: { route: OsrmRoute }): boolean {
  return (
    c.route.duration <= fastest.route.duration * MAX_EXTRA_TIME_RATIO &&
    c.route.distance <= fastest.route.distance * MAX_EXTRA_DISTANCE_RATIO
  );
}

/** La mejor por jerarquía entre las que no se desvían demasiado. */
export function pickByHierarchy<T extends { route: OsrmRoute; costS: number; minorScore?: number }>(
  all: T[],
): T | undefined {
  if (!all.length) return undefined;
  const fastest = all.reduce((f, c) => (c.route.duration < f.route.duration ? c : f));
  return all
    .filter((c) => withinTolerance(c, fastest))
    .sort((a, b) =>
      compareByHierarchy(
        { minorScore: a.minorScore, cost: a.costS },
        { minorScore: b.minorScore, cost: b.costS },
      ),
    )[0];
}

export interface FetchRoutesResult {
  routes: RawRoute[];
  engine: RoutingEngine;
  warnings: string[];
}

function coords(r: OsrmRoute): LatLon[] {
  return r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
}

function engineFor(profile: MapboxProfile): RoutingEngine {
  return profile === "driving-traffic" ? "mapbox-traffic" : "mapbox";
}

/**
 * Junta las candidatas de varias consultas en un conjunto presentable:
 *  1. quita duplicados (misma vía en ≥ 90 % del trayecto); si una ruta normal
 *     coincide con la pedida "sin peajes", se marca como sin peajes;
 *  2. descarta alternativas absurdas (> 50 % más largas o lentas que la mejor);
 *  3. ordena por tiempo de manejo y deja como máximo 4, rotuladas Ruta A, B, C, D.
 */
export function buildRouteSet(candidates: RouteCandidate[], engine?: RoutingEngine): RawRoute[] {
  const kept: (RouteCandidate & { line: LatLon[] })[] = [];
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
    kept.push({ ...c, line });
  }
  if (kept.length === 0) return [];

  const minDistance = Math.min(...kept.map((k) => k.route.distance));
  const minDuration = Math.min(...kept.map((k) => k.route.duration));
  const fastest = kept.reduce((f, k) => (k.route.duration < f.route.duration ? k : f));
  const sensible = kept
    .filter(
      (k) =>
        k.route.distance <= minDistance * MAX_ALTERNATIVE_RATIO &&
        k.route.duration <= minDuration * MAX_ALTERNATIVE_RATIO,
    )
    // Con clasificación vial, primero la de menor costo con jerarquía (dentro de
    // la tolerancia); sin ella (OSRM), la más rápida.
    .sort((a, b) => {
      const ta = withinTolerance(a, fastest);
      const tb = withinTolerance(b, fastest);
      if (ta !== tb) return ta ? -1 : 1;
      return compareByHierarchy(
        { minorScore: a.minorScore, cost: a.costS ?? a.route.duration },
        { minorScore: b.minorScore, cost: b.costS ?? b.route.duration },
      );
    })
    .slice(0, MAX_ROUTES);

  const letters = ["A", "B", "C", "D"];
  return sensible.map((k, i) => {
    const raw = toRawRoute(k.route, {
      id: `route-${i}`,
      label: sensible.length > 1 ? `Ruta ${letters[i] ?? i + 1}` : "Ruta recomendada",
      noTolls: k.noTolls,
    });
    const hierarchy =
      k.mix && k.route.duration > 0
        ? {
            roadMix: k.mix,
            hierarchyFactor: (k.costS ?? k.route.duration) / k.route.duration,
            withinTolerance: withinTolerance(k, fastest),
            minorRoadScore: k.minorScore,
          }
        : {};
    return { ...raw, ...hierarchy, ...(engine ? { engine } : {}) };
  });
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

/** A partir de cuántos km de la vía un punto probablemente está mal ubicado. */
export const SNAP_WARNING_KM = 1;

/**
 * Aviso si el origen, una parada o el destino quedó lejos de cualquier vía: suele
 * ser el centro geográfico de un municipio (zona rural) en vez del casco urbano,
 * y alarga la ruta con kilómetros de camino rural.
 */
export function snapWarnings(snapKm: number[]): string[] {
  const out: string[] = [];
  snapKm.forEach((km, i) => {
    if (km < SNAP_WARNING_KM) return;
    const which = i === 0 ? "El origen" : i === snapKm.length - 1 ? "El destino" : `La parada ${i}`;
    out.push(
      `${which} está a ${km.toFixed(1)} km de la vía más cercana; la distancia puede salir mayor. Elige el pueblo o una dirección concreta.`,
    );
  });
  return out;
}

async function fetchMapboxRouteSet(
  waypoints: LatLon[],
  token: string,
  profile: MapboxProfile,
): Promise<{ routes: RawRoute[]; snapKm: number[]; corrected: number }> {
  const engine = engineFor(profile);
  const [main, noToll] = await Promise.allSettled([
    fetchMapboxCandidates(waypoints, token, { profile }),
    fetchMapboxCandidates(waypoints, token, { profile, excludeToll: true }),
  ]);
  if (main.status !== "fulfilled") {
    throw main.reason instanceof Error ? main.reason : new Error(String(main.reason));
  }
  const all: ScoredCandidate[] = main.value.routes.map((r) => scoreCandidate(r, false));
  if (noToll.status === "fulfilled") {
    all.push(...noToll.value.routes.map((r) => scoreCandidate(r, true)));
  }

  // Corrección de atajos: si la mejor ruta usa un tramo secundario/terciario/local
  // fuera de los accesos, se pide otra excluyendo ese tramo. La nueva solo gana si
  // su costo con jerarquía es menor y no se desvía más de la tolerancia.
  const excluded: LatLon[] = [];
  let corrected = 0;
  let previousBest: ScoredCandidate | undefined;
  for (let round = 0; round < MAX_SHORTCUT_ROUNDS; round++) {
    const best = pickByHierarchy(all);
    // Si la ronda anterior no produjo una ruta mejor, no se insiste.
    if (!best || best === previousBest) break;
    previousBest = best;
    const zones = accessZones(best.route.distance / 1000, legBoundariesKm(best.route));
    const shortcuts = findShortcuts(best.segments, zones).slice(0, SHORTCUTS_PER_ROUND);
    if (!shortcuts.length) break;
    excluded.push(...shortcuts.map((sc) => sc.point));
    try {
      const retry = await fetchMapboxCandidates(waypoints, token, {
        profile,
        excludePoints: excluded,
      });
      all.push(...retry.routes.map((r) => scoreCandidate(r, false)));
      corrected++;
    } catch {
      break; // sin ruta que evite esos tramos: se queda con lo que hay
    }
  }

  return { routes: buildRouteSet(all, engine), snapKm: main.value.snapKm, corrected };
}

/**
 * Rutas de Mapbox: pide en paralelo la ruta normal (con sus alternativas) y una
 * que evite peajes, y corrige atajos por vías menores. NO cae a OSRM: si Mapbox
 * falla, el error llega al usuario.
 */
export async function fetchMapboxRoutes(waypoints: LatLon[], token: string): Promise<FetchRoutesResult> {
  const warnings: string[] = [];
  const preferred = mapboxProfileFor(waypoints.length);
  const profiles: MapboxProfile[] =
    preferred === "driving-traffic" ? ["driving-traffic", "driving"] : ["driving"];
  let lastError: unknown;
  for (const profile of profiles) {
    try {
      const { routes, snapKm, corrected } = await fetchMapboxRouteSet(waypoints, token, profile);
      if (!routes.length) continue;
      if (corrected)
        console.log(`[routing] ${corrected} ronda(s) de corrección de atajos por vías menores`);
      if (profile !== preferred) warnings.push(MAPBOX_DRIVING_FALLBACK_WARNING);
      warnings.push(...snapWarnings(snapKm));
      return { routes, engine: engineFor(profile), warnings };
    } catch (error) {
      lastError = error;
    }
  }
  // Con token, distancia y trazo salen SIEMPRE de Mapbox: si falla, se informa
  // el motivo en vez de mostrar en silencio una ruta de OSRM con otros km.
  console.error("[routing] Mapbox falló:", redact(lastError));
  if (lastError instanceof MapboxRoutingError && lastError.noRoute) {
    throw new Error("Mapbox no encontró un camino entre esos puntos.");
  }
  throw new Error(`No se pudo calcular la ruta con Mapbox: ${redact(lastError)}`);
}

/** Rutas de OSRM público: solo se usan sin token de Mapbox, con un aviso. */
export async function fetchOsrmRoutes(waypoints: LatLon[]): Promise<FetchRoutesResult> {
  const osrm = await fetchOsrmCandidates(waypoints);
  return {
    routes: buildRouteSet(
      osrm.map((route) => ({ route, noTolls: false })),
      "osrm",
    ),
    engine: "osrm",
    warnings: [OSRM_NO_TOKEN_WARNING],
  };
}

/** Rutas para el planificador: Mapbox con token, OSRM sin él. */
export async function fetchRoutes(waypoints: LatLon[]): Promise<FetchRoutesResult> {
  const token = mapboxServerToken();
  return token ? fetchMapboxRoutes(waypoints, token) : fetchOsrmRoutes(waypoints);
}
