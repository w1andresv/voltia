import { DEFAULT_CURVE } from "@/domain/charging";
import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";
import { DEFAULT_CONDITIONS, type Vehicle } from "@/domain/types";

export function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "custom-1",
    brand: "Test",
    model: "EV",
    year: 2024,
    version: "base",
    batteryKwh: 60,
    rangeKm: 400,
    consumptionKwhPer100km: null,
    consumptionManual: false,
    weightKg: 1800,
    motorKw: 150,
    acMaxKw: 11,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2", "type2"],
    minSocRecommended: 15,
    maxSocTravel: 80,
    ...overrides,
  };
}

export function makeRequest(overrides: Partial<PlanRequestShape> = {}): PlanRequestShape {
  return {
    origin: { label: "A", lat: 7.0833, lon: -73.0494 },
    destination: { label: "B", lat: 5.6333, lon: -73.5256 },
    waypoints: [],
    vehicle: makeVehicle(),
    conditions: DEFAULT_CONDITIONS,
    ...overrides,
  };
}

export const SUMMARY: TripSummaryShape = {
  originLabel: "A",
  destinationLabel: "B",
  distanceKm: 100,
  totalMinutes: 90,
  stops: 1,
  arrivalSoc: 30,
  energyKwh: 20,
};
