import { z } from "zod";
import type { WeatherSeries } from "@/domain/ev/contracts/weather";
import type { LatLon, WeatherSnapshot } from "@/domain/types";
import { fetchJson } from "./http";

interface WeatherResponse {
  elevation?: number;
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    precipitation?: number;
  };
}

/**
 * El pronóstico de Open-Meteo viene en una malla de ~0,1°: se pide en un punto redondeado a
 * 0,05° (~5 km), así viajes cercanos comparten la misma consulta y la misma caché.
 */
export const WEATHER_COORD_STEP_DEG = 0.05;
const roundCoord = (v: number) => Math.round(v / WEATHER_COORD_STEP_DEG) * WEATHER_COORD_STEP_DEG;

export async function fetchWeather(point: LatLon): Promise<WeatherSnapshot | null> {
  const lat = roundCoord(point.lat).toFixed(2);
  const lon = roundCoord(point.lon).toFixed(2);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kmh`;
  try {
    const data = await fetchJson<WeatherResponse>(url, {
      timeoutMs: 8000,
      cacheTtlMs: 20 * 60_000,
    });
    const c = data.current;
    if (!c) return null;
    return {
      temperatureC: c.temperature_2m ?? 20,
      windKmh: c.wind_speed_10m ?? 0,
      windDirDeg: c.wind_direction_10m ?? 0,
      ...(typeof c.precipitation === "number" && Number.isFinite(c.precipitation)
        ? { precipitationMm: c.precipitation }
        : {}),
      elevationM: Number.isFinite(data.elevation) ? data.elevation : undefined,
      source: "Open-Meteo",
    };
  } catch {
    return null;
  }
}

/** Una serie por hora; Open-Meteo manda `null` donde no tiene dato. */
const HourlySchema = z.object({
  time: z.array(z.string()),
  temperature_2m: z.array(z.number().nullable()),
  wind_speed_10m: z.array(z.number().nullable()),
  wind_direction_10m: z.array(z.number().nullable()),
  precipitation: z.array(z.number().nullable()),
});
const PointSchema = z
  .object({ elevation: z.number().optional(), hourly: HourlySchema })
  .passthrough();
/** Con un solo punto la respuesta es un objeto; con varios, un arreglo en el mismo orden. */
const AlongSchema = z.union([PointSchema.transform((p) => [p]), z.array(PointSchema)]);

/** Rellena los huecos (`null`) con el valor anterior (o el siguiente al principio); null si no hay ninguno. */
function filled(values: (number | null)[]): number[] | null {
  const first = values.find((v): v is number => v != null);
  if (first == null) return null;
  let last = first;
  return values.map((v) => (last = v ?? last));
}

/**
 * Pronóstico por hora en varios puntos (M3.1, ADR-0024): una sola consulta, a partir de la
 * hora actual y por `hours` horas. Las horas se piden en GMT. Devuelve null si algo no
 * cuadra (otra forma de respuesta, otra cantidad de puntos, series sin datos): el plan
 * sigue con el clima actual de un punto.
 */
export async function fetchWeatherAlong(
  points: LatLon[],
  hours: number,
): Promise<WeatherSeries[] | null> {
  if (!points.length) return null;
  const lats = points.map((p) => roundCoord(p.lat).toFixed(2)).join(",");
  const lons = points.map((p) => roundCoord(p.lon).toFixed(2)).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation` +
    `&wind_speed_unit=kmh&timezone=GMT&forecast_hours=${hours}`;
  try {
    const raw = await fetchJson<unknown>(url, { timeoutMs: 8000, cacheTtlMs: 20 * 60_000 });
    const parsed = AlongSchema.safeParse(raw);
    if (!parsed.success || parsed.data.length !== points.length) return null;
    const now = Date.now();
    const out: WeatherSeries[] = [];
    for (const [i, p] of parsed.data.entries()) {
      const h = p.hourly;
      const times = h.time.map((t) => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`));
      if (times.some((t) => !Number.isFinite(t))) return null;
      // La hora actual: la última que no pasa de ahora (aunque la respuesta traiga horas anteriores).
      let from = 0;
      while (from + 1 < times.length && times[from + 1]! <= now) from++;
      const slice = (v: (number | null)[]) => filled(v.slice(from, from + hours));
      const temperatureC = slice(h.temperature_2m);
      const windKmh = slice(h.wind_speed_10m);
      const windDirDeg = slice(h.wind_direction_10m);
      const precipitationMm = slice(h.precipitation);
      if (!temperatureC || !windKmh || !windDirDeg || !precipitationMm) return null;
      out.push({
        lat: points[i]!.lat,
        lon: points[i]!.lon,
        ...(Number.isFinite(p.elevation) ? { elevationM: p.elevation } : {}),
        startIso: new Date(times[from]!).toISOString(),
        temperatureC,
        windKmh,
        windDirDeg,
        precipitationMm,
      });
    }
    return out;
  } catch {
    return null;
  }
}
