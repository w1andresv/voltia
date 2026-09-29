import { describe, expect, it } from "vitest";
import { elevationAtKm, toElevationGrid } from "./elevation-grid";

describe("rejilla de elevación", () => {
  it("pasa puntos irregulares a una rejilla uniforme y la lee interpolando", () => {
    const g = toElevationGrid([0, 0.25, 1], [100, 150, 100], 1, 0.1)!;
    expect(g.stepKm).toBe(0.1);
    expect(g.elevM).toHaveLength(11);
    expect(g.elevM[0]).toBe(100);
    expect(g.elevM[2]).toBe(140);
    expect(g.elevM[10]).toBe(100);
    expect(elevationAtKm(g, 0.3)).toBeCloseTo(146.7, 1);
    expect(elevationAtKm(g, 0.25)).toBeCloseTo(143.33, 2);
    expect(elevationAtKm(g, -1)).toBe(100);
    expect(elevationAtKm(g, 5)).toBe(100);
  });

  it("sin datos suficientes no arma rejilla", () => {
    expect(toElevationGrid([0], [1], 1, 0.1)).toBeUndefined();
    expect(toElevationGrid([0, 1], [1, 2], 0, 0.1)).toBeUndefined();
  });
});
