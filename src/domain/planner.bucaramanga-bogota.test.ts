/**
 * Caso reportado (2026-09-27): Bucaramanga → Bogotá con el MG S5 EV, 100 % al
 * salir y motor v2. Las estaciones de Blaze en Santana y cerca de Tunja se
 * veían en el mapa pero el plan no paraba y llegaba con batería negativa: el
 * filtro de planificación no reconocía la fuente "blaze".
 *
 * Perfil aproximado de la ruta 45A/62 por los pueblos principales (km, lat, lon, altura).
 */
import { describe, expect, it } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import { buildPlan } from "./planner";
import type { Charger, RawRoute, TripConditions } from "./types";

const TOWNS: [km: number, lat: number, lon: number, elevM: number][] = [
  [0, 7.119, -73.123, 960], // Bucaramanga
  [20, 6.99, -73.05, 1000], // Piedecuesta
  [35, 6.93, -73.03, 1500], // Los Curos
  [55, 6.83, -73.05, 500], // Pescadero (Chicamocha)
  [72, 6.7, -73.02, 1800], // Aratoca
  [96, 6.556, -73.134, 1100], // San Gil
  [118, 6.468, -73.26, 1230], // Socorro
  [148, 6.26, -73.3, 1420], // Oiba
  [170, 6.1, -73.44, 1500], // Suaita
  [188, 6.057, -73.482, 1550], // Santana
  [213, 5.932, -73.615, 1600], // Barbosa
  [226, 5.876, -73.573, 1700], // Moniquirá
  [256, 5.755, -73.437, 2700], // Arcabuco
  [288, 5.535, -73.367, 2800], // Tunja
  [320, 5.366, -73.521, 2630], // Ventaquemada
  [345, 5.216, -73.595, 2700], // Villapinzón
  [360, 5.147, -73.683, 2650], // Chocontá
  [421, 4.711, -74.072, 2600], // Bogotá
];

function at(km: number) {
  const i = Math.max(0, TOWNS.findIndex(([k], j) => km <= k && j > 0) - 1);
  const [k0, la0, lo0, e0] = TOWNS[i]!;
  const [k1, la1, lo1, e1] = TOWNS[i + 1]!;
  const t = (km - k0) / (k1 - k0);
  return { lat: la0 + (la1 - la0) * t, lon: lo0 + (lo1 - lo0) * t, elevM: e0 + (e1 - e0) * t };
}

function route(): RawRoute {
  const samples = Array.from({ length: 422 }, (_, km) => ({ km, ...at(km), slopePct: 0, speedKmh: 60 }));
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i]!.elevM - samples[i - 1]!.elevM;
    if (d > 0) gain += d;
    else loss -= d;
  }
  return {
    id: "route-0",
    label: "Ruta A",
    geometry: samples.map(({ lat, lon }) => ({ lat, lon })),
    samples,
    distanceKm: 421,
    driveMinutes: 421,
    elevation: { gainM: gain, lossM: loss, minM: 500, maxM: 2800 },
  };
}

/** Como las traduce el adaptador de Blaze: fuente "blaze", CCS2 y Tipo 2, en servicio. */
function blaze(id: string, name: string, km: number, offsetLon = 0): Charger {
  const p = at(km);
  return {
    id,
    name,
    lat: p.lat,
    lon: p.lon + offsetLon,
    operator: "Blaze Charge",
    sockets: [
      { connector: "ccs2", powerKw: 60, count: 2, current: "DC", currentOrigin: "standard", powerOrigin: "reported" },
      { connector: "type2", powerKw: 22, count: 1, current: "AC", currentOrigin: "standard", powerOrigin: "assumed" },
    ],
    access: "public",
    source: "blaze",
    available: true,
    availability: "available",
    verified: true,
  };
}

const conditions: TripConditions = {
  passengers: 1,
  luggageKg: 30,
  initialSoc: 100,
  arrivalSoc: 10,
  avgSpeedKmh: null,
  ac: "normal",
  temperatureC: 20,
  drivingStyle: "normal",
  safetyMode: "normal",
  customSafetyPct: 15,
  planningMode: "fastest",
  allowBelowSafety: false,
  regenLevel: "medium",
};

const STATIONS = [
  blaze("blz_santana", "EDS Santana", 188),
  blaze("blz_tunja", "EDS Tunja", 288, 0.02), // ~2 km de la vía
];

function plan(chargers: Charger[]) {
  return buildPlan({
    raw: route(),
    vehicle: catalogVehicle("mg-s5-ev-comfort"),
    conditions,
    chargers,
    weather: null,
    origin: { label: "Bucaramanga", lat: 7.119, lon: -73.123 },
    destination: { label: "Bogotá", lat: 4.711, lon: -74.072 },
    engine: "v2",
    energyEngine: "v2",
  });
}

describe("Bucaramanga → Bogotá, MG S5 EV al 100 %, motor v2 con estaciones de Blaze", () => {
  it("sin estaciones no es viable: la energía supera la batería", () => {
    const p = plan([]);
    expect(p.feasible).toBe(false);
    expect(p.arrivalSoc).toBeLessThan(0);
  });

  it("para en Santana y cerca de Tunja, y llega sobre la reserva sin bajar del piso", () => {
    const p = plan(STATIONS);
    expect(p.feasible).toBe(true);
    expect(p.stops.map((s) => s.charger.id)).toEqual(["blz_santana", "blz_tunja"]);
    expect(p.arrivalSoc).toBeGreaterThanOrEqual(p.safetyPct - 0.5);
    expect(p.minSoc).toBeGreaterThan(0);
  });
});
