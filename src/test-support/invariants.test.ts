/**
 * Invariantes de la especificación §8.4 sobre la ruta sintética (sin la
 * cassette real, P1 omitido), con el planificador y la energía v2.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlanRequest, PlanResponse, RoutePlan, TripConditions, Vehicle } from "@/domain/types";
import { tripMassKg } from "@/domain/types";
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
      temperatureC: 25,
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

async function plan(req: PlanRequest): Promise<PlanResponse> {
  const { createPlanningService } = await import("@/application/container");
  const { response } = await createPlanningService({
    stations: { getDataset: async () => syntheticStations() },
    engineMode: "v2",
    energyMode: "v2",
    clock: () => new Date("2026-09-01T12:00:00Z"),
  }).plan(req);
  return response;
}

/** Planes de la pasada 1 (sin la ruta verificada), para comparar con el perfil de su ruta base. */
async function passOne(req: PlanRequest, res: PlanResponse): Promise<RoutePlan[]> {
  const { computePlans } = await import("@/domain/ev/compute-plan");
  return computePlans(
    {
      routes: res.geo.routes,
      chargers: res.geo.chargers,
      weather: res.geo.weather,
      origin: req.origin,
      destination: req.destination,
    },
    req.vehicle as Vehicle,
    req.conditions as TripConditions,
    "v2",
    "v2",
  ).plans;
}

describe("invariantes de la especificación §8.4 (ruta sintética, v2)", () => {
  beforeAll(() => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", SYNTHETIC_TOKEN);
    vi.stubGlobal("fetch", syntheticFetch());
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("energía: Σ neto del perfil = energía del plan − desvíos − regeneración recortada", async () => {
    const req = request({ initialSoc: 95 }); // SOC alto: la batería recorta regeneración
    const res = await plan(req);
    const { energyProfileForRoute } = await import("@/domain/ev/energy-v2");
    const plans = await passOne(req, res);
    // El caso no es trivial: al menos una ruta recorta regeneración.
    expect(plans.some((p) => (p.regenCurtailedKwh ?? 0) > 0.01)).toBe(true);
    for (const p of plans) {
      const raw = res.geo.routes.find((r) => r.id === p.id)!;
      const profile = energyProfileForRoute(
        raw,
        req.vehicle as Vehicle,
        req.conditions as TripConditions,
        res.geo.weather,
      );
      const detour = p.stops.reduce((a, s) => a + (s.detourEnergyKwh ?? 0), 0);
      expect(profile.totals.netEnergyKwh).toBeCloseTo(
        p.energyKwh - detour - (p.regenCurtailedKwh ?? 0),
        9,
      );
    }
  });

  it("SOC: llegada = SOC₀ + (Σ cargas − Σ consumido + Σ regeneración aceptada) / capacidad × 100", async () => {
    let withStops = 0;
    for (const over of [
      {},
      { initialSoc: 15, planningMode: "safer" as const },
      { initialSoc: 95 },
    ]) {
      const req = request(over);
      const res = await plan(req);
      const cap = (req.vehicle as Vehicle).batteryKwh;
      for (const p of res.plans) {
        const charged = p.stops.reduce((a, s) => a + s.energyAddedKwh, 0);
        const expected =
          p.initialSoc + ((charged - p.energyGrossKwh + p.energyRegenKwh) / cap) * 100;
        expect(p.arrivalSoc).toBeCloseTo(expected, 9);
        if (p.stops.length) withStops++;
      }
    }
    expect(withStops).toBeGreaterThan(0); // el balance incluye cargas
  });

  it("masa: la del vehículo más pasajeros y equipaje", async () => {
    const req = request({ passengers: 3, luggageKg: 40 });
    const { energyProfileForRoute } = await import("@/domain/ev/energy-v2");
    const res = await plan(req);
    const out = energyProfileForRoute(
      res.geo.routes[0]!,
      req.vehicle as Vehicle,
      req.conditions as TripConditions,
      null,
    );
    expect(out.params.massKg.value).toBe(
      tripMassKg(req.vehicle as Vehicle, req.conditions as TripConditions),
    );
    expect(out.params.massKg.value).toBeGreaterThan((req.vehicle as Vehicle).weightKg);
  });

  it("determinismo: dos ejecuciones dan resultados iguales", async () => {
    const a = await plan(request());
    const b = await plan(request());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("sanidad: sport ≥ normal ≥ eficiente en energía sobre la misma ruta", async () => {
    const energy = async (drivingStyle: TripConditions["drivingStyle"]) => {
      const req = request({ drivingStyle, initialSoc: 95 });
      const plans = await passOne(req, await plan(req));
      return plans.find((p) => p.id === "route-0")!.energyKwh;
    };
    const [eff, normal, sport] = [
      await energy("efficient"),
      await energy("normal"),
      await energy("sport"),
    ];
    expect(sport).toBeGreaterThanOrEqual(normal);
    expect(normal).toBeGreaterThanOrEqual(eff);
  });
});

describe("sin redondeo en el dominio v2 (especificación §8.4)", () => {
  it("src/domain/ev no usa Math.round ni toFixed fuera de los tests", () => {
    const root = fileURLToPath(new URL("../domain/ev", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
      }
    };
    walk(root);
    const offenders = files.filter((f) =>
      /Math\.round\(|\.toFixed\(/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(10);
  });
});
