import type { DatasetSourceStatus, NormalizedRecord } from "@/domain/stations/model";
import { validateRecord } from "@/domain/stations/validate";
import { STATION_SOURCES } from "./registry";
import { getSourceSnapshot, saveSourceSnapshot } from "./store";
import type { StationSource } from "./sources/types";

export interface ExtractResult {
  records: NormalizedRecord[];
  sourcesStatus: DatasetSourceStatus[];
}

async function extractSource(
  source: StationSource,
): Promise<{ status: DatasetSourceStatus; records: NormalizedRecord[] }> {
  if (!source.enabled()) {
    return { status: { id: source.id, ok: true, stale: false, records: 0, accepted: 0, rejected: {} }, records: [] };
  }

  const startedAt = Date.now();
  try {
    const raw = await source.fetchAll(AbortSignal.timeout(source.timeoutMs));
    const accepted: NormalizedRecord[] = [];
    const rejected: Record<string, number> = {};
    for (const record of raw) {
      const sameSource = accepted.filter((r) => r.source === record.source);
      const { valid, reasons } = validateRecord(record, sameSource);
      if (valid) {
        accepted.push(record);
      } else {
        for (const reason of reasons) rejected[reason] = (rejected[reason] ?? 0) + 1;
      }
    }
    void saveSourceSnapshot(source.id, accepted, true);
    return {
      status: {
        id: source.id,
        ok: true,
        stale: false,
        fetchedAt: new Date().toISOString(),
        records: raw.length,
        accepted: accepted.length,
        rejected,
        durationMs: Date.now() - startedAt,
      },
      records: accepted,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // No se sobreescribe el snapshot: si esta corrida falló, el próximo refresco
    // debe poder volver a usar el último snapshot válido, no uno vacío.
    const snapshot = await getSourceSnapshot(source.id);
    if (snapshot) {
      return {
        status: {
          id: source.id,
          ok: false,
          stale: true,
          fetchedAt: snapshot.fetchedAt,
          records: snapshot.records.length,
          accepted: snapshot.records.length,
          rejected: {},
          error: message,
          durationMs: Date.now() - startedAt,
        },
        records: snapshot.records,
      };
    }
    return {
      status: {
        id: source.id,
        ok: false,
        stale: false,
        records: 0,
        accepted: 0,
        rejected: {},
        error: message,
        durationMs: Date.now() - startedAt,
      },
      records: [],
    };
  }
}

/** Corre todas las fuentes en paralelo; una que falle nunca bloquea a las demás. */
export async function extractAllSources(): Promise<ExtractResult> {
  const results = await Promise.all(STATION_SOURCES.map(extractSource));
  return {
    records: results.flatMap((r) => r.records),
    sourcesStatus: results.map((r) => r.status),
  };
}
