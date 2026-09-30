/**
 * Qué destacar en la comparativa de vehículos (app/comparar). Es presentación:
 * compara las cifras redondeadas como se muestran (el dominio v2 no redondea).
 */
import type { RoutePlan } from "@/domain/types";

/** Cifras de la comparativa en las que hay un mejor valor. */
export type ComparedMetric =
  "totalMinutes" | "chargeMinutes" | "stops" | "arrivalSoc" | "energyKwh";

/** Redondeadas como se muestran: 0,3 min de diferencia no hacen a uno "mejor". */
const METRIC_VALUE: Record<ComparedMetric, (p: RoutePlan) => number> = {
  totalMinutes: (p) => Math.round(p.totalMinutes),
  chargeMinutes: (p) => Math.round(p.chargeMinutes),
  stops: (p) => p.stops.length,
  arrivalSoc: (p) => Math.round(p.arrivalSoc),
  energyKwh: (p) => Math.round(p.energyKwh * 10) / 10,
};

const HIGHER_IS_BETTER: ReadonlySet<ComparedMetric> = new Set(["arrivalSoc"]);

/**
 * Posiciones de los planes con el mejor valor de `metric` (empates incluidos),
 * solo entre los que llegan. Vacío si llegan menos de dos o todos empatan:
 * ahí no hay nada que destacar.
 */
export function bestOf(plans: (RoutePlan | null)[], metric: ComparedMetric): number[] {
  const value = METRIC_VALUE[metric];
  const arriving = plans.flatMap((p, i) => (p?.feasible ? [{ i, v: value(p) }] : []));
  if (arriving.length < 2) return [];
  const values = arriving.map((a) => a.v);
  const best = HIGHER_IS_BETTER.has(metric) ? Math.max(...values) : Math.min(...values);
  const winners = arriving.filter((a) => a.v === best).map((a) => a.i);
  return winners.length === arriving.length ? [] : winners;
}
