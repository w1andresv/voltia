import type { LatLon } from "@/domain/types";

/**
 * StationCorridorEngine: dónde queda cada estación respecto a la ruta (plan §4.6).
 * Reemplaza a stations/spatial.ts y a attachChargersToRoute (D7): una sola
 * proyección, contra los SEGMENTOS entre muestras y no contra los vértices.
 */

export interface RoutePoint extends LatLon {
  km: number;
}

export interface RouteProjection {
  /** Km de la ruta en el punto de la vía más cercano. */
  alongKm: number;
  /** Distancia en línea recta de la estación a la vía. */
  lateralKm: number;
  /** Muestra más cercana a lo largo de la ruta (donde el plan ubica la parada). */
  sampleIndex: number;
}

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;

/** Proyección de `point` sobre la polilínea de `samples`. null si no hay muestras. */
export function projectOnRoute(point: LatLon, samples: RoutePoint[]): RouteProjection | null {
  if (!samples.length) return null;
  // Plano local centrado en el punto: suficiente para distancias de pocos km.
  const kx = KM_PER_DEG_LON_EQUATOR * Math.cos((point.lat * Math.PI) / 180);
  const toXY = (p: LatLon) => ({ x: (p.lon - point.lon) * kx, y: (p.lat - point.lat) * KM_PER_DEG_LAT });
  if (samples.length === 1) {
    const a = toXY(samples[0]!);
    return { alongKm: samples[0]!.km, lateralKm: Math.hypot(a.x, a.y), sampleIndex: 0 };
  }
  let best: RouteProjection | null = null;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = toXY(samples[i]!);
    const b = toXY(samples[i + 1]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2)) : 0;
    const lateral = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (!best || lateral < best.lateralKm) {
      const alongKm = samples[i]!.km + t * (samples[i + 1]!.km - samples[i]!.km);
      best = { alongKm, lateralKm: lateral, sampleIndex: t < 0.5 ? i : i + 1 };
    }
  }
  return best;
}

/** Caja que contiene la ruta, ampliada `padKm` en cada lado. */
function paddedBounds(samples: LatLon[], padKm: number) {
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const p of samples) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const dLat = padKm / KM_PER_DEG_LAT;
  const maxAbsLat = Math.max(Math.abs(minLat), Math.abs(maxLat));
  const dLon = padKm / (KM_PER_DEG_LON_EQUATOR * Math.max(0.1, Math.cos((maxAbsLat * Math.PI) / 180)));
  return { minLat: minLat - dLat, maxLat: maxLat + dLat, minLon: minLon - dLon, maxLon: maxLon + dLon };
}

/**
 * Las estaciones a `maxKm` o menos de alguna de las rutas, en el orden de entrada.
 * Cada ruta se evalúa por separado (no se unen sus muestras en una sola línea).
 */
export function stationsNearRoutes<T extends LatLon>(items: T[], routes: RoutePoint[][], maxKm: number): T[] {
  const withSamples = routes.filter((r) => r.length > 0);
  if (!items.length || !withSamples.length) return [];
  const boxes = withSamples.map((r) => paddedBounds(r, maxKm));
  return items.filter((it) =>
    withSamples.some((samples, i) => {
      const b = boxes[i]!;
      if (it.lat < b.minLat || it.lat > b.maxLat || it.lon < b.minLon || it.lon > b.maxLon) return false;
      const proj = projectOnRoute(it, samples);
      return proj != null && proj.lateralKm <= maxKm;
    }),
  );
}

/** Ubicación de una estación en una ruta, con el desvío estimado de ida y vuelta. */
export interface CorridorPlacement {
  fromRouteKm: number;
  detourKm: number;
  /** Solo con desvío medido: minutos de ida y vuelta. */
  detourMinutes?: number;
  detourSource: "estimated" | "calculated";
  /** Km de la muestra donde se ubica la parada. */
  nearestKm: number;
  nearestSampleIndex: number;
}

/**
 * Proyecta cada estación sobre una ruta; deja las que están a `maxKm` o menos,
 * ordenadas por su km en la ruta. El desvío es el medido por vía si viene en
 * `measured` (por id de estación), o una estimación (2 × distancia × factor).
 */
export function placeOnRoute<T extends LatLon & { id?: string }>(
  items: T[],
  samples: RoutePoint[],
  opts: {
    maxKm: number;
    detourRoadFactor: number;
    measured?: Record<string, { distanceKm: number; durationMin: number }>;
  },
): (T & CorridorPlacement)[] {
  const out: (T & CorridorPlacement)[] = [];
  for (const it of items) {
    const proj = projectOnRoute(it, samples);
    if (!proj || proj.lateralKm > opts.maxKm) continue;
    const m = it.id != null ? opts.measured?.[it.id] : undefined;
    out.push({
      ...it,
      fromRouteKm: proj.lateralKm,
      ...(m
        ? { detourKm: m.distanceKm, detourMinutes: m.durationMin, detourSource: "calculated" as const }
        : { detourKm: 2 * proj.lateralKm * opts.detourRoadFactor, detourSource: "estimated" as const }),
      nearestKm: samples[proj.sampleIndex]!.km,
      nearestSampleIndex: proj.sampleIndex,
    });
  }
  return out.sort((a, b) => a.nearestKm - b.nearestKm);
}
