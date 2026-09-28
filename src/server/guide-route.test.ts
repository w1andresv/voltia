import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/auth/port";

vi.mock("server-only", () => ({}));
const { getActor } = vi.hoisted(() => ({ getActor: vi.fn<() => Promise<Actor>>() }));
vi.mock("@/infrastructure/auth/server-actor", () => ({ getActor }));

beforeEach(() => vi.clearAllMocks());

describe("canOpenGuides", () => {
  it("abre las guías solo a la cuenta del dueño", async () => {
    const { canOpenGuides } = await import("./guide-route");
    getActor.mockResolvedValueOnce({ role: "member", id: "u1", email: "w1andresv@gmail.com" });
    expect(await canOpenGuides()).toBe(true);
    getActor.mockResolvedValueOnce({ role: "admin", id: "u2", email: "otra@example.com" });
    expect(await canOpenGuides()).toBe(false);
    getActor.mockResolvedValueOnce({ role: "guest", id: null, email: null });
    expect(await canOpenGuides()).toBe(false);
  });

  it("si falla la sesión, no las abre", async () => {
    const { canOpenGuides } = await import("./guide-route");
    getActor.mockRejectedValueOnce(new Error("supabase"));
    expect(await canOpenGuides()).toBe(false);
  });
});
