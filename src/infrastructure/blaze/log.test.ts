import { afterEach, describe, expect, it, vi } from "vitest";
import { logBlazeDetail, logBlazeList } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("logs de Blaze", () => {
  it("el listado: una línea con el total y una tabla con cada estación", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    logBlazeList(
      [
        {
          id: 12,
          name: "EDS Cabecera",
          city: "Bucaramanga",
          lat: 7.1,
          lon: -73.1,
          connectors: "CCS2",
        },
      ],
      40,
    );
    expect(log).toHaveBeenCalledWith("[blaze] listado: 1 estaciones en 40 ms");
    expect(table).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 12,
        nombre: "EDS Cabecera",
        coords: "7.1,-73.1",
        conectores: "CCS2",
      }),
    ]);
  });

  it("el detalle: la estación y sus cargadores; 404 en una línea", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    logBlazeDetail(
      "12",
      {
        id: 12,
        name: "EDS",
        status: "en_servicio",
        chargers: [{ connectorType: "CCS2", powerKw: 150, status: "en_servicio" }],
      },
      80,
    );
    expect(log.mock.calls[0]![0]).toMatch(
      /^\[blaze\] detalle 12 · EDS · en_servicio · 1 cargador\(es\) en 80 ms/,
    );
    expect(table).toHaveBeenCalledWith([{ conector: "CCS2", kW: 150, estado: "en_servicio" }]);
    logBlazeDetail("99", null, 5);
    expect(log).toHaveBeenLastCalledWith("[blaze] detalle 99: no encontrada (404) en 5 ms");
  });
});
