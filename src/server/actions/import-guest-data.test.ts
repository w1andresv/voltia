import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/auth/port";
import { SUMMARY, makeRequest, makeVehicle } from "@/domain/user/test-fixtures";

const { requireUser } = vi.hoisted(() => ({ requireUser: vi.fn<() => Promise<Actor>>() }));
vi.mock("@/infrastructure/auth/server-actor", () => ({ requireUser }));
const { loadCatalog } = vi.hoisted(() => ({ loadCatalog: vi.fn() }));
vi.mock("@/infrastructure/catalog/catalog-store", () => ({ loadCatalog }));
const { createServerSupabase } = vi.hoisted(() => ({ createServerSupabase: vi.fn() }));
vi.mock("@/infrastructure/supabase/server", () => ({ createServerSupabase }));

import { importGuestDataFn } from "./import-guest-data";

const MEMBER: Actor = { role: "member", id: "user-1", email: "m@example.com" };
const CLIENT_A = "00000000-0000-4000-8000-00000000000a";
const CLIENT_B = "00000000-0000-4000-8000-00000000000b";

function fakeSupabase(opts: {
  accountVehicles?: unknown[];
  accountTrips?: unknown[];
  rpc?: (args: { p_vehicles: unknown[]; p_trips: unknown[] }) => {
    data?: unknown;
    error?: { message: string };
  };
}) {
  const rpc = vi.fn((_name: string, args: { p_vehicles: unknown[]; p_trips: unknown[] }) =>
    Promise.resolve(opts.rpc ? opts.rpc(args) : { data: { vehicles: [], trips: [] } }),
  );
  const from = (table: string) => {
    const rows = table === "voltia_vehicles" ? (opts.accountVehicles ?? []) : (opts.accountTrips ?? []);
    const b = { select: () => b, eq: () => Promise.resolve({ data: rows, error: null }) };
    return b;
  };
  return { supabase: { from, rpc }, rpc };
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue(MEMBER);
  loadCatalog.mockReset().mockResolvedValue([]);
  createServerSupabase.mockReset();
});

describe("importGuestDataFn", () => {
  it("rechaza a un invitado (requireUser lanza)", async () => {
    requireUser.mockRejectedValueOnce(new Error("Inicia sesión"));
    await expect(importGuestDataFn({ data: { vehicles: [], trips: [] } })).rejects.toThrow(
      "Inicia sesión",
    );
  });

  it("valida el input: más de 20 vehículos o 50 rutas", async () => {
    const { supabase } = fakeSupabase({});
    createServerSupabase.mockResolvedValue(supabase);
    const many = Array.from({ length: 21 }, (_, i) => makeVehicle({ id: `v${i}` }));
    await expect(importGuestDataFn({ data: { vehicles: many, trips: [] } })).rejects.toThrow();
    const trips = Array.from({ length: 51 }, () => ({
      clientId: CLIENT_A,
      request: makeRequest(),
      summary: SUMMARY,
    }));
    await expect(importGuestDataFn({ data: { vehicles: [], trips } })).rejects.toThrow();
  });

  it("rechaza un clientId que no es uuid", async () => {
    const { supabase } = fakeSupabase({});
    createServerSupabase.mockResolvedValue(supabase);
    await expect(
      importGuestDataFn({
        data: {
          vehicles: [],
          trips: [{ clientId: "no-uuid", request: makeRequest(), summary: SUMMARY }],
        },
      }),
    ).rejects.toThrow();
  });

  it("sin nada que subir no llama a la función SQL", async () => {
    const { supabase, rpc } = fakeSupabase({});
    createServerSupabase.mockResolvedValue(supabase);
    const result = await importGuestDataFn({ data: { vehicles: [], trips: [] } });
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ vehicles: [], trips: [], idMap: {}, discardedEdits: [] });
  });

  it("sube lo nuevo y omite duplicados; devuelve el estado por ítem", async () => {
    const custom = makeVehicle({ id: "custom-1" });
    const { supabase, rpc } = fakeSupabase({
      accountTrips: [
        {
          client_id: CLIENT_B,
          payload: { request: makeRequest({ origin: { label: "x", lat: 1, lon: 1 } }) },
        },
      ],
      rpc: ({ p_vehicles, p_trips }) => ({
        data: {
          vehicles: (p_vehicles as { localId: string }[]).map((v) => ({
            localId: v.localId,
            status: "imported",
          })),
          trips: (p_trips as { clientId: string }[]).map((t) => ({
            clientId: t.clientId,
            status: "imported",
          })),
        },
      }),
    });
    createServerSupabase.mockResolvedValue(supabase);

    const result = await importGuestDataFn({
      data: {
        vehicles: [custom],
        trips: [
          { clientId: CLIENT_A, request: makeRequest(), summary: SUMMARY },
          { clientId: CLIENT_B, request: makeRequest(), summary: SUMMARY },
        ],
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result.vehicles).toEqual([{ localId: "custom-1", status: "imported" }]);
    expect(result.trips).toEqual([
      { clientId: CLIENT_A, status: "imported" },
      { clientId: CLIENT_B, status: "skipped" },
    ]);
  });

  it("un ítem que falla en la base queda como failed (el cliente no lo borra)", async () => {
    const { supabase } = fakeSupabase({
      rpc: () => ({ data: { vehicles: [{ localId: "custom-1", status: "failed" }], trips: [] } }),
    });
    createServerSupabase.mockResolvedValue(supabase);
    const result = await importGuestDataFn({
      data: { vehicles: [makeVehicle({ id: "custom-1" })], trips: [] },
    });
    expect(result.vehicles[0]!.status).toBe("failed");
  });

  it("un ítem que la función no devolvió cuenta como failed", async () => {
    const { supabase } = fakeSupabase({ rpc: () => ({ data: { vehicles: [], trips: [] } }) });
    createServerSupabase.mockResolvedValue(supabase);
    const result = await importGuestDataFn({
      data: { vehicles: [makeVehicle({ id: "custom-1" })], trips: [] },
    });
    expect(result.vehicles[0]!.status).toBe("failed");
  });

  it("error de la función SQL: lanza (cortó la red o no está expuesta)", async () => {
    const { supabase } = fakeSupabase({ rpc: () => ({ error: { message: "boom" } }) });
    createServerSupabase.mockResolvedValue(supabase);
    await expect(
      importGuestDataFn({ data: { vehicles: [makeVehicle()], trips: [] } }),
    ).rejects.toThrow(/boom/);
  });

  it("un id remapeado se informa con su id local original", async () => {
    const local = makeVehicle({ id: "custom-1", model: "Local" });
    const remote = makeVehicle({ id: "custom-1", model: "Remoto" });
    const { supabase } = fakeSupabase({
      accountVehicles: [{ payload: remote }],
      rpc: ({ p_vehicles }) => ({
        data: {
          vehicles: (p_vehicles as { localId: string }[]).map((v) => ({
            localId: v.localId,
            status: "imported",
          })),
          trips: [],
        },
      }),
    });
    createServerSupabase.mockResolvedValue(supabase);
    const result = await importGuestDataFn({ data: { vehicles: [local], trips: [] } });
    expect(result.vehicles).toEqual([{ localId: "custom-1", status: "imported" }]);
    expect(result.idMap["custom-1"]).toMatch(/^custom-1-imp/);
  });
});
