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

/**
 * Línea fina de la ruta (M5, ADR-0027) con el km medido en el eje de las MUESTRAS. La geometría
 * guardada tiene cientos de puntos (más que las muestras, que están a ~2 km y cortan las
 * curvas); a cada uno se le da el km de su proyección sobre las muestras, avanzando sin
 * retroceder. Así la línea y las muestras hablan del mismo km aunque la longitud de la geometría
 * reducida difiera un poco de la de las muestras. Si la geometría no es más densa que las
 * muestras, la línea son las muestras.
 */
export function fineRouteLine(
  route: Pick<RawRoute, "geometry" | "samples" | "distanceKm">,
): AxisPoint[] {
  const samples = route.samples;
  const pts = route.geometry;
  if (samples.length < 2 || pts.length <= samples.length) {
    return samples.map(({ lat, lon, km }) => ({ lat, lon, km }));
  }
  // Plano local: suficiente para decidir qué segmento de las muestras queda más cerca.
  const KM_LAT = 110.574;
  const out: AxisPoint[] = [];
  let seg = 0;
  let lastKm = samples[0]!.km;
  for (const p of pts) {
    const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180);
    let bestSeg = seg;
    let bestD = Infinity;
    let bestT = 0;
    // El segmento no retrocede; se mira un poco adelante (los puntos están a ~1 km, los segmentos a ~2 km).
    for (let i = seg; i < Math.min(samples.length - 1, seg + 8); i++) {
      const a = samples[i]!;
      const b = samples[i + 1]!;
      const ax = (a.lon - p.lon) * kx;
      const ay = (a.lat - p.lat) * KM_LAT;
      const dx = (b.lon - a.lon) * kx;
      const dy = (b.lat - a.lat) * KM_LAT;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < bestD - 1e-12) {
        bestD = d;
        bestSeg = i;
        bestT = t;
      }
    }
    seg = bestSeg;
    const a = samples[seg]!;
    const b = samples[seg + 1]!;
    lastKm = Math.max(lastKm, a.km + bestT * (b.km - a.km));
    out.push({ lat: p.lat, lon: p.lon, km: lastKm });
  }
  return out;
}
