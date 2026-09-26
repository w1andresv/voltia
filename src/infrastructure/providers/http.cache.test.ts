import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { key: string[]; opts: { revalidate?: number | false } }[] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, key: string[], opts: { revalidate?: number | false }) => {
    calls.push({ key, opts });
    return fn;
  },
}));

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("caché de datos que no cambian (elevación)", () => {
  it("CACHE_FOREVER pide a la Data Cache sin vencimiento; un TTL normal, en segundos", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const { CACHE_FOREVER, fetchBytes, fetchJson } = await import("./http");
    await fetchJson("https://example.test/a", { cacheTtlMs: CACHE_FOREVER, cacheKey: "a-forever" });
    await fetchJson("https://example.test/b", { cacheTtlMs: 90_000, cacheKey: "b-90s" });
    await fetchBytes("https://example.test/t.png?access_token=secreto", {
      cacheTtlMs: CACHE_FOREVER,
      cacheKey: "terrain:x:12/1/2",
    });
    expect(calls.map((c) => c.opts.revalidate)).toEqual([false, 90, false]);
    // La clave de la tesela no lleva el token.
    expect(calls[2]!.key).toEqual(["terrain:x:12/1/2"]);
  });

  it("las fuentes de elevación usan caché sin vencimiento", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ elevation: [1000] }), { status: 200 }),
    );
    const { fetchElevations } = await import("./elevation.openmeteo");
    await fetchElevations([{ lat: 7, lon: -73 }]);
    expect(calls.at(-1)!.opts.revalidate).toBe(false);
  });
});
