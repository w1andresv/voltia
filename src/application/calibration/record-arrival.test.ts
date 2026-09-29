import { describe, expect, it } from "vitest";
import { minimalSnapshot } from "@/test-support/snapshot-fixture";
import { tripRequest as request, tripSummary as summary } from "@/test-support/trip-fixture";
import { planShown, recordArrival } from "./record-arrival";

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
