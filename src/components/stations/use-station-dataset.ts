import { useQuery } from "@tanstack/react-query";
import type { ConsolidatedStation, DatasetSourceStatus, StationDataset } from "@/domain/stations/model";

export type StationListItem = Omit<ConsolidatedStation, "attributes" | "conflicts">;

export interface StationDatasetLite {
  version: string;
  generatedAt: string;
  stations: StationListItem[];
  sources: DatasetSourceStatus[];
  stats: StationDataset["stats"];
}

let cache: { etag: string; data: StationDatasetLite } | null = null;

async function fetchStations(): Promise<StationDatasetLite> {
  const headers: HeadersInit = cache ? { "if-none-match": cache.etag } : {};
  const res = await fetch("/api/stations", { headers });
  if (res.status === 304 && cache) return cache.data;
  if (!res.ok) throw new Error(`No se pudo cargar el listado de electrolineras (${res.status})`);
  const data = (await res.json()) as StationDatasetLite;
  cache = { etag: res.headers.get("etag") ?? data.version, data };
  return data;
}

const STATIONS_QUERY_KEY = ["stations"] as const;

/** Reutilizable por el hook y por el prefetch de arranque en AppProviders. */
export const stationDatasetQueryOptions = {
  queryKey: STATIONS_QUERY_KEY,
  queryFn: fetchStations,
  staleTime: 30 * 60_000,
  gcTime: 60 * 60_000,
};

/** Fuente única para el mapa: dataset nacional consolidado (reemplaza useChargerNetwork). */
export function useStationDataset() {
  return useQuery(stationDatasetQueryOptions);
}
