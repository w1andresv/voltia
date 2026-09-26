/**
 * Desvíos medidos por vía (F4, guía §5.2, DETOUR_SOURCE=matrix). Para cada
 * ruta se toman las estaciones compatibles con el vehículo más cercanas (hasta
 * `maxMatrixStationsPerRoute`) y se pide a la matriz la ida desde el punto de
 * la ruta más cercano y la vuelta. Lo que no se pueda medir queda estimado.
 */
import { detourKey, type MeasuredDetour } from "@/domain/ev/contracts/detour";
import type { ModelParameters } from "@/domain/ev/core/params";
import { routeSocket } from "@/domain/ev/engines/compatibility/engine";
import { placeOnRoute } from "@/domain/ev/engines/corridor/engine";
import type { DistanceMatrixProvider } from "@/domain/ports/distance-matrix";
import type { Charger, LatLon, RawRoute, Vehicle } from "@/domain/types";

export interface DetourReport {
  measured: number;
  requests: number;
  failedBatches: number;
}

interface Pair {
  key: string;
  from: LatLon;
  station: LatLon;
}

/** Diagonal de la matriz: el valor i → i. */
const diag = (m: (number | null)[][], i: number) => m[i]?.[i] ?? null;

export async function measureDetours(
  provider: DistanceMatrixProvider,
  routes: RawRoute[],
  chargers: Charger[],
  vehicle: Vehicle,
  params: ModelParameters,
): Promise<{ detours: Record<string, MeasuredDetour>; report: DetourReport }> {
  const pairs: Pair[] = [];
  for (const route of routes) {
    const placed = placeOnRoute(chargers, route.samples, {
      maxKm: params.corridor.maxFromRouteKm,
      detourRoadFactor: params.corridor.detourRoadFactor.value,
    })
      .filter(
        (c) =>
          c.fromRouteKm >= params.corridor.minLateralKmToMeasure && routeSocket(c, vehicle) != null,
      )
      .sort((a, b) => a.fromRouteKm - b.fromRouteKm)
      .slice(0, params.corridor.maxMatrixStationsPerRoute);
    for (const c of placed) {
      const s = route.samples[c.nearestSampleIndex]!;
      pairs.push({
        key: detourKey(route.id, c.id),
        from: { lat: s.lat, lon: s.lon },
        station: { lat: c.lat, lon: c.lon },
      });
    }
  }

  const detours: Record<string, MeasuredDetour> = {};
  const report: DetourReport = { measured: 0, requests: 0, failedBatches: 0 };
  const batch = Math.max(1, Math.floor(provider.maxCoordinates / 2));
  for (let i = 0; i < pairs.length; i += batch) {
    const group = pairs.slice(i, i + batch);
    try {
      const [go, back] = await Promise.all([
        provider.matrix(
          group.map((p) => p.from),
          group.map((p) => p.station),
        ),
        provider.matrix(
          group.map((p) => p.station),
          group.map((p) => p.from),
        ),
      ]);
      report.requests += 2;
      group.forEach((p, j) => {
        const d1 = diag(go.distanceM, j);
        const d2 = diag(back.distanceM, j);
        const t1 = diag(go.durationS, j);
        const t2 = diag(back.durationS, j);
        if (d1 == null || d2 == null || t1 == null || t2 == null) return;
        detours[p.key] = { distanceKm: (d1 + d2) / 1000, durationMin: (t1 + t2) / 60 };
        report.measured++;
      });
    } catch {
      report.failedBatches++;
    }
  }
  return { detours, report };
}
