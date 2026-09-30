import { DEFAULT_CURVE } from "@/domain/charging";
import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";

/** Viaje guardado de 10 km (el de `minimalSnapshot`) con un vehículo de 60 kWh. */
export const tripRequest: PlanRequestShape = {
  origin: { label: "A", lat: 7, lon: -73 },
  destination: { label: "B", lat: 7 - 10 / 111, lon: -73 },
  waypoints: [],
  vehicle: {
    id: "v1",
    brand: "T",
    model: "EV",
    year: 2025,
    version: "x",
    batteryKwh: 60,
    rangeKm: 400,
    consumptionKwhPer100km: null,
    weightKg: 1800,
    motorKw: 150,
    acMaxKw: 11,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2"],
  },
  conditions: {
    passengers: 1,
    luggageKg: 0,
    initialSoc: 80,
    avgSpeedKmh: null,
    ac: "normal",
    temperatureC: 22,
    drivingStyle: "normal",
    safetyMode: "normal",
    customSafetyPct: 15,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenLevel: "medium",
  },
};
export const tripSummary: TripSummaryShape = {
  originLabel: "A",
  destinationLabel: "B",
  distanceKm: 10,
  totalMinutes: 8,
  stops: 0,
  arrivalSoc: 77,
  energyKwh: 1.8,
};
