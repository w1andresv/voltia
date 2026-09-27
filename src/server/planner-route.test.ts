import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/auth/port";

vi.mock("server-only", () => ({}));
const { getActor } = vi.hoisted(() => ({ getActor: vi.fn<() => Promise<Actor>>() }));
vi.mock("@/infrastructure/auth/server-actor", () => ({ getActor }));

const OWNER: Actor = { role: "member", id: "u1", email: "w1andresv@gmail.com" };
const OTHER: Actor = { role: "member", id: "u2", email: "otra@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("rutas /v1 y /v2 del planificador", () => {
  it("por defecto cada ruta atiende su motor, invitados incluidos", async () => {
    getActor.mockResolvedValue({ role: "guest", id: null, email: null });
    const { plannerEngineFor } = await import("./planner-route");
    expect(await plannerEngineFor("v1")).toBe("v1");
    expect(await plannerEngineFor("v2")).toBe("v2");
  });

  it("con la lista limitada, quien no está en ella recibe el motor del servidor", async () => {
    vi.stubEnv("ENGINE_PREVIEW_EMAILS", "w1andresv@gmail.com");
    const { plannerEngineFor } = await import("./planner-route");
    getActor.mockResolvedValue(OWNER);
    expect(await plannerEngineFor("v2")).toBe("v2");
    getActor.mockResolvedValue(OTHER);
    expect(await plannerEngineFor("v2")).toBe("v1");
  });

  it("el motor del servidor sale de PLANNER_ENGINE (shadow responde con v1)", async () => {
    vi.stubEnv("ENGINE_PREVIEW_EMAILS", "w1andresv@gmail.com");
    getActor.mockResolvedValue(OTHER);
    vi.stubEnv("PLANNER_ENGINE", "v2");
    let mod = await import("./planner-route");
    expect(await mod.plannerEngineFor("v1")).toBe("v2");
    expect(await mod.defaultPlannerEngine()).toBe("v2");
    vi.resetModules();
    vi.stubEnv("PLANNER_ENGINE", "shadow");
    mod = await import("./planner-route");
    expect(await mod.defaultPlannerEngine()).toBe("v1");
  });

  it("si falla la sesión cuenta como invitado", async () => {
    vi.stubEnv("ENGINE_PREVIEW_EMAILS", "w1andresv@gmail.com");
    getActor.mockRejectedValue(new Error("supabase"));
    const { plannerEngineFor } = await import("./planner-route");
    expect(await plannerEngineFor("v2")).toBe("v1");
  });
});
