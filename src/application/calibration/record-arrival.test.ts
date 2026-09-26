import { describe, expect, it } from "vitest";
import { DEFAULT_CURVE } from "@/domain/charging";
import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";
import { minimalSnapshot } from "@/test-support/snapshot-fixture";
import { planShown, recordArrival } from "./record-arrival";

const request: PlanRequestShape = {
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
    minSocRecommended: 10,
    maxSocTravel: 90,
  },
  conditions: {
    passengers: 1,
    luggageKg: 0,
    initialSoc: 80,
    arrivalSoc: 10,
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
const summary: TripSummaryShape = {
  originLabel: "A",
  destinationLabel: "B",
  distanceKm: 10,
  totalMinutes: 8,
  stops: 0,
  arrivalSoc: 77,
  energyKwh: 1.8,
};

describe("recordArrival (D13)", () => {
  it("con snapshot compara con el plan que se mostró", () => {
    const snapshot = minimalSnapshot();
    const plan = planShown(snapshot, request, summary)!;
    const out = recordArrival(
      { request, summary, snapshot },
      { arrivalSoc: plan.arrivalSoc - 2, energyKwh: 2 },
    );
    expect(out.observation).toMatchObject({
      planId: plan.id,
      modelVersion: "0.1.0-legacy",
      vehicleId: "v1",
      observedEnergyKwh: 2,
    });
    expect(out.observation.observedSoc).toEqual([
      { distanceKm: 0, socPercent: plan.initialSoc },
      { distanceKm: plan.distanceKm, socPercent: plan.arrivalSoc - 2 },
    ]);
    expect(out.predictedArrivalSoc).toBeCloseTo(plan.arrivalSoc, 9);
    expect(out.comparison.socErrors.at(-1)!.error).toBeCloseTo(2, 9);
    expect(out.comparison.consumptionRatio).toBeGreaterThan(1);
  });

  it("sin snapshot (viaje viejo) compara con el resumen guardado; la salida del usuario manda", () => {
    const out = recordArrival(
      { request, summary },
      {
        arrivalSoc: 70,
        departureSoc: 78,
        points: [
          { distanceKm: 5, socPercent: 74 },
          { distanceKm: 50, socPercent: 1 },
        ],
      },
    );
    expect(out.observation.planId).toBe("summary");
    expect(out.observation.modelVersion).toBe("desconocido");
    // El punto fuera de la ruta se descarta.
    expect(out.observation.observedSoc).toEqual([
      { distanceKm: 0, socPercent: 78 },
      { distanceKm: 5, socPercent: 74 },
      { distanceKm: 10, socPercent: 70 },
    ]);
    expect(out.predictedArrivalSoc).toBe(77);
    expect(out.comparison.socErrors.at(-1)!.error).toBeCloseTo(7, 9);
  });
});
