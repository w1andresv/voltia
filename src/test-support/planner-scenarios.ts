import type { Charger, RawRoute, TripConditions } from "@/domain/types";

/**
 * Escenarios del banco del planificador (M1, ADR-0020): una ruta sintética de
 * montaña de 421 km (212 muestras, como Bucaramanga → Bogotá) y N estaciones
 * compatibles, repartidas o con el 40 % agrupado cerca del destino (las ciudades
 * aportan decenas de estaciones casi iguales). Sin red; los usan el banco
 * (`npm run bench:planner`) y la prueba de presupuesto.
 */

export const BENCH_ORIGIN = { label: "A", lat: 7.119, lon: -73.123 };
export const BENCH_DESTINATION = { label: "B", lat: 4.711, lon: -74.072 };

export function benchRoute(): RawRoute {
  const km = (i: number) => Math.min(421, i * 2);
  const samples = Array.from({ length: 212 }, (_, i) => ({
    km: km(i),
    lat: 7.119 - (2.4 * km(i)) / 421,
    lon: -73.123 - (0.95 * km(i)) / 421,
    // Sube a 2.600 m con ondulaciones: hay bajadas donde regenerar.
    elevM: 1000 + (1600 * km(i)) / 421 + 120 * Math.sin(km(i) / 9),
    slopePct: 0,
    speedKmh: 60,
  }));
  return {
    id: "bench",
    label: "bench",
    geometry: samples.map(({ lat, lon }) => ({ lat, lon })),
    samples,
    distanceKm: 421,
    driveMinutes: 421,
    elevation: { gainM: 0, lossM: 0, minM: 1000, maxM: 2700 },
  };
}

function charger(raw: RawRoute, i: number, atKm: number, dc: boolean): Charger {
  const s = raw.samples[Math.round(atKm / 2)]!;
  return {
    id: `c${i}`,
    name: `C${i}`,
    lat: s.lat,
    lon: s.lon + 0.01,
    operator: "x",
    sockets: [
      dc
        ? { connector: "ccs2", powerKw: 60, count: 2, current: "DC", currentOrigin: "standard", powerOrigin: "reported" }
        : { connector: "type2", powerKw: 22, count: 1, current: "AC", currentOrigin: "standard", powerOrigin: "reported" },
    ],
    access: "public",
    source: "blaze",
    available: true,
    availability: "available",
    verified: true,
  } as Charger;
}

/** `count` estaciones: repartidas por la ruta, o con el 40 % agrupado en los últimos 25 km. */
export function benchChargers(raw: RawRoute, count: number, clustered: boolean): Charger[] {
  return Array.from({ length: count }, (_, i) =>
    clustered && i < count * 0.4
      ? charger(raw, i, 395 + (i % 12) * 2, i % 2 === 0)
      : charger(raw, i, 10 + (380 * i) / count, i % 3 !== 2),
  );
}

export const BENCH_CONDITIONS: TripConditions = {
  passengers: 1,
  luggageKg: 30,
  initialSoc: 60,
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
