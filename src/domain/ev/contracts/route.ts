import type { LatLon } from "../../types";

/**
 * Ruta tal como la entrega el proveedor, sin muestreo ni modelo (plan §3.1).
 * La forma sigue la de Directions (Mapbox) / OSRM, con unidades en el nombre.
 */
export interface ProviderRoute {
  /** "mapbox" | "osrm" | … */
  provider: string;
  profile: string;
  /** Geometría completa, sin reducir. */
  geometry: LatLon[];
  distanceM: number;
  durationS: number;
  legs: ProviderLeg[];
}

export interface ProviderLeg {
  /** Vías principales del tramo ("Ruta 45A, Ruta 66"). */
  summary?: string;
  distanceM?: number;
  /** Metros y segundos entre cada par de puntos consecutivos de la geometría. */
  annotation?: { distanceM?: number[]; durationS?: number[] };
  steps?: ProviderStep[];
}

export interface ProviderStep {
  distanceM: number;
  durationS: number;
  geometry?: LatLon[];
  /** Intersecciones con la clase vial del proveedor (base de la jerarquía de vías). */
  intersections?: { location: LatLon; roadClass?: string }[];
}

export interface RouteRequest {
  /** Origen, puntos intermedios y destino. */
  waypoints: LatLon[];
  alternatives: boolean;
  avoid?: { tolls?: boolean; points?: LatLon[] };
}

export interface ProviderRouteSet {
  routes: ProviderRoute[];
  /** Km entre cada punto pedido y la vía donde el proveedor lo ubicó. */
  waypointSnapKm: number[];
}

/** Fallo del proveedor de rutas. `noRoute`: no existe camino (no es un error técnico). */
export class RoutingError extends Error {
  constructor(
    message: string,
    readonly noRoute = false,
  ) {
    super(message);
    this.name = "RoutingError";
  }
}
