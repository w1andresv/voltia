import { annotateEnergy, energyMode, STYLE_SPEED_FACTOR } from "./energy";
import { MODEL_PARAMETERS, type ModelParameters } from "./ev/core/params";
import { socFloors } from "./ev/core/trip-config";
import type { MeasuredDetour } from "./ev/contracts/detour";
import { detourEnergyV2, energyProfileForRoute, type EnergyEngine } from "./ev/energy-v2";
import { batteryDepletion } from "./ev/engines/soc/depletion";
import { simulateSoc } from "./ev/engines/soc/simulate";
import { adapterSummary } from "./plan/presentation";
import { planAssumptions, planDataQuality } from "./plan/quality";
import { placeChargers, stopEvents } from "./plan/shared";
import { planStopsLegacy } from "./plan/stops-v1";
import { planStopsV2 } from "./plan/stops-v2";
import type {
  Charger,
  ItineraryNode,
  Place,
  RawRoute,
  RoutePlan,
  TripConditions,
  Vehicle,
  WeatherSnapshot,
} from "./types";

/**
 * Plan de una ruta: energía, paradas (planificador v1 o v2), curva de batería e
 * itinerario. Las piezas viven en `./plan/`: `shared` (común), `stops-v1`
 * (puntaje), `stops-v2` (programación dinámica) y `presentation` (adaptadores,
 * orden de rutas y textos). Los umbrales llegan por `params`.
 */
export { effectiveMinutes, extraMassLabel, rankPlans } from "./plan/presentation";
export type { DetourEnergy } from "./plan/shared";
export { classifyFirstChargerCharge } from "./plan/stops-v1";

/** Distancia máxima de una estación a la vía para tenerla en cuenta, km. */
export const MAX_FROM_ROUTE_KM = MODEL_PARAMETERS.corridor.maxFromRouteKm;

function hasFixedSpeed(conditions: TripConditions): boolean {
  return Boolean(conditions.avgSpeedKmh && conditions.avgSpeedKmh > 10);
}

/**
 * Tiempo de manejo: con velocidad media fijada por el usuario, esa manda (el
 * estilo ya no la cambia); si no, el de la ruta ajustado por el estilo.
 */
function driveMinutesFor(raw: RawRoute, conditions: TripConditions): number {
  if (hasFixedSpeed(conditions)) {
    return (raw.distanceKm / (conditions.avgSpeedKmh as number)) * 60;
  }
  return raw.driveMinutes / STYLE_SPEED_FACTOR[conditions.drivingStyle];
}

export function buildPlan(args: {
  raw: RawRoute;
  vehicle: Vehicle;
  conditions: TripConditions;
  chargers: Charger[];
  weather: WeatherSnapshot | null;
  origin: Place;
  destination: Place;
  /** Planificador de paradas: el actual (por defecto) o el v2 por programación dinámica (F7). */
  engine?: "legacy" | "v2";
  /** Modelo de energía: el actual (por defecto) o el v2, física sin multiplicadores y perfil de velocidad (F5). */
  energyEngine?: EnergyEngine;
  /** Desvíos medidos por vía para esta ruta, por id de estación (F4). */
  detours?: Record<string, MeasuredDetour>;
  /** Parámetros del modelo; por defecto, los calibrados (`MODEL_PARAMETERS`). */
  params?: ModelParameters;
  /** Ninguna fuente de elevación respondió (va a `dataQuality`). */
  elevationUnavailable?: boolean;
}): RoutePlan {
  const { raw, vehicle, conditions, weather, origin, destination } = args;
  const params = args.params ?? MODEL_PARAMETERS;
  const tolerance = params.planner.socTolerancePct;
  const { reservePct: safety, arrivalTargetPct } = socFloors(conditions);
  const ctx = { vehicle, conditions, weather, originAltitudeM: raw.samples[0]?.elevM };

  const styleSpeed = STYLE_SPEED_FACTOR[conditions.drivingStyle];
  const samplesPre = raw.samples.map((s) => ({
    ...s,
    speedKmh: hasFixedSpeed(conditions)
      ? (conditions.avgSpeedKmh as number)
      : s.speedKmh * styleSpeed,
  }));

  const attached = placeChargers(args.chargers, samplesPre, args.detours, params);
  // Perfil de energía una sola vez, sin SOC (F3): sirve para cualquier SOC de salida.
  const energyV2 =
    args.energyEngine === "v2"
      ? energyProfileForRoute(raw, vehicle, conditions, weather, params)
      : null;
  const energySamples = energyV2 ? energyV2.samples : annotateEnergy(samplesPre, ctx);
  // Con la energía v2, el desvío usa el consumo local del perfil y el costo de parar (§5.8.1).
  const detourEnergy = energyV2 ? detourEnergyV2(energyV2) : undefined;
  const cap = Math.max(vehicle.batteryKwh, 1);
  const chosen =
    args.engine === "v2"
      ? planStopsV2({
          samples: energySamples,
          chargers: attached,
          vehicle,
          conditions,
          weather,
          detourKwh: detourEnergy,
          params,
        })
      : planStopsLegacy({
          samples: energySamples,
          chargers: attached,
          vehicle,
          conditions,
          weather,
          detourKwh: detourEnergy,
          params,
        });
  const { planningSoc, departureCharge, feasible, reason } = chosen;
  const stops = chosen.stops.map((st) => ({
    ...st,
    nextLabel: st.nextLabel || destination.label,
    adapterNeeded: adapterSummary(st, vehicle, cap),
  }));

  // La curva de batería sale del SOCEngine: regeneración recortada según el SOC
  // real, y desvíos y cargas como eventos (C2, C6).
  const sim = simulateSoc(energySamples, {
    initialSocPct: planningSoc,
    capacityKwh: cap,
    events: stopEvents(energySamples, stops),
    regen: params.soc.regenAcceptance,
  });
  const samples = sim.samples;
  const last = samples[samples.length - 1]!;
  const detourKwh = stops.reduce((a, s) => a + (s.detourEnergyKwh ?? 0), 0);
  const energyKwh = last.cumulativeKwh + detourKwh;
  const energyGrossKwh = samples.reduce((a, s) => a + s.energyGrossKwh, 0) + detourKwh;
  const energyRegenKwh = samples.reduce((a, s) => a + s.energyRegenKwh, 0);
  // Con el v2 el tiempo de manejo sale del perfil de velocidad (no se reescala al del proveedor).
  const driveMin = energyV2 ? energyV2.durationMinutes : driveMinutesFor(raw, conditions);
  const chargeMin = stops.reduce((a, s) => a + s.chargeMinutes, 0);
  const detourKm = stops.reduce((a, s) => a + (s.detourKm ?? 0), 0);
  const detourMin = stops.reduce((a, s) => a + (s.detourMinutes ?? 0), 0);
  const arrivalSoc = last.soc;
  // El punto más bajo puede ser la llegada a un cargador (la curva muestra la salida).
  const minSoc = sim.minSoc;
  const depletion = batteryDepletion(samples);
  const remainingKwh = Math.max(0, (arrivalSoc / 100) * vehicle.batteryKwh);
  const canArriveWithoutCharge =
    stops.length === 0 &&
    arrivalSoc >= arrivalTargetPct - tolerance &&
    minSoc >= safety - tolerance;

  const itinerary: ItineraryNode[] = [
    {
      kind: "origin",
      label: origin.label,
      km: 0,
      soc: planningSoc,
      durationFromStartMin: 0,
      place: origin,
    },
  ];

  let accDrive = 0;
  let prevKm = 0;
  for (const stop of stops) {
    const dKm = stop.kmAlongRoute - prevKm;
    accDrive += (dKm / raw.distanceKm) * driveMin;
    itinerary.push({
      kind: "charger",
      label: stop.charger.name,
      km: stop.kmAlongRoute,
      soc: stop.arriveSoc,
      durationFromStartMin: accDrive,
      charge: stop,
    });
    accDrive += stop.chargeMinutes + stop.detourMinutes;
    prevKm = stop.kmAlongRoute;
  }
  itinerary.push({
    kind: "destination",
    label: destination.label,
    km: raw.distanceKm,
    soc: arrivalSoc,
    durationFromStartMin: driveMin + chargeMin + detourMin,
    place: destination,
  });

  return {
    id: raw.id,
    label: raw.label,
    via: raw.via,
    noTolls: raw.noTolls,
    roadMix: raw.roadMix,
    hierarchyFactor: raw.hierarchyFactor,
    withinTolerance: raw.withinTolerance,
    minorRoadScore: raw.minorRoadScore,
    engine: raw.engine,
    geometry: raw.geometry,
    samples,
    // Distancia de la ruta (comparable con Google Maps); el desvío hasta los
    // cargadores va aparte, y sí cuenta en tiempo y energía.
    distanceKm: raw.distanceKm,
    detourKm,
    driveMinutes: driveMin + detourMin,
    chargeMinutes: chargeMin,
    totalMinutes: driveMin + chargeMin + detourMin,
    energyKwh,
    energyGrossKwh,
    energyRegenKwh,
    regenCurtailedKwh: sim.curtailedRegenKwh,
    avgKwhPer100km:
      raw.distanceKm + detourKm > 0 ? (energyKwh / (raw.distanceKm + detourKm)) * 100 : 0,
    energyMode: energyMode(vehicle),
    arrivalSoc,
    initialSoc: planningSoc,
    remainingKwh,
    minSoc,
    safetyPct: safety,
    safetyMarginPct: arrivalSoc - safety,
    canArriveWithoutCharge,
    feasible,
    infeasibleReason: reason,
    departureCharge,
    firstChargerUnreachable: chosen.firstChargerUnreachable,
    ...(depletion ? { depletion } : {}),
    planner: args.engine === "v2" ? "v2" : "legacy",
    energyEngine: energyV2 ? "v2" : "legacy",
    ...(energyV2
      ? {
          energyAssumptions: energyV2.assumptions,
          providerDriveMinutes: raw.driveMinutes,
        }
      : {}),
    feasibilityStatus: chosen.feasibilityStatus,
    infeasibilityCode: chosen.infeasibilityCode,
    stops,
    itinerary,
    elevation: raw.elevation,
    weather,
    modelVersion: params.modelVersion,
    assumptions: planAssumptions({ energyV2, stops, params }),
    dataQuality: planDataQuality({
      energyV2,
      stops,
      elevationUnavailable: args.elevationUnavailable,
    }),
  };
}
