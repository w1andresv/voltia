import type { LatLon, RawRoute } from "@/lib/domain/types";
import { downsample, interpolatePoint, polylineLengthKm } from "@/lib/domain/geo";
import { fetchJson } from "./http";

const OSRM_ENDPOINTS = [
  "https://router.project-osrm.org",
  "https://routing.openstreetmap.de/routed-car",
];

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
}

interface OsrmResponse {
  code: string;
  routes?: OsrmRoute[];
}

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
  let lastErr: unknown;
  for (const base of OSRM_ENDPOINTS) {
    const url = `${base}/route/v1/driving/${path}?${qs}`;
    try {
      const data = await fetchJson<OsrmResponse>(url, {
        timeoutMs: 18000,
        cacheTtlMs: 90_000,
        headers: { "user-agent": "Voltia/1.0 (EV trip planner)" },
      });
      if (data.code !== "Ok" || !data.routes?.length) {
        lastErr = new Error("El motor de rutas no encontró un camino.");
        continue;
      }
      return data.routes.slice(0, 3).map((r, i) => toRaw(r, i, data.routes!.length));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("No se pudo calcular la ruta.");
}
