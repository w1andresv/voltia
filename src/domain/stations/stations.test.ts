import { expect, test, describe } from "vitest";
import { deduplicateRecords } from "./dedupe";
import { mergeRecords } from "./merge";
import { evaluateEligibility } from "./eligibility";
import type { NormalizedRecord, StationConnector } from "./model";

describe("Stations Domain - Dedupe and Merge", () => {
  const baseRecord = (id: string, name: string, lat: number, lon: number): NormalizedRecord => ({
    source: "osm",
    externalId: id,
    name,
    lat,
    lon,
    connectors: [],
    attributes: {},
    services: [],
    availability: { value: "unknown" }
  });

  test("deduplicates exact externalIds", () => {
    const r1 = baseRecord("1", "EDS 1", 4.0, -74.0);
    const r2 = baseRecord("1", "EDS 1 (dup)", 4.0, -74.0);
    const clusters = deduplicateRecords([r1, r2]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(1); // deduplicate exact drops the second
  });

  test("groups close stations of different sources", () => {
    const r1 = baseRecord("1", "EDS Terpel", 4.0, -74.0);
    r1.source = "osm";
    const r2 = baseRecord("2", "Terpel", 4.0001, -74.0001); // muy cerca, ~15m
    r2.source = "community";

    const clusters = deduplicateRecords([r1, r2]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  test("does not group same source if distance > 50m and names differ", () => {
    const r1 = baseRecord("1", "EDS 1", 4.0, -74.0);
    const r2 = baseRecord("2", "EDS 2", 4.001, -74.0); // ~111m
    const clusters = deduplicateRecords([r1, r2]);
    expect(clusters).toHaveLength(2);
  });

  test("merging respects priority", () => {
    const r1 = baseRecord("1", "EDS OSM", 4.0, -74.0);
    r1.source = "osm";
    const r2 = baseRecord("2", "EDS Oficial SIVEEIC", 4.0001, -74.0001);
    r2.source = "siveeic";

    const merged = mergeRecords([r1, r2]);
    
    // SIVEEIC has priority for Name
    expect(merged.name).toBe("EDS Oficial SIVEEIC");
    // OSM has priority for Coords
    expect(merged.lat).toBe(4.0);
    expect(merged.coordSource).toBe("osm");
  });
});

describe("Stations Domain - Potencia por defecto (50/22/150 kW)", () => {
  const baseRecord = (id: string, name: string, lat: number, lon: number): NormalizedRecord => ({
    source: "siveeic",
    externalId: id,
    name,
    lat,
    lon,
    connectors: [],
    attributes: {},
    services: [],
    availability: { value: "unknown" },
  });

  function connector(overrides: Partial<StationConnector>): StationConnector {
    return {
      standard: "ccs2",
      rawLabel: "CCS Combo 2",
      quantity: 1,
      powerKw: null,
      current: "DC",
      currentOrigin: "standard",
      voltageV: null,
      amperageA: null,
      status: "unknown",
      confirmed: true,
      sources: ["siveeic"],
      ...overrides,
    };
  }

  test("asume 50 kW en conectores DC sin potencia reportada", () => {
    const r = baseRecord("1", "EDS Sin Potencia", 4.0, -74.0);
    r.connectors = [connector({ standard: "ccs2" })];
    const merged = mergeRecords([r]);
    expect(merged.connectors[0]!.powerKw).toBe(50);
  });

  test("asume 22 kW en Tipo 2 y 150 kW en NACS sin potencia reportada", () => {
    const r = baseRecord("1", "EDS Mixta", 4.0, -74.0);
    r.connectors = [
      connector({ standard: "type2", current: "AC", currentOrigin: "standard" }),
      connector({ standard: "nacs" }),
    ];
    const merged = mergeRecords([r]);
    const byStandard = Object.fromEntries(merged.connectors.map((c) => [c.standard, c.powerKw]));
    expect(byStandard.type2).toBe(22);
    expect(byStandard.nacs).toBe(150);
  });

  test("respeta la potencia reportada en vez del default", () => {
    const r = baseRecord("1", "EDS Con Potencia", 4.0, -74.0);
    r.connectors = [connector({ standard: "ccs2", powerKw: 120, sources: ["osm"] })];
    const merged = mergeRecords([r]);
    expect(merged.connectors[0]!.powerKw).toBe(120);
  });

  test("un estándar sin default conocido (other) sigue sin potencia", () => {
    const r = baseRecord("1", "EDS Desconocida", 4.0, -74.0);
    r.connectors = [connector({ standard: "other", current: null, currentOrigin: null })];
    const merged = mergeRecords([r]);
    expect(merged.connectors[0]!.powerKw).toBeNull();
  });

  test("la potencia por defecto hace elegible la estación para planificar", () => {
    const r = baseRecord("1", "EDS Elegible", 4.0, -74.0);
    r.connectors = [connector({ standard: "ccs2" })];
    const merged = mergeRecords([r]);
    const eligibility = evaluateEligibility(merged);
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reasons).toEqual([]);
  });
});
