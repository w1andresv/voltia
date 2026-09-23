import { describe, expect, it } from "vitest";
import { buildPlan, rankPlans } from "./planner";
import { DEFAULT_CURVE } from "./charging";
import { NO_VERIFIED_STOP_REASON } from "./types";
import type { Charger, Place, RawRoute, TripConditions, Vehicle } from "./types";

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "v1",
    brand: "Test",
    model: "EV",
    year: 2024,
    version: "base",
    batteryKwh: 60,
    rangeKm: 400,
    consumptionKwhPer100km: null,
    weightKg: 1800,
    motorKw: 150,
    acMaxKw: 11,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2", "type2"],
    minSocRecommended: 10,
    maxSocTravel: 90,
    ...overrides,
  };
}

function conditions(overrides: Partial<TripConditions> = {}): TripConditions {
  return {
    passengers: 1,
    luggageKg: 0,
    initialSoc: 90,
    arrivalSoc: 20,
    avgSpeedKmh: 90,
    ac: "normal",
    temperatureC: 20,
    drivingStyle: "normal",
    safetyMode: "normal",
    customSafetyPct: 15,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenPct: 20,
    ...overrides,
  };
}

/** Straight line north from (4,-74) for `distanceKm`, one sample per stepKm. */
function straightRoute(distanceKm: number, stepKm = 10): RawRoute {
  const n = Math.round(distanceKm / stepKm) + 1;
  const samples = Array.from({ length: n }, (_, i) => {
    const km = Math.min(distanceKm, i * stepKm);
    return {
      km,
      lat: 4 + km / 111, // ~111 km por grado de latitud
      lon: -74,
      elevM: 0,
      slopePct: 0,
      speedKmh: 90,
    };
  });
  return {
    id: "r1",
    label: "Ruta recta",
    geometry: samples.map((s) => ({ lat: s.lat, lon: s.lon })),
    samples,
    distanceKm,
    driveMinutes: (distanceKm / 90) * 60,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

function chargerAt(km: number, overrides: Partial<Charger> = {}): Charger {
  return {
    id: `chg-${km}`,
    name: `Cargador km ${km}`,
    lat: 4 + km / 111,
    lon: -74,
    sockets: [{ connector: "ccs2", powerKw: 150, count: 2 }],
    source: "osm",
    ...overrides,
  };
}

const ORIGIN: Place = { label: "Origen", lat: 4, lon: -74 };
const DESTINATION_100: Place = { label: "Destino", lat: 4 + 100 / 111, lon: -74 };

describe("buildPlan — viaje corto sin paradas", () => {
  it("un viaje de 100 km con batería de sobra no necesita paradas", () => {
    const plan = buildPlan({
      raw: straightRoute(100),
      vehicle: vehicle(),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers: [],
      weather: null,
      origin: ORIGIN,
      destination: DESTINATION_100,
    });
    expect(plan.feasible).toBe(true);
    expect(plan.stops).toHaveLength(0);
    expect(plan.canArriveWithoutCharge).toBe(true);
  });
});

describe("buildPlan — viaje largo con paradas", () => {
  it("un viaje de 700 km con cargadores verificados cada 100 km planea 1–2 paradas", () => {
    const distance = 700;
    const chargers = [100, 200, 300, 400, 500, 600].map((km) => chargerAt(km));
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle(),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers,
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.feasible).toBe(true);
    expect(plan.stops.length).toBeGreaterThanOrEqual(1);
    expect(plan.stops.length).toBeLessThanOrEqual(3);
    expect(plan.arrivalSoc).toBeGreaterThanOrEqual(conditions().arrivalSoc - 1);
  });

  it("sin cargadores verificados en el camino, sale el aviso NO_VERIFIED_STOP_REASON", () => {
    const distance = 700;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle(),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers: [],
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.feasible).toBe(false);
    expect(plan.infeasibleReason).toBe(NO_VERIFIED_STOP_REASON);
  });

  it("un cargador pendiente de aprobación no cuenta para el plan", () => {
    const distance = 700;
    const chargers = [100, 200, 300, 400, 500, 600].map((km) =>
      chargerAt(km, { source: "community", status: "pending" }),
    );
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle(),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers,
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.feasible).toBe(false);
  });
});

describe("rankPlans", () => {
  const distance = 700;
  const chargers = [100, 200, 300, 400, 500, 600].map((km) => chargerAt(km));
  const destination: Place = { label: "Destino", lat: 4 + distance / 111, lon: -74 };

  function planFor(mode: TripConditions["planningMode"]) {
    return buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle(),
      conditions: conditions({ planningMode: mode }),
      chargers,
      weather: null,
      origin: ORIGIN,
      destination,
    });
  }

  it("los planes factibles siempre van antes que los no factibles", () => {
    const feasible = planFor("fastest");
    const infeasible = { ...planFor("fastest"), feasible: false, id: "infeasible" };
    const ranked = rankPlans([infeasible, feasible], "fastest");
    expect(ranked[0]!.id).toBe(feasible.id);
  });

  it("el modo 'fastest' ordena por tiempo total ascendente", () => {
    const a = { ...planFor("fastest"), id: "a", totalMinutes: 500 };
    const b = { ...planFor("fastest"), id: "b", totalMinutes: 300 };
    const ranked = rankPlans([a, b], "fastest");
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("el modo 'efficient' ordena por energía consumida ascendente", () => {
    const a = { ...planFor("fastest"), id: "a", energyKwh: 80 };
    const b = { ...planFor("fastest"), id: "b", energyKwh: 60 };
    const ranked = rankPlans([a, b], "efficient");
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("el modo 'fewer_stops' ordena por número de paradas ascendente", () => {
    const a = { ...planFor("fastest"), id: "a", stops: [1, 2] as never };
    const b = { ...planFor("fastest"), id: "b", stops: [1] as never };
    const ranked = rankPlans([a, b], "fewer_stops");
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("el modo 'safer' ordena por SOC mínimo descendente", () => {
    const a = { ...planFor("fastest"), id: "a", minSoc: 10 };
    const b = { ...planFor("fastest"), id: "b", minSoc: 25 };
    const ranked = rankPlans([a, b], "safer");
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });
});
