import { describe, expect, it } from "vitest";
import type { WeatherAlongRoute, WeatherSeries } from "@/domain/ev/contracts/weather";
import { weatherAtKm, weatherPointsAlong } from "./weather-field";

/** Serie de 6 horas desde las 12:00 UTC, con una variable que sube 1 por hora. */
function series(over: Partial<WeatherSeries> = {}): WeatherSeries {
  const ramp = (from: number) => [0, 1, 2, 3, 4, 5].map((h) => from + h);
  return {
    lat: 7,
    lon: -73,
    elevationM: 1000,
    startIso: "2026-10-03T12:00:00.000Z",
    temperatureC: ramp(10),
    windKmh: ramp(20),
    windDirDeg: [0, 0, 0, 0, 0, 0],
    precipitationMm: [0, 0, 0, 2, 2, 2],
    ...over,
  };
}
const field = (points: WeatherAlongRoute["points"], departIso = "2026-10-03T12:00:00.000Z"): WeatherAlongRoute => ({
  departIso,
  points,
});

describe("weatherAtKm (M3.1)", () => {
  it("sin puntos no hay clima", () => {
    expect(weatherAtKm(field([]), 10, 0)).toBeNull();
  });

  it("un solo punto vale para toda la ruta", () => {
    const f = field([{ ...series(), km: 0 }]);
    expect(weatherAtKm(f, 0, 0)!.temperatureC).toBe(10);
    expect(weatherAtKm(f, 500, 0)!.temperatureC).toBe(10);
  });

  it("interpola entre horas según el tiempo desde la salida", () => {
    const f = field([{ ...series(), km: 0 }]);
    expect(weatherAtKm(f, 0, 0)!.temperatureC).toBe(10);
    expect(weatherAtKm(f, 0, 3600)!.temperatureC).toBe(11);
    expect(weatherAtKm(f, 0, 5400)!.temperatureC).toBeCloseTo(11.5, 12);
    expect(weatherAtKm(f, 0, 7200)!.windKmh).toBe(22);
  });

  it("una salida con minutos de diferencia empieza dentro de la primera hora", () => {
    const f = field([{ ...series(), km: 0 }], "2026-10-03T12:30:00.000Z");
    expect(weatherAtKm(f, 0, 0)!.temperatureC).toBeCloseTo(10.5, 12);
  });

  it("fuera del rango de la serie se queda con el primer o el último valor", () => {
    const f = field([{ ...series(), km: 0 }]);
    expect(weatherAtKm(f, 0, -7200)!.temperatureC).toBe(10);
    expect(weatherAtKm(f, 0, 100 * 3600)!.temperatureC).toBe(15);
    // Salir antes de que empiece la serie.
    const early = field([{ ...series(), km: 0 }], "2026-10-03T08:00:00.000Z");
    expect(weatherAtKm(early, 0, 0)!.temperatureC).toBe(10);
  });

  it("entre dos puntos mezcla por distancia", () => {
    const f = field([
      { ...series({ temperatureC: [10, 10, 10, 10, 10, 10], elevationM: 500 }), km: 0 },
      { ...series({ temperatureC: [20, 20, 20, 20, 20, 20], elevationM: 2500 }), km: 100 },
    ]);
    const w = weatherAtKm(f, 25, 0)!;
    expect(w.temperatureC).toBeCloseTo(12.5, 12);
    expect(w.elevationM).toBeCloseTo(1000, 12);
    // Antes del primer punto y después del último: el más cercano.
    expect(weatherAtKm(f, -5, 0)!.temperatureC).toBe(10);
    expect(weatherAtKm(f, 400, 0)!.temperatureC).toBe(20);
  });

  it("la dirección del viento se interpola por el arco corto (350° y 10° dan 0°, no 180°)", () => {
    const f = field([
      { ...series({ windDirDeg: [350, 350, 350, 350, 350, 350] }), km: 0 },
      { ...series({ windDirDeg: [10, 10, 10, 10, 10, 10] }), km: 100 },
    ]);
    const d = weatherAtKm(f, 50, 0)!.windDirDeg;
    expect(Math.min(d, 360 - d)).toBeCloseTo(0, 9);
  });

  it("la lluvia que empieza en la tercera hora solo llega a los tramos de esa hora", () => {
    const f = field([{ ...series(), km: 0 }]);
    expect(weatherAtKm(f, 0, 0)!.precipitationMm).toBe(0);
    expect(weatherAtKm(f, 0, 3 * 3600)!.precipitationMm).toBe(2);
  });

  it("es determinista y no modifica los datos", () => {
    const f = field([{ ...series(), km: 0 }]);
    const before = JSON.stringify(f);
    expect(weatherAtKm(f, 10, 1234)).toEqual(weatherAtKm(f, 10, 1234));
    expect(JSON.stringify(f)).toBe(before);
  });
});

describe("weatherPointsAlong", () => {
  const route = (km: number) => {
    const n = 60;
    const samples = Array.from({ length: n + 1 }, (_, i) => ({
      km: (km * i) / n,
      lat: 7 - ((km * i) / n) / 111.2,
      lon: -73,
      elevM: 0,
      slopePct: 0,
      speedKmh: 60,
    }));
    return { geometry: samples.map(({ lat, lon }) => ({ lat, lon })), samples, distanceKm: km };
  };

  it("origen, uno cada ~50 km y destino", () => {
    const pts = weatherPointsAlong(route(200), 50, 10);
    expect(pts.map((p) => Math.round(p.km))).toEqual([0, 50, 100, 150, 200]);
    expect(pts[0]!.lat).toBeCloseTo(7, 6);
    expect(pts[4]!.lat).toBeCloseTo(7 - 200 / 111.2, 4);
  });

  it("una ruta corta tiene al menos origen y destino", () => {
    expect(weatherPointsAlong(route(8), 50, 10).map((p) => p.km)).toEqual([0, 8]);
  });

  it("una ruta larga se reparte en como mucho `maxPoints` puntos", () => {
    const pts = weatherPointsAlong(route(1500), 50, 10);
    expect(pts).toHaveLength(10);
    expect(pts[9]!.km).toBeCloseTo(1500, 6);
  });
});
