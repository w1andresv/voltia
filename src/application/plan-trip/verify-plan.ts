/**
 * Pasada 2 (especificación §4, plan §4.12): agregar paradas cambia la ruta.
 * Se pide la ruta real que pasa por las estaciones elegidas y se recalcula el
 * plan sobre ella, con la energía y los desvíos reales.
 *
 * En cada iteración:
 *  1. ruta por origen → puntos del usuario y paradas (en orden de km) → destino;
 *  2. plan sobre esa ruta solo con las estaciones elegidas: si alcanza, queda
 *     verificado (puede usar menos paradas, nunca otras);
 *  3. si no alcanza, plan con todas las estaciones del corredor sobre la ruta
 *     real; si ni así es viable, ese es el resultado (verificado como no viable);
 *     si cambió las paradas, se repite con las nuevas.
 * Sin convergencia en `maxIterations`, o si el proveedor falla, queda el plan
 * de la pasada 1 marcado `failed` (sus desvíos son estimados).
 */
import { buildPlan } from "@/domain/planner";
import type { PlanInputs, PlannerEngine } from "@/domain/ev/compute-plan";
import { projectOnRoute } from "@/domain/ev/engines/corridor/engine";
import { toRawRoute } from "@/domain/ev/engines/route/normalize";
import type { RoutingProvider } from "@/domain/ports/routing";
import type {
  Charger,
  LatLon,
  Place,
  RawRoute,
  RoutePlan,
  TripConditions,
  Vehicle,
} from "@/domain/types";

export interface VerifyDeps {
  routing: RoutingProvider;
  /** Agrega la elevación a una ruta (la del servicio: sin elevación, la ruta sigue plana). */
  withElevation: (route: RawRoute) => Promise<RawRoute>;
  maxIterations: number;
}

export interface VerifyArgs {
  plan: RoutePlan;
  inputs: PlanInputs;
  /** Puntos intermedios que pidió el usuario, en su orden. */
  userWaypoints: Place[];
  vehicle: Vehicle;
  conditions: TripConditions;
  engine: PlannerEngine;
}

/** Puntos intermedios del usuario y paradas, ordenados por su km sobre la ruta. */
export function orderedWaypoints(
  plan: Pick<RoutePlan, "samples" | "stops">,
  userWaypoints: LatLon[],
  stops: Charger[],
): LatLon[] {
  const kmOf = (p: LatLon) => projectOnRoute(p, plan.samples)?.alongKm ?? 0;
  const user = userWaypoints.map((p, i) => ({ p, km: kmOf(p), order: i }));
  const charging = stops.map((c, i) => ({
    p: { lat: c.lat, lon: c.lon },
    km: plan.stops.find((s) => s.charger.id === c.id)?.kmAlongRoute ?? kmOf(c),
    order: user.length + i,
  }));
  return [...user, ...charging].sort((a, b) => a.km - b.km || a.order - b.order).map((x) => x.p);
}

const stopIds = (plan: RoutePlan) => plan.stops.map((s) => s.charger.id);

export async function verifyPlan(deps: VerifyDeps, args: VerifyArgs): Promise<RoutePlan> {
  const { plan, inputs, vehicle, conditions, engine } = args;
  const failed = (iterations: number): RoutePlan => ({
    ...plan,
    verification: { status: "failed", iterations, baseDistanceKm: plan.distanceKm },
  });
  if (!plan.stops.length) return plan;

  const base = inputs.routes.find((r) => r.id === plan.id);
  let current = plan;
  let tried = new Set<string>();
  for (let it = 1; it <= deps.maxIterations; it++) {
    const chosen = current.stops.map((s) => s.charger);
    const key = stopIds(current).join("|");
    if (tried.has(key)) return failed(it - 1); // ciclo: las mismas paradas otra vez
    tried = new Set([...tried, key]);

    let raw: RawRoute;
    try {
      const set = await deps.routing.calculateRoutes({
        waypoints: [
          inputs.origin,
          ...orderedWaypoints(current, args.userWaypoints, chosen),
          inputs.destination,
        ],
        alternatives: false,
        avoid: plan.noTolls ? { tolls: true } : undefined,
      });
      const route = set.routes[0];
      if (!route) return failed(it);
      raw = await deps.withElevation({
        ...toRawRoute(route, { id: plan.id, label: plan.label, noTolls: plan.noTolls }),
        roadMix: base?.roadMix,
        hierarchyFactor: base?.hierarchyFactor,
        withinTolerance: base?.withinTolerance,
        minorRoadScore: base?.minorRoadScore,
        engine: deps.routing.engine,
      });
    } catch {
      return failed(it);
    }

    const on = (chargers: Charger[]) =>
      buildPlan({
        raw,
        vehicle,
        conditions,
        chargers,
        weather: inputs.weather,
        origin: inputs.origin,
        destination: inputs.destination,
        engine,
      });
    const verification = (status: "verified" | "changed") => ({
      status,
      iterations: it,
      baseDistanceKm: plan.distanceKm,
    });

    const restricted = on(chosen);
    if (restricted.feasible) {
      return { ...restricted, verification: verification(it === 1 ? "verified" : "changed") };
    }
    const full = on(inputs.chargers);
    if (!full.feasible)
      return { ...full, verification: verification(it === 1 ? "verified" : "changed") };
    current = full;
  }
  return failed(deps.maxIterations);
}
