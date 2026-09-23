"use server";

import { z } from "zod";
import { PlanRequestSchema, TripSummarySchema } from "@/domain/schemas";
import type { SavedTrip } from "@/domain/user/types";
import { requireUser } from "@/infrastructure/auth/server-actor";
import { createServerSupabase } from "@/infrastructure/supabase/server";

export type { SavedTrip };

const PayloadSchema = z.object({ request: PlanRequestSchema, summary: TripSummarySchema });

interface TripRow {
  id: string;
  payload: unknown;
  shared: boolean;
  share_id: string | null;
  created_at: string;
}

function toSavedTrip(row: TripRow): SavedTrip {
  const payload = PayloadSchema.parse(row.payload);
  return {
    id: row.id,
    request: payload.request,
    summary: payload.summary,
    shared: row.shared,
    shareId: row.share_id,
    createdAt: row.created_at,
  };
}

const SaveTripInput = z.object({
  request: PlanRequestSchema,
  summary: TripSummarySchema,
  /** Clave de idempotencia (uuid): un reintento con el mismo clientId no duplica. */
  clientId: z.string().uuid().optional(),
});

/**
 * Guarda un viaje planeado del usuario con sesión. Se guarda la petición
 * (PlanRequest) y un resumen del resultado, no el plan entero — el plan se
 * puede volver a calcular a partir de la petición (ver /v/[shareId]).
 */
export async function saveTripFn(input: { data: unknown }): Promise<SavedTrip> {
  const actor = await requireUser();
  const { clientId, ...data } = SaveTripInput.parse(input.data);
  const supabase = await createServerSupabase();
  if (clientId) {
    const { data: existing } = await supabase
      .from("voltia_trips")
      .select("id, payload, shared, share_id, created_at")
      .eq("owner_id", actor.id)
      .eq("client_id", clientId)
      .maybeSingle();
    if (existing) return toSavedTrip(existing as TripRow);
  }
  const { data: row, error } = await supabase
    .from("voltia_trips")
    .insert({ owner_id: actor.id, client_id: clientId ?? null, payload: data })
    .select("id, payload, shared, share_id, created_at")
    .single();
  if (error || !row) throw new Error(`No se pudo guardar el viaje: ${error?.message ?? "sin fila"}`);
  return toSavedTrip(row as TripRow);
}

/** Historial del usuario con sesión, más reciente primero. */
export async function listMyTripsFn(): Promise<SavedTrip[]> {
  const actor = await requireUser();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("voltia_trips")
    .select("id, payload, shared, share_id, created_at")
    .eq("owner_id", actor.id)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`No se pudo cargar tu historial: ${error.message}`);
  return (data ?? []).map((row) => toSavedTrip(row as TripRow));
}

export async function deleteTripFn(input: { data: { id: string } }): Promise<void> {
  const actor = await requireUser();
  const id = z.string().min(1).parse(input.data.id);
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("voltia_trips").delete().eq("id", id).eq("owner_id", actor.id);
  if (error) throw new Error(`No se pudo borrar el viaje: ${error.message}`);
}

function randomShareId(): string {
  // 10 caracteres base36 — corto para un link, con suficiente espacio para
  // que adivinar uno ajeno no sea práctico (36^10 ≈ 3.7 × 10^15).
  return Array.from({ length: 10 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}

/** Activa (o reutiliza) el link público de un viaje del usuario con sesión. */
export async function shareTripFn(input: { data: { id: string } }): Promise<{ shareId: string }> {
  const actor = await requireUser();
  const id = z.string().min(1).parse(input.data.id);
  const supabase = await createServerSupabase();

  const { data: existing, error: readError } = await supabase
    .from("voltia_trips")
    .select("share_id")
    .eq("id", id)
    .eq("owner_id", actor.id)
    .single();
  if (readError || !existing) throw new Error("No se encontró ese viaje.");
  if (existing.share_id) return { shareId: existing.share_id as string };

  const shareId = randomShareId();
  const { error } = await supabase
    .from("voltia_trips")
    .update({ shared: true, share_id: shareId })
    .eq("id", id)
    .eq("owner_id", actor.id);
  if (error) throw new Error(`No se pudo compartir el viaje: ${error.message}`);
  return { shareId };
}

/**
 * Lectura pública de un viaje compartido — SIN requireUser(): un visitante
 * sin sesión debe poder abrir el link. El RLS de 0006_share_trips.sql es lo
 * que de verdad limita esto a filas con shared = true; este cliente usa la
 * cookie de sesión si existe, o la del rol anon si no hay ninguna.
 */
export async function getSharedTripFn(input: { data: { shareId: string } }): Promise<SavedTrip | null> {
  const shareId = z.string().min(1).parse(input.data.shareId);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("voltia_trips")
    .select("id, payload, shared, share_id, created_at")
    .eq("share_id", shareId)
    .eq("shared", true)
    .maybeSingle();
  if (error || !data) return null;
  return toSavedTrip(data as TripRow);
}
