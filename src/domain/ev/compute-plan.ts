/**
 * Composición pura de la pasada 1 (plan §4.12): con los datos ya reunidos
 * (rutas con elevación, cargadores del corredor, clima), arma y ordena un plan
 * por ruta. La usan el servidor (EVRoutePlanningService) y el navegador
 * (lib/store.ts, al cambiar condiciones sin volver a pedir rutas), así los dos
 * calculan exactamente lo mismo. `PlanInputs.params` (opcional) reemplaza los
 * parámetros del modelo; sin él, los calibrados.
 */
import { buildPlan, rankPlans } from "../planner";
import type {
  Charger,
  GeoBundle,
  Place,
  RawRoute,
  RoutePlan,
  TripConditions,
  Vehicle,
  WeatherSnapshot,
} from "../types";
import type { EnergyEngine } from "./energy-v2";
import type { ModelParameters } from "./core/params";
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
  /** Calidad de los datos reunidos (va a `RoutePlan.dataQuality`). */
  dataQuality?: GeoBundle["dataQuality"];
  /** Huella del snapshot de estos datos (va a `RoutePlan.snapshotId`). */
  snapshotId?: string;
  /** Parámetros del modelo; sin ellos, los calibrados (`MODEL_PARAMETERS`). */
  params?: ModelParameters;
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
  return inputs.routes.map((raw) => ({
    ...buildPlan({
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
      params: inputs.params,
      elevationUnavailable: inputs.dataQuality?.elevation === "unavailable",
    }),
    ...(inputs.snapshotId ? { snapshotId: inputs.snapshotId } : {}),
  }));
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
 * Orden final cuando hay pasada 2: un plan verificado (sobre la ruta real) y
 * viable va primero; las alternativas solo tienen la pasada 1, con desvíos
 * estimados, y no deben recomendarse por encima de él. El resto, por estrategia.
 */
export function rankVerifiedFirst(
  plans: RoutePlan[],
  mode: TripConditions["planningMode"],
): RoutePlan[] {
  const verified = (p: RoutePlan) =>
    p.feasible && p.verification != null && p.verification.status !== "failed";
  return [
    ...rankPlans(plans.filter(verified), mode),
    ...rankPlans(
      plans.filter((p) => !verified(p)),
      mode,
    ),
  ];
}

/** Lo que hace falta de un snapshot para recalcular sus planes (también el `geo` del navegador). */
export type SnapshotInputs = Pick<
  PlanningSnapshot,
  "routes" | "chargers" | "weather" | "detours" | "energyEngine" | "verifiedRoutes" | "dataQuality"
> & { plannerEngine?: PlannerEngine; snapshotId?: string };

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
  params?: ModelParameters,
): ComputedPlans {
  const inputs: PlanInputs = {
    ...(snapshot.dataQuality ? { dataQuality: snapshot.dataQuality } : {}),
    ...(snapshot.snapshotId ? { snapshotId: snapshot.snapshotId } : {}),
    ...(params ? { params } : {}),
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
      params,
      elevationUnavailable: inputs.dataQuality?.elevation === "unavailable",
    });
    if (!verified.feasible && plan.feasible) return plan;
    return {
      ...verified,
      verification: v.verification,
      ...(inputs.snapshotId ? { snapshotId: inputs.snapshotId } : {}),
    };
  });
  const ranked = rankVerifiedFirst(plans, conditions.planningMode);
  return { plans: ranked, selectedId: ranked[0]?.id ?? "" };
}
