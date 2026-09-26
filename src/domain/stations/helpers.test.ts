import { describe, expect, it } from "vitest";
import { currentFromStandard, defaultKwForStandard, standardizeConnector } from "./connectors";
import type { ConsolidatedStation, StationConnector } from "./model";
import { findStationsNearRoute } from "./spatial";
import {
  addressSimilarity,
  diceTrigrams,
  jaccardSimilarity,
  normalizeAddress,
  normalizeText,
  textSimilarity,
} from "./text";
import { toDisplayCharger, toPlanningCharger } from "./to-charger";

describe("normalizeText", () => {
  it("vacío o nulo da cadena vacía", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText("")).toBe("");
  });

  it("quita acentos, puntuación y espacios de más", () => {
    expect(normalizeText("  Estación   Éxito—Norte! ")).toBe("estacion exito norte");
  });

  it("opcionalmente quita palabras comunes de nombres de estaciones", () => {
    expect(normalizeText("Estación de Carga Terpel Piedecuesta S.A.S.", true)).toBe("piedecuesta");
  });
});

describe("normalizeAddress", () => {
  it("vacío o nulo da cadena vacía", () => {
    expect(normalizeAddress(null)).toBe("");
  });

  it("unifica abreviaturas viales y el signo de número", () => {
    expect(normalizeAddress("Carrera 27 # 45-10")).toBe("cra 27 # 45 10");
    expect(normalizeAddress("Kr 27 No. 45-10")).toBe("cra 27 # 45 10");
    expect(normalizeAddress("Avenida Quebradaseca")).toBe("av quebradaseca");
    expect(normalizeAddress("Diagonal 5 Transversal 3")).toBe("dg 5 tv 3");
  });
});

describe("jaccardSimilarity", () => {
  it("casos vacíos", () => {
    expect(jaccardSimilarity("", "")).toBe(1);
    expect(jaccardSimilarity("a", "")).toBe(0);
    expect(jaccardSimilarity("", "a")).toBe(0);
    expect(jaccardSimilarity("  ", " ")).toBe(1);
  });

  it("intersección sobre unión de palabras", () => {
    expect(jaccardSimilarity("a b c", "b c d")).toBe(0.5);
    expect(jaccardSimilarity("a b", "a b")).toBe(1);
  });
});

describe("diceTrigrams", () => {
  it("casos vacíos", () => {
    expect(diceTrigrams("", "")).toBe(1);
    expect(diceTrigrams("abc", "")).toBe(0);
  });

  it("1 para textos iguales y entre 0 y 1 para variaciones", () => {
    expect(diceTrigrams("terpel", "terpel")).toBe(1);
    const sim = diceTrigrams("piedecuesta", "piedecuesa");
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(1);
    expect(diceTrigrams("abc", "xyz")).toBe(0);
  });
});

describe("textSimilarity / addressSimilarity", () => {
  it("nombres que solo difieren en palabras comunes son iguales", () => {
    expect(textSimilarity("Estación Terpel Piedecuesta", "EDS Terpel Piedecuesta")).toBe(1);
  });

  it("sin quitar palabras comunes baja la similitud", () => {
    expect(textSimilarity("Estación Terpel Piedecuesta", "EDS Terpel Piedecuesta", false)).toBeLessThan(1);
  });

  it("direcciones equivalentes con distinta abreviatura son iguales", () => {
    expect(addressSimilarity("Carrera 27 # 45-10", "Cra 27 No. 45-10")).toBe(1);
    expect(addressSimilarity("Carrera 27 # 45-10", "Calle 80 # 12-3")).toBeLessThan(0.5);
  });
});

describe("standardizeConnector", () => {
  it.each([
    ["CCS Combo 2", "ccs2"],
    ["type2_combo", "ccs2"],
    ["Combo 1", "ccs1"],
    ["Type 2", "type2"],
    ["Mennekes", "type2"],
    ["J1772", "type1"],
    ["CHAdeMO", "chademo"],
    ["Tesla Supercharger", "nacs"],
    ["SAE J3400", "nacs"],
    ["GB/T", "gb_t"],
    ["Schuko", "schuko"],
    ["Tesla Destination", "tesla_destination"],
    ["", "other"],
    ["   ", "other"],
    ["enchufe raro", "other"],
  ])("%s → %s", (raw, expected) => {
    expect(standardizeConnector(raw)).toBe(expected);
  });
});

describe("currentFromStandard / defaultKwForStandard", () => {
  it("clasifica la corriente por estándar", () => {
    for (const s of ["ccs2", "ccs1", "chademo", "nacs", "gb_t"] as const) expect(currentFromStandard(s)).toBe("DC");
    for (const s of ["type2", "type1", "schuko", "tesla_destination"] as const) expect(currentFromStandard(s)).toBe("AC");
    expect(currentFromStandard("other")).toBeNull();
  });

  it("potencia asumida por estándar, o null si no hay", () => {
    expect(defaultKwForStandard("ccs2")).toBe(50);
    expect(defaultKwForStandard("nacs")).toBe(150);
    expect(defaultKwForStandard("type2")).toBe(22);
    expect(defaultKwForStandard("schuko")).toBeNull();
    expect(defaultKwForStandard("other")).toBeNull();
  });
});

function connector(overrides: Partial<StationConnector> = {}): StationConnector {
  return {
    standard: "ccs2",
    rawLabel: "CCS2",
    quantity: 2,
    powerKw: 60,
    current: "DC",
    currentOrigin: "standard",
    voltageV: null,
    amperageA: null,
    status: "unknown",
    confirmed: true,
    sources: ["osm"],
    ...overrides,
  };
}

function station(overrides: Partial<ConsolidatedStation> = {}): ConsolidatedStation {
  return {
    id: "st_1",
    name: "EDS Prueba",
    aliases: [],
    lat: 7,
    lon: -73,
    coordSource: "osm",
    services: [],
    availability: { value: "unknown" },
    connectors: [connector()],
    sources: [{ source: "osm", externalId: "n1", fetchedAt: "2026-09-01T00:00:00Z", url: "https://osm.org/n1" }],
    attributes: {},
    conflicts: [],
    planning: { eligible: true, reasons: [] },
    ...overrides,
  };
}

describe("findStationsNearRoute", () => {
  const route = [
    { lat: 7, lon: -73 },
    { lat: 7.1, lon: -73 },
  ];

  it("sin ruta o sin estaciones no devuelve nada", () => {
    expect(findStationsNearRoute([station()], [], 12)).toEqual([]);
    expect(findStationsNearRoute([], route, 12)).toEqual([]);
  });

  it("incluye las que están a menos de maxKm y excluye las lejanas", () => {
    const near = station({ id: "near", lat: 7.05, lon: -73.05 }); // ~5,5 km
    const edge = station({ id: "edge", lat: 7.05, lon: -73.15 }); // ~16,5 km: dentro de la caja, fuera del radio
    const far = station({ id: "far", lat: 8, lon: -73 }); // fuera de la caja
    const out = findStationsNearRoute([near, edge, far], route, 12).map((s) => s.id);
    expect(out).toEqual(["near"]);
  });
});

describe("toPlanningCharger / toDisplayCharger", () => {
  it("convierte una estación elegible con sus conectores confirmados", () => {
    const c = toPlanningCharger(
      station({
        operator: "Terpel",
        pricing: { perKwh: { amount: 1500, currency: "COP" } },
        availability: { value: "available" },
        address: { full: "Cra 27 # 45-10" },
        connectors: [
          connector(),
          connector({ standard: "type2", powerKw: null }),
          connector({ standard: "chademo", confirmed: false }),
          connector({ standard: "schuko" }),
        ],
      }),
    );
    expect(c).toMatchObject({
      id: "st_1",
      operator: "Terpel",
      pricePerKwh: { amount: 1500, currency: "COP" },
      available: true,
      availability: "available",
      address: "Cra 27 # 45-10",
      source: "osm",
      url: "https://osm.org/n1",
      updatedAt: "2026-09-01T00:00:00Z",
      verified: true,
    });
    expect(c.sockets).toEqual([{ connector: "ccs2", powerKw: 60, count: 2 }]);
  });

  it("no convierte una estación no elegible para planificar", () => {
    expect(() => toPlanningCharger(station({ planning: { eligible: false, reasons: ["x"] } }))).toThrow(
      /no elegible/,
    );
  });

  it("para el mapa incluye todos los conectores de planificación y marca la verificación", () => {
    const c = toDisplayCharger(
      station({
        coordSource: "ocm",
        network: "Red X",
        availability: { value: "offline" },
        planning: { eligible: false, reasons: ["sin potencia"] },
        connectors: [connector({ powerKw: null, quantity: null }), connector({ standard: "type2", confirmed: false })],
      }),
    );
    expect(c.source).toBe("osm");
    expect(c.operator).toBe("Red X");
    expect(c.available).toBe(false);
    expect(c.verified).toBe(false);
    expect(c.sockets).toEqual([
      { connector: "ccs2", powerKw: 0, count: 1 },
      { connector: "type2", powerKw: 60, count: 2 },
    ]);
  });

  it("sin disponibilidad conocida, available es null", () => {
    expect(toDisplayCharger(station()).available).toBeNull();
  });
});
