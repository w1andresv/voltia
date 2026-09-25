import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => fn,
}));

const OPEN_METEO = {
  results: [
    {
      name: "Piedecuesta",
      latitude: 6.9877,
      longitude: -73.0495,
      admin1: "Santander",
      country: "Colombia",
    },
    {
      name: "Piedecuesta",
      latitude: 5.39,
      longitude: -72.3,
      admin1: "Casanare",
      country: "Colombia",
    },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
      if (url.includes("photon") && url.includes("lang=es"))
        return json({ message: "Language is not supported" }, 400);
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

describe("mergePlaces", () => {
  it("descarta el centro geográfico del municipio si existe el pueblo con el mismo nombre", async () => {
    const { mergePlaces } = await import("./geocode.photon");
    const out = mergePlaces([
      [{ label: "Vélez, Santander", name: "Vélez", lat: 6.0134, lon: -73.6735 }],
      [
        {
          label: "Vélez, Santander, Colombia",
          name: "Vélez",
          lat: 6.05,
          lon: -73.75,
          boundary: true,
        },
      ],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.lat).toBeCloseTo(6.0134, 3);
  });

  it("conserva el límite si no hay otro lugar con ese nombre, y quita repetidos a < 1,5 km", async () => {
    const { mergePlaces } = await import("./geocode.photon");
    const out = mergePlaces([
      [{ label: "Piedecuesta", name: "Piedecuesta", lat: 6.9877, lon: -73.0495 }],
      [{ label: "Piedecuesta, Santander", name: "Piedecuesta", lat: 6.988, lon: -73.05 }],
      [{ label: "Vélez (municipio)", name: "Vélez", lat: 6.05, lon: -73.75, boundary: true }],
    ]);
    expect(out.map((p) => p.label)).toEqual(["Piedecuesta", "Vélez (municipio)"]);
  });
});

describe("searchPlaces con Mapbox", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pone primero el resultado de Mapbox (centro urbano) y descarta el centroide de Photon", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("api.mapbox.com"))
        return json({
          features: [
            {
              geometry: { coordinates: [-73.6735, 6.0134] },
              properties: {
                name: "Vélez",
                place_formatted: "Santander, Colombia",
                feature_type: "place",
              },
            },
          ],
        });
      if (url.includes("photon"))
        return json({
          features: [
            {
              geometry: { coordinates: [-73.75, 6.05] },
              properties: {
                name: "Vélez",
                state: "Santander",
                country: "Colombia",
                osm_key: "boundary",
                osm_value: "administrative",
                osm_type: "R",
              },
            },
          ],
        });
      return json({ results: [] });
    });
    const { searchPlaces } = await import("./geocode.photon");
    const out = await searchPlaces("velez-mapbox");
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe("Vélez, Santander, Colombia");
    expect(out[0]?.lon).toBeCloseTo(-73.6735, 3);
  });

  it("un error de Mapbox no expone el token en el log", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.secreto.xyz";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("api.mapbox.com")) return json({ message: "Forbidden" }, 403);
      return json({
        results: [
          {
            name: "Vélez",
            latitude: 6.0134,
            longitude: -73.6735,
            admin1: "Santander",
            country: "Colombia",
          },
        ],
      });
    });
    const { searchPlaces } = await import("./geocode.photon");
    const out = await searchPlaces("velez-403");
    expect(out[0]?.label).toBe("Vélez, Santander");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("pk.secreto.xyz");
  });
});
