import type {
  ClimateControl,
  DrivingStyle,
  PlanningMode,
  RegenLevel,
  TripConditions,
  Vehicle,
  WeatherSnapshot,
} from "../../types";
import { DRIVER_KG, PERSON_KG, safetyPct } from "../../types";
import { MODEL_PARAMETERS, type ModelParameters } from "./params";

/**
 * Configuración explícita del viaje (plan §3.4): traduce las condiciones de la
 * UI y el vehículo a los valores que usan los engines. Es la única fuente de
 * los pisos de batería.
 */
export interface TripConfiguration {
  initialSocPercent: number;
  /** Conductor (siempre) más pasajeros. */
  occupantsMassKg: number;
  luggageMassKg: number;
  drivingMode: DrivingStyle;
  regenerationMode: RegenLevel;
  hvacMode: ClimateControl;
  ambient: {
    temperatureC: number | null;
    temperatureSource: "user" | "weather" | "none";
    windKmh: number | null;
    windDirDeg: number | null;
  };
  /** Velocidad fijada por el usuario, si la hay. */
  cruiseSpeedKmh: number | null;
  /** Reserva: el margen de seguridad del viaje (ADR-0016). */
  reserveSocPercent: number;
  /** Piso en todo punto de la ruta: la reserva, o `belowSafetyFloorPct` (5 %) con "permitir bajar del margen". */
  minimumSocPercent: number;
  /** SOC mínimo al destino: la reserva, también con "permitir bajar del margen" (ADR-0017). */
  destinationReserveSocPercent: number;
  maxChargeTargetSocPercent: number;
  planningEnergyMarginPercent: number;
  objective: PlanningMode;
  /** Adaptadores que el usuario lleva (se usan desde F4). */
  adapters: NonNullable<Vehicle["adapters"]>;
}

export function toTripConfiguration(
  vehicle: Vehicle,
  conditions: TripConditions,
  weather: WeatherSnapshot | null = null,
  params: ModelParameters = MODEL_PARAMETERS,
): TripConfiguration {
  const reserve = reserveSocPct(conditions);
  const userTemp = conditions.temperatureC;
  const weatherTemp = weather?.temperatureC ?? null;
  return {
    initialSocPercent: conditions.initialSoc,
    occupantsMassKg: DRIVER_KG + Math.max(0, conditions.passengers) * PERSON_KG,
    luggageMassKg: Math.max(0, conditions.luggageKg),
    drivingMode: conditions.drivingStyle,
    regenerationMode: conditions.regenLevel,
    hvacMode: conditions.ac,
    ambient: {
      temperatureC: userTemp ?? weatherTemp,
      temperatureSource: userTemp != null ? "user" : weatherTemp != null ? "weather" : "none",
      windKmh: weather?.windKmh ?? null,
      windDirDeg: weather?.windDirDeg ?? null,
    },
    cruiseSpeedKmh: conditions.avgSpeedKmh,
    reserveSocPercent: reserve,
    minimumSocPercent: conditions.allowBelowSafety ? params.planner.belowSafetyFloorPct : reserve,
    destinationReserveSocPercent: reserve,
    maxChargeTargetSocPercent: routeChargeCapPct(params),
    planningEnergyMarginPercent: params.planning.energyMarginPercent,
    objective: conditions.planningMode,
    adapters: vehicle.adapters ?? [],
  };
}

/** Tope de carga en ruta (ADR-0016): uno solo para todos los vehículos. */
export function routeChargeCapPct(params: ModelParameters = MODEL_PARAMETERS): number {
  return Math.min(100, params.planner.maxChargeTargetSocPct.value);
}

/**
 * Reserva de batería del viaje: el margen de seguridad, única fuente de verdad
 * (ADR-0016, ADR-0017). El SOC no baja de aquí en ningún punto de la ruta ni al
 * llegar al destino: no hay una "llegada mínima" aparte ni un mínimo del
 * vehículo. La usan los planificadores, el panel de batería y la barra del vehículo.
 */
export function reserveSocPct(c: TripConditions): number {
  return safetyPct(c);
}
