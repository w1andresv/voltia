import { describe, expect, it } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import { atTip, zigzagRoute } from "@/test-support/zigzag-route";
import type { Charger, TripConditions } from "../types";
import { buildPlan } from "../planner";

/** Corredor contra la línea fina en el planificador (M5, ADR-0027). */
const conditions: TripConditions = {
  passengers: 1,
  luggageKg: 0,
  initialSoc: 25,
  avgSpeedKmh: null,
  ac: "normal",
  temperatureC: 20,
  drivingStyle: "normal",
  safetyMode: "normal",
  customSafetyPct: 15,
  planningMode: "fastest",
  allowBelowSafety: false,
  regenLevel: "medium",
};
const station = (lateralKm: number): Charger => ({
  id: "tip",
  name: "Punta",
  ...atTip(lateralKm),
  operator: "x",
  sockets: [
    { connector: "ccs2", powerKw: 120, count: 2, current: "DC", currentOrigin: "standard", powerOrigin: "reported" },
  ],
  access: "public",
  source: "blaze",
  available: true,
  availability: "available",
  verified: true,
});

function plan(engine: "legacy" | "v2", lateralKm = 0) {
  return buildPlan({
    raw: zigzagRoute(),
    vehicle: catalogVehicle("mg-s5-ev-comfort"),
    conditions,
    chargers: [station(lateralKm)],
    weather: null,
    origin: { label: "A", lat: 7, lon: -73 },
    destination: { label: "B", lat: 7.9, lon: -73 },
    engine,
    energyEngine: engine,
  });
}

describe("el planificador v2 ubica las estaciones contra la vía, no contra las muestras", () => {
  it("una estación en la punta de una herradura: el v1 no la ve (16 km de la cuerda); el v2 sí, sin desvío", () => {
    const v1 = plan("legacy");
    const v2 = plan("v2");
    expect(v1.stops.some((s) => s.charger.id === "tip")).toBe(false);
    const stop = v2.stops.find((s) => s.charger.id === "tip");
    expect(stop).toBeDefined();
    expect(stop!.fromRouteKm).toBeLessThan(0.1);
    expect(stop!.detourKm).toBeLessThan(0.2);
  });

  it("el desvío del v2 es el real hasta la vía", () => {
    const stop = plan("v2", 3).stops.find((s) => s.charger.id === "tip");
    if (stop) expect(stop.detourKm).toBeCloseTo(2 * stop.fromRouteKm, 9);
    expect(stop?.fromRouteKm ?? 3).toBeGreaterThan(2);
    expect(stop?.fromRouteKm ?? 3).toBeLessThan(4);
  });

  it("la parada queda en la muestra más cercana por km: la energía se calcula ahí", () => {
    const stop = plan("v2").stops.find((s) => s.charger.id === "tip")!;
    expect([30, 70]).toContain(stop.kmAlongRoute);
  });
});
