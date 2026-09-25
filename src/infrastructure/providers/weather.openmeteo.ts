import type { LatLon, WeatherSnapshot } from "@/domain/types";
import { fetchJson } from "./http";

interface WeatherResponse {
  elevation?: number;
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
}

export async function fetchWeather(point: LatLon): Promise<WeatherSnapshot | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;
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
      elevationM: Number.isFinite(data.elevation) ? data.elevation : undefined,
      source: "Open-Meteo",
    };
  } catch {
    return null;
  }
}
