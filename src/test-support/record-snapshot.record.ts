/**
 * Graba la cassette de Piedecuesta → Vélez: respuestas crudas de Mapbox y
 * Open-Meteo y las estaciones del corredor. Uso: `npm run snapshot:record`.
 *
 * Necesita red hacia api.mapbox.com y api.open-meteo.com, MAPBOX_ACCESS_TOKEN y
 * DATABASE_URL en .env.local. Solo LEE la base (getStoredDataset): no dispara
 * el refresco del dataset. No corre con `npm test` (vitest.record.config.ts).
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
    await import("../../scripts/load-env.mjs");
    if (!process.env.MAPBOX_ACCESS_TOKEN && !process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
      throw new Error("Falta MAPBOX_ACCESS_TOKEN: sin él la ruta sale de OSRM y no es el caso de prueba.");
    }

    const interactions: CassetteInteraction[] = [];
    vi.stubGlobal("fetch", recordingFetch(globalThis.fetch, interactions));

    const { createPlanningService } = await import("@/application/container");
    const { getStoredDataset } = await import("@/infrastructure/stations/store");
    const { findStationsNearRoute } = await import("@/domain/stations/spatial");
    const { MAX_FROM_ROUTE_KM } = await import("@/domain/planner");

    let dataset: StationDataset | null = null;
    const { response, engine } = await createPlanningService({
      stations: {
        getDataset: async () => {
          dataset = await getStoredDataset();
          if (!dataset) throw new Error("No hay dataset de electrolineras guardado en la base.");
          return dataset;
        },
      },
    }).plan(PIEDECUESTA_VELEZ.request());
    vi.unstubAllGlobals();
    expect(engine).not.toBe("osrm");

    const stored = dataset as StationDataset | null;
    if (!stored) throw new Error("No se cargó el dataset de electrolineras.");
    const corridor = findStationsNearRoute(
      stored.stations,
      response.geo.routes.flatMap((r) => r.samples),
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
