import type { WeatherAlongRoute, WeatherSeries } from "@/domain/ev/contracts/weather";
import { pointAtKm, routeLine } from "@/domain/ev/core/axis";
import type { RawRoute, WeatherSnapshot } from "@/domain/types";

/**
 * Clima de un tramo (M3.1, ADR-0024): el de su lugar y el de la hora en que se pasa por él.
 * Interpola linealmente entre las horas de cada serie y, entre los dos puntos de la ruta
 * que rodean al km, por distancia. La dirección del viento se interpola por el arco corto.
 * Función pura: la hora de salida va en los datos, no se lee ningún reloj.
 */

/** Interpola la dirección (grados) por el arco más corto. */
function lerpDeg(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + d * t) % 360) + 360) % 360;
}

/** Valor de una serie horaria en la hora fraccionaria `h` (0 = primera hora), sujeto a sus extremos. */
function atHour(series: number[], h: number, circular = false): number {
  if (!series.length) return 0;
  const x = Math.min(series.length - 1, Math.max(0, h));
  const i = Math.floor(x);
  const t = x - i;
  const a = series[i]!;
  const b = series[Math.min(series.length - 1, i + 1)]!;
  return circular ? lerpDeg(a, b, t) : a + (b - a) * t;
}

/** Clima de un punto a `secondsFromDeparture` de la salida. */
function atTime(
  s: WeatherSeries,
  departIso: string,
  secondsFromDeparture: number,
): Omit<WeatherSnapshot, "source"> {
  const offsetH = (Date.parse(departIso) - Date.parse(s.startIso)) / 3_600_000;
  const h = (Number.isFinite(offsetH) ? offsetH : 0) + secondsFromDeparture / 3600;
  return {
    temperatureC: atHour(s.temperatureC, h),
    windKmh: atHour(s.windKmh, h),
    windDirDeg: atHour(s.windDirDeg, h, true),
    precipitationMm: Math.max(0, atHour(s.precipitationMm, h)),
    ...(s.elevationM != null ? { elevationM: s.elevationM } : {}),
  };
}

export function weatherAtKm(
  field: WeatherAlongRoute,
  km: number,
  secondsFromDeparture: number,
): WeatherSnapshot | null {
  const pts = field.points;
  if (!pts.length) return null;
  const source = field.source ? { source: field.source } : {};
  // Dos puntos que rodean al km (o el más cercano si cae fuera del primero y el último).
  let hi = pts.findIndex((p) => p.km >= km);
  if (hi < 0) hi = pts.length - 1;
  const lo = Math.max(0, hi - 1);
  const a = atTime(pts[lo]!, field.departIso, secondsFromDeparture);
  if (lo === hi) return { ...a, ...source };
  const span = pts[hi]!.km - pts[lo]!.km;
  const t = span > 0 ? Math.min(1, Math.max(0, (km - pts[lo]!.km) / span)) : 0;
  const b = atTime(pts[hi]!, field.departIso, secondsFromDeparture);
  const mix = (x: number, y: number) => x + (y - x) * t;
  const elevationM =
    a.elevationM != null && b.elevationM != null
      ? mix(a.elevationM, b.elevationM)
      : (a.elevationM ?? b.elevationM);
  return {
    temperatureC: mix(a.temperatureC, b.temperatureC),
    windKmh: mix(a.windKmh, b.windKmh),
    windDirDeg: lerpDeg(a.windDirDeg, b.windDirDeg, t),
    precipitationMm: mix(a.precipitationMm ?? 0, b.precipitationMm ?? 0),
    ...(elevationM != null ? { elevationM } : {}),
    ...source,
  };
}

/**
 * Puntos de la ruta donde se pide el pronóstico: el origen, uno cada ~`spacingKm` y el
 * destino, como mucho `maxPoints` (repartidos parejos si la ruta es más larga).
 */
export function weatherPointsAlong(
  route: Pick<RawRoute, "geometry" | "samples" | "distanceKm">,
  spacingKm: number,
  maxPoints: number,
): { lat: number; lon: number; km: number }[] {
  const line = routeLine(route);
  if (line.length < 2 || !(route.distanceKm > 0)) return [];
  const segments = Math.max(1, Math.min(maxPoints - 1, Math.ceil(route.distanceKm / spacingKm)));
  const out: { lat: number; lon: number; km: number }[] = [];
  let from = 1;
  for (let i = 0; i <= segments; i++) {
    const km = (route.distanceKm * i) / segments;
    const hit = pointAtKm(line, km, from);
    from = hit.index;
    out.push({ lat: hit.point.lat, lon: hit.point.lon, km });
  }
  return out;
}
