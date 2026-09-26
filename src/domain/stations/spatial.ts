import type { ConsolidatedStation } from "./model";
import type { LatLon } from "../types";
import { haversineKm } from "../geo";

/**
 * Filtra las estaciones que están a una distancia máxima de cualquiera de los puntos de la ruta.
 * Para Colombia (~500 estaciones) una iteración con pre-filtro por Bounding Box es muy rápida.
 */
export function findStationsNearRoute(
  stations: ConsolidatedStation[],
  routeSamples: LatLon[],
  maxKm: number
): ConsolidatedStation[] {
  if (routeSamples.length === 0 || stations.length === 0) return [];

  // 1. Calcular el bounding box de la ruta
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of routeSamples) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  // 2. Expandir el bounding box para incluir el maxKm (aprox 1 grado ~ 111 km)
  const degExpansion = maxKm / 110;
  minLat -= degExpansion;
  maxLat += degExpansion;
  minLon -= degExpansion;
  maxLon += degExpansion;

  // 3. Filtrar
  const result: ConsolidatedStation[] = [];
  
  for (const st of stations) {
    // Pre-filtro barato
    if (
      st.lat < minLat ||
      st.lat > maxLat ||
      st.lon < minLon ||
      st.lon > maxLon
    ) {
      continue;
    }

    // Comprobación exacta
    let minD = Infinity;
    for (const p of routeSamples) {
      const d = haversineKm({ lat: st.lat, lon: st.lon }, p);
      if (d < minD) minD = d;
    }

    if (minD <= maxKm) {
      result.push(st);
    }
  }

  return result;
}
