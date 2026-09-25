import { describe, expect, it } from "vitest";
import { roadMix } from "@/domain/road-hierarchy";
import { classifyRoute, legBoundariesKm } from "./routing.classify";
import { fakeMapboxRoute } from "./mapbox-fixtures";

describe("classifyRoute (pasos de Mapbox → tramos por clase)", () => {
  it("reparte los km por la clase de cada intersección y une tramos contiguos", () => {
    const route = fakeMapboxRoute([
      ["street", 2, 5],
      ["secondary", 8, 10],
      ["trunk", 60, 45],
      ["primary", 30, 25],
      ["tertiary", 4, 6],
    ]);
    const segments = classifyRoute(route);
    expect(segments.map((s) => s.tier)).toEqual(["local", "secondary", "primary", "tertiary"]);
    const mix = roadMix(segments);
    expect(mix.primary).toBeCloseTo(90, 0);
    expect(mix.secondary).toBeCloseTo(8, 0);
    expect(segments.at(-1)?.endKm).toBeCloseTo(104, 1);
    expect(segments.reduce((a, s) => a + s.durationS, 0)).toBeCloseTo(91 * 60, 0);
  });

  it("sin pasos (OSRM / steps=false) no clasifica", () => {
    expect(
      classifyRoute({
        distance: 1000,
        duration: 60,
        geometry: {
          coordinates: [
            [0, 0],
            [0, 0.01],
          ],
        },
      }),
    ).toEqual([]);
  });

  it("legBoundariesKm ubica los puntos intermedios", () => {
    const a = fakeMapboxRoute([["primary", 40, 30]]);
    const b = fakeMapboxRoute([["primary", 60, 40]]);
    expect(legBoundariesKm({ ...a, legs: [...a.legs, ...b.legs] })).toEqual([40]);
  });
});
