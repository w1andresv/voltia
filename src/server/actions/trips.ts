"use server";

import { z } from "zod";
import { PlanRequestSchema, TripSummarySchema } from "@/domain/schemas";
import { createPlanningService } from "@/application/container";
import { parsePlanningSnapshot } from "@/domain/ev/contracts/snapshot";
import { recordArrival } from "@/application/calibration/record-arrival";
import type { SavedTrip, TripArrivalSummary } from "@/domain/user/types";
import { requireUser } from "@/infrastructure/auth/server-actor";
import { createServerSupabase } from "@/infrastructure/supabase/server";

export type { SavedTrip };

const PayloadSchema = z.object({
  request: PlanRequestSchema,
  summary: TripSummarySchema,
  /** Se valida aparte: un snapshot inválido o de otra versión no invalida el viaje. */
  snapshot: z.unknown().optional(),
});

interface TripRow {
  id: string;
  payload: unknown;
  shared: boolean;
  share_id: string | null;
  created_at: string;
}

function toSavedTrip(row: TripRow): SavedTrip {
  const payload = PayloadSchema.parse(row.payload);
  const snapshot = parsePlanningSnapshot(payload.snapshot);
  return {
    id: row.id,
    request: payload.request,
    summary: payload.summary,
    ...(snapshot ? { snapshot } : {}),
    shared: row.shared,
    shareId: row.share_id,
    createdAt: row.created_at,
  };
}

const SaveTripInput = z.object({
  request: PlanRequestSchema,
  summary: TripSummarySchema,
  snapshot: z.unknown().optional(),
  /** Clave de idempotencia (uuid): un reintento con el mismo clientId no duplica. */
  clientId: z.string().uuid().optional(),
});

/**
 * Guarda un viaje planeado del usuario con sesión: la petición (PlanRequest),
 * un resumen y, si viene y es válido, el PlanningSnapshot con que se calculó.
 * Con el snapshot, abrir o compartir el viaje recalcula el plan sin consultar
 * proveedores (ver /v/[shareId]); sin él, se recalcula con datos de hoy.
 */
export async function saveTripFn(input: { data: unknown }): Promise<SavedTrip> {
  const actor = await requireUser();
  const { clientId, snapshot: rawSnapshot, ...rest } = SaveTripInput.parse(input.data);
  const snapshot = parsePlanningSnapshot(rawSnapshot);
  const data = snapshot ? { ...rest, snapshot } : rest;
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
  if (error || !row)
    throw new Error(`No se pudo guardar el viaje: ${error?.message ?? "sin fila"}`);
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
  const observations = await arrivalSummaries(supabase, actor.id);
  return (data ?? []).map((row) => {
    const trip = toSavedTrip(row as TripRow);
    const obs = observations.get(trip.id);
    return obs ? { ...trip, observation: obs } : trip;
  });
}

const ObservationRowSchema = z.object({
  trip_id: z.string(),
  updated_at: z.string(),
  comparison: z.object({
    socErrors: z
      .array(z.object({ predicted: z.number(), observed: z.number(), error: z.number() }))
      .min(1),
    consumptionRatio: z.number().optional(),
  }),
});

/**
 * Lo que el usuario registró de cada viaje (D13). Si la tabla aún no existe
 * (migración 0014 sin aplicar) o la consulta falla, el historial se muestra igual.
 */
async function arrivalSummaries(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  ownerId: string | null,
): Promise<Map<string, TripArrivalSummary>> {
  const out = new Map<string, TripArrivalSummary>();
  if (!ownerId) return out;
  try {
    const { data, error } = await supabase
      .from("voltia_trip_observations")
      .select("trip_id, comparison, updated_at")
      .eq("owner_id", ownerId);
    if (error || !data) return out;
    for (const row of data as unknown[]) {
      const parsed = ObservationRowSchema.safeParse(row);
      if (!parsed.success) continue;
      const last = parsed.data.comparison.socErrors[parsed.data.comparison.socErrors.length - 1]!;
      out.set(parsed.data.trip_id, {
        arrivalSoc: last.observed,
        predictedArrivalSoc: last.predicted,
        errorPct: last.error,
        ...(parsed.data.comparison.consumptionRatio != null
          ? { consumptionRatio: parsed.data.comparison.consumptionRatio }
          : {}),
        recordedAt: parsed.data.updated_at,
      });
    }
  } catch {
    // sin observaciones
  }
  return out;
}

const ArrivalInputSchema = z.object({
  tripId: z.string().min(1),
  arrivalSoc: z.number().min(0).max(100),
  departureSoc: z.number().min(0).max(100).optional(),
  energyKwh: z.number().positive().max(500).optional(),
  points: z
    .array(z.object({ distanceKm: z.number().min(0), socPercent: z.number().min(0).max(100) }))
    .max(20)
    .optional(),
});

/**
 * "¿Con cuánto llegaste?" (D13): guarda lo que el usuario observó al terminar
 * un viaje de su cuenta y lo compara con el plan del viaje. Una observación
 * por viaje: registrarla otra vez la reemplaza.
 */
export async function recordArrivalFn(input: { data: unknown }): Promise<TripArrivalSummary> {
  const actor = await requireUser();
  const { tripId, ...arrival } = ArrivalInputSchema.parse(input.data);
  const supabase = await createServerSupabase();
  const { data: row, error: readError } = await supabase
    .from("voltia_trips")
    .select("id, payload, shared, share_id, created_at")
    .eq("id", tripId)
    .eq("owner_id", actor.id)
    .single();
  if (readError || !row) throw new Error("No se encontró ese viaje.");
  const trip = toSavedTrip(row as TripRow);
  const { observation, comparison, predictedArrivalSoc } = recordArrival(trip, arrival);
  const now = new Date().toISOString();
  const { error } = await supabase.from("voltia_trip_observations").upsert(
    {
      trip_id: trip.id,
      owner_id: actor.id,
      payload: observation,
      comparison,
      model_version: observation.modelVersion,
      updated_at: now,
    },
    { onConflict: "trip_id" },
  );
  if (error) throw new Error(`No se pudo guardar cómo llegaste: ${error.message}`);
  const last = comparison.socErrors[comparison.socErrors.length - 1]!;
  return {
    arrivalSoc: last.observed,
    predictedArrivalSoc,
    errorPct: last.error,
    ...(comparison.consumptionRatio != null
      ? { consumptionRatio: comparison.consumptionRatio }
      : {}),
    recordedAt: now,
  };
}

export async function deleteTripFn(input: { data: { id: string } }): Promise<void> {
  const actor = await requireUser();
  const id = z.string().min(1).parse(input.data.id);
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("voltia_trips")
    .delete()
    .eq("id", id)
    .eq("owner_id", actor.id);
  if (error) throw new Error(`No se pudo borrar el viaje: ${error.message}`);
}

function randomShareId(): string {
  // 10 caracteres base36 — corto para un link, con suficiente espacio para
  // que adivinar uno ajeno no sea práctico (36^10 ≈ 3.7 × 10^15).
  return Array.from({ length: 10 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}

/** Tiempo máximo de la verificación al compartir: después de esto se comparte sin verificar. */
const SHARE_VERIFY_TIMEOUT_MS = 8000;

/**
 * Pasada 2 al compartir (D6): si el viaje trae snapshot y todavía no está
 * verificado, verifica el plan recomendado contra la ruta real y devuelve el
 * payload con la verificación. null si no aplica, falla o tarda demasiado:
 * compartir nunca se bloquea por esto.
 */
async function verifiedPayload(payload: unknown): Promise<Record<string, unknown> | null> {
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const snapshot = parsePlanningSnapshot(parsed.data.snapshot);
  if (!snapshot || snapshot.verifiedRoutes) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verified = await Promise.race([
      createPlanningService().verifySnapshot(snapshot, parsed.data.request),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SHARE_VERIFY_TIMEOUT_MS);
      }),
    ]);
    if (!verified) return null;
    return { ...parsed.data, snapshot: { ...snapshot, verifiedRoutes: verified } };
  } catch (error) {
    console.error(
      "[share] no se pudo verificar el viaje:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Activa (o reutiliza) el link público de un viaje del usuario con sesión, verificando el plan (D6). */
export async function shareTripFn(input: { data: { id: string } }): Promise<{ shareId: string }> {
  const actor = await requireUser();
  const id = z.string().min(1).parse(input.data.id);
  const supabase = await createServerSupabase();

  const { data: existing, error: readError } = await supabase
    .from("voltia_trips")
    .select("share_id, payload")
    .eq("id", id)
    .eq("owner_id", actor.id)
    .single();
  if (readError || !existing) throw new Error("No se encontró ese viaje.");

  const payload = await verifiedPayload((existing as { payload?: unknown }).payload);
  const shareId = (existing.share_id as string | null) ?? randomShareId();
  if (existing.share_id && !payload) return { shareId };

  const { error } = await supabase
    .from("voltia_trips")
    .update({ shared: true, share_id: shareId, ...(payload ? { payload } : {}) })
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
export async function getSharedTripFn(input: {
  data: { shareId: string };
}): Promise<SavedTrip | null> {
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
