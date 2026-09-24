import { describe, expect, it } from "vitest";
import {
  accessZones,
  findShortcuts,
  formatRoadMix,
  hierarchyCostS,
  primaryShare,
  roadMix,
  tierOfClass,
  type RoadSegment,
  type RoadTier,
} from "./road-hierarchy";

function seg(tier: RoadTier, startKm: number, endKm: number, minutes: number): RoadSegment {
  return {
    tier,
    startKm,
    endKm,
    durationS: minutes * 60,
    line: [
      { lat: 7 - startKm / 111.32, lon: -73 },
      { lat: 7 - endKm / 111.32, lon: -73 },
    ],
  };
}

describe("tierOfClass (clasificación del proveedor, no velocidad)", () => {
  it("agrupa las clases de Mapbox Streets v8", () => {
    expect(tierOfClass("motorway")).toBe("primary");
    expect(tierOfClass("trunk_link")).toBe("primary");
    expect(tierOfClass("primary")).toBe("primary");
    expect(tierOfClass("secondary_link")).toBe("secondary");
    expect(tierOfClass("tertiary")).toBe("tertiary");
    expect(tierOfClass("street")).toBe("local");
    expect(tierOfClass("service")).toBe("local");
    expect(tierOfClass("track")).toBe("unpaved");
    expect(tierOfClass(undefined)).toBe("unknown");
  });
});

describe("hierarchyCostS: penalización progresiva", () => {
  const zones = accessZones(100);

  it("Primaria > Secundaria > Terciaria > Local para el mismo tiempo", () => {
    const cost = (t: RoadTier) =>
      hierarchyCostS(
        [seg("primary", 0, 20, 10), seg(t, 20, 80, 60), seg("primary", 80, 100, 10)],
        zones,
      );
    expect(cost("primary")).toBeLessThan(cost("secondary"));
    expect(cost("secondary")).toBeLessThan(cost("tertiary"));
    expect(cost("tertiary")).toBeLessThan(cost("local"));
    expect(cost("local")).toBeLessThan(cost("unpaved"));
  });

  it("no castiga las vías menores en los accesos (primeros y últimos 5 km)", () => {
    const withAccess = [seg("local", 0, 4, 6), seg("primary", 4, 96, 70), seg("local", 96, 100, 6)];
    expect(hierarchyCostS(withAccess, zones)).toBeCloseTo((6 + 70 + 6) * 60, 5);
  });

  it("tampoco alrededor de un punto intermedio (electrolinera): ±12 km", () => {
    const z = accessZones(100, [50]);
    const toCharger = [
      seg("primary", 0, 40, 30),
      seg("secondary", 40, 60, 20),
      seg("primary", 60, 100, 30),
    ];
    expect(hierarchyCostS(toCharger, z)).toBeCloseTo(80 * 60, 5);
  });

  it("sin clasificación, el costo es el tiempo real", () => {
    expect(hierarchyCostS([seg("unknown", 0, 100, 90)], zones)).toBe(90 * 60);
  });
});

describe("findShortcuts", () => {
  const zones = accessZones(120);

  it("encuentra atajos por vías menores fuera de los accesos, el peor primero", () => {
    const segments = [
      seg("local", 0, 3, 5), // acceso: no cuenta
      seg("primary", 3, 40, 25),
      seg("secondary", 40, 50, 10),
      seg("primary", 50, 70, 15),
      seg("tertiary", 70, 75, 8),
      seg("primary", 75, 117, 30),
      seg("local", 117, 120, 5), // acceso
    ];
    const found = findShortcuts(segments, zones);
    expect(found.map((f) => [f.tier, Math.round(f.km)])).toEqual([
      ["tertiary", 5],
      ["secondary", 10],
    ]);
    expect(found[0]?.point.lat).toBeLessThan(7);
  });

  it("ignora tramos menores de 2 km", () => {
    expect(
      findShortcuts(
        [seg("primary", 0, 50, 30), seg("tertiary", 50, 51.5, 3), seg("primary", 51.5, 120, 40)],
        zones,
      ),
    ).toEqual([]);
  });
});

describe("mezcla de vías", () => {
  it("resume km por nivel y el % principal", () => {
    const mix = roadMix([
      seg("primary", 0, 84, 60),
      seg("secondary", 84, 96, 12),
      seg("local", 96, 100, 6),
    ]);
    expect(primaryShare(mix)).toBeCloseTo(0.84, 2);
    expect(formatRoadMix(mix)).toBe("84 % principal · 12 % secundaria · 4 % local");
  });
});
