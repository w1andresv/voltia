import { haversineKm } from "./geo";
import type { LatLon } from "./types";

/**
 * Jerarquía vial para rutas de carretera.
 *
 * La clase de cada vía sale de la CLASIFICACIÓN DEL PROVEEDOR (Mapbox Streets v8,
 * `intersections[].mapbox_streets_v8.class` en los pasos de Mapbox Directions),
 * nunca de la velocidad ni del número de carriles. En Colombia: trunk/primary ≈
 * red nacional, secondary ≈ departamental, tertiary ≈ terciaria/veredal.
 *
 * Mapbox no deja fijar pesos por clase, así que la preferencia se aplica encima:
 * cada ruta candidata se clasifica, se le calcula un costo con penalización
 * progresiva y, si toma un atajo por vías menores, se pide otra excluyéndolo.
 */
export type RoadTier = "primary" | "secondary" | "tertiary" | "local" | "unpaved" | "unknown";

export const ROAD_TIERS: RoadTier[] = [
  "primary",
  "secondary",
  "tertiary",
  "local",
  "unpaved",
  "unknown",
];

/** Penalización progresiva (multiplica el tiempo del tramo). Primaria > Secundaria > Terciaria > Local. */
export const TIER_FACTOR: Record<RoadTier, number> = {
  primary: 1,
  secondary: 1.3,
  tertiary: 1.8,
  local: 2.5,
  unpaved: 4,
  // Sin dato de clase no se castiga (no se inventa una clasificación).
  unknown: 1,
};

/**
 * Peso de cada km por vía menor FUERA de los accesos, para elegir entre rutas
 * razonables: primero la que menos usa vías menores (Maximizar primarias →
 * minimizar secundarias → evitar terciarias/locales), y solo después la más rápida.
 */
export const MINOR_KM_WEIGHT: Record<RoadTier, number> = {
  primary: 0,
  unknown: 0,
  secondary: 1,
  tertiary: 2.5,
  local: 4,
  unpaved: 6,
};
/** Diferencias de puntaje menores a esto se consideran empate (~2 km de secundaria). */
export const MINOR_SCORE_TIE = 2;

/** Km al inicio y al final de la ruta donde las vías menores son inevitables (acceso). */
export const ENDPOINT_ACCESS_KM = 5;
/** Km alrededor de cada punto intermedio (p. ej. una electrolinera) para llegar y reincorporarse. */
export const WAYPOINT_ACCESS_KM = 12;
/** Un atajo por vías menores se corrige solo si mide al menos esto fuera de las zonas de acceso. */
export const MIN_SHORTCUT_KM = 2;
/** Tolerancia para no desviarse demasiado solo por seguir en vías principales. */
export const MAX_EXTRA_TIME_RATIO = 1.15;
export const MAX_EXTRA_DISTANCE_RATIO = 1.1;

/** Clase de Mapbox Streets v8 → nivel de la jerarquía. */
export function tierOfClass(cls: string | undefined | null): RoadTier {
  switch ((cls ?? "").replace(/_link$/, "")) {
    case "motorway":
    case "trunk":
    case "primary":
      return "primary";
    case "secondary":
      return "secondary";
    case "tertiary":
      return "tertiary";
    case "street":
    case "street_limited":
    case "service":
    case "pedestrian":
    case "path":
    case "residential":
    case "unclassified":
      return "local";
    case "track":
      return "unpaved";
    default:
      return "unknown";
  }
}

/** Tramo de una ruta con una sola clase de vía. */
export interface RoadSegment {
  tier: RoadTier;
  /** Km desde el origen donde empieza y termina el tramo. */
  startKm: number;
  endKm: number;
  durationS: number;
  /** Geometría del tramo (para ubicar un punto a excluir). */
  line: LatLon[];
}

export type RoadMix = Record<RoadTier, number>;

export function emptyMix(): RoadMix {
  return { primary: 0, secondary: 0, tertiary: 0, local: 0, unpaved: 0, unknown: 0 };
}

/** Km por nivel de la jerarquía. */
export function roadMix(segments: RoadSegment[]): RoadMix {
  const mix = emptyMix();
  for (const s of segments) mix[s.tier] += s.endKm - s.startKm;
  return mix;
}

/** Fracción (0–1) de la distancia CLASIFICADA que va por vías primarias. */
export function primaryShare(mix: RoadMix): number {
  const known = mix.primary + mix.secondary + mix.tertiary + mix.local + mix.unpaved;
  return known > 0 ? mix.primary / known : 0;
}

export interface AccessZone {
  fromKm: number;
  toKm: number;
}

/**
 * Zonas donde las vías menores no se castigan: los primeros/últimos 5 km y
 * 12 km antes y después de cada punto intermedio (`waypointKms`).
 */
export function accessZones(totalKm: number, waypointKms: number[] = []): AccessZone[] {
  return [
    { fromKm: 0, toKm: ENDPOINT_ACCESS_KM },
    { fromKm: totalKm - ENDPOINT_ACCESS_KM, toKm: totalKm },
    ...waypointKms.map((km) => ({
      fromKm: km - WAYPOINT_ACCESS_KM,
      toKm: km + WAYPOINT_ACCESS_KM,
    })),
  ];
}

/** Km de [a, b] que caen fuera de todas las zonas de acceso. */
function kmOutsideZones(a: number, b: number, zones: AccessZone[]): number {
  // Se une la cobertura de las zonas dentro de [a, b].
  const parts = zones
    .map((z) => [Math.max(a, z.fromKm), Math.min(b, z.toKm)] as const)
    .filter(([x, y]) => y > x)
    .sort((p, q) => p[0] - q[0]);
  let covered = 0;
  let cursor = a;
  for (const [x, y] of parts) {
    const from = Math.max(x, cursor);
    if (y > from) {
      covered += y - from;
      cursor = y;
    }
  }
  return Math.max(0, b - a - covered);
}

/**
 * Costo de manejo con jerarquía (segundos "equivalentes"): el tiempo de cada
 * tramo × el factor de su clase, salvo dentro de las zonas de acceso (factor 1).
 * Si no hay clasificación, es el tiempo tal cual.
 */
export function hierarchyCostS(segments: RoadSegment[], zones: AccessZone[]): number {
  let cost = 0;
  for (const s of segments) {
    const len = s.endKm - s.startKm;
    if (len <= 0) {
      cost += s.durationS;
      continue;
    }
    const outside = kmOutsideZones(s.startKm, s.endKm, zones);
    const penalizedShare = outside / len;
    cost += s.durationS * (1 + (TIER_FACTOR[s.tier] - 1) * penalizedShare);
  }
  return cost;
}

/** Puntaje de vías menores (km ponderados fuera de los accesos). 0 = todo por vías principales. */
export function minorRoadScore(segments: RoadSegment[], zones: AccessZone[]): number {
  let score = 0;
  for (const s of segments) {
    const w = MINOR_KM_WEIGHT[s.tier];
    if (w > 0) score += w * kmOutsideZones(s.startKm, s.endKm, zones);
  }
  return score;
}

/**
 * Orden por jerarquía entre rutas que ya están dentro de la tolerancia:
 * menos vías menores primero; si empatan (< 2 puntos), menor costo/tiempo.
 */
export function compareByHierarchy(
  a: { minorScore?: number; cost: number },
  b: { minorScore?: number; cost: number },
): number {
  const ma = a.minorScore ?? 0;
  const mb = b.minorScore ?? 0;
  if (Math.abs(ma - mb) >= MINOR_SCORE_TIE) return ma - mb;
  return a.cost - b.cost;
}

export interface Shortcut {
  tier: RoadTier;
  km: number;
  /** Punto sobre el atajo (su mitad) para pedir la ruta excluyéndolo. */
  point: LatLon;
}

const TIER_RANK: Record<RoadTier, number> = {
  primary: 0,
  unknown: 0,
  secondary: 1,
  tertiary: 2,
  local: 3,
  unpaved: 4,
};

/**
 * Tramos por vías secundarias, terciarias, locales o destapadas FUERA de las
 * zonas de acceso y de al menos 2 km: son los "atajos" a corregir. Se devuelven
 * los peores primero (clase más baja, luego más largos).
 */
export function findShortcuts(
  segments: RoadSegment[],
  zones: AccessZone[],
  minKm = MIN_SHORTCUT_KM,
): Shortcut[] {
  const out: Shortcut[] = [];
  let run: RoadSegment[] = [];
  const flush = () => {
    if (!run.length) return;
    const from = run[0]!.startKm;
    const to = run[run.length - 1]!.endKm;
    const km = kmOutsideZones(from, to, zones);
    if (km >= minKm) {
      const worst = run.reduce((w, s) => (TIER_RANK[s.tier] > TIER_RANK[w.tier] ? s : w), run[0]!);
      const line = run.flatMap((s) => s.line);
      out.push({ tier: worst.tier, km, point: midpointOf(line) });
    }
    run = [];
  };
  for (const s of segments) {
    if (TIER_RANK[s.tier] > 0) run.push(s);
    else flush();
  }
  flush();
  return out.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.km - a.km);
}

/** Punto de la polilínea a mitad de su longitud (un vértice real, sobre la vía). */
export function midpointOf(line: LatLon[]): LatLon {
  if (line.length === 0) return { lat: 0, lon: 0 };
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineKm(line[i - 1]!, line[i]!);
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    acc += haversineKm(line[i - 1]!, line[i]!);
    if (acc >= total / 2) return line[i]!;
  }
  return line[Math.floor(line.length / 2)]!;
}

/** "84 % principal · 12 % secundaria · 4 % local" (solo niveles con ≥ 1 %). */
export function formatRoadMix(mix: RoadMix): string {
  const known = mix.primary + mix.secondary + mix.tertiary + mix.local + mix.unpaved;
  if (known <= 0) return "";
  const labels: [RoadTier, string][] = [
    ["primary", "principal"],
    ["secondary", "secundaria"],
    ["tertiary", "terciaria"],
    ["local", "local"],
    ["unpaved", "destapada"],
  ];
  return labels
    .map(([t, label]) => [Math.round((mix[t] / known) * 100), label] as const)
    .filter(([pct]) => pct >= 1)
    .map(([pct, label]) => `${pct} % ${label}`)
    .join(" · ");
}
