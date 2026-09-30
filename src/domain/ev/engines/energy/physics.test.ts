import { describe, expect, it } from "vitest";
import type { TripConditions, Vehicle } from "@/domain/types";
import { G_STANDARD_MS2, J_PER_KWH } from "@/domain/ev/core/units";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import { airDensity, type EnergyContext } from "./environment";
import {
  calibrateToManual,
  energyProfileV2,
  localNetRateKwhPerKm,
  segmentEnergyV2,
  stopEnergyKwh,
  temperatureFactor,
} from "./physics";
import {
  estimatedParams,
  resolveVehicleEnergyParams,
  type VehicleEnergyParams,
} from "./vehicle-params";

const vehicle = {
  id: "t",
  brand: "T",
  model: "EV",
  year: 2025,
  version: "x",
  batteryKwh: 60,
  rangeKm: 400,
  consumptionKwhPer100km: null,
  weightKg: 1800,
  motorKw: 150,
  acMaxKw: 11,
  dcMaxKw: 120,
  chargeCurve: [],
  connectors: ["ccs2"],
  bodyType: "sedan",
} as Vehicle;

const conditions = {
  passengers: 0,
  luggageKg: 0,
  initialSoc: 80,
  arrivalSoc: 10,
  avgSpeedKmh: null,
  ac: "off",
  temperatureC: 20,
  drivingStyle: "normal",
  safetyMode: "normal",
  customSafetyPct: 15,
  planningMode: "fastest",
  allowBelowSafety: false,
  regenLevel: "medium",
} as TripConditions;

const ctx: EnergyContext = { vehicle, conditions, weather: null, originAltitudeM: 0 };
const vp = resolveVehicleEnergyParams(vehicle, conditions);
const regen = MODEL_PARAMETERS.energy.regenModes.value.medium;
const kwh = (j: number) => j / J_PER_KWH;
/** Vehículo + conductor (tripMassKg suma 75 kg aunque no haya pasajeros). */
const M = vp.massKg.value;

describe("resolveVehicleEnergyParams", () => {
  it("lo que el vehículo no trae sale de los valores por defecto, marcado estimated", () => {
    expect(vp.massKg.source).toBe("calculated");
    expect(vp.massKg.value).toBeGreaterThanOrEqual(1800);
    expect(vp.dragAreaM2).toMatchObject({ value: 0.55, source: "estimated" });
    expect(vp.drivetrainEfficiency).toMatchObject({ value: 0.9, source: "estimated" });
    expect(estimatedParams(vp)).toEqual([
      "dragAreaM2",
      "rollingResistance",
      "rotationalInertiaFactor",
      "drivetrainEfficiency",
      "regenEfficiency",
      "maxRegenPowerKw",
      "baseAuxPowerKw",
    ]);
  });

  it("lo que el vehículo trae se usa y se marca configurable; la potencia del motor no cuenta", () => {
    const own = resolveVehicleEnergyParams(
      {
        ...vehicle,
        dragAreaM2: 0.5,
        drivetrainEfficiency: 0.93,
        maxRegenPowerKw: 100,
        motorKw: 400,
      },
      { ...conditions, passengers: 2, luggageKg: 20 },
    );
    expect(own.dragAreaM2).toMatchObject({ value: 0.5, source: "configurable" });
    expect(own.drivetrainEfficiency.value).toBe(0.93);
    expect(own.maxRegenPowerKw.value).toBe(100);
    expect(own.massKg.value).toBeGreaterThan(M);
  });
});

describe("segmentEnergyV2 — resultados analíticos (especificación §8.3)", () => {
  it("llano a velocidad constante: E = (Crr·m·g + ½ρ·CdA·v²)·d / η + auxiliares", () => {
    const v = 25; // 90 km/h
    const d = 1000;
    const seg = segmentEnergyV2(
      { horizontalM: d, deltaHM: 0, v1Ms: v, v2Ms: v, altitudeM: 0 },
      vp,
      ctx,
      regen,
    );
    const rho = airDensity(20, 0);
    const wheel = (0.009 * M * G_STANDARD_MS2 + 0.5 * rho * 0.55 * v * v) * d;
    expect(seg.tractionEnergyKwh).toBeCloseTo(kwh(wheel) / 0.9, 12);
    expect(seg.auxiliaryEnergyKwh).toBeCloseTo(0.45 * (d / v / 3600), 12);
    expect(seg.durationS).toBeCloseTo(40, 12);
    expect(seg.accelerationForceN).toBe(0);
    expect(seg.energyRegeneratedKwh).toBe(0);
  });

  it("la pendiente suma exactamente m·g·Δh, sin importar el tamaño del tramo", () => {
    const grade = (n: number) => {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const s = segmentEnergyV2(
          { horizontalM: 2000 / n, deltaHM: 100 / n, v1Ms: 20, v2Ms: 20, altitudeM: 1000 },
          vp,
          ctx,
          regen,
        );
        sum += s.gradeForceN * s.distanceM;
      }
      return sum;
    };
    expect(grade(1)).toBeCloseTo(M * G_STANDARD_MS2 * 100, 6);
    expect(grade(37)).toBeCloseTo(M * G_STANDARD_MS2 * 100, 6);
  });

  it("ciclo 0 → v → 0: la aceleración cuesta ½·m_eff·v²/η y el frenado recupera como mucho la fracción del modo", () => {
    const flatNoLosses: VehicleEnergyParams = {
      ...vp,
      rollingResistance: { ...vp.rollingResistance, value: 0 },
      dragAreaM2: { ...vp.dragAreaM2, value: 0 },
      baseAuxPowerKw: { ...vp.baseAuxPowerKw, value: 0 },
      maxRegenPowerKw: { ...vp.maxRegenPowerKw, value: 10_000 },
    };
    const v = 20;
    const up = segmentEnergyV2(
      { horizontalM: 200, deltaHM: 0, v1Ms: 0, v2Ms: v, altitudeM: 0 },
      flatNoLosses,
      ctx,
      regen,
    );
    const down = segmentEnergyV2(
      { horizontalM: 200, deltaHM: 0, v1Ms: v, v2Ms: 0, altitudeM: 0 },
      flatNoLosses,
      ctx,
      regen,
    );
    const kinetic = kwh(0.5 * M * 1.05 * v * v);
    expect(up.tractionEnergyKwh).toBeCloseTo(kinetic / 0.9, 12);
    expect(down.wheelEnergyKwh).toBeCloseTo(-kinetic, 12);
    expect(down.energyRegeneratedKwh).toBeCloseTo(kinetic * 0.7 * 0.8, 12);
    expect(down.frictionBrakeEnergyKwh).toBeCloseTo(kinetic - (kinetic * 0.7 * 0.8) / 0.8, 12);
    expect(up.durationS).toBeCloseTo(20, 12);
  });

  it("la regeneración no pasa del tope de potencia del modo", () => {
    const small = { ...vp, maxRegenPowerKw: { ...vp.maxRegenPowerKw, value: 10 } };
    const seg = segmentEnergyV2(
      { horizontalM: 1000, deltaHM: -150, v1Ms: 20, v2Ms: 20, altitudeM: 1000 },
      small,
      ctx,
      regen,
    );
    const capKwh = 10 * 0.8 * (seg.durationS / 3600);
    expect(seg.energyRegeneratedKwh).toBeCloseTo(capKwh, 12);
    expect(seg.netEnergyKwh).toBeLessThan(0);
  });

  it("los auxiliares se pagan también en bajada, y el aire acondicionado suma", () => {
    const withAc = { ...ctx, conditions: { ...conditions, ac: "normal" as const } };
    const a = segmentEnergyV2(
      { horizontalM: 1000, deltaHM: -100, v1Ms: 15, v2Ms: 15, altitudeM: 500 },
      vp,
      ctx,
      regen,
    );
    const b = segmentEnergyV2(
      { horizontalM: 1000, deltaHM: -100, v1Ms: 15, v2Ms: 15, altitudeM: 500 },
      vp,
      withAc,
      regen,
    );
    expect(a.auxiliaryEnergyKwh).toBeGreaterThan(0);
    expect(a.energyConsumedKwh).toBe(a.auxiliaryEnergyKwh);
    expect(b.auxiliaryEnergyKwh - a.auxiliaryEnergyKwh).toBeCloseTo(1.2 * (a.durationS / 3600), 12);
  });

  it("tramo sin distancia no gasta; distancia sin velocidad es un error", () => {
    expect(
      segmentEnergyV2(
        { horizontalM: 0, deltaHM: 0, v1Ms: 0, v2Ms: 0, altitudeM: 0 },
        vp,
        ctx,
        regen,
      ).netEnergyKwh,
    ).toBe(0);
    expect(() =>
      segmentEnergyV2(
        { horizontalM: 10, deltaHM: 0, v1Ms: 0, v2Ms: 0, altitudeM: 0 },
        vp,
        ctx,
        regen,
      ),
    ).toThrow(/velocidad cero/);
  });
});

describe("calibrateToManual", () => {
  it("en llano a la velocidad de referencia el consumo es el manual", () => {
    const cal = calibrateToManual(vp, ctx, 16, 70);
    const v = 70 / 3.6;
    const seg = segmentEnergyV2(
      { horizontalM: 100_000, deltaHM: 0, v1Ms: v, v2Ms: v, altitudeM: 0 },
      cal,
      ctx,
      regen,
    );
    expect(seg.energyConsumedKwh).toBeCloseTo(16, 9);
    expect(cal.dragAreaM2.source).toBe("calculated");
    expect(cal.dragAreaM2.notes).toMatch(/consumo manual/);
  });

  it("el ajuste se acota entre 0,5 y 2", () => {
    expect(calibrateToManual(vp, ctx, 1).dragAreaM2.value).toBeCloseTo(0.55 * 0.5, 12);
    expect(calibrateToManual(vp, ctx, 200).dragAreaM2.value).toBeCloseTo(0.55 * 2, 12);
  });
});

describe("energyProfileV2", () => {
  it("agrega los tramos en las muestras y la suma es el total", () => {
    const samples = [0, 1, 2].map((km) => ({
      km,
      lat: 7 + km / 111,
      lon: -73,
      elevM: km * 50,
      slopePct: 5,
      speedKmh: 60,
    }));
    const mesh = [0, 0.5, 1, 1.5, 2].map((km) => ({
      km,
      lat: 7 + km / 111,
      lon: -73,
      headingDeg: 0,
    }));
    const speed = [0, 40, 60, 40, 0].map((v, i) => ({
      km: mesh[i]!.km,
      speedKmh: v,
      targetKmh: 60,
      accelerationMs2: 0,
      limitingFactor: "traffic" as const,
    }));
    const out = energyProfileV2(samples, mesh, speed, vp, ctx, regen);
    expect(out.samples).toHaveLength(3);
    expect(out.samples[0]!.energyKwh).toBe(0);
    expect(out.samples[2]!.cumulativeKwh).toBeCloseTo(out.totals.netEnergyKwh, 12);
    expect(out.segments).toBe(4);
    expect(out.durationMinutes).toBeGreaterThan(0);
    expect(out.samples[1]!.speedKmh).toBeGreaterThan(0);
    // Sube 100 m: la energía de la pendiente está en el total.
    expect(out.totals.netEnergyKwh).toBeGreaterThan(kwh(M * G_STANDARD_MS2 * 100));
  });
});

describe("temperatura (D4)", () => {
  it("factor interpolado: frío como el modelo anterior, templado 1, calor casi plano", () => {
    expect(temperatureFactor(-5)).toBe(1.28);
    expect(temperatureFactor(5)).toBeCloseTo(1.16, 12);
    expect(temperatureFactor(12.5)).toBeCloseTo(1.035, 12);
    expect(temperatureFactor(20)).toBe(1);
    expect(temperatureFactor(35)).toBeCloseTo(1.015, 12);
    expect(temperatureFactor(45)).toBe(1.03);
    expect(temperatureFactor(10, [])).toBe(1);
  });

  it("a 10 °C la tracción sube 7 %; los auxiliares y la regeneración no cambian por el factor", () => {
    const cold = { ...ctx, conditions: { ...conditions, temperatureC: 10 } };
    const seg = { horizontalM: 1000, deltaHM: 0, v1Ms: 20, v2Ms: 20, altitudeM: 0 };
    const warmTraction = segmentEnergyV2(seg, vp, cold, regen, [[0, 1]]).tractionEnergyKwh;
    const coldTraction = segmentEnergyV2(seg, vp, cold, regen).tractionEnergyKwh;
    expect(coldTraction / warmTraction).toBeCloseTo(1.07, 12);
  });
});

describe("desvíos y paradas (§5.8.1)", () => {
  const samples = [0, 1, 2, 3, 4, 5, 6].map((km, i) => ({
    km,
    cumulativeKwh: [0, 0.2, 0.4, 0.3, 0.2, 0.4, 0.6][i]!,
  }));

  it("consumo neto local en ±2 km, prorrateado y nunca negativo", () => {
    expect(localNetRateKwhPerKm(samples, 1, 1)).toBeCloseTo(0.2, 12);
    expect(localNetRateKwhPerKm(samples, 3.5, 0.5)).toBe(0); // bajada: no regala energía
    expect(localNetRateKwhPerKm(samples, 0, 2)).toBeCloseTo(0.2, 12); // recorta en el origen
    expect(localNetRateKwhPerKm(samples.slice(0, 1), 0)).toBe(0);
  });

  it("parar y arrancar cuesta ½·m_eff·v²·(1/η − captura·η_regen)", () => {
    const kinetic = kwh(0.5 * M * 1.05 * 25 * 25);
    expect(stopEnergyKwh(vp, regen, 90)).toBeCloseTo(kinetic * (1 / 0.9 - 0.7 * 0.8), 12);
    expect(stopEnergyKwh(vp, regen, 0)).toBe(0);
  });
});
