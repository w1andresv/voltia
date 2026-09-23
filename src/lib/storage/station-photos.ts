"use client";

import { getBrowserSupabase } from "@/infrastructure/supabase/browser";

const BUCKET = "station-photos";

/**
 * Public URL for a photo stored in the bucket. Accepts both the new form
 * (a storage path like "<user id>/<uuid>.jpg") and the old one (a
 * data: URL saved directly in Postgres, before this bucket existed) so
 * stations created before this migration keep rendering until
 * scripts/migrate-photos.mjs backfills them.
 */
export function stationPhotoUrl(value: string): string {
  if (/^(https?:|data:|blob:)/.test(value)) return value;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return value;
  return `${base}/storage/v1/object/public/${BUCKET}/${value}`;
}

/**
 * Uploads a compressed photo under the signed-in user's own folder and
 * returns its storage PATH (not a URL — see stationPhotoUrl above). Needs
 * the "station-photos" bucket to exist (public read, ≤1 MB per file,
 * authenticated write) — create it once in the Supabase dashboard, see
 * the Fase 1 del plan doc.
 */
export async function uploadStationPhoto(blob: Blob, ownerId: string): Promise<string> {
  const supabase = getBrowserSupabase();
  if (!supabase) throw new Error("Supabase no está configurado");
  const path = `${ownerId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  return path;
}
