import "server-only";
import { VehicleSchema } from "@/domain/schemas";
import { VEHICLE_CATALOG } from "@/domain/vehicles";
import { getSql } from "@/infrastructure/db";
import type { Vehicle } from "@/domain/types";

/**
 * Vehículos de public.voltia_vehicles, sembrados con `npm run db:seed`. El MVP
 * todavía no distingue por dueño: se leen todas las filas, con o sin owner_id.
 * Si dos filas traen el mismo id de vehículo, gana la del catálogo (owner_id
 * null) y luego la más reciente. Lanza si la base no responde o está vacía:
 * quien llama decide el respaldo — así un fallo NO queda cacheado como si
 * fuera el catálogo real (ver listCatalogVehiclesFn).
 */
export async function loadCatalogFromDb(): Promise<Vehicle[]> {
  const sql = await getSql();
  const rows = await sql.query<{ payload: unknown }>(
    `select payload from public.voltia_vehicles order by payload->>'brand', payload->>'model', payload->>'version', (owner_id is not null), updated_at desc`,
  );
  const parsed: Vehicle[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const result = VehicleSchema.safeParse(row.payload);
    if (!result.success) {
      console.warn("[catalog] fila de catálogo inválida, se omite:", (row.payload as { id?: string })?.id);
      continue;
    }
    if (seen.has(result.data.id)) continue;
    seen.add(result.data.id);
    parsed.push(result.data);
  }
  if (parsed.length === 0) throw new Error("El catálogo de la base está vacío (¿falta npm run db:seed?)");
  return parsed;
}

/** Catálogo de la base o, si no se puede leer, el de respaldo en código. */
export async function loadCatalog(): Promise<Vehicle[]> {
  try {
    return await loadCatalogFromDb();
  } catch (error) {
    console.error(
      "[catalog] no se pudo leer el catálogo, uso el de respaldo",
      error instanceof Error ? error.message : error,
    );
    return VEHICLE_CATALOG;
  }
}
