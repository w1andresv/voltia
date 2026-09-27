import type { ConsolidatedStation } from "../stations/model";

/**
 * Detalle de una estación (ADR-0008, D9): lo que el listado no trae, como el
 * estado de cada cargador. Se pide solo para las estaciones que usa la ruta o
 * que el usuario abre, porque cuesta una consulta por estación.
 */
export interface StationDetails {
  /** null si la fuente no conoce la estación o el id no es suyo. */
  get(id: string): Promise<ConsolidatedStation | null>;
}
