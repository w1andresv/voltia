import { describe, expect, it } from "vitest";
import { roadMix } from "@/domain/road-hierarchy";
import { fakeProviderRoute } from "@/test-support/mapbox-fixtures";
import { classifyRoute, legBoundariesKm } from "./classify";

describe("classifyRoute (pasos → tramos por clase vial)", () => {
  it("reparte los km por la clase de cada intersección y une tramos contiguos", () => {
    const route = fakeProviderRoute([
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

  it("no modifica la geometría del proveedor al unir tramos", () => {
    const route = fakeProviderRoute([
      ["trunk", 10, 8],
      ["primary", 10, 8],
    ]);
    const before = JSON.stringify(route);
    classifyRoute(route);
    expect(JSON.stringify(route)).toBe(before);
  });

  it("pasos sin geometría toman la clase de su primera intersección o la anterior", () => {
    const route = fakeProviderRoute([["primary", 10, 8]]);
    route.legs[0]!.steps!.push(
      { distanceM: 2000, durationS: 120, intersections: [{ location: { lat: 6.9, lon: -73 }, roadClass: "tertiary" }] },
      { distanceM: 1000, durationS: 60 },
      { distanceM: 0, durationS: 0 },
    );
    const tiers = classifyRoute(route).map((s) => s.tier);
    expect(tiers).toEqual(["primary", "tertiary", "tertiary"]);
  });

  it("sin pasos (OSRM / steps=false) no clasifica", () => {
    expect(
      classifyRoute({
        provider: "osrm",
        profile: "driving",
        distanceM: 1000,
        durationS: 60,
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0.01, lon: 0 },
        ],
        legs: [],
      }),
    ).toEqual([]);
  });

  it("legBoundariesKm ubica los puntos intermedios", () => {
    const a = fakeProviderRoute([["primary", 40, 30]]);
    const b = fakeProviderRoute([["primary", 60, 40]]);
    expect(legBoundariesKm({ ...a, legs: [...a.legs, ...b.legs] })).toEqual([40]);
    const noDistance = { ...a, legs: [{ ...a.legs[0]!, distanceM: undefined }, ...b.legs] };
    expect(legBoundariesKm(noDistance)).toEqual([40]);
  });
});
