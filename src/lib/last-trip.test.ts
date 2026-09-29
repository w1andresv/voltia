import { describe, expect, it } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import { minimalSnapshot } from "@/test-support/snapshot-fixture";
import { DEFAULT_CONDITIONS, type GeoBundle } from "@/domain/types";
import {
  MAX_LAST_TRIP_CHARS,
  clearLastTrip,
  loadLastTrip,
  saveLastTrip,
  type LastTrip,
} from "./last-trip";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function trip(overrides: Partial<LastTrip> = {}): LastTrip {
  const snapshot = minimalSnapshot();
  const geo: GeoBundle = {
    routes: snapshot.routes,
    chargers: snapshot.chargers,
    weather: snapshot.weather,
    warnings: [],
  };
  return {
    savedAt: "2026-09-29T12:00:00.000Z",
    origin: { label: "Bucaramanga", lat: 7.119, lon: -73.119 },
    destination: { label: "Bogotá", lat: 4.711, lon: -74.072 },
    waypoints: [],
    vehicle: catalogVehicle("mg-s5-ev-comfort"),
    conditions: DEFAULT_CONDITIONS,
    geo,
    selectedPlanId: "route-0",
    ...overrides,
  };
}

describe("último viaje guardado", () => {
  it("se guarda y se lee igual", () => {
    const storage = memoryStorage();
    expect(saveLastTrip(trip(), storage)).toBe(true);
    expect(loadLastTrip(storage)).toEqual(trip());
  });

  it("sin nada guardado, o después de borrarlo, no hay viaje", () => {
    const storage = memoryStorage();
    expect(loadLastTrip(storage)).toBeNull();
    saveLastTrip(trip(), storage);
    clearLastTrip(storage);
    expect(loadLastTrip(storage)).toBeNull();
  });

  it("descarta lo que no tiene la forma esperada, es de otra versión o no es JSON", () => {
    const storage = memoryStorage();
    saveLastTrip(trip(), storage);
    const saved = JSON.parse(storage.data.get("voltia-last-trip")!);
    for (const bad of [
      { ...saved, v: 0 },
      { ...saved, origin: { label: "sin coordenadas" } },
      { ...saved, geo: { ...saved.geo, routes: [] } },
      { ...saved, vehicle: null },
    ]) {
      storage.setItem("voltia-last-trip", JSON.stringify(bad));
      expect(loadLastTrip(storage)).toBeNull();
    }
    storage.setItem("voltia-last-trip", "{no es json");
    expect(loadLastTrip(storage)).toBeNull();
  });

  it("no guarda un viaje demasiado grande ni falla si el navegador lo rechaza", () => {
    const storage = memoryStorage();
    const huge = trip({ geo: { ...trip().geo, warnings: ["x".repeat(MAX_LAST_TRIP_CHARS)] } });
    expect(saveLastTrip(huge, storage)).toBe(false);
    expect(storage.data.size).toBe(0);
    const full = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveLastTrip(trip(), full)).toBe(false);
    expect(saveLastTrip(trip(), null)).toBe(false);
  });
});
