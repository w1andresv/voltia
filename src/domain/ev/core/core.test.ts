import { describe, expect, it } from "vitest";
import type { TripConditions, Vehicle } from "../../types";
import { DEFAULT_CURVE } from "../../charging";
import { MODEL_PARAMETERS } from "./params";
import { isEstimated, sourced } from "./provenance";
import { socFloors, toTripConfiguration } from "./trip-config";
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
    minSocRecommended: 15,
    maxSocTravel: 80,
    ...overrides,
  };
}

function conditions(overrides: Partial<TripConditions> = {}): TripConditions {
  return {
    passengers: 1,
    luggageKg: 30,
    initialSoc: 80,
    arrivalSoc: 10,
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
    expect(MODEL_PARAMETERS.corridor).toEqual({ maxFromRouteKm: 12, preferredFromRouteKm: 5 });
    expect(MODEL_PARAMETERS.planner).toEqual({
      maxStops: 7,
      minProgressKm: 4,
      detourSpeedKmh: 50,
      socTolerancePct: 1e-4,
      belowSafetyFloorPct: 2,
    });
    expect(MODEL_PARAMETERS.planning.energyMarginPercent).toBe(0);
    expect(MODEL_PARAMETERS.vehicle.bodyTypePhysics.source).toBe("estimated");
    expect(MODEL_PARAMETERS.vehicle.bodyTypePhysics.value.suv_compact).toEqual({
      dragAreaM2: 0.75,
      rollingResistance: 0.009,
    });
  });
});

describe("socFloors", () => {
  it("la reserva es el mayor entre el margen y el mínimo del vehículo", () => {
    expect(socFloors({ minSocRecommended: 15 }, conditions()).reservePct).toBe(15);
    expect(socFloors({ minSocRecommended: 5 }, conditions()).reservePct).toBe(10);
    expect(socFloors({ minSocRecommended: 5 }, conditions({ safetyMode: "conservative" })).reservePct).toBe(20);
  });

  it("el objetivo al destino no baja de la reserva", () => {
    expect(socFloors({ minSocRecommended: 15 }, conditions()).arrivalTargetPct).toBe(15);
    expect(socFloors({ minSocRecommended: 15 }, conditions({ arrivalSoc: 30 })).arrivalTargetPct).toBe(30);
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
      reserveSocPercent: 15,
      minimumSocPercent: 15,
      destinationReserveSocPercent: 15,
      maxChargeTargetSocPercent: 80,
      planningEnergyMarginPercent: 0,
      objective: "fastest",
      adapters: [{ from: "gb_t", to: "ccs2" }],
    });
  });

  it("los pisos coinciden con socFloors", () => {
    for (const c of [conditions(), conditions({ safetyMode: "conservative", arrivalSoc: 25 })]) {
      const floors = socFloors(vehicle(), c);
      const cfg = toTripConfiguration(vehicle(), c);
      expect(cfg.reserveSocPercent).toBe(floors.reservePct);
      expect(cfg.destinationReserveSocPercent).toBe(floors.arrivalTargetPct);
    }
  });

  it("con 'permitir bajar del margen' el piso en ruta es 2 %", () => {
    expect(toTripConfiguration(vehicle(), conditions({ allowBelowSafety: true })).minimumSocPercent).toBe(2);
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
    const cfg = toTripConfiguration(vehicle({ maxSocTravel: 120 }), conditions({ passengers: -1, luggageKg: -5 }));
    expect(cfg.occupantsMassKg).toBe(75);
    expect(cfg.luggageMassKg).toBe(0);
    expect(cfg.maxChargeTargetSocPercent).toBe(100);
  });
});
