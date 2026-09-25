#!/usr/bin/env node
/**
 * One-off: moves electrolineras.photos from base64 data URLs (stored
 * directly in Postgres, pre-Fase-1) to Supabase Storage, rewriting the
 * column to hold storage paths instead.
 *
 * Requires the "station-photos" bucket to already exist (create it once in
 * the Supabase dashboard: public read, ≤1 MB/file, authenticated write —
 * see Fase 1 del plan). Needs DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SECRET_KEY (service role — bypasses bucket policies, only ever
 * used here, never shipped to the app).
 *
 * Never run in this session: the sandbox this ran in has no network route
 * to *.supabase.co, so this script is written against the documented
 * @supabase/supabase-js Storage API but has not been executed against a
 * real project. Run `node scripts/migrate-photos.mjs --dry-run` first.
 *
 * Row-safe: a row's `photos` column is only overwritten after every photo
 * in that row uploaded successfully. A row that fails to upload is logged
 * and left untouched — safe to re-run.
 */
import "./load-env.mjs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!databaseUrl || !supabaseUrl || !serviceKey) {
  console.error(
    "[migrate-photos] Necesita DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY en el entorno.",
  );
  process.exit(1);
}

const BUCKET = "station-photos";
const DATA_URL_RE = /^data:(image\/[\w.+-]+);base64,(.+)$/s;

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

async function uploadOne(stationId, index, dataUrl) {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null; // ya es una ruta del bucket (o algo inesperado): se deja igual
  const [, contentType, base64] = match;
  const ext = contentType.split("/")[1]?.split("+")[0] || "jpg";
  const path = `legacy/${stationId}-${index}.${ext}`;
  const bytes = Buffer.from(base64, "base64");

  if (dryRun) {
    console.log(`[migrate-photos]   (dry-run) subiría ${path} (${bytes.length} bytes)`);
    return path;
  }

  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`subida de ${path} falló: ${error.message}`);
  return path;
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `select id, photos from electrolineras where photos is not null and jsonb_array_length(photos) > 0`,
    );
    console.log(`[migrate-photos] ${rows.length} estación(es) con fotos.`);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      const photos = Array.isArray(row.photos) ? row.photos : [];
      const needsWork = photos.some((p) => typeof p === "string" && DATA_URL_RE.test(p));
      if (!needsWork) {
        skipped += 1;
        continue;
      }

      try {
        const nextPhotos = [];
        for (let i = 0; i < photos.length; i += 1) {
          const value = photos[i];
          if (typeof value !== "string") continue;
          const path = await uploadOne(row.id, i, value);
          nextPhotos.push(path ?? value);
        }

        if (!dryRun) {
          await client.query("update electrolineras set photos = $2::jsonb where id = $1", [
            row.id,
            JSON.stringify(nextPhotos),
          ]);
        }
        console.log(`[migrate-photos] ${row.id}: ${nextPhotos.length} foto(s) migradas.`);
        migrated += 1;
      } catch (err) {
        failed += 1;
        console.error(`[migrate-photos] ${row.id}: ${err.message} — se deja sin cambios.`);
      }
    }

    console.log(
      `[migrate-photos] listo${dryRun ? " (dry-run, nada se escribió)" : ""}: ${migrated} migradas, ${skipped} ya estaban al día, ${failed} con error.`,
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate-photos] falló:", err?.message || err);
  process.exit(1);
});
