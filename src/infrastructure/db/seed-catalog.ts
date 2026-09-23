import "server-only";
import { VEHICLE_CATALOG } from "@/lib/domain/vehicles";
import { getSql } from "@/lib/db";

let seeded: Promise<number> | null = null;

/** Shared catalog only. Never overwrites a vehicle owned by a user. */
export function ensureCatalogSeed(): Promise<number> {
  seeded ??= writeCatalog().catch((error) => {
    seeded = null;
    throw error;
  });
  return seeded;
}

async function writeCatalog(): Promise<number> {
  const sql = await getSql();
  for (const vehicle of VEHICLE_CATALOG) {
    await sql.query(
      `insert into voltia.vehicles (id, owner_id, payload)
       values ($1, null, $2::jsonb)
       on conflict (id) do update
         set payload = excluded.payload, updated_at = now()
       where voltia.vehicles.owner_id is null`,
      [vehicle.id, JSON.stringify(vehicle)],
    );
  }
  return VEHICLE_CATALOG.length;
}
