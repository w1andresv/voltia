import { describe, expect, it, vi } from "vitest";
import type { BlazeClient } from "./client";
import type { BlazeStation } from "./schemas";

vi.mock("server-only", () => ({}));

const clock = () => new Date("2026-09-27T12:00:00Z");
const LIST: BlazeStation[] = [
  {
    id: 1,
    name: "Uno",
    lat: 7.1,
    lon: -73.1,
    status: "en_servicio",
    connectors: "CCS2",
    maxKw: 60,
  },
  {
    id: 2,
    name: "Dos",
    lat: 6.2,
    lon: -75.5,
    status: "mantenimiento",
    connectors: "CCS2",
    maxKw: 60,
  },
  { id: 3, name: "Sin coordenadas", status: "en_servicio" },
];

function fakeClient(
  list: () => Promise<BlazeStation[]>,
  detail?: (id: string) => Promise<BlazeStation | null>,
) {
  return {
    listStations: list,
    station: detail ?? (async () => null),
  } as unknown as BlazeClient;
}

describe("BlazeStationCatalog", () => {
  it("arma el dataset: estaciones con coordenadas, elegibilidad y el estado de la fuente", async () => {
    const { BlazeStationCatalog } = await import("./catalog");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ds = await new BlazeStationCatalog(
      fakeClient(async () => LIST),
      clock,
    ).getDataset();
    expect(ds.stations.map((s) => s.id)).toEqual(["blz_1", "blz_2"]);
    expect(ds.stats).toMatchObject({ raw: 3, stations: 2, eligible: 1 });
    expect(ds.sources[0]).toMatchObject({
      id: "blaze",
      ok: true,
      accepted: 2,
      rejected: { "sin coordenadas": 1 },
    });
    expect(ds.version).toMatch(/^blaze-[0-9a-f]{16}$/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("la versión solo cambia si cambian las estaciones, no con la hora de consulta", async () => {
    const { BlazeStationCatalog } = await import("./catalog");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await new BlazeStationCatalog(
      fakeClient(async () => LIST),
      clock,
    ).getDataset();
    const b = await new BlazeStationCatalog(
      fakeClient(async () => LIST),
      () => new Date(),
    ).getDataset();
    const c = await new BlazeStationCatalog(
      fakeClient(async () => [{ ...LIST[0]!, maxKw: 120 }]),
      clock,
    ).getDataset();
    expect(b.version).toBe(a.version);
    expect(c.version).not.toBe(a.version);
  });

  it("si Blaze falla, sirve el último listado bueno marcado como viejo; sin listado previo, falla", async () => {
    const { BlazeStationCatalog } = await import("./catalog");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = false;
    const catalog = new BlazeStationCatalog(
      fakeClient(async () => {
        if (fail) throw new Error("HTTP 429 https://blaze.example/stations");
        return LIST;
      }),
      clock,
    );
    const ok = await catalog.getDataset();
    fail = true;
    const stale = await catalog.getDataset();
    expect(stale.stations).toEqual(ok.stations);
    expect(stale.sources[0]).toMatchObject({
      ok: false,
      stale: true,
      error: expect.stringContaining("429"),
    });
    await expect(
      new BlazeStationCatalog(
        fakeClient(async () => Promise.reject(new Error("caída"))),
        clock,
      ).getDataset(),
    ).rejects.toThrow(/Blaze no respondió/);
    error.mockRestore();
  });
});

describe("BlazeStationDetails", () => {
  it("pide el detalle solo para ids de Blaze", async () => {
    const { BlazeStationDetails } = await import("./catalog");
    const detail = vi.fn(async (id: string) => ({ ...LIST[0]!, id: Number(id) }));
    const details = new BlazeStationDetails(
      fakeClient(async () => [], detail),
      clock,
    );
    expect(await details.get("st_otra_fuente")).toBeNull();
    expect((await details.get("blz_1"))?.id).toBe("blz_1");
    expect(detail).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledWith("1");
  });
});
