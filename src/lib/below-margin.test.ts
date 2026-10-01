import { describe, expect, it } from "vitest";
import { belowMarginText } from "./below-margin";

describe("belowMarginText", () => {
  it("nada si el plan respeta el margen", () => {
    expect(belowMarginText({ safetyPct: 15, arrivalSoc: 20 })).toBeNull();
  });

  it("dice cuánto baja, dónde, qué se gana y el piso", () => {
    expect(
      belowMarginText({
        safetyPct: 15,
        arrivalSoc: 12.7,
        belowMargin: { lowestSoc: 12.7, points: 2.3, floorPct: 12, reason: "fewer-stops" },
      }),
    ).toBe(
      "Llegas con 13 %, 2 puntos bajo tu margen de 15 %: así te ahorras una parada. El margen es flexible, pero el plan nunca baja de 12 %.",
    );
    expect(
      belowMarginText({
        safetyPct: 15,
        arrivalSoc: 18,
        belowMargin: { lowestSoc: 14, points: 1, floorPct: 12, reason: "no-precharge" },
      }),
    ).toMatch(/^En ruta la batería baja a 14 %, 1 punto bajo .*cargar antes de salir/);
  });

  it("unas décimas bajo el margen no se cuentan como un punto", () => {
    expect(
      belowMarginText({
        safetyPct: 15,
        arrivalSoc: 14.7,
        belowMargin: { lowestSoc: 14.7, points: 0.3, floorPct: 12, reason: "faster" },
      }),
    ).toMatch(/Llegas con 15 %, unas décimas bajo tu margen de 15 %/);
  });

  it("sin motivo, es porque el usuario permitió bajar del margen", () => {
    expect(
      belowMarginText({
        safetyPct: 15,
        arrivalSoc: 20,
        belowMargin: { lowestSoc: 8, points: 7, floorPct: 5 },
      }),
    ).toMatch(/permitiste bajar del margen en ruta.*nunca baja de 5 %/);
  });
});
