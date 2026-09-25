import { describe, expect, it } from "vitest";
import { conditionWarnings, previewDelta } from "./conditions-advice";
import { DEFAULT_CONDITIONS, type TripConditions } from "./types";

const c = (p: Partial<TripConditions>): TripConditions => ({ ...DEFAULT_CONDITIONS, ...p });

describe("conditionWarnings", () => {
  it("sin contradicciones no avisa", () => {
    expect(conditionWarnings(c({ planningMode: "safer", safetyMode: "conservative" }))).toEqual([]);
  });

  it("avisa la combinación de la captura: Más segura + Bajo 10 % + permitir bajar", () => {
    const w = conditionWarnings(
      c({ planningMode: "safer", safetyMode: "low", allowBelowSafety: true }),
    );
    expect(w.map((x) => x.level)).toEqual(["danger", "warn"]);
    expect(w[1]?.text).toContain("10 %");
  });

  it("eficiente con conducción deportiva", () => {
    expect(conditionWarnings(c({ planningMode: "efficient", drivingStyle: "sport" }))).toHaveLength(
      1,
    );
  });
});

describe("previewDelta", () => {
  const base = {
    energyKwh: 40,
    totalMinutes: 300,
    stops: [{}] as never[],
    arrivalSoc: 20,
    feasible: true,
  };
  it("resume cambios de energía, tiempo y paradas", () => {
    expect(
      previewDelta(base, {
        ...base,
        energyKwh: 45.6,
        totalMinutes: 285,
        stops: [{}, {}] as never[],
      }),
    ).toBe("+14 % kWh · −15 min · 2 paradas");
  });
  it("sin cambios apreciables", () => {
    expect(previewDelta(base, { ...base, energyKwh: 40.2 })).toBe("Sin cambios en esta ruta");
  });
  it("avisa si con esa opción no alcanza", () => {
    expect(previewDelta(base, { ...base, feasible: false })).toContain("No alcanza");
  });
});
