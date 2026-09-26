import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import { SYNTHETIC_A, SYNTHETIC_B, syntheticFetch, syntheticStations } from "@/test-support/synthetic-providers";
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
    arrivalSoc: 10,
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
    const { engine } = await createPlanningService({ stations: { getDataset: async () => syntheticStations() } }).plan(request);
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
      createPlanningService({ stations: { getDataset: async () => syntheticStations() } }).plan(request),
    ).rejects.toThrow();
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes("router.project-osrm.org"))).toBe(true);
    expect(urls.some((u) => u.includes("api.mapbox.com"))).toBe(false);
  });

  it("PLANNER_ENGINE distinto de legacy avisa una vez y sigue con legacy", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.synthetic.token");
    vi.stubEnv("PLANNER_ENGINE", "v2");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createPlanningService } = await import("./container");
    createPlanningService();
    createPlanningService();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("PLANNER_ENGINE=v2");
  });

  it("el geocodificador busca y hace geocodificación inversa", async () => {
    const { createGeocoder } = await import("./container");
    const geocoder = createGeocoder();
    expect(typeof geocoder.search).toBe("function");
    expect(typeof geocoder.reverse).toBe("function");
  });
});
