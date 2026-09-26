import type { ProviderRouteSet, RouteRequest } from "../ev/contracts/route";
import type { RoutingEngine } from "../types";

/**
 * Proveedor de rutas: trae las rutas crudas (plan §3.1). El muestreo lo hace el
 * dominio (engines/route) y la política de selección, la aplicación
 * (plan-trip/route-selection). Falla con `RoutingError`.
 */
export interface RoutingProvider {
  readonly id: string;
  /** Nombre para los mensajes al usuario ("Mapbox"). */
  readonly label: string;
  /** Con qué motor quedan rotuladas las rutas. */
  readonly engine: RoutingEngine;
  readonly capabilities: {
    alternatives: boolean;
    avoidTolls: boolean;
    avoidPoints: boolean;
    /** Clase vial por tramo (base de la jerarquía de vías). */
    roadClasses: boolean;
  };
  /** Aviso fijo al usar este proveedor (p. ej. OSRM sin token de Mapbox). */
  readonly notice?: string;
  calculateRoutes(request: RouteRequest): Promise<ProviderRouteSet>;
}
