import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));

import { pickProbes } from "./chargers.overpass";

/** Puntos cada ~1 km hacia el sur desde (7, -73), desplazados `dLon` grados. */
function line(km: number, dLon = 0) {
  return Array.from({ length: km + 1 }, (_, i) => ({ lat: 7 - i / 111.32, lon: -73 + dLon }));
}

describe("pickProbes", () => {
  it("pone una sonda cada ~18 km e incluye el final", () => {
    const probes = pickProbes(line(200));
    expect(probes.length).toBeGreaterThanOrEqual(11);
    expect(probes.length).toBeLessThanOrEqual(13);
    expect(probes.at(-1)?.lat).toBeCloseTo(7 - 200 / 111.32, 3);
  });

  it("no repite sondas donde dos rutas se solapan", () => {
    const one = pickProbes(line(200));
    const twice = pickProbes([...line(200), ...line(200)]);
    expect(twice).toHaveLength(one.length);
  });

  it("una ruta por otra vía sí suma sondas", () => {
    const one = pickProbes(line(200));
    const two = pickProbes([...line(200), ...line(200, 0.5)]);
    expect(two.length).toBeGreaterThan(one.length);
  });
});
