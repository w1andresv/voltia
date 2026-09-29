/**
 * Composición del motor de energía v2 (F5): malla → perfil de velocidad →
 * física por tramo → perfil por muestra. Los engines no se llaman entre sí;
 * los junta este módulo (y lo usa buildPlan con `energyEngine: "v2"`).
 */
import { hasManualConsumption } from "../energy";
import type { RawRoute, TripConditions, Vehicle, WeatherSnapshot } from "../types";
import type { SpeedProfile } from "./contracts/speed";
import { MODEL_PARAMETERS, type ModelParameters } from "./core/params";
import {
  calibrateToManual,
  energyProfileV2,
  localNetRateKwhPerKm,
  stopEnergyKwh,
  type EnergyProfileV2,
  type RegenModeParams,
} from "./engines/energy/physics";
import {
  estimatedParams,
  resolveVehicleEnergyParams,
  type VehicleEnergyParams,
} from "./engines/energy/vehicle-params";
import { buildSpeedProfile, speedMesh } from "./engines/speed/engine";

export type EnergyEngine = "legacy" | "v2";

export interface EnergyV2Result extends EnergyProfileV2 {
  speed: SpeedProfile;
  params: VehicleEnergyParams;
  regen: RegenModeParams;
  /** Parámetros del vehículo que salieron de valores por defecto (estimated). */
  assumptions: (keyof VehicleEnergyParams)[];
  /** Duración del perfil de velocidad frente a la del proveedor, % (especificación §5.3, punto 7). */
  durationDeviationPct: number;
}

export function energyProfileForRoute(
  raw: RawRoute,
  vehicle: Vehicle,
  conditions: TripConditions,
  weather: WeatherSnapshot | null,
  params: ModelParameters = MODEL_PARAMETERS,
): EnergyV2Result {
  const ctx = { vehicle, conditions, weather, originAltitudeM: raw.samples[0]?.elevM };
  const fixed =
    conditions.avgSpeedKmh != null && conditions.avgSpeedKmh > 0 ? conditions.avgSpeedKmh : null;
  let mesh = speedMesh(raw, params.speed.meshSpacingM, fixed);
  if (mesh.length === 2) {
    // Con solo origen y destino (ambos en 0 km/h) no hay tramo recorrible: se agrega el punto medio.
    const [a, b] = mesh as [(typeof mesh)[number], (typeof mesh)[number]];
    mesh = [
      a,
      { ...a, lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2, km: (a.km + b.km) / 2 },
      b,
    ];
  }
  const speed = buildSpeedProfile(mesh, conditions.drivingStyle, params.speed);
  let vp = resolveVehicleEnergyParams(vehicle, conditions, params);
  if (hasManualConsumption(vehicle)) {
    vp = calibrateToManual(
      vp,
      ctx,
      vehicle.consumptionKwhPer100km as number,
      params.energy.manualReferenceSpeedKmh,
    );
  }
  const regen =
    params.energy.regenModes.value[conditions.regenLevel] ?? params.energy.regenModes.value.medium;
  const profile = energyProfileV2(
    raw.samples,
    mesh,
    speed.points,
    vp,
    ctx,
    regen,
    raw.elevationProfile,
  );
  return {
    ...profile,
    speed,
    params: vp,
    regen,
    assumptions: estimatedParams(vp),
    durationDeviationPct:
      raw.driveMinutes > 0
        ? ((profile.durationMinutes - raw.driveMinutes) / raw.driveMinutes) * 100
        : 0,
  };
}

/**
 * Energía de un desvío a un cargador con el perfil v2 (especificación §5.8.1):
 * km de ida y vuelta × consumo neto local (±2 km alrededor del punto) más
 * detenerse y volver a arrancar a la velocidad de la ruta en ese punto.
 * Estimado: lo reemplaza la pasada 2 o la matriz de distancias.
 */
export function detourEnergyV2(
  result: EnergyV2Result,
  windowKm = 2,
): (detourKm: number, sIdx: number) => number {
  return (detourKm, sIdx) => {
    const s = result.samples[Math.max(0, Math.min(result.samples.length - 1, sIdx))];
    if (!s) return 0;
    const rate = localNetRateKwhPerKm(result.samples, s.km, windowKm);
    return Math.max(0, detourKm) * rate + stopEnergyKwh(result.params, result.regen, s.speedKmh);
  };
}
