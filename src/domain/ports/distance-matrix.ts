import type { LatLon } from "../types";

/**
 * Matriz de distancias por vía (F4, guía §5.2). `distanceM[i][j]` y
 * `durationS[i][j]` van de `sources[i]` a `destinations[j]`; null si no hay
 * camino. Si el proveedor no responde, lanza.
 */
export interface DistanceMatrixProvider {
  readonly id: string;
  /** Coordenadas máximas (orígenes + destinos) por consulta. */
  readonly maxCoordinates: number;
  matrix(
    sources: LatLon[],
    destinations: LatLon[],
  ): Promise<{ distanceM: (number | null)[][]; durationS: (number | null)[][] }>;
}
