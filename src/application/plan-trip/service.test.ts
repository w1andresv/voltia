import { describe, expect, it, vi } from "vitest";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import type { StationDataset } from "@/domain/stations/model";
import type { PlanRequest, RawRoute } from "@/domain/types";
import { catalogVehicle } from "@/test-support/scenarios";
import { syntheticStations } from "@/test-support/synthetic-providers";
import { EVRoutePlanningService, type PlanningDeps } from "./service";

function straight(distanceKm: number, elevM = 0): RawRoute {
  const n = Math.round(distanceKm / 2) + 1;
  const samples = Array.from({ length: n }, (_, i) => {
    const km = Math.min(distanceKm, i * 2);
    return { km, lat: 6.9877 - (km / distanceKm) * 0.977, lon: -73.0495 - (km / distanceKm) * 0.624, elevM, slopePct: 0, speedKmh: 70 };
  });
  return {
    id: "route-0",
    label: "Ruta recomendada",
    geometry: samples.map((s) => ({ lat: s.lat, lon: s.lon })),
    samples,
    distanceKm,
    driveMinutes: (distanceKm / 70) * 60,
    elevation: { gainM: 0, lossM: 0, minM: elevM, maxM: elevM },
    engine: "mapbox",
  };
}

const request: PlanRequest = {
  origin: { label: "Piedecuesta", lat: 6.9877, lon: -73.0495 },
  destination: { label: "Vélez", lat: 6.0106, lon: -73.6734 },
  waypoints: [],
  vehicle: catalogVehicle("mg-s5-ev-deluxe"),
  conditions: {
    passengers: 1,
    luggageKg: 30,
    initialSoc: 80,
    arrivalSoc: 10,
    avgSpeedKmh: null,
    ac: "normal",
    temperatureC: 25,
    drivingStyle: "normal",
    safetyMode: "low",
    customSafetyPct: 10,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenLevel: "medium",
  },
};

function deps(overrides: Partial<PlanningDeps> = {}): PlanningDeps {
  return {
    routing: { id: "fake", routes: async () => ({ routes: [straight(130, 1000)], engine: "mapbox", warnings: ["aviso de ruta"] }) },
    elevation: { id: "fake", applyTo: async (routes) => routes },
    weather: { id: "fake", current: async () => ({ temperatureC: 20, windKmh: 5, windDirDeg: 0 }) },
    stations: { getDataset: async () => syntheticStations() },
    params: MODEL_PARAMETERS,
    engineMode: "legacy",
    ...overrides,
  };
}

describe("EVRoutePlanningService", () => {
  it("compone el plan con los puertos y conserva los avisos de la ruta", async () => {
    const routes = vi.fn(deps().routing.routes);
    const { response, engine, chargerCount } = await new EVRoutePlanningService(deps({ routing: { id: "fake", routes } })).plan(request);
    expect(routes).toHaveBeenCalledWith([request.origin, request.destination]);
    expect(engine).toBe("mapbox");
    expect(response.geo.warnings).toEqual(["aviso de ruta"]);
    expect(response.geo.weather?.temperatureC).toBe(20);
    expect(response.geo.stationsVersion).toBe("synthetic-1");
    expect(chargerCount).toBe(response.geo.chargers.length);
    expect(response.geo.chargers.some((c) => c.id === "far")).toBe(false);
    expect(response.plans).toHaveLength(1);
    expect(response.selectedId).toBe("route-0");
  });

  it("sin proveedor de clima, el plan sale sin clima", async () => {
    const { response } = await new EVRoutePlanningService(deps({ weather: null })).plan(request);
    expect(response.geo.weather).toBeNull();
  });

  it("avisa si la elevación no llegó (ruta plana a 0 m)", async () => {
    const flat = deps({
      routing: { id: "fake", routes: async () => ({ routes: [straight(130, 0)], engine: "mapbox", warnings: [] }) },
    });
    const { response } = await new EVRoutePlanningService(flat).plan(request);
    expect(response.geo.warnings).toContain("No se obtuvo el perfil de elevación. El consumo puede estar subestimado en montaña.");
  });

  it("avisa de fuentes de electrolineras viejas o caídas", async () => {
    const base = syntheticStations();
    const dataset: StationDataset = {
      ...base,
      sources: [
        { id: "siveeic", ok: true, stale: true, records: 1, accepted: 1, rejected: {} },
        { id: "osm", ok: false, stale: false, records: 0, accepted: 0, rejected: {}, error: "timeout" },
      ],
    };
    const { response } = await new EVRoutePlanningService(deps({ stations: { getDataset: async () => dataset } })).plan(request);
    expect(response.geo.warnings).toEqual([
      "aviso de ruta",
      "Electrolineras de siveeic: usando el último dato disponible (fuente lenta o caída).",
      "No se pudo consultar electrolineras de osm.",
    ]);
  });

  it("usa la distancia al corredor de los parámetros del modelo", async () => {
    const narrow = { ...MODEL_PARAMETERS, corridor: { ...MODEL_PARAMETERS.corridor, maxFromRouteKm: 0.5 } };
    const { response } = await new EVRoutePlanningService(deps({ params: narrow })).plan(request);
    expect(response.geo.chargers).toHaveLength(0);
  });

  it("sin rutas no hay planes", async () => {
    const none = deps({ routing: { id: "fake", routes: async () => ({ routes: [], engine: "mapbox", warnings: [] }) } });
    const { response } = await new EVRoutePlanningService(none).plan(request);
    expect(response.plans).toEqual([]);
    expect(response.selectedId).toBe("");
  });
});
