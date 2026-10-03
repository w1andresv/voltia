import { downsample, interpolatePoint, polylineLengthKm } from "@/domain/geo";
import type { LatLon, RawRoute } from "@/domain/types";
import type { ProviderRoute } from "@/domain/ev/contracts/route";
import type { RoadTier } from "@/domain/road-hierarchy";
import { classifyRoute, legBoundariesKm, tollBoothsKm, tunnelStretchesKm } from "./classify";

/**
 * Ruta del proveedor → RawRoute: muestras a lo largo de la ruta con la
 * velocidad típica de cada tramo. Antes vivía en el proveedor (A2); la
 * aritmética es la misma para no cambiar resultados (F2).
 */

/** Distancia (km) y tiempo (s) acumulados a lo largo de la ruta, según el proveedor. */
export interface SpeedProfile {
  cumKm: number[];
  cumS: number[];
}

/**
 * Perfil de tiempo de la ruta: primero las anotaciones por par de puntos; si no
 * vienen, los pasos. Sin ninguno de los dos, null y se usa la velocidad media.
 */
export function speedProfile(route: ProviderRoute): SpeedProfile | null {
  const pieces: [number, number][] = [];
  for (const leg of route.legs) {
    const d = leg.annotation?.distanceM;
    const t = leg.annotation?.durationS;
    if (d?.length && t?.length === d.length) {
      d.forEach((m, i) => pieces.push([m, t[i]!]));
    } else if (leg.steps?.length) {
      for (const st of leg.steps) pieces.push([st.distanceM, st.durationS]);
    } else {
      return null;
    }
  }
  if (!pieces.length) return null;
  const cumKm = [0];
  const cumS = [0];
  for (const [m, sec] of pieces) {
    if (!(m >= 0) || !(sec >= 0)) continue;
    cumKm.push(cumKm[cumKm.length - 1]! + m / 1000);
    cumS.push(cumS[cumS.length - 1]! + sec);
  }
  const totalKm = cumKm[cumKm.length - 1]!;
  const totalS = cumS[cumS.length - 1]!;
  return totalKm > 0 && totalS > 0 ? { cumKm, cumS } : null;
}

function timeAtKm(profile: SpeedProfile, km: number): number {
  const { cumKm, cumS } = profile;
  if (km <= 0) return 0;
  // Búsqueda binaria del tramo que contiene `km`.
  let lo = 0;
  let hi = cumKm.length - 1;
  if (km >= cumKm[hi]!) return cumS[hi]!;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumKm[mid]! <= km) lo = mid;
    else hi = mid;
  }
  const span = cumKm[hi]! - cumKm[lo]!;
  const t = span > 0 ? (km - cumKm[lo]!) / span : 0;
  return cumS[lo]! + t * (cumS[hi]! - cumS[lo]!);
}

/** Límites de la velocidad de un tramo tomada del proveedor, km/h. */
const SEGMENT_SPEED_MIN = 8;
const SEGMENT_SPEED_MAX = 130;
/** Puntos de la geometría que se guardan para dibujar el mapa. */
export const MAP_GEOMETRY_POINTS = 420;

/**
 * Velocidad de cada muestra = distancia / tiempo del proveedor entre la muestra
 * anterior y esta. Las muestras van en km de la ruta; el perfil se escala a esa
 * misma distancia. La primera muestra toma la velocidad del primer tramo.
 */
export function applySegmentSpeeds(
  samples: RawRoute["samples"],
  profile: SpeedProfile | null,
  distanceKm: number,
): RawRoute["samples"] {
  if (!profile || samples.length < 2 || !(distanceKm > 0)) return samples;
  const scale = profile.cumKm[profile.cumKm.length - 1]! / distanceKm;
  const out = samples.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!.km;
    const b = out[i]!.km;
    const dt = timeAtKm(profile, b * scale) - timeAtKm(profile, a * scale);
    if (!(b > a) || !(dt > 0)) continue;
    const kmh = ((b - a) * scale) / (dt / 3600);
    out[i]!.speedKmh = Math.max(SEGMENT_SPEED_MIN, Math.min(SEGMENT_SPEED_MAX, kmh));
  }
  out[0]!.speedKmh = out[1]!.speedKmh;
  return out;
}

/**
 * Muestras cada `max(0,8 km, distancia / 220)`, en km de la ruta (escalados a la
 * distancia del proveedor), con la velocidad media como valor inicial.
 */
export function buildSamples(
  points: LatLon[],
  distanceKm: number,
  durationMin: number,
): RawRoute["samples"] {
  const geomLen = polylineLengthKm(points) || distanceKm;
  const everyKm = Math.max(0.8, distanceKm / 220);
  const samples: RawRoute["samples"] = [];
  const avgSpeed = Math.max(28, Math.min(125, (distanceKm / Math.max(durationMin, 1)) * 60));

  samples.push({
    km: 0,
    lat: points[0]!.lat,
    lon: points[0]!.lon,
    elevM: 0,
    slopePct: 0,
    speedKmh: avgSpeed,
  });

  let acc = 0;
  let nextAt = everyKm;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = Math.hypot(
      (b.lat - a.lat) * 111.32,
      (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180),
    );
    if (d === 0) continue;
    while (acc + d >= nextAt && nextAt < geomLen - everyKm * 0.4) {
      const t = (nextAt - acc) / d;
      const p = interpolatePoint(a, b, t);
      const km = (nextAt / geomLen) * distanceKm;
      samples.push({
        km,
        lat: p.lat,
        lon: p.lon,
        elevM: 0,
        slopePct: 0,
        speedKmh: avgSpeed,
      });
      nextAt += everyKm;
    }
    acc += d;
  }

  const last = points[points.length - 1]!;
  samples.push({
    km: distanceKm,
    lat: last.lat,
    lon: last.lon,
    elevM: 0,
    slopePct: 0,
    speedKmh: avgSpeed,
  });
  return samples;
}

/**
 * Límite legal de cada muestra: el menor límite conocido entre la muestra
 * anterior y esta, según la anotación `maxspeed` del proveedor. Sin anotación
 * (OSRM, o Mapbox sin datos) las muestras quedan sin límite.
 */
export function applySpeedLimits(
  samples: RawRoute["samples"],
  route: ProviderRoute,
  distanceKm: number,
): RawRoute["samples"] {
  const pieces: [number, number | null][] = [];
  for (const leg of route.legs) {
    const d = leg.annotation?.distanceM;
    const lim = leg.annotation?.maxspeedKmh;
    if (!d?.length || lim?.length !== d.length) return samples;
    d.forEach((m, i) => pieces.push([m, lim[i] ?? null]));
  }
  if (!pieces.some(([, l]) => l != null) || samples.length < 2 || !(distanceKm > 0)) return samples;
  const totalKm = pieces.reduce((a, [m]) => a + m, 0) / 1000;
  const scale = totalKm / distanceKm;
  const out = samples.map((s) => ({ ...s }));
  let p = 0;
  let pStart = 0;
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!.km * scale;
    const b = out[i]!.km * scale;
    let min = Infinity;
    // Avanza hasta el primer tramo que termina después de `a`.
    while (p < pieces.length && pStart + pieces[p]![0] / 1000 <= a) {
      pStart += pieces[p]![0] / 1000;
      p++;
    }
    let q = p;
    let qStart = pStart;
    while (q < pieces.length && qStart < b) {
      const lim = pieces[q]![1];
      if (lim != null) min = Math.min(min, lim);
      qStart += pieces[q]![0] / 1000;
      q++;
    }
    if (Number.isFinite(min)) out[i]!.speedLimitKmh = min;
  }
  return out;
}

/**
 * Clase vial de cada muestra: la que ocupa más km entre la muestra anterior y
 * esta, según la clasificación de los pasos del proveedor. Sin pasos (OSRM)
 * las muestras quedan sin clase.
 */
export function applyRoadTiers(
  samples: RawRoute["samples"],
  route: ProviderRoute,
  distanceKm: number,
): RawRoute["samples"] {
  const segments = classifyRoute(route);
  if (!segments.length || samples.length < 2 || !(distanceKm > 0)) return samples;
  const totalKm = segments[segments.length - 1]!.endKm;
  if (!(totalKm > 0)) return samples;
  const scale = totalKm / distanceKm;
  const out = samples.map((s) => ({ ...s }));
  let j = 0;
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!.km * scale;
    const b = out[i]!.km * scale;
    while (j < segments.length - 1 && segments[j]!.endKm <= a) j++;
    const km = new Map<RoadTier, number>();
    for (let k = j; k < segments.length && segments[k]!.startKm < b; k++) {
      const seg = segments[k]!;
      const overlap = Math.min(b, seg.endKm) - Math.max(a, seg.startKm);
      if (overlap > 0) km.set(seg.tier, (km.get(seg.tier) ?? 0) + overlap);
    }
    let best: RoadTier | undefined;
    for (const [tier, v] of km) if (best == null || v > km.get(best)!) best = tier;
    if (best) out[i]!.roadTier = best;
  }
  return out;
}

/** Vías principales según el resumen de cada tramo ("Ruta 45A, Ruta 66"). */
export function viaOf(route: ProviderRoute): string | undefined {
  const names = route.legs
    .flatMap((l) => (l.summary ?? "").split(","))
    .map((n) => n.trim())
    .filter(Boolean);
  const unique = [...new Set(names)];
  return unique.length ? unique.slice(0, 3).join(", ") : undefined;
}

/** Ruta del proveedor → RawRoute (sin elevación: la agrega el engine de elevación). */
export function toRawRoute(
  route: ProviderRoute,
  meta: { id: string; label: string; noTolls?: boolean },
): RawRoute {
  const distanceKm = route.distanceM / 1000;
  const driveMinutes = route.durationS / 60;
  return {
    id: meta.id,
    label: meta.label,
    via: viaOf(route),
    noTolls: meta.noTolls || undefined,
    geometry: downsample(route.geometry, MAP_GEOMETRY_POINTS),
    samples: applyRoadTiers(
      applySpeedLimits(
        applySegmentSpeeds(
          buildSamples(route.geometry, distanceKm, driveMinutes),
          speedProfile(route),
          distanceKm,
        ),
        route,
        distanceKm,
      ),
      route,
      distanceKm,
    ),
    distanceKm,
    driveMinutes,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
    ...legStops(route, distanceKm),
    ...tunnels(route, distanceKm),
    ...tolls(route, distanceKm),
  };
}

/**
 * Casetas de peaje escaladas a `distanceKm` (el eje de las muestras). Sin casetas, no agrega
 * el campo. Se dejan fuera las que caen a menos de 250 m del origen o del destino: ahí el
 * perfil ya se detiene.
 */
function tolls(route: ProviderRoute, distanceKm: number): Pick<RawRoute, "tollBoothsKm"> {
  const raw = tollBoothsKm(route);
  const totalKm = route.distanceM / 1000;
  if (!raw.length || !(totalKm > 0)) return {};
  const k = distanceKm / totalKm;
  const km = raw.map((x) => x * k).filter((x) => x > 0.25 && x < distanceKm - 0.25);
  return km.length ? { tollBoothsKm: km } : {};
}

/** Túneles escalados a `distanceKm`. Sin túneles, no agrega el campo. */
function tunnels(route: ProviderRoute, distanceKm: number): Pick<RawRoute, "structures"> {
  const raw = tunnelStretchesKm(route);
  const totalKm = route.distanceM / 1000;
  if (!raw.length || !(totalKm > 0)) return {};
  const k = distanceKm / totalKm;
  return {
    structures: raw.map((t) => ({
      kind: "tunnel" as const,
      fromKm: t.fromKm * k,
      toKm: t.toKm * k,
    })),
  };
}

/** Km de los puntos intermedios escalados a `distanceKm` (el eje de las muestras). */
function legStops(route: ProviderRoute, distanceKm: number): { legBoundariesKm?: number[] } {
  const raw = legBoundariesKm(route);
  const legsKm =
    route.legs.reduce(
      (a, l) => a + (l.distanceM ?? (l.steps ?? []).reduce((b, s) => b + s.distanceM, 0)),
      0,
    ) / 1000;
  if (!raw.length || !(legsKm > 0)) return {};
  const k = distanceKm / legsKm;
  return { legBoundariesKm: raw.map((km) => Math.min(distanceKm, km * k)) };
}
