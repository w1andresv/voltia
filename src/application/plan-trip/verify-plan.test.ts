import { describe, expect, it } from "vitest";
import { computePlans, type PlanInputs } from "@/domain/ev/compute-plan";
import type { RouteRequest } from "@/domain/ev/contracts/route";
import { toRawRoute } from "@/domain/ev/engines/route/normalize";
import type { RoutingProvider } from "@/domain/ports/routing";
import type { Charger, Place, TripConditions } from "@/domain/types";
import { fakeProviderRoute } from "@/test-support/mapbox-fixtures";
import { catalogVehicle } from "@/test-support/scenarios";
import { orderedWaypoints, verifyPlan } from "./verify-plan";

const KM_PER_DEG = 111.32;
const at = (km: number) => ({ lat: 7 - km / KM_PER_DEG, lon: -73 });
const route = (km: number) => fakeProviderRoute([["trunk", km, (km / 90) * 60]]);

/**
 * Ruta real de origen a destino (km 300 en línea recta) que mide `km`: la misma
 * geometría con una vía más sinuosa, como cuando entrar a las estaciones alarga el viaje.
 */
function winding(km: number) {
  const r = route(300);
  const k = km / 300;
  return {
    ...r,
    distanceM: r.distanceM * k,
    durationS: r.durationS * k,
    legs: r.legs.map((leg) => ({
      ...leg,
      distanceM: (leg.distanceM ?? 0) * k,
      steps: leg.steps?.map((st) => ({
        ...st,
        distanceM: st.distanceM * k,
        durationS: st.durationS * k,
      })),
    })),
  };
}

const origin: Place = { label: "Origen", ...at(0) };
const destination: Place = { label: "Destino", ...at(300) };
const charger = (km: number): Charger => ({
  id: `c${km}`,
  name: `km ${km}`,
  ...at(km),
  sockets: [{ connector: "ccs2", powerKw: 120, count: 2, current: "DC" }],
  source: "osm",
});
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
  planningMode: "fewer_stops",
  allowBelowSafety: false,
  regenLevel: "medium",
};
const vehicle = catalogVehicle("mg-s5-ev-deluxe");

function inputs(chargers: Charger[]): PlanInputs {
  return {
    routes: [toRawRoute(route(300), { id: "route-0", label: "Ruta A" })],
    chargers,
    weather: null,
    origin,
    destination,
  };
}

/** Proveedor falso: devuelve rutas del largo indicado, en orden; registra lo pedido. */
function routing(lengthsKm: (number | Error)[]) {
  const calls: RouteRequest[] = [];
  const provider: RoutingProvider = {
    id: "fake",
    label: "Fake",
    engine: "mapbox",
    capabilities: { alternatives: true, avoidTolls: true, avoidPoints: true, roadClasses: true },
    async calculateRoutes(req) {
      calls.push(req);
      const next = lengthsKm[Math.min(calls.length - 1, lengthsKm.length - 1)]!;
      if (next instanceof Error) throw next;
      return { routes: [winding(next)], waypointSnapKm: req.waypoints.map(() => 0) };
    },
  };
  return { provider, calls };
}

async function verify(
  chargers: Charger[],
  lengthsKm: (number | Error)[],
  c: TripConditions = conditions,
) {
  const input = inputs(chargers);
  const [plan] = computePlans(input, vehicle, c, "v2").plans;
  const { provider, calls } = routing(lengthsKm);
  const out = await verifyPlan(
    { routing: provider, withElevation: async (r) => r, maxIterations: 3 },
    { plan: plan!, inputs: input, userWaypoints: [], vehicle, conditions: c, engine: "v2" },
  );
  return { plan: plan!, out, calls };
}

describe("verifyPlan (pasada 2)", () => {
  it("sin paradas no pide nada", async () => {
    const input = inputs([]);
    const [plan] = computePlans(input, vehicle, { ...conditions, initialSoc: 100 }, "v2").plans;
    expect(plan!.stops).toHaveLength(0);
    const { provider, calls } = routing([300]);
    const out = await verifyPlan(
      { routing: provider, withElevation: async (r) => r, maxIterations: 3 },
      { plan: plan!, inputs: input, userWaypoints: [], vehicle, conditions, engine: "v2" },
    );
    expect(out).toBe(plan);
    expect(calls).toHaveLength(0);
  });

  it("verifica con una ruta si las paradas alcanzan sobre la ruta real", async () => {
    const { plan, out, calls } = await verify([charger(150)], [304]);
    expect(plan.stops.map((s) => s.charger.id)).toEqual(["c150"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.waypoints).toEqual([origin, at(150), destination]);
    expect(calls[0]!.alternatives).toBe(false);
    expect(out.verification).toEqual({ status: "verified", iterations: 1, baseDistanceKm: 300 });
    expect(out.id).toBe(plan.id);
    expect(out.distanceKm).toBeCloseTo(304, 6);
    expect(out.feasible).toBe(true);
    expect(out.stops.map((s) => s.charger.id)).toEqual(["c150"]);
  });

  it("cambia las paradas si con la ruta real no alcanzan, y verifica el cambio", async () => {
    const soc90 = { ...conditions, initialSoc: 90 };
    const { plan, out, calls } = await verify(
      [charger(100), charger(150), charger(200)],
      [460, 460],
      soc90,
    );
    expect(plan.stops.map((s) => s.charger.id)).toEqual(["c150"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.waypoints).toEqual([origin, at(150), destination]);
    expect(calls[1]!.waypoints).toEqual([origin, at(100), at(200), destination]);
    expect(out.verification).toEqual({ status: "changed", iterations: 2, baseDistanceKm: 300 });
    expect(out.feasible).toBe(true);
    expect(out.stops.map((s) => s.charger.id)).toEqual(["c100", "c200"]);
  });

  it("si con la ruta real la misma parada solo alcanza pasando del 80 %, la verifica así (ADR-0018)", async () => {
    const soc90 = { ...conditions, initialSoc: 90 };
    const { plan, out, calls } = await verify(
      [charger(100), charger(150), charger(200)],
      [380],
      soc90,
    );
    expect(plan.stops.map((s) => s.charger.id)).toEqual(["c150"]);
    expect(calls).toHaveLength(1);
    expect(out.verification).toEqual({ status: "verified", iterations: 1, baseDistanceKm: 300 });
    expect(out.feasible).toBe(true);
    const stop = out.stops[0]!;
    expect(stop.charger.id).toBe("c150");
    expect(stop.departSoc).toBeGreaterThan(80);
    expect(stop.departSoc).toBeLessThanOrEqual(90);
    expect(stop.aboveRouteCap).toBe("only-way");
  });

  it("si con la ruta real ni todas las estaciones alcanzan, el resultado es no viable", async () => {
    const { out } = await verify([charger(150)], [900]);
    expect(out.feasible).toBe(false);
    expect(out.verification?.status).toBe("verified");
  });

  it("si el proveedor falla, queda el plan de la pasada 1 marcado como no verificado", async () => {
    const { plan, out } = await verify([charger(150)], [new Error("sin red")]);
    expect(out).toEqual({
      ...plan,
      verification: { status: "failed", iterations: 1, baseDistanceKm: 300 },
    });
  });

  it("sin convergencia en el máximo de iteraciones, queda no verificado", async () => {
    const input = inputs([charger(100), charger(150), charger(200)]);
    const soc90 = { ...conditions, initialSoc: 90 };
    const [plan] = computePlans(input, vehicle, soc90, "v2").plans;
    // 460 km: ni pasando del 80 % alcanza la misma parada, así que habría que cambiarla.
    const { provider, calls } = routing([460]);
    const out = await verifyPlan(
      { routing: provider, withElevation: async (r) => r, maxIterations: 1 },
      { plan: plan!, inputs: input, userWaypoints: [], vehicle, conditions: soc90, engine: "v2" },
    );
    expect(calls).toHaveLength(1);
    expect(out).toEqual({
      ...plan,
      verification: { status: "failed", iterations: 1, baseDistanceKm: 300 },
    });
  });

  it("pide la ruta sin peajes si el plan la evitaba", async () => {
    const input = inputs([charger(150)]);
    const [plan] = computePlans(input, vehicle, conditions, "v2").plans;
    const { provider, calls } = routing([300]);
    await verifyPlan(
      { routing: provider, withElevation: async (r) => r, maxIterations: 3 },
      {
        plan: { ...plan!, noTolls: true },
        inputs: input,
        userWaypoints: [],
        vehicle,
        conditions,
        engine: "v2",
      },
    );
    expect(calls[0]!.avoid).toEqual({ tolls: true });
  });

  it("si el proveedor no devuelve rutas, no verificado", async () => {
    const input = inputs([charger(150)]);
    const [plan] = computePlans(input, vehicle, conditions, "v2").plans;
    const provider: RoutingProvider = {
      ...routing([]).provider,
      calculateRoutes: async () => ({ routes: [], waypointSnapKm: [] }),
    };
    const out = await verifyPlan(
      { routing: provider, withElevation: async (r) => r, maxIterations: 3 },
      { plan: plan!, inputs: input, userWaypoints: [], vehicle, conditions, engine: "v2" },
    );
    expect(out.verification?.status).toBe("failed");
  });
});

describe("orderedWaypoints", () => {
  it("intercala los puntos del usuario y las paradas por su km sobre la ruta", () => {
    const [plan] = computePlans(inputs([charger(150)]), vehicle, conditions, "v2").plans;
    expect(orderedWaypoints(plan!, [at(200), at(50)], [charger(150)])).toEqual([
      at(50),
      at(150),
      at(200),
    ]);
  });
});
