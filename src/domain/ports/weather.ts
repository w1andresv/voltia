import type { LatLon, WeatherSnapshot } from "../types";

/** Condiciones actuales en un punto. `null` si el proveedor no responde (no es un error del plan). */
export interface WeatherProvider {
  readonly id: string;
  current(point: LatLon): Promise<WeatherSnapshot | null>;
}
