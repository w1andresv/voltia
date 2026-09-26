/**
 * Caracterización del pipeline de planificación con proveedores sintéticos.
 * Guarda el resultado COMPLETO (normalizado) para que las fases del motor v2
 * que no deben cambiar resultados (F1, F2) lo prueben con igualdad exacta.
 * Si una fase cambia números a propósito, se actualiza el snapshot en ese
 * commit y el mensaje explica el cambio.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlanRequest, PlanResponse, TripConditions } from "@/domain/types";
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
      arrivalSoc: 10,
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
    typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(10)) : v,
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
      stops: p.stops.map((s) => `${s.charger.id} ${r1(s.arriveSoc)}→${r1(s.departSoc)} ${Math.round(s.chargeMinutes)} min`),
      departureCharge: p.departureCharge?.additionalPct,
    })),
  };
}

/**
 * Punto de entrada que se caracteriza: el servicio de planificación con los
 * proveedores de producción (Mapbox, Open-Meteo) sobre fetch simulado, y las
 * estaciones sintéticas. El snapshot se grabó con el pipeline anterior a F1.
 */
async function plan(req: PlanRequest): Promise<PlanResponse> {
  const { createPlanningService } = await import("@/application/container");
  const { response } = await createPlanningService({
    stations: { getDataset: async () => syntheticStations() },
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
    const res = await plan(request({ planningMode: "fewer_stops", initialSoc: 90, drivingStyle: "sport" }));
    expect(summary(res)).toMatchSnapshot();
    expect(digest(res)).toMatchSnapshot();
  });

  it("más segura, SOC 15 %, margen conservador (pide carga antes de salir)", async () => {
    const res = await plan(request({ planningMode: "safer", initialSoc: 15, safetyMode: "conservative" }));
    expect(summary(res)).toMatchSnapshot();
    expect(digest(res)).toMatchSnapshot();
  });

  it("es determinista", async () => {
    const a = await plan(request());
    const b = await plan(request());
    expect(normalized(a)).toBe(normalized(b));
  });
});
