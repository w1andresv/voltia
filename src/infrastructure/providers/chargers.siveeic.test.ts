import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchJson } = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock("./http", () => ({ fetchJson }));

import { siveeicProvider, stationToCharger } from "./chargers.siveeic";

function station(overrides: Record<string, unknown> = {}) {
  return {
    Id: "abc-1",
    Nombre: "Estación Cariongo",
    Direccion: "Carrera 5",
    Operador: { Nombreempresa: "CENS" },
    Municipio: { NombreMunicipio: "CUCUTA" },
    Latitud: "7.373372308509732",
    Longitud: "-72.64753036161446",
    Estado: { NombreEstado: "Activo" },
    Conectores: { "Tipo 2 - IEC 62196": 1, "CCS Combo 2": 1 },
    ...overrides,
  };
}

describe("stationToCharger", () => {
  it("mapea conectores conocidos con su potencia por defecto", () => {
    const c = stationToCharger(station());
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(7.373372308509732);
    expect(c!.lon).toBeCloseTo(-72.64753036161446);
    expect(c!.source).toBe("siveeic");
    expect(c!.sockets).toEqual(
      expect.arrayContaining([
        { connector: "type2", powerKw: 22, count: 1 },
        { connector: "ccs2", powerKw: 50, count: 1 },
      ]),
    );
  });

  it("ignora conectores no soportados (Tipo 1, Schuko) y descarta la estación si no queda ninguno", () => {
    const c = stationToCharger(station({ Conectores: { "Tipo 1 - SAE J1772": 1, Schuko: 2 } }));
    expect(c).toBeNull();
  });

  it("descarta estaciones que no están activas", () => {
    const c = stationToCharger(station({ Estado: { NombreEstado: "Inactivo" } }));
    expect(c).toBeNull();
  });

  it("descarta coordenadas inválidas", () => {
    const c = stationToCharger(station({ Latitud: "no-es-un-numero" }));
    expect(c).toBeNull();
  });
});

describe("siveeicProvider.findAlong", () => {
  const ORIGINAL_TOKEN = process.env.SIVEEIC_TOKEN;

  beforeEach(() => {
    fetchJson.mockReset();
  });

  afterEach(() => {
    process.env.SIVEEIC_TOKEN = ORIGINAL_TOKEN;
  });

  it("sin token configurado, no llama a la API y devuelve una lista vacía", async () => {
    delete process.env.SIVEEIC_TOKEN;
    const res = await siveeicProvider.findAlong([{ lat: 7.37, lon: -72.65 }]);
    expect(res).toEqual({ chargers: [], warnings: [] });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("filtra por cercanía a las muestras de la ruta", async () => {
    process.env.SIVEEIC_TOKEN = "test-token";
    fetchJson.mockResolvedValue([
      station({ Id: "near", Latitud: "7.37", Longitud: "-72.65" }),
      station({ Id: "far", Latitud: "40", Longitud: "-3" }),
    ]);

    const res = await siveeicProvider.findAlong([{ lat: 7.37, lon: -72.65 }]);

    expect(res.chargers.map((c) => c.id)).toEqual(["siveeic-near"]);
  });
});
