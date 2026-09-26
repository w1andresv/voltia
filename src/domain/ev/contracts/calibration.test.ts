import { describe, expect, it } from "vitest";
import { TripObservationSchema, compareObservation } from "./calibration";

const plan = {
  energyKwh: 20,
  samples: [
    { km: 0, soc: 80 },
    { km: 50, soc: 65 },
    { km: 100, soc: 50 },
  ],
};

describe("contrato de calibración (TripObservation)", () => {
  it("valida lo mínimo: plan, modelo, vehículo y al menos dos SOC observados", () => {
    const ok = {
      planId: "route-0",
      modelVersion: "0.1.0-legacy",
      vehicleId: "mg-s5-ev-deluxe",
      conditions: { initialSoc: 80 },
      observedSoc: [
        { distanceKm: 0, socPercent: 80 },
        { distanceKm: 100, socPercent: 46 },
      ],
    };
    expect(TripObservationSchema.safeParse(ok).success).toBe(true);
    expect(
      TripObservationSchema.safeParse({ ...ok, observedSoc: ok.observedSoc.slice(0, 1) }).success,
    ).toBe(false);
    expect(
      TripObservationSchema.safeParse({
        ...ok,
        observedSoc: [{ distanceKm: 0, socPercent: 120 }, ok.observedSoc[1]],
      }).success,
    ).toBe(false);
  });

  it("compara SOC predicho y observado, y el consumo relativo", () => {
    const out = compareObservation(plan, {
      observedSoc: [
        { distanceKm: 100, socPercent: 46 },
        { distanceKm: 0, socPercent: 80 },
        { distanceKm: 25, socPercent: 72 },
      ],
      observedEnergyKwh: 21.5,
    });
    expect(out.socErrors.map((e) => e.distanceKm)).toEqual([0, 25, 100]);
    expect(out.socErrors[1]!.predicted).toBeCloseTo(72.5, 9);
    expect(out.socErrors[2]!.error).toBeCloseTo(4, 9); // el plan fue optimista por 4 puntos
    expect(out.maxAbsSocError).toBeCloseTo(4, 9);
    expect(out.meanAbsSocError).toBeCloseTo((0 + 0.5 + 4) / 3, 9);
    expect(out.energyErrorKwh).toBeCloseTo(-1.5, 9);
    expect(out.consumptionRatio).toBeCloseTo(34 / 30, 9);
  });

  it("con una carga en medio, la cuenta la suma a ambas caídas", () => {
    const out = compareObservation(
      plan,
      {
        observedSoc: [
          { distanceKm: 0, socPercent: 80 },
          { distanceKm: 100, socPercent: 70 },
        ],
      },
      20,
    );
    expect(out.consumptionRatio).toBeCloseTo(30 / 50, 9);
    expect(out).not.toHaveProperty("energyErrorKwh");
  });
});
