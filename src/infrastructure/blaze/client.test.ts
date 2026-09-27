import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const KEY = "blz_test_key_123";

function stubFetch(handler: (url: URL) => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), headers: (init?.headers ?? {}) as Record<string, string> });
    return handler(url);
  });
  return calls;
}

async function client() {
  const { BlazeClient } = await import("./client");
  return new BlazeClient({ baseUrl: "https://blaze.example/public/v1/", apiKey: KEY });
}

describe("BlazeClient", () => {
  it("pide /stations con la key en la cabecera, nunca en la URL", async () => {
    const calls = stubFetch(() => Response.json([{ id: 1, name: "EDS", lat: 7, lon: -73 }]));
    const list = await (await client()).listStations();
    expect(list).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://blaze.example/public/v1/stations");
    expect(calls[0]!.url).not.toContain(KEY);
    expect(calls[0]!.headers["x-api-key"]).toBe(KEY);
  });

  it("el detalle pide /stations/{id} y un 404 es null", async () => {
    const calls = stubFetch((url) =>
      url.pathname.endsWith("/stations/12")
        ? Response.json({
            id: 12,
            name: "EDS",
            chargers: [{ connectorType: "CCS2", powerKw: 150, status: "en_servicio" }],
          })
        : new Response("{}", { status: 404 }),
    );
    const c = await client();
    expect((await c.station("12"))?.chargers).toHaveLength(1);
    expect(await c.station("99")).toBeNull();
    expect(calls.map((x) => x.url)).toEqual([
      "https://blaze.example/public/v1/stations/12",
      "https://blaze.example/public/v1/stations/99",
    ]);
  });

  it("una respuesta con otra forma falla en el esquema, no más adentro", async () => {
    stubFetch(() => Response.json({ data: [] }));
    await expect((await client()).listStations()).rejects.toThrow();
  });

  it("un 401 (key inválida) se propaga sin la key en el mensaje", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "invalid key" }), { status: 401 }));
    const err = await (await client()).listStations().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^HTTP 401/);
    expect((err as Error).message).not.toContain(KEY);
  });
});
