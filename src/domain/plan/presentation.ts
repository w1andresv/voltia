import { chargeTimeMinutes, FLAT_CURVE } from "../ev/engines/charging/curve";
import {
  routePlugs,
  uncarriedAdapterPlugs,
  type RoutePlug,
} from "../ev/engines/compatibility/engine";
import { compareByHierarchy } from "../road-hierarchy";
import {
  extraWeightKg,
  type ChargeStop,
  type RoutePlan,
  type TripConditions,
  type Vehicle,
} from "../types";

/**
 * Lo que se muestra de un plan ya calculado: adaptadores de cada parada, orden
 * de las rutas según la estrategia y textos cortos. No decide paradas.
 */

/** Minutos de esta carga (llegada → salida) con una forma de cargar. */
function plugMinutes(
  plug: RoutePlug,
  vehicle: Vehicle,
  cap: number,
  from: number,
  to: number,
): number {
  return chargeTimeMinutes(
    cap,
    from,
    to,
    plug.dc ? vehicle.dcMaxKw : vehicle.acMaxKw,
    plug.powerKw,
    plug.dc ? vehicle.chargeCurve : FLAT_CURVE,
  );
}

/**
 * Si la estación tiene carga rápida con otro conector: qué adaptador hace falta,
 * si el usuario lo lleva, y el tiempo de la misma carga con y sin él.
 */
export function adapterSummary(
  stop: ChargeStop,
  vehicle: Vehicle,
  cap: number,
): ChargeStop["adapterNeeded"] {
  const plugs = routePlugs(stop.charger, vehicle);
  const without = plugs.filter((p) => !p.adapter);
  const bestWithout = without.length
    ? without.reduce((a, b) => (b.powerKw > a.powerKw ? b : a))
    : null;
  const withoutAdapter = bestWithout
    ? {
        mode: bestWithout.dc ? ("direct" as const) : ("ac" as const),
        chargeKw: bestWithout.powerKw,
        chargeMinutes: plugMinutes(bestWithout, vehicle, cap, stop.arriveSoc, stop.departSoc),
      }
    : null;
  // Lo lleva y el plan lo usa.
  if (stop.adapter) {
    return {
      from: stop.adapter.from,
      to: stop.adapter.to,
      carried: true,
      withAdapter: { chargeKw: stop.chargeKw, chargeMinutes: stop.chargeMinutes },
      withoutAdapter,
    };
  }
  // No lo lleva: la carga rápida con adaptador más potente, si supera a lo que usa el plan.
  const fast = uncarriedAdapterPlugs(stop.charger, vehicle);
  if (!fast.length) return undefined;
  const best = fast.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
  if (best.powerKw <= stop.chargeKw) return undefined;
  return {
    from: best.adapter!.from,
    to: best.adapter!.to,
    carried: false,
    withAdapter: {
      chargeKw: best.powerKw,
      chargeMinutes: plugMinutes(best, vehicle, cap, stop.arriveSoc, stop.departSoc),
    },
    withoutAdapter,
  };
}

/**
 * Tiempo "efectivo" para comparar rutas: el total, más el recargo por usar vías
 * de menor jerarquía (secundarias, terciarias, locales) fuera de los accesos.
 * Así una ruta no gana solo porque un atajo por vías menores ahorra minutos.
 */
export function effectiveMinutes(
  p: Pick<RoutePlan, "totalMinutes" | "driveMinutes" | "hierarchyFactor">,
): number {
  return p.totalMinutes + p.driveMinutes * Math.max(0, (p.hierarchyFactor ?? 1) - 1);
}

export function rankPlans(plans: RoutePlan[], mode: TripConditions["planningMode"]): RoutePlan[] {
  const copy = [...plans];
  // Jerarquía vial primero (menos km por vías menores), luego el criterio de la
  // estrategia: así ninguna estrategia elige un atajo por vías secundarias o
  // terciarias si hay una alternativa razonable por vías principales.
  const byHierarchy = (a: RoutePlan, b: RoutePlan, then: number) =>
    compareByHierarchy(
      { minorScore: a.minorRoadScore, cost: then },
      { minorScore: b.minorRoadScore, cost: 0 },
    );
  copy.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    // Fuera de la tolerancia (+15 % tiempo / +10 % km): solo si no hay otra.
    const ta = a.withinTolerance !== false;
    const tb = b.withinTolerance !== false;
    if (ta !== tb) return ta ? -1 : 1;
    switch (mode) {
      case "efficient":
        return byHierarchy(a, b, a.energyKwh - b.energyKwh);
      case "fewer_stops":
        // En esta estrategia, las paradas mandan; la jerarquía desempata.
        return (
          a.stops.length - b.stops.length ||
          byHierarchy(a, b, effectiveMinutes(a) - effectiveMinutes(b))
        );
      case "safer":
        return byHierarchy(a, b, b.minSoc - a.minSoc || b.arrivalSoc - a.arrivalSoc);
      case "fastest":
      case "custom":
      default:
        return byHierarchy(a, b, effectiveMinutes(a) - effectiveMinutes(b));
    }
  });
  return copy;
}

export function extraMassLabel(c: TripConditions): string {
  const kg = extraWeightKg(c);
  return `+${kg} kg`;
}
