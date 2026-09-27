import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("canChooseEngine", () => {
  it("por defecto lo ve todo el mundo, invitados incluidos", async () => {
    const { canChooseEngine } = await import("./engine-preview");
    expect(canChooseEngine({ role: "member", email: "otra@example.com" })).toBe(true);
    expect(canChooseEngine({ role: "guest", email: null })).toBe(true);
  });

  it("con una lista, solo esos correos, sin importar mayúsculas", async () => {
    vi.stubEnv("ENGINE_PREVIEW_EMAILS", "w1andresv@gmail.com");
    const { canChooseEngine } = await import("./engine-preview");
    expect(canChooseEngine({ role: "member", email: "w1andresv@gmail.com" })).toBe(true);
    expect(canChooseEngine({ role: "admin", email: "W1AndresV@Gmail.com" })).toBe(true);
    expect(canChooseEngine({ role: "member", email: "otra@example.com" })).toBe(false);
    expect(canChooseEngine({ role: "guest", email: null })).toBe(false);
  });

  it("ENGINE_PREVIEW_EMAILS reemplaza la lista", async () => {
    vi.stubEnv("ENGINE_PREVIEW_EMAILS", " a@x.co , b@y.co ");
    const { canChooseEngine } = await import("./engine-preview");
    expect(canChooseEngine({ role: "member", email: "b@y.co" })).toBe(true);
    expect(canChooseEngine({ role: "member", email: "w1andresv@gmail.com" })).toBe(false);
  });
});
