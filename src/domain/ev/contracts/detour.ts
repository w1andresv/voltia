/**
 * Desvío medido por vía (F4, guía §5.2): ida desde el punto de la ruta más
 * cercano a la estación y vuelta a él, según la matriz de distancias del
 * proveedor. Reemplaza la estimación 2 × distancia en línea recta × factor.
 */
export interface MeasuredDetour {
  /** Ida y vuelta, km. */
  distanceKm: number;
  /** Ida y vuelta, min. */
  durationMin: number;
}

/** Clave de un desvío en el snapshot: ruta y estación. */
export function detourKey(routeId: string, stationId: string): string {
  return `${routeId}|${stationId}`;
}

/** Los desvíos de una ruta, por id de estación. */
export function detoursForRoute(
  detours: Record<string, MeasuredDetour> | undefined,
  routeId: string,
): Record<string, MeasuredDetour> | undefined {
  if (!detours) return undefined;
  const prefix = `${routeId}|`;
  const out: Record<string, MeasuredDetour> = {};
  for (const [k, v] of Object.entries(detours)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return Object.keys(out).length ? out : undefined;
}
