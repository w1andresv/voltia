/**
 * Caracterización del pipeline de planificación con proveedores sintéticos.
 * Guarda el resultado COMPLETO (normalizado) para que las fases del motor v2
 * que no deben cambiar resultados (F1, F2) lo prueben con igualdad exacta.
 * Si una fase cambia números a propósito, se actualiza el snapshot en ese
 * commit y el mensaje explica el cambio.
 */
import { createHash } from "node:crypto";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlanRequest, PlanResponse, TripConditions, Vehicle } from "@/domain/types";
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

function request(overrides: Partial<TripConditions> = {}): PlanRequest {
  return {
    origin: { label: "Piedecuesta", ...SYNTHETIC_A },
    destination: { label: "Vélez", ...SYNTHETIC_B },
    waypoints: [],
    vehicle: catalogVehicle("mg-s5-ev-deluxe"),
    conditions: {
      passengers: 1,
      luggageKg: 30,
      initialSoc: 35,
      avgSpeedKmh: null,
      ac: "normal",
      temperatureC: null,
      drivingStyle: "normal",
      safetyMode: "low",
      customSafetyPct: 10,
      planningMode: "fastest",
      allowBelowSafety: false,
      regenLevel: "medium",
      ...overrides,
    },
  };
}

/** Números con 10 cifras significativas: estable ante diferencias de último bit entre versiones de V8. */
function normalized(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)
      ? Number(v.toPrecision(10))
      : v,
  );
}

function digest(value: unknown): string {
  return createHash("sha256").update(normalized(value)).digest("hex").slice(0, 16);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function summary(res: PlanResponse) {
  return {
    engine: res.geo.routes.map((r) => r.engine),
    warnings: res.geo.warnings,
    chargers: res.geo.chargers.map((c) => c.id),
    weather: res.geo.weather,
    selectedId: res.selectedId,
    plans: res.plans.map((p) => ({
      id: p.id,
      label: p.label,
      via: p.via,
      noTolls: p.noTolls,
      feasible: p.feasible,
      distanceKm: r1(p.distanceKm),
      energyKwh: r1(p.energyKwh),
      initialSoc: r1(p.initialSoc),
      arrivalSoc: r1(p.arrivalSoc),
      minSoc: r1(p.minSoc),
      totalMinutes: Math.round(p.totalMinutes),
      stops: p.stops.map(
        (s) =>
          `${s.charger.id} ${r1(s.arriveSoc)}→${r1(s.departSoc)} ${Math.round(s.chargeMinutes)} min`,
      ),
      departureCharge: p.departureCharge?.additionalPct,
      ...(p.verification
        ? { verification: `${p.verification.status} en ${p.verification.iterations}` }
        : {}),
    })),
  };
}

/**
 * Punto de entrada que se caracteriza: el servicio de planificación con los
 * proveedores de producción (Mapbox, Open-Meteo) sobre fetch simulado, y las
 * estaciones sintéticas. El snapshot se grabó con el pipeline anterior a F1.
 */
async function plan(
  req: PlanRequest,
  engineMode: "legacy" | "v2" = "legacy",
  energyMode: "legacy" | "v2" = "legacy",
): Promise<PlanResponse> {
  const { createPlanningService } = await import("@/application/container");
  const { response } = await createPlanningService({
    stations: { getDataset: async () => syntheticStations() },
    engineMode,
    energyMode,
    clock: () => new Date("2026-09-01T12:00:00Z"),
  }).plan(req);
  return response;
}

describe("caracterización del pipeline con proveedores sintéticos", () => {
  beforeAll(() => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", SYNTHETIC_TOKEN);
    vi.stubGlobal("fetch", syntheticFetch());
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("modo más rápido, SOC 35 %: resumen y huella del resultado completo", async () => {
    const res = await plan(request());
    expect(summary(res)).toMatchSnapshot();
    expect(digest(res)).toMatchSnapshot();
  });

  it("menos paradas, SOC 90 %", async () => {
    const res = await plan(
      request({ planningMode: "fewer_stops", initialSoc: 90, drivingStyle: "sport" }),
    );
    expect(summary(res)).toMatchSnapshot();
    expect(digest(res)).toMatchSnapshot();
  });

  it("más segura, SOC 15 %, margen conservador (pide carga antes de salir)", async () => {
    const res = await plan(
      request({ planningMode: "safer", initialSoc: 15, safetyMode: "conservative" }),
    );
    expect(summary(res)).toMatchSnapshot();
    expect(digest(res)).toMatchSnapshot();
  });

  // Planificador v2 (F7) en los mismos escenarios: referencia para el modo sombra.
  // Con v2 el recomendado pasa por la pasada 2 (F8): la ruta sintética entra a cada parada.
  it.each([
    ["modo más rápido, SOC 35 %", {}],
    [
      "menos paradas, SOC 90 %",
      { planningMode: "fewer_stops", initialSoc: 90, drivingStyle: "sport" },
    ],
    ["más segura, SOC 15 %", { planningMode: "safer", initialSoc: 15, safetyMode: "conservative" }],
  ] as [string, Partial<TripConditions>][])("planificador v2: %s", async (_name, over) => {
    const res = await plan(request(over), "v2");
    expect(summary(res)).toMatchSnapshot();
  });

  // Modelo de energía v2 (F5): física sin multiplicadores y perfil de velocidad,
  // con el planificador actual. Referencia para el modo sombra de energía.
  it.each([
    ["modo más rápido, SOC 35 %", {}],
    [
      "menos paradas, SOC 90 %, sport",
      { planningMode: "fewer_stops", initialSoc: 90, drivingStyle: "sport" },
    ],
    ["más segura, SOC 15 %", { planningMode: "safer", initialSoc: 15, safetyMode: "conservative" }],
    [
      "eficiente, SOC 60 %",
      { planningMode: "efficient", initialSoc: 60, drivingStyle: "efficient" },
    ],
  ] as [string, Partial<TripConditions>][])("energía v2: %s", async (_name, over) => {
    const res = await plan(request(over), "legacy", "v2");
    expect(res.plans.every((p) => p.energyEngine === "v2")).toBe(true);
    expect(summary(res)).toMatchSnapshot();
  });

  it("el snapshot guardado (JSON) reproduce el mismo plan sin consultar proveedores", async () => {
    const req = request({ planningMode: "safer", initialSoc: 15, safetyMode: "conservative" });
    const res = await plan(req);
    const { computePlans } = await import("@/domain/ev/compute-plan");
    const { parsePlanningSnapshot, snapshotInputs } =
      await import("@/domain/ev/contracts/snapshot");
    const stored = parsePlanningSnapshot(JSON.parse(JSON.stringify(res.geo)));
    expect(stored).not.toBeNull();
    expect(stored).toMatchObject({
      schemaVersion: 1,
      modelVersion: MODEL_PARAMETERS.modelVersion,
      createdAt: "2026-09-01T12:00:00.000Z",
    });
    const again = computePlans(
      { ...snapshotInputs(stored!), origin: req.origin, destination: req.destination },
      req.vehicle as Vehicle,
      req.conditions as TripConditions,
      stored!.plannerEngine,
    );
    expect(normalized(again.plans)).toBe(normalized(res.plans));
    // D7: los planes llevan la huella del snapshot con que se calcularon.
    expect(stored!.snapshotId).toMatch(/^[0-9a-f]{14}$/);
    expect(res.plans.every((p) => p.snapshotId === stored!.snapshotId)).toBe(true);
    expect(again.selectedId).toBe(res.selectedId);
  });

  it("al compartir (D6): la pasada 2 queda en el snapshot y el link muestra el plan verificado", async () => {
    const req = request();
    const { createPlanningService } = await import("@/application/container");
    const service = createPlanningService({
      stations: { getDataset: async () => syntheticStations() },
      engineMode: "v2",
      clock: () => new Date("2026-09-01T12:00:00Z"),
    });
    const { response } = await service.plan(req);
    const { parsePlanningSnapshot } = await import("@/domain/ev/contracts/snapshot");
    const { computePlansFromSnapshot } = await import("@/domain/ev/compute-plan");
    const snapshot = parsePlanningSnapshot(JSON.parse(JSON.stringify(response.geo)))!;
    const verified = await service.verifySnapshot(snapshot, req);
    expect(verified).not.toBeNull();
    const [id] = Object.keys(verified!);
    expect(verified![id!]!.verification.status).toBe("verified");

    // Guardado y leído como JSON, con la verificación: sin consultar proveedores.
    const stored = parsePlanningSnapshot(
      JSON.parse(JSON.stringify({ ...snapshot, verifiedRoutes: verified })),
    )!;
    const shared = computePlansFromSnapshot(
      stored,
      req,
      req.vehicle as Vehicle,
      req.conditions as TripConditions,
    );
    const plan = shared.plans.find((p) => p.id === id)!;
    expect(plan.verification?.status).toBe("verified");
    // El mismo plan verificado que respondió el servidor al planificar.
    const live = response.plans.find((p) => p.id === id)!;
    expect(normalized(plan.stops.map((s) => [s.charger.id, s.arriveSoc, s.departSoc]))).toBe(
      normalized(live.stops.map((s) => [s.charger.id, s.arriveSoc, s.departSoc])),
    );
    expect(plan.distanceKm).toBeCloseTo(live.distanceKm, 9);
  });

  it("en la sesión: el snapshot trae la pasada 2 y recalcular en el navegador la conserva", async () => {
    const req = request();
    const { createPlanningService } = await import("@/application/container");
    const { response } = await createPlanningService({
      stations: { getDataset: async () => syntheticStations() },
      engineMode: "v2",
      clock: () => new Date("2026-09-01T12:00:00Z"),
    }).plan(req);
    expect(response.plans[0]!.verification?.status).toBe("verified");
    expect(Object.keys(response.geo.verifiedRoutes ?? {})).toEqual([response.plans[0]!.id]);

    // Lo que hace el navegador al cambiar condiciones, con las mismas: el mismo resultado.
    const { parsePlanningSnapshot } = await import("@/domain/ev/contracts/snapshot");
    const { computePlansFromSnapshot } = await import("@/domain/ev/compute-plan");
    const geo = parsePlanningSnapshot(JSON.parse(JSON.stringify(response.geo)))!;
    const again = computePlansFromSnapshot(
      geo,
      req,
      req.vehicle as Vehicle,
      req.conditions as TripConditions,
    );
    expect(normalized(again.plans)).toBe(normalized(response.plans));
    expect(again.selectedId).toBe(response.selectedId);
  });

  it("DETOUR_SOURCE=matrix: las paradas usan el desvío medido y el snapshot lo reproduce", async () => {
    vi.resetModules();
    vi.stubEnv("DETOUR_SOURCE", "matrix");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const req = request();
      const measured = await plan(req);
      const estimated = await (async () => {
        vi.resetModules();
        vi.stubEnv("DETOUR_SOURCE", "estimated");
        return plan(req);
      })();
      const stop = measured.plans[0]!.stops[0]!;
      expect(stop.detourSource).toBe("calculated");
      expect(estimated.plans[0]!.stops[0]!.detourSource).toBe("estimated");
      // Por vía (≈ 1,3 × línea recta) el desvío es más largo que la estimación.
      expect(stop.detourKm).toBeGreaterThan(estimated.plans[0]!.stops[0]!.detourKm);
      expect(Object.keys(measured.geo.detours ?? {}).length).toBeGreaterThan(0);
      expect(log.mock.calls.some(([l]) => String(l).startsWith("[detours]"))).toBe(true);

      const { computePlansFromSnapshot } = await import("@/domain/ev/compute-plan");
      const { parsePlanningSnapshot } = await import("@/domain/ev/contracts/snapshot");
      const stored = parsePlanningSnapshot(JSON.parse(JSON.stringify(measured.geo)))!;
      const again = computePlansFromSnapshot(
        stored,
        req,
        req.vehicle as Vehicle,
        req.conditions as TripConditions,
      );
      expect(normalized(again.plans)).toBe(normalized(measured.plans));
    } finally {
      log.mockRestore();
      vi.stubEnv("DETOUR_SOURCE", "estimated");
      vi.resetModules();
    }
  });

  it("es determinista", async () => {
    const a = await plan(request());
    const b = await plan(request());
    expect(normalized(a)).toBe(normalized(b));
  });
});
