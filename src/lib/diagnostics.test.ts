import { describe, expect, it } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import type { GeoBundle, RoutePlan, TripConditions } from "@/domain/types";
import { diagnosticLines } from "./diagnostics";

const conditions: TripConditions = {
  passengers: 1,
  luggageKg: 30,
  initialSoc: 80,
  arrivalSoc: 10,
  avgSpeedKmh: null,
  ac: "normal",
  temperatureC: null,
  drivingStyle: "normal",
  safetyMode: "low",
  customSafetyPct: 10,
  planningMode: "fastest",
  allowBelowSafety: false,
  regenLevel: "medium",
};

describe("diagnosticLines", () => {
  it("versión, configuración, plan en pantalla y preferencias de este navegador", () => {
    const geo = {
      routes: [],
      chargers: [{}, {}],
      weather: null,
      warnings: [],
      stationsVersion: "blaze-abc",
      plannerEngine: "v2",
      energyEngine: "v2",
      createdAt: "2026-09-28T10:00:00Z",
      providers: {
        routing: "mapbox",
        elevation: "mapbox-terrain/mesh",
        weather: "open-meteo",
        stations: "blaze",
      },
    } as unknown as GeoBundle;
    const plan = {
      stops: [{ charger: { name: "Carga Verde Socorro" } }],
      departureCharge: undefined,
    } as unknown as RoutePlan;
    const lines = diagnosticLines({
      info: {
        build: { commit: "4bfc22f", branch: "engine-v2", environment: "preview" },
        server: {
          plannerEngine: "legacy",
          energyEngine: "legacy",
          elevationSource: "mapbox-terrain",
          terrain: "mapbox.terrain-rgb z11 @2x",
          detourSource: "estimated",
          blazeConfigured: false,
          mapboxConfigured: true,
        },
        canClearServer: true,
      },
      engineChoice: "v2",
      geo,
      plan,
      vehicle: catalogVehicle("mg-s5-ev-comfort"),
      conditions,
      now: new Date("2026-09-28T10:05:00Z"),
    });
    expect(lines).toEqual([
      "Versión: 4bfc22f (engine-v2) · entorno preview",
      "Servidor: planificador por defecto legacy · energía legacy · elevación mapbox-terrain (mapbox.terrain-rgb z11 @2x) · desvíos estimated",
      "Claves: Blaze no · Mapbox sí",
      "Motor de esta página: v2",
      "Plan en pantalla: planificador v2 · energía v2 · estaciones blaze · elevación mapbox-terrain/mesh · rutas mapbox (hace 5 min)",
      "Estaciones cerca de la ruta: 2 · listado blaze-abc",
      "Paradas: Carga Verde Socorro",
      "Vehículo: MG S5 EV Comfort",
      "Viaje: sale con 80 % · llegada 10 % · margen low · estrategia fastest · 1 pasajero(s), 30 kg · A/C normal · temperatura del clima · estilo normal · regeneración medium",
    ]);
  });

  it("sin plan ni información del servidor todavía", () => {
    const lines = diagnosticLines({
      engineChoice: null,
      geo: null,
      plan: null,
      vehicle: catalogVehicle("mg-s5-ev-comfort"),
      conditions,
    });
    expect(lines[0]).toBe("Versión: consultando…");
    expect(lines).toContain("Motor de esta página: sin elegir (el del servidor)");
    expect(lines).toContain("Plan en pantalla: ninguno");
  });
});
