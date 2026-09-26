/**
 * Composición: el único lugar de la capa de aplicación que conoce los
 * proveedores concretos (Mapbox, OSRM, Open-Meteo, Photon, Postgres).
 */
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import type { GeocodingProvider } from "@/domain/ports/geocoding";
import { getEnv } from "@/infrastructure/config/env";
import {
  MapboxMatrixProvider,
  MapboxRoutingProvider,
  MapboxTerrainElevationProvider,
  OpenMeteoElevationProvider,
  OpenMeteoWeatherProvider,
  OsrmRoutingProvider,
  PhotonGeocodingProvider,
} from "@/infrastructure/providers/adapters";
import { mapboxServerToken } from "@/infrastructure/providers/routing.mapbox";
import { DatasetStationCatalog } from "@/infrastructure/stations/catalog.adapter";
import type { ElevationSampling } from "./plan-trip/elevation-profile";
import {
  EVRoutePlanningService,
  type EnergyEngineMode,
  type PlannerEngineMode,
  type PlanningDeps,
} from "./plan-trip/service";

type ElevationDeps = Pick<PlanningDeps, "elevation" | "elevationSampling" | "elevationFallback">;

/**
 * Fuente de elevación según ELEVATION_SOURCE (ADR-0011). Las alternativas
 * caen a Open-Meteo con la estrategia fija si fallan; mapbox-terrain sin token
 * válido usa directamente la de siempre.
 */
export function elevationDeps(source: string, token: string): ElevationDeps {
  const openMeteo = new OpenMeteoElevationProvider();
  if (source === "mapbox-terrain" && token) {
    return {
      elevation: new MapboxTerrainElevationProvider(token, MODEL_PARAMETERS.elevation.terrain),
      elevationSampling: "mesh" satisfies ElevationSampling,
      elevationFallback: openMeteo,
    };
  }
  if (source === "mapbox-terrain")
    console.warn("[elevation] mapbox-terrain sin token de Mapbox: se usa open-meteo");
  if (source === "open-meteo-adaptive") {
    return { elevation: openMeteo, elevationSampling: "adaptive", elevationFallback: openMeteo };
  }
  return { elevation: openMeteo, elevationSampling: "fixed" };
}

/** Servicio de planificación con los proveedores de producción. `overrides` reemplaza piezas (tests, grabación). */
export function createPlanningService(
  overrides: Partial<PlanningDeps> = {},
): EVRoutePlanningService {
  const token = mapboxServerToken();
  return new EVRoutePlanningService({
    routing: token ? new MapboxRoutingProvider(token) : new OsrmRoutingProvider(),
    ...elevationDeps(getEnv().ELEVATION_SOURCE, token),
    weather: new OpenMeteoWeatherProvider(),
    stations: new DatasetStationCatalog(),
    params: MODEL_PARAMETERS,
    engineMode: getEnv().PLANNER_ENGINE as PlannerEngineMode,
    energyMode: getEnv().ENERGY_ENGINE as EnergyEngineMode,
    // Desvíos medidos (F4): solo con DETOUR_SOURCE=matrix y token de Mapbox.
    detourMatrix:
      getEnv().DETOUR_SOURCE === "matrix" && token ? new MapboxMatrixProvider(token) : undefined,
    ...overrides,
  });
}

export function createGeocoder(): GeocodingProvider {
  return new PhotonGeocodingProvider();
}
