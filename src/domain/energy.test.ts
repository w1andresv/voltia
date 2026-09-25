import { describe, expect, it } from "vitest";
import {
  REGEN_RECOVERY,
  acPowerKw,
  airDensity,
  airSpeedSq,
  annotateEnergy,
  batteryBudget,
  climateMultiplier,
  consumptionBlocks,
  effectiveRegen,
  energyMode,
  hasManualConsumption,
  manualSpeedFactor,
  mixedCycleKwhPer100,
  segmentEnergyBreakdown,
  segmentTempC,
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
    regenLevel: "medium",
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
    expect(effectiveRegen(conditions(), 99)).toBe(0);
  });

  it("a SOC medio vale la recuperación del nivel elegido", () => {
    expect(effectiveRegen(conditions({ regenLevel: "low" }), 50)).toBe(REGEN_RECOVERY.low);
    expect(effectiveRegen(conditions({ regenLevel: "medium" }), 50)).toBe(REGEN_RECOVERY.medium);
    expect(effectiveRegen(conditions({ regenLevel: "high" }), 50)).toBe(REGEN_RECOVERY.high);
  });

  it("entre 80 % y 98 % baja en línea: a 89 % vale la mitad", () => {
    expect(effectiveRegen(conditions(), 89)).toBeCloseTo(REGEN_RECOVERY.medium / 2, 6);
  });

  it("los niveles van de menor a mayor", () => {
    expect(REGEN_RECOVERY.low).toBeLessThan(REGEN_RECOVERY.medium);
    expect(REGEN_RECOVERY.medium).toBeLessThan(REGEN_RECOVERY.high);
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

describe("bajadas: la gravedad paga primero rodadura y aire", () => {
  const ctx = (overrides: Partial<TripConditions> = {}) => ({
    vehicle: vehicle(),
    conditions: conditions(overrides),
    weather: null,
  });

  it("una bajada suave (−2 %) gasta mucho menos que el llano y no regenera", () => {
    const flat = segmentEnergyBreakdown(1, 0, 80, ctx());
    const gentle = segmentEnergyBreakdown(1, -20, 80, ctx());
    expect(gentle.regenKwh).toBe(0);
    expect(gentle.netKwh).toBeLessThan(flat.netKwh * 0.5);
  });

  it("una bajada fuerte deja el neto negativo: la batería gana carga", () => {
    const steep = segmentEnergyBreakdown(1, -80, 60, ctx());
    expect(steep.regenKwh).toBeGreaterThan(0);
    expect(steep.grossKwh).toBeGreaterThanOrEqual(0);
    expect(steep.netKwh).toBeLessThan(0);
  });

  it("más nivel de regeneración, más recuperado en la misma bajada", () => {
    const low = segmentEnergyBreakdown(1, -80, 60, ctx({ regenLevel: "low" }));
    const medium = segmentEnergyBreakdown(1, -80, 60, ctx({ regenLevel: "medium" }));
    const high = segmentEnergyBreakdown(1, -80, 60, ctx({ regenLevel: "high" }));
    expect(low.regenKwh).toBeLessThan(medium.regenKwh);
    expect(medium.regenKwh).toBeLessThan(high.regenKwh);
  });

  it("subir y bajar lo mismo cuesta más que el llano, pero menos que subir y volver por llano", () => {
    const up = segmentEnergyBreakdown(20, 800, 60, ctx()).netKwh;
    const down = segmentEnergyBreakdown(20, -800, 60, ctx()).netKwh;
    const flat = segmentEnergyBreakdown(20, 0, 60, ctx()).netKwh;
    expect(up + down).toBeGreaterThan(2 * flat);
    expect(up + down).toBeLessThan(up + flat);
  });

  it("el estilo no encarece la energía de la pendiente, solo rodadura y aire", () => {
    const climbCost = (style: TripConditions["drivingStyle"]) =>
      segmentEnergyBreakdown(10, 500, 80, ctx({ drivingStyle: style })).netKwh -
      segmentEnergyBreakdown(10, 0, 80, ctx({ drivingStyle: style })).netKwh;
    expect(climbCost("sport")).toBeCloseTo(climbCost("normal"), 6);
  });
});

describe("altitud y temperatura por tramo", () => {
  it("la densidad del aire es 1,225 a nivel del mar y 15 °C, y baja con la altura", () => {
    expect(airDensity(15, 0)).toBeCloseTo(1.225, 3);
    expect(airDensity(15, 2600)).toBeLessThan(0.97);
  });

  it("el mismo tramo llano gasta menos a 2600 m que a nivel del mar", () => {
    const c = { vehicle: vehicle(), conditions: conditions(), weather: null };
    const sea = segmentEnergyBreakdown(10, 0, 100, c, 50, { altitudeM: 0 });
    const high = segmentEnergyBreakdown(10, 0, 100, c, 50, { altitudeM: 2600 });
    expect(high.netKwh).toBeLessThan(sea.netKwh);
  });

  it("la temperatura del usuario se asume en el origen y baja 6,5 °C por km", () => {
    const c = { vehicle: vehicle(), conditions: conditions({ temperatureC: 20 }), weather: null, originAltitudeM: 1000 };
    expect(segmentTempC(c, 2000)).toBeCloseTo(13.5, 6);
    expect(segmentTempC(c)).toBe(20);
  });

  it("la del clima se corrige desde la altura de su celda; sin esa altura no se corrige", () => {
    const withElev = { temperatureC: 25, windKmh: 0, windDirDeg: 0, elevationM: 500 };
    const noElev = { temperatureC: 25, windKmh: 0, windDirDeg: 0 };
    const c = conditions({ temperatureC: null });
    expect(segmentTempC({ vehicle: vehicle(), conditions: c, weather: withElev }, 2500)).toBeCloseTo(12, 6);
    expect(segmentTempC({ vehicle: vehicle(), conditions: c, weather: noElev }, 2500)).toBe(25);
  });

  it("climateMultiplier no salta entre 14,9 °C y 15 °C", () => {
    expect(Math.abs(climateMultiplier(14.9) - climateMultiplier(15))).toBeLessThan(0.01);
  });
});

describe("viento", () => {
  const wind = { temperatureC: 20, windKmh: 40, windDirDeg: 0 };

  it("de frente gasta más que de cola; sin rumbo queda en medio", () => {
    const head = airSpeedSq(90, wind, 0); // va al norte, el viento viene del norte
    const tail = airSpeedSq(90, wind, 180);
    const unknown = airSpeedSq(90, wind);
    expect(head).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(tail);
  });

  it("sin viento es v²", () => {
    expect(airSpeedSq(72, null)).toBeCloseTo(400, 6);
  });
});

describe("manualSpeedFactor", () => {
  const ctx = { vehicle: vehicle(), conditions: conditions(), weather: null };

  it("vale 1 a 70 km/h y sigue subiendo por encima de 110 km/h", () => {
    expect(manualSpeedFactor(70, ctx)).toBeCloseTo(1, 6);
    expect(manualSpeedFactor(120, ctx)).toBeGreaterThan(manualSpeedFactor(110, ctx));
    expect(manualSpeedFactor(120, ctx)).toBeGreaterThan(1.7);
  });
});

describe("annotateEnergy", () => {
  it("acumula el neto, puede bajar en bajada y sube el SOC al regenerar", () => {
    const base = { lat: 7, lon: -73, slopePct: 0, speedKmh: 60 };
    const samples = [
      { ...base, km: 0, elevM: 1500 },
      { ...base, km: 1, lat: 7.009, elevM: 1420 },
      { ...base, km: 2, lat: 7.018, elevM: 1340 },
    ];
    const ctx = { vehicle: vehicle(), conditions: conditions(), weather: null };
    const out = annotateEnergy(samples, ctx, 50);
    expect(out[0]!.energyKwh).toBe(0);
    expect(out[2]!.cumulativeKwh).toBeLessThan(0);
    expect(out[2]!.soc).toBeGreaterThan(50);
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

describe("consumptionBlocks", () => {
  const sample = (km: number, cumulativeKwh: number, elevM = 0) => ({
    km,
    lat: 7,
    lon: -73,
    elevM,
    slopePct: 0,
    speedKmh: 80,
    energyKwh: 0,
    energyGrossKwh: 0,
    energyRegenKwh: 0,
    cumulativeKwh,
    avgKwhPer100: 0,
    soc: 50,
  });

  it("parte la ruta cada 100 km e interpola en los bordes", () => {
    const samples = [sample(0, 0), sample(150, 30), sample(250, 40)];
    const blocks = consumptionBlocks(samples);
    expect(blocks.map((b) => [b.fromKm, b.toKm])).toEqual([
      [0, 100],
      [100, 200],
      [200, 250],
    ]);
    expect(blocks[0]!.kwh).toBeCloseTo(20, 6);
    expect(blocks[1]!.kwh).toBeCloseTo(15, 6);
    expect(blocks[2]!.kwhPer100).toBeCloseTo(10, 6);
    expect(blocks.reduce((a, b) => a + b.kwh, 0)).toBeCloseTo(40, 6);
  });

  it("un resto final corto se suma al tramo anterior", () => {
    const blocks = consumptionBlocks([sample(0, 0), sample(409, 58.7)]);
    expect(blocks.map((b) => b.toKm)).toEqual([100, 200, 300, 409]);
    expect(blocks[3]!.fromKm).toBe(300);
  });

  it("separa subida y bajada de cada tramo", () => {
    const samples = [sample(0, 0, 1000), sample(50, 10, 1500), sample(100, 12, 1200)];
    const [b] = consumptionBlocks(samples);
    expect(b!.gainM).toBeCloseTo(500, 6);
    expect(b!.lossM).toBeCloseTo(300, 6);
  });

  it("sin ruta no hay tramos", () => {
    expect(consumptionBlocks([])).toEqual([]);
    expect(consumptionBlocks([sample(0, 0)])).toEqual([]);
  });
});
