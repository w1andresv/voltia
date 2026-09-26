/**
 * Informe de la especificación §8.5 en Markdown.
 *
 *   npm run report                      → ruta sintética, sin red
 *   REAL=1 npm run report               → Piedecuesta → Vélez con Mapbox real
 *   REAL=1 ORIGIN=lat,lon DESTINATION=lat,lon STATIONS_URL=https://<app>/api/stations npm run report
 *
 * Con REAL=1 necesita MAPBOX_ACCESS_TOKEN en .env.local y red; las
 * electrolineras salen de STATIONS_URL (si no, el plan va sin estaciones). No
 * lee la base. Usa el planificador y la energía v2 salvo que PLANNER_ENGINE o
 * ENERGY_ENGINE digan otra cosa. Escribe en docs/arquitectura-ev/informes/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import type { StationDataset } from "@/domain/stations/model";
import type { Place, PlanRequest } from "@/domain/types";
import { PIEDECUESTA_VELEZ } from "./scenarios";
import {
  SYNTHETIC_A,
  SYNTHETIC_B,
  SYNTHETIC_TOKEN,
  syntheticFetch,
  syntheticStations,
} from "./synthetic-providers";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

function place(env: string | undefined, fallback: Place): Place {
  if (!env) return fallback;
  const [lat, lon] = env.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    throw new Error(`Coordenadas inválidas: ${env}`);
  return { label: env, lat: lat!, lon: lon! };
}

async function stationsFrom(url: string | undefined): Promise<StationDataset> {
  if (!url) {
    return {
      version: "sin-estaciones",
      generatedAt: "",
      stations: [],
      sources: [],
      stats: { raw: 0, valid: 0, stations: 0, merged: 0, eligible: 0 },
    };
  }
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`STATIONS_URL respondió HTTP ${res.status}`);
  const body = (await res.json()) as StationDataset;
  return { ...body, stations: body.stations.map((s) => ({ ...s, attributes: {}, conflicts: [] })) };
}

it("genera el informe del plan (§8.5)", async () => {
  const real = process.env.REAL === "1";
  const base = PIEDECUESTA_VELEZ.request();
  let req: PlanRequest;
  let stations: StationDataset;
  if (real) {
    await import("../../scripts/load-env.mjs");
    req = {
      ...base,
      origin: place(process.env.ORIGIN, base.origin),
      destination: place(process.env.DESTINATION, base.destination),
    };
    stations = await stationsFrom(process.env.STATIONS_URL?.trim());
  } else {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", SYNTHETIC_TOKEN);
    vi.stubGlobal("fetch", syntheticFetch());
    req = {
      ...base,
      origin: { label: "Piedecuesta (sintético)", ...SYNTHETIC_A },
      destination: { label: "Vélez (sintético)", ...SYNTHETIC_B },
    };
    stations = syntheticStations();
  }

  const { createPlanningService } = await import("@/application/container");
  const { buildPlanReport } = await import("@/application/plan-trip/plan-report");
  const { MODEL_PARAMETERS } = await import("@/domain/ev/core/params");
  const mode = (v: string | undefined) =>
    (v === "legacy" || v === "shadow" ? "legacy" : "v2") as "legacy" | "v2";
  const { response } = await createPlanningService({
    stations: { getDataset: async () => stations },
    engineMode: mode(process.env.PLANNER_ENGINE),
    energyMode: mode(process.env.ENERGY_ENGINE),
    ...(real ? {} : { clock: () => new Date("2026-09-01T12:00:00Z") }),
  }).plan(req);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();

  const plan = response.plans.find((p) => p.id === response.selectedId) ?? response.plans[0];
  expect(plan).toBeDefined();
  const md = buildPlanReport({
    title: real ? "Informe del plan (proveedores reales)" : "Informe del plan (ruta sintética)",
    request: req,
    geo: response.geo,
    plan: plan!,
    route: response.geo.routes.find((r) => r.id === plan!.id),
    params: MODEL_PARAMETERS,
  });
  const name = real
    ? `informe-real-${new Date().toISOString().slice(0, 10)}.md`
    : "informe-sintetico.md";
  const dir = fileURLToPath(new URL("../../docs/arquitectura-ev/informes/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}${name}`, `${md}\n`);
  console.log(`[informe] ${dir}${name}`);
}, 300_000);
