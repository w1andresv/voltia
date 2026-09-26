import type { RawRoute } from "../types";

/**
 * Proveedor de elevación.
 *
 * Transitorio (F1, ADR-0005): aplica la elevación a las rutas (interpolación,
 * suavizado y pendientes, como hoy). En F2 pasa a `getElevations(points)` con
 * datos crudos y la limpieza se muda al ElevationEngine.
 */
export interface ElevationProvider {
  readonly id: string;
  applyTo(routes: RawRoute[]): Promise<RawRoute[]>;
}
