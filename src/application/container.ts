/**
 * Composición: el único lugar de la capa de aplicación que conoce los
 * proveedores concretos (Mapbox, OSRM, Open-Meteo, Photon, Postgres).
 */
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import type { GeocodingProvider } from "@/domain/ports/geocoding";
import { getEnv } from "@/infrastructure/config/env";
import {
  MapboxRoutingProvider,
  OpenMeteoElevationProvider,
  OpenMeteoWeatherProvider,
  OsrmRoutingProvider,
  PhotonGeocodingProvider,
} from "@/infrastructure/providers/adapters";
import { mapboxServerToken } from "@/infrastructure/providers/routing.mapbox";
import { DatasetStationCatalog } from "@/infrastructure/stations/catalog.adapter";
import { EVRoutePlanningService, type PlannerEngineMode, type PlanningDeps } from "./plan-trip/service";

/** Servicio de planificación con los proveedores de producción. `overrides` reemplaza piezas (tests, grabación). */
export function createPlanningService(overrides: Partial<PlanningDeps> = {}): EVRoutePlanningService {
  const token = mapboxServerToken();
  return new EVRoutePlanningService({
    routing: token ? new MapboxRoutingProvider(token) : new OsrmRoutingProvider(),
    elevation: new OpenMeteoElevationProvider(),
    weather: new OpenMeteoWeatherProvider(),
    stations: new DatasetStationCatalog(),
    params: MODEL_PARAMETERS,
    engineMode: getEnv().PLANNER_ENGINE as PlannerEngineMode,
    ...overrides,
  });
}

export function createGeocoder(): GeocodingProvider {
  return new PhotonGeocodingProvider();
}
