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
