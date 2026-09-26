import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StationDataset } from "@/domain/stations/model";
import type { PlanResponse, RoutePlan } from "@/domain/types";
import { replayFetch, UnrecordedRequestError, type Cassette } from "./cassette";
import { PIEDECUESTA_VELEZ } from "./scenarios";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

const TOL = 1e-6;
/** Con forma de token de Mapbox para que la ruta vaya por Mapbox; la reproducción ignora su valor. */
const REPLAY_TOKEN = "pk.replay.token";
const hasCassette = existsSync(PIEDECUESTA_VELEZ.cassette);

function datasetOf(c: Cassette): StationDataset {
  return {
    version: c.stationsVersion,
    generatedAt: c.recordedAt,
    stations: c.stations,
    sources: [],
    stats: { raw: 0, valid: 0, stations: c.stations.length, merged: 0, eligible: 0 },
  };
}

async function planFrom(cassette: Cassette): Promise<PlanResponse> {
  vi.stubGlobal("fetch", replayFetch(cassette.interactions));
  const { runPlanPipeline } = await import("@/server/plan-pipeline");
  const { response } = await runPlanPipeline(PIEDECUESTA_VELEZ.request(), async () => datasetOf(cassette));
  return response;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Resumen estable de un plan para el snapshot de referencia (el redondeo es solo del test). */
function summary(p: RoutePlan) {
  return {
    label: p.label,
    via: p.via,
    feasible: p.feasible,
    distanceKm: r1(p.distanceKm),
    detourKm: r1(p.detourKm),
    energyKwh: r1(p.energyKwh),
    avgKwhPer100km: r1(p.avgKwhPer100km),
    driveMinutes: Math.round(p.driveMinutes),
    chargeMinutes: Math.round(p.chargeMinutes),
    initialSoc: r1(p.initialSoc),
    arrivalSoc: r1(p.arrivalSoc),
    minSoc: r1(p.minSoc),
    stops: p.stops.map((s) => ({
      charger: s.charger.name,
      km: r1(s.kmAlongRoute),
      arriveSoc: r1(s.arriveSoc),
      departSoc: r1(s.departSoc),
      chargeMinutes: Math.round(s.chargeMinutes),
    })),
  };
}

describe("fixture Piedecuesta → Vélez: cableado sin red", () => {
  beforeAll(() => vi.stubEnv("MAPBOX_ACCESS_TOKEN", REPLAY_TOKEN));
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sin grabación, el pipeline falla en la primera petición en vez de usar la red", async () => {
    const empty: Cassette = {
      schemaVersion: 1,
      scenario: PIEDECUESTA_VELEZ.id,
      recordedAt: "2026-01-01T00:00:00.000Z",
      interactions: [],
      stationsVersion: "none",
      stations: [],
    };
    await expect(planFrom(empty)).rejects.toThrow(/api\.mapbox\.com.*fuera de la grabación|fuera de la grabación.*api\.mapbox\.com/);
  });

  it("el vehículo del escenario sale del seed", () => {
    const { vehicle } = PIEDECUESTA_VELEZ.request();
    expect(vehicle.id).toBe("mg-s5-ev-deluxe");
    expect(vehicle.batteryKwh).toBe(47.1);
    expect(vehicle.weightKg).toBe(1672);
  });

  it("UnrecordedRequestError nombra la petición", () => {
    expect(new UnrecordedRequestError("GET https://x").message).toContain("GET https://x");
  });
});

// Se activa al grabar la cassette con `npm run snapshot:record` (ver docs/arquitectura-ev/04-plan-de-trabajo.md).
describe.skipIf(!hasCassette)("fixture Piedecuesta → Vélez: reproducción", () => {
  let cassette: Cassette;
  let first: PlanResponse;

  beforeAll(async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", REPLAY_TOKEN);
    cassette = JSON.parse(readFileSync(PIEDECUESTA_VELEZ.cassette, "utf8")) as Cassette;
    first = await planFrom(cassette);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("usa Mapbox y encuentra rutas por vías principales", () => {
    expect(first.geo.routes.length).toBeGreaterThan(0);
    expect(first.geo.routes.every((r) => r.engine !== "osrm")).toBe(true);
    expect(first.plans.length).toBe(first.geo.routes.length);
  });

  it("es determinista: dos ejecuciones dan lo mismo", async () => {
    const second = await planFrom(cassette);
    expect(second).toEqual(first);
  });

  it("respeta las invariantes del plan", () => {
    for (const p of first.plans) {
      expect(p.energyKwh).toBeGreaterThan(0);
      for (let i = 1; i < p.itinerary.length; i++) {
        expect(p.itinerary[i]!.km).toBeGreaterThanOrEqual(p.itinerary[i - 1]!.km);
      }
      if (!p.feasible) continue;
      expect(p.minSoc).toBeGreaterThanOrEqual(p.safetyPct - TOL);
      expect(p.arrivalSoc).toBeGreaterThanOrEqual(Math.max(10, p.safetyPct) - TOL);
      for (const s of p.stops) {
        expect(s.arriveSoc).toBeGreaterThanOrEqual(0);
        expect(s.departSoc).toBeGreaterThan(s.arriveSoc);
        expect(s.departSoc).toBeLessThanOrEqual(100 + TOL);
      }
    }
  });

  it("coincide con el resultado de referencia", () => {
    expect({
      stationsVersion: first.geo.stationsVersion,
      selectedId: first.selectedId,
      plans: first.plans.map(summary),
    }).toMatchSnapshot();
  });
});
