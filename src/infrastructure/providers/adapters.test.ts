import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutingError } from "@/domain/ev/contracts/route";
import { fakeMapboxRoute, fakeProviderRoute } from "@/test-support/mapbox-fixtures";
import { MapboxRoutingProvider, OpenMeteoElevationProvider, toProviderRoute } from "./adapters";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("toProviderRoute", () => {
  it("traduce Directions a ProviderRoute con unidades en el nombre", () => {
    const stretches: [string, number, number][] = [
      ["primary", 10, 8],
      ["tertiary", 3, 4],
    ];
    const out = toProviderRoute(fakeMapboxRoute(stretches), "mapbox", "driving");
    expect(out).toEqual(fakeProviderRoute(stretches));
  });

  it("sin tramos ni anotaciones queda con legs vacío", () => {
    const out = toProviderRoute(
      {
        distance: 1000,
        duration: 60,
        geometry: {
          coordinates: [
            [-73, 7],
            [-73, 7.01],
          ],
        },
      },
      "osrm",
      "driving",
    );
    expect(out.legs).toEqual([]);
    expect(out.geometry).toEqual([
      { lat: 7, lon: -73 },
      { lat: 7.01, lon: -73 },
    ]);
  });

  it("conserva las anotaciones por par de puntos", () => {
    const out = toProviderRoute(
      {
        distance: 2000,
        duration: 120,
        geometry: { coordinates: [[-73, 7], [-73, 7.01], [-73, 7.02]] },
        legs: [{ summary: "Ruta 45", annotation: { distance: [1000, 1000], duration: [50, 70] } }],
      },
      "mapbox",
      "driving",
    );
    expect(out.legs[0]).toEqual({
      summary: "Ruta 45",
      distanceM: undefined,
      annotation: { distanceM: [1000, 1000], durationS: [50, 70] },
      steps: undefined,
    });
  });
});

describe("MapboxRoutingProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("traduce los errores a RoutingError sin el token", async () => {
    vi.stubGlobal("fetch", async () => json({ message: "Forbidden" }, 403));
    const error = await new MapboxRoutingProvider("pk.secreto.xyz")
      .calculateRoutes({ waypoints: [{ lat: 7, lon: -73 }, { lat: 6, lon: -73.6 }], alternatives: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RoutingError);
    expect((error as RoutingError).noRoute).toBe(false);
    expect((error as Error).message).not.toContain("pk.secreto.xyz");
  });

  it("marca 'sin camino' cuando Mapbox no encuentra ruta", async () => {
    vi.stubGlobal("fetch", async () => json({ code: "NoRoute", routes: [] }));
    const error = await new MapboxRoutingProvider("pk.abc.def")
      .calculateRoutes({ waypoints: [{ lat: 7, lon: -73 }, { lat: 6, lon: -73.6 }], alternatives: true })
      .catch((e: unknown) => e);
    expect((error as RoutingError).noRoute).toBe(true);
  });

  it("pide evitar peajes y puntos", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [fakeMapboxRoute([["primary", 5, 4]])], waypoints: [{ distance: 1500 }, { distance: 0 }] });
    });
    const set = await new MapboxRoutingProvider("pk.abc.def").calculateRoutes({
      waypoints: [{ lat: 7, lon: -73 }, { lat: 6, lon: -73.6 }],
      alternatives: true,
      avoid: { tolls: true, points: [{ lat: 6.5, lon: -73.3 }] },
    });
    expect(set.waypointSnapKm).toEqual([1.5, 0]);
    expect(new URL(urls[0]!).searchParams.get("exclude")).toBe("toll,point(-73.30000 6.50000)");
  });
});

describe("OpenMeteoElevationProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("devuelve las alturas en el orden de los puntos", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const lats = new URL(url).searchParams.get("latitude")!.split(",");
      return json({ elevation: lats.map((l) => Number(l) * 100) });
    });
    const out = await new OpenMeteoElevationProvider().getElevations([
      { lat: 7, lon: -73 },
      { lat: 6.5, lon: -73.2 },
    ]);
    expect(out).toEqual([700, 650]);
  });
});
