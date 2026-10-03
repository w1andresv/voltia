import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { key: string[]; opts: { revalidate?: number | false; tags?: string[] } }[] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => Promise<unknown>,
    key: string[],
    opts: { revalidate?: number | false; tags?: string[] },
  ) => {
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

describe('caché que se puede limpiar (botón "Limpiar caché")', () => {
  it("solo las respuestas con vencimiento llevan la etiqueta; la elevación no", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const { CACHE_FOREVER, PROVIDER_CACHE_TAG, fetchBytes, fetchJson } = await import("./http");
    await fetchJson("https://example.test/ruta", { cacheTtlMs: 90_000, cacheKey: "ruta" });
    await fetchJson("https://example.test/alt", { cacheTtlMs: CACHE_FOREVER, cacheKey: "alt" });
    await fetchBytes("https://example.test/t.png", { cacheTtlMs: CACHE_FOREVER, cacheKey: "tile" });
    expect(calls.map((c) => c.opts.tags)).toEqual([[PROVIDER_CACHE_TAG], undefined, undefined]);
  });

  it("clearProviderMemory vacía la memoria: la siguiente consulta vuelve a la fuente", async () => {
    let hits = 0;
    vi.stubGlobal("fetch", async () => {
      hits++;
      return new Response(JSON.stringify({ ok: hits }), { status: 200 });
    });
    const { clearProviderMemory, fetchJson } = await import("./http");
    const opts = { cacheTtlMs: 60_000, cacheKey: "memoria-limpiable" };
    await fetchJson("https://example.test/m", opts);
    await fetchJson("https://example.test/m", opts);
    expect(hits).toBe(1);
    expect(clearProviderMemory()).toBeGreaterThanOrEqual(1);
    await fetchJson("https://example.test/m", opts);
    expect(hits).toBe(2);
  });
});

describe("memoria del proceso con tope (LRU)", () => {
  it("no pasa del tope y descarta la menos usada", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const http = await import("./http");
    http.clearProviderMemory();
    const opts = (k: string) => ({ cacheTtlMs: 60_000, cacheKey: k });
    const max = http.MEMORY_CACHE_MAX_ENTRIES;
    for (let i = 0; i < max; i++) await http.fetchJson(`https://example.test/${i}`, opts(`lru-${i}`));
    expect(http.providerMemorySize()).toBe(max);
    // Se vuelve a usar la más vieja: ya no es la candidata a salir.
    let fetched = 0;
    vi.stubGlobal("fetch", async () => {
      fetched++;
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    });
    await http.fetchJson("https://example.test/0", opts("lru-0"));
    expect(fetched).toBe(0);
    await http.fetchJson("https://example.test/nueva", opts("lru-nueva"));
    expect(http.providerMemorySize()).toBe(max);
    // La segunda (lru-1) salió; la usada hace un momento (lru-0) sigue en memoria.
    await http.fetchJson("https://example.test/0", opts("lru-0"));
    expect(fetched).toBe(1); // solo la nueva
    http.clearProviderMemory();
  });
});
