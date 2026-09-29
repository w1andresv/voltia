import { segmentEnergyKwh } from "../energy";
import type { ModelParameters } from "../ev/core/params";
import type { MeasuredDetour } from "../ev/contracts/detour";
import type { EnergySample } from "../ev/contracts/energy";
import type { SocEvent } from "../ev/contracts/soc";
import { placeOnRoute } from "../ev/engines/corridor/engine";
import type { FeasibilityStatus, InfeasibilityReason } from "../ev/engines/feasibility/engine";
import {
  isVerifiedForPlanning,
  type ChargeStop,
  type Charger,
  type RoutePlan,
  type TripConditions,
  type Vehicle,
  type WeatherSnapshot,
} from "../types";

/**
 * Piezas comunes a los dos planificadores de paradas (v1 por puntaje, v2 por
 * programación dinámica) y a `buildPlan`. Los umbrales llegan en `params`.
 */

/** Autonomía que da `kwh` con el consumo nominal del vehículo. */
export function rangeFromEnergy(vehicle: Vehicle, kwh: number): number {
  if (!(vehicle.batteryKwh > 0)) return 0;
  return (kwh / vehicle.batteryKwh) * vehicle.rangeKm;
}

export type EnergyCtx = {
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
  originAltitudeM?: number;
  /** Energía del desvío hasta un cargador y de parar en él (energía v2); sin ella, el cálculo anterior. */
  detourKwh?: DetourEnergy;
};

/** kWh de ir y volver `detourKm` desde la muestra `sIdx`, incluida la parada. */
export type DetourEnergy = (detourKm: number, sIdx: number) => number;

export function detourEnergyKwh(
  ctx: EnergyCtx,
  detourKm: number,
  sIdx: number,
  samples: EnergySample[],
  params: ModelParameters,
): number {
  if (ctx.detourKwh) return ctx.detourKwh(detourKm, sIdx);
  return segmentEnergyKwh(detourKm, 0, params.planner.detourSpeedKmh, ctx, {
    altitudeM: samples[sIdx]?.elevM,
  });
}

/** Estaciones verificadas ubicadas sobre la ruta por el corredor (D7). */
export function placeChargers(
  chargers: Charger[],
  samples: { lat: number; lon: number; km: number }[],
  measured: Record<string, MeasuredDetour> | undefined,
  params: ModelParameters,
): Charger[] {
  return placeOnRoute(
    chargers.filter((c) => isVerifiedForPlanning(c)),
    samples,
    {
      maxKm: params.corridor.maxFromRouteKm,
      detourRoadFactor: params.corridor.detourRoadFactor.value,
      measured,
    },
  );
}

export function socAfter(soc: number, energyKwh: number, capacity: number): number {
  return soc - (energyKwh / capacity) * 100;
}

export function fromRouteKmOf(c: Charger): number {
  if (Number.isFinite(c.fromRouteKm)) return c.fromRouteKm as number;
  if (Number.isFinite(c.detourKm)) return (c.detourKm as number) / 2;
  return 99;
}

export function isOffline(c: Charger): boolean {
  return c.availability === "offline" || c.available === false;
}

export function detourMinutesOf(km: number, params: ModelParameters): number {
  if (km <= 0.05) return 0;
  return (km / params.planner.detourSpeedKmh) * 60;
}

/**
 * Cargas y desvíos como eventos del SOCEngine (C2): el desvío resta al llegar al
 * cargador y la carga suma después. La muestra de la parada es la primera en su km.
 */
export function stopEvents(samples: EnergySample[], stops: ChargeStop[]): SocEvent[] {
  const events: SocEvent[] = [];
  for (const st of stops) {
    const atIndex = samples.findIndex((s) => s.km + 0.05 >= st.kmAlongRoute);
    if (atIndex < 0) continue;
    if (st.detourEnergyKwh) events.push({ atIndex, energyKwh: -st.detourEnergyKwh });
    events.push({ atIndex, energyKwh: st.energyAddedKwh });
  }
  return events;
}

/** Lo que devuelve cada planificador de paradas (v1 o v2). */
export interface StopsChoice {
  stops: ChargeStop[];
  feasible: boolean;
  reason?: string;
  planningSoc: number;
  departureCharge?: RoutePlan["departureCharge"];
  firstChargerUnreachable?: boolean;
  feasibilityStatus?: FeasibilityStatus;
  infeasibilityCode?: InfeasibilityReason;
}

export type StopsArgs = {
  samples: EnergySample[];
  chargers: Charger[];
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
  detourKwh?: DetourEnergy;
  params: ModelParameters;
};
