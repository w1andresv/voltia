/**
 * Composición: el único lugar de la capa de aplicación que conoce los
 * proveedores concretos (Mapbox, OSRM, Open-Meteo, Photon, Postgres).
 */
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import type { GeocodingProvider } from "@/domain/ports/geocoding";
import { getEnv } from "@/infrastructure/config/env";
import {
  MapboxGeocodingProvider,
  MapboxMatrixProvider,
  MapboxRoutingProvider,
  MapboxTerrainElevationProvider,
  OpenMeteoElevationProvider,
  OpenMeteoWeatherProvider,
  OsrmRoutingProvider,
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

/**
 * Blaze solo para el motor v2 (ADR-0008): v1 y el modo sombra siguen con el
 * dataset consolidado. v2 sin BLAZE_API_KEY también, con un aviso.
 */
export function stationSourceOf(
  engine: PlannerEngineMode,
  env: { BLAZE_API_KEY: string },
): StationSourceId {
  if (engine !== "v2") return "legacy";
  if (!env.BLAZE_API_KEY) {
    console.warn("[stations] motor v2 sin BLAZE_API_KEY: se usa el dataset consolidado");
    return "legacy";
  }
  return "blaze";
}

/**
 * Una instancia por fuente y proceso: el catálogo de Blaze guarda el último
 * listado bueno para servirlo si la API falla.
 */
let legacyStations: StationCatalog | null = null;
let blazeStations: { catalog: StationCatalog; details: StationDetails } | null = null;

function stationsFor(source: StationSourceId): {
  catalog: StationCatalog;
  details?: StationDetails;
} {
  if (source === "legacy") return { catalog: (legacyStations ??= new DatasetStationCatalog()) };
  if (!blazeStations) {
    const env = getEnv();
    const client = new BlazeClient({ baseUrl: env.BLAZE_API_URL, apiKey: env.BLAZE_API_KEY });
    blazeStations = {
      catalog: new BlazeStationCatalog(client),
      details: new BlazeStationDetails(client),
    };
  }
  return blazeStations;
}

/** Olvida el listado de Blaze guardado en este proceso (botón "Limpiar caché"). */
export function resetStationCaches(): void {
  blazeStations = null;
}

/** El motor que responde: el elegido por el usuario o PLANNER_ENGINE. */
function engineOf(choice?: "v1" | "v2" | null): PlannerEngineMode {
  if (choice === "v2") return "v2";
  if (choice === "v1") return "legacy";
  return getEnv().PLANNER_ENGINE as PlannerEngineMode;
}

/** Listado de electrolineras del motor elegido (mapa, /api/stations). */
export function createStationCatalog(choice?: "v1" | "v2" | null): StationCatalog {
  return stationsFor(stationSourceOf(engineOf(choice), getEnv())).catalog;
}

/**
 * Detalle de una estación: solo las de Blaze lo tienen (id "blz_…"), y solo
 * si hay key. undefined para las del dataset consolidado.
 */
export function createStationDetails(stationId: string): StationDetails | undefined {
  if (!stationId.startsWith("blz_") || !getEnv().BLAZE_API_KEY) return undefined;
  return stationsFor("blaze").details;
}

function stationDeps(
  engine: PlannerEngineMode,
): Pick<PlanningDeps, "stations" | "stationDetails" | "stationSource"> {
  const source = stationSourceOf(engine, getEnv());
  const s = stationsFor(source);
  return {
    stations: s.catalog,
    stationSource: source === "blaze" ? "blaze" : "dataset",
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
    // Estaciones según el motor que responde (Blaze solo con v2). Si el llamador trae
    // su propio catálogo (tests, grabación), no se mezcla con el detalle de Blaze.
    ...(overrides.stations
      ? { stations: overrides.stations }
      : stationDeps(overrides.engineMode ?? (getEnv().PLANNER_ENGINE as PlannerEngineMode))),
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
  return new MapboxGeocodingProvider();
}
