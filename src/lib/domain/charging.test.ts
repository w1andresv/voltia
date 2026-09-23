import { describe, expect, it } from "vitest";
import {
  bestSocket,
  chargeCurveSeries,
  chargeTimeMinutes,
  compatibleSockets,
  DEFAULT_CURVE,
  effectiveChargeKw,
  isDc,
  lerpFactor,
  powerKwAtSoc,
} from "./charging";
import type { Charger, ChargerSocket, Vehicle } from "./types";

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

describe("isDc", () => {
  it("clasifica CCS2/CCS1/CHAdeMO/NACS/GB-T como DC", () => {
    expect(isDc("ccs2")).toBe(true);
    expect(isDc("chademo")).toBe(true);
    expect(isDc("nacs")).toBe(true);
  });

  it("clasifica Tipo 2 como AC", () => {
    expect(isDc("type2")).toBe(false);
  });
});

describe("lerpFactor", () => {
  it("usa la curva por defecto cuando la del vehículo está vacía", () => {
    expect(lerpFactor([], 15)).toBeCloseTo(1, 6);
  });

  it("da el primer punto para SOC por debajo del rango", () => {
    expect(lerpFactor(DEFAULT_CURVE, -10)).toBeCloseTo(DEFAULT_CURVE[0]!.powerFactor, 6);
  });

  it("da el último punto para SOC 100", () => {
    expect(lerpFactor(DEFAULT_CURVE, 100)).toBeCloseTo(DEFAULT_CURVE[DEFAULT_CURVE.length - 1]!.powerFactor, 6);
  });

  it("interpola linealmente entre dos puntos de la curva", () => {
    // Entre soc=15 (factor 1) y soc=40 (factor 1): a mitad de camino sigue en 1.
    expect(lerpFactor(DEFAULT_CURVE, 27.5)).toBeCloseTo(1, 6);
  });
});

describe("chargeTimeMinutes", () => {
  it("es 0 cuando el destino ya está alcanzado", () => {
    expect(chargeTimeMinutes(60, 50, 50.1, 120, 150, DEFAULT_CURVE)).toBe(0);
  });

  it("un cargador AC (limitado por acMaxKw en el caller) tarda más que uno DC potente", () => {
    const dcMinutes = chargeTimeMinutes(60, 10, 80, 120, 150, DEFAULT_CURVE);
    const acMinutes = chargeTimeMinutes(60, 10, 80, 120, 11, DEFAULT_CURVE);
    expect(acMinutes).toBeGreaterThan(dcMinutes);
  });

  it("cargar del 10 al 80% toma un tiempo positivo y finito", () => {
    const minutes = chargeTimeMinutes(60, 10, 80, 120, 150, DEFAULT_CURVE);
    expect(minutes).toBeGreaterThan(0);
    expect(Number.isFinite(minutes)).toBe(true);
  });
});

describe("compatibleSockets / bestSocket", () => {
  it("filtra los conectores que el vehículo no soporta", () => {
    const c = charger({ sockets: [{ connector: "chademo", powerKw: 50, count: 1 }] });
    expect(compatibleSockets(c, vehicle())).toHaveLength(0);
  });

  it("elige el socket DC de mayor potencia entre los compatibles", () => {
    const c = charger({
      sockets: [
        { connector: "ccs2", powerKw: 50, count: 1 },
        { connector: "ccs2", powerKw: 150, count: 1 },
      ],
    });
    const best = bestSocket(c, vehicle());
    expect(best?.powerKw).toBe(150);
  });

  it("da null cuando no hay ningún socket compatible", () => {
    const c = charger({ sockets: [{ connector: "chademo", powerKw: 50, count: 1 }] });
    expect(bestSocket(c, vehicle())).toBeNull();
  });
});

describe("effectiveChargeKw", () => {
  it("limita la potencia del socket DC al dcMaxKw del vehículo", () => {
    const socket: ChargerSocket = { connector: "ccs2", powerKw: 350, count: 1 };
    expect(effectiveChargeKw(socket, vehicle({ dcMaxKw: 120 }))).toBe(120);
  });

  it("limita la potencia del socket AC al acMaxKw del vehículo", () => {
    const socket: ChargerSocket = { connector: "type2", powerKw: 22, count: 1 };
    expect(effectiveChargeKw(socket, vehicle({ acMaxKw: 11 }))).toBe(11);
  });
});

describe("powerKwAtSoc / chargeCurveSeries", () => {
  it("la potencia nunca es negativa", () => {
    expect(powerKwAtSoc(vehicle(), 100)).toBeGreaterThanOrEqual(0);
  });

  it("genera una serie del 0 al 100% con el paso pedido", () => {
    const series = chargeCurveSeries(vehicle(), 25);
    expect(series.map((p) => p.soc)).toEqual([0, 25, 50, 75, 100]);
  });
});
