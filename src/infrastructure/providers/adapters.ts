/**
 * Adaptadores de los puertos del dominio (src/domain/ports) sobre los
 * proveedores actuales. En F1 solo envuelven el código existente, sin cambiar
 * su comportamiento (ADR-0005).
 */
import type { ElevationProvider } from "@/domain/ports/elevation";
import type { GeocodingProvider } from "@/domain/ports/geocoding";
import type { RoutingProvider } from "@/domain/ports/routing";
import type { WeatherProvider } from "@/domain/ports/weather";
import type { LatLon, RawRoute } from "@/domain/types";
import { applyElevationAll } from "./elevation.openmeteo";
import { reversePlace, searchPlaces } from "./geocode.photon";
import { fetchMapboxRoutes, fetchOsrmRoutes } from "./routing";
import { fetchWeather } from "./weather.openmeteo";

/** Mapbox Directions con alternativas, variante sin peajes y corrección de atajos. */
export class MapboxRoutingProvider implements RoutingProvider {
  readonly id = "mapbox";
  constructor(private readonly token: string) {}
  routes(waypoints: LatLon[]) {
    return fetchMapboxRoutes(waypoints, this.token);
  }
}

/** OSRM público: respaldo sin token de Mapbox (distancias pueden diferir de Google). */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly id = "osrm";
  routes(waypoints: LatLon[]) {
    return fetchOsrmRoutes(waypoints);
  }
}

/** Open-Meteo (modelo de 90 m), con OpenTopoData de respaldo. */
export class OpenMeteoElevationProvider implements ElevationProvider {
  readonly id = "open-meteo";
  applyTo(routes: RawRoute[]) {
    return applyElevationAll(routes);
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
