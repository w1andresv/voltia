import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { currentIdentity, ensureUser } = vi.hoisted(() => ({
  currentIdentity: vi.fn(),
  ensureUser: vi.fn(),
}));
vi.mock("@/infrastructure/auth/supabase-identity", () => ({
  supabaseIdentity: { currentIdentity },
}));
vi.mock("@/infrastructure/users/user-store", () => ({ ensureUser }));
vi.mock("@/infrastructure/config/env", () => ({
  getEnv: () => ({ ADMIN_EMAILS: "Admin@Example.com, otro@example.com" }),
}));

import { AuthError, getActor, requireAdmin, requireUser } from "./server-actor";

beforeEach(() => {
  currentIdentity.mockReset();
  ensureUser.mockReset();
});

describe("getActor", () => {
  it("sin identidad: invitado, sin tocar la base", async () => {
    currentIdentity.mockResolvedValue(null);
    expect(await getActor()).toEqual({ role: "guest", id: null, email: null });
    expect(ensureUser).not.toHaveBeenCalled();
  });

  it("con identidad: member con el id INTERNO, no el del proveedor", async () => {
    currentIdentity.mockResolvedValue({
      provider: "supabase",
      subject: "sb-1",
      email: "m@example.com",
    });
    ensureUser.mockResolvedValue("internal-1");
    expect(await getActor()).toEqual({ role: "member", id: "internal-1", email: "m@example.com" });
  });

  it("admin por ADMIN_EMAILS sin distinguir mayúsculas", async () => {
    currentIdentity.mockResolvedValue({
      provider: "supabase",
      subject: "sb-2",
      email: "ADMIN@example.com",
    });
    ensureUser.mockResolvedValue("internal-2");
    expect((await getActor()).role).toBe("admin");
  });
});

describe("requireUser / requireAdmin", () => {
  it("requireUser lanza AuthError para invitados", async () => {
    currentIdentity.mockResolvedValue(null);
    await expect(requireUser()).rejects.toBeInstanceOf(AuthError);
  });

  it("requireAdmin rechaza a un member", async () => {
    currentIdentity.mockResolvedValue({
      provider: "supabase",
      subject: "sb-3",
      email: "m@example.com",
    });
    ensureUser.mockResolvedValue("internal-3");
    await expect(requireAdmin()).rejects.toBeInstanceOf(AuthError);
  });
});
