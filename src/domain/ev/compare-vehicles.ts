/**
 * Comparar vehículos en una ruta: el mismo snapshot (ruta, estaciones del
 * corredor, clima y desvíos) con otro vehículo. No consulta proveedores: es
 * el mismo recálculo que hace el navegador al cambiar condiciones.
 */
import type { Place, RoutePlan, TripConditions, Vehicle } from "../types";
import { computePlansFromSnapshot, type SnapshotInputs } from "./compute-plan";

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
