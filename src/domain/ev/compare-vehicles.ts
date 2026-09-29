/**
 * Comparar vehículos en una ruta: el mismo snapshot (ruta, estaciones del
 * corredor, clima y desvíos) con otro vehículo. No consulta proveedores: es
 * el mismo recálculo que hace el navegador al cambiar condiciones.
 */
import type { Place, RoutePlan, TripConditions, Vehicle } from "../types";
import { computePlansFromSnapshot, type SnapshotInputs } from "./compute-plan";

export interface VehicleOnRoute {
  vehicle: Vehicle;
  /** El plan de ese vehículo en la ruta elegida; null si la ruta no está en el snapshot. */
  plan: RoutePlan | null;
}

/** El plan de `vehicle` en la ruta `routeId`, con las mismas condiciones del viaje. */
export function planOnRoute(
  snapshot: SnapshotInputs,
  places: { origin: Place; destination: Place },
  routeId: string,
  vehicle: Vehicle,
  conditions: TripConditions,
): RoutePlan | null {
  const route = snapshot.routes.find((r) => r.id === routeId);
  if (!route) return null;
  const verified = snapshot.verifiedRoutes?.[routeId];
  const one: SnapshotInputs = {
    ...snapshot,
    routes: [route],
    verifiedRoutes: verified ? { [routeId]: verified } : undefined,
  };
  return computePlansFromSnapshot(one, places, vehicle, conditions).plans[0] ?? null;
}

/** Primero los que llegan, del más rápido al más lento; después los que no llegan. */
export function rankVehiclesOnRoute(rows: VehicleOnRoute[]): VehicleOnRoute[] {
  const rank = (r: VehicleOnRoute) => (r.plan == null ? 2 : r.plan.feasible ? 0 : 1);
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) || (a.plan?.totalMinutes ?? Infinity) - (b.plan?.totalMinutes ?? Infinity),
  );
}
