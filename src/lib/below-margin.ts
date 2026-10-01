import type { BelowMarginReason, RoutePlan } from "@/domain/types";
import { formatPct } from "@/lib/format";

const GAIN: Record<BelowMarginReason, string> = {
  "only-way": "respetándolo, con estos cargadores no se completa el viaje",
  "no-precharge": "así no tienes que cargar antes de salir",
  "fewer-stops": "así te ahorras una parada",
  faster: "así pasas bastante menos tiempo cargando",
};

/**
 * Margen flexible (ADR-0019): cuánto baja el plan del margen de seguridad, qué
 * se gana con eso y lo más bajo que permite, en palabras. Null si el plan
 * respeta el margen.
 */
export function belowMarginText(
  plan: Pick<RoutePlan, "belowMargin" | "safetyPct" | "arrivalSoc">,
): string | null {
  const b = plan.belowMargin;
  if (!b) return null;
  const why = b.reason ? GAIN[b.reason] : "permitiste bajar del margen en ruta";
  const where = plan.arrivalSoc <= b.lowestSoc + 0.05 ? "Llegas con" : "En ruta la batería baja a";
  const points = Math.round(plan.safetyPct) - Math.round(b.lowestSoc);
  const below =
    points >= 1
      ? `${points} ${points === 1 ? "punto" : "puntos"} bajo tu margen de ${formatPct(plan.safetyPct)}`
      : `unas décimas bajo tu margen de ${formatPct(plan.safetyPct)}`;
  return `${where} ${formatPct(b.lowestSoc)}, ${below}: ${why}. El margen es flexible, pero el plan nunca baja de ${formatPct(b.floorPct)}.`;
}
