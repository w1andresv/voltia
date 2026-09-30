import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlanRequest } from "@/domain/types";
import { catalogVehicle } from "./scenarios";
import {
  SYNTHETIC_A,
  SYNTHETIC_B,
  SYNTHETIC_TOKEN,
  syntheticFetch,
  syntheticStations,
} from "./synthetic-providers";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

const req: PlanRequest = {
  origin: { label: "A", ...SYNTHETIC_A },
  destination: { label: "B", ...SYNTHETIC_B },
  waypoints: [],
  vehicle: catalogVehicle("mg-s5-ev-deluxe"),
  conditions: {
    passengers: 1,
    luggageKg: 30,
    initialSoc: 35,
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

describe("informe del plan (§8.5)", () => {
  beforeAll(() => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", SYNTHETIC_TOKEN);
    vi.stubGlobal("fetch", syntheticFetch());
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("tiene resumen, parámetros con fuente, paradas, series, calidad de datos, avisos y supuestos", async () => {
    const { createPlanningService } = await import("@/application/container");
    const { buildPlanReport } = await import("@/application/plan-trip/plan-report");
    const { MODEL_PARAMETERS } = await import("@/domain/ev/core/params");
    const { response } = await createPlanningService({
      stations: { getDataset: async () => syntheticStations() },
      engineMode: "v2",
      energyMode: "v2",
      clock: () => new Date("2026-09-01T12:00:00Z"),
    }).plan(req);
    const plan = response.plans[0]!;
    expect(plan.stops.length).toBeGreaterThan(0);
    const md = buildPlanReport({
      title: "Prueba",
      request: req,
      geo: {
        ...response.geo,
        warnings: ["aviso de prueba"],
        dataQuality: { elevation: "unavailable" },
      },
      plan,
      route: response.geo.routes.find((r) => r.id === plan.id),
      params: MODEL_PARAMETERS,
    });
    for (const h of [
      "## 1. Resumen",
      "## 2. Parámetros con fuente",
      "## 3. Paradas",
      "## 4. Series de las gráficas",
      "## 5. Calidad de datos",
      "## 6. Avisos",
      "## 7. Supuestos estimados",
    ]) {
      expect(md).toContain(h);
    }
    expect(md).toContain("| Masa total | 1.852 kg | calculado |");
    expect(md).toContain("| Crr | 0,009 |");
    expect(md).toMatch(/\| 1 \| Estación s20 \|/);
    expect(md).toContain("llega a la parada");
    expect(md).toContain("Verificado con la ruta real");
    expect(md).toContain("NO (ruta plana)");
    expect(md).toContain("- aviso de prueba");
    expect(md).toContain("- Eficiencia batería → rueda: 0,9");
  });
});
