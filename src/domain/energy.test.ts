import { describe, expect, it } from "vitest";
import {
  acPowerKw,
  batteryBudget,
  climateMultiplier,
  effectiveRegen,
  energyMode,
  hasManualConsumption,
  mixedCycleKwhPer100,
  segmentEnergyBreakdown,
  wltpKwhPer100,
} from "./energy";
import { DEFAULT_CURVE } from "./charging";
import type { TripConditions, Vehicle } from "./types";

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
    regenPct: 20,
    ...overrides,
  };
}

describe("hasManualConsumption / energyMode", () => {
  it("es manual solo con la bandera y un consumo positivo", () => {
    const v = vehicle({ consumptionManual: true, consumptionKwhPer100km: 18 });
    expect(hasManualConsumption(v)).toBe(true);
    expect(energyMode(v)).toBe("manual");
  });

  it("es estimado si falta la bandera o el consumo", () => {
    expect(hasManualConsumption(vehicle())).toBe(false);
    expect(energyMode(vehicle())).toBe("estimated");
  });
});

describe("wltpKwhPer100", () => {
  it("calcula el ratio batería/autonomía homologada", () => {
    const v = vehicle({ batteryKwh: 60, rangeKm: 400 });
    expect(wltpKwhPer100(v)).toBeCloseTo(15, 6);
  });

  it("da null si falta batería o autonomía", () => {
    expect(wltpKwhPer100(vehicle({ rangeKm: 0 }))).toBeNull();
  });
});

describe("climateMultiplier", () => {
  it("penaliza frío y calor extremos más que el rango templado", () => {
    const templado = climateMultiplier(20);
    expect(climateMultiplier(-5)).toBeGreaterThan(templado);
    expect(climateMultiplier(35)).toBeGreaterThan(templado);
  });

  it("es 1 en el rango templado (15–26°C)", () => {
    expect(climateMultiplier(20)).toBe(1);
  });
});

describe("acPowerKw", () => {
  it("es 0 cuando el A/C está apagado, sin importar la temperatura", () => {
    expect(acPowerKw("off", -5)).toBe(0);
    expect(acPowerKw("off", 35)).toBe(0);
  });

  it("sube con frío o calor extremos respecto a temperatura templada", () => {
    const base = acPowerKw("normal", 20);
    expect(acPowerKw("normal", 0)).toBeGreaterThan(base);
    expect(acPowerKw("normal", 35)).toBeGreaterThan(base);
  });
});

describe("effectiveRegen", () => {
  it("es 0 cuando el SOC está casi lleno (>=98%)", () => {
    expect(effectiveRegen(vehicle(), conditions(), 99)).toBe(0);
  });

  it("es positivo a SOC medio", () => {
    expect(effectiveRegen(vehicle(), conditions(), 50)).toBeGreaterThan(0);
  });
});

describe("segmentEnergyBreakdown", () => {
  it("un tramo de distancia 0 no consume energía", () => {
    const slice = segmentEnergyBreakdown(0, 0, 90, { vehicle: vehicle(), conditions: conditions(), weather: null });
    expect(slice).toEqual({ grossKwh: 0, regenKwh: 0, netKwh: 0 });
  });

  it("una subida de 1000 m consume más que el mismo tramo llano", () => {
    const ctx = { vehicle: vehicle(), conditions: conditions(), weather: null };
    const flat = segmentEnergyBreakdown(50, 0, 90, ctx);
    const climb = segmentEnergyBreakdown(50, 1000, 90, ctx);
    expect(climb.netKwh).toBeGreaterThan(flat.netKwh);
  });

  it("una bajada de 1000 m recupera menos energía de la que costó subirla (pérdidas del sistema)", () => {
    const ctx = { vehicle: vehicle(), conditions: conditions(), weather: null };
    const climb = segmentEnergyBreakdown(50, 1000, 90, ctx);
    const descent = segmentEnergyBreakdown(50, -1000, 90, ctx);
    // La bajada gasta menos que la subida...
    expect(descent.netKwh).toBeLessThan(climb.netKwh);
    // ...y lo que se regenera no cubre toda la energía potencial de la subida.
    expect(descent.regenKwh).toBeLessThan(climb.netKwh);
  });

  it("clima frío o caliente sube el consumo frente al mismo tramo templado", () => {
    const base = { vehicle: vehicle(), conditions: conditions({ temperatureC: 20 }), weather: null };
    const cold = { vehicle: vehicle(), conditions: conditions({ temperatureC: -5 }), weather: null };
    const hot = { vehicle: vehicle(), conditions: conditions({ temperatureC: 35 }), weather: null };
    const baseKwh = segmentEnergyBreakdown(50, 0, 90, base).netKwh;
    expect(segmentEnergyBreakdown(50, 0, 90, cold).netKwh).toBeGreaterThan(baseKwh);
    expect(segmentEnergyBreakdown(50, 0, 90, hot).netKwh).toBeGreaterThan(baseKwh);
  });

  it("el consumo manual manda sobre el estimado por física", () => {
    const manualVehicle = vehicle({ consumptionManual: true, consumptionKwhPer100km: 40 });
    const estimatedVehicle = vehicle();
    const ctxManual = { vehicle: manualVehicle, conditions: conditions(), weather: null };
    const ctxEstimated = { vehicle: estimatedVehicle, conditions: conditions(), weather: null };
    const manual = segmentEnergyBreakdown(100, 0, 90, ctxManual);
    const estimated = segmentEnergyBreakdown(100, 0, 90, ctxEstimated);
    // Un consumo manual muy alto (40 kWh/100km) se nota lejos del estimado físico.
    expect(Math.abs(manual.netKwh - estimated.netKwh)).toBeGreaterThan(5);
  });
});

describe("mixedCycleKwhPer100", () => {
  it("con consumo manual, devuelve exactamente ese valor", () => {
    const v = vehicle({ consumptionManual: true, consumptionKwhPer100km: 18 });
    expect(mixedCycleKwhPer100(v, conditions(), null)).toBe(18);
  });

  it("sin consumo manual, se acerca al consumo homologado WLTP", () => {
    const v = vehicle({ batteryKwh: 60, rangeKm: 400 }); // WLTP ~15 kWh/100km
    const est = mixedCycleKwhPer100(v, conditions(), null);
    expect(est).toBeGreaterThan(8);
    expect(est).toBeLessThan(30);
  });
});

describe("batteryBudget", () => {
  it("el piso de SOC respeta el máximo entre seguridad, mínimo del vehículo y SOC de llegada", () => {
    const v = vehicle({ minSocRecommended: 12 });
    const c = conditions({ safetyMode: "normal", arrivalSoc: 25 });
    const budget = batteryBudget(v, c, null);
    // safetyPct("normal") = 15, minSocRecommended = 12, arrivalSoc = 25 -> floor = 25
    expect(budget.floorPct).toBe(25);
  });

  it("la autonomía usable es 0 si el SOC inicial ya está en el piso", () => {
    const v = vehicle();
    const c = conditions({ initialSoc: 15, safetyMode: "conservative" }); // floor = 20
    const budget = batteryBudget(v, c, null);
    expect(budget.usablePct).toBe(0);
    expect(budget.rangeKm).toBe(0);
  });
});
