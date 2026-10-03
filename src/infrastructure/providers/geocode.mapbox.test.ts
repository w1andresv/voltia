import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => fn,
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VELEZ = {
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
};

describe("searchPlaces (solo Mapbox)", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MAPBOX_ACCESS_TOKEN;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("busca solo en Mapbox, en Colombia y con el sesgo si viene", async () => {
    process.env.MAPBOX_ACCESS_TOKEN = "pk.abc.def";
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json(VELEZ);
    });
    const { searchPlaces } = await import("./geocode.mapbox");
    const out = await searchPlaces("  velez  ", { lat: 7.1, lon: -73.1 });
    expect(out).toEqual([
      {
        label: "Vélez, Santander, Colombia",
        lat: 6.0134,
        lon: -73.6735,
        context: "Santander, Colombia",
      },
    ]);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]!);
    expect(url.host).toBe("api.mapbox.com");
    expect(url.searchParams.get("q")).toBe("velez");
    expect(url.searchParams.get("country")).toBe("co");
    expect(url.searchParams.get("proximity")).toBe("-73.1,7.1");
  });

  it("con menos de 2 letras no llama a Mapbox", async () => {
    process.env.MAPBOX_ACCESS_TOKEN = "pk.abc.def";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { searchPlaces } = await import("./geocode.mapbox");
    expect(await searchPlaces(" v ")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sin token no busca: lanza error (la UI dice 'no se pudo buscar')", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { searchPlaces } = await import("./geocode.mapbox");
    await expect(searchPlaces("velez")).rejects.toThrow(/token de Mapbox/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("si Mapbox falla, el error no expone el token", async () => {
    process.env.MAPBOX_ACCESS_TOKEN = "pk.secreto.xyz";
    vi.stubGlobal("fetch", async () => json({ message: "Forbidden" }, 403));
    const { searchPlaces } = await import("./geocode.mapbox");
    const error = await searchPlaces("velez").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/HTTP 403/);
    expect((error as Error).message).not.toContain("pk.secreto.xyz");
  });
});
