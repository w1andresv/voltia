import type { LatLon, RawRoute, RoutingEngine } from "../types";

/** Rutas candidatas con la política actual (alternativas, sin peajes, atajos). */
export interface RoutingResult {
  routes: RawRoute[];
  engine: RoutingEngine;
  warnings: string[];
}

/**
 * Proveedor de rutas.
 *
 * Transitorio (F1, ADR-0005): devuelve rutas ya muestreadas (`RawRoute`), como
 * el código actual. En F2 pasa a devolver la respuesta cruda (`ProviderRoute`,
 * plan §3.1) y el muestreo se muda al dominio.
 */
export interface RoutingProvider {
  readonly id: string;
  routes(waypoints: LatLon[]): Promise<RoutingResult>;
}
