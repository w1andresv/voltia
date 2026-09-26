import { haversineKm, lerp } from "@/domain/geo";
import type { LatLon, RawRoute } from "@/domain/types";

/**
 * Eje de distancia de la ruta (especificación §3.2): puntos de la línea más
 * detallada que tiene la ruta con su km acumulado, escalado a `distanceKm`
 * para que coincida con el km de las muestras. Lo usan las mallas de
 * elevación y de velocidad.
 */
export interface AxisPoint extends LatLon {
  km: number;
}

export function routeLine(
  route: Pick<RawRoute, "geometry" | "samples" | "distanceKm">,
): AxisPoint[] {
  const pts: LatLon[] =
    route.geometry.length > route.samples.length ? route.geometry : route.samples;
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + haversineKm(pts[i - 1]!, pts[i]!));
  const total = cum[cum.length - 1]!;
  const k = total > 0 ? route.distanceKm / total : 1;
  return pts.map((p, i) => ({ lat: p.lat, lon: p.lon, km: cum[i]! * k }));
}

/**
 * Punto de la línea en el km dado (interpolación lineal). `from` es un índice
 * desde el que buscar hacia adelante (para recorrer la línea en orden sin
 * volver a empezar); devuelve el índice donde quedó.
 */
export function pointAtKm(
  line: AxisPoint[],
  km: number,
  from = 1,
): { point: AxisPoint; index: number } {
  let i = Math.max(1, from);
  while (i < line.length - 1 && line[i]!.km < km) i++;
  const a = line[i - 1]!;
  const b = line[i]!;
  const span = b.km - a.km;
  const t = span > 0 ? Math.min(1, Math.max(0, (km - a.km) / span)) : 0;
  return { point: { lat: lerp(a.lat, b.lat, t), lon: lerp(a.lon, b.lon, t), km }, index: i };
}

/** Valor de una serie por tramos en `km`: el de la muestra que cierra el tramo que contiene ese km. */
export function intervalIndex(samples: { km: number }[], km: number, from = 1): number {
  let i = Math.max(1, from);
  while (i < samples.length - 1 && samples[i]!.km < km - 1e-9) i++;
  return Math.min(i, samples.length - 1);
}
