"use server";

import { unstable_cache } from "next/cache";
import { loadCatalogFromDb } from "@/infrastructure/catalog/catalog-store";
import { VEHICLE_CATALOG } from "@/domain/vehicles";
import type { Vehicle } from "@/domain/types";

// Solo se cachea una lectura exitosa: si la base falla, unstable_cache no guarda
// nada (la función lanza) y el siguiente request vuelve a intentarlo.
const cachedCatalog = unstable_cache(loadCatalogFromDb, ["vehicle-catalog-v2"], {
  revalidate: 600,
  tags: ["vehicle-catalog"],
});

/** Catálogo público de vehículos, común a todos; cacheado 10 minutos. */
export async function listCatalogVehiclesFn(): Promise<Vehicle[]> {
  try {
    return await cachedCatalog();
  } catch (error) {
    console.error(
      "[catalog] no se pudo leer el catálogo, uso el de respaldo",
      error instanceof Error ? error.message : error,
    );
    return VEHICLE_CATALOG;
  }
}
