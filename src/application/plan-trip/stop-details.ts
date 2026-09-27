import type { StationDetails } from "@/domain/ports/station-details";
import { toPlanningCharger } from "@/domain/stations/to-charger";
import type { Charger, RoutePlan } from "@/domain/types";

/** Tiempo máximo para pedir el detalle de las paradas: si no llega, se sigue con el listado. */
export const STOP_DETAILS_TIMEOUT_MS = 5_000;

export interface StopDetailsCheck {
  /** Los cargadores con los datos del detalle aplicados a las paradas. */
  chargers: Charger[];
  /** Paradas que el detalle muestra fuera de servicio. */
  offline: Charger[];
  /** Paradas cuyo detalle cambió algo (estado, potencias o cantidades). */
  changed: number;
  requested: number;
  failed: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sin respuesta en ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Detalle de las estaciones donde para el plan (ADR-0008, D9): una consulta
 * por parada, en paralelo y con tiempo máximo. Una parada sin ningún cargador
 * en servicio queda "offline", y los dos planificadores ya la descartan.
 */
export async function checkStopDetails(
  details: StationDetails,
  plan: RoutePlan,
  chargers: Charger[],
  timeoutMs = STOP_DETAILS_TIMEOUT_MS,
): Promise<StopDetailsCheck> {
  const ids = [...new Set(plan.stops.map((s) => s.charger.id))];
  const results = await Promise.allSettled(
    ids.map((id) => withTimeout(details.get(id), timeoutMs)),
  );
  const updated = new Map<string, Charger>();
  let failed = 0;
  results.forEach((r, i) => {
    const id = ids[i]!;
    if (r.status === "rejected") {
      failed++;
      console.warn(
        `[stations:detail] ${id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
      );
      return;
    }
    const station = r.value;
    const current = chargers.find((c) => c.id === id);
    if (!station || !current) return;
    let next: Charger;
    if (station.planning.eligible) next = toPlanningCharger(station);
    else if (station.availability.value === "offline")
      next = { ...current, availability: "offline", available: false };
    else {
      // No elegible por otra cosa (p. ej. conectores del detalle escritos distinto que en el
      // listado): no se descarta una estación en servicio; se sigue con el listado.
      console.warn(
        `[stations:detail] ${id} ${current.name}: el detalle no sirve para planificar ` +
          `(${station.planning.reasons.join(", ") || "sin motivo"}); se sigue con el listado`,
      );
      return;
    }
    if (JSON.stringify(stable(next)) !== JSON.stringify(stable(current))) updated.set(id, next);
  });
  const merged = chargers.map((c) => updated.get(c.id) ?? c);
  return {
    chargers: merged,
    offline: [...updated.values()].filter((c) => c.availability === "offline"),
    changed: updated.size,
    requested: ids.length,
    failed,
  };
}

/** Lo que cambia la decisión: estado, potencias y cantidades (no la hora de consulta). */
function stable(c: Charger) {
  return { availability: c.availability, available: c.available, sockets: c.sockets };
}

export function offlineStopText(names: string[]): string {
  const list = names.join(", ");
  return names.length === 1
    ? `La estación ${list} figura fuera de servicio en Blaze: el plan se recalculó sin ella.`
    : `Las estaciones ${list} figuran fuera de servicio en Blaze: el plan se recalculó sin ellas.`;
}
