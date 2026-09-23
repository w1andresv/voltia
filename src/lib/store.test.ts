import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_V2_CATALOG } from "@/domain/legacy-catalog";
import { makeVehicle } from "@/domain/user/test-fixtures";
import { GUEST_KEY } from "@/infrastructure/user-data/guest-storage";
import { migratePlannerState } from "./store";

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
