import { describe, expect, it } from "vitest";
import { fineRouteLine } from "@/domain/ev/core/axis";
import * as zigzag from "@/test-support/zigzag-route";
import { nearestSampleByKm, placeOnRoute, projectOnRoute, stationsNearRoutes } from "./engine";

// Norte–sur a lo largo de lon −73, muestras cada ~11 km.
const route = [0, 0.1, 0.2].map((d, i) => ({ lat: 7 + d, lon: -73, km: i * 11.06 }));

describe("projectOnRoute", () => {
  it("mide contra el segmento, no contra el vértice", () => {
    // A mitad del primer segmento, 1 km al este: el vértice más cercano está a ~5,6 km.
    const p = projectOnRoute({ lat: 7.05, lon: -73 + 1 / 110.4 }, route)!;
    expect(p.lateralKm).toBeCloseTo(1, 1);
    expect(p.alongKm).toBeCloseTo(5.53, 1);
    expect([0, 1]).toContain(p.sampleIndex);
  });

  it("la muestra asignada es la más cercana a lo largo de la ruta", () => {
    expect(projectOnRoute({ lat: 7.08, lon: -73.01 }, route)!.sampleIndex).toBe(1);
    expect(projectOnRoute({ lat: 7.02, lon: -73.01 }, route)!.sampleIndex).toBe(0);
  });

  it("antes del origen se proyecta al origen", () => {
    const p = projectOnRoute({ lat: 6.9, lon: -73 }, route)!;
    expect(p.alongKm).toBe(0);
    expect(p.lateralKm).toBeCloseTo(11.06, 1);
  });

  it("sin muestras no hay proyección; con una, la distancia a ella", () => {
    expect(projectOnRoute({ lat: 7, lon: -73 }, [])).toBeNull();
    expect(projectOnRoute({ lat: 7.01, lon: -73 }, [route[0]!])!.lateralKm).toBeCloseTo(1.1, 1);
  });
});

describe("stationsNearRoutes", () => {
  const near = { id: "near", lat: 7.05, lon: -73.05 }; // ~5,5 km
  const edge = { id: "edge", lat: 7.05, lon: -73.15 }; // ~16,5 km: dentro de la caja, fuera del radio
  const far = { id: "far", lat: 8, lon: -73 }; // fuera de la caja

  it("sin rutas o sin estaciones no devuelve nada", () => {
    expect(stationsNearRoutes([near], [], 12)).toEqual([]);
    expect(stationsNearRoutes([near], [[]], 12)).toEqual([]);
    expect(stationsNearRoutes([], [route], 12)).toEqual([]);
  });

  it("incluye las que están a menos de maxKm y excluye las lejanas", () => {
    expect(stationsNearRoutes([near, edge, far], [route], 12).map((s) => s.id)).toEqual(["near"]);
  });

  it("evalúa cada ruta por separado y une el resultado en el orden de entrada", () => {
    const other = [0, 0.1].map((d, i) => ({ lat: 8 + d, lon: -73, km: i * 11 }));
    expect(stationsNearRoutes([far, near], [route, other], 12).map((s) => s.id)).toEqual([
      "far",
      "near",
    ]);
  });

  it("no une las rutas en una línea: un punto entre dos rutas no queda cerca de un segmento falso", () => {
    const west = [0, 0.1].map((d, i) => ({ lat: 7 + d, lon: -74, km: i * 11 }));
    const east = [0, 0.1].map((d, i) => ({ lat: 7 + d, lon: -72, km: i * 11 }));
    // Entre el final de "west" y el inicio de "east" (a ~55 km de ambas).
    expect(stationsNearRoutes([{ id: "gap", lat: 7.05, lon: -73 }], [west, east], 12)).toEqual([]);
  });
});

describe("placeOnRoute", () => {
  it("ubica, filtra por distancia y ordena por km; el desvío es 2 × distancia × factor", () => {
    const out = placeOnRoute(
      [
        { id: "b", lat: 7.19, lon: -73.02 },
        { id: "a", lat: 7.01, lon: -73.02 },
        { id: "lejos", lat: 7.1, lon: -73.5 },
      ],
      route,
      { maxKm: 12, detourRoadFactor: 1.3 },
    );
    expect(out.map((o) => o.id)).toEqual(["a", "b"]);
    expect(out[0]!.detourKm).toBeCloseTo(2 * out[0]!.fromRouteKm * 1.3, 12);
    expect(out[0]!.nearestKm).toBe(route[out[0]!.nearestSampleIndex]!.km);
  });
});

describe("placeOnRoute con desvíos medidos (F4)", () => {
  it("usa la distancia y el tiempo medidos por vía cuando los hay", () => {
    const samples = [0, 1, 2, 3].map((km) => ({ km, lat: 7 + km / 111.195, lon: -73 }));
    const items = [
      { id: "m", lat: 7 + 1 / 111.195, lon: -72.99 },
      { id: "e", lat: 7 + 2 / 111.195, lon: -72.99 },
    ];
    const out = placeOnRoute(items, samples, {
      maxKm: 12,
      detourRoadFactor: 1,
      measured: { m: { distanceKm: 3.4, durationMin: 6 } },
    });
    expect(out[0]).toMatchObject({
      id: "m",
      detourKm: 3.4,
      detourMinutes: 6,
      detourSource: "calculated",
    });
    expect(out[1]!.detourSource).toBe("estimated");
    expect(out[1]!.detourMinutes).toBeUndefined();
    expect(out[1]!.detourKm).toBeCloseTo(2 * out[1]!.fromRouteKm, 9);
  });
});

describe("línea fina de la ruta (M5, ADR-0027)", () => {
  // Cuerda norte–sur de 100 km con muestras en 0, 30, 70 y 100; la vía real hace una herradura al este.
  it("nearestSampleByKm: la muestra más cercana por km; a igual distancia, la anterior", () => {
    const samples = [0, 20, 40, 60].map((km) => ({ km }));
    expect(nearestSampleByKm(samples, -5)).toBe(0);
    expect(nearestSampleByKm(samples, 9)).toBe(0);
    expect(nearestSampleByKm(samples, 10)).toBe(0);
    expect(nearestSampleByKm(samples, 10.1)).toBe(1);
    expect(nearestSampleByKm(samples, 59)).toBe(3);
    expect(nearestSampleByKm(samples, 500)).toBe(3);
    expect(nearestSampleByKm([{ km: 7 }], 7)).toBe(0);
  });

  const opts = { maxKm: 12, detourRoadFactor: 1 };

  it("una estación sobre la vía, en la punta de una herradura: contra las muestras queda a 16 km; contra la línea fina, a 0", () => {
    const { zigzagRoute, atTip } = zigzag;
    const raw = zigzagRoute();
    const tip = { id: "tip", ...atTip(0) };
    // Contra las muestras (la cuerda): fuera del radio de 12 km, no se considera.
    expect(placeOnRoute([tip], raw.samples, opts)).toEqual([]);
    // Contra la línea fina: sobre la vía, en el km 50 → la muestra más cercana por km es la del km 30 o 70.
    const [placed] = placeOnRoute([tip], raw.samples, { ...opts, line: fineRouteLine(raw) });
    expect(placed!.fromRouteKm).toBeLessThan(0.1);
    expect(placed!.detourKm).toBeLessThan(0.2);
    expect(placed!.alongKm).toBeCloseTo(50, 0);
    expect([30, 70]).toContain(placed!.nearestKm);
  });

  it("una estación a 3 km de la punta: el desvío es el real a la vía, no a la cuerda", () => {
    const { zigzagRoute, atTip } = zigzag;
    const raw = zigzagRoute();
    const near = { id: "near", ...atTip(-3) };
    const fine = placeOnRoute([near], raw.samples, { ...opts, line: fineRouteLine(raw) })[0]!;
    expect(fine.fromRouteKm).toBeGreaterThan(2);
    expect(fine.fromRouteKm).toBeLessThan(4);
    expect(fine.detourKm).toBeCloseTo(2 * fine.fromRouteKm, 9);
  });

  it("sin línea fina, el resultado es el de siempre y no trae `alongKm`", () => {
    const placed = placeOnRoute([{ id: "x", lat: 7.05, lon: -73.05 }], route, { maxKm: 12, detourRoadFactor: 1 });
    expect(placed).toHaveLength(1);
    expect("alongKm" in placed[0]!).toBe(false);
  });

  it("en una ruta recta, la línea fina y las muestras dan lo mismo", () => {
    const pts = { lat: 7.07, lon: -73.03 };
    const a = placeOnRoute([{ id: "s", ...pts }], route, { maxKm: 12, detourRoadFactor: 1 })[0]!;
    const b = placeOnRoute([{ id: "s", ...pts }], route, { maxKm: 12, detourRoadFactor: 1, line: route })[0]!;
    expect(b.fromRouteKm).toBeCloseTo(a.fromRouteKm, 9);
    expect(b.nearestSampleIndex).toBe(a.nearestSampleIndex);
    expect(b.nearestKm).toBe(a.nearestKm);
  });
});
