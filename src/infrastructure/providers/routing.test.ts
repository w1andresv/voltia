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

  it("con token pide a Mapbox (perfil driving) la ruta normal y una sin peajes", async () => {
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
    const { routes, engine, warnings } = await fetchRoutes([A, B]);
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

  it("con más de 3 puntos usa driving (GET driving-traffic solo admite 3)", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    const urls: string[] = [];
    const C = { lat: 6.5, lon: -73.3 };
    const D = { lat: 6.2, lon: -73.5 };
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [route(214_300, 16_200)] });
    });
    const { fetchRoutes } = await import("./routing");
    const { engine } = await fetchRoutes([A, C, D, B]);
    expect(engine).toBe("mapbox");
    expect(urls.every((u) => u.includes("mapbox/driving/"))).toBe(true);
    expect(urls.some((u) => u.includes("driving-traffic"))).toBe(false);
  });

  it("nunca usa driving-traffic (elegía atajos terciarios según el tráfico del momento)", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [route(212_400, 21_400)] });
    });
    const { fetchRoutes } = await import("./routing");
    await fetchRoutes([A, B]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((u) => u.includes("driving-traffic"))).toBe(false);
  });

  it("si no existe ruta sin peajes, igual devuelve las normales", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("exclude=toll")) return json({ code: "NoRoute", routes: [] });
      return json({ code: "Ok", routes: [route(214_300, 16_200)] });
    });
    const { fetchRoutes } = await import("./routing");
    const { routes, engine } = await fetchRoutes([A, B]);
    expect(engine).toBe("mapbox");
    expect(routes).toHaveLength(1);
  });

  it("con token NUNCA cae a OSRM: si Mapbox falla, lanza el motivo sin exponer el token", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.secreto.xyz";
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.includes("api.mapbox.com")) return json({ message: "Forbidden" }, 403);
      return json({ code: "Ok", routes: [route(198_000, 10_800)] });
    });
    const { fetchRoutes } = await import("./routing");
    const error = await fetchRoutes([A, B]).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Mapbox");
    expect((error as Error).message).toContain("403");
    expect((error as Error).message).not.toContain("pk.secreto.xyz");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("pk.secreto.xyz");
    expect(urls.some((u) => !u.includes("api.mapbox.com"))).toBe(false);
  });

  it("si Mapbox no encuentra camino, lo dice (sin OSRM)", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => json({ code: "NoRoute", routes: [] }));
    const { fetchRoutes } = await import("./routing");
    await expect(fetchRoutes([A, B])).rejects.toThrow("Mapbox no encontró un camino");
  });

  it("no envía `language` a Directions (Mapbox lo rechaza sin steps=true)", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [route(212_400, 21_800)] });
    });
    const { fetchRoutes } = await import("./routing");
    const { routes } = await fetchRoutes([A, B]);
    expect(routes[0]?.distanceKm).toBeCloseTo(212.4, 1);
    for (const u of urls) {
      const params = new URL(u).searchParams;
      if (params.has("language")) expect(params.get("steps")).toBe("true");
    }
  });

  it("sin token va directo a OSRM, pide alternativas y avisa", async () => {
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    delete process.env.MAPBOX_ACCESS_TOKEN;
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return json({ code: "Ok", routes: [route(198_000, 10_800)] });
    });
    const { fetchRoutes, OSRM_NO_TOKEN_WARNING } = await import("./routing");
    const { engine, warnings } = await fetchRoutes([A, B]);
    expect(engine).toBe("osrm");
    expect(warnings).toContain(OSRM_NO_TOKEN_WARNING);
    expect(urls.some((u) => u.includes("mapbox"))).toBe(false);
    expect(urls[0]).toContain("alternatives=3");
  });
});

describe("snapWarnings", () => {
  it("avisa cuando origen o destino quedan a más de 1 km de la vía", async () => {
    const { snapWarnings } = await import("./routing");
    expect(snapWarnings([0.02, 0.3])).toEqual([]);
    const w = snapWarnings([0.02, 3.4]);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("El destino está a 3.4 km");
  });
});

describe("jerarquía vial en fetchRoutes", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("si la más rápida toma un atajo terciario, pide otra excluyéndolo y recomienda la de vías principales", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    const { fakeMapboxRoute } = await import("./mapbox-fixtures");
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
    const { fetchRoutes } = await import("./routing");
    const { routes } = await fetchRoutes([A, B]);
    expect(
      urls.some((u) => /^point\(-73\.\d+ \d/.test(new URL(u).searchParams.get("exclude") ?? "")),
    ).toBe(true);
    expect(routes[0]?.distanceKm).toBeCloseTo(212, 0);
    expect(routes[0]?.roadMix?.primary).toBeCloseTo(212, 0);
    expect(routes[1]?.roadMix?.tertiary).toBeCloseTo(40, 0);
    expect(routes[0]!.hierarchyFactor!).toBeLessThan(routes[1]!.hierarchyFactor!);
    expect(urls.every((u) => new URL(u).searchParams.get("steps") === "true")).toBe(true);
  });

  it("no genera desvíos excesivos: si la troncal tarda > 15 % más, gana el atajo", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    const { fakeMapboxRoute } = await import("./mapbox-fixtures");
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
    const { fetchRoutes } = await import("./routing");
    const { routes } = await fetchRoutes([A, B]);
    expect(routes[0]?.distanceKm).toBeCloseTo(180, 0);
    expect(routes.find((r) => Math.round(r.distanceKm) === 230)?.withinTolerance).toBe(false);
  });

  it("vías menores solo en los accesos no disparan correcciones", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    const { fakeMapboxRoute } = await import("./mapbox-fixtures");
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
    const { fetchRoutes } = await import("./routing");
    const { routes } = await fetchRoutes([A, B]);
    expect(urls.some((u) => u.includes("point"))).toBe(false);
    expect(routes[0]?.hierarchyFactor).toBeCloseTo(1, 5);
  });
});

describe("caso real Piedecuesta → Vélez (cifras del diagnóstico)", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("entre un atajo de 199 km con 16 km terciarios y la troncal de 212 km, recomienda la troncal", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.abc.def";
    const { fakeMapboxRoute } = await import("./mapbox-fixtures");
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
    const { fetchRoutes } = await import("./routing");
    const { routes } = await fetchRoutes([A, B]);
    expect(Math.round(routes[0]!.distanceKm)).toBe(212);
    expect(routes[0]?.label).toBe("Ruta A");
    expect(routes[1]?.roadMix?.tertiary).toBeCloseTo(16, 0);
  });
});
