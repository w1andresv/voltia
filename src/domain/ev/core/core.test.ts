import { describe, expect, it } from "vitest";
import type { TripConditions, Vehicle } from "../../types";
import { DEFAULT_CURVE } from "../../charging";
import { MODEL_PARAMETERS } from "./params";
import { isEstimated, sourced } from "./provenance";
import { flexibleReserveSocPct, reserveSocPct, toTripConfiguration } from "./trip-config";
import {
  G_MS2,
  hoursToMinutes,
  jToKwh,
  J_PER_KWH,
  kmhToMs,
  kmToM,
  kwhToJ,
  kwhToSocPct,
  msToKmh,
  mToKm,
  socPctToKwh,
} from "./units";

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "v1",
    brand: "Test",
    model: "EV",
    year: 2024,
    version: "base",
    batteryKwh: 47.1,
    rangeKm: 340,
    consumptionKwhPer100km: null,
    weightKg: 1672,
    motorKw: 125,
    acMaxKw: 7,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2", "type2"],
    ...overrides,
  };
}

function conditions(overrides: Partial<TripConditions> = {}): TripConditions {
  return {
    passengers: 1,
    luggageKg: 30,
    initialSoc: 80,
    avgSpeedKmh: null,
    ac: "normal",
    temperatureC: null,
    drivingStyle: "normal",
    safetyMode: "low",
    customSafetyPct: 10,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenLevel: "medium",
    ...overrides,
  };
}

describe("units", () => {
  it("velocidad, distancia y energía ida y vuelta", () => {
    expect(kmhToMs(90)).toBeCloseTo(25, 12);
    expect(msToKmh(kmhToMs(73.5))).toBeCloseTo(73.5, 12);
    expect(kmToM(1.5)).toBe(1500);
    expect(mToKm(250)).toBe(0.25);
    expect(kwhToJ(1)).toBe(J_PER_KWH);
    expect(jToKwh(kwhToJ(2.5))).toBeCloseTo(2.5, 12);
    expect(hoursToMinutes(1.5)).toBe(90);
    expect(G_MS2).toBe(9.81);
  });

  it("kWh ↔ puntos de SOC", () => {
    expect(kwhToSocPct(4.71, 47.1)).toBeCloseTo(10, 12);
    expect(socPctToKwh(10, 47.1)).toBeCloseTo(4.71, 12);
    expect(kwhToSocPct(5, 0)).toBe(0);
  });
});

describe("provenance", () => {
  it("marca y reconoce valores estimados", () => {
    const v = sourced(0.75, "estimated", { reference: "ADR-0002" });
    expect(v).toEqual({ value: 0.75, source: "estimated", reference: "ADR-0002" });
    expect(isEstimated(v)).toBe(true);
    expect(isEstimated(sourced(47.1, "external_source"))).toBe(false);
  });
});

describe("ModelParameters", () => {
  it("conserva los valores del modelo actual", () => {
    expect(MODEL_PARAMETERS.corridor.maxFromRouteKm).toBe(12);
    expect(MODEL_PARAMETERS.corridor.preferredFromRouteKm).toBe(5);
    expect(MODEL_PARAMETERS.corridor.detourRoadFactor.value).toBe(1);
    expect(MODEL_PARAMETERS.planner).toMatchObject({
      maxStops: 7,
      minProgressKm: 4,
      detourSpeedKmh: 50,
      socTolerancePct: 1e-4,
      belowSafetyFloorPct: 5,
      socGridPct: 1,
    });
    expect(MODEL_PARAMETERS.planner.minChargeSessionMin.value).toBe(10);
    expect(MODEL_PARAMETERS.planner.stretchChargeSocPct.value).toBe(90);
    expect(MODEL_PARAMETERS.planning.energyMarginPercent).toBe(0);
    expect(MODEL_PARAMETERS.vehicle.bodyTypePhysics.source).toBe("estimated");
    expect(MODEL_PARAMETERS.vehicle.bodyTypePhysics.value.suv_compact).toEqual({
      dragAreaM2: 0.75,
      rollingResistance: 0.009,
    });
  });
});

describe("reserveSocPct", () => {
  it("la reserva es solo el margen de seguridad del viaje (ADR-0016, ADR-0017)", () => {
    expect(reserveSocPct(conditions())).toBe(10);
    expect(reserveSocPct(conditions({ safetyMode: "conservative" }))).toBe(20);
    expect(reserveSocPct(conditions({ safetyMode: "custom", customSafetyPct: 7 }))).toBe(7);
  });
});

describe("toTripConfiguration", () => {
  it("traduce condiciones y vehículo sin perder nada", () => {
    const cfg = toTripConfiguration(vehicle({ adapters: [{ from: "gb_t", to: "ccs2" }] }), conditions());
    expect(cfg).toEqual({
      initialSocPercent: 80,
      occupantsMassKg: 150,
      luggageMassKg: 30,
      drivingMode: "normal",
      regenerationMode: "medium",
      hvacMode: "normal",
      ambient: { temperatureC: null, temperatureSource: "none", windKmh: null, windDirDeg: null },
      cruiseSpeedKmh: null,
      reserveSocPercent: 10,
      minimumSocPercent: 7,
      destinationReserveSocPercent: 7,
      belowMarginPenaltyMinPerPct: 4,
      maxChargeTargetSocPercent: 80,
      planningEnergyMarginPercent: 0,
      objective: "fastest",
      adapters: [{ from: "gb_t", to: "ccs2" }],
    });
  });

  it("el margen es el objetivo; en ruta y al destino se puede bajar 3 puntos de él (ADR-0019)", () => {
    for (const c of [conditions(), conditions({ safetyMode: "conservative" })]) {
      const cfg = toTripConfiguration(vehicle(), c);
      expect(cfg.reserveSocPercent).toBe(reserveSocPct(c));
      expect(cfg.minimumSocPercent).toBe(reserveSocPct(c) - 3);
      expect(cfg.destinationReserveSocPercent).toBe(reserveSocPct(c) - 3);
      expect(flexibleReserveSocPct(c)).toBe(reserveSocPct(c) - 3);
    }
  });

  it("el margen flexible no baja de 5 %, ni del margen si este ya es menor", () => {
    expect(flexibleReserveSocPct(conditions({ safetyMode: "custom", customSafetyPct: 7 }))).toBe(5);
    expect(flexibleReserveSocPct(conditions({ safetyMode: "custom", customSafetyPct: 4 }))).toBe(4);
  });

  it("con 'permitir bajar del margen' el destino pide el margen flexible", () => {
    const cfg = toTripConfiguration(vehicle(), conditions({ allowBelowSafety: true, safetyMode: "normal" }));
    expect(cfg.minimumSocPercent).toBe(5);
    expect(cfg.destinationReserveSocPercent).toBe(12);
  });

  it("con 'permitir bajar del margen' el piso en ruta es 5 %", () => {
    expect(toTripConfiguration(vehicle(), conditions({ allowBelowSafety: true })).minimumSocPercent).toBe(5);
  });

  it("temperatura: la del usuario manda sobre la del clima", () => {
    const weather = { temperatureC: 18, windKmh: 10, windDirDeg: 90 };
    const fromUser = toTripConfiguration(vehicle(), conditions({ temperatureC: 25 }), weather);
    expect(fromUser.ambient).toEqual({ temperatureC: 25, temperatureSource: "user", windKmh: 10, windDirDeg: 90 });
    const fromWeather = toTripConfiguration(vehicle(), conditions(), weather);
    expect(fromWeather.ambient.temperatureC).toBe(18);
    expect(fromWeather.ambient.temperatureSource).toBe("weather");
  });

  it("sin pasajeros ni equipaje negativos; tope de carga a 100 %", () => {
    const params = {
      ...MODEL_PARAMETERS,
      planner: { ...MODEL_PARAMETERS.planner, maxChargeTargetSocPct: sourced(120, "configurable") },
    };
    const cfg = toTripConfiguration(vehicle(), conditions({ passengers: -1, luggageKg: -5 }), null, params);
    expect(cfg.occupantsMassKg).toBe(75);
    expect(cfg.luggageMassKg).toBe(0);
    expect(cfg.maxChargeTargetSocPercent).toBe(100);
  });
});
