import type { LatLon, Place } from "../types";

/** Búsqueda de lugares para la UI. Queda fuera del motor de rutas (la entrada del motor son coordenadas). */
export interface GeocodingProvider {
  search(query: string, near?: LatLon): Promise<Place[]>;
  reverse(point: LatLon): Promise<Place>;
}
