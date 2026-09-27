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
import { BlazeClient } from "@/infrastructure/blaze/client";
import { BlazeStationCatalog, BlazeStationDetails } from "@/infrastructure/blaze/catalog";
import type { StationCatalog } from "@/domain/ports/station-catalog";
import type { StationDetails } from "@/domain/ports/station-details";
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

export type StationSourceId = "legacy" | "blaze";

/** DATA_SOURCE, o blaze si hay key y no se eligió nada (ADR-0008). */
export function stationSourceOf(env: {
  DATA_SOURCE?: StationSourceId;
  BLAZE_API_KEY: string;
}): StationSourceId {
  const wanted = env.DATA_SOURCE ?? (env.BLAZE_API_KEY ? "blaze" : "legacy");
  if (wanted === "blaze" && !env.BLAZE_API_KEY) {
    console.warn("[stations] DATA_SOURCE=blaze sin BLAZE_API_KEY: se usa el dataset consolidado");
    return "legacy";
  }
  return wanted;
}

/**
 * Una sola instancia por proceso: el catálogo de Blaze guarda el último
 * listado bueno para servirlo si la API falla.
 */
let stationsCache: {
  source: StationSourceId;
  catalog: StationCatalog;
  details?: StationDetails;
} | null = null;

function stations() {
  const env = getEnv();
  const source = stationSourceOf(env);
  if (stationsCache?.source === source) return stationsCache;
  if (source === "blaze") {
    const client = new BlazeClient({ baseUrl: env.BLAZE_API_URL, apiKey: env.BLAZE_API_KEY });
    stationsCache = {
      source,
      catalog: new BlazeStationCatalog(client),
      details: new BlazeStationDetails(client),
    };
  } else {
    stationsCache = { source, catalog: new DatasetStationCatalog() };
  }
  return stationsCache;
}

/** Listado de electrolineras según DATA_SOURCE (planificador, mapa y /api/stations). */
export function createStationCatalog(): StationCatalog {
  return stations().catalog;
}

/** Detalle por estación (solo Blaze); undefined con el dataset consolidado. */
export function createStationDetails(): StationDetails | undefined {
  return stations().details;
}

function stationDeps(): Pick<PlanningDeps, "stations" | "stationDetails" | "stationSource"> {
  const s = stations();
  return {
    stations: s.catalog,
    stationSource: s.source === "blaze" ? "blaze" : "dataset",
    ...(s.details ? { stationDetails: s.details } : {}),
  };
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
    // Si el llamador trae su propio catálogo (tests, grabación), no se mezcla con el detalle de Blaze.
    ...(overrides.stations ? { stations: overrides.stations } : stationDeps()),
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
