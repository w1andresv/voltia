/**
 * Composición pura de la pasada 1 (plan §4.12): con los datos ya reunidos
 * (rutas con elevación, cargadores del corredor, clima), arma y ordena un plan
 * por ruta. La usan el servidor (EVRoutePlanningService) y el navegador
 * (lib/store.ts, al cambiar condiciones sin volver a pedir rutas), así los dos
 * calculan exactamente lo mismo.
 */
import { buildPlan, rankPlans } from "../planner";
import type {
  Charger,
  Place,
  RawRoute,
  RoutePlan,
  TripConditions,
  Vehicle,
  WeatherSnapshot,
} from "../types";

export type PlannerEngine = "legacy" | "v2";

/** Lo que el plan necesita del mundo exterior. Mismas entradas ⇒ mismo resultado. */
export interface PlanInputs {
  routes: RawRoute[];
  chargers: Charger[];
  weather: WeatherSnapshot | null;
  origin: Place;
  destination: Place;
}

export interface ComputedPlans {
  /** Ordenados según la estrategia; el primero es el recomendado. */
  plans: RoutePlan[];
  selectedId: string;
}

/** Un plan por ruta, sin ordenar. */
export function buildPlans(
  inputs: PlanInputs,
  vehicle: Vehicle,
  conditions: TripConditions,
  engine: PlannerEngine = "legacy",
): RoutePlan[] {
  return inputs.routes.map((raw) =>
    buildPlan({
      raw,
      vehicle,
      conditions,
      chargers: inputs.chargers,
      weather: inputs.weather,
      origin: inputs.origin,
      destination: inputs.destination,
      engine,
    }),
  );
}

export function computePlans(
  inputs: PlanInputs,
  vehicle: Vehicle,
  conditions: TripConditions,
  engine: PlannerEngine = "legacy",
): ComputedPlans {
  const plans = rankPlans(buildPlans(inputs, vehicle, conditions, engine), conditions.planningMode);
  return { plans, selectedId: plans[0]?.id ?? "" };
}
