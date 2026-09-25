import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));

describe("User-Agent de las llamadas a proveedores", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("asciiHeader quita tildes y rayas que fetch no acepta en cabeceras", async () => {
    const { asciiHeader } = await import("./http");
    expect(asciiHeader("Andrés — Girón ✓")).toBe("Andres - Giron ?");
    expect(() => new Headers({ "user-agent": "a — b" })).toThrow();
    expect(() => new Headers({ "user-agent": asciiHeader("a — b") })).not.toThrow();
  });

  it("el User-Agent por defecto y uno con acentos en PROVIDER_CONTACT son válidos", async () => {
    delete process.env.PROVIDER_CONTACT;
    let { USER_AGENT } = await import("./http");
    expect(() => new Headers({ "user-agent": USER_AGENT })).not.toThrow();

    vi.resetModules();
    process.env.PROVIDER_CONTACT = "Weymar — Girón, Santander";
    ({ USER_AGENT } = await import("./http"));
    expect(USER_AGENT).toBe("Voltia/1.0 (EV trip planner; Weymar - Giron, Santander)");
    expect(() => new Headers({ "user-agent": USER_AGENT })).not.toThrow();
  });

  it("una llamada sin cabeceras propias (como Mapbox) sí sale", async () => {
    delete process.env.PROVIDER_CONTACT;
    const seen: Headers[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers)); // lanzaría con un carácter no ASCII
      return new Response("{}", { status: 200 });
    });
    const { fetchJson } = await import("./http");
    await expect(fetchJson("https://api.mapbox.com/x")).resolves.toEqual({});
    expect(seen[0]?.get("user-agent")).toMatch(/^Voltia\/1\.0 /);
  });
});
