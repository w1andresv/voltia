"use server";

import { VehicleSchema } from "@/domain/schemas";
import { requireMember } from "@/infrastructure/auth/server-actor";
import { createServerSupabase } from "@/infrastructure/supabase/server";
import type { Vehicle } from "@/domain/types";

/**
 * Fila de voltia.vehicles para el guardado por usuario (fase 4.1). El id de
 * la fila NUNCA es el id local del vehículo (`vehicle.id`, p. ej.
 * "custom-1234" o el id de catálogo "mg-s5-ev-64") — es
 * `"<owner_id>:<vehicle.id>"`, así dos usuarios distintos pueden tener cada
 * uno un vehículo local con el mismo id sin chocar en la llave primaria
 * global de la tabla. El id que le importa a la app (`payload.id`) va
 * intacto dentro del jsonb.
 */
function rowId(ownerId: string, vehicleId: string): string {
  return `${ownerId}:${vehicleId}`;
}

/**
 * Guarda (o actualiza) uno de los vehículos del usuario con sesión — el
 * cliente de Supabase con la cookie de sesión hace que el RLS de
 * voltia.vehicles (0003) se aplique de verdad, a diferencia de getSql().
 */
export async function saveVehicleFn(input: { data: unknown }): Promise<Vehicle> {
  const actor = await requireMember();
  const vehicle = VehicleSchema.parse(input.data);
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .schema("voltia")
    .from("vehicles")
    .upsert({ id: rowId(actor.id as string, vehicle.id), owner_id: actor.id, payload: vehicle });
  if (error) throw new Error(`No se pudo guardar el vehículo: ${error.message}`);
  return vehicle;
}

/** Vehículos guardados del usuario con sesión, más recientes primero. */
export async function listMyVehiclesFn(): Promise<Vehicle[]> {
  const actor = await requireMember();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .schema("voltia")
    .from("vehicles")
    .select("payload")
    .eq("owner_id", actor.id)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`No se pudieron cargar tus vehículos: ${error.message}`);
  return (data ?? []).map((row) => VehicleSchema.parse((row as { payload: unknown }).payload));
}
