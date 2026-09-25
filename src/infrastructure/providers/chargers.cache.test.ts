import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Charger } from "@/domain/types";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/infrastructure/db", () => ({ getSql: async () => ({ query }) }));

const { overpassFindAlong, plugshareFindAlong, siveeicFindAlong } = vi.hoisted(() => ({
  overpassFindAlong: vi.fn(),
  plugshareFindAlong: vi.fn(),
  siveeicFindAlong: vi.fn(),
}));
vi.mock("./chargers.overpass", () => ({
  pickProbes: (samples: { lat: number; lon: number }[]) => samples,
  overpassProvider: { id: "osm", name: "OpenStreetMap", findAlong: overpassFindAlong },
}));
vi.mock("./chargers.plugshare", () => ({
  plugshareProvider: { id: "plugshare", name: "PlugShare", findAlong: plugshareFindAlong },
}));
vi.mock("./chargers.siveeic", () => ({
  siveeicProvider: { id: "siveeic", name: "SIVEEIC", findAlong: siveeicFindAlong },
}));

import { findCachedChargersAlong } from "./chargers.cache";

function charger(overrides: Partial<Charger> = {}): Charger {
  return {
    id: "c1",
    name: "Estación",
    lat: 4.7,
    lon: -74.1,
    sockets: [{ connector: "ccs2", powerKw: 50, count: 1 }],
    source: "osm",
    verified: true,
    ...overrides,
  };
}

beforeEach(() => {
  query.mockReset();
  overpassFindAlong.mockReset();
  plugshareFindAlong.mockReset();
  siveeicFindAlong.mockReset();
  siveeicFindAlong.mockResolvedValue({ chargers: [], warnings: [] });
});

describe("findCachedChargersAlong", () => {
  it("sin caché: consulta OSM, PlugShare y SIVEEIC, y guarda el resultado", async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    overpassFindAlong.mockResolvedValue({ chargers: [charger({ id: "osm-1" })], warnings: [] });
    plugshareFindAlong.mockResolvedValue({ chargers: [], warnings: [] });

    const res = await findCachedChargersAlong([{ lat: 4.7, lon: -74.1 }], []);

    expect(res.chargers.map((c) => c.id)).toContain("osm-1");
    expect(overpassFindAlong).toHaveBeenCalledTimes(1);
    expect(plugshareFindAlong).toHaveBeenCalledTimes(1);
    expect(siveeicFindAlong).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[1]![0])).toMatch(/insert into charger_corridor_cache/i);
  });

  it("con caché vigente: no vuelve a llamar a OSM/PlugShare/SIVEEIC", async () => {
    query.mockResolvedValueOnce([{ chargers_json: JSON.stringify([charger({ id: "cached-1" })]) }]);

    const res = await findCachedChargersAlong([{ lat: 4.7, lon: -74.1 }], []);

    expect(res.chargers.map((c) => c.id)).toContain("cached-1");
    expect(overpassFindAlong).not.toHaveBeenCalled();
    expect(plugshareFindAlong).not.toHaveBeenCalled();
    expect(siveeicFindAlong).not.toHaveBeenCalled();
  });

  it("community siempre se mezcla en vivo, aunque haya caché", async () => {
    query.mockResolvedValueOnce([{ chargers_json: JSON.stringify([charger({ id: "cached-1" })]) }]);
    const community = [
      charger({ id: "community-1", source: "community", status: "approved", lat: 5, lon: -75 }),
    ];

    const res = await findCachedChargersAlong([{ lat: 4.7, lon: -74.1 }], community);

    expect(res.chargers.map((c) => c.id)).toEqual(
      expect.arrayContaining(["cached-1", "community-1"]),
    );
  });

  it("sin base de datos: sigue funcionando con las fuentes en vivo", async () => {
    query.mockRejectedValue(new Error("Falta DATABASE_URL"));
    overpassFindAlong.mockResolvedValue({ chargers: [charger({ id: "osm-1" })], warnings: [] });
    plugshareFindAlong.mockResolvedValue({ chargers: [], warnings: [] });

    const res = await findCachedChargersAlong([{ lat: 4.7, lon: -74.1 }], []);

    expect(res.chargers.map((c) => c.id)).toContain("osm-1");
  });
});
