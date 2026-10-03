/**
 * Clima a lo largo de una ruta (M3.1, ADR-0024): una serie por hora en varios puntos de la
 * ruta. Con ella la energía v2 usa, en cada tramo, el clima de su lugar y de la hora en que
 * se pasa por él, en vez de un solo punto y el clima de ahora.
 */

/** Pronóstico por hora en un punto: las series empiezan en `startIso` y avanzan de a una hora. */
export interface WeatherSeries {
  lat: number;
  lon: number;
  /** Altura (m) de la celda del pronóstico: la temperatura se corrige desde ahí. */
  elevationM?: number;
  /** Primera hora de las series (ISO 8601, UTC). */
  startIso: string;
  temperatureC: number[];
  windKmh: number[];
  windDirDeg: number[];
  /** Lluvia de cada hora, mm. */
  precipitationMm: number[];
}

/** Las series de los puntos de una ruta, cada uno con su km sobre ella. */
export interface WeatherAlongRoute {
  /** Hora de salida con que se calculó (ISO 8601): el momento en que la ruta está en el km 0. */
  departIso: string;
  source?: string;
  /** Ordenados por km. */
  points: (WeatherSeries & { km: number })[];
}
