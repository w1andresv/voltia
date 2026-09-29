import { describe, expect, it } from "vitest";
import type { RawRoute, TripConditions, Vehicle } from "@/domain/types";
import { minimalSnapshot } from "@/test-support/snapshot-fixture";
import { tripRequest, tripSummary } from "@/test-support/trip-fixture";
import {
  calibrationCase,
  fitParameters,
  predictedKwh,
  type CalibrationCase,
} from "./fit-parameters";

const vehicle = tripRequest.vehicle as Vehicle;
const conditions = tripRequest.conditions as TripConditions;

/** Ruta de `km` km hacia el sur con subidas y bajadas suaves. */
function route(id: string, km: number, amplitudeM: number): RawRoute {
  const samples = Array.from({ length: km + 1 }, (_, i) => ({
    km: i,
    lat: 7 - i / 111,
    lon: -73,
    elevM: 1000 + amplitudeM * Math.sin(i / 7),
    slopePct: 0,
    speedKmh: 80,
  }));
  return {
    id,
    label: id,
    geometry: samples.map(({ lat, lon }) => ({ lat, lon })),
    samples,
    distanceKm: km,
    driveMinutes: (km / 80) * 60,
    elevation: { gainM: 0, lossM: 0, minM: 1000 - amplitudeM, maxM: 1000 + amplitudeM },
    engine: "mapbox",
  };
}

function baseCase(tripId: string, raw: RawRoute): CalibrationCase {
  return { tripId, vehicle, conditions, weather: null, raw, detourKwh: 0, observedKwh: 1 };
}

/** Viajes cuyo consumo "real" sale del modelo con la eficiencia multiplicada por `scale`. */
function observedWith(scale: number): CalibrationCase[] {
  return [route("a", 60, 40), route("b", 120, 120), route("c", 90, 0), route("d", 150, 200)].map(
    (raw) => {
      const c = baseCase(raw.id, raw);
      return { ...c, observedKwh: predictedKwh(c, { drivetrainEfficiency: scale }) };
    },
  );
}

describe("fitParameters", () => {
  it("recupera la eficiencia con que se generaron los viajes", () => {
    const fit = fitParameters(observedWith(0.93), { priorWeight: 0 });
    expect(fit.cases).toBe(4);
    expect(fit.knobs[0]!.knob).toBe("drivetrainEfficiency");
    expect(fit.knobs[0]!.scale).toBeCloseTo(0.93, 3);
    expect(fit.knobs[0]!.fitted).toBeCloseTo(0.9 * 0.93, 3);
    // Menos eficiencia = más consumo: antes el modelo subestimaba.
    expect(fit.before.meanRelError).toBeLessThan(-0.05);
    expect(fit.after.meanAbsRelError).toBeLessThan(1e-3);
  });

  it("con la penalización se queda entre lo actual y lo observado", () => {
    const free = fitParameters(observedWith(0.93), { priorWeight: 0 }).knobs[0]!.scale;
    const tied = fitParameters(observedWith(0.93), { priorWeight: 1 }).knobs[0]!.scale;
    expect(tied).toBeGreaterThan(free + 0.005);
    expect(tied).toBeLessThan(1);
  });

  it("si el modelo ya acierta, no cambia nada", () => {
    const fit = fitParameters(observedWith(1));
    expect(fit.knobs[0]!.scale).toBeCloseTo(1, 3);
    expect(fit.before.meanAbsRelError).toBeLessThan(1e-9);
  });

  it("varios parámetros a la vez bajan el error", () => {
    const cases = observedWith(0.95).map((c) => ({ ...c, observedKwh: c.observedKwh + 0.3 }));
    const fit = fitParameters(cases, { knobs: ["drivetrainEfficiency", "baseAuxPowerKw"] });
    expect(fit.knobs.map((k) => k.knob)).toEqual(["drivetrainEfficiency", "baseAuxPowerKw"]);
    expect(fit.after.meanAbsRelError).toBeLessThan(fit.before.meanAbsRelError / 2);
  });

  it("sin viajes devuelve los valores actuales", () => {
    const fit = fitParameters([]);
    expect(fit.cases).toBe(0);
    expect(fit.knobs[0]!.scale).toBe(1);
  });
});

describe("calibrationCase", () => {
  const trip = { id: "t1", request: tripRequest, summary: tripSummary };

  it("usa la ruta del plan mostrado y la caída de SOC observada", () => {
    const out = calibrationCase(
      { ...trip, snapshot: minimalSnapshot() },
      {
        observedSoc: [
          { distanceKm: 10, socPercent: 76 },
          { distanceKm: 0, socPercent: 80 },
        ],
      },
    );
    expect("skip" in out).toBe(false);
    const c = out as CalibrationCase;
    expect(c.raw.id).toBe("route-0");
    // 4 puntos de 60 kWh, sin paradas.
    expect(c.observedKwh).toBeCloseTo(2.4, 9);
    expect(c.tripId).toBe("t1");
  });

  it("descarta viajes sin snapshot, con consumo manual o sin consumo", () => {
    const obs = {
      observedSoc: [
        { distanceKm: 0, socPercent: 80 },
        { distanceKm: 10, socPercent: 76 },
      ],
    };
    expect(calibrationCase(trip, obs)).toEqual({ skip: "sin snapshot" });
    const manual = {
      ...trip,
      snapshot: minimalSnapshot(),
      request: {
        ...tripRequest,
        vehicle: { ...tripRequest.vehicle, consumptionManual: true, consumptionKwhPer100km: 18 },
      },
    };
    expect(calibrationCase(manual, obs)).toEqual({ skip: "consumo manual" });
    const flat = {
      observedSoc: [
        { distanceKm: 0, socPercent: 80 },
        { distanceKm: 10, socPercent: 80 },
      ],
    };
    expect(calibrationCase({ ...trip, snapshot: minimalSnapshot() }, flat)).toEqual({
      skip: "consumo observado no positivo",
    });
  });
});
