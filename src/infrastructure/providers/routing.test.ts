import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => fn,
}));

const A = { lat: 6.9877, lon: -73.0495 }; // Piedecuesta
const B = { lat: 6.0106, lon: -73.6734 }; // Vélez

/** Ruta A → (punto intermedio) → B; `bend` desplaza el intermedio en grados de longitud. */
function route(distanceM: number, durationS: number, bend = 0, summary?: string) {
  return {
    distance: distanceM,
    duration: durationS,
    geometry: {
      coordinates: [
        [A.lon, A.lat],
        [-73.36 + bend, 6.5],
        [B.lon, B.lat],
      ] as [number, number][],
    },
    legs: summary ? [{ summary }] : undefined,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("buildRouteSet", () => {
  it("quita duplicados, descarta alternativas absurdas, ordena por tiempo y rotula", async () => {
    const { buildRouteSet } = await import("./routing");
    const out = buildRouteSet([
      { route: route(214_000, 16_200, 0, "Ruta 45A, Ruta 66"), noTolls: false },
      { route: route(214_500, 16_300, 0), noTolls: true }, // misma vía que la primera
      { route: route(230_000, 15_900, 0.4), noTolls: false }, // otra vía, más rápida
      { route: route(400_000, 30_000, -0.6), noTolls: false }, // absurda (> 50 % más larga)
    ]);
    expect(out.map((r) => [r.label, Math.round(r.distanceKm)])).toEqual([
      ["Ruta A", 230],
      ["Ruta B", 214],
    ]);
    expect(out[1]?.noTolls).toBe(true); // heredó "sin peajes" de su duplicado
    expect(out[1]?.via).toBe("Ruta 45A, Ruta 66");
  });

  it("una sola ruta se llama 'Ruta recomendada'", async () => {
    const { buildRouteSet } = await import("./routing");
    expect(buildRouteSet([{ route: route(214_000, 16_200), noTolls: false }])[0]?.label).toBe(
      "Ruta recomendada",
    );
  });

  it("presenta como máximo 4 rutas", async () => {
    const { buildRouteSet, MAX_ROUTES } = await import("./routing");
    const many = [0, 0.3, -0.3, 0.6, -0.6, 0.9].map((b, i) => ({
      route: route(214_000 + i * 1000, 16_000 + i * 100, b),
      noTolls: false,
    }));
    expect(buildRouteSet(many)).toHaveLength(MAX_ROUTES);
  });
});

describe("fetchRoutes", () => {
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

  it("con token pide a Mapbox la ruta normal y una sin peajes, y junta ambas", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.includes("exclude=toll"))
        return json({ code: "Ok", routes: [route(240_000, 18_000, 0.5)] });
      if (url.includes("api.mapbox.com"))
        return json({ code: "Ok", routes: [route(214_300, 16_200), route(225_000, 17_000, -0.4)] });
      throw new Error("no debería usar OSRM");
    });
    const { fetchRoutes } = await import("./routing");
    const routes = await fetchRoutes([A, B]);
    expect(routes).toHaveLength(3);
    expect(routes[0]?.distanceKm).toBeCloseTo(214.3, 1);
    expect(routes[0]?.driveMinutes).toBeCloseTo(270, 0);
    expect(routes.find((r) => r.noTolls)?.distanceKm).toBeCloseTo(240, 0);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes("alternatives=true"))).toBe(true);
  });

  it("si no existe ruta sin peajes, igual devuelve las normales", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("exclude=toll")) return json({ code: "NoRoute", routes: [] });
      return json({ code: "Ok", routes: [route(214_300, 16_200)] });
    });
    const { fetchRoutes } = await import("./routing");
    expect(await fetchRoutes([A, B])).toHaveLength(1);
  });

  it("si Mapbox falla (p. ej. token restringido), cae a OSRM sin exponer el token en el log", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.secreto.xyz";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("api.mapbox.com")) return json({ message: "Forbidden" }, 403);
      return json({ code: "Ok", routes: [route(198_000, 10_800)] });
    });
    const { fetchRoutes } = await import("./routing");
    const routes = await fetchRoutes([A, B]);
    expect(routes[0]?.distanceKm).toBeCloseTo(198, 0);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("pk.secreto.xyz");
  });

  it("sin token va directo a OSRM y le pide alternativas", async () => {
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    delete process.env.MAPBOX_ACCESS_TOKEN;
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [route(198_000, 10_800)] });
    });
    const { fetchRoutes } = await import("./routing");
    await fetchRoutes([A, B]);
    expect(urls.some((u) => u.includes("mapbox"))).toBe(false);
    expect(urls[0]).toContain("alternatives=3");
  });
});
