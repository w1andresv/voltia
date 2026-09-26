import { getSql } from "@/infrastructure/db";
import type { NormalizedRecord, SourceId, StationDataset } from "@/domain/stations/model";

interface SnapshotRow {
  records: unknown;
  fetched_at: string | Date;
  ok: boolean;
  error: string | null;
}

interface DatasetRow {
  version: string;
  dataset: unknown;
  generated_at: string | Date;
}

function parseJson<T>(raw: unknown): T | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (parsed ?? null) as T | null;
  } catch {
    return null;
  }
}

export interface StoredSnapshot {
  records: NormalizedRecord[];
  fetchedAt: string;
  ok: boolean;
  error?: string;
}

/** Último snapshot válido de una fuente (para servirlo si la fuente falla en el refresco). */
export async function getSourceSnapshot(sourceId: SourceId): Promise<StoredSnapshot | null> {
  try {
    const sql = await getSql();
    const rows = await sql.query<SnapshotRow>(
      "select records, fetched_at, ok, error from station_source_snapshots where source_id = $1",
      [sourceId],
    );
    const row = rows[0];
    if (!row) return null;
    const records = parseJson<NormalizedRecord[]>(row.records);
    if (!records) return null;
    return {
      records,
      fetchedAt: new Date(row.fetched_at).toISOString(),
      ok: row.ok,
      error: row.error ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function saveSourceSnapshot(
  sourceId: SourceId,
  records: NormalizedRecord[],
  ok: boolean,
  error?: string,
): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(
      `insert into station_source_snapshots (source_id, records, fetched_at, ok, error)
       values ($1, $2, now(), $3, $4)
       on conflict (source_id) do update set
         records = excluded.records,
         fetched_at = excluded.fetched_at,
         ok = excluded.ok,
         error = excluded.error`,
      [sourceId, JSON.stringify(records), ok, error ?? null],
    );
  } catch {
    // Sin snapshot persistido, el próximo refresco vuelve a intentar la fuente desde cero.
  }
}

/** Dataset consolidado más reciente en Postgres (para arranque en frío o tras un refresco). */
export async function getStoredDataset(): Promise<StationDataset | null> {
  try {
    const sql = await getSql();
    const rows = await sql.query<DatasetRow>("select version, dataset, generated_at from station_dataset where id = 'current'");
    const row = rows[0];
    if (!row) return null;
    return parseJson<StationDataset>(row.dataset);
  } catch {
    return null;
  }
}

export async function saveStoredDataset(dataset: StationDataset): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(
      `insert into station_dataset (id, version, dataset, generated_at)
       values ('current', $1, $2, now())
       on conflict (id) do update set
         version = excluded.version,
         dataset = excluded.dataset,
         generated_at = excluded.generated_at`,
      [dataset.version, JSON.stringify(dataset)],
    );
  } catch {
    // El dataset ya se calculó y se sirve desde memoria del proceso; solo se pierde la persistencia.
  }
}

/** Coordinación entre instancias: solo una refresca el dataset a la vez. */
export async function withRefreshLock<T>(run: () => Promise<T>): Promise<T | null> {
  const sql = await getSql();
  const LOCK_KEY = 727_001; // arbitrario, exclusivo para el refresco del dataset de estaciones
  const rows = await sql.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [LOCK_KEY]);
  if (!rows[0]?.locked) return null;
  try {
    return await run();
  } finally {
    await sql.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}
