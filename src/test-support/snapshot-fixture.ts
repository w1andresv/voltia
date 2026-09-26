import type { PlanningSnapshot } from "@/domain/ev/contracts/snapshot";

/** Snapshot mínimo válido: una ruta recta de 10 km y un cargador. */
export function minimalSnapshot(overrides: Partial<PlanningSnapshot> = {}): PlanningSnapshot {
  const samples = [0, 5, 10].map((km) => ({
    km,
    lat: 7 - km / 111,
    lon: -73,
    elevM: 900,
    slopePct: 0,
    speedKmh: 80,
  }));
  return {
    schemaVersion: 1,
    createdAt: "2026-09-01T12:00:00.000Z",
    modelVersion: "0.1.0-legacy",
    plannerEngine: "legacy",
    providers: {
      routing: "mapbox",
      elevation: "open-meteo",
      weather: "open-meteo",
      stations: "dataset",
    },
    routes: [
      {
        id: "route-0",
        label: "Ruta recomendada",
        geometry: samples.map(({ lat, lon }) => ({ lat, lon })),
        samples,
        distanceKm: 10,
        driveMinutes: 8,
        elevation: { gainM: 0, lossM: 0, minM: 900, maxM: 900 },
        engine: "mapbox",
      },
    ],
    chargers: [
      {
        id: "c1",
        name: "Cargador",
        lat: 7 - 5 / 111,
        lon: -73,
        sockets: [{ connector: "ccs2", powerKw: 60, count: 2, current: "DC" }],
        source: "osm",
      },
    ],
    weather: { temperatureC: 22, windKmh: 5, windDirDeg: 180 },
    warnings: [],
    stationsVersion: "v1",
    ...overrides,
  };
}
