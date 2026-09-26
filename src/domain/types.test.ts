import { describe, expect, it } from "vitest";
import { DRIVER_KG, extraWeightKg, hasValidCoords, isVerifiedForPlanning, PERSON_KG, safetyPct, tripMassKg } from "./types";
import { DEFAULT_CURVE } from "./charging";
import type { Charger, TripConditions, Vehicle } from "./types";

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "v1",
    brand: "Test",
    model: "EV",
    year: 2024,
    version: "base",
    batteryKwh: 60,
    rangeKm: 400,
    consumptionKwhPer100km: null,
    weightKg: 1800,
    motorKw: 150,
    acMaxKw: 11,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2", "type2"],
    minSocRecommended: 10,
    maxSocTravel: 90,
    ...overrides,
  };
}

function conditions(overrides: Partial<TripConditions> = {}): TripConditions {
  return {
    passengers: 1,
    luggageKg: 0,
    initialSoc: 90,
    arrivalSoc: 20,
    avgSpeedKmh: null,
    ac: "normal",
    temperatureC: 20,
    drivingStyle: "normal",
    safetyMode: "normal",
    customSafetyPct: 15,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenLevel: "medium",
    ...overrides,
  };
}

function charger(overrides: Partial<Charger> = {}): Charger {
  return {
    id: "c1",
    name: "Estación de prueba",
    lat: 4.6,
    lon: -74.08,
    sockets: [{ connector: "ccs2", powerKw: 150, count: 2 }],
    source: "osm",
    ...overrides,
  };
}

describe("safetyPct", () => {
  it("conservador es 20, bajo es 10, normal es 15", () => {
    expect(safetyPct(conditions({ safetyMode: "conservative" }))).toBe(20);
    expect(safetyPct(conditions({ safetyMode: "low" }))).toBe(10);
    expect(safetyPct(conditions({ safetyMode: "normal" }))).toBe(15);
  });

  it("personalizado usa customSafetyPct", () => {
    expect(safetyPct(conditions({ safetyMode: "custom", customSafetyPct: 33 }))).toBe(33);
  });
});

describe("extraWeightKg / tripMassKg", () => {
  it("siempre incluye al conductor aunque no haya pasajeros ni equipaje", () => {
    expect(extraWeightKg(conditions({ passengers: 0, luggageKg: 0 }))).toBe(DRIVER_KG);
  });

  it("suma pasajeros y equipaje al peso del conductor", () => {
    const extra = extraWeightKg(conditions({ passengers: 2, luggageKg: 30 }));
    expect(extra).toBe(DRIVER_KG + 2 * PERSON_KG + 30);
  });

  it("tripMassKg suma el peso extra al peso del vehículo", () => {
    const v = vehicle({ weightKg: 1800 });
    const c = conditions({ passengers: 1, luggageKg: 10 });
    expect(tripMassKg(v, c)).toBe(1800 + extraWeightKg(c));
  });
});

describe("hasValidCoords", () => {
  it("acepta coordenadas dentro de rango", () => {
    expect(hasValidCoords({ lat: 4.6, lon: -74.08 })).toBe(true);
  });

  it("rechaza 0,0 (el error clásico de geocodificación)", () => {
    expect(hasValidCoords({ lat: 0, lon: 0 })).toBe(false);
  });

  it("rechaza coordenadas fuera de rango o no finitas", () => {
    expect(hasValidCoords({ lat: 95, lon: 0 })).toBe(false);
    expect(hasValidCoords({ lat: NaN, lon: -74 })).toBe(false);
  });
});

describe("isVerifiedForPlanning", () => {
  it("una estación comunitaria solo cuenta si está aprobada", () => {
    expect(isVerifiedForPlanning(charger({ source: "community", status: "approved" }))).toBe(true);
    expect(isVerifiedForPlanning(charger({ source: "community", status: "pending" }))).toBe(false);
    expect(isVerifiedForPlanning(charger({ source: "community", status: "rejected" }))).toBe(false);
  });

  it("OSM y PlugShare cuentan sin marca adicional", () => {
    expect(isVerifiedForPlanning(charger({ source: "osm" }))).toBe(true);
    expect(isVerifiedForPlanning(charger({ source: "plugshare" }))).toBe(true);
  });

  it("el catálogo del operador solo cuenta si viene marcado como verificado", () => {
    expect(isVerifiedForPlanning(charger({ source: "catalog", verified: true }))).toBe(true);
    expect(isVerifiedForPlanning(charger({ source: "catalog", verified: false }))).toBe(false);
    expect(isVerifiedForPlanning(charger({ source: "catalog" }))).toBe(false);
  });

  it("descarta coordenadas inválidas, sin nombre o de acceso privado", () => {
    expect(isVerifiedForPlanning(charger({ lat: 0, lon: 0 }))).toBe(false);
    expect(isVerifiedForPlanning(charger({ name: "" }))).toBe(false);
    expect(isVerifiedForPlanning(charger({ access: "private" }))).toBe(false);
  });
});

