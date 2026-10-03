import { describe, expect, it, vi } from "vitest";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import { computePlansFromSnapshot } from "@/domain/ev/compute-plan";
import { parsePlanningSnapshot } from "@/domain/ev/contracts/snapshot";
import type { StationDataset } from "@/domain/stations/model";
import type { ProviderRoute } from "@/domain/ev/contracts/route";
import type { RoutingProvider } from "@/domain/ports/routing";
import { ELEVATION_UNAVAILABLE_TEXT, type PlanRequest } from "@/domain/types";
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
  return {
    provider: "fake",
    profile: "driving",
    geometry,
    distanceM: 130_000,
    durationS: (130 / 70) * 3600,
    legs: [],
  };
}

function routing(routes: ProviderRoute[] = [straight()], notice?: string): RoutingProvider {
  return {
    id: "fake",
    label: "Fake",
    engine: "mapbox",
    capabilities: {
      alternatives: false,
      avoidTolls: false,
      avoidPoints: false,
      roadClasses: false,
    },
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
    elevation: {
      id: "fake",
      getElevations: async (points) => points.map((p) => 1000 + 100 * p.lat),
    },
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
    const { response, engine, chargerCount } = await new EVRoutePlanningService(
      deps({ routing: provider }),
    ).plan(request);
    expect(calculateRoutes).toHaveBeenCalledWith({
      waypoints: [request.origin, request.destination],
      alternatives: true,
    });
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
    expect(response.geo.warnings).toContain(ELEVATION_UNAVAILABLE_TEXT);
    expect(response.geo.dataQuality).toEqual({ elevation: "unavailable" });
  });

  it("avisa de fuentes de electrolineras viejas o caídas", async () => {
    const base = syntheticStations();
    const dataset: StationDataset = {
      ...base,
      sources: [
        { id: "siveeic", ok: true, stale: true, records: 1, accepted: 1, rejected: {} },
        {
          id: "osm",
          ok: false,
          stale: false,
          records: 0,
          accepted: 0,
          rejected: {},
          error: "timeout",
        },
      ],
    };
    const { response } = await new EVRoutePlanningService(
      deps({ stations: { getDataset: async () => dataset } }),
    ).plan(request);
    expect(response.geo.warnings).toEqual([
      "aviso de ruta",
      "Electrolineras de siveeic: usando el último dato disponible (fuente lenta o caída).",
      "No se pudo consultar electrolineras de osm.",
    ]);
  });

  it("usa la distancia al corredor de los parámetros del modelo", async () => {
    const narrow = {
      ...MODEL_PARAMETERS,
      corridor: { ...MODEL_PARAMETERS.corridor, maxFromRouteKm: 0.1 },
    };
    const { response } = await new EVRoutePlanningService(deps({ params: narrow })).plan(request);
    expect(response.geo.chargers).toHaveLength(0);
  });

  it("sin rutas no hay planes", async () => {
    const none = deps({ routing: routing([]) });
    const { response } = await new EVRoutePlanningService(none).plan(request);
    expect(response.plans).toEqual([]);
    expect(response.selectedId).toBe("");
  });

  it("modo sombra: responde con el actual y registra las diferencias con v2", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { response } = await new EVRoutePlanningService(deps({ engineMode: "shadow" })).plan(
      request,
    );
    expect(response.geo.plannerEngine).toBe("legacy");
    expect(response.plans.every((p) => p.planner === "legacy")).toBe(true);
    // Fuera de producción: tabla legible.
    const text = log.mock.calls
      .map(([first]) => String(first))
      .find((t) => t.startsWith("[plan-trip:shadow]"));
    expect(text).toContain("Piedecuesta → Vélez · más rápida");
    expect(text).toContain("Elegida: actual");
    log.mockRestore();
  });

  it("modo sombra en producción: JSON de una línea", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { response } = await new EVRoutePlanningService(deps({ engineMode: "shadow" })).plan(
      request,
    );
    const call = log.mock.calls.find(([tag]) => tag === "[plan-trip:shadow]");
    const payload = JSON.parse(String(call![1])) as { routes: unknown[]; mode: string };
    expect(payload.routes).toHaveLength(response.plans.length);
    expect(payload.mode).toBe("fastest");
    log.mockRestore();
    vi.unstubAllEnvs();
  });

  it("modo v2: responde con el planificador nuevo", async () => {
    const { response } = await new EVRoutePlanningService(deps({ engineMode: "v2" })).plan(request);
    expect(response.geo.plannerEngine).toBe("v2");
    expect(response.plans[0]?.feasibilityStatus).toBeDefined();
  });

  it("energía en modo sombra: responde con el modelo actual y registra las diferencias con el v2", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { response } = await new EVRoutePlanningService(deps({ energyMode: "shadow" })).plan(
      request,
    );
    expect(response.geo.energyEngine).toBe("legacy");
    expect(response.plans.every((p) => p.energyEngine === "legacy")).toBe(true);
    const text = log.mock.calls
      .map(([first]) => String(first))
      .find((t) => t.startsWith("[plan-trip:energy-shadow]"));
    expect(text).toContain("Piedecuesta → Vélez");
    expect(text).toMatch(/Energía\s+[\d,]+ → [\d,]+ kWh/);
    expect(text).toContain("Manejo");
    log.mockRestore();
  });

  it("energía en modo sombra en producción: JSON de una línea", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { response } = await new EVRoutePlanningService(deps({ energyMode: "shadow" })).plan(
      request,
    );
    const call = log.mock.calls.find(([tag]) => tag === "[plan-trip:energy-shadow]");
    const payload = JSON.parse(String(call![1])) as {
      routes: { legacy: { kwh: number }; v2: { kwh: number } }[];
    };
    expect(payload.routes).toHaveLength(response.plans.length);
    expect(payload.routes[0]!.v2.kwh).not.toBe(payload.routes[0]!.legacy.kwh);
    log.mockRestore();
    vi.unstubAllEnvs();
  });

  it("energía v2: responde con la física nueva y el navegador la recalcula igual", async () => {
    const { response } = await new EVRoutePlanningService(deps({ energyMode: "v2" })).plan(request);
    expect(response.geo.energyEngine).toBe("v2");
    expect(response.plans.every((p) => p.energyEngine === "v2")).toBe(true);
  });

  it("si la matriz de desvíos falla, los desvíos quedan estimados y el plan sigue", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { response } = await new EVRoutePlanningService(
      deps({
        detourMatrix: {
          id: "fake",
          maxCoordinates: 25,
          matrix: async () => {
            throw new Error("sin cupo");
          },
        },
      }),
    ).plan(request);
    expect(response.geo.detours).toBeUndefined();
    expect(response.plans.length).toBeGreaterThan(0);
    expect(log.mock.calls.some(([l]) => String(l).includes("lote(s) fallaron"))).toBe(true);
    err.mockRestore();
    log.mockRestore();
  });
});

describe("detalle de las paradas (Blaze, ADR-0008)", () => {
  const lowSoc: PlanRequest = { ...request, conditions: { ...request.conditions, initialSoc: 35 } };

  it("sin puerto de detalle no se consulta nada y el plan no cambia", async () => {
    const { response } = await new EVRoutePlanningService(deps()).plan(lowSoc);
    expect(response.plans[0]!.stops.length).toBeGreaterThan(0);
    expect(response.geo.providers.stations).toBe("dataset");
  });

  it("pide el detalle solo de las paradas; una fuera de servicio hace replanificar sin ella", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const before = (await new EVRoutePlanningService(deps()).plan(lowSoc)).response;
    const firstStop = before.plans[0]!.stops[0]!.charger;
    const stopIds = new Set(before.plans[0]!.stops.map((s) => s.charger.id));
    const station = syntheticStations().stations.find((s) => s.id === firstStop.id)!;
    const get = vi.fn(async (id: string) =>
      id === firstStop.id
        ? {
            ...station,
            availability: { value: "offline" as const },
            planning: { eligible: false, reasons: ["Reportada fuera de servicio"] },
          }
        : null,
    );
    const { response } = await new EVRoutePlanningService(
      deps({ stationDetails: { get }, stationSource: "blaze" }),
    ).plan(lowSoc);
    // Primera vuelta: solo las paradas del plan. Segunda: solo las paradas nuevas del plan recalculado.
    const asked = get.mock.calls.map(([id]) => id);
    const newStops = response.plans[0]!.stops.map((s) => s.charger.id).filter(
      (id) => !stopIds.has(id),
    );
    expect(asked.slice(0, stopIds.size).every((id) => stopIds.has(id))).toBe(true);
    expect(new Set(asked.slice(stopIds.size))).toEqual(new Set(newStops));
    expect(new Set(asked).size).toBe(asked.length);
    expect(response.plans[0]!.stops.some((s) => s.charger.id === firstStop.id)).toBe(false);
    expect(response.geo.chargers.find((c) => c.id === firstStop.id)?.availability).toBe("offline");
    expect(response.geo.warnings.some((w) => w.includes(firstStop.name))).toBe(true);
    expect(response.geo.providers.stations).toBe("blaze");
  });

  it("si el detalle falla o no responde, se sigue con el listado", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = (await new EVRoutePlanningService(deps()).plan(lowSoc)).response;
    const { response } = await new EVRoutePlanningService(
      deps({
        stationDetails: {
          get: async () => {
            throw new Error("HTTP 429");
          },
        },
      }),
    ).plan(lowSoc);
    expect(response.plans[0]!.stops.map((s) => s.charger.id)).toEqual(
      before.plans[0]!.stops.map((s) => s.charger.id),
    );
    expect(response.geo.warnings).toEqual(before.geo.warnings);
  });
});

describe("rendimiento y observabilidad (M1, ADR-0020)", () => {
  // SOC bajo: el plan necesita paradas, así que hay pasada 2.
  const lowSoc: PlanRequest = { ...request, conditions: { ...request.conditions, initialSoc: 35 } };

  it("devuelve los milisegundos por fase y lo que hizo el planificador v2", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const out = await new EVRoutePlanningService(deps({ engineMode: "v2", energyMode: "v2" })).plan(
      lowSoc,
    );
    expect(Object.keys(out.timings)).toEqual(
      expect.arrayContaining(["routes", "data", "corridor", "detours", "compute"]),
    );
    expect(Object.values(out.timings).every((ms) => ms >= 0)).toBe(true);
    expect(out.plannerStats.stations).toBeGreaterThan(0);
    expect(out.plannerStats.runs).toBeGreaterThan(0);
    expect(out.plannerStats.expansions).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  it("el modo sombra corre después de responder cuando hay `defer`", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const later: (() => void)[] = [];
    const { response } = await new EVRoutePlanningService(
      deps({ engineMode: "shadow", defer: (work) => later.push(work) }),
    ).plan(request);
    const shadowLogged = () =>
      log.mock.calls.some(([first]) => String(first).startsWith("[plan-trip:shadow]"));
    // La respuesta está lista y la sombra todavía no corrió.
    expect(response.plans.length).toBeGreaterThan(0);
    expect(later).toHaveLength(1);
    expect(shadowLogged()).toBe(false);
    later[0]!();
    expect(shadowLogged()).toBe(true);
    log.mockRestore();
  });

  it("la sombra diferida usa lo calculado, no lo que cambió después", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const later: (() => void)[] = [];
    const { response } = await new EVRoutePlanningService(
      deps({ engineMode: "shadow", defer: (work) => later.push(work) }),
    ).plan(request);
    later.forEach((work) => work());
    const call = log.mock.calls.find(([tag]) => tag === "[plan-trip:shadow]");
    const payload = JSON.parse(String(call![1])) as { routes: unknown[] };
    expect(payload.routes).toHaveLength(response.plans.length);
    log.mockRestore();
    vi.unstubAllEnvs();
  });

  it("pasada 2 con plazo: si se demora, responde con la pasada 1 marcada como fallida", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Las rutas por las paradas (pasada 2, con puntos intermedios) nunca responden.
    const slow: RoutingProvider = {
      ...routing([straight()]),
      calculateRoutes: async (req) =>
        req.waypoints.length > 2
          ? new Promise(() => {})
          : { routes: [straight()], waypointSnapKm: [] },
    };
    const out = await new EVRoutePlanningService(
      deps({
        routing: slow,
        engineMode: "v2",
        energyMode: "v2",
        params: {
          ...MODEL_PARAMETERS,
          planner: { ...MODEL_PARAMETERS.planner, verifyBudgetMs: 40 },
        },
      }),
    ).plan(lowSoc);
    const plan = out.response.plans[0]!;
    expect(plan.stops.length).toBeGreaterThan(0);
    expect(plan.verification?.status).toBe("failed");
    expect(out.response.geo.verifiedRoutes).toBeUndefined();
    expect(out.timings.verify).toBeDefined();
    vi.restoreAllMocks();
  });
});

describe("clima por tramo (M3.1, ADR-0024)", () => {
  const AT = "2026-10-03T14:20:00.000Z";
  const series = (lat: number, lon: number) => ({
    lat,
    lon,
    elevationM: 1000,
    startIso: "2026-10-03T14:00:00.000Z",
    temperatureC: Array.from({ length: 24 }, () => 18),
    windKmh: Array.from({ length: 24 }, () => 12),
    windDirDeg: Array.from({ length: 24 }, () => 200),
    precipitationMm: Array.from({ length: 24 }, (_, h) => (h >= 1 ? 2 : 0)),
  });
  const withAlong = (calls: { points: number; hours: number }[] = []): PlanningDeps["weather"] => ({
    id: "fake",
    current: async () => ({ temperatureC: 20, windKmh: 5, windDirDeg: 0 }),
    along: async (points, hours) => {
      calls.push({ points: points.length, hours });
      return points.map((p) => series(p.lat, p.lon));
    },
  });

  it("con la energía v2 pide el pronóstico por hora a lo largo de cada ruta y lo guarda en el snapshot", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls: { points: number; hours: number }[] = [];
    const out = await new EVRoutePlanningService(
      deps({ weather: withAlong(calls), energyMode: "v2", clock: () => new Date(AT) }),
    ).plan(request);
    const along = out.response.geo.weatherAlong?.["route-0"];
    expect(calls).toEqual([{ points: 4, hours: 24 }]); // 130 km: origen, ~50, ~100 y destino
    expect(along?.departIso).toBe(AT);
    expect(along?.points.map((p) => Math.round(p.km))).toEqual([0, 43, 87, 130]);
    expect(along?.points.every((p) => p.temperatureC.length === 24)).toBe(true);
    // El snapshot lo valida y la huella lo cuenta.
    expect(parsePlanningSnapshot(JSON.parse(JSON.stringify(out.response.geo)))?.weatherAlong).toBeDefined();
    // El plan lo usa: está en sus supuestos y la lluvia de la 2.ª hora moja el tramo final.
    const plan = out.response.plans[0]!;
    expect(plan.assumptions?.some((a) => a.parameter === "energy.weatherAlongRoute")).toBe(true);
    vi.restoreAllMocks();
  });

  it("con la energía anterior no lo pide ni lo guarda", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls: { points: number; hours: number }[] = [];
    const out = await new EVRoutePlanningService(deps({ weather: withAlong(calls) })).plan(request);
    expect(calls).toEqual([]);
    expect(out.response.geo.weatherAlong).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("si el proveedor no responde, el plan sale con el clima de un punto, sin avisos de más", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const before = await new EVRoutePlanningService(
      deps({ energyMode: "v2", clock: () => new Date(AT) }),
    ).plan(request);
    const failing: PlanningDeps["weather"] = {
      id: "fake",
      current: async () => ({ temperatureC: 20, windKmh: 5, windDirDeg: 0 }),
      along: async () => null,
    };
    const out = await new EVRoutePlanningService(
      deps({ weather: failing, energyMode: "v2", clock: () => new Date(AT) }),
    ).plan(request);
    expect(out.response.geo.weatherAlong).toBeUndefined();
    expect(out.response.geo.warnings).toEqual(before.response.geo.warnings);
    expect(out.response.plans[0]!.energyKwh).toBe(before.response.plans[0]!.energyKwh);
    vi.restoreAllMocks();
  });

  it("el navegador recalcula con el snapshot lo mismo que respondió el servidor", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const out = await new EVRoutePlanningService(
      deps({ weather: withAlong(), energyMode: "v2", engineMode: "v2", clock: () => new Date(AT) }),
    ).plan({ ...request, conditions: { ...request.conditions, temperatureC: null } });
    const geo = JSON.parse(JSON.stringify(out.response.geo)) as typeof out.response.geo;
    const { plans } = computePlansFromSnapshot(
      geo,
      { origin: request.origin, destination: request.destination },
      request.vehicle as never,
      { ...request.conditions, temperatureC: null },
    );
    const server = out.response.plans[0]!;
    const client = plans[0]!;
    expect(client.energyKwh).toBeCloseTo(server.energyKwh, 9);
    expect(client.totalMinutes).toBeCloseTo(server.totalMinutes, 9);
    expect(client.stops.map((s) => s.charger.id)).toEqual(server.stops.map((s) => s.charger.id));
    vi.restoreAllMocks();
  });
});
