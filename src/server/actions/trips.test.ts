import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/auth/port";
import { DEFAULT_CURVE } from "@/domain/charging";
import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";

const { requireUser } = vi.hoisted(() => ({ requireUser: vi.fn<() => Promise<Actor>>() }));
vi.mock("@/infrastructure/auth/server-actor", () => ({
  requireUser,
  AuthError: class AuthError extends Error {},
}));

const { createServerSupabase } = vi.hoisted(() => ({ createServerSupabase: vi.fn() }));
vi.mock("@/infrastructure/supabase/server", () => ({ createServerSupabase }));

/** Ver la nota en vehicles.test.ts: el cliente no debe ser "thenable" él mismo. */
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "order", "insert", "update", "delete", "single", "maybeSingle"];
  for (const m of methods) builder[m] = vi.fn(() => builder);
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
  return builder;
}

function client(result: unknown) {
  const builder = chain(result);
  return { from: builder.from, _builder: builder };
}

const MEMBER: Actor = { role: "member", id: "user-1", email: "member@example.com" };
class AuthError extends Error {}

const REQUEST: PlanRequestShape = {
  origin: { label: "Bucaramanga", lat: 7.1193, lon: -73.1227 },
  destination: { label: "Bogotá", lat: 4.711, lon: -74.0721 },
  waypoints: [],
  vehicle: {
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
  },
  conditions: {
    passengers: 1,
    luggageKg: 0,
    initialSoc: 90,
    arrivalSoc: 20,
    avgSpeedKmh: null,
    ac: "normal",
    temperatureC: 20,
    drivingStyle: "normal",
    safetyMode: "normal",
    customSafetyPct: 15,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenPct: 20,
  },
};

const SUMMARY: TripSummaryShape = {
  originLabel: "Bucaramanga",
  destinationLabel: "Bogotá",
  distanceKm: 290,
  totalMinutes: 420,
  stops: 1,
  arrivalSoc: 22,
  energyKwh: 55,
};

const ROW = {
  id: "trip-1",
  payload: { request: REQUEST, summary: SUMMARY },
  shared: false,
  share_id: null,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveTripFn", () => {
  it("un invitado no puede guardar un viaje", async () => {
    requireUser.mockRejectedValueOnce(new AuthError("Inicia sesión para continuar."));
    const { saveTripFn } = await import("./trips");
    await expect(saveTripFn({ data: { request: REQUEST, summary: SUMMARY } })).rejects.toThrow();
  });

  it("guarda la petición y el resumen, no el plan completo", async () => {
    requireUser.mockResolvedValueOnce(MEMBER);
    const c = client({ data: ROW, error: null });
    createServerSupabase.mockResolvedValueOnce(c);
    const { saveTripFn } = await import("./trips");
    const saved = await saveTripFn({ data: { request: REQUEST, summary: SUMMARY } });
    expect(saved.id).toBe("trip-1");
    expect(saved.summary.distanceKm).toBe(290);
    expect(c._builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "user-1", payload: { request: REQUEST, summary: SUMMARY } }),
    );
  });
});

describe("saveTripFn con clientId (idempotencia)", () => {
  const CLIENT_ID = "00000000-0000-4000-8000-00000000000a";

  it("un reintento con el mismo clientId devuelve la ruta existente sin insertar", async () => {
    requireUser.mockResolvedValueOnce(MEMBER);
    const c = client({ data: ROW, error: null });
    createServerSupabase.mockResolvedValueOnce(c);
    const { saveTripFn } = await import("./trips");
    const saved = await saveTripFn({ data: { request: REQUEST, summary: SUMMARY, clientId: CLIENT_ID } });
    expect(saved.id).toBe("trip-1");
    expect(c._builder.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(c._builder.insert).not.toHaveBeenCalled();
  });

  it("con un clientId nuevo inserta guardando client_id", async () => {
    requireUser.mockResolvedValueOnce(MEMBER);
    const c = client({ data: null, error: null });
    // 1.ª consulta (maybeSingle): no existe; 2.ª (single del insert): la fila creada.
    (c._builder.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: null, error: null });
    (c._builder.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: ROW, error: null });
    createServerSupabase.mockResolvedValueOnce(c);
    const { saveTripFn } = await import("./trips");
    await saveTripFn({ data: { request: REQUEST, summary: SUMMARY, clientId: CLIENT_ID } });
    expect(c._builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "user-1", client_id: CLIENT_ID }),
    );
  });

  it("rechaza un clientId que no es uuid", async () => {
    requireUser.mockResolvedValueOnce(MEMBER);
    const { saveTripFn } = await import("./trips");
    await expect(saveTripFn({ data: { request: REQUEST, summary: SUMMARY, clientId: "abc" } })).rejects.toThrow();
  });
});

describe("listMyTripsFn", () => {
  it("un invitado no puede listar su historial", async () => {
    requireUser.mockRejectedValueOnce(new AuthError("Inicia sesión para continuar."));
    const { listMyTripsFn } = await import("./trips");
    await expect(listMyTripsFn()).rejects.toThrow();
  });

  it("devuelve el historial del usuario", async () => {
    requireUser.mockResolvedValueOnce(MEMBER);
    createServerSupabase.mockResolvedValueOnce(client({ data: [ROW], error: null }));
    const { listMyTripsFn } = await import("./trips");
    const list = await listMyTripsFn();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("trip-1");
  });
});

describe("deleteTripFn", () => {
  it("un invitado no puede borrar", async () => {
    requireUser.mockRejectedValueOnce(new AuthError("Inicia sesión para continuar."));
    const { deleteTripFn } = await import("./trips");
    await expect(deleteTripFn({ data: { id: "trip-1" } })).rejects.toThrow();
  });

  it("borra solo dentro del alcance del dueño (filtra por owner_id además del RLS)", async () => {
    requireUser.mockResolvedValueOnce(MEMBER);
    const c = client({ error: null });
    createServerSupabase.mockResolvedValueOnce(c);
    const { deleteTripFn } = await import("./trips");
    await deleteTripFn({ data: { id: "trip-1" } });
    expect(c._builder.eq).toHaveBeenCalledWith("id", "trip-1");
    expect(c._builder.eq).toHaveBeenCalledWith("owner_id", "user-1");
  });
});

describe("shareTripFn", () => {
  it("un invitado no puede compartir", async () => {
    requireUser.mockRejectedValueOnce(new AuthError("Inicia sesión para continuar."));
    const { shareTripFn } = await import("./trips");
    await expect(shareTripFn({ data: { id: "trip-1" } })).rejects.toThrow();
  });

  it("genera un share_id nuevo si el viaje todavía no se ha compartido", async () => {
    requireUser.mockResolvedValueOnce(MEMBER);
    createServerSupabase.mockResolvedValueOnce(client({ data: { share_id: null }, error: null }));
    const { shareTripFn } = await import("./trips");
    const result = await shareTripFn({ data: { id: "trip-1" } });
    expect(result.shareId).toHaveLength(10);
  });

  it("reutiliza el share_id si el viaje ya estaba compartido", async () => {
    requireUser.mockResolvedValueOnce(MEMBER);
    createServerSupabase.mockResolvedValueOnce(client({ data: { share_id: "abc1234567" }, error: null }));
    const { shareTripFn } = await import("./trips");
    const result = await shareTripFn({ data: { id: "trip-1" } });
    expect(result.shareId).toBe("abc1234567");
  });
});

describe("getSharedTripFn", () => {
  it("no exige sesión", async () => {
    createServerSupabase.mockResolvedValueOnce(client({ data: { ...ROW, shared: true, share_id: "abc1234567" }, error: null }));
    const { getSharedTripFn } = await import("./trips");
    const trip = await getSharedTripFn({ data: { shareId: "abc1234567" } });
    expect(requireUser).not.toHaveBeenCalled();
    expect(trip?.summary.distanceKm).toBe(290);
  });

  it("da null si no existe o no está compartido", async () => {
    createServerSupabase.mockResolvedValueOnce(client({ data: null, error: { message: "no rows" } }));
    const { getSharedTripFn } = await import("./trips");
    const trip = await getSharedTripFn({ data: { shareId: "no-existe" } });
    expect(trip).toBeNull();
  });
});
