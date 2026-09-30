import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import {
  SYNTHETIC_A,
  SYNTHETIC_B,
  syntheticFetch,
  syntheticStations,
} from "@/test-support/synthetic-providers";
import type { PlanRequest } from "@/domain/types";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

const request: PlanRequest = {
  origin: { label: "A", ...SYNTHETIC_A },
  destination: { label: "B", ...SYNTHETIC_B },
  waypoints: [],
  vehicle: catalogVehicle("mg-s5-ev-deluxe"),
  conditions: {
    passengers: 0,
    luggageKg: 0,
    initialSoc: 90,
    avgSpeedKmh: null,
    ac: "off",
    temperatureC: 20,
    drivingStyle: "normal",
    safetyMode: "normal",
    customSafetyPct: 15,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenLevel: "medium",
  },
};

describe("createPlanningService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", syntheticFetch());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("con token de Mapbox usa Mapbox", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.synthetic.token");
    const { createPlanningService } = await import("./container");
    const { engine } = await createPlanningService({
      stations: { getDataset: async () => syntheticStations() },
    }).plan(request);
    expect(engine).toBe("mapbox");
  });

  it("sin token usa OSRM", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(syntheticFetch());
    vi.stubGlobal("fetch", fetchMock);
    const { createPlanningService } = await import("./container");
    // El fetch simulado no responde a OSRM: falla, pero la petición confirma que fue a OSRM y no a Mapbox.
    await expect(
      createPlanningService({ stations: { getDataset: async () => syntheticStations() } }).plan(
        request,
      ),
    ).rejects.toThrow();
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes("router.project-osrm.org"))).toBe(true);
    expect(urls.some((u) => u.includes("api.mapbox.com"))).toBe(false);
  });

  it("PLANNER_ENGINE elige el planificador que responde", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.synthetic.token");
    vi.stubEnv("PLANNER_ENGINE", "v2");
    const { createPlanningService } = await import("./container");
    const { response } = await createPlanningService({
      stations: { getDataset: async () => syntheticStations() },
    }).plan(request);
    expect(response.geo.plannerEngine).toBe("v2");
    expect(response.plans.every((p) => p.planner === "v2")).toBe(true);
  });

  it("ENERGY_ENGINE elige el modelo de energía (inválido = legacy)", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.synthetic.token");
    vi.stubEnv("ENERGY_ENGINE", "v2");
    const { createPlanningService } = await import("./container");
    const { response } = await createPlanningService({
      stations: { getDataset: async () => syntheticStations() },
    }).plan(request);
    expect(response.geo.energyEngine).toBe("v2");
    vi.resetModules();
    vi.stubEnv("ENERGY_ENGINE", "otro");
    const again = await (
      await import("./container")
    )
      .createPlanningService({
        stations: { getDataset: async () => syntheticStations() },
      })
      .plan(request);
    expect(again.response.geo.energyEngine).toBe("legacy");
  });

  it("el geocodificador busca y hace geocodificación inversa", async () => {
    const { createGeocoder } = await import("./container");
    const geocoder = createGeocoder();
    expect(typeof geocoder.search).toBe("function");
    expect(typeof geocoder.reverse).toBe("function");
  });
});

describe("elevationDeps (ELEVATION_SOURCE)", () => {
  it("por defecto, Open-Meteo con la estrategia fija y sin respaldo", async () => {
    const { elevationDeps } = await import("./container");
    const d = elevationDeps("open-meteo", "pk.a.b");
    expect(d.elevation.id).toBe("open-meteo");
    expect(d.elevationSampling).toBe("fixed");
    expect(d.elevationFallback).toBeUndefined();
  });

  it("adaptativa sobre Open-Meteo, con respaldo fijo", async () => {
    const { elevationDeps } = await import("./container");
    const d = elevationDeps("open-meteo-adaptive", "");
    expect([d.elevation.id, d.elevationSampling, d.elevationFallback?.id]).toEqual([
      "open-meteo",
      "adaptive",
      "open-meteo",
    ]);
  });

  it("teselas de Mapbox con malla y respaldo en Open-Meteo; sin token, la de siempre", async () => {
    const { elevationDeps } = await import("./container");
    const d = elevationDeps("mapbox-terrain", "pk.a.b");
    expect([d.elevation.id, d.elevationSampling, d.elevationFallback?.id]).toEqual([
      "mapbox-terrain",
      "mesh",
      "open-meteo",
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(elevationDeps("mapbox-terrain", "").elevationSampling).toBe("fixed");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("ELEVATION_SOURCE de extremo a extremo (proveedores sintéticos)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.synthetic.token");
    vi.stubGlobal("fetch", syntheticFetch());
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("open-meteo-adaptive: más puntos y el snapshot lo dice", async () => {
    vi.stubEnv("ELEVATION_SOURCE", "open-meteo-adaptive");
    const { createPlanningService } = await import("./container");
    const { response } = await createPlanningService({
      stations: { getDataset: async () => syntheticStations() },
    }).plan(request);
    expect((response.geo as { providers: { elevation: string } }).providers.elevation).toBe(
      "open-meteo/adaptive",
    );
    expect(response.geo.routes[0]!.elevation.maxM).toBeGreaterThan(0);
  });

  it("mapbox-terrain que falla cae a open-meteo, y el snapshot guarda la usada", async () => {
    vi.stubEnv("ELEVATION_SOURCE", "mapbox-terrain");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { createPlanningService } = await import("./container");
    // Las teselas fallan (401): el principal cae a Open-Meteo.
    const base = syntheticFetch();
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).includes(".pngraw")
        ? new Response("Unauthorized", { status: 401 })
        : base(input, init),
    );
    const { response } = await createPlanningService({
      stations: { getDataset: async () => syntheticStations() },
    }).plan(request);
    expect((response.geo as { providers: { elevation: string } }).providers.elevation).toBe(
      "open-meteo",
    );
    expect(response.geo.routes[0]!.elevation.maxM).toBeGreaterThan(0);
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[elevation]"));
    expect(line).toMatch(/falló el principal/);
  });
});

describe("fuente de electrolineras (Blaze solo con v2, ADR-0008)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("v1 y sombra: dataset consolidado; v2 con key: Blaze", async () => {
    const { stationSourceOf } = await import("./container");
    expect(stationSourceOf("legacy", { BLAZE_API_KEY: "blz_x" })).toBe("legacy");
    expect(stationSourceOf("shadow", { BLAZE_API_KEY: "blz_x" })).toBe("legacy");
    expect(stationSourceOf("v2", { BLAZE_API_KEY: "blz_x" })).toBe("blaze");
  });

  it("v2 sin key: dataset consolidado y aviso", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stationSourceOf } = await import("./container");
    expect(stationSourceOf("v2", { BLAZE_API_KEY: "" })).toBe("legacy");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sin BLAZE_API_KEY"));
    warn.mockRestore();
  });

  it("el listado sigue al motor elegido; sin elección, al del servidor", async () => {
    vi.stubEnv("BLAZE_API_KEY", "blz_x");
    const { createStationCatalog } = await import("./container");
    const { BlazeStationCatalog } = await import("@/infrastructure/blaze/catalog");
    const { DatasetStationCatalog } = await import("@/infrastructure/stations/catalog.adapter");
    expect(createStationCatalog("v2")).toBeInstanceOf(BlazeStationCatalog);
    expect(createStationCatalog("v1")).toBeInstanceOf(DatasetStationCatalog);
    expect(createStationCatalog()).toBeInstanceOf(DatasetStationCatalog);
    vi.stubEnv("PLANNER_ENGINE", "v2");
    vi.resetModules();
    const again = await import("./container");
    const blaze = await import("@/infrastructure/blaze/catalog");
    expect(again.createStationCatalog()).toBeInstanceOf(blaze.BlazeStationCatalog);
  });

  it("detalle solo para ids de Blaze y con key", async () => {
    vi.stubEnv("BLAZE_API_KEY", "blz_x");
    const { createStationDetails } = await import("./container");
    const { BlazeStationDetails } = await import("@/infrastructure/blaze/catalog");
    expect(createStationDetails("blz_12")).toBeInstanceOf(BlazeStationDetails);
    expect(createStationDetails("st_abc")).toBeUndefined();
    vi.stubEnv("BLAZE_API_KEY", "");
    vi.resetModules();
    const again = await import("./container");
    expect(again.createStationDetails("blz_12")).toBeUndefined();
  });

  it("el servicio de planificación usa Blaze solo si el motor que responde es v2", async () => {
    vi.stubEnv("BLAZE_API_KEY", "blz_x");
    const { createPlanningService } = await import("./container");
    const { BlazeStationCatalog } = await import("@/infrastructure/blaze/catalog");
    const deps = (s: object) =>
      (s as unknown as { deps: { stations: unknown; stationSource?: string } }).deps;
    const v2 = deps(createPlanningService({ engineMode: "v2" }));
    const v1 = deps(createPlanningService({ engineMode: "legacy" }));
    expect(v2.stations).toBeInstanceOf(BlazeStationCatalog);
    expect(v2.stationSource).toBe("blaze");
    expect(v1.stations).not.toBeInstanceOf(BlazeStationCatalog);
    expect(v1.stationSource).toBe("dataset");
  });
});
