import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/auth/port";
import { catalogVehicle } from "@/test-support/scenarios";
import type { PlanRequest } from "@/domain/types";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => undefined),
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));
const { getActor } = vi.hoisted(() => ({ getActor: vi.fn<() => Promise<Actor>>() }));
vi.mock("@/infrastructure/auth/server-actor", () => ({ getActor }));
const { createPlanningService } = vi.hoisted(() => {
  const plan = vi.fn(async () => ({
    response: {
      geo: { routes: [], chargers: [], weather: null, warnings: [] },
      plans: [],
      selectedId: "",
    },
    engine: "mapbox",
    chargerCount: 0,
  }));
  return { plan, createPlanningService: vi.fn(() => ({ plan })) };
});
vi.mock("@/application/container", () => ({ createPlanningService }));

const request: PlanRequest = {
  origin: { label: "A", lat: 7, lon: -73 },
  destination: { label: "B", lat: 6, lon: -73.6 },
  waypoints: [],
  vehicle: catalogVehicle("mg-s5-ev-deluxe"),
  conditions: {
    passengers: 1,
    luggageKg: 0,
    initialSoc: 80,
    arrivalSoc: 10,
    avgSpeedKmh: null,
    ac: "normal",
    temperatureC: 25,
    drivingStyle: "normal",
    safetyMode: "normal",
    customSafetyPct: 15,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenLevel: "medium",
  },
};

const OWNER: Actor = { role: "member", id: "u1", email: "w1andresv@gmail.com" };
const OTHER: Actor = { role: "member", id: "u2", email: "otra@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("motor v1/v2 que manda la ruta del planificador", () => {
  it("el usuario con permiso elige v2: planificador y energía v2", async () => {
    getActor.mockResolvedValue(OWNER);
    const { planTripFn } = await import("./plan");
    await planTripFn({ data: request, engine: "v2" });
    expect(createPlanningService).toHaveBeenCalledWith({ engineMode: "v2", energyMode: "v2" });
  });

  it("y v1: los actuales, aunque el servidor tenga otra cosa configurada", async () => {
    getActor.mockResolvedValue(OWNER);
    const { planTripFn } = await import("./plan");
    await planTripFn({ data: request, engine: "v1" });
    expect(createPlanningService).toHaveBeenCalledWith({
      engineMode: "legacy",
      energyMode: "legacy",
    });
  });

  it("con la lista limitada, otro usuario que manda la elección a mano: se ignora", async () => {
    vi.stubEnv("ENGINE_PREVIEW_EMAILS", "w1andresv@gmail.com");
    getActor.mockResolvedValue(OTHER);
    const { planTripFn } = await import("./plan");
    await planTripFn({ data: request, engine: "v2" });
    expect(createPlanningService).toHaveBeenCalledWith({});
  });

  it("sin elección no consulta la sesión", async () => {
    const { planTripFn } = await import("./plan");
    await planTripFn({ data: request });
    expect(getActor).not.toHaveBeenCalled();
    expect(createPlanningService).toHaveBeenCalledWith({});
  });

  it("por defecto todos pueden elegir motor, invitados incluidos", async () => {
    const { planTripFn } = await import("./plan");
    getActor.mockResolvedValueOnce({ role: "guest", id: null, email: null });
    await planTripFn({ data: request, engine: "v2" });
    expect(createPlanningService).toHaveBeenCalledWith({ engineMode: "v2", energyMode: "v2" });
  });
});
