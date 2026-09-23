import { describe, expect, it } from "vitest";
import {
  routeOverlap,
  boundsOf,
  cumulativeKm,
  distanceToPolylineKm,
  downsample,
  haversineKm,
  interpolatePoint,
  nearestIndex,
  polylineLengthKm,
  resamplePolyline,
  uniqueByProximity,
} from "./geo";

// Bucaramanga y Bogotá, en línea recta ronda los 290 km.
const BUCARAMANGA = { lat: 7.1193, lon: -73.1227 };
const BOGOTA = { lat: 4.711, lon: -74.0721 };

describe("haversineKm", () => {
  it("mide la distancia recta Bucaramanga–Bogotá cerca de 290 km", () => {
    const km = haversineKm(BUCARAMANGA, BOGOTA);
    expect(km).toBeGreaterThan(270);
    expect(km).toBeLessThan(310);
  });

  it("es cero entre un punto y sí mismo", () => {
    expect(haversineKm(BUCARAMANGA, BUCARAMANGA)).toBeCloseTo(0, 6);
  });
});

describe("polylineLengthKm / cumulativeKm", () => {
  it("suma la distancia entre puntos consecutivos", () => {
    const line = [BUCARAMANGA, BOGOTA];
    const total = polylineLengthKm(line);
    expect(total).toBeCloseTo(haversineKm(BUCARAMANGA, BOGOTA), 6);
  });

  it("cumulativeKm empieza en 0 y termina en la longitud total", () => {
    const line = [BUCARAMANGA, BOGOTA];
    const c = cumulativeKm(line);
    expect(c[0]).toBe(0);
    expect(c[c.length - 1]).toBeCloseTo(polylineLengthKm(line), 6);
  });
});

describe("interpolatePoint", () => {
  it("t=0 da el primer punto y t=1 da el segundo", () => {
    expect(interpolatePoint(BUCARAMANGA, BOGOTA, 0)).toEqual(BUCARAMANGA);
    expect(interpolatePoint(BUCARAMANGA, BOGOTA, 1)).toEqual(BOGOTA);
  });
});

describe("resamplePolyline", () => {
  it("mantiene el punto inicial y final", () => {
    const line = [BUCARAMANGA, BOGOTA];
    const out = resamplePolyline(line, 50);
    expect(out[0]).toEqual(BUCARAMANGA);
    const last = out[out.length - 1]!;
    expect(haversineKm(last, BOGOTA)).toBeLessThan(1);
  });

  it("con menos de 2 puntos devuelve una copia tal cual", () => {
    expect(resamplePolyline([BUCARAMANGA], 10)).toEqual([BUCARAMANGA]);
  });

  it("produce puntos espaciados aproximadamente cada `everyKm`", () => {
    const line = [BUCARAMANGA, BOGOTA];
    const out = resamplePolyline(line, 50);
    for (let i = 1; i < out.length - 1; i++) {
      const d = haversineKm(out[i - 1]!, out[i]!);
      expect(d).toBeGreaterThan(30);
      expect(d).toBeLessThan(70);
    }
  });
});

describe("distanceToPolylineKm / nearestIndex", () => {
  const line = [BUCARAMANGA, { lat: 6, lon: -73.6 }, BOGOTA];

  it("da 0 cuando el punto está sobre la línea", () => {
    expect(distanceToPolylineKm(BUCARAMANGA, line)).toBeCloseTo(0, 6);
  });

  it("nearestIndex encuentra el vértice más cercano", () => {
    expect(nearestIndex(BOGOTA, line)).toBe(2);
    expect(nearestIndex(BUCARAMANGA, line)).toBe(0);
  });
});

describe("boundsOf", () => {
  it("cubre todos los puntos con el margen dado", () => {
    const b = boundsOf([BUCARAMANGA, BOGOTA], 0.1);
    expect(b.minLat).toBeLessThanOrEqual(Math.min(BUCARAMANGA.lat, BOGOTA.lat));
    expect(b.maxLat).toBeGreaterThanOrEqual(Math.max(BUCARAMANGA.lat, BOGOTA.lat));
    expect(b.minLon).toBeLessThanOrEqual(Math.min(BUCARAMANGA.lon, BOGOTA.lon));
    expect(b.maxLon).toBeGreaterThanOrEqual(Math.max(BUCARAMANGA.lon, BOGOTA.lon));
  });
});

describe("downsample", () => {
  it("no cambia el arreglo si ya cabe en el máximo", () => {
    const items = [1, 2, 3];
    expect(downsample(items, 5)).toEqual(items);
  });

  it("reduce al máximo pedido conservando extremos", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const out = downsample(items, 10);
    expect(out.length).toBe(10);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(99);
  });
});

describe("uniqueByProximity", () => {
  it("descarta puntos a menos de minKm del primero que se guardó", () => {
    const items = [BUCARAMANGA, { ...BUCARAMANGA, lat: BUCARAMANGA.lat + 0.001 }, BOGOTA];
    const out = uniqueByProximity(items, 1);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(BUCARAMANGA);
    expect(out[1]).toEqual(BOGOTA);
  });
});

describe("routeOverlap", () => {
  const line = (bend: number) => [
    { lat: 6.99, lon: -73.05 },
    { lat: 6.5, lon: -73.36 + bend },
    { lat: 6.01, lon: -73.67 },
  ];
  it("una ruta consigo misma se solapa 100 %", () => {
    expect(routeOverlap(line(0), line(0))).toBe(1);
  });
  it("rutas por vías distintas se solapan poco", () => {
    expect(routeOverlap(line(0), line(0.4))).toBeLessThan(0.3);
  });
});
