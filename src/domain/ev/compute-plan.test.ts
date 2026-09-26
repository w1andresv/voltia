import { describe, expect, it } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import { buildPlan, rankPlans } from "../planner";
import type { Charger, Place, RawRoute, TripConditions } from "../types";
import { buildPlans, computePlans, type PlanInputs } from "./compute-plan";

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
  arrivalSoc: 15,
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
