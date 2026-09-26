import { describe, expect, it } from "vitest";
import type { RawRoute, TripConditions } from "@/domain/types";
import { catalogVehicle } from "@/test-support/scenarios";
import { buildPlan } from "../planner";
import { detourEnergyV2, energyProfileForRoute } from "./energy-v2";

const KM_PER_DEG = 111.195;
function hillRoute(km: number): RawRoute {
  const at = (d: number) => ({ lat: 7 + d / KM_PER_DEG, lon: -73 });
  const samples = Array.from({ length: km + 1 }, (_, i) => ({
    km: i,
    ...at(i),
    elevM: 1000 + 400 * Math.sin((Math.PI * i) / km),
    slopePct: 0,
    speedKmh: 70,
  }));
  return {
    id: "r",
    label: "r",
    geometry: samples.map(({ lat, lon }) => ({ lat, lon })),
    samples,
    distanceKm: km,
    driveMinutes: (km / 70) * 60,
    elevation: { gainM: 400, lossM: 400, minM: 1000, maxM: 1400 },
  };
}

const conditions: TripConditions = {
  passengers: 1,
  luggageKg: 0,
  initialSoc: 80,
  arrivalSoc: 10,
  avgSpeedKmh: null,
  ac: "normal",
  temperatureC: 22,
  drivingStyle: "normal",
  safetyMode: "normal",
  customSafetyPct: 15,
  planningMode: "fastest",
  allowBelowSafety: false,
  regenLevel: "medium",
};
const vehicle = catalogVehicle("mg-s5-ev-deluxe");

describe("energyProfileForRoute", () => {
  it("perfil por muestra, duración del perfil de velocidad y supuestos", () => {
    const out = energyProfileForRoute(hillRoute(40), vehicle, conditions, null);
    expect(out.samples).toHaveLength(41);
    expect(out.samples[40]!.cumulativeKwh).toBeCloseTo(out.totals.netEnergyKwh, 9);
    expect(out.totals.energyRegeneratedKwh).toBeGreaterThan(0);
    expect(out.speed.points[0]!.speedKmh).toBe(0);
    // Arrancar y parar alarga un poco frente a 70 km/h constantes.
    expect(out.durationMinutes).toBeGreaterThan((40 / 70) * 60);
    expect(out.durationDeviationPct).toBeGreaterThan(0);
    expect(out.assumptions).toContain("drivetrainEfficiency");
    expect(out.assumptions).not.toContain("dragAreaM2"); // el catálogo trae Cd·A
  });

  it("sport gasta más que eficiente en la misma ruta (por velocidad y aceleración, no por un multiplicador)", () => {
    const eff = energyProfileForRoute(
      hillRoute(40),
      vehicle,
      { ...conditions, drivingStyle: "efficient" },
      null,
    );
    const sport = energyProfileForRoute(
      hillRoute(40),
      vehicle,
      { ...conditions, drivingStyle: "sport" },
      null,
    );
    expect(sport.totals.netEnergyKwh).toBeGreaterThan(eff.totals.netEnergyKwh);
    expect(sport.durationMinutes).toBeLessThan(eff.durationMinutes);
  });

  it("con consumo manual, en llano a 70 km/h da el consumo del usuario", () => {
    const flat = hillRoute(100);
    flat.samples.forEach((s) => (s.elevM = 1000));
    const manual = { ...vehicle, consumptionManual: true, consumptionKwhPer100km: 18 };
    const out = energyProfileForRoute(
      flat,
      manual,
      { ...conditions, ac: "off", avgSpeedKmh: 70 },
      null,
    );
    // Arrancar y parar suma algo sobre los 18 kWh/100 km de crucero.
    expect(out.totals.netEnergyKwh).toBeGreaterThan(17.5);
    expect(out.totals.netEnergyKwh).toBeLessThan(19);
    expect(out.params.dragAreaM2.source).toBe("calculated");
  });

  it("una ruta de dos muestras muy corta no falla", () => {
    const tiny = hillRoute(1);
    tiny.samples = [tiny.samples[0]!, { ...tiny.samples[1]!, km: 0.05 }];
    tiny.distanceKm = 0.05;
    tiny.geometry = tiny.samples.map(({ lat, lon }) => ({ lat, lon }));
    expect(() => energyProfileForRoute(tiny, vehicle, conditions, null)).not.toThrow();
  });
});

describe("buildPlan con energyEngine v2", () => {
  it("usa la física v2 y el tiempo del perfil de velocidad", () => {
    const raw = hillRoute(60);
    const base = {
      raw,
      vehicle,
      conditions,
      chargers: [],
      weather: null,
      origin: { label: "A", lat: 7, lon: -73 },
      destination: { label: "B", lat: 7.5, lon: -73 },
    };
    const legacy = buildPlan(base);
    const v2 = buildPlan({ ...base, energyEngine: "v2" });
    expect(legacy.energyEngine).toBe("legacy");
    expect(v2.energyEngine).toBe("v2");
    expect(v2.providerDriveMinutes).toBeCloseTo(raw.driveMinutes, 9);
    expect(v2.energyKwh).not.toBeCloseTo(legacy.energyKwh, 3);
    expect(v2.driveMinutes).not.toBeCloseTo(legacy.driveMinutes, 3);
    expect(v2.energyAssumptions?.length).toBeGreaterThan(0);
  });
});

describe("desvío con el perfil v2", () => {
  it("km de desvío × consumo local + costo de parar", () => {
    const out = energyProfileForRoute(hillRoute(40), vehicle, conditions, null);
    const fn = detourEnergyV2(out);
    const stopOnly = fn(0, 20);
    expect(stopOnly).toBeGreaterThan(0);
    expect(fn(4, 20)).toBeGreaterThan(stopOnly);
    // En la bajada (después de la cima) el consumo local es menor que en la subida.
    expect(fn(4, 35) - fn(0, 35)).toBeLessThan(fn(4, 5) - fn(0, 5));
  });
});
