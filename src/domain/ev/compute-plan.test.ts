import { describe, expect, it } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import { buildPlan, rankPlans } from "../planner";
import type { Charger, Place, RawRoute, TripConditions } from "../types";
import {
  buildPlans,
  computePlans,
  computePlansFromSnapshot,
  rankVerifiedFirst,
  type PlanInputs,
} from "./compute-plan";

function route(id: string, distanceKm: number, climbM = 0): RawRoute {
  const n = Math.round(distanceKm / 5) + 1;
  const samples = Array.from({ length: n }, (_, i) => {
    const km = Math.min(distanceKm, i * 5);
    return {
      km,
      lat: 7 + km / 111,
      lon: -73,
      elevM: (climbM * km) / distanceKm,
      slopePct: 0,
      speedKmh: 80,
    };
  });
  return {
    id,
    label: id,
    geometry: samples.map((s) => ({ lat: s.lat, lon: s.lon })),
    samples,
    distanceKm,
    driveMinutes: (distanceKm / 80) * 60,
    elevation: { gainM: climbM, lossM: 0, minM: 0, maxM: climbM },
  };
}

const conditions: TripConditions = {
  passengers: 1,
  luggageKg: 0,
  initialSoc: 60,
  avgSpeedKmh: null,
  ac: "normal",
  temperatureC: 22,
  drivingStyle: "normal",
  safetyMode: "normal",
  customSafetyPct: 15,
  planningMode: "fastest",
  allowBelowSafety: false,
  regenLevel: "medium",
};

const origin: Place = { label: "A", lat: 7, lon: -73 };
const destination: Place = { label: "B", lat: 7 + 300 / 111, lon: -73 };
const charger: Charger = {
  id: "c150",
  name: "km 150",
  lat: 7 + 150 / 111,
  lon: -73,
  sockets: [{ connector: "ccs2", powerKw: 120, count: 2, current: "DC" }],
  source: "osm",
};
const inputs: PlanInputs = {
  routes: [route("r-flat", 300), route("r-climb", 290, 1500)],
  chargers: [charger],
  weather: null,
  origin,
  destination,
};
const vehicle = catalogVehicle("mg-s5-ev-deluxe");

describe("computePlans", () => {
  it.each(["legacy", "v2"] as const)("es buildPlan + rankPlans por ruta (%s)", (engine) => {
    const expected = rankPlans(
      inputs.routes.map((raw) =>
        buildPlan({
          raw,
          vehicle,
          conditions,
          chargers: [charger],
          weather: null,
          origin,
          destination,
          engine,
        }),
      ),
      conditions.planningMode,
    );
    const out = computePlans(inputs, vehicle, conditions, engine);
    expect(out.plans).toEqual(expected);
    expect(out.selectedId).toBe(expected[0]!.id);
  });

  it("buildPlans no ordena y usa legacy por defecto", () => {
    const plans = buildPlans(inputs, vehicle, conditions);
    expect(plans.map((p) => p.id)).toEqual(["r-flat", "r-climb"]);
    expect(plans.every((p) => p.planner === "legacy")).toBe(true);
  });

  it("sin rutas no hay plan elegido", () => {
    expect(computePlans({ ...inputs, routes: [] }, vehicle, conditions)).toEqual({
      plans: [],
      selectedId: "",
    });
  });
});

describe("rankVerifiedFirst", () => {
  it("un plan verificado y viable va primero aunque una alternativa sin verificar parezca mejor", () => {
    const [fast, slow] = computePlans(inputs, vehicle, conditions, "v2").plans;
    const verified = {
      ...slow!,
      verification: {
        status: "verified" as const,
        iterations: 1,
        baseDistanceKm: slow!.distanceKm,
      },
    };
    expect(rankVerifiedFirst([fast!, verified], "fastest").map((p) => p.id)).toEqual([
      verified.id,
      fast!.id,
    ]);
    // Una verificación fallida no cuenta.
    const failed = {
      ...verified,
      verification: { ...verified.verification, status: "failed" as const },
    };
    expect(rankVerifiedFirst([failed, fast!], "fastest").map((p) => p.id)).toEqual([
      fast!.id,
      failed.id,
    ]);
  });
});

describe("computePlansFromSnapshot con la pasada 2", () => {
  const snapshot = (verifiedIds: string[] | null) => ({
    routes: inputs.routes,
    chargers: inputs.chargers,
    weather: null,
    plannerEngine: "v2" as const,
    energyEngine: "legacy" as const,
    verifiedRoutes: {
      "r-flat": {
        route: route("r-flat", 302),
        chargerIds: verifiedIds,
        verification: { status: "verified" as const, iterations: 1, baseDistanceKm: 300 },
      },
    },
  });
  const places = { origin, destination };

  it("arma el plan sobre la ruta verificada y conserva la verificación", () => {
    const out = computePlansFromSnapshot(snapshot(["c150"]), places, vehicle, conditions);
    const plan = out.plans.find((p) => p.id === "r-flat")!;
    expect(plan.distanceKm).toBe(302);
    expect(plan.verification?.status).toBe("verified");
  });

  it("si con estas condiciones las paradas verificadas no alcanzan, usa la pasada 1 sin verificación", () => {
    // La verificación se hizo sin paradas; con 60 % no se llegan los 300 km sin cargar.
    const out = computePlansFromSnapshot(snapshot([]), places, vehicle, conditions);
    const plan = out.plans.find((p) => p.id === "r-flat")!;
    expect(plan.feasible).toBe(true);
    expect(plan.stops.map((s) => s.charger.id)).toEqual(["c150"]);
    expect(plan.distanceKm).toBe(300);
    expect(plan.verification).toBeUndefined();
  });
});
