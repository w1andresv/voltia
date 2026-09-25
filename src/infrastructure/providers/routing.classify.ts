import { haversineKm } from "@/domain/geo";
import { tierOfClass, type RoadSegment, type RoadTier } from "@/domain/road-hierarchy";
import type { LatLon } from "@/domain/types";
import type { OsrmRoute } from "./routing.osrm";

function toLatLon([lon, lat]: [number, number]): LatLon {
  return { lat, lon };
}

function nearestIndex(line: LatLon[], p: LatLon, from: number): number {
  let best = from;
  let bestD = Infinity;
  for (let i = from; i < line.length; i++) {
    const d = haversineKm(line[i]!, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Parte cada paso de Mapbox en tramos por clase vial: la clase de una
 * intersección aplica a la vía que sale de ella hasta la siguiente
 * intersección. Duración repartida según la longitud. Sin pasos (OSRM o
 * steps=false) devuelve [] y la ruta queda "sin clasificar".
 */
export function classifyRoute(route: OsrmRoute): RoadSegment[] {
  const segments: RoadSegment[] = [];
  let km = 0;
  let lastTier: RoadTier = "unknown";
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const stepKm = step.distance / 1000;
      const line = (step.geometry?.coordinates ?? []).map(toLatLon);
      const inters = step.intersections ?? [];
      if (stepKm <= 0) continue;
      if (line.length < 2 || inters.length === 0) {
        const firstClass = inters[0]?.mapbox_streets_v8?.class;
        const tier: RoadTier = firstClass ? tierOfClass(firstClass) : lastTier;
        segments.push({ tier, startKm: km, endKm: km + stepKm, durationS: step.duration, line });
        km += stepKm;
        lastTier = tier;
        continue;
      }
      // Longitud acumulada de la geometría del paso, escalada a su distancia oficial.
      const cum = [0];
      for (let i = 1; i < line.length; i++)
        cum.push(cum[i - 1]! + haversineKm(line[i - 1]!, line[i]!));
      const geomKm = cum[cum.length - 1]! || stepKm;
      const scale = stepKm / geomKm;

      const cuts: { idx: number; tier: RoadTier }[] = [];
      let from = 0;
      for (const it of inters) {
        const idx = nearestIndex(line, toLatLon(it.location), from);
        const cls = it.mapbox_streets_v8?.class;
        const tier: RoadTier = cls ? tierOfClass(cls) : (cuts[cuts.length - 1]?.tier ?? lastTier);
        cuts.push({ idx, tier });
        from = idx;
      }
      if (cuts[0]!.idx !== 0) cuts.unshift({ idx: 0, tier: cuts[0]!.tier });

      for (let c = 0; c < cuts.length; c++) {
        const a = cuts[c]!.idx;
        const b = c + 1 < cuts.length ? cuts[c + 1]!.idx : line.length - 1;
        if (b <= a) continue;
        const partKm = (cum[b]! - cum[a]!) * scale;
        const prev = segments[segments.length - 1];
        const tier: RoadTier = cuts[c]!.tier;
        const piece: RoadSegment = {
          tier,
          startKm: km + cum[a]! * scale,
          endKm: km + cum[a]! * scale + partKm,
          durationS: step.duration * (partKm / stepKm),
          line: line.slice(a, b + 1),
        };
        // Tramos contiguos de la misma clase se unen.
        if (prev && prev.tier === tier && Math.abs(prev.endKm - piece.startKm) < 0.01) {
          prev.endKm = piece.endKm;
          prev.durationS += piece.durationS;
          prev.line.push(...piece.line.slice(1));
        } else {
          segments.push(piece);
        }
        lastTier = tier;
      }
      km += stepKm;
    }
  }
  return segments;
}

/** Km desde el origen donde está cada punto intermedio (fin de cada tramo salvo el último). */
export function legBoundariesKm(route: OsrmRoute): number[] {
  const legs = route.legs ?? [];
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < legs.length - 1; i++) {
    const leg = legs[i]!;
    acc += (leg.distance ?? (leg.steps ?? []).reduce((a, s) => a + s.distance, 0)) / 1000;
    out.push(acc);
  }
  return out;
}
