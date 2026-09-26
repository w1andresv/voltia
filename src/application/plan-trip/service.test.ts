import { describe, expect, it, vi } from "vitest";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import type { StationDataset } from "@/domain/stations/model";
import type { ProviderRoute } from "@/domain/ev/contracts/route";
import type { RoutingProvider } from "@/domain/ports/routing";
import type { PlanRequest } from "@/domain/types";
import { catalogVehicle } from "@/test-support/scenarios";
import { syntheticStations } from "@/test-support/synthetic-providers";
import { EVRoutePlanningService, type PlanningDeps } from "./service";

/** Ruta recta de Piedecuesta a Vélez, un punto cada ~1 km, a 70 km/h. */
function straight(): ProviderRoute {
  const n = 130;
  const geometry = Array.from({ length: n + 1 }, (_, i) => ({
    lat: 6.9877 - (i / n) * 0.977,
    lon: -73.0495 - (i / n) * 0.624,
  }));
  return { provider: "fake", profile: "driving", geometry, distanceM: 130_000, durationS: (130 / 70) * 3600, legs: [] };
}

function routing(routes: ProviderRoute[] = [straight()], notice?: string): RoutingProvider {
  return {
    id: "fake",
    label: "Fake",
    engine: "mapbox",
    capabilities: { alternatives: false, avoidTolls: false, avoidPoints: false, roadClasses: false },
    notice,
    calculateRoutes: async () => ({ routes, waypointSnapKm: [] }),
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
    routing: routing([straight()], "aviso de ruta"),
    elevation: { id: "fake", getElevations: async (points) => points.map((p) => 1000 + 100 * p.lat) },
    weather: { id: "fake", current: async () => ({ temperatureC: 20, windKmh: 5, windDirDeg: 0 }) },
    stations: { getDataset: async () => syntheticStations() },
    params: MODEL_PARAMETERS,
    engineMode: "legacy",
    ...overrides,
  };
}

describe("EVRoutePlanningService", () => {
  it("compone el plan con los puertos y conserva los avisos de la ruta", async () => {
    const provider = routing([straight()], "aviso de ruta");
    const calculateRoutes = vi.spyOn(provider, "calculateRoutes");
    const { response, engine, chargerCount } = await new EVRoutePlanningService(deps({ routing: provider })).plan(request);
    expect(calculateRoutes).toHaveBeenCalledWith({ waypoints: [request.origin, request.destination], alternatives: true });
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

  it("aplica la elevación del proveedor a las muestras", async () => {
    const { response } = await new EVRoutePlanningService(deps()).plan(request);
    const route = response.geo.routes[0]!;
    expect(route.elevation.maxM).toBeGreaterThan(route.elevation.minM);
    expect(route.samples.every((s) => s.elevM > 1000)).toBe(true);
  });

  it("si el proveedor de elevación falla, la ruta sigue plana y el plan lo avisa", async () => {
    const failing = deps({
      elevation: {
        id: "fake",
        getElevations: async () => {
          throw new Error("caído");
        },
      },
    });
    const { response } = await new EVRoutePlanningService(failing).plan(request);
    expect(response.geo.routes[0]!.elevation).toEqual({ gainM: 0, lossM: 0, minM: 0, maxM: 0 });
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
    const none = deps({ routing: routing([]) });
    const { response } = await new EVRoutePlanningService(none).plan(request);
    expect(response.plans).toEqual([]);
    expect(response.selectedId).toBe("");
  });
});
