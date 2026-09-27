import { describe, expect, it } from "vitest";
import { BlazeStationSchema } from "./schemas";
import {
  availabilityOf,
  blazeExternalId,
  blazeStationId,
  connectorsFromChargers,
  connectorsFromList,
  toConsolidatedStation,
} from "./mappers";

const AT = "2026-09-27T12:00:00.000Z";

/** El ejemplo de la documentación (docs/blaze/api-publica-v1.md), con todos los scopes. */
const EXAMPLE = BlazeStationSchema.parse({
  id: 12,
  name: "EDS Blaze Cabecera",
  city: "Bucaramanga",
  status: "en_servicio",
  verified: true,
  operator: "Blaze Charge",
  lat: 7.119,
  lon: -73.119,
  connectors: "CCS2, Tipo 2",
  maxKw: 150,
  chargersCount: 3,
});

describe("esquema de Blaze", () => {
  it("acepta una key con solo stations:read (sin coordenadas, conectores ni potencia)", () => {
    const s = BlazeStationSchema.parse({ id: 7, name: "EDS", city: "Cali", status: "en_servicio" });
    expect(s.lat).toBeUndefined();
    expect(toConsolidatedStation(s, AT)).toBeNull();
  });

  it("un estado que la documentación no lista se lee como desconocido", () => {
    const s = BlazeStationSchema.parse({ id: 7, name: "EDS", status: "nuevo_estado" });
    expect(s.status).toBe("desconocido");
    expect(availabilityOf(s.status)).toBe("unknown");
  });

  it("campos nuevos de la API no rompen la lectura", () => {
    expect(() => BlazeStationSchema.parse({ id: 1, name: "X", pricePerKwh: 1200 })).not.toThrow();
  });
});

describe("ids", () => {
  it("prefijo blz_ ida y vuelta; los ids de otras fuentes no son de Blaze", () => {
    expect(blazeStationId(12)).toBe("blz_12");
    expect(blazeExternalId("blz_12")).toBe("12");
    expect(blazeExternalId("st_abc")).toBeNull();
    expect(blazeExternalId("blz_../admin")).toBeNull();
  });
});

describe("estados", () => {
  it("en servicio → disponible; mantenimiento y fuera de servicio → fuera de servicio", () => {
    expect(availabilityOf("en_servicio")).toBe("available");
    expect(availabilityOf("mantenimiento")).toBe("offline");
    expect(availabilityOf("fuera_servicio")).toBe("offline");
    expect(availabilityOf("desconocido")).toBe("unknown");
    expect(availabilityOf(undefined)).toBe("unknown");
  });
});

describe("conectores del listado", () => {
  it("'CCS2, Tipo 2' con 150 kW: CCS2 reportado a 150, Tipo 2 con la potencia del estándar", () => {
    const [ccs, type2] = connectorsFromList(EXAMPLE);
    expect(ccs).toMatchObject({
      standard: "ccs2",
      powerKw: 150,
      powerOrigin: "reported",
      current: "DC",
    });
    expect(type2).toMatchObject({
      standard: "type2",
      powerKw: 22,
      powerOrigin: "assumed",
      current: "AC",
    });
    expect(ccs!.confirmed).toBe(true);
    expect(ccs!.sources).toEqual(["blaze"]);
  });

  it("solo alterna: maxKw es la potencia de ese conector, y la cantidad es chargersCount", () => {
    const s = BlazeStationSchema.parse({
      id: 1,
      name: "X",
      connectors: "Tipo 2",
      maxKw: 7.4,
      chargersCount: 2,
    });
    expect(connectorsFromList(s)).toEqual([
      expect.objectContaining({
        standard: "type2",
        powerKw: 7.4,
        powerOrigin: "reported",
        quantity: 2,
      }),
    ]);
  });

  it("sin maxKw, todos con la potencia del estándar; etiquetas repetidas se juntan", () => {
    const s = BlazeStationSchema.parse({ id: 1, name: "X", connectors: "CCS2, CCS 2 ,CHAdeMO" });
    expect(connectorsFromList(s).map((c) => [c.standard, c.powerKw, c.powerOrigin])).toEqual([
      ["ccs2", 50, "assumed"],
      ["chademo", 50, "assumed"],
    ]);
  });

  it("la potencia asumida de alterna no pasa de la máxima de la estación", () => {
    const s = BlazeStationSchema.parse({ id: 1, name: "X", connectors: "CCS2, Tipo 2", maxKw: 20 });
    expect(connectorsFromList(s)[1]).toMatchObject({
      standard: "type2",
      powerKw: 20,
      powerOrigin: "assumed",
    });
  });
});

describe("conectores del detalle", () => {
  it("un conector por estándar, con cantidad, potencia máxima y estado de sus cargadores", () => {
    const connectors = connectorsFromChargers([
      { connectorType: "CCS2", powerKw: 150, status: "en_servicio" },
      { connectorType: "CCS2", powerKw: 60, status: "fuera_servicio" },
      { connectorType: "Tipo 2", powerKw: 22, status: "fuera_servicio" },
    ]);
    expect(connectors).toEqual([
      expect.objectContaining({ standard: "ccs2", quantity: 2, powerKw: 150, status: "available" }),
      expect.objectContaining({ standard: "type2", quantity: 1, powerKw: 22, status: "offline" }),
    ]);
  });
});

describe("estación consolidada", () => {
  it("el ejemplo de la documentación queda elegible para planificar", () => {
    const st = toConsolidatedStation(EXAMPLE, AT)!;
    expect(st).toMatchObject({
      id: "blz_12",
      name: "EDS Blaze Cabecera",
      lat: 7.119,
      lon: -73.119,
      coordSource: "blaze",
      operator: "Blaze Charge",
      address: { city: "Bucaramanga" },
      availability: { value: "available", source: "blaze", at: AT },
      sources: [{ source: "blaze", externalId: "12", fetchedAt: AT }],
      attributes: {
        blaze: { verified: true, status: "en_servicio", chargersCount: 3, maxKw: 150 },
      },
      planning: { eligible: true, reasons: [] },
    });
  });

  it("detalle sin ningún cargador en servicio: la estación queda fuera de servicio y no elegible", () => {
    const st = toConsolidatedStation(
      BlazeStationSchema.parse({
        ...EXAMPLE,
        chargers: [
          { connectorType: "CCS2", powerKw: 150, status: "mantenimiento" },
          { connectorType: "Tipo 2", powerKw: 22, status: "fuera_servicio" },
        ],
      }),
      AT,
    )!;
    expect(st.availability.value).toBe("offline");
    expect(st.planning.eligible).toBe(false);
  });

  it("detalle con un cargador en servicio: sigue disponible, con la potencia real de cada conector", () => {
    const st = toConsolidatedStation(
      BlazeStationSchema.parse({
        ...EXAMPLE,
        chargers: [
          { connectorType: "CCS2", powerKw: 120, status: "en_servicio" },
          { connectorType: "Tipo 2", powerKw: 22, status: "fuera_servicio" },
        ],
      }),
      AT,
    )!;
    expect(st.availability.value).toBe("available");
    expect(st.connectors[0]).toMatchObject({
      standard: "ccs2",
      powerKw: 120,
      powerOrigin: "reported",
    });
    expect(st.planning.eligible).toBe(true);
  });

  it("la estación en mantenimiento en el listado no es elegible", () => {
    const st = toConsolidatedStation(
      BlazeStationSchema.parse({ ...EXAMPLE, status: "mantenimiento" }),
      AT,
    )!;
    expect(st.planning).toEqual({ eligible: false, reasons: ["Reportada fuera de servicio"] });
  });
});
