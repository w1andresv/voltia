/**
 * Regresión (2026-09-27): con el motor v2, las estaciones de Blaze deben servir
 * para calcular las paradas. Pasa las estaciones sintéticas por el traductor de
 * Blaze (como llegan de la API) y planifica con los proveedores sintéticos.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StationDataset } from "@/domain/stations/model";
import { toPlanningCharger } from "@/domain/stations/to-charger";
import { isVerifiedForPlanning, type PlanRequest } from "@/domain/types";
import { toConsolidatedStation } from "@/infrastructure/blaze/mappers";
import { BlazeStationSchema } from "@/infrastructure/blaze/schemas";
import { catalogVehicle } from "./scenarios";
import {
  SYNTHETIC_A,
  SYNTHETIC_B,
  SYNTHETIC_TOKEN,
  syntheticFetch,
  syntheticStations,
} from "./synthetic-providers";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

const AT = "2026-09-27T12:00:00.000Z";

/** Las mismas ubicaciones y potencias que las sintéticas, con la forma de la API de Blaze. */
function blazeDataset(opts: { dcOffline?: boolean } = {}): StationDataset {
  const base = syntheticStations();
  const stations = base.stations.map((s, i) => {
    const c = s.connectors[0]!;
    const label = c.standard === "type2" ? "Tipo 2" : c.standard === "gb_t" ? "GB/T" : "CCS2, Tipo 2";
    // M4.1: el detalle trae el estado de cada cargador; aquí la carga rápida está apagada.
    const chargers =
      opts.dcOffline && label === "CCS2, Tipo 2"
        ? [
            { connectorType: "CCS2", powerKw: c.powerKw, status: "fuera_servicio" },
            { connectorType: "Tipo 2", powerKw: 22, status: "en_servicio" },
          ]
        : undefined;
    return toConsolidatedStation(
      BlazeStationSchema.parse({
        ...(chargers ? { chargers } : {}),
        id: 100 + i,
        name: `EDS ${s.id}`,
        city: "Santander",
        status: "en_servicio",
        verified: true,
        operator: "Blaze Charge",
        lat: s.lat,
        lon: s.lon,
        connectors: label,
        maxKw: c.powerKw,
        chargersCount: 2,
      }),
      AT,
    )!;
  });
  return { ...base, version: "blaze-test", stations };
}

function request(initialSoc: number): PlanRequest {
  return {
    origin: { label: "Piedecuesta", ...SYNTHETIC_A },
    destination: { label: "Vélez", ...SYNTHETIC_B },
    waypoints: [],
    vehicle: catalogVehicle("mg-s5-ev-comfort"),
    conditions: {
      passengers: 1,
      luggageKg: 30,
      initialSoc,
      avgSpeedKmh: null,
      ac: "normal",
      temperatureC: null,
      drivingStyle: "normal",
      safetyMode: "low",
      customSafetyPct: 10,
      planningMode: "fastest",
      allowBelowSafety: false,
      regenLevel: "medium",
    },
  };
}

describe("motor v2 con estaciones de Blaze", () => {
  beforeAll(() => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", SYNTHETIC_TOKEN);
    vi.stubGlobal("fetch", syntheticFetch());
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("una estación de Blaze elegible cuenta como verificada para planificar", () => {
    const station = blazeDataset().stations[0]!;
    expect(station.planning.eligible).toBe(true);
    expect(isVerifiedForPlanning(toPlanningCharger(station))).toBe(true);
  });

  it("con poca batería, el plan para en una estación de Blaze y llega con carga", async () => {
    const { createPlanningService } = await import("@/application/container");
    const { response } = await createPlanningService({
      stations: { getDataset: async () => blazeDataset() },
      stationSource: "blaze",
      engineMode: "v2",
      energyMode: "v2",
      clock: () => new Date(AT),
    }).plan(request(35));
    const plan = response.plans[0]!;
    expect(plan.feasible).toBe(true);
    expect(plan.stops.length).toBeGreaterThan(0);
    expect(plan.stops.every((s) => s.charger.source === "blaze")).toBe(true);
    expect(plan.arrivalSoc).toBeGreaterThan(0);
    expect(plan.minSoc).toBeGreaterThan(0);
  });
});

describe("M4.1: carga rápida apagada en el detalle de Blaze", () => {
  beforeAll(() => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", SYNTHETIC_TOKEN);
    vi.stubGlobal("fetch", syntheticFetch());
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function plan(dataset: StationDataset) {
    const { createPlanningService } = await import("@/application/container");
    const { response } = await createPlanningService({
      stations: { getDataset: async () => dataset },
      stationSource: "blaze",
      engineMode: "v2",
      energyMode: "v2",
      clock: () => new Date(AT),
    }).plan(request(35));
    return response.plans[0]!;
  }

  it("con la carga rápida funcionando, el plan para a cargar rápido", async () => {
    const p = await plan(blazeDataset());
    expect(p.stops.length).toBeGreaterThan(0);
    expect(p.stops.some((s) => s.chargeKw > 22)).toBe(true);
  });

  it("con la carga rápida apagada, el plan no carga en ella: usa la alterna que sí funciona", async () => {
    const p = await plan(blazeDataset({ dcOffline: true }));
    expect(p.stops.length).toBeGreaterThan(0);
    // Ninguna parada se calcula con la potencia de un conector apagado.
    expect(p.stops.every((s) => s.chargeKw <= 22)).toBe(true);
    expect(p.stops.every((s) => s.charger.sockets.every((k) => k.connector !== "ccs2"))).toBe(true);
  });
});

describe("isVerifiedForPlanning", () => {
  it("una fuente desconocida (p. ej. de un snapshot viejo) no sirve para planificar", () => {
    const station = toPlanningCharger(blazeDataset().stations[0]!);
    expect(isVerifiedForPlanning({ ...station, source: "ocm" as never })).toBe(false);
  });
});
