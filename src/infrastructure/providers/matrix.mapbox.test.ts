import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));

afterEach(() => vi.unstubAllGlobals());

describe("fetchMapboxMatrix", () => {
  it("pide orígenes y destinos por índice y devuelve distancias y tiempos", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({ code: "Ok", distances: [[1200, null]], durations: [[90, null]] }),
        { status: 200 },
      );
    });
    const { fetchMapboxMatrix } = await import("./matrix.mapbox");
    const out = await fetchMapboxMatrix(
      "pk.a.b",
      [{ lat: 7, lon: -73 }],
      [
        { lat: 7.1, lon: -73 },
        { lat: 7.2, lon: -73 },
      ],
    );
    expect(out).toEqual({ distanceM: [[1200, null]], durationS: [[90, null]] });
    const url = new URL(urls[0]!);
    expect(url.pathname).toBe(
      "/directions-matrix/v1/mapbox/driving/-73.000000,7.000000;-73.000000,7.100000;-73.000000,7.200000",
    );
    expect(url.searchParams.get("sources")).toBe("0");
    expect(url.searchParams.get("destinations")).toBe("1;2");
    expect(url.searchParams.get("annotations")).toBe("distance,duration");
  });

  it("lanza si Mapbox responde con error o si hay demasiadas coordenadas", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ code: "InvalidInput", message: "malo" }), { status: 200 }),
    );
    const { fetchMapboxMatrix } = await import("./matrix.mapbox");
    await expect(
      fetchMapboxMatrix("pk.a.b", [{ lat: 1, lon: 1 }], [{ lat: 2, lon: 2 }]),
    ).rejects.toThrow(/InvalidInput/);
    const many = Array.from({ length: 13 }, (_, i) => ({ lat: i, lon: i }));
    await expect(fetchMapboxMatrix("pk.a.b", many, many)).rejects.toThrow(/máximo 25/);
  });
});
