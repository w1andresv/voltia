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
const OsrmRouteSchema = z.object({
  distance: z.number(),
  duration: z.number(),
  geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) }),
});

const OsrmResponseSchema = z.object({
  code: z.string(),
  routes: z.array(OsrmRouteSchema).optional(),
});

type OsrmRoute = z.infer<typeof OsrmRouteSchema>;
type OsrmResponse = z.infer<typeof OsrmResponseSchema>;

function buildSamples(coords: [number, number][], distanceKm: number, durationMin: number): RawRoute["samples"] {
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

function toRaw(route: OsrmRoute, index: number, total: number): RawRoute {
  const coords = route.geometry.coordinates;
  const distanceKm = route.distance / 1000;
  const driveMinutes = route.duration / 60;
  const samples = buildSamples(coords, distanceKm, driveMinutes);
  const geometry = downsample(
    coords.map(([lon, lat]) => ({ lat, lon })),
    420,
  );
  const labels = ["Ruta A", "Ruta B", "Ruta C"];
  return {
    id: `route-${index}`,
    label: total > 1 ? (labels[index] ?? `Ruta ${index + 1}`) : "Ruta recomendada",
    geometry,
    samples,
    distanceKm,
    driveMinutes,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

export async function fetchRoutes(waypoints: LatLon[]): Promise<RawRoute[]> {
  if (waypoints.length < 2) throw new Error("Se necesitan origen y destino.");
  const path = waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
  const qs = "overview=full&geometries=geojson&alternatives=true&steps=false";
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
      return data.routes.slice(0, 3).map((r, i) => toRaw(r, i, data.routes!.length));
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
