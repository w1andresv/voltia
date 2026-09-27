import { useQuery } from "@tanstack/react-query";
import type {
  ConsolidatedStation,
  DatasetSourceStatus,
  StationDataset,
} from "@/domain/stations/model";
import { getCachedDataset, setCachedDataset } from "@/lib/station-dataset-cookies";
import { usePlanner } from "@/lib/store";

export type StationListItem = Omit<ConsolidatedStation, "attributes" | "conflicts">;

export interface StationDatasetLite {
  version: string;
  generatedAt: string;
  stations: StationListItem[];
  sources: DatasetSourceStatus[];
  stats: StationDataset["stats"];
}

/** Motor elegido en el planificador: con v2 el listado sale de Blaze (ADR-0008). */
export type StationEngine = "v1" | "v2" | null;

const memoryCache = new Map<string, { etag: string; data: StationDatasetLite }>();

/** Olvida los listados guardados en memoria (botón "Limpiar caché"). */
export function resetStationDatasetMemory(): void {
  memoryCache.clear();
}

/** El listado de Blaze trae estados que cambian: no va a las cookies de 6 h. */
function usesCookies(engine: StationEngine): boolean {
  return engine !== "v2";
}

async function fetchStations(engine: StationEngine): Promise<StationDatasetLite> {
  const key = engine ?? "default";
  // 1. Intentar obtener del cache en cookies si es válido
  const cachedData = usesCookies(engine) ? getCachedDataset() : null;
  if (cachedData) {
    console.log("[STATIONS] ✓ Obtenido del cache de cookies (válido por 6 horas)");
    memoryCache.set(key, { etag: cachedData.version, data: cachedData });
    return cachedData;
  }

  // 2. Fetch del servidor con ETag si está en memory
  const cached = memoryCache.get(key);
  const headers: HeadersInit = cached ? { "if-none-match": cached.etag } : {};
  const res = await fetch(engine ? `/api/stations?engine=${engine}` : "/api/stations", { headers });

  if (res.status === 304 && cached) {
    console.log("[STATIONS] ✓ No modificado desde el cache (ETag match)");
    return cached.data;
  }

  if (!res.ok) {
    throw new Error(`No se pudo cargar el listado de electrolineras (${res.status})`);
  }

  const data = (await res.json()) as StationDatasetLite;
  const etag = res.headers.get("etag") ?? data.version;
  memoryCache.set(key, { etag, data });

  // 3. Guardar en cookies para la próxima carga
  if (usesCookies(engine)) {
    setCachedDataset(data);
    console.log("[STATIONS] ✓ Dataset actualizado y guardado en cookies (válido 6 horas)");
  }

  return data;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
/** Igual que la caché del listado de Blaze en el servidor. */
const BLAZE_STALE_MS = 15 * 60 * 1000;

/** Reutilizable por el hook y por el prefetch de arranque en AppProviders. */
export function stationDatasetQueryOptions(engine: StationEngine = null) {
  return {
    queryKey: ["stations", engine ?? "default"] as const,
    queryFn: () => fetchStations(engine),
    // 6 h con el dataset consolidado (igual que las cookies); 15 min con Blaze.
    staleTime: engine === "v2" ? BLAZE_STALE_MS : SIX_HOURS_MS,
    gcTime: SIX_HOURS_MS,
  };
}

/** Fuente única para el mapa: el listado del motor elegido (v2: Blaze; si no, el dataset consolidado). */
export function useStationDataset() {
  const engine = usePlanner((s) => s.engineChoice);
  return useQuery(stationDatasetQueryOptions(engine));
}
