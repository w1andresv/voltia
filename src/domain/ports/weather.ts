import type { LatLon, WeatherSnapshot } from "../types";
import type { WeatherSeries } from "../ev/contracts/weather";

/** Condiciones actuales en un punto. `null` si el proveedor no responde (no es un error del plan). */
export interface WeatherProvider {
  readonly id: string;
  current(point: LatLon): Promise<WeatherSnapshot | null>;
  /**
   * Pronóstico por hora en varios puntos (M3.1), en el mismo orden, a partir de la hora
   * actual y por `hours` horas. `null` si el proveedor no responde o no lo tiene.
   * Opcional: sin él, el plan usa el clima actual de un solo punto.
   */
  along?(points: LatLon[], hours: number): Promise<WeatherSeries[] | null>;
}
