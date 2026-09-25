import type { LatLon } from "./types";

const R_KM = 6371;

export function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function polylineLengthKm(points: LatLon[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += haversineKm(points[i - 1]!, points[i]!);
  }
  return km;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function interpolatePoint(a: LatLon, b: LatLon, t: number): LatLon {
  return { lat: lerp(a.lat, b.lat, t), lon: lerp(a.lon, b.lon, t) };
}

/** Resample a polyline to roughly even spacing. */
export function resamplePolyline(points: LatLon[], everyKm: number): LatLon[] {
  if (points.length < 2) return points.slice();
  const out: LatLon[] = [points[0]!];
  let acc = 0;
  let nextAt = everyKm;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = haversineKm(a, b);
    if (d === 0) continue;
    while (acc + d >= nextAt) {
      const t = (nextAt - acc) / d;
      out.push(interpolatePoint(a, b, t));
      nextAt += everyKm;
    }
    acc += d;
  }
  const last = points[points.length - 1]!;
  const tail = out[out.length - 1]!;
  if (haversineKm(tail, last) > everyKm * 0.15) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

export function cumulativeKm(points: LatLon[]): number[] {
  const c = [0];
  for (let i = 1; i < points.length; i++) {
    c.push(c[i - 1]! + haversineKm(points[i - 1]!, points[i]!));
  }
  return c;
}

/** Distance from a point to the nearest vertex of a polyline, in km. */
export function distanceToPolylineKm(point: LatLon, line: LatLon[]): number {
  let min = Infinity;
  for (const p of line) {
    const d = haversineKm(point, p);
    if (d < min) min = d;
  }
  return min;
}

export function nearestIndex(point: LatLon, line: LatLon[]): number {
  let min = Infinity;
  let idx = 0;
  for (let i = 0; i < line.length; i++) {
    const d = haversineKm(point, line[i]!);
    if (d < min) {
      min = d;
      idx = i;
    }
  }
  return idx;
}

export function boundsOf(points: LatLon[], padDeg = 0.08): {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
} {
  let minLat = 90,
    maxLat = -90,
    minLon = 180,
    maxLon = -180;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return {
    minLat: minLat - padDeg,
    maxLat: maxLat + padDeg,
    minLon: minLon - padDeg,
    maxLon: maxLon + padDeg,
  };
}

export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(items[Math.round(i * step)]!);
  }
  return out;
}

export function uniqueByProximity<T extends LatLon>(items: T[], minKm: number): T[] {
  const kept: T[] = [];
  for (const item of items) {
    if (kept.some((k) => haversineKm(k, item) < minKm)) continue;
    kept.push(item);
  }
  return kept;
}

/**
 * Qué fracción del recorrido `b` va por encima de `a` (0–1), con una tolerancia
 * de `toleranceKm`. Sirve para descartar rutas "alternativas" que en realidad
 * son la misma con otro redondeo.
 */
export function routeOverlap(a: LatLon[], b: LatLon[], toleranceKm = 0.4): number {
  if (a.length < 2 || b.length < 2) return 0;
  const dense = resamplePolyline(a, 0.5);
  const probes = downsample(resamplePolyline(b, 1), 250);
  let near = 0;
  for (const p of probes) if (distanceToPolylineKm(p, dense) <= toleranceKm) near++;
  return near / probes.length;
}

/** Rumbo de `a` hacia `b`, en grados (0 = norte, 90 = este). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dl = toRad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
