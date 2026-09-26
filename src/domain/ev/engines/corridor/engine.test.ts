import { describe, expect, it } from "vitest";
import { placeOnRoute, projectOnRoute, stationsNearRoutes } from "./engine";

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
    expect(stationsNearRoutes([far, near], [route, other], 12).map((s) => s.id)).toEqual(["far", "near"]);
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
