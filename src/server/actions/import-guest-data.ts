"use server";

import { z } from "zod";
import { PlanRequestSchema, TripSummarySchema, VehicleSchema } from "@/domain/schemas";
import { planImport } from "@/domain/user/import-plan";
import { requireUser } from "@/infrastructure/auth/server-actor";
import { loadCatalog } from "@/infrastructure/catalog/catalog-store";
import { createServerSupabase } from "@/infrastructure/supabase/server";

const MAX_IMPORT_VEHICLES = 20;
const MAX_IMPORT_TRIPS = 50;

const ImportInput = z.object({
  vehicles: z.array(VehicleSchema).max(MAX_IMPORT_VEHICLES),
  trips: z
    .array(
      z.object({
        clientId: z.string().uuid(),
        request: PlanRequestSchema,
        summary: TripSummarySchema,
      }),
    )
    .max(MAX_IMPORT_TRIPS),
});

/**
 * `imported`: se guardó. `duplicate`: ya existía. `skipped`: la regla de
 * migración decidió no subirlo (catálogo sin cambios, equivalente en la
 * cuenta…). `failed`: se queda en el navegador y se reintenta. El cliente
 * borra todo lo local salvo `failed`.
 */
export type ImportItemStatus = "imported" | "duplicate" | "skipped" | "failed";

export interface ImportGuestDataResult {
  vehicles: { localId: string; status: ImportItemStatus }[];
  trips: { clientId: string; status: ImportItemStatus }[];
  /** id local → id en la cuenta, solo donde cambió. */
  idMap: Record<string, string>;
  discardedEdits: string[];
}

interface RpcResult {
  vehicles: { localId: string; status: "imported" | "duplicate" | "failed" }[];
  trips: { clientId: string; status: "imported" | "duplicate" | "failed" }[];
}

/**
 * Importa los vehículos y rutas del invitado a la cuenta, idempotente por
 * ítem (`local_id` y `client_id`, ver 0008). Las decisiones son puras
 * (planImport); la función SQL solo las aplica con el RLS del usuario.
 */
export async function importGuestDataFn(input: { data: unknown }): Promise<ImportGuestDataResult> {
  const actor = await requireUser();
  const data = ImportInput.parse(input.data);
  const supabase = await createServerSupabase();

  const [vehiclesRes, tripsRes, catalog] = await Promise.all([
    supabase.from("voltia_vehicles").select("payload").eq("owner_id", actor.id),
    supabase.from("voltia_trips").select("client_id, payload").eq("owner_id", actor.id),
    loadCatalog(),
  ]);
  if (vehiclesRes.error) throw new Error(`No se pudo leer tu cuenta: ${vehiclesRes.error.message}`);
  if (tripsRes.error) throw new Error(`No se pudo leer tu cuenta: ${tripsRes.error.message}`);

  const accountVehicles = (vehiclesRes.data ?? []).map((r) =>
    VehicleSchema.parse((r as { payload: unknown }).payload),
  );
  const accountTrips = (tripsRes.data ?? []).flatMap((r) => {
    const row = r as { client_id: string | null; payload: { request?: unknown } };
    const request = PlanRequestSchema.safeParse(row.payload?.request);
    return request.success ? [{ clientId: row.client_id, request: request.data }] : [];
  });

  const plan = planImport({
    guestVehicles: data.vehicles,
    guestTrips: data.trips,
    account: { vehicles: accountVehicles, trips: accountTrips },
    catalog,
  });

  const toInsertVehicles = plan.vehicles.flatMap((v) =>
    v.action === "insert" ? [{ localId: v.localId, payload: v.payload }] : [],
  );
  const toInsertTrips = plan.trips.flatMap((t) =>
    t.action === "insert" ? [{ clientId: t.clientId, payload: t.payload }] : [],
  );

  let rpc: RpcResult = { vehicles: [], trips: [] };
  if (toInsertVehicles.length > 0 || toInsertTrips.length > 0) {
    const { data: rpcData, error } = await supabase
      .rpc("voltia_import_guest_data", { p_vehicles: toInsertVehicles, p_trips: toInsertTrips });
    if (error) throw new Error(`No se pudieron importar tus datos: ${error.message}`);
    rpc = rpcData as RpcResult;
  }

  const vStatus = new Map(rpc.vehicles.map((v) => [v.localId, v.status]));
  const tStatus = new Map(rpc.trips.map((t) => [t.clientId, t.status]));

  // El id local original de un vehículo remapeado es la clave del idMap.
  const originalIdOf = new Map(Object.entries(plan.idMap).map(([from, to]) => [to, from]));

  return {
    vehicles: plan.vehicles.map((v) => ({
      localId: originalIdOf.get(v.localId) ?? v.localId,
      status: v.action === "skip" ? "skipped" : (vStatus.get(v.localId) ?? "failed"),
    })),
    trips: plan.trips.map((t) => ({
      clientId: t.clientId,
      status: t.action === "skip" ? "skipped" : (tStatus.get(t.clientId) ?? "failed"),
    })),
    idMap: plan.idMap,
    discardedEdits: plan.discardedEdits,
  };
}
