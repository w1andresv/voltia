import { getSql } from "@/infrastructure/db";
import type {
  Charger,
  ChargerSocket,
  ConnectorType,
  StationAvailability,
  StationStatus,
} from "@/domain/types";

export interface StationRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  operator: string | null;
  sockets: unknown;
  opening_hours: string | null;
  price_per_kwh: number | string | null;
  price_currency: string | null;
  notes: string | null;
  photos: unknown;
  status: string;
  availability: string;
  review_note: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at?: string | Date | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
}

export interface StationWrite {
  name: string;
  lat: number;
  lon: number;
  address?: string;
  operator?: string;
  sockets: ChargerSocket[];
  openingHours?: string;
  pricePerKwh?: number | null;
  priceCurrency?: string;
  notes?: string;
  photos?: string[];
  availability?: StationAvailability;
}

const SELECT_COLS =
  "id, name, lat, lon, address, operator, sockets, opening_hours, price_per_kwh, price_currency, notes, photos, status, availability, review_note, created_by, reviewed_by, reviewed_at, created_at, updated_at";

function asSockets(raw: unknown): ChargerSocket[] {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((s) => {
      const row = s as { connector?: string; powerKw?: number; count?: number };
      if (!row.connector) return null;
      return {
        connector: row.connector as ConnectorType,
        powerKw: Number(row.powerKw) || 22,
        count: Number(row.count) || 1,
      };
    })
    .filter((s): s is ChargerSocket => Boolean(s));
}

function asPhotos(raw: unknown): string[] {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((p): p is string => typeof p === "string").slice(0, 2);
}

function asAvailability(v: string | null): StationAvailability {
  if (v === "available" || v === "occupied" || v === "offline") return v;
  return "unknown";
}

function asStatus(v: string | null): StationStatus {
  if (v === "approved" || v === "rejected") return v;
  return "pending";
}

function asIso(v: string | Date | null | undefined): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  }
  const s = String(v).trim();
  return s || undefined;
}

export function rowToCharger(row: StationRow): Charger {
  const availability = asAvailability(row.availability);
  const price = row.price_per_kwh == null ? undefined : Number(row.price_per_kwh);
  const status = asStatus(row.status);
  return {
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    operator: row.operator ?? undefined,
    sockets: asSockets(row.sockets),
    openingHours: row.opening_hours ?? undefined,
    pricePerKwh:
      price != null && Number.isFinite(price)
        ? { amount: price, currency: row.price_currency || "COP" }
        : undefined,
    source: "community",
    available: availability === "available" ? true : availability === "occupied" || availability === "offline" ? false : null,
    availability,
    status,
    address: row.address ?? undefined,
    notes: row.notes ?? undefined,
    photos: asPhotos(row.photos),
    reviewNote: row.review_note ?? undefined,
    verified: status === "approved",
    updatedAt: asIso(row.updated_at) ?? asIso(row.created_at),
  };
}

export async function loadCommunityChargers(status?: StationStatus | "all"): Promise<Charger[]> {
  const sql = await getSql();
  const rows =
    !status || status === "all"
      ? await sql.query<StationRow>(`select ${SELECT_COLS} from electrolineras order by created_at desc`)
      : await sql.query<StationRow>(
          `select ${SELECT_COLS} from electrolineras where status = $1 order by created_at desc`,
          [status],
        );
  return rows.map(rowToCharger);
}

export async function getStation(id: string): Promise<Charger | null> {
  const sql = await getSql();
  const rows = await sql.query<StationRow>(`select ${SELECT_COLS} from electrolineras where id = $1`, [id]);
  return rows[0] ? rowToCharger(rows[0]) : null;
}

/**
 * Lightweight lookup used only for the updateStationFn permission check: is
 * the caller the original author, and is the station still pending. Doesn't
 * go through rowToCharger — no need to build a full Charger for this.
 */
export async function getStationOwnership(
  id: string,
): Promise<{ createdBy: string | null; status: StationStatus } | null> {
  const sql = await getSql();
  const rows = await sql.query<{ created_by: string | null; status: string }>(
    `select created_by, status from electrolineras where id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? { createdBy: row.created_by, status: asStatus(row.status) } : null;
}

export async function insertStation(data: StationWrite, createdBy: string): Promise<Charger> {
  const sql = await getSql();
  const id = `el_${crypto.randomUUID()}`;
  const availability = data.availability ?? "unknown";
  await sql.query(
    `insert into electrolineras (
      id, name, lat, lon, address, operator, sockets, opening_hours,
      price_per_kwh, price_currency, notes, photos, status, availability, created_by
    ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,'pending',$13,$14)`,
    [
      id,
      data.name,
      data.lat,
      data.lon,
      data.address || null,
      data.operator || null,
      JSON.stringify(data.sockets),
      data.openingHours || null,
      data.pricePerKwh ?? null,
      data.priceCurrency || "COP",
      data.notes || null,
      JSON.stringify(data.photos ?? []),
      availability,
      createdBy,
    ],
  );
  const created = await getStation(id);
  if (!created) throw new Error("No se pudo crear la estación");
  return created;
}

export async function patchStation(id: string, data: StationWrite): Promise<Charger> {
  const sql = await getSql();
  const availability = data.availability ?? "unknown";
  await sql.query(
    `update electrolineras set
      name = $2, lat = $3, lon = $4, address = $5, operator = $6, sockets = $7::jsonb,
      opening_hours = $8, price_per_kwh = $9, price_currency = $10, notes = $11,
      photos = $12::jsonb, availability = $13, updated_at = now()
    where id = $1`,
    [
      id,
      data.name,
      data.lat,
      data.lon,
      data.address || null,
      data.operator || null,
      JSON.stringify(data.sockets),
      data.openingHours || null,
      data.pricePerKwh ?? null,
      data.priceCurrency || "COP",
      data.notes || null,
      JSON.stringify(data.photos ?? []),
      availability,
    ],
  );
  const row = await getStation(id);
  if (!row) throw new Error("Estación no encontrada");
  return row;
}

export async function setStationStatus(
  id: string,
  status: StationStatus,
  reviewNote: string | undefined,
  reviewedBy: string,
): Promise<Charger> {
  const sql = await getSql();
  await sql.query(
    `update electrolineras set status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now() where id = $1`,
    [id, status, reviewNote || null, reviewedBy],
  );
  const row = await getStation(id);
  if (!row) throw new Error("Estación no encontrada");
  return row;
}
