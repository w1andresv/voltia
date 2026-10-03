import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));

/**
 * Pronóstico por hora en varios puntos (M3.1, ADR-0024). Las respuestas tienen la forma que
 * documenta Open-Meteo (`hourly` con `time` y las series; un arreglo con varios puntos) pero
 * son sintéticas: aún no se contrastó con una consulta real.
 */
function hourly(start: string, n: number, base: number, nulls: number[] = []) {
  const t0 = Date.parse(`${start}Z`);
  const series = (v: number) =>
    Array.from({ length: n }, (_, i) => (nulls.includes(i) ? null : v + i));
  return {
    time: Array.from({ length: n }, (_, i) => new Date(t0 + i * 3_600_000).toISOString().slice(0, 16)),
    temperature_2m: series(base),
    wind_speed_10m: series(5),
    wind_direction_10m: series(90),
    precipitation: series(0),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // La memoria de fetchJson guarda la respuesta por URL: una prueba no debe ver la de otra.
  (await import("./http")).clearProviderMemory();
});

async function along(body: unknown, now = "2026-10-03T14:20:00Z") {
  (await import("./http")).clearProviderMemory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const { fetchWeatherAlong } = await import("./weather.openmeteo");
  const points = [
    { lat: 7.1193, lon: -73.1227 },
    { lat: 4.711, lon: -74.0721 },
  ];
  return { out: await fetchWeatherAlong(points, 6), urls, points };
}

describe("fetchWeatherAlong", () => {
  it("una consulta con todos los puntos (coordenadas redondeadas) y las horas en GMT", async () => {
    const { urls } = await along([
      { elevation: 960, hourly: hourly("2026-10-03T13:00", 24, 20) },
      { elevation: 2600, hourly: hourly("2026-10-03T13:00", 24, 12) },
    ]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("latitude=7.10,4.70");
    expect(urls[0]).toContain("longitude=-73.10,-74.05");
    expect(urls[0]).toContain("timezone=GMT");
    expect(urls[0]).toContain("forecast_hours=6");
    expect(urls[0]).toContain("hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation");
  });

  it("las series empiezan en la hora actual, aunque la respuesta traiga horas anteriores", async () => {
    // Son las 14:20: la serie arranca 12:00, así que la hora actual es la tercera (14:00).
    const { out, points } = await along([
      { elevation: 960, hourly: hourly("2026-10-03T12:00", 24, 20) },
      { elevation: 2600, hourly: hourly("2026-10-03T12:00", 24, 12) },
    ]);
    expect(out).toHaveLength(2);
    expect(out![0]).toMatchObject({
      lat: points[0]!.lat,
      lon: points[0]!.lon,
      elevationM: 960,
      startIso: "2026-10-03T14:00:00.000Z",
    });
    expect(out![0]!.temperatureC).toHaveLength(6);
    expect(out![0]!.temperatureC[0]).toBe(22); // 20 + índice 2
    expect(out![1]!.temperatureC[0]).toBe(14);
  });

  it("una respuesta de un solo punto (objeto, no arreglo) también sirve", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T14:20:00Z"));
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ elevation: 960, hourly: hourly("2026-10-03T14:00", 24, 20) }), { status: 200 }),
    );
    const { fetchWeatherAlong } = await import("./weather.openmeteo");
    const out = await fetchWeatherAlong([{ lat: 7.1, lon: -73.1 }], 6);
    expect(out).toHaveLength(1);
    expect(out![0]!.temperatureC[0]).toBe(20);
  });

  it("los huecos (null) se rellenan con el valor anterior; sin ningún dato, no hay clima", async () => {
    const holes = await along([
      { hourly: hourly("2026-10-03T14:00", 24, 20, [1, 2]) },
      { hourly: hourly("2026-10-03T14:00", 24, 12) },
    ]);
    expect(holes.out![0]!.temperatureC.slice(0, 4)).toEqual([20, 20, 20, 23]);
    const empty = await along([
      { hourly: { ...hourly("2026-10-03T14:00", 3, 20), temperature_2m: [null, null, null] } },
      { hourly: hourly("2026-10-03T14:00", 24, 12) },
    ]);
    expect(empty.out).toBeNull();
  });

  it("si la respuesta no cuadra (otra forma, otra cantidad de puntos, error HTTP), devuelve null", async () => {
    expect((await along({ error: true, reason: "x" })).out).toBeNull();
    expect((await along([{ hourly: hourly("2026-10-03T14:00", 24, 20) }])).out).toBeNull();
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    const { fetchWeatherAlong } = await import("./weather.openmeteo");
    expect(await fetchWeatherAlong([{ lat: 7, lon: -73 }], 6)).toBeNull();
  });
});

describe("fetchWeather (punto actual)", () => {
  it("pide la precipitación y redondea las coordenadas a 0,05°", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({
          elevation: 960,
          current: { temperature_2m: 21, wind_speed_10m: 8, wind_direction_10m: 120, precipitation: 1.4 },
        }),
        { status: 200 },
      );
    });
    const { fetchWeather } = await import("./weather.openmeteo");
    const w = await fetchWeather({ lat: 7.1193, lon: -73.1227 });
    expect(urls[0]).toContain("latitude=7.10&longitude=-73.10");
    expect(urls[0]).toContain("precipitation");
    expect(w).toMatchObject({ temperatureC: 21, precipitationMm: 1.4, elevationM: 960 });
  });
});
