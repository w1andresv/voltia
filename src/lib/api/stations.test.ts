import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/auth/port";
import type { Charger } from "@/lib/domain/types";

const { requireMember, requireAdmin } = vi.hoisted(() => ({
  requireMember: vi.fn<() => Promise<Actor>>(),
  requireAdmin: vi.fn<() => Promise<Actor>>(),
}));

const { checkRateLimit } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => undefined),
}));

const {
  loadCommunityChargers,
  insertStation,
  patchStation,
  getStationOwnership,
  setStationStatus,
} = vi.hoisted(() => ({
  loadCommunityChargers: vi.fn(async () => [] as Charger[]),
  insertStation: vi.fn(async () => ({ id: "new" }) as unknown as Charger),
  patchStation: vi.fn(async () => ({ id: "patched" }) as unknown as Charger),
  getStationOwnership: vi.fn(async () => null as { createdBy: string | null; status: string } | null),
  setStationStatus: vi.fn(async () => ({ id: "reviewed" }) as unknown as Charger),
}));

vi.mock("@/infrastructure/auth/server-actor", () => ({
  requireMember,
  requireAdmin,
  AuthError: class AuthError extends Error {},
}));
vi.mock("@/infrastructure/rate-limit", () => ({ checkRateLimit }));
vi.mock("./stations-db", () => ({
  loadCommunityChargers,
  insertStation,
  patchStation,
  getStationOwnership,
  setStationStatus,
}));

const MEMBER: Actor = { role: "member", id: "user-1", email: "member@example.com" };
const ADMIN: Actor = { role: "admin", id: "admin-1", email: "admin@example.com" };

class AuthError extends Error {}

const VALID_STATION = {
  name: "Estación de prueba",
  lat: 4.6,
  lon: -74.08,
  sockets: [{ connector: "ccs2", powerKw: 150, count: 2 }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listStationsFn", () => {
  it("un visitante puede pedir approved sin necesitar sesión", async () => {
    const { listStationsFn } = await import("./stations");
    await listStationsFn({ data: { status: "approved" } });
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(loadCommunityChargers).toHaveBeenCalledWith("approved");
  });

  it("sin status pedido, por defecto también es approved (público)", async () => {
    const { listStationsFn } = await import("./stations");
    await listStationsFn();
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(loadCommunityChargers).toHaveBeenCalledWith("approved");
  });

  it("pedir pending/rejected/all exige admin", async () => {
    requireAdmin.mockRejectedValueOnce(new AuthError("No autorizado."));
    const { listStationsFn } = await import("./stations");
    await expect(listStationsFn({ data: { status: "pending" } })).rejects.toThrow();
    expect(loadCommunityChargers).not.toHaveBeenCalled();
  });

  it("un admin sí puede pedir la cola de moderación", async () => {
    requireAdmin.mockResolvedValueOnce(ADMIN);
    const { listStationsFn } = await import("./stations");
    await listStationsFn({ data: { status: "all" } });
    expect(loadCommunityChargers).toHaveBeenCalledWith("all");
  });
});

describe("createStationFn", () => {
  it("un invitado no puede crear una estación", async () => {
    requireMember.mockRejectedValueOnce(new AuthError("Inicia sesión para continuar."));
    const { createStationFn } = await import("./stations");
    await expect(createStationFn({ data: VALID_STATION })).rejects.toThrow();
    expect(insertStation).not.toHaveBeenCalled();
  });

  it("un miembro autenticado sí puede crear, y queda como autor", async () => {
    requireMember.mockResolvedValueOnce(MEMBER);
    const { createStationFn } = await import("./stations");
    await createStationFn({ data: VALID_STATION });
    expect(checkRateLimit).toHaveBeenCalledWith("create-station", MEMBER.id, 10, 600);
    expect(insertStation).toHaveBeenCalledWith(expect.objectContaining({ name: VALID_STATION.name }), MEMBER.id);
  });

  it("rechaza datos que no pasan la validación (nombre muy corto)", async () => {
    requireMember.mockResolvedValueOnce(MEMBER);
    const { createStationFn } = await import("./stations");
    await expect(createStationFn({ data: { ...VALID_STATION, name: "x" } })).rejects.toThrow();
    expect(insertStation).not.toHaveBeenCalled();
  });
});

describe("updateStationFn", () => {
  const UPDATE = { ...VALID_STATION, id: "station-1" };

  it("un invitado no puede editar", async () => {
    requireMember.mockRejectedValueOnce(new AuthError("Inicia sesión para continuar."));
    const { updateStationFn } = await import("./stations");
    await expect(updateStationFn({ data: UPDATE })).rejects.toThrow();
    expect(patchStation).not.toHaveBeenCalled();
  });

  it("el admin puede editar cualquier estación", async () => {
    requireMember.mockResolvedValueOnce(ADMIN);
    const { updateStationFn } = await import("./stations");
    await updateStationFn({ data: UPDATE });
    expect(getStationOwnership).not.toHaveBeenCalled();
    expect(patchStation).toHaveBeenCalled();
  });

  it("el autor puede editar su propia estación mientras sigue pendiente", async () => {
    requireMember.mockResolvedValueOnce(MEMBER);
    getStationOwnership.mockResolvedValueOnce({ createdBy: MEMBER.id, status: "pending" });
    const { updateStationFn } = await import("./stations");
    await updateStationFn({ data: UPDATE });
    expect(patchStation).toHaveBeenCalled();
  });

  it("un miembro no puede editar la estación de otro", async () => {
    requireMember.mockResolvedValueOnce(MEMBER);
    getStationOwnership.mockResolvedValueOnce({ createdBy: "otro-usuario", status: "pending" });
    const { updateStationFn } = await import("./stations");
    await expect(updateStationFn({ data: UPDATE })).rejects.toThrow("No autorizado.");
    expect(patchStation).not.toHaveBeenCalled();
  });

  it("el autor no puede editar su propia estación una vez ya aprobada", async () => {
    requireMember.mockResolvedValueOnce(MEMBER);
    getStationOwnership.mockResolvedValueOnce({ createdBy: MEMBER.id, status: "approved" });
    const { updateStationFn } = await import("./stations");
    await expect(updateStationFn({ data: UPDATE })).rejects.toThrow("No autorizado.");
    expect(patchStation).not.toHaveBeenCalled();
  });
});

describe("reviewStationFn", () => {
  const REVIEW = { id: "station-1", status: "approved" as const };

  it("un invitado no puede revisar", async () => {
    requireAdmin.mockRejectedValueOnce(new AuthError("No autorizado."));
    const { reviewStationFn } = await import("./stations");
    await expect(reviewStationFn({ data: REVIEW })).rejects.toThrow();
    expect(setStationStatus).not.toHaveBeenCalled();
  });

  it("un miembro sin rol admin no puede revisar", async () => {
    requireAdmin.mockRejectedValueOnce(new AuthError("No autorizado."));
    const { reviewStationFn } = await import("./stations");
    await expect(reviewStationFn({ data: REVIEW })).rejects.toThrow();
    expect(setStationStatus).not.toHaveBeenCalled();
  });

  it("un admin puede aprobar o rechazar", async () => {
    requireAdmin.mockResolvedValueOnce(ADMIN);
    const { reviewStationFn } = await import("./stations");
    await reviewStationFn({ data: REVIEW });
    expect(setStationStatus).toHaveBeenCalledWith(REVIEW.id, REVIEW.status, undefined, ADMIN.id);
  });
});
