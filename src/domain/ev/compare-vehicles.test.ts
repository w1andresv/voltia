import { describe, expect, it } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import type { Charger, Place, RawRoute, TripConditions, Vehicle } from "../types";
import { computePlansFromSnapshot, type SnapshotInputs } from "./compute-plan";
import { planOnRoute } from "./compare-vehicles";

function route(id: string, distanceKm: number): RawRoute {
  const n = Math.round(distanceKm / 5) + 1;
  const samples = Array.from({ length: n }, (_, i) => {
    const km = Math.min(distanceKm, i * 5);
    return { km, lat: 7 + km / 111, lon: -73, elevM: 0, slopePct: 0, speedKmh: 80 };
  });
  return {
    id,
    label: id,
    geometry: samples.map((s) => ({ lat: s.lat, lon: s.lon })),
    samples,
    distanceKm,
    driveMinutes: (distanceKm / 80) * 60,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
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

const places: { origin: Place; destination: Place } = {
  origin: { label: "A", lat: 7, lon: -73 },
  destination: { label: "B", lat: 7 + 300 / 111, lon: -73 },
};
const charger: Charger = {
  id: "c150",
  name: "km 150",
  lat: 7 + 150 / 111,
  lon: -73,
  sockets: [{ connector: "ccs2", powerKw: 120, count: 2, current: "DC" }],
  source: "osm",
};
const snapshot: SnapshotInputs = {
  routes: [route("r-fast", 300), route("r-long", 340)],
  chargers: [charger],
  weather: null,
  plannerEngine: "v2",
};

const ccs2 = catalogVehicle("mg-s5-ev-deluxe");
/** El mismo carro con otra batería o solo CHAdeMO: la única estación de la ruta es CCS2. */
const bigBattery: Vehicle = { ...ccs2, id: "big", batteryKwh: 120, rangeKm: 700 };
const chademoOnly: Vehicle = { ...ccs2, id: "chademo", connectors: ["chademo"] };

describe("planOnRoute", () => {
  it("es el plan de esa ruta con ese vehículo, igual al del recálculo completo", () => {
    const plan = planOnRoute(snapshot, places, "r-long", ccs2, conditions);
    const full = computePlansFromSnapshot(snapshot, places, ccs2, conditions).plans;
    expect(plan?.id).toBe("r-long");
    expect(plan).toEqual(full.find((p) => p.id === "r-long"));
  });

  it("una ruta que no está en el snapshot no da plan", () => {
    expect(planOnRoute(snapshot, places, "otra", ccs2, conditions)).toBeNull();
  });

  it("mismas estaciones para todos: cambia solo el vehículo", () => {
    const withStop = planOnRoute(snapshot, places, "r-fast", ccs2, conditions)!;
    const noStop = planOnRoute(snapshot, places, "r-fast", bigBattery, conditions)!;
    const stranded = planOnRoute(snapshot, places, "r-fast", chademoOnly, conditions)!;
    expect(withStop).toMatchObject({ feasible: true });
    expect(withStop.stops.map((s) => s.charger.id)).toEqual(["c150"]);
    expect(noStop).toMatchObject({ feasible: true, canArriveWithoutCharge: true, stops: [] });
    expect(stranded.feasible).toBe(false);
  });
});
