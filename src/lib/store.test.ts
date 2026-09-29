import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_V2_CATALOG } from "@/domain/legacy-catalog";
import { makeVehicle } from "@/domain/user/test-fixtures";
import { GUEST_KEY } from "@/infrastructure/user-data/guest-storage";
import { DEFAULT_CONDITIONS } from "@/domain/types";
import { catalogVehicle } from "@/test-support/scenarios";
import { minimalSnapshot } from "@/test-support/snapshot-fixture";
import type { LastTrip } from "./last-trip";
import { migratePlannerState, storedRegenLevel, usePlanner } from "./store";

let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const V2_STATE = () => ({
  vehicles: [...LEGACY_V2_CATALOG, makeVehicle({ id: "custom-123", brand: "Mío", isCustom: true })],
  selectedVehicleId: "custom-123",
  conditions: { passengers: 2 },
  mapboxToken: "pk.abc",
  plugshareToken: "secreto-de-plugshare",
  tripRegenV: 2,
});

describe("migratePlannerState (v2 → v3)", () => {
  it("conserva las preferencias y descarta el catálogo y el token de PlugShare", () => {
    const out = migratePlannerState(V2_STATE());
    expect(out).toEqual({
      selectedVehicleId: "custom-123",
      conditions: { passengers: 2 },
      mapboxToken: "pk.abc",
      tripRegenV: 2,
    });
    expect(JSON.stringify(out)).not.toContain("plugshare");
  });

  it("mueve los vehículos propios a voltia-guest, sin el catálogo sin cambios", () => {
    migratePlannerState(V2_STATE());
    const guest = JSON.parse(data.get(GUEST_KEY)!);
    expect(guest.vehicles.map((v: { id: string }) => v.id)).toEqual(["custom-123"]);
  });

  it("una edición real de catálogo también se conserva", () => {
    const state = V2_STATE();
    state.vehicles = state.vehicles.map((v) =>
      v.id === LEGACY_V2_CATALOG[0]!.id ? { ...v, rangeKm: 999 } : v,
    );
    migratePlannerState(state);
    const guest = JSON.parse(data.get(GUEST_KEY)!);
    expect(guest.vehicles.map((v: { id: string }) => v.id)).toContain(LEGACY_V2_CATALOG[0]!.id);
  });

  it("no pierde datos si el estado viene vacío o raro", () => {
    expect(migratePlannerState(undefined)).toEqual({});
    expect(migratePlannerState({ vehicles: "no-es-lista" })).toEqual({});
  });

  it("trunca a 20 vehículos propios en vez de fallar", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeVehicle({ id: `custom-${i}`, model: `M${i}` }),
    );
    expect(() => migratePlannerState({ vehicles: many })).not.toThrow();
    expect(JSON.parse(data.get(GUEST_KEY)!).vehicles).toHaveLength(20);
  });
});

describe("storedRegenLevel", () => {
  it("usa el nivel guardado si es válido", () => {
    expect(storedRegenLevel({ regenLevel: "high" }, 3)).toBe("high");
  });

  it("con la versión 2 traduce el porcentaje viejo", () => {
    expect(storedRegenLevel({ regenPct: 5 }, 2)).toBe("low");
    expect(storedRegenLevel({ regenPct: 20 }, 2)).toBe("medium");
    expect(storedRegenLevel({ regenPct: 70 }, 2)).toBe("high");
  });

  it("sin dato confiable queda en media", () => {
    expect(storedRegenLevel({ regenPct: 70 }, undefined)).toBe("medium");
    expect(storedRegenLevel(undefined, 3)).toBe("medium");
    expect(storedRegenLevel({ regenLevel: "turbo" }, 3)).toBe("medium");
  });
});

describe("restoreTrip", () => {
  function lastTrip(overrides: Partial<LastTrip> = {}): LastTrip {
    const snapshot = minimalSnapshot();
    return {
      savedAt: "2026-09-29T12:00:00.000Z",
      origin: { label: "A", lat: 7, lon: -73 },
      destination: { label: "B", lat: 7 - 10 / 111, lon: -73 },
      waypoints: [],
      vehicle: { ...catalogVehicle("mg-s5-ev-comfort"), id: "solo-en-el-viaje" },
      conditions: { ...DEFAULT_CONDITIONS, initialSoc: 70 },
      geo: { routes: snapshot.routes, chargers: snapshot.chargers, weather: null, warnings: [] },
      selectedPlanId: "route-0",
      ...overrides,
    };
  }

  it("vuelve a mostrar el viaje guardado y recalcula sus planes sin consultar proveedores", () => {
    usePlanner.getState().restoreTrip(lastTrip());
    const s = usePlanner.getState();
    expect(s.origin?.label).toBe("A");
    expect(s.destination?.label).toBe("B");
    expect(s.conditions.initialSoc).toBe(70);
    expect(s.plans.map((p) => p.id)).toEqual(["route-0"]);
    expect(s.selectedPlanId).toBe("route-0");
    // El vehículo del viaje no está en la lista: entra como temporal.
    expect(s.selectedVehicle().id).toBe("solo-en-el-viaje");
    expect(s.tempVehicle?.id).toBe("solo-en-el-viaje");
  });

  it("si la ruta elegida ya no está, queda la primera", () => {
    usePlanner.getState().restoreTrip(lastTrip({ selectedPlanId: "otra" }));
    expect(usePlanner.getState().selectedPlanId).toBe("route-0");
  });
});
