import { describe, expect, it, vi } from "vitest";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import type { ElevationProvider } from "@/domain/ports/elevation";
import type { LatLon, RawRoute } from "@/domain/types";
import { elevationSourceLabel, profileRoute } from "./elevation-profile";

const KM_PER_DEG = 111.195;
function route(km: number): RawRoute {
  const at = (d: number) => ({ lat: 7 + d / KM_PER_DEG, lon: -73 });
  const samples = Array.from({ length: km + 1 }, (_, i) => ({
    km: i,
    ...at(i),
    elevM: 0,
    slopePct: 0,
    speedKmh: 80,
  }));
  return {
    id: "r",
    label: "r",
    geometry: samples.map((s) => ({ lat: s.lat, lon: s.lon })),
    samples,
    distanceKm: km,
    driveMinutes: km,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

/** Proveedor falso: altura según la latitud (sube hacia el norte en el km 5–10), registra cada consulta. */
function provider(id = "fake", fail = false) {
  const calls: number[] = [];
  const p: ElevationProvider = {
    id,
    getElevations: vi.fn(async (points: LatLon[]) => {
      calls.push(points.length);
      if (fail) throw new Error(`${id} caído`);
      return points.map((pt) => {
        const km = (pt.lat - 7) * KM_PER_DEG;
        return km < 5 ? 1000 : 1000 + Math.min(5, km - 5) * 60;
      });
    }),
  };
  return { p, calls };
}

const params = MODEL_PARAMETERS.elevation;

describe("profileRoute", () => {
  it("fija: una consulta con las muestras (hasta 96)", async () => {
    const { p, calls } = provider();
    const out = await profileRoute(route(20), { provider: p, sampling: "fixed" }, params);
    expect(calls).toEqual([21]);
    expect(out.report).toMatchObject({ source: "fake", points: 21 });
    expect(out.route.elevation.maxM).toBeGreaterThan(1200);
  });

  it("malla: un punto cada 100 m", async () => {
    const { p, calls } = provider();
    const out = await profileRoute(route(20), { provider: p, sampling: "mesh" }, params);
    expect(calls).toEqual([201]);
    expect(out.report).toMatchObject({ source: "fake/mesh", points: 201 });
    expect(out.route.elevation.gainM).toBeGreaterThan(280);
  });

  it("adaptativa: gruesa y luego solo donde cambia", async () => {
    const { p, calls } = provider();
    const out = await profileRoute(route(20), { provider: p, sampling: "adaptive" }, params);
    expect(calls[0]).toBe(21);
    // Cinco tramos de 1 km con 60 m de cambio × 4 puntos cada 200 m.
    expect(calls[1]).toBe(20);
    expect(out.report).toMatchObject({ source: "fake/adaptive", points: 41 });
  });

  it("si el principal falla, usa el respaldo con la estrategia fija", async () => {
    const main = provider("terrain", true);
    const backup = provider("open-meteo");
    const out = await profileRoute(
      route(20),
      { provider: main.p, sampling: "mesh", fallback: backup.p },
      params,
    );
    expect(backup.calls).toEqual([21]);
    expect(out.report).toMatchObject({ source: "open-meteo", error: "terrain caído" });
  });

  it("si todo falla, la ruta queda plana", async () => {
    const main = provider("a", true);
    const r = route(20);
    const out = await profileRoute(
      r,
      { provider: main.p, sampling: "fixed", fallback: main.p },
      params,
    );
    expect(main.calls).toHaveLength(1);
    expect(out.route).toBe(r);
    expect(out.report).toMatchObject({ source: null, points: 0, error: "a caído" });
  });
});

describe("elevationSourceLabel", () => {
  it("la fija conserva el nombre del proveedor (snapshots anteriores)", () => {
    const { p } = provider("open-meteo");
    expect(elevationSourceLabel(p, "fixed")).toBe("open-meteo");
    expect(elevationSourceLabel(p, "adaptive")).toBe("open-meteo/adaptive");
  });
});
