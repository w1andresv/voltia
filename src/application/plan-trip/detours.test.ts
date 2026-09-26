import { describe, expect, it, vi } from "vitest";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import type { DistanceMatrixProvider } from "@/domain/ports/distance-matrix";
import type { Charger, LatLon, RawRoute } from "@/domain/types";
import { catalogVehicle } from "@/test-support/scenarios";
import { measureDetours } from "./detours";

const KM_PER_DEG = 111.195;
function route(id: string): RawRoute {
  const samples = Array.from({ length: 21 }, (_, i) => ({
    km: i * 5,
    lat: 7 + (i * 5) / KM_PER_DEG,
    lon: -73,
    elevM: 0,
    slopePct: 0,
    speedKmh: 80,
  }));
  return {
    id,
    label: id,
    geometry: samples.map(({ lat, lon }) => ({ lat, lon })),
    samples,
    distanceKm: 100,
    driveMinutes: 75,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}
const station = (
  id: string,
  km: number,
  lateralKm: number,
  connector: "ccs2" | "chademo" = "ccs2",
): Charger => ({
  id,
  name: id,
  lat: 7 + km / KM_PER_DEG,
  lon: -73 + lateralKm / (111.32 * Math.cos((7 * Math.PI) / 180)),
  sockets: [{ connector, powerKw: 60, count: 2, current: "DC" }],
  source: "osm",
  verified: true,
});

/** Matriz falsa: ida 1,5 × y vuelta 1,2 × la distancia en grados, en km. */
function fakeMatrix(max = 25, fail?: (call: number) => boolean) {
  let calls = 0;
  const provider: DistanceMatrixProvider = {
    id: "fake",
    maxCoordinates: max,
    matrix: vi.fn(async (sources: LatLon[], destinations: LatLon[]) => {
      calls++;
      if (fail?.(calls)) throw new Error("sin cupo");
      const toStation = Math.abs(sources[0]!.lon - -73) < 1e-9; // origen en la ruta
      const f = toStation ? 1500 : 1200;
      const d = sources.map((a) =>
        destinations.map((b) => Math.hypot(a.lat - b.lat, a.lon - b.lon) * 111 * f),
      );
      return { distanceM: d, durationS: d.map((row) => row.map((m) => m / 10)) };
    }),
  };
  return provider;
}

describe("measureDetours", () => {
  const vehicle = catalogVehicle("mg-s5-ev-deluxe");

  it("mide ida y vuelta de las estaciones compatibles, por ruta, en pares", async () => {
    const chargers = [
      station("a", 20, 2),
      station("b", 60, 4),
      station("chademo", 40, 1, "chademo"),
      station("on-route", 30, 0.01),
    ];
    const matrix = fakeMatrix();
    const { detours, report } = await measureDetours(
      matrix,
      [route("r0"), route("r1")],
      chargers,
      vehicle,
      MODEL_PARAMETERS,
    );
    // "chademo" no es compatible y "on-route" está sobre la vía: no se miden.
    expect(Object.keys(detours).sort()).toEqual(["r0|a", "r0|b", "r1|a", "r1|b"]);
    expect(detours["r0|a"]!.distanceKm).toBeCloseTo(2 * 1.5 + 2 * 1.2, 1);
    expect(detours["r0|a"]!.durationMin).toBeCloseTo(
      (detours["r0|a"]!.distanceKm * 1000) / 10 / 60,
      6,
    );
    expect(report).toEqual({ measured: 4, requests: 2, failedBatches: 0 });
  });

  it("parte en lotes según el máximo de coordenadas y respeta el tope por ruta", async () => {
    const chargers = Array.from({ length: 10 }, (_, i) => station(`s${i}`, 5 + i * 9, 1 + i * 0.3));
    const params = {
      ...MODEL_PARAMETERS,
      corridor: { ...MODEL_PARAMETERS.corridor, maxMatrixStationsPerRoute: 6 },
    };
    const { detours, report } = await measureDetours(
      fakeMatrix(4),
      [route("r0")],
      chargers,
      vehicle,
      params,
    );
    expect(Object.keys(detours)).toHaveLength(6);
    // Las 6 más cercanas a la vía.
    expect(Object.keys(detours).sort()).toEqual([
      "r0|s0",
      "r0|s1",
      "r0|s2",
      "r0|s3",
      "r0|s4",
      "r0|s5",
    ]);
    expect(report.requests).toBe(6); // 3 lotes de 2 pares × (ida + vuelta)
  });

  it("si un lote falla, sus desvíos quedan estimados", async () => {
    const chargers = Array.from({ length: 4 }, (_, i) => station(`s${i}`, 10 + i * 20, 2));
    const { detours, report } = await measureDetours(
      fakeMatrix(4, (n) => n <= 2),
      [route("r0")],
      chargers,
      vehicle,
      MODEL_PARAMETERS,
    );
    expect(Object.keys(detours)).toHaveLength(2);
    expect(report.failedBatches).toBe(1);
  });
});
