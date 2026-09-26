import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllGlobals());

describe("fetchElevations", () => {
  it("pide en lotes de 100 y devuelve las alturas en el orden pedido", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      urls.push(url.toString());
      const lats = (url.searchParams.get("latitude") ?? "").split(",").map(Number);
      return new Response(JSON.stringify({ elevation: lats.map((lat) => lat * 1000) }), {
        status: 200,
      });
    });
    const { fetchElevations } = await import("./elevation.openmeteo");
    const points = Array.from({ length: 250 }, (_, i) => ({ lat: 1 + i / 10000, lon: -73 }));
    const heights = await fetchElevations(points);
    expect(urls).toHaveLength(3);
    expect(heights).toHaveLength(250);
    heights.forEach((h, i) => expect(h).toBeCloseTo(points[i]!.lat * 1000, 6));
  });
});
