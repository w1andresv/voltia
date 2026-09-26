import type { LatLon } from "../types";

/**
 * Proveedor de elevación: alturas crudas (m) para los puntos pedidos, en el
 * mismo orden (plan §3.1). Qué puntos pedir y cómo aplicarlas es del dominio
 * (engines/elevation). Si no puede responder, lanza.
 */
export interface ElevationProvider {
  readonly id: string;
  getElevations(points: LatLon[]): Promise<number[]>;
}
