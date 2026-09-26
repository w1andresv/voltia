import { describe, expect, it } from "vitest";
import type { RawRoute } from "@/domain/types";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import { applyElevationProfile, elevationProbes } from "./engine";

function route(n: number, stepKm = 1): RawRoute {
  const samples = Array.from({ length: n }, (_, i) => ({
    km: i * stepKm,
    lat: 7 - i * 0.009,
    lon: -73,
    elevM: 0,
    slopePct: 0,
    speedKmh: 60,
  }));
  return {
    id: "r",
    label: "r",
    geometry: samples.map((s) => ({ lat: s.lat, lon: s.lon })),
    samples,
    distanceKm: (n - 1) * stepKm,
    driveMinutes: 60,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

describe("elevationProbes", () => {
  it("sin tramos no hay nada que consultar", () => {
    expect(elevationProbes(route(1))).toBeNull();
  });

  it("consulta como máximo los puntos del parámetro, incluidos el primero y el último", () => {
    const r = route(300);
    const probes = elevationProbes(r)!;
    expect(probes).toHaveLength(MODEL_PARAMETERS.elevation.probesPerRoute);
    expect(probes[0]).toBe(r.samples[0]);
    expect(probes.at(-1)).toBe(r.samples.at(-1));
    expect(elevationProbes(route(10))).toHaveLength(10);
  });
});

describe("applyElevationProfile", () => {
  it("subida constante: pendiente del 10 % y desnivel acumulado", () => {
    const r = route(11); // 10 km
    const probes = elevationProbes(r)!;
    const heights = probes.map((p) => 100 * p.km); // 100 m por km
    // La media móvil no cambia una recta en el interior; en los extremos promedia con menos vecinos.
    const out = applyElevationProfile(r, probes, heights, { ...MODEL_PARAMETERS.elevation, smoothingWindow: 1 });
    expect(out.samples[5]!.elevM).toBeCloseTo(500, 9);
    expect(out.samples[5]!.slopePct).toBeCloseTo(10, 9);
    expect(out.samples[0]!.elevM).toBeCloseTo(50, 9);
    expect(out.elevation.gainM).toBeCloseTo(900, 9);
    expect(out.elevation.lossM).toBe(0);
    expect(out.elevation.minM).toBeCloseTo(50, 9);
    expect(out.elevation.maxM).toBeCloseTo(950, 9);
  });

  it("interpola entre los puntos consultados y suaviza con la media móvil", () => {
    const r = route(5);
    const probes = [r.samples[0]!, r.samples[4]!];
    const out = applyElevationProfile(r, probes, [0, 400]);
    // Interpolado: 0, 100, 200, 300, 400; media móvil de 5 (medio lado 2).
    expect(out.samples.map((s) => s.elevM)).toEqual([100, 150, 200, 250, 300]);
  });

  it("desniveles menores al umbral no cuentan como subida ni bajada", () => {
    const r = route(4);
    const probes = r.samples;
    const out = applyElevationProfile(r, probes, [0, 1.5, 0, 1.5], { ...MODEL_PARAMETERS.elevation, smoothingWindow: 1 });
    expect(out.elevation.gainM).toBe(0);
    expect(out.elevation.lossM).toBe(0);
  });

  it("no modifica la ruta de entrada", () => {
    const r = route(5);
    const before = JSON.stringify(r);
    applyElevationProfile(r, r.samples, [1, 2, 3, 4, 5]);
    expect(JSON.stringify(r)).toBe(before);
  });
});
