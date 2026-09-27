import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/auth/port";

vi.mock("server-only", () => ({}));
const { updateTag } = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag, unstable_cache: (fn: () => unknown) => fn }));
const { getActor } = vi.hoisted(() => ({ getActor: vi.fn<() => Promise<Actor>>() }));
vi.mock("@/infrastructure/auth/server-actor", async () => {
  const { AuthError } = await vi.importActual<typeof import("@/infrastructure/auth/server-actor")>(
    "@/infrastructure/auth/server-actor",
  );
  return {
    AuthError,
    getActor,
    requireAdmin: async () => {
      const a = await getActor();
      if (a.role !== "admin") throw new AuthError("No autorizado.");
      return a;
    },
  };
});
const { resetStationCaches } = vi.hoisted(() => ({ resetStationCaches: vi.fn() }));
vi.mock("@/application/container", () => ({ resetStationCaches }));

const ADMIN: Actor = { role: "admin", id: "u1", email: "w1andresv@gmail.com" };
const MEMBER: Actor = { role: "member", id: "u2", email: "otra@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("clearServerCacheFn", () => {
  it("un administrador invalida la etiqueta de proveedores, la memoria y el listado de Blaze", async () => {
    getActor.mockResolvedValue(ADMIN);
    const { clearServerCacheFn } = await import("./cache");
    const { PROVIDER_CACHE_TAG } = await import("@/infrastructure/providers/http");
    const res = await clearServerCacheFn();
    expect(updateTag).toHaveBeenCalledWith(PROVIDER_CACHE_TAG);
    expect(resetStationCaches).toHaveBeenCalled();
    expect(res.clearedAt).toMatch(/^\d{4}-/);
  });

  it("cualquier otro usuario no puede", async () => {
    getActor.mockResolvedValue(MEMBER);
    const { clearServerCacheFn } = await import("./cache");
    await expect(clearServerCacheFn()).rejects.toThrow(/No autorizado/);
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("appInfoFn", () => {
  it("dice qué está configurado sin exponer claves", async () => {
    vi.stubEnv("BLAZE_API_KEY", "blz_secreta_123");
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.secreto.abc123");
    vi.stubEnv("PLANNER_ENGINE", "shadow");
    getActor.mockResolvedValue(MEMBER);
    const { appInfoFn } = await import("./cache");
    const info = await appInfoFn();
    expect(info.server).toMatchObject({
      plannerEngine: "shadow",
      blazeConfigured: true,
      mapboxConfigured: true,
      terrain: "mapbox.terrain-rgb z11 @2x",
    });
    expect(info.canClearServer).toBe(false);
    const text = JSON.stringify(info);
    expect(text).not.toContain("blz_secreta_123");
    expect(text).not.toContain("pk.secreto.abc123");
  });

  it("si la sesión falla, responde igual (sin limpiar el servidor)", async () => {
    getActor.mockRejectedValue(new Error("Your project's URL and Key are required"));
    const { appInfoFn } = await import("./cache");
    const info = await appInfoFn();
    expect(info.canClearServer).toBe(false);
    expect(info.build.commit.length).toBeGreaterThan(0);
  });

  it("un administrador puede limpiar también la caché del servidor", async () => {
    getActor.mockResolvedValue(ADMIN);
    const { appInfoFn } = await import("./cache");
    expect((await appInfoFn()).canClearServer).toBe(true);
  });
});
