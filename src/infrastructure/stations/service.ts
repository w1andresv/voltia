import { consolidateDataset } from "@/domain/stations/consolidate";
import type { StationDataset } from "@/domain/stations/model";
import { extractAllSources } from "./extract";
import { getStoredDataset, saveStoredDataset, withRefreshLock } from "./store";

/** Mismo TTL que las fuentes externas: no vale la pena refrescar más seguido. */
const REFRESH_TTL_MS = 6 * 60 * 60 * 1000;

let memoryDataset: StationDataset | null = null;
let refreshing: Promise<StationDataset> | null = null;

async function buildAndStore(): Promise<StationDataset> {
  const { records, sourcesStatus } = await extractAllSources();
  const dataset = await consolidateDataset(records, sourcesStatus);
  
  // Log del dataset consolidado para seguimiento
  const eligible = dataset.stations.filter(s => s.planning.eligible).length;
  const total = dataset.stations.length;
  console.log(`[CONSOLIDATION] ✓ Dataset consolidado:`, {
    version: dataset.version,
    generatedAt: dataset.generatedAt,
    estacionesTotal: total,
    estacionesElegibles: eligible,
    cobertura: `${((eligible / total) * 100).toFixed(1)}%`,
    fuentes: dataset.sources.map(s => ({
      id: s.id,
      ok: s.ok,
      estaciones: dataset.stations.filter(st => st.sources.some(src => src.source === s.id)).length,
      fetchedAt: s.fetchedAt,
      ...(s.error && { error: s.error })
    }))
  });
  
  memoryDataset = dataset;
  void saveStoredDataset(dataset);
  return dataset;
}

/** Refresca ya mismo (cron, `npm run stations:refresh`). Coordina instancias con un advisory lock. */
export async function refreshStationDataset(): Promise<StationDataset> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const locked = await withRefreshLock(buildAndStore).catch(() => undefined);
      if (locked) return locked;
      if (locked === null) {
        // Otra instancia ya está refrescando: sirve lo que haya mientras termina.
        return memoryDataset ?? (await getStoredDataset()) ?? (await buildAndStore());
      }
      // Sin Postgres para el lock (p. ej. dev sin DATABASE_URL): refresca igual, sin coordinación.
      return await buildAndStore();
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function isStale(dataset: StationDataset): boolean {
  return Date.now() - new Date(dataset.generatedAt).getTime() > REFRESH_TTL_MS;
}

/** Memoria del proceso -> Postgres -> refresco. Si está viejo, sirve el actual y refresca en segundo plano. */
export async function getStationDataset(): Promise<StationDataset> {
  if (memoryDataset) {
    if (isStale(memoryDataset)) void refreshStationDataset();
    return memoryDataset;
  }
  const stored = await getStoredDataset();
  if (stored) {
    memoryDataset = stored;
    if (isStale(stored)) void refreshStationDataset();
    return stored;
  }
  return refreshStationDataset();
}

/** Solo para instrumentation.ts: precarga desde Postgres a memoria sin llamar a las fuentes externas. */
export async function preloadStationDataset(): Promise<void> {
  const stored = await getStoredDataset().catch(() => null);
  if (stored) memoryDataset = stored;
}
