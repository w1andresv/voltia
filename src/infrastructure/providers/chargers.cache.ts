import { createHash } from "node:crypto";
import { getSql } from "@/infrastructure/db";
import type { Charger, LatLon } from "@/domain/types";
import { isVerifiedForPlanning } from "@/domain/types";
import { uniqueByProximity } from "@/domain/geo";
import { pickProbes, overpassProvider } from "./chargers.overpass";
import { plugshareProvider } from "./chargers.plugshare";
import { CATALOG_CHARGERS } from "./chargers.catalog";

interface CorridorCacheRow {
  chargers_json: unknown;
}

/** Sondas redondeadas (~1 km): rutas casi idénticas comparten la misma clave. */
function corridorKey(samples: LatLon[]): string {
  const probes = pickProbes(samples);
  const raw = probes.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(";");
  return createHash("sha1").update(raw).digest("hex");
}

function parseCachedChargers(raw: unknown): Charger[] | null {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  return Array.isArray(parsed) ? (parsed as Charger[]) : null;
}

async function readCache(key: string): Promise<Charger[] | null> {
  try {
    const sql = await getSql();
    const rows = await sql.query<CorridorCacheRow>(
      "select chargers_json from charger_corridor_cache where id = $1 and expires_at > now()",
      [key],
    );
    return rows[0] ? parseCachedChargers(rows[0].chargers_json) : null;
  } catch {
    // Sin base de datos disponible, seguimos con las fuentes en vivo.
    return null;
  }
}

async function writeCache(key: string, chargers: Charger[]): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(
      `insert into charger_corridor_cache (id, chargers_json, expires_at)
       values ($1, $2, now() + interval '24 hours')
       on conflict (id) do update set
         chargers_json = excluded.chargers_json,
         expires_at = excluded.expires_at,
         created_at = now()`,
      [key, JSON.stringify(chargers)],
    );
  } catch {
    // El caché es una optimización: si falla el insert, el plan ya se calculó igual.
  }
}

/**
 * OSM + PlugShare, cacheados 24h por corredor: son las fuentes lentas y con
 * cuota. `community` (electrolineras aprobadas por usuarios) y el catálogo del
 * operador se consultan siempre en vivo en `findCachedChargersAlong` — si
 * entraran aquí, una estación nueva o un cambio de disponibilidad tardaría
 * hasta un día en verse.
 */
async function findSlowProviders(samples: LatLon[]): Promise<{ chargers: Charger[]; warnings: string[] }> {
  const key = corridorKey(samples);
  const cached = await readCache(key);
  if (cached) return { chargers: cached, warnings: [] };

  const [plugshare, osm] = await Promise.all([
    plugshareProvider.findAlong(samples),
    overpassProvider.findAlong(samples),
  ]);
  const merged = uniqueByProximity(
    [...plugshare.chargers.filter(isVerifiedForPlanning), ...osm.chargers],
    0.12,
  );
  void writeCache(key, merged);
  return { chargers: merged, warnings: [...plugshare.warnings, ...osm.warnings] };
}

export async function findCachedChargersAlong(
  samples: LatLon[],
  community: Charger[] = [],
): Promise<{ chargers: Charger[]; warnings: string[] }> {
  const slow = await findSlowProviders(samples);

  const catalogNear = CATALOG_CHARGERS.filter(
    (c) => isVerifiedForPlanning(c) && samples.some((s) => Math.abs(s.lat - c.lat) + Math.abs(s.lon - c.lon) < 1.6),
  );

  const merged = uniqueByProximity(
    [...community.filter(isVerifiedForPlanning), ...slow.chargers, ...catalogNear],
    0.18,
  );
  return { chargers: merged, warnings: slow.warnings };
}
