import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

const tooMany = () =>
  new Response(JSON.stringify({ reason: "Too many concurrent requests" }), {
    status: 429,
    headers: { "retry-after": "0" },
  });

const points = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ lat: 1 + i / 10000, lon: -73 }));

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

  it("reintenta con pausa un lote que Open-Meteo limita (429) sin pasar a OpenTopo", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const hosts: string[] = [];
    let meteoCalls = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      hosts.push(url.host);
      if (++meteoCalls <= 2) return tooMany();
      const lats = (url.searchParams.get("latitude") ?? "").split(",");
      return new Response(JSON.stringify({ elevation: lats.map(() => 500) }), { status: 200 });
    });
    const { fetchElevations } = await import("./elevation.openmeteo");
    const pending = fetchElevations(points(50));
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(Array(50).fill(500));
    expect(hosts.every((h) => h === "api.open-meteo.com")).toBe(true);
  });

  it("si Open-Meteo sigue limitado, pide a OpenTopo de a una consulta por segundo", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const topoAt: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.host === "api.open-meteo.com") return tooMany();
      topoAt.push(Date.now());
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      const n = (url.searchParams.get("locations") ?? "").split("|").length;
      return new Response(
        JSON.stringify({
          status: "OK",
          results: Array.from({ length: n }, () => ({ elevation: 7 })),
        }),
        { status: 200 },
      );
    });
    const { fetchElevations, OPEN_TOPO_GAP_MS } = await import("./elevation.openmeteo");
    const pending = fetchElevations(points(250));
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(Array(250).fill(7));
    expect(topoAt).toHaveLength(3);
    expect(maxInFlight).toBe(1);
    for (let i = 1; i < topoAt.length; i++) {
      expect(topoAt[i]! - topoAt[i - 1]!).toBeGreaterThanOrEqual(OPEN_TOPO_GAP_MS);
    }
  });

  it("el error de un lote fallido no arrastra la URL completa con las coordenadas", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    vi.stubGlobal("fetch", async () => tooMany());
    const { fetchElevations } = await import("./elevation.openmeteo");
    const pending = fetchElevations(points(100)).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    const err = (await pending) as Error;
    expect(err.message).toMatch(/^HTTP 429 https:\/\/api\.opentopodata\.org/);
    expect(err.message.length).toBeLessThan(400);
  });
});
