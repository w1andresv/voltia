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
import { detoursForRoute, type MeasuredDetour } from "./contracts/detour";

export type { EnergyEngine };
export type PlannerEngine = "legacy" | "v2";

/** Lo que el plan necesita del mundo exterior. Mismas entradas ⇒ mismo resultado. */
export interface PlanInputs {
  routes: RawRoute[];
  chargers: Charger[];
  weather: WeatherSnapshot | null;
  origin: Place;
  destination: Place;
  /** Desvíos medidos por vía, por `ruta|estación` (F4); sin ellos, estimados. */
  detours?: Record<string, MeasuredDetour>;
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
      detours: detoursForRoute(inputs.detours, raw.id),
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

/** Lo que hace falta de un snapshot para recalcular sus planes (también el `geo` del navegador). */
export type SnapshotInputs = Pick<
  PlanningSnapshot,
  "routes" | "chargers" | "weather" | "detours" | "energyEngine" | "verifiedRoutes"
> & { plannerEngine?: PlannerEngine };

/**
 * Planes sin consultar proveedores: de un viaje guardado o del navegador al
 * cambiar condiciones. Si el snapshot trae la pasada 2 de alguna ruta, ese plan
 * se arma sobre la ruta real verificada, con las mismas estaciones, y conserva
 * su verificación. Si con las condiciones nuevas esas estaciones ya no alcanzan
 * pero el plan de la pasada 1 sí, se usa ese, sin verificación: la ruta
 * verificada era para otras paradas.
 */
export function computePlansFromSnapshot(
  snapshot: SnapshotInputs,
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
    detours: snapshot.detours,
  };
  const engine = snapshot.plannerEngine ?? "legacy";
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
    if (!verified.feasible && plan.feasible) return plan;
    return { ...verified, verification: v.verification };
  });
  const ranked = rankPlans(plans, conditions.planningMode);
  return { plans: ranked, selectedId: ranked[0]?.id ?? "" };
}
