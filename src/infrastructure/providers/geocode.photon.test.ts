import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => fn,
}));

const OPEN_METEO = {
  results: [
    { name: "Piedecuesta", latitude: 6.9877, longitude: -73.0495, admin1: "Santander", country: "Colombia" },
    { name: "Piedecuesta", latitude: 5.39, longitude: -72.3, admin1: "Casanare", country: "Colombia" },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("searchPlaces", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("si Photon rechaza lang=es (400) reintenta con lang=default", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.includes("photon") && url.includes("lang=es")) return json({ message: "Language is not supported" }, 400);
      if (url.includes("photon"))
        return json({
          features: [1, 2, 3, 4].map((i) => ({
            geometry: { coordinates: [-73 - i, 7 + i] },
            properties: { name: `Piedecuesta ${i}`, state: "Santander", country: "Colombia" },
          })),
        });
      throw new Error("no debería llamar a open-meteo");
    });
    const { searchPlaces } = await import("./geocode.photon");
    const out = await searchPlaces("piedecuesta-400");
    expect(out).toHaveLength(4);
    expect(urls.some((u) => u.includes("lang=default"))).toBe(true);
  });

  it("si Photon cae, usa Open-Meteo", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("photon")) throw new TypeError("fetch failed");
      return json(OPEN_METEO);
    });
    const { searchPlaces } = await import("./geocode.photon");
    const out = await searchPlaces("piedecuesta-om");
    expect(out[0]?.label).toBe("Piedecuesta, Santander");
  });

  it("si ambos proveedores caen, lanza error (la UI muestra 'no se pudo buscar')", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const { searchPlaces } = await import("./geocode.photon");
    await expect(searchPlaces("piedecuesta-down")).rejects.toThrow(/proveedor/);
  });
});
