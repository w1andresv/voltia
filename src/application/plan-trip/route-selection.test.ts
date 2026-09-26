import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRoute } from "@/domain/ev/contracts/route";
import { fakeMapboxRoute } from "@/test-support/mapbox-fixtures";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => fn,
}));

const A = { lat: 6.9877, lon: -73.0495 }; // Piedecuesta
const B = { lat: 6.0106, lon: -73.6734 }; // Vélez

/** Ruta A → (punto intermedio) → B en formato Directions; `bend` desplaza el intermedio en grados de longitud. */
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

function providerRoute(distanceM: number, durationS: number, bend = 0, summary?: string): ProviderRoute {
  return {
    provider: "mapbox",
    profile: "driving",
    distanceM,
    durationS,
    geometry: [A, { lat: 6.5, lon: -73.36 + bend }, B],
    legs: summary ? [{ summary }] : [],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function mapbox(token = "pk.abc.def") {
  const { MapboxRoutingProvider } = await import("@/infrastructure/providers/adapters");
  return new MapboxRoutingProvider(token);
}

describe("buildRouteSet", () => {
  it("quita duplicados, descarta alternativas absurdas, ordena por tiempo y rotula", async () => {
    const { buildRouteSet } = await import("./route-selection");
    const out = buildRouteSet([
      { route: providerRoute(214_000, 16_200, 0, "Ruta 45A, Ruta 66"), noTolls: false },
      { route: providerRoute(214_500, 16_300, 0), noTolls: true }, // misma vía que la primera
      { route: providerRoute(230_000, 15_900, 0.4), noTolls: false }, // otra vía, más rápida
      { route: providerRoute(400_000, 30_000, -0.6), noTolls: false }, // absurda (> 50 % más larga)
    ]);
    expect(out.map((r) => [r.label, Math.round(r.distanceKm)])).toEqual([
      ["Ruta A", 230],
      ["Ruta B", 214],
    ]);
    expect(out[1]?.noTolls).toBe(true); // heredó "sin peajes" de su duplicado
    expect(out[1]?.via).toBe("Ruta 45A, Ruta 66");
  });

  it("una sola ruta se llama 'Ruta recomendada'", async () => {
    const { buildRouteSet } = await import("./route-selection");
    expect(buildRouteSet([{ route: providerRoute(214_000, 16_200), noTolls: false }])[0]?.label).toBe(
      "Ruta recomendada",
    );
  });

  it("presenta como máximo 4 rutas", async () => {
    const { buildRouteSet, MAX_ROUTES } = await import("./route-selection");
    const many = [0, 0.3, -0.3, 0.6, -0.6, 0.9].map((b, i) => ({
      route: providerRoute(214_000 + i * 1000, 16_000 + i * 100, b),
      noTolls: false,
    }));
    expect(buildRouteSet(many)).toHaveLength(MAX_ROUTES);
  });

  it("sin candidatas no hay rutas", async () => {
    const { buildRouteSet } = await import("./route-selection");
    expect(buildRouteSet([])).toEqual([]);
  });
});

describe("selectRoutes con Mapbox", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pide (perfil driving) la ruta normal y una sin peajes", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.includes("exclude=toll")) return json({ code: "Ok", routes: [route(240_000, 18_000, 0.5)] });
      if (url.includes("api.mapbox.com"))
        return json({ code: "Ok", routes: [route(214_300, 16_200), route(225_000, 17_000, -0.4)] });
      throw new Error("no debería usar OSRM");
    });
    const { selectRoutes } = await import("./route-selection");
    const { routes, engine, warnings } = await selectRoutes(await mapbox(), [A, B]);
    expect(engine).toBe("mapbox");
    expect(warnings).toEqual([]);
    expect(routes).toHaveLength(3);
    expect(routes[0]?.distanceKm).toBeCloseTo(214.3, 1);
    expect(routes[0]?.driveMinutes).toBeCloseTo(270, 0);
    expect(routes[0]?.engine).toBe("mapbox");
    expect(routes.find((r) => r.noTolls)?.distanceKm).toBeCloseTo(240, 0);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes("mapbox/driving/"))).toBe(true);
    expect(urls.every((u) => u.includes("alternatives=true"))).toBe(true);
  });

  it("con más de 2 puntos no pide alternativas y usa driving", async () => {
    const urls: string[] = [];
    const C = { lat: 6.5, lon: -73.3 };
    const D = { lat: 6.2, lon: -73.5 };
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [route(214_300, 16_200)] });
    });
    const { selectRoutes } = await import("./route-selection");
    const { engine } = await selectRoutes(await mapbox(), [A, C, D, B]);
    expect(engine).toBe("mapbox");
    expect(urls.every((u) => u.includes("mapbox/driving/"))).toBe(true);
    expect(urls.every((u) => u.includes("alternatives=false"))).toBe(true);
    expect(urls.some((u) => u.includes("driving-traffic"))).toBe(false);
  });

  it("si no existe ruta sin peajes, igual devuelve las normales", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("exclude=toll")) return json({ code: "NoRoute", routes: [] });
      return json({ code: "Ok", routes: [route(214_300, 16_200)] });
    });
    const { selectRoutes } = await import("./route-selection");
    const { routes, engine } = await selectRoutes(await mapbox(), [A, B]);
    expect(engine).toBe("mapbox");
    expect(routes).toHaveLength(1);
  });

  it("si Mapbox falla, lanza el motivo sin exponer el token", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ message: "Forbidden" }, 403);
    });
    const { selectRoutes } = await import("./route-selection");
    const error = await selectRoutes(await mapbox("pk.secreto.xyz"), [A, B]).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Mapbox");
    expect((error as Error).message).toContain("403");
    expect((error as Error).message).not.toContain("pk.secreto.xyz");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("pk.secreto.xyz");
    expect(urls.every((u) => u.includes("api.mapbox.com"))).toBe(true);
  });

  it("si Mapbox no encuentra camino, lo dice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => json({ code: "NoRoute", routes: [] }));
    const { selectRoutes } = await import("./route-selection");
    await expect(selectRoutes(await mapbox(), [A, B])).rejects.toThrow("Mapbox no encontró un camino");
  });

  it("no envía `language` a Directions (Mapbox lo rechaza sin steps=true)", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [route(212_400, 21_800)] });
    });
    const { selectRoutes } = await import("./route-selection");
    const { routes } = await selectRoutes(await mapbox(), [A, B]);
    expect(routes[0]?.distanceKm).toBeCloseTo(212.4, 1);
    for (const u of urls) {
      const params = new URL(u).searchParams;
      if (params.has("language")) expect(params.get("steps")).toBe("true");
    }
  });

  it("avisa si el origen o el destino quedaron lejos de la vía", async () => {
    vi.stubGlobal("fetch", async () =>
      json({ code: "Ok", routes: [route(214_300, 16_200)], waypoints: [{ distance: 20 }, { distance: 3400 }] }),
    );
    const { selectRoutes } = await import("./route-selection");
    const { warnings } = await selectRoutes(await mapbox(), [A, B]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("El destino está a 3.4 km");
  });
});

describe("selectRoutes con OSRM", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pide alternativas una vez, sin jerarquía, y avisa que no hay token", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [route(198_000, 10_800)] });
    });
    const { selectRoutes } = await import("./route-selection");
    const { OsrmRoutingProvider, OSRM_NO_TOKEN_WARNING } = await import("@/infrastructure/providers/adapters");
    const { engine, warnings, routes } = await selectRoutes(new OsrmRoutingProvider(), [A, B]);
    expect(engine).toBe("osrm");
    expect(warnings).toEqual([OSRM_NO_TOKEN_WARNING]);
    expect(routes[0]?.engine).toBe("osrm");
    expect(routes[0]?.roadMix).toBeUndefined();
    expect(urls.some((u) => u.includes("mapbox"))).toBe(false);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("alternatives=3");
  });
});

describe("snapWarnings", () => {
  it("avisa cuando origen, parada o destino quedan a más de 1 km de la vía", async () => {
    const { snapWarnings } = await import("./route-selection");
    expect(snapWarnings([0.02, 0.3])).toEqual([]);
    const w = snapWarnings([0.02, 3.4]);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("El destino está a 3.4 km");
    expect(snapWarnings([2, 1.5, 0])[1]).toContain("La parada 1");
  });
});

describe("jerarquía vial en selectRoutes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("si la más rápida toma un atajo terciario, pide otra excluyéndolo y recomienda la de vías principales", async () => {
    // Atajo: 200 km, 190 min, con 40 km terciarios a mitad de camino.
    const shortcut = fakeMapboxRoute([
      ["primary", 80, 60],
      ["tertiary", 40, 70],
      ["primary", 80, 60],
    ]);
    // Troncal: 212 km, 205 min, todo principal (distinta vía: desplazada al oeste).
    const trunk = fakeMapboxRoute([["trunk", 212, 205]], undefined, -0.4);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      const exclude = new URL(url).searchParams.get("exclude") ?? "";
      if (exclude.includes("point(")) return json({ code: "Ok", routes: [trunk] });
      return json({ code: "Ok", routes: [shortcut] });
    });
    const { selectRoutes } = await import("./route-selection");
    const { routes } = await selectRoutes(await mapbox(), [A, B]);
    expect(urls.some((u) => /^point\(-73\.\d+ \d/.test(new URL(u).searchParams.get("exclude") ?? ""))).toBe(true);
    expect(routes[0]?.distanceKm).toBeCloseTo(212, 0);
    expect(routes[0]?.roadMix?.primary).toBeCloseTo(212, 0);
    expect(routes[1]?.roadMix?.tertiary).toBeCloseTo(40, 0);
    expect(routes[0]!.hierarchyFactor!).toBeLessThan(routes[1]!.hierarchyFactor!);
    expect(urls.every((u) => new URL(u).searchParams.get("steps") === "true")).toBe(true);
  });

  it("no genera desvíos excesivos: si la troncal tarda > 15 % más, gana el atajo", async () => {
    const shortcut = fakeMapboxRoute([
      ["primary", 80, 60],
      ["tertiary", 20, 30],
      ["primary", 80, 60],
    ]);
    const longTrunk = fakeMapboxRoute([["trunk", 230, 200]], undefined, -0.4); // +33 % tiempo, +28 % km
    vi.stubGlobal("fetch", async (url: string) => {
      const exclude = new URL(url).searchParams.get("exclude") ?? "";
      return json({ code: "Ok", routes: [exclude.includes("point(") ? longTrunk : shortcut] });
    });
    const { selectRoutes } = await import("./route-selection");
    const { routes } = await selectRoutes(await mapbox(), [A, B]);
    expect(routes[0]?.distanceKm).toBeCloseTo(180, 0);
    expect(routes.find((r) => Math.round(r.distanceKm) === 230)?.withinTolerance).toBe(false);
  });

  it("vías menores solo en los accesos no disparan correcciones", async () => {
    const fine = fakeMapboxRoute([
      ["street", 2, 5],
      ["secondary", 2, 3],
      ["trunk", 200, 180],
      ["secondary", 3, 4],
      ["street", 1, 3],
    ]);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [fine] });
    });
    const { selectRoutes } = await import("./route-selection");
    const { routes } = await selectRoutes(await mapbox(), [A, B]);
    expect(urls.some((u) => u.includes("point"))).toBe(false);
    expect(routes[0]?.hierarchyFactor).toBeCloseTo(1, 5);
  });

  it("si la ruta que evita el atajo no existe, se queda con lo que hay", async () => {
    const shortcut = fakeMapboxRoute([
      ["primary", 80, 60],
      ["tertiary", 40, 70],
      ["primary", 80, 60],
    ]);
    vi.stubGlobal("fetch", async (url: string) => {
      const exclude = new URL(url).searchParams.get("exclude") ?? "";
      if (exclude.includes("point(")) return json({ code: "NoRoute", routes: [] });
      return json({ code: "Ok", routes: [shortcut] });
    });
    const { selectRoutes } = await import("./route-selection");
    const { routes } = await selectRoutes(await mapbox(), [A, B]);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.roadMix?.tertiary).toBeCloseTo(40, 0);
  });

  it("caso real Piedecuesta → Vélez: entre un atajo de 199 km con 16 km terciarios y la troncal de 212 km, recomienda la troncal", async () => {
    // Atajo: 91 % principal + 8 % terciaria en la mitad; más rápido (310 min).
    const shortcut = fakeMapboxRoute([
      ["trunk", 90, 140],
      ["tertiary", 16, 30],
      ["primary", 93, 140],
    ]);
    // Troncal: 99 % principal, 212 km, 340 min (≤ +15 %, ≤ +10 % km).
    const trunk = fakeMapboxRoute(
      [
        ["trunk", 110, 180],
        ["primary", 102, 160],
      ],
      undefined,
      -0.4,
    );
    vi.stubGlobal("fetch", async () => json({ code: "Ok", routes: [shortcut, trunk] }));
    const { selectRoutes } = await import("./route-selection");
    const { routes } = await selectRoutes(await mapbox(), [A, B]);
    expect(Math.round(routes[0]!.distanceKm)).toBe(212);
    expect(routes[0]?.label).toBe("Ruta A");
    expect(routes[1]?.roadMix?.tertiary).toBeCloseTo(16, 0);
  });
});
