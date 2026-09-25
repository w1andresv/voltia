#!/usr/bin/env node
/**
 * Aplica los archivos de ../seeds a DATABASE_URL. A diferencia de las
 * migraciones, los seeds NO se registran: cada archivo es rerunnable (upsert
 * por id) y debe poder volver a correrse cuando se corrige un dato.
 * Run with `npm run db:seed`. Cada archivo va en una transacción.
 */
import "./load-env.mjs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.log("[seed] DATABASE_URL not set — skipping.");
  process.exit(0);
}

const seedsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "seeds");

async function main() {
  const files = (await readdir(seedsDir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("[seed] no seeds — nothing to do.");
    return;
  }
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: databaseUrl.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();
  try {
    for (const name of files) {
      const text = await readFile(join(seedsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(text);
        await client.query("COMMIT");
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK falla si la conexión murió: se conserva el error original.
        }
        console.error(`[seed] error applying ${name}`);
        throw err;
      }
      console.log(`[seed] applied ${name}`);
    }
    const { rows } = await client.query(
      "select count(*)::int as n from public.voltia_vehicles where owner_id is null",
    );
    console.log(`[seed] catálogo: ${rows[0].n} vehículos.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed] failed:", err?.message || err);
  process.exit(1);
});
