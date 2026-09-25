import { primaryShare } from "./road-hierarchy";
import type { RoutePlan } from "./types";

export type RouteHighlight =
  "most_primary" | "fastest" | "shortest" | "fewest_stops" | "no_tolls" | "best_arrival";

export const HIGHLIGHT_LABEL: Record<RouteHighlight, string> = {
  most_primary: "Más vías principales",
  fastest: "Más rápida",
  shortest: "Más corta",
  fewest_stops: "Menos paradas",
  no_tolls: "Sin peajes",
  best_arrival: "Más batería al llegar",
};

type Comparable = Pick<
  RoutePlan,
  "id" | "totalMinutes" | "distanceKm" | "stops" | "arrivalSoc" | "noTolls" | "feasible" | "roadMix"
>;

/** Id de la única ruta con el mejor valor, o null si hay empate (no destaca a nadie). */
function uniqueBest<T extends Comparable>(
  plans: T[],
  value: (p: T) => number,
  tolerance: number,
): string | null {
  const sorted = [...plans].sort((a, b) => value(a) - value(b));
  const [first, second] = sorted;
  if (!first) return null;
  if (second && value(second) - value(first) <= tolerance) return null;
  return first.id;
}

/**
 * Etiquetas para comparar rutas de un vistazo. Solo con 2 o más rutas, y solo
 * cuando la diferencia se nota (1 min, 1 km, 1 parada, 2 puntos de batería).
 * "Sin peajes" viene del motor de rutas y se muestra siempre.
 */
export function routeHighlights<T extends Comparable>(plans: T[]): Map<string, RouteHighlight[]> {
  const out = new Map<string, RouteHighlight[]>(plans.map((p) => [p.id, []]));
  const add = (id: string | null, h: RouteHighlight) => {
    if (id) out.get(id)?.push(h);
  };
  const feasible = plans.filter((p) => p.feasible);
  if (feasible.length >= 2) {
    // Solo si el proveedor clasificó las vías de todas (3 puntos de diferencia mínima).
    if (feasible.every((p) => p.roadMix)) {
      add(
        uniqueBest(feasible, (p) => -primaryShare(p.roadMix!), 0.03),
        "most_primary",
      );
    }
    add(
      uniqueBest(feasible, (p) => p.totalMinutes, 1),
      "fastest",
    );
    add(
      uniqueBest(feasible, (p) => p.distanceKm, 1),
      "shortest",
    );
    add(
      uniqueBest(feasible, (p) => p.stops.length, 0.5),
      "fewest_stops",
    );
    add(
      uniqueBest(feasible, (p) => -p.arrivalSoc, 2),
      "best_arrival",
    );
  }
  for (const p of plans) if (p.noTolls) out.get(p.id)?.push("no_tolls");
  return out;
}
