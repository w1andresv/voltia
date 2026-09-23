import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/auth/port";
import { DEFAULT_CURVE } from "@/lib/domain/charging";
import type { Vehicle } from "@/lib/domain/types";

const { requireMember } = vi.hoisted(() => ({ requireMember: vi.fn<() => Promise<Actor>>() }));
vi.mock("@/infrastructure/auth/server-actor", () => ({
  requireMember,
  AuthError: class AuthError extends Error {},
}));

const { createServerSupabase } = vi.hoisted(() => ({ createServerSupabase: vi.fn() }));
vi.mock("@/infrastructure/supabase/server", () => ({ createServerSupabase }));

/**
 * Un builder falso que encadena como el de supabase-js (`.from().select()...`)
 * y resuelve al awaitarlo. `client()` es lo que "createServerSupabase()"
 * debe resolver — un objeto SIN `.then` propio, para que `await
 * createServerSupabase()` no lo confunda con el builder mismo (que sí es
 * "thenable" y se resolvería de una vez al valor final del chain).
 */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "order", "upsert", "insert", "update", "delete", "single", "maybeSingle"];
  for (const m of methods) builder[m] = vi.fn(() => builder);
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
  return builder;
}

function client(result: unknown) {
  const builder = chain(result);
  return { schema: vi.fn(() => builder), _builder: builder };
}

const MEMBER: Actor = { role: "member", id: "user-1", email: "member@example.com" };

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "custom-1",
    brand: "Test",
    model: "EV",
    year: 2024,
    version: "base",
    batteryKwh: 60,
    rangeKm: 400,
    consumptionKwhPer100km: null,
    weightKg: 1800,
    motorKw: 150,
    acMaxKw: 11,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2", "type2"],
    minSocRecommended: 10,
    maxSocTravel: 90,
    ...overrides,
  };
}

class AuthError extends Error {}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveVehicleFn", () => {
  it("un invitado no puede guardar", async () => {
    requireMember.mockRejectedValueOnce(new AuthError("Inicia sesión para continuar."));
    const { saveVehicleFn } = await import("./vehicles");
    await expect(saveVehicleFn({ data: vehicle() })).rejects.toThrow();
  });

  it("guarda con un id de fila que combina owner_id y el id local, no choca entre usuarios", async () => {
    requireMember.mockResolvedValueOnce(MEMBER);
    const c = client({ error: null });
    createServerSupabase.mockResolvedValueOnce(c);
    const { saveVehicleFn } = await import("./vehicles");
    const v = vehicle({ id: "custom-1" });
    const result = await saveVehicleFn({ data: v });
    expect(result.id).toBe("custom-1"); // el id local del vehículo no cambia
    expect(c._builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1:custom-1", owner_id: "user-1" }),
    );
  });

  it("rechaza un vehículo que no pasa la validación", async () => {
    requireMember.mockResolvedValueOnce(MEMBER);
    const { saveVehicleFn } = await import("./vehicles");
    await expect(saveVehicleFn({ data: { ...vehicle(), batteryKwh: -5 } })).rejects.toThrow();
  });
});

describe("listMyVehiclesFn", () => {
  it("un invitado no puede listar", async () => {
    requireMember.mockRejectedValueOnce(new AuthError("Inicia sesión para continuar."));
    const { listMyVehiclesFn } = await import("./vehicles");
    await expect(listMyVehiclesFn()).rejects.toThrow();
  });

  it("devuelve los vehículos guardados, con su id local intacto", async () => {
    requireMember.mockResolvedValueOnce(MEMBER);
    const v = vehicle({ id: "custom-2" });
    createServerSupabase.mockResolvedValueOnce(client({ data: [{ payload: v }], error: null }));
    const { listMyVehiclesFn } = await import("./vehicles");
    const list = await listMyVehiclesFn();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("custom-2");
  });
});
