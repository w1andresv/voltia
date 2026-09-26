/**
 * Política de rutas (plan §4.1): qué rutas se piden al proveedor y cuáles se
 * presentan. Alternativas, variante sin peajes, corrección de atajos por vías
 * menores, deduplicación, tolerancias y rótulos. Antes vivía en el proveedor;
 * el comportamiento es el mismo (F2).
 */
import { classifyRoute, legBoundariesKm } from "@/domain/ev/engines/route/classify";
import { toRawRoute } from "@/domain/ev/engines/route/normalize";
import { RoutingError, type ProviderRoute } from "@/domain/ev/contracts/route";
import { routeOverlap } from "@/domain/geo";
import type { RoutingProvider } from "@/domain/ports/routing";
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

/** Máximo de rutas que se presentan al planificar. */
export const MAX_ROUTES = 4;
/** Una alternativa se descarta si es más de un 50 % más larga o más lenta que la mejor. */
export const MAX_ALTERNATIVE_RATIO = 1.5;
/** Dos rutas que comparten más de este tramo se consideran la misma. */
export const SAME_ROUTE_OVERLAP = 0.9;
/** Rondas máximas de corrección de atajos y atajos excluidos por ronda. */
export const MAX_SHORTCUT_ROUNDS = 2;
export const SHORTCUTS_PER_ROUND = 3;
/** A partir de cuántos km de la vía un punto probablemente está mal ubicado. */
export const SNAP_WARNING_KM = 1;

export interface RoutingResult {
  routes: RawRoute[];
  engine: RoutingEngine;
  warnings: string[];
}

export interface RouteCandidate {
  route: ProviderRoute;
  noTolls: boolean;
  /** Costo con jerarquía vial (s); sin él se usa la duración. */
  costS?: number;
  mix?: RoadMix;
  /** Km ponderados por vías menores fuera de los accesos. */
  minorScore?: number;
}

export interface ScoredCandidate extends RouteCandidate {
  segments: RoadSegment[];
  costS: number;
}

/** Clasifica una candidata por jerarquía vial y le calcula el costo. */
export function scoreCandidate(route: ProviderRoute, noTolls: boolean): ScoredCandidate {
  const segments = classifyRoute(route);
  const zones = accessZones(route.distanceM / 1000, legBoundariesKm(route));
  return {
    route,
    noTolls,
    segments,
    mix: segments.length ? roadMix(segments) : undefined,
    costS: segments.length ? hierarchyCostS(segments, zones) : route.durationS,
    minorScore: segments.length ? minorRoadScore(segments, zones) : undefined,
  };
}

/** Dentro de la tolerancia frente a la más rápida (+15 % tiempo, +10 % km). */
export function withinTolerance(c: { route: ProviderRoute }, fastest: { route: ProviderRoute }): boolean {
  return (
    c.route.durationS <= fastest.route.durationS * MAX_EXTRA_TIME_RATIO &&
    c.route.distanceM <= fastest.route.distanceM * MAX_EXTRA_DISTANCE_RATIO
  );
}

/** La mejor por jerarquía entre las que no se desvían demasiado. */
export function pickByHierarchy<T extends { route: ProviderRoute; costS: number; minorScore?: number }>(
  all: T[],
): T | undefined {
  if (!all.length) return undefined;
  const fastest = all.reduce((f, c) => (c.route.durationS < f.route.durationS ? c : f));
  return all
    .filter((c) => withinTolerance(c, fastest))
    .sort((a, b) =>
      compareByHierarchy({ minorScore: a.minorScore, cost: a.costS }, { minorScore: b.minorScore, cost: b.costS }),
    )[0];
}

/**
 * Junta las candidatas de varias consultas en un conjunto presentable:
 *  1. quita duplicados (misma vía en ≥ 90 % del trayecto); si una ruta normal
 *     coincide con la pedida "sin peajes", se marca como sin peajes;
 *  2. descarta alternativas absurdas (> 50 % más largas o lentas que la mejor);
 *  3. ordena y deja como máximo 4, rotuladas Ruta A, B, C, D.
 */
export function buildRouteSet(candidates: RouteCandidate[], engine?: RoutingEngine): RawRoute[] {
  const kept: (RouteCandidate & { line: LatLon[] })[] = [];
  for (const c of candidates) {
    const line = c.route.geometry;
    const same = kept.find(
      (k) => routeOverlap(k.line, line) >= SAME_ROUTE_OVERLAP && routeOverlap(line, k.line) >= SAME_ROUTE_OVERLAP,
    );
    if (same) {
      same.noTolls ||= c.noTolls;
      continue;
    }
    kept.push({ ...c, line });
  }
  if (kept.length === 0) return [];

  const minDistance = Math.min(...kept.map((k) => k.route.distanceM));
  const minDuration = Math.min(...kept.map((k) => k.route.durationS));
  const fastest = kept.reduce((f, k) => (k.route.durationS < f.route.durationS ? k : f));
  const sensible = kept
    .filter(
      (k) =>
        k.route.distanceM <= minDistance * MAX_ALTERNATIVE_RATIO &&
        k.route.durationS <= minDuration * MAX_ALTERNATIVE_RATIO,
    )
    // Con clasificación vial, primero la de menor costo con jerarquía (dentro de
    // la tolerancia); sin ella (OSRM), la más rápida.
    .sort((a, b) => {
      const ta = withinTolerance(a, fastest);
      const tb = withinTolerance(b, fastest);
      if (ta !== tb) return ta ? -1 : 1;
      return compareByHierarchy(
        { minorScore: a.minorScore, cost: a.costS ?? a.route.durationS },
        { minorScore: b.minorScore, cost: b.costS ?? b.route.durationS },
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
      k.mix && k.route.durationS > 0
        ? {
            roadMix: k.mix,
            hierarchyFactor: (k.costS ?? k.route.durationS) / k.route.durationS,
            withinTolerance: withinTolerance(k, fastest),
            minorRoadScore: k.minorScore,
          }
        : {};
    return { ...raw, ...hierarchy, ...(engine ? { engine } : {}) };
  });
}

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

/**
 * Con un proveedor que evita peajes y puntos: pide en paralelo la ruta normal (con
 * alternativas) y una sin peajes, y corrige atajos por vías menores. Si la mejor
 * usa un tramo secundario, terciario o local fuera de los accesos, pide otra
 * excluyéndolo; la nueva solo gana si su costo con jerarquía es menor y no se
 * desvía más de la tolerancia.
 */
async function hierarchySelection(
  provider: RoutingProvider,
  waypoints: LatLon[],
): Promise<{ routes: RawRoute[]; snapKm: number[]; corrected: number }> {
  const [main, noToll] = await Promise.allSettled([
    provider.calculateRoutes({ waypoints, alternatives: true }),
    provider.calculateRoutes({ waypoints, alternatives: true, avoid: { tolls: true } }),
  ]);
  if (main.status !== "fulfilled") {
    throw main.reason instanceof Error ? main.reason : new Error(String(main.reason));
  }
  const all: ScoredCandidate[] = main.value.routes.map((r) => scoreCandidate(r, false));
  if (noToll.status === "fulfilled") {
    all.push(...noToll.value.routes.map((r) => scoreCandidate(r, true)));
  }

  const excluded: LatLon[] = [];
  let corrected = 0;
  let previousBest: ScoredCandidate | undefined;
  for (let round = 0; round < MAX_SHORTCUT_ROUNDS; round++) {
    const best = pickByHierarchy(all);
    // Si la ronda anterior no produjo una ruta mejor, no se insiste.
    if (!best || best === previousBest) break;
    previousBest = best;
    const zones = accessZones(best.route.distanceM / 1000, legBoundariesKm(best.route));
    const shortcuts = findShortcuts(best.segments, zones).slice(0, SHORTCUTS_PER_ROUND);
    if (!shortcuts.length) break;
    excluded.push(...shortcuts.map((sc) => sc.point));
    try {
      const retry = await provider.calculateRoutes({ waypoints, alternatives: true, avoid: { points: excluded } });
      all.push(...retry.routes.map((r) => scoreCandidate(r, false)));
      corrected++;
    } catch {
      break; // sin ruta que evite esos tramos: se queda con lo que hay
    }
  }

  return { routes: buildRouteSet(all, provider.engine), snapKm: main.value.waypointSnapKm, corrected };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rutas para el planificador. Con un proveedor que evita peajes (Mapbox) aplica
 * la política completa y NO cae a otro proveedor: si falla, el motivo llega al
 * usuario. Con uno sin esas capacidades (OSRM), pide una vez y ordena.
 */
export async function selectRoutes(provider: RoutingProvider, waypoints: LatLon[]): Promise<RoutingResult> {
  const notice = provider.notice ? [provider.notice] : [];
  if (!provider.capabilities.avoidTolls) {
    const set = await provider.calculateRoutes({ waypoints, alternatives: true });
    return {
      routes: buildRouteSet(
        set.routes.map((route) => ({ route, noTolls: false })),
        provider.engine,
      ),
      engine: provider.engine,
      warnings: notice,
    };
  }

  let lastError: unknown;
  try {
    const { routes, snapKm, corrected } = await hierarchySelection(provider, waypoints);
    if (routes.length) {
      if (corrected) console.log(`[routing] ${corrected} ronda(s) de corrección de atajos por vías menores`);
      return { routes, engine: provider.engine, warnings: [...notice, ...snapWarnings(snapKm)] };
    }
  } catch (error) {
    lastError = error;
  }
  console.error(`[routing] ${provider.label} falló:`, messageOf(lastError));
  if (lastError instanceof RoutingError && lastError.noRoute) {
    throw new Error(`${provider.label} no encontró un camino entre esos puntos.`);
  }
  throw new Error(`No se pudo calcular la ruta con ${provider.label}: ${messageOf(lastError)}`);
}
