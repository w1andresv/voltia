/**
 * Proveedores sintéticos y deterministas para tests del pipeline sin red:
 * respuestas con la forma de Mapbox Directions y Open-Meteo, y estaciones
 * consolidadas a lo largo de la ruta. No pretenden ser realistas, solo
 * ejercitar el camino completo (alternativas, sin peajes, elevación, clima,
 * corredor y paradas) con datos fijos.
 */
import { haversineKm } from "@/domain/geo";
import type { ConsolidatedStation, StationDataset } from "@/domain/stations/model";
import type { LatLon } from "@/domain/types";

export const SYNTHETIC_A: LatLon = { lat: 6.9877, lon: -73.0495 }; // Piedecuesta
export const SYNTHETIC_B: LatLon = { lat: 6.0106, lon: -73.6734 }; // Vélez
/** Con forma de token de Mapbox para que la ruta vaya por Mapbox. */
export const SYNTHETIC_TOKEN = "pk.synthetic.token";

const POINTS = 240;

function pointAt(t: number, bend: number): LatLon {
  const lat = SYNTHETIC_A.lat + (SYNTHETIC_B.lat - SYNTHETIC_A.lat) * t;
  const lon = SYNTHETIC_A.lon + (SYNTHETIC_B.lon - SYNTHETIC_A.lon) * t + bend * Math.sin(Math.PI * t);
  return { lat, lon };
}

/** Velocidad típica del tramo: más lenta en la mitad (zona de montaña). */
function speedKmhAt(t: number): number {
  return 75 - 35 * Math.sin(Math.PI * t) ** 2;
}

function mapboxRoute(bend: number, summary: string, minorFrom = -1, minorTo = -1) {
  const pts = Array.from({ length: POINTS }, (_, i) => pointAt(i / (POINTS - 1), bend));
  const distance: number[] = [];
  const duration: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const m = haversineKm(pts[i - 1]!, pts[i]!) * 1000;
    distance.push(m);
    duration.push(m / ((speedKmhAt(i / (POINTS - 1)) * 1000) / 3600));
  }
  const totalM = distance.reduce((a, b) => a + b, 0);
  const totalS = duration.reduce((a, b) => a + b, 0);
  const intersections = pts
    .filter((_, i) => i % 20 === 0)
    .map((p, k) => {
      const i = k * 20;
      const cls = i >= minorFrom && i <= minorTo ? "tertiary" : "primary";
      return { location: [p.lon, p.lat] as [number, number], mapbox_streets_v8: { class: cls } };
    });
  return {
    distance: totalM,
    duration: totalS,
    geometry: { coordinates: pts.map((p) => [p.lon, p.lat] as [number, number]) },
    legs: [
      {
        summary,
        distance: totalM,
        annotation: { distance, duration },
        steps: [
          {
            distance: totalM,
            duration: totalS,
            geometry: { coordinates: pts.map((p) => [p.lon, p.lat] as [number, number]) },
            intersections,
          },
        ],
      },
    ],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function elevationAt(lat: number, lon: number): number {
  return 900 + 700 * Math.sin(lat * 9) + 300 * Math.cos(lon * 7);
}

type FetchInput = Parameters<typeof fetch>[0];

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** `fetch` que responde como Mapbox y Open-Meteo. Cualquier otra petición falla. */
export function syntheticFetch(): typeof fetch {
  return async (input) => {
    const url = new URL(urlOf(input));
    if (url.hostname === "api.mapbox.com" && url.pathname.startsWith("/directions/")) {
      const exclude = url.searchParams.get("exclude") ?? "";
      if (exclude.includes("toll")) {
        return json({ code: "Ok", routes: [mapboxRoute(0.3, "Ruta 45A")], waypoints: [{ distance: 20 }, { distance: 40 }] });
      }
      if (exclude.includes("point(")) {
        return json({ code: "Ok", routes: [mapboxRoute(-0.05, "Ruta 45A, Ruta 62")] });
      }
      return json({
        code: "Ok",
        routes: [mapboxRoute(0, "Ruta 45A, Ruta 62", 100, 140), mapboxRoute(-0.35, "Ruta 66")],
        waypoints: [{ distance: 20 }, { distance: 40 }],
      });
    }
    if (url.hostname === "api.open-meteo.com" && url.pathname === "/v1/elevation") {
      const lats = (url.searchParams.get("latitude") ?? "").split(",").map(Number);
      const lons = (url.searchParams.get("longitude") ?? "").split(",").map(Number);
      return json({ elevation: lats.map((lat, i) => elevationAt(lat, lons[i]!)) });
    }
    if (url.hostname === "api.open-meteo.com" && url.pathname === "/v1/forecast") {
      return json({ elevation: 1200, current: { temperature_2m: 22, wind_speed_10m: 12, wind_direction_10m: 200 } });
    }
    throw new Error(`Petición no simulada: ${url.hostname}${url.pathname}`);
  };
}

function station(id: string, p: LatLon, powerKw: number, standard: "ccs2" | "type2" | "gb_t" = "ccs2"): ConsolidatedStation {
  return {
    id,
    name: `Estación ${id}`,
    aliases: [],
    lat: p.lat,
    lon: p.lon,
    coordSource: "osm",
    services: [],
    availability: { value: "unknown" },
    connectors: [
      {
        standard,
        rawLabel: standard,
        quantity: 2,
        powerKw,
        current: standard === "type2" ? "AC" : "DC",
        currentOrigin: "standard",
        voltageV: null,
        amperageA: null,
        status: "unknown",
        confirmed: true,
        sources: ["osm"],
      },
    ],
    sources: [{ source: "osm", externalId: id, fetchedAt: "2026-09-01T00:00:00Z" }],
    attributes: {},
    conflicts: [],
    planning: { eligible: true, reasons: [] },
  };
}

/** Estaciones cerca de la ruta principal (y una lejana que el corredor debe descartar). */
export function syntheticStations(): StationDataset {
  const near = (t: number, dLon: number): LatLon => {
    const p = pointAt(t, 0);
    return { lat: p.lat, lon: p.lon + dLon };
  };
  const stations = [
    station("s20", near(0.2, 0.01), 60),
    station("s35", near(0.35, 0.03), 22, "type2"),
    station("s45", near(0.45, 0.02), 120),
    station("s60", near(0.6, 0.05), 50, "gb_t"),
    station("s72", near(0.72, 0.005), 150),
    station("far", { lat: 4.6, lon: -74.08 }, 150),
  ];
  return {
    version: "synthetic-1",
    generatedAt: "2026-09-01T00:00:00Z",
    stations,
    sources: [{ id: "osm", ok: true, stale: false, records: stations.length, accepted: stations.length, rejected: {} }],
    stats: { raw: stations.length, valid: stations.length, stations: stations.length, merged: 0, eligible: stations.length },
  };
}
