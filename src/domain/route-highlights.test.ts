import { describe, expect, it } from "vitest";
import { routeHighlights } from "./route-highlights";

function plan(
  id: string,
  o: { min: number; km: number; stops: number; soc: number; noTolls?: boolean; feasible?: boolean },
) {
  return {
    id,
    totalMinutes: o.min,
    distanceKm: o.km,
    stops: Array.from({ length: o.stops }) as never[],
    arrivalSoc: o.soc,
    noTolls: o.noTolls,
    feasible: o.feasible ?? true,
  };
}

describe("routeHighlights", () => {
  it("destaca la más rápida, la más corta, la de menos paradas y la de más batería", () => {
    const h = routeHighlights([
      plan("a", { min: 270, km: 214, stops: 1, soc: 20 }),
      plan("b", { min: 300, km: 205, stops: 0, soc: 30 }),
    ]);
    expect(h.get("a")).toEqual(["fastest"]);
    expect(h.get("b")).toEqual(["shortest", "fewest_stops", "best_arrival"]);
  });

  it("no destaca empates (diferencias menores a 1 min / 1 km / 2 %)", () => {
    const h = routeHighlights([
      plan("a", { min: 270, km: 214, stops: 1, soc: 20 }),
      plan("b", { min: 270.5, km: 214.4, stops: 1, soc: 21 }),
    ]);
    expect(h.get("a")).toEqual([]);
    expect(h.get("b")).toEqual([]);
  });

  it("con una sola ruta no hay comparación, pero 'sin peajes' se muestra", () => {
    const h = routeHighlights([plan("a", { min: 270, km: 214, stops: 1, soc: 20, noTolls: true })]);
    expect(h.get("a")).toEqual(["no_tolls"]);
  });

  it("las rutas no viables no compiten", () => {
    const h = routeHighlights([
      plan("a", { min: 200, km: 180, stops: 0, soc: -5, feasible: false }),
      plan("b", { min: 270, km: 214, stops: 1, soc: 20 }),
      plan("c", { min: 290, km: 230, stops: 1, soc: 25 }),
    ]);
    expect(h.get("a")).toEqual([]);
    expect(h.get("b")).toEqual(["fastest", "shortest"]);
    expect(h.get("c")).toEqual(["best_arrival"]);
  });
});

describe("Más vías principales", () => {
  const mix = (primary: number, secondary: number) => ({ primary, secondary, tertiary: 0, local: 0, unpaved: 0, unknown: 0 });
  it("destaca la ruta con mayor % de vías primarias", () => {
    const h = routeHighlights([
      { ...plan("a", { min: 270, km: 214, stops: 1, soc: 20 }), roadMix: mix(200, 14) },
      { ...plan("b", { min: 260, km: 205, stops: 1, soc: 20 }), roadMix: mix(150, 55) },
    ]);
    expect(h.get("a")).toContain("most_primary");
    expect(h.get("b")).not.toContain("most_primary");
  });
});
