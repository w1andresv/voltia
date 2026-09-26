import { readFileSync } from "node:fs";
import type { ConsolidatedStation } from "@/domain/stations/model";
import type { PlanRequest, TripConditions, Vehicle } from "@/domain/types";

const SEED = new URL("../../seeds/0001_vehicle_catalog.sql", import.meta.url);

/** Un vehículo del catálogo tal como está en el seed (la misma fuente que la base). */
export function catalogVehicle(id: string): Vehicle {
  const sql = readFileSync(SEED, "utf8");
  for (const m of sql.matchAll(/values \('([^']+)', null, '((?:[^']|'')*)'::jsonb\)/g)) {
    if (m[1] === id) return JSON.parse(m[2]!.replace(/''/g, "'")) as Vehicle;
  }
  throw new Error(`No hay un vehículo "${id}" en seeds/0001_vehicle_catalog.sql`);
}

/**
 * Caso de prueba del plan (docs/arquitectura-ev/02-plan-arquitectura-modular.md, §7.1).
 * SOC inicial 80 %, 25 °C y sin adaptadores son los valores propuestos: si se
 * cambian, hay que volver a grabar la cassette y actualizar el snapshot.
 */
export const PIEDECUESTA_VELEZ = {
  id: "piedecuesta-velez",
  cassette: new URL("./fixtures/piedecuesta-velez.cassette.json", import.meta.url),
  request(): PlanRequest {
    const conditions: TripConditions = {
      passengers: 1,
      luggageKg: 30,
      initialSoc: 80,
      arrivalSoc: 10,
      avgSpeedKmh: null,
      ac: "normal",
      temperatureC: 25,
      drivingStyle: "normal",
      safetyMode: "low",
      customSafetyPct: 10,
      planningMode: "fastest",
      allowBelowSafety: false,
      regenLevel: "medium",
    };
    return {
      origin: { label: "Piedecuesta, Santander", lat: 6.9877, lon: -73.0495 },
      destination: { label: "Vélez, Santander", lat: 6.0106, lon: -73.6734 },
      waypoints: [],
      vehicle: catalogVehicle("mg-s5-ev-deluxe"),
      conditions,
    };
  },
};

/**
 * Sin datos de contacto ni atributos crudos de las fuentes: el planificador no
 * los usa y no hace falta guardarlos en el repositorio.
 */
export function sanitizeStation(station: ConsolidatedStation): ConsolidatedStation {
  const { phone: _phone, email: _email, ...rest } = station;
  return { ...rest, attributes: {}, conflicts: [] };
}
