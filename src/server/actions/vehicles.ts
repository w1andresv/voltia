"use server";

import { z } from "zod";
import { VehicleSchema } from "@/domain/schemas";
import { requireUser } from "@/infrastructure/auth/server-actor";
import { createServerSupabase } from "@/infrastructure/supabase/server";
import type { Vehicle } from "@/domain/types";

/**
 * Fila de public.voltia_vehicles para el guardado por usuario. El id de la fila NUNCA
 * es el id local del vehículo (`vehicle.id`, p. ej. "custom-1234" o el id de
 * catálogo "mg-s5-ev-64") — es `"<owner_id>:<vehicle.id>"`, así dos usuarios
 * distintos pueden tener cada uno un vehículo local con el mismo id sin chocar
 * en la llave primaria global. El id local va también en `local_id` (único por
 * dueño, ver 0008) y dentro del jsonb (`payload.id`).
 */
function rowId(ownerId: string, vehicleId: string): string {
  return `${ownerId}:${vehicleId}`;
}

/**
 * Guarda (o actualiza) uno de los vehículos del usuario con sesión — el
 * cliente de Supabase con la cookie de sesión hace que el RLS de
 * public.voltia_vehicles se aplique de verdad, a diferencia de getSql().
 */
export async function saveVehicleFn(input: { data: unknown }): Promise<Vehicle> {
  const actor = await requireUser();
  const vehicle = VehicleSchema.parse(input.data);
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("voltia_vehicles")
    .upsert({
      id: rowId(actor.id as string, vehicle.id),
      owner_id: actor.id,
      local_id: vehicle.id,
      payload: vehicle,
    });
  if (error) throw new Error(`No se pudo guardar el vehículo: ${error.message}`);
  return vehicle;
}

/** Vehículos guardados del usuario con sesión, más recientes primero. */
export async function listMyVehiclesFn(): Promise<Vehicle[]> {
  const actor = await requireUser();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("voltia_vehicles")
    .select("payload")
    .eq("owner_id", actor.id)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`No se pudieron cargar tus vehículos: ${error.message}`);
  return (data ?? []).map((row) => VehicleSchema.parse((row as { payload: unknown }).payload));
}

/** Quita un vehículo propio (o restaura un modelo de catálogo editado) por su id local. */
export async function deleteVehicleFn(input: { data: { id: string } }): Promise<void> {
  const actor = await requireUser();
  const id = z.string().min(1).parse(input.data.id);
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("voltia_vehicles")
    .delete()
    .eq("owner_id", actor.id)
    .eq("local_id", id);
  if (error) throw new Error(`No se pudo borrar el vehículo: ${error.message}`);
}
