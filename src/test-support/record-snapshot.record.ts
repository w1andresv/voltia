/**
 * Graba la cassette de Piedecuesta → Vélez: respuestas crudas de Mapbox y
 * Open-Meteo y las estaciones del corredor. Uso: `npm run snapshot:record`.
 *
 * Necesita Node ≥ 20.12, red hacia api.mapbox.com y api.open-meteo.com y
 * MAPBOX_ACCESS_TOKEN en .env.local. Las electrolineras salen de:
 *  - la base (DATABASE_URL), solo lectura de station_dataset; o
 *  - la API pública de la app, sin tocar la base:
 *      STATIONS_URL=https://<tu-app>/api/stations npm run snapshot:record
 *    (o http://localhost:3000/api/stations con `npm run dev` corriendo).
 * No corre con `npm test` (vitest.record.config.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { expect, it, vi } from "vitest";
import type { StationDataset } from "@/domain/stations/model";
import {
  assertNoSecrets,
  CASSETTE_SCHEMA_VERSION,
  recordingFetch,
  type Cassette,
  type CassetteInteraction,
} from "./cassette";
import { PIEDECUESTA_VELEZ, sanitizeStation } from "./scenarios";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

/** El mensaje sin la URL ni la contraseña de la base. */
function scrub(message: string): string {
  let out = message;
  for (const secret of [process.env.DATABASE_URL, dbPassword(process.env.DATABASE_URL)]) {
    if (secret) out = out.split(secret).join("***");
  }
  return out;
}

async function stationsFromUrl(url: string): Promise<StationDataset> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new Error(`No se pudo conectar a STATIONS_URL (${url}): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error(`STATIONS_URL respondió HTTP ${res.status} (${url}).`);
  const body = (await res.json()) as Partial<StationDataset>;
  if (!Array.isArray(body.stations) || !body.version) throw new Error(`STATIONS_URL no devolvió un dataset (${url}).`);
  return {
    version: body.version,
    generatedAt: body.generatedAt ?? "",
    sources: body.sources ?? [],
    stats: body.stats ?? { raw: 0, valid: 0, stations: 0, merged: 0, eligible: 0 },
    // La API pública no trae attributes ni conflicts; la cassette tampoco los guarda.
    stations: body.stations.map((st) => ({ ...st, attributes: {}, conflicts: [] })),
  };
}

async function stationsFromDb(): Promise<StationDataset> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "Falta DATABASE_URL en .env.local. Sin base, usa la API de la app: STATIONS_URL=https://<tu-app>/api/stations npm run snapshot:record",
    );
  }
  const { getSql } = await import("@/infrastructure/db");
  try {
    const sql = await getSql();
    const rows = await sql.query<{ version: string; dataset: unknown }>(
      "select version, dataset from station_dataset where id = 'current'",
    );
    const raw = rows[0]?.dataset;
    const dataset = (typeof raw === "string" ? JSON.parse(raw) : raw) as StationDataset | undefined;
    if (!dataset?.stations) throw new Error("la tabla station_dataset no tiene la fila 'current'");
    return dataset;
  } catch (e) {
    throw new Error(
      `No se pudo leer las electrolineras de la base: ${scrub(e instanceof Error ? e.message : String(e))}. ` +
        "Revisa DATABASE_URL (en local suele servir el puerto 5432 o DIRECT_URL) o usa STATIONS_URL.",
    );
  }
}

function dbPassword(url: string | undefined): string | undefined {
  try {
    return url ? decodeURIComponent(new URL(url).password) || undefined : undefined;
  } catch {
    return undefined;
  }
}

it(
  "graba la cassette de Piedecuesta → Vélez",
  async () => {
    if (typeof (process as { loadEnvFile?: unknown }).loadEnvFile !== "function") {
      throw new Error(`Node ${process.versions.node}: se necesita Node 20.12 o más nuevo para leer .env.local.`);
    }
    await import("../../scripts/load-env.mjs");
    if (!process.env.MAPBOX_ACCESS_TOKEN && !process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
      throw new Error("Falta MAPBOX_ACCESS_TOKEN en .env.local: sin él la ruta sale de OSRM y no es el caso de prueba.");
    }

    // Las electrolineras se leen ANTES de grabar: no son respuestas de proveedores.
    const stationsUrl = process.env.STATIONS_URL?.trim();
    const stored = stationsUrl ? await stationsFromUrl(stationsUrl) : await stationsFromDb();
    console.log(`[snapshot] ${stored.stations.length} electrolineras (dataset ${stored.version}) desde ${stationsUrl ? "STATIONS_URL" : "la base"}`);

    const interactions: CassetteInteraction[] = [];
    vi.stubGlobal("fetch", recordingFetch(globalThis.fetch, interactions));

    const { createPlanningService } = await import("@/application/container");
    const { OpenMeteoElevationProvider } = await import("@/infrastructure/providers/adapters");
    const { stationsNearRoutes } = await import("@/domain/ev/engines/corridor/engine");
    const { MAX_FROM_ROUTE_KM } = await import("@/domain/planner");

    let result;
    try {
      result = await createPlanningService({
        stations: { getDataset: async () => stored },
        // La cassette graba siempre lo mismo, diga lo que diga .env.local:
        // elevación de Open-Meteo con la estrategia fija y el planificador actual.
        elevation: new OpenMeteoElevationProvider(),
        elevationSampling: "fixed",
        elevationFallback: undefined,
        engineMode: "legacy",
      }).plan(PIEDECUESTA_VELEZ.request());
    } finally {
      vi.unstubAllGlobals();
    }
    const { response, engine } = result;
    expect(engine).not.toBe("osrm");
    const corridor = stationsNearRoutes(
      stored.stations,
      response.geo.routes.map((r) => r.samples),
      MAX_FROM_ROUTE_KM,
    ).map(sanitizeStation);

    const cassette: Cassette = {
      schemaVersion: CASSETTE_SCHEMA_VERSION,
      scenario: PIEDECUESTA_VELEZ.id,
      recordedAt: new Date().toISOString(),
      interactions,
      stationsVersion: stored.version,
      stations: corridor,
    };
    const json = `${JSON.stringify(cassette, null, 1)}\n`;
    assertNoSecrets(json, [
      process.env.MAPBOX_ACCESS_TOKEN,
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
      process.env.SIVEEIC_TOKEN,
      process.env.PLUGSHARE_TOKEN,
      process.env.SUPABASE_SECRET_KEY,
      process.env.CRON_SECRET,
      process.env.DATABASE_URL,
      dbPassword(process.env.DATABASE_URL),
    ]);

    const file = fileURLToPath(PIEDECUESTA_VELEZ.cassette);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, json);
    console.log(
      `[snapshot] ${file}\n  motor ${engine}, ${response.geo.routes.length} rutas, ` +
        `${interactions.length} respuestas, ${corridor.length} estaciones (dataset ${stored.version}), ` +
        `${(json.length / 1024).toFixed(0)} KB`,
    );
  },
  180_000,
);
