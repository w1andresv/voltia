import { describe, expect, it } from "vitest";
import type { RawRoute } from "@/domain/types";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import {
  adaptiveRefinement,
  applyDenseElevationProfile,
  cleanElevationProfile,
  elevationMesh,
  hysteresisGainLoss,
  type ElevationProbe,
} from "./engine";

const KM_PER_DEG = 111.195; // haversine con radio 6371 km

/** Ruta recta hacia el norte de `km`, muestras cada `stepKm` y geometría cada 0,5 km. */
function route(km: number, stepKm = 1): RawRoute {
  const at = (d: number) => ({ lat: 7 + d / KM_PER_DEG, lon: -73 });
  const samples = Array.from({ length: Math.round(km / stepKm) + 1 }, (_, i) => ({
    km: i * stepKm,
    ...at(i * stepKm),
    elevM: 0,
    slopePct: 0,
    speedKmh: 80,
  }));
  return {
    id: "r",
    label: "r",
    geometry: Array.from({ length: km * 2 + 1 }, (_, i) => at(i / 2)),
    samples,
    distanceKm: km,
    driveMinutes: km,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

/** Un cerro: sube 200 m del km 4 al 6 (10 %) y baja al km 8; plano el resto. */
const hill = (km: number) =>
  km < 4 || km > 8 ? 1000 : km <= 6 ? 1000 + 100 * (km - 4) : 1200 - 100 * (km - 6);

describe("elevationMesh", () => {
  it("un punto cada spacingM sobre la geometría, con el km en el eje de la ruta", () => {
    const mesh = elevationMesh(route(10), 100);
    expect(mesh).toHaveLength(101);
    expect(mesh[0]!.km).toBe(0);
    expect(mesh[100]!.km).toBeCloseTo(10, 9);
    expect(mesh[37]!.km).toBeCloseTo(3.7, 9);
    expect(mesh[37]!.lat).toBeCloseTo(7 + 3.7 / KM_PER_DEG, 5);
  });

  it("vacía sin tramos o sin espaciado", () => {
    expect(
      elevationMesh({ ...route(1), geometry: [], samples: route(1).samples.slice(0, 1) }, 100),
    ).toEqual([]);
    expect(elevationMesh(route(1), 0)).toEqual([]);
  });
});

describe("adaptiveRefinement", () => {
  const params = { coarseSpacingM: 1000, fineSpacingM: 200, refineDeltaM: 15, maxProbes: 1500 };

  it("densifica solo donde la altura cambia", () => {
    const r = route(10);
    const coarse = elevationMesh(r, 1000);
    const extra = adaptiveRefinement(
      r,
      coarse,
      coarse.map((p) => hill(p.km)),
      params,
    );
    // Cuatro tramos del cerro (4–8 km) × 4 puntos intermedios cada 200 m.
    expect(extra).toHaveLength(16);
    expect(extra.every((p) => p.km > 4 && p.km < 8)).toBe(true);
    expect(extra.map((p) => p.km)).toEqual([...extra.map((p) => p.km)].sort((a, b) => a - b));
  });

  it("respeta el tope, priorizando el tramo con más cambio", () => {
    const r = route(10);
    const coarse = elevationMesh(r, 1000);
    const heights = coarse.map((p) => (p.km === 2 ? 1100 : p.km === 7 ? 1030 : 1000));
    const extra = adaptiveRefinement(r, coarse, heights, {
      ...params,
      maxProbes: coarse.length + 8,
    });
    expect(extra).toHaveLength(8);
    expect(extra.every((p) => p.km > 1 && p.km < 3)).toBe(true);
  });
});

describe("hysteresisGainLoss", () => {
  it("ignora el ruido menor que el umbral y suma los cambios reales", () => {
    expect(hysteresisGainLoss([100, 102, 99, 101, 100], 5)).toEqual({ gainM: 0, lossM: 0 });
    expect(hysteresisGainLoss([100, 110, 108, 130, 90], 5)).toEqual({ gainM: 30, lossM: 40 });
    expect(hysteresisGainLoss([], 5)).toEqual({ gainM: 0, lossM: 0 });
  });
});

describe("applyDenseElevationProfile", () => {
  it("con una malla de 100 m el cerro da ~200 m de subida y de bajada, y cada muestra su altura", () => {
    const r = route(12);
    const mesh = elevationMesh(r, 100);
    const out = applyDenseElevationProfile(
      r,
      mesh,
      mesh.map((p) => hill(p.km)),
      MODEL_PARAMETERS.elevation,
    );
    expect(out.elevation.gainM).toBeGreaterThan(185);
    expect(out.elevation.gainM).toBeLessThanOrEqual(200);
    // La histéresis puede dejar unos metros de diferencia entre subida y bajada.
    expect(Math.abs(out.elevation.lossM - out.elevation.gainM)).toBeLessThan(5);
    expect(out.elevation.minM).toBeCloseTo(1000, 6);
    expect(out.elevation.maxM).toBeGreaterThan(1185);
    expect(out.elevation.correctedPoints).toBeUndefined();
    expect(out.samples[5]!.elevM).toBeCloseTo(1100, 6);
    // Del km 4 al 5 sube 100 m; el suavizado de 300 m redondea el quiebre del km 4.
    expect(out.samples[5]!.slopePct).toBeGreaterThan(9.5);
    expect(out.samples[5]!.slopePct).toBeLessThanOrEqual(10);
    expect(out.samples[0]!.elevM).toBeCloseTo(1000, 6);
  });

  it("acepta puntos desordenados (gruesos + densos) y no toca una ruta sin muestras", () => {
    const r = route(4);
    const probes: ElevationProbe[] = [
      { lat: 0, lon: 0, km: 4 },
      { lat: 0, lon: 0, km: 0 },
      { lat: 0, lon: 0, km: 2 },
    ];
    const out = applyDenseElevationProfile(r, probes, [1400, 1000, 1200], {
      ...MODEL_PARAMETERS.elevation,
      dense: { smoothingM: 0, hysteresisM: 5 },
    });
    expect(out.samples.map((s) => s.elevM)).toEqual([1000, 1100, 1200, 1300, 1400]);
    const empty = { ...r, samples: r.samples.slice(0, 1) };
    expect(applyDenseElevationProfile(empty, probes, [1, 2, 3])).toBe(empty);
  });
});

describe("cleanElevationProfile (F2b)", () => {
  const km = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];

  it("en un túnel la altura es la recta entre la entrada y la salida", () => {
    // La montaña encima del túnel sube 60 m; la vía va de 1000 a 1006.
    const h = [1000, 1001, 1030, 1060, 1030, 1006, 1006];
    const out = cleanElevationProfile(km, h, [{ kind: "tunnel", fromKm: 0.1, toKm: 0.5 }], 15);
    expect(out.heights.map((v) => Math.round(v * 10) / 10)).toEqual([
      1000, 1001, 1002.3, 1003.5, 1004.8, 1006, 1006,
    ]);
    expect(out.corrected).toBe(3);
  });

  it("recorta una pendiente imposible (pico o hueco del terreno)", () => {
    const h = [1000, 1000, 960, 1000, 1000, 1000, 1000]; // hueco de 40 m en 100 m (40 %)
    const out = cleanElevationProfile(km, h, [], 15);
    expect(out.heights[2]).toBeCloseTo(985, 9);
    expect(out.heights[3]).toBeCloseTo(1000, 9);
    expect(out.corrected).toBe(1);
  });

  it("sin túneles ni pendientes imposibles no cambia nada", () => {
    const h = [1000, 1005, 1010, 1012, 1008, 1004, 1000];
    expect(cleanElevationProfile(km, h, [], 15)).toEqual({ heights: h, corrected: 0 });
    expect(cleanElevationProfile(km, h, undefined, 0).corrected).toBe(0);
  });

  it("applyDenseElevationProfile limpia y cuenta los puntos corregidos", () => {
    const r = { ...route(2), structures: [{ kind: "tunnel" as const, fromKm: 0.5, toKm: 1.5 }] };
    const mesh = elevationMesh(r, 100);
    const mountain = mesh.map((p) =>
      p.km > 0.5 && p.km < 1.5 ? 1000 + 100 * Math.sin(Math.PI * (p.km - 0.5)) : 1000,
    );
    const out = applyDenseElevationProfile(r, mesh, mountain, MODEL_PARAMETERS.elevation);
    expect(out.elevation.maxM).toBeCloseTo(1000, 6);
    expect(out.elevation.correctedPoints).toBeGreaterThan(0);
  });
});
