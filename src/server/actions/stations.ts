"use server";

import { z } from "zod";
import type { Charger, StationStatus } from "@/domain/types";
import { requireMember, requireAdmin } from "@/infrastructure/auth/server-actor";
import { checkRateLimit } from "@/infrastructure/rate-limit";

const ConnectorSchema = z.enum(["ccs2", "ccs1", "type2", "chademo", "nacs", "gb_t"]);

const SocketSchema = z.object({
  connector: ConnectorSchema,
  powerKw: z.number().min(1).max(500),
  count: z.number().int().min(1).max(40),
});

const StationInput = z.object({
  name: z.string().trim().min(3).max(120),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  address: z.string().trim().max(200).optional(),
  operator: z.string().trim().max(80).optional(),
  sockets: z.array(SocketSchema).min(1).max(8),
  openingHours: z.string().trim().max(80).optional(),
  pricePerKwh: z.number().min(0).max(50_000).nullable().optional(),
  priceCurrency: z.string().trim().max(8).optional(),
  notes: z.string().trim().max(600).optional(),
  // Rutas del bucket "station-photos" (p. ej. "<user id>/<uuid>.jpg"), no el
  // contenido de la imagen: la fase 1 mueve las fotos a Supabase Storage.
  photos: z.array(z.string().trim().min(1).max(300)).max(2).optional(),
  availability: z.enum(["unknown", "available", "occupied", "offline"]).optional(),
});

const ReviewInput = z.object({
  id: z.string().min(1),
  status: z.enum(["approved", "rejected", "pending"]),
  reviewNote: z.string().trim().max(300).optional(),
});

/**
 * Public: only `approved` stations. Anything else (`pending`, `rejected`,
 * `all`) is the moderation queue and requires an admin — otherwise anyone
 * could read unreviewed submissions (notes, photos) before they're public.
 */
export async function listStationsFn(input?: { data?: { status?: StationStatus | "all" } }): Promise<Charger[]> {
  const requested = input?.data?.status ?? "approved";
  const { loadCommunityChargers } = await import("./stations-db");
  if (requested === "approved") {
    return loadCommunityChargers("approved");
  }
  await requireAdmin();
  return loadCommunityChargers(requested);
}

export async function createStationFn(input: { data: unknown }): Promise<Charger> {
  const actor = await requireMember();
  // 10 aportes/10 min por cuenta: ya requiere sesión, pero evita el spam de
  // una cuenta comprometida o un bot que sí logró autenticarse.
  await checkRateLimit("create-station", actor.id as string, 10, 600);
  const data = StationInput.parse(input.data);
  const { insertStation } = await import("./stations-db");
  // actor.id is always set here: requireMember() only returns past "guest".
  return insertStation(data, actor.id as string);
}

/** Admin, or the original author while the station is still `pending`. */
export async function updateStationFn(input: { data: unknown }): Promise<Charger> {
  const actor = await requireMember();
  const data = StationInput.extend({ id: z.string().min(1) }).parse(input.data);
  const { id, ...rest } = data;
  const { patchStation, getStationOwnership } = await import("./stations-db");

  if (actor.role !== "admin") {
    const existing = await getStationOwnership(id);
    const isAuthor = existing?.createdBy != null && existing.createdBy === actor.id;
    if (!existing || !isAuthor || existing.status !== "pending") {
      throw new Error("No autorizado.");
    }
  }

  return patchStation(id, rest);
}

export async function reviewStationFn(input: { data: unknown }): Promise<Charger> {
  const actor = await requireAdmin();
  const data = ReviewInput.parse(input.data);
  const { setStationStatus } = await import("./stations-db");
  return setStationStatus(data.id, data.status, data.reviewNote, actor.id as string);
}
