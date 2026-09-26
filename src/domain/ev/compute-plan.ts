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
import type { EnergyEngine } from "./energy-v2";
import type { PlanningSnapshot } from "./contracts/snapshot";

export type { EnergyEngine };
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
  energyEngine: EnergyEngine = "legacy",
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
      energyEngine,
    }),
  );
}

export function computePlans(
  inputs: PlanInputs,
  vehicle: Vehicle,
  conditions: TripConditions,
  engine: PlannerEngine = "legacy",
  energyEngine: EnergyEngine = "legacy",
): ComputedPlans {
  const plans = rankPlans(
    buildPlans(inputs, vehicle, conditions, engine, energyEngine),
    conditions.planningMode,
  );
  return { plans, selectedId: plans[0]?.id ?? "" };
}

/**
 * Planes de un viaje guardado, sin consultar proveedores. Si el snapshot trae
 * la pasada 2 de alguna ruta (viaje compartido, D6), ese plan se arma sobre la
 * ruta real verificada y con las mismas estaciones, y conserva su verificación.
 */
export function computePlansFromSnapshot(
  snapshot: PlanningSnapshot,
  places: { origin: Place; destination: Place },
  vehicle: Vehicle,
  conditions: TripConditions,
): ComputedPlans {
  const inputs: PlanInputs = {
    routes: snapshot.routes,
    chargers: snapshot.chargers,
    weather: snapshot.weather,
    origin: places.origin,
    destination: places.destination,
  };
  const engine = snapshot.plannerEngine;
  const energy = snapshot.energyEngine ?? "legacy";
  const plans = buildPlans(inputs, vehicle, conditions, engine, energy).map((plan) => {
    const v = snapshot.verifiedRoutes?.[plan.id];
    if (!v) return plan;
    const ids = v.chargerIds ? new Set(v.chargerIds) : null;
    const verified = buildPlan({
      raw: v.route,
      vehicle,
      conditions,
      chargers: ids ? inputs.chargers.filter((c) => ids.has(c.id)) : inputs.chargers,
      weather: inputs.weather,
      origin: inputs.origin,
      destination: inputs.destination,
      engine,
      energyEngine: energy,
    });
    return { ...verified, verification: v.verification };
  });
  const ranked = rankPlans(plans, conditions.planningMode);
  return { plans: ranked, selectedId: ranked[0]?.id ?? "" };
}
