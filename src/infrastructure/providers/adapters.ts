/**
 * Adaptadores de los puertos del dominio (src/domain/ports) sobre los
 * proveedores concretos. Solo traen datos: el muestreo, la elevación aplicada
 * y la política de rutas están en el dominio y en la aplicación (F2).
 */
import {
  RoutingError,
  type ProviderRoute,
  type ProviderRouteSet,
  type RouteRequest,
} from "@/domain/ev/contracts/route";
import type { ElevationProvider } from "@/domain/ports/elevation";
import type { GeocodingProvider } from "@/domain/ports/geocoding";
import type { RoutingProvider } from "@/domain/ports/routing";
import type { WeatherProvider } from "@/domain/ports/weather";
import type { LatLon } from "@/domain/types";
import {
  mapboxTileFetcher,
  terrainElevations,
  type TileDecoder,
  type TileFetcher,
} from "./elevation.mapbox-terrain";
import { fetchElevations } from "./elevation.openmeteo";
import { MAPBOX_MATRIX_MAX_COORDINATES, fetchMapboxMatrix } from "./matrix.mapbox";
import type { DistanceMatrixProvider } from "@/domain/ports/distance-matrix";
import { reversePlace, searchPlaces } from "./geocode.photon";
import {
  MapboxRoutingError,
  fetchMapboxCandidates,
  mapboxProfileFor,
  redact,
} from "./routing.mapbox";
import { fetchOsrmCandidates, type OsrmRoute } from "./routing.osrm";
import { fetchWeather } from "./weather.openmeteo";

export const OSRM_NO_TOKEN_WARNING =
  "Sin token de Mapbox en el servidor. La distancia usa OpenStreetMap (OSRM) y puede diferir de Google Maps.";

function toLatLon([lon, lat]: [number, number]): LatLon {
  return { lat, lon };
}

/** Límite de Mapbox ({speed, unit} | {unknown} | {none}) en km/h; null si no se sabe o no hay. */
export function maxspeedKmh(m: {
  speed?: number;
  unit?: string;
  unknown?: boolean;
  none?: boolean;
}): number | null {
  if (m.speed == null || !(m.speed > 0)) return null;
  return m.unit === "mph" ? m.speed * 1.609344 : m.speed;
}

/** Una ruta en formato Directions (Mapbox y OSRM usan el mismo) → ProviderRoute. */
export function toProviderRoute(
  route: OsrmRoute,
  provider: string,
  profile: string,
): ProviderRoute {
  return {
    provider,
    profile,
    geometry: route.geometry.coordinates.map(toLatLon),
    distanceM: route.distance,
    durationS: route.duration,
    legs: (route.legs ?? []).map((leg) => ({
      summary: leg.summary,
      distanceM: leg.distance,
      annotation: leg.annotation
        ? {
            distanceM: leg.annotation.distance,
            durationS: leg.annotation.duration,
            ...(leg.annotation.maxspeed
              ? { maxspeedKmh: leg.annotation.maxspeed.map(maxspeedKmh) }
              : {}),
          }
        : undefined,
      steps: leg.steps?.map((step) => ({
        distanceM: step.distance,
        durationS: step.duration,
        geometry: step.geometry?.coordinates.map(toLatLon),
        intersections: step.intersections?.map((it) => ({
          location: toLatLon(it.location),
          roadClass: it.mapbox_streets_v8?.class,
          ...(it.classes?.length ? { classes: it.classes } : {}),
        })),
      })),
    })),
  };
}

/** Mapbox Directions (perfil driving): alternativas, evitar peajes y puntos, clase vial por paso. */
export class MapboxRoutingProvider implements RoutingProvider {
  readonly id = "mapbox";
  readonly label = "Mapbox";
  readonly engine = "mapbox" as const;
  readonly capabilities = {
    alternatives: true,
    avoidTolls: true,
    avoidPoints: true,
    roadClasses: true,
  };
  constructor(private readonly token: string) {}

  async calculateRoutes(request: RouteRequest): Promise<ProviderRouteSet> {
    const profile = mapboxProfileFor(request.waypoints.length);
    try {
      const { routes, snapKm } = await fetchMapboxCandidates(request.waypoints, this.token, {
        profile,
        alternatives: request.alternatives,
        excludeToll: request.avoid?.tolls,
        excludePoints: request.avoid?.points,
      });
      return {
        routes: routes.map((r) => toProviderRoute(r, this.id, profile)),
        waypointSnapKm: snapKm,
      };
    } catch (error) {
      // El mensaje nunca lleva el token (viene dentro de la URL).
      throw new RoutingError(redact(error), error instanceof MapboxRoutingError && error.noRoute);
    }
  }
}

/** OSRM público: respaldo sin token de Mapbox (distancias pueden diferir de Google). */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly id = "osrm";
  readonly label = "OSRM";
  readonly engine = "osrm" as const;
  readonly capabilities = {
    alternatives: true,
    avoidTolls: false,
    avoidPoints: false,
    roadClasses: false,
  };
  readonly notice = OSRM_NO_TOKEN_WARNING;

  async calculateRoutes(request: RouteRequest): Promise<ProviderRouteSet> {
    const routes = await fetchOsrmCandidates(request.waypoints);
    return {
      routes: routes.map((r) => toProviderRoute(r, this.id, "driving")),
      waypointSnapKm: [],
    };
  }
}

/** Open-Meteo (modelo de 90 m), con OpenTopoData de respaldo. */
export class OpenMeteoElevationProvider implements ElevationProvider {
  readonly id = "open-meteo";
  getElevations(points: LatLon[]) {
    return fetchElevations(points);
  }
}

/** Teselas de terreno de Mapbox (ELEVATION_SOURCE=mapbox-terrain, ADR-0011). */
export class MapboxTerrainElevationProvider implements ElevationProvider {
  readonly id = "mapbox-terrain";
  constructor(
    private readonly token: string,
    private readonly opts: { zoom: number; tileset: string; retina?: boolean },
    private readonly fetchTile: TileFetcher = mapboxTileFetcher(token, { retina: opts.retina }),
    private readonly decode?: TileDecoder,
    /** Distingue en la caché en memoria teselas del mismo tileset con otro tamaño o formato. */
    private readonly cacheId: string = `${opts.tileset}${opts.retina ? "@2x" : ""}`,
  ) {}
  getElevations(points: LatLon[]) {
    return terrainElevations(points, {
      zoom: this.opts.zoom,
      tileset: this.opts.tileset,
      fetchTile: this.fetchTile,
      decode: this.decode,
      cacheId: this.cacheId,
    });
  }
}

/** Matriz de distancias de Mapbox para medir desvíos (DETOUR_SOURCE=matrix, F4). */
export class MapboxMatrixProvider implements DistanceMatrixProvider {
  readonly id = "mapbox-matrix";
  readonly maxCoordinates = MAPBOX_MATRIX_MAX_COORDINATES;
  constructor(private readonly token: string) {}
  matrix(sources: LatLon[], destinations: LatLon[]) {
    return fetchMapboxMatrix(this.token, sources, destinations);
  }
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  readonly id = "open-meteo";
  current(point: LatLon) {
    return fetchWeather(point);
  }
}

export class PhotonGeocodingProvider implements GeocodingProvider {
  search(query: string, near?: LatLon) {
    return searchPlaces(query, near);
  }
  reverse(point: LatLon) {
    return reversePlace(point.lat, point.lon);
  }
}
