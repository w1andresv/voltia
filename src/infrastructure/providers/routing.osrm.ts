import { z } from "zod";
import type { LatLon, RawRoute } from "@/domain/types";
import { downsample, interpolatePoint, polylineLengthKm } from "@/domain/geo";
import { fetchJson } from "./http";

const OSRM_ENDPOINTS = [
  "https://router.project-osrm.org",
  "https://routing.openstreetmap.de/routed-car",
];

/**
 * Se valida la respuesta de OSRM con Zod (no solo se le hace `as OsrmResponse`)
 * para que un cambio de forma en su API se note como un error claro acá, en
 * vez de romper el planificador en silencio con `undefined`s más adelante.
 */
export const OsrmRouteSchema = z.object({
  distance: z.number(),
  duration: z.number(),
  geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) }),
  legs: z
    .array(
      z
        .object({
          summary: z.string().optional(),
          distance: z.number().optional(),
          // Con annotations=distance,duration: metros y segundos entre cada par de
          // puntos de la geometría. De ahí sale la velocidad de cada tramo.
          annotation: z
            .object({
              distance: z.array(z.number()).optional(),
              duration: z.array(z.number()).optional(),
            })
            .passthrough()
            .optional(),
          // Solo con steps=true (Mapbox): cada paso con su geometría y sus intersecciones,
          // que traen la clase vial del proveedor (mapbox_streets_v8.class).
          steps: z
            .array(
              z
                .object({
                  distance: z.number(),
                  duration: z.number(),
                  geometry: z
                    .object({ coordinates: z.array(z.tuple([z.number(), z.number()])) })
                    .optional(),
                  intersections: z
                    .array(
                      z
                        .object({
                          location: z.tuple([z.number(), z.number()]),
                          mapbox_streets_v8: z
                            .object({ class: z.string().optional() })
                            .passthrough()
                            .optional(),
                        })
                        .passthrough(),
                    )
                    .optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    )
    .optional(),
});

export const OsrmResponseSchema = z.object({
  code: z.string(),
  routes: z.array(OsrmRouteSchema).optional(),
  /** Punto de la vía donde el motor "pegó" cada coordenada; `distance` = metros hasta ella. */
  waypoints: z
    .array(z.object({ distance: z.number().optional(), name: z.string().optional() }).passthrough())
    .optional(),
});

export type OsrmRoute = z.infer<typeof OsrmRouteSchema>;
type OsrmResponse = z.infer<typeof OsrmResponseSchema>;

/** Distancia (km) y tiempo (s) acumulados a lo largo de la ruta, según el motor. */
export interface SpeedProfile {
  cumKm: number[];
  cumS: number[];
}

/**
 * Perfil de tiempo de la ruta: primero las anotaciones por par de puntos
 * (annotations=distance,duration); si no vienen, los pasos (steps=true de
 * Mapbox). Sin ninguno de los dos, null y se usa la velocidad media.
 */
export function speedProfile(route: OsrmRoute): SpeedProfile | null {
  const pieces: [number, number][] = [];
  for (const leg of route.legs ?? []) {
    const d = leg.annotation?.distance;
    const t = leg.annotation?.duration;
    if (d?.length && t?.length === d.length) {
      d.forEach((m, i) => pieces.push([m, t[i]!]));
    } else if (leg.steps?.length) {
      for (const st of leg.steps) pieces.push([st.distance, st.duration]);
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

/** Límites de la velocidad de un tramo tomada del motor de rutas, km/h. */
const SEGMENT_SPEED_MIN = 8;
const SEGMENT_SPEED_MAX = 130;

/**
 * Velocidad de cada muestra = distancia / tiempo del motor entre la muestra
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

function buildSamples(
  coords: [number, number][],
  distanceKm: number,
  durationMin: number,
): RawRoute["samples"] {
  const points: LatLon[] = coords.map(([lon, lat]) => ({ lat, lon }));
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

/** Vías principales según el resumen de cada tramo ("Ruta 45A, Ruta 66"). */
function viaOf(route: OsrmRoute): string | undefined {
  const names = (route.legs ?? [])
    .flatMap((l) => (l.summary ?? "").split(","))
    .map((n) => n.trim())
    .filter(Boolean);
  const unique = [...new Set(names)];
  return unique.length ? unique.slice(0, 3).join(", ") : undefined;
}

/** Una ruta en formato OSRM (también lo usa Mapbox Directions) → RawRoute. */
export function toRawRoute(
  route: OsrmRoute,
  meta: { id: string; label: string; noTolls?: boolean },
): RawRoute {
  const coords = route.geometry.coordinates;
  const distanceKm = route.distance / 1000;
  const driveMinutes = route.duration / 60;
  return {
    id: meta.id,
    label: meta.label,
    via: viaOf(route),
    noTolls: meta.noTolls || undefined,
    geometry: downsample(
      coords.map(([lon, lat]) => ({ lat, lon })),
      420,
    ),
    samples: applySegmentSpeeds(
      buildSamples(coords, distanceKm, driveMinutes),
      speedProfile(route),
      distanceKm,
    ),
    distanceKm,
    driveMinutes,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

/** Servidores públicos de OSRM: sin llave, pero con datos y tiempos menos precisos que Mapbox. */
export async function fetchOsrmCandidates(waypoints: LatLon[]): Promise<OsrmRoute[]> {
  if (waypoints.length < 2) throw new Error("Se necesitan origen y destino.");
  const path = waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
  // alternatives=3: hasta 3 alternativas además de la principal (solo con 2 puntos).
  const qs = `overview=full&geometries=geojson&alternatives=${waypoints.length === 2 ? 3 : "false"}&steps=false&annotations=distance,duration`;
  // Si algún endpoint SÍ respondió pero sin ruta (código != "Ok"), ese es el
  // mensaje más útil para el usuario; un timeout/red caída da un mensaje
  // técnico en inglés que nunca debe llegarle así, así que solo se usa
  // cuando ningún endpoint llegó a responder.
  let noRouteFound = false;
  for (const base of OSRM_ENDPOINTS) {
    const url = `${base}/route/v1/driving/${path}?${qs}`;
    try {
      const raw = await fetchJson<unknown>(url, {
        timeoutMs: 18000,
        cacheTtlMs: 90_000,
        headers: { "user-agent": "Voltia/1.0 (EV trip planner)" },
      });
      const data: OsrmResponse = OsrmResponseSchema.parse(raw);
      if (data.code !== "Ok" || !data.routes?.length) {
        noRouteFound = true;
        continue;
      }
      return data.routes;
    } catch {
      // red o timeout — se intenta el siguiente endpoint
    }
  }
  throw new Error(
    noRouteFound
      ? "El motor de rutas no encontró un camino entre esos puntos."
      : "No se pudo calcular la ruta. Intenta de nuevo en unos segundos.",
  );
}
