import "server-only";
import { VehicleSchema } from "@/domain/schemas";
import { VEHICLE_CATALOG } from "@/domain/vehicles";
import { getSql } from "@/infrastructure/db";
import type { Vehicle } from "@/domain/types";

/**
 * Catálogo compartido (public.voltia_vehicles con owner_id null), sembrado con
 * `npm run db:seed`. Lanza si la base no responde o aún no tiene catálogo:
 * quien llama decide el respaldo — así un fallo NO queda cacheado como si
 * fuera el catálogo real (ver listCatalogVehiclesFn).
 */
export async function loadCatalogFromDb(): Promise<Vehicle[]> {
  const sql = await getSql();
  const rows = await sql.query<{ payload: unknown }>(
    `select payload from public.voltia_vehicles where owner_id is null order by payload->>'brand', payload->>'model', payload->>'version'`,
  );
  const parsed: Vehicle[] = [];
  for (const row of rows) {
    const result = VehicleSchema.safeParse(row.payload);
    if (result.success) parsed.push(result.data);
    else console.warn("[catalog] fila de catálogo inválida, se omite:", (row.payload as { id?: string })?.id);
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
