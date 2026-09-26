import { describe, expect, it } from "vitest";
import type { RawRoute } from "@/domain/types";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import {
  adaptiveRefinement,
  applyDenseElevationProfile,
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

/** Un cerro: sube 400 m del km 4 al 6 y baja al km 8; plano el resto. */
const hill = (km: number) =>
  km < 4 || km > 8 ? 1000 : km <= 6 ? 1000 + 200 * (km - 4) : 1400 - 200 * (km - 6);

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
  it("con una malla de 100 m el cerro da ~400 m de subida y de bajada, y cada muestra su altura", () => {
    const r = route(12);
    const mesh = elevationMesh(r, 100);
    const out = applyDenseElevationProfile(
      r,
      mesh,
      mesh.map((p) => hill(p.km)),
      MODEL_PARAMETERS.elevation,
    );
    expect(out.elevation.gainM).toBeGreaterThan(380);
    expect(out.elevation.gainM).toBeLessThanOrEqual(400);
    expect(out.elevation.lossM).toBeCloseTo(out.elevation.gainM, 6);
    expect(out.elevation.minM).toBeCloseTo(1000, 6);
    expect(out.elevation.maxM).toBeGreaterThan(1370);
    expect(out.samples[5]!.elevM).toBeCloseTo(1200, 6);
    // Del km 4 al 5 sube 200 m; el suavizado de 300 m redondea el quiebre del km 4.
    expect(out.samples[5]!.slopePct).toBeGreaterThan(19);
    expect(out.samples[5]!.slopePct).toBeLessThanOrEqual(20);
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
