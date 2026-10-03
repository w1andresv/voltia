import { describe, expect, it } from "vitest";
import type { EnergySample } from "@/domain/ev/contracts/energy";
import { withEnergyMargin } from "./margin";

const samples: EnergySample[] = [
  { km: 0, lat: 7, lon: -73, elevM: 0, slopePct: 0, speedKmh: 60, energyKwh: 0, energyGrossKwh: 0, energyRegenKwh: 0, cumulativeKwh: 0, avgKwhPer100: 0 },
  { km: 1, lat: 7, lon: -73, elevM: 0, slopePct: 0, speedKmh: 60, energyKwh: 1.5, energyGrossKwh: 1.5, energyRegenKwh: 0, cumulativeKwh: 1.5, avgKwhPer100: 0 },
  { km: 2, lat: 7, lon: -73, elevM: 0, slopePct: 0, speedKmh: 60, energyKwh: -0.5, energyGrossKwh: 0.5, energyRegenKwh: 1, cumulativeKwh: 1, avgKwhPer100: 0 },
];

describe("withEnergyMargin (M2.3)", () => {
  it("con 0 (o sin margen) devuelve las mismas muestras", () => {
    expect(withEnergyMargin(samples, 0)).toBe(samples);
    expect(withEnergyMargin(samples, -5)).toBe(samples);
  });

  it("escala la energía bruta y no la regeneración; la acumulada se recalcula", () => {
    const out = withEnergyMargin(samples, 10);
    expect(out[1]!.energyGrossKwh).toBeCloseTo(1.65, 12);
    expect(out[1]!.energyKwh).toBeCloseTo(1.65, 12);
    // Bajada: gasta 10 % más bruto (0,55) pero recupera lo mismo (1): neto −0,45.
    expect(out[2]!.energyGrossKwh).toBeCloseTo(0.55, 12);
    expect(out[2]!.energyRegenKwh).toBe(1);
    expect(out[2]!.energyKwh).toBeCloseTo(-0.45, 12);
    expect(out[2]!.cumulativeKwh).toBeCloseTo(1.2, 12);
    expect(out[0]).toMatchObject({ energyKwh: 0, energyGrossKwh: 0, cumulativeKwh: 0 });
  });

  it("no modifica las muestras originales", () => {
    const before = JSON.stringify(samples);
    withEnergyMargin(samples, 25);
    expect(JSON.stringify(samples)).toBe(before);
  });
});
