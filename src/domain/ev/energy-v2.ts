/**
 * Composición del motor de energía v2 (F5): malla → perfil de velocidad →
 * física por tramo → perfil por muestra. Los engines no se llaman entre sí;
 * los junta este módulo (y lo usa buildPlan con `energyEngine: "v2"`).
 */
import { hasManualConsumption } from "../energy";
import type { RawRoute, TripConditions, Vehicle, WeatherSnapshot } from "../types";
import type { SpeedProfile } from "./contracts/speed";
import type { WeatherAlongRoute } from "./contracts/weather";
import { MODEL_PARAMETERS, type ModelParameters } from "./core/params";
import { wetRoadFor } from "./engines/energy/environment";
import { weatherAtKm } from "./engines/energy/weather-field";
import {
  calibrateToManual,
  energyProfileV2,
  localNetRateKwhPerKm,
  referenceCruisePowerKw,
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
  /** La vía se calculó mojada: por el pronóstico o porque el usuario la eligió (M2.2). Ausente si seca. */
  wetRoad?: "forecast" | "chosen";
  /** Casetas de peaje donde el perfil se detiene (M2.1). Ausente si la ruta no tiene. */
  tollStops?: number;
  /** Se usó el clima por tramo y hora (M3.1), con este número de puntos. Ausente: clima de un punto. */
  weatherAlongPoints?: number;
}

export function energyProfileForRoute(
  raw: RawRoute,
  vehicle: Vehicle,
  conditions: TripConditions,
  weather: WeatherSnapshot | null,
  params: ModelParameters = MODEL_PARAMETERS,
  /** Clima por hora en varios puntos de esta ruta (M3.1); sin él, `weather` para toda la ruta. */
  weatherAlong?: WeatherAlongRoute,
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
  const wetCfg = params.energy.wetRoad.value;
  // P_ref sale del vehículo ya ajustado al consumo manual, si lo hay: el factor es 1 en su crucero.
  const effCurve = params.energy.drivetrainEfficiencyCurve.value;
  const efficiency = effCurve.length
    ? {
        refPowerKw: referenceCruisePowerKw(vp, params.energy.manualReferenceSpeedKmh),
        points: effCurve,
      }
    : undefined;
  const alongPoints = weatherAlong?.points.length ?? 0;
  const tollStops = speed.points.filter((pt) => pt.limitingFactor === "toll").length;
  const profile = energyProfileV2(
    raw.samples,
    mesh,
    speed.points,
    vp,
    ctx,
    regen,
    raw.elevationProfile,
    {
      ...(tollStops ? { tollStopSeconds: params.speed.tollStopSeconds.value } : {}),
      ...(weatherAlong && alongPoints
        ? {
            weatherAt: (km: number, seconds: number) =>
              weatherAtKm(weatherAlong, km, seconds) ?? weather,
          }
        : {}),
      wetFor: (w: WeatherSnapshot | null) =>
        wetRoadFor(conditions, w?.precipitationMm, wetCfg),
      ...(efficiency ? { efficiency } : {}),
    },
  );
  return {
    ...profile,
    speed,
    params: vp,
    regen,
    ...(profile.wetKm > 0
      ? { wetRoad: conditions.roadSurface === "wet" ? ("chosen" as const) : ("forecast" as const) }
      : {}),
    ...(tollStops ? { tollStops } : {}),
    ...(alongPoints ? { weatherAlongPoints: alongPoints } : {}),
    assumptions: estimatedParams(vp),
    durationDeviationPct:
      raw.driveMinutes > 0
        ? ((profile.durationMinutes - raw.driveMinutes) / raw.driveMinutes) * 100
        : 0,
  };
}

/**
 * Perfiles de energía recientes por ruta (M1, ADR-0020). La energía depende de la ruta, el
 * vehículo, el clima y de las condiciones que cambian la física (pasajeros, equipaje,
 * velocidad fija, aire, temperatura, estilo, regeneración, superficie de la vía), no del SOC, del margen ni de
 * la estrategia: mover esos controles no debe repetir la física. La memoria cuelga de la
 * ruta, así que se libera con ella.
 */
const profileCache = new WeakMap<RawRoute, Map<string, EnergyV2Result>>();
const PROFILES_PER_ROUTE = 8;
const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

/** Un número por objeto (por identidad): la clave de la memoria no recorre datos grandes. */
function objectId(o: object): number {
  let id = objectIds.get(o);
  if (id == null) objectIds.set(o, (id = nextObjectId++));
  return id;
}
const paramsId = objectId;

/** Igual que `energyProfileForRoute`, con memoria. El resultado no se modifica: es de solo lectura. */
export function energyProfileForRouteCached(
  raw: RawRoute,
  vehicle: Vehicle,
  conditions: TripConditions,
  weather: WeatherSnapshot | null,
  params: ModelParameters = MODEL_PARAMETERS,
  weatherAlong?: WeatherAlongRoute,
): EnergyV2Result {
  const key = JSON.stringify([
    vehicle,
    conditions.passengers,
    conditions.luggageKg,
    conditions.avgSpeedKmh,
    conditions.ac,
    conditions.temperatureC,
    conditions.drivingStyle,
    conditions.regenLevel,
    conditions.roadSurface ?? "auto",
    weather,
    paramsId(params),
    weatherAlong ? objectId(weatherAlong) : 0,
  ]);
  let byKey = profileCache.get(raw);
  if (!byKey) profileCache.set(raw, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const value = energyProfileForRoute(raw, vehicle, conditions, weather, params, weatherAlong);
  if (byKey.size >= PROFILES_PER_ROUTE) byKey.delete(byKey.keys().next().value as string);
  byKey.set(key, value);
  return value;
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
