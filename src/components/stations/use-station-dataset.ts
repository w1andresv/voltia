import { useQuery } from "@tanstack/react-query";
import type { ConsolidatedStation, DatasetSourceStatus, StationDataset } from "@/domain/stations/model";
import { getCachedDataset, setCachedDataset } from "@/lib/station-dataset-cookies";

export type StationListItem = Omit<ConsolidatedStation, "attributes" | "conflicts">;

export interface StationDatasetLite {
  version: string;
  generatedAt: string;
  stations: StationListItem[];
  sources: DatasetSourceStatus[];
  stats: StationDataset["stats"];
}

let memoryCache: { etag: string; data: StationDatasetLite } | null = null;

async function fetchStations(): Promise<StationDatasetLite> {
  // 1. Intentar obtener del cache en cookies si es válido
  const cachedData = getCachedDataset();
  if (cachedData) {
    console.log("[STATIONS] ✓ Obtenido del cache de cookies (válido por 6 horas)");
    memoryCache = { etag: cachedData.version, data: cachedData };
    return cachedData;
  }

  // 2. Fetch del servidor con ETag si está en memory
  const headers: HeadersInit = memoryCache ? { "if-none-match": memoryCache.etag } : {};
  const res = await fetch("/api/stations", { headers });
  
  if (res.status === 304 && memoryCache) {
    console.log("[STATIONS] ✓ No modificado desde el cache (ETag match)");
    return memoryCache.data;
  }
  
  if (!res.ok) {
    throw new Error(`No se pudo cargar el listado de electrolineras (${res.status})`);
  }
  
  const data = (await res.json()) as StationDatasetLite;
  const etag = res.headers.get("etag") ?? data.version;
  memoryCache = { etag, data };
  
  // 3. Guardar en cookies para la próxima carga
  setCachedDataset(data);
  console.log("[STATIONS] ✓ Dataset actualizado y guardado en cookies (válido 6 horas)");
  
  return data;
}

const STATIONS_QUERY_KEY = ["stations"] as const;

/** Reutilizable por el hook y por el prefetch de arranque en AppProviders. */
export const stationDatasetQueryOptions = {
  queryKey: STATIONS_QUERY_KEY,
  queryFn: fetchStations,
  staleTime: 6 * 60 * 60 * 1000, // 6 horas, igual que el TTL de cookies
  gcTime: 6 * 60 * 60 * 1000, // 6 horas
};

/** Fuente única para el mapa: dataset nacional consolidado con cache en cookies (6h). */
export function useStationDataset() {
  return useQuery(stationDatasetQueryOptions);
}
