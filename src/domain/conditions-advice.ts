import { safetyPct, type RoutePlan, type TripConditions } from "./types";

export interface ConditionWarning {
  level: "warn" | "danger";
  text: string;
}

/**
 * Avisos cuando las opciones de "Condiciones del viaje" se contradicen o son
 * arriesgadas. No cambian nada: solo explican.
 */
export function conditionWarnings(c: TripConditions): ConditionWarning[] {
  const out: ConditionWarning[] = [];
  const margin = safetyPct(c);
  if (c.allowBelowSafety) {
    out.push({
      level: "danger",
      text: "Con “Permitir bajar del margen” puedes llegar a un cargador con 2 % y el plan se da por bueno aunque no alcance el margen al destino.",
    });
  }
  if (c.planningMode === "safer" && (margin < 15 || c.allowBelowSafety)) {
    out.push({
      level: "warn",
      text: `“Más segura” carga con holgura, pero un margen de ${margin} %${c.allowBelowSafety ? " y permitir bajarlo" : ""} deja llegar muy justo. Para más seguridad usa 15–20 % y desactiva el interruptor.`,
    });
  }
  if (c.planningMode === "efficient" && c.drivingStyle === "sport") {
    out.push({
      level: "warn",
      text: "“Más eficiente” busca gastar menos, pero la conducción deportiva gasta ~15 % más. Con estilo “Eficiente” ahorrarías ~10 %.",
    });
  }
  if (c.planningMode === "fewer_stops" && margin >= 20 && c.drivingStyle === "sport") {
    out.push({
      level: "warn",
      text: "Margen alto + conducción deportiva obligan a cargar más: “Menos paradas” tendrá paradas más largas.",
    });
  }
  return out;
}

/** Resultado resumido del plan recomendado, para comparar opciones. */
export type PlanPreview = Pick<
  RoutePlan,
  "energyKwh" | "totalMinutes" | "stops" | "arrivalSoc" | "feasible"
>;

function minutes(m: number): string {
  const abs = Math.round(Math.abs(m));
  return abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
}

/**
 * "−6 % kWh · +12 min · 1 parada" frente al plan actual. Solo muestra lo que
 * cambia de forma apreciable (≥ 1 % de energía, ≥ 1 min, paradas distintas).
 */
export function previewDelta(current: PlanPreview, next: PlanPreview): string {
  if (!next.feasible && current.feasible)
    return "No alcanza con la batería y cargadores disponibles";
  const parts: string[] = [];
  if (current.energyKwh > 0) {
    const pct = ((next.energyKwh - current.energyKwh) / current.energyKwh) * 100;
    if (Math.abs(pct) >= 1) parts.push(`${pct > 0 ? "+" : "−"}${Math.round(Math.abs(pct))} % kWh`);
  }
  const dMin = next.totalMinutes - current.totalMinutes;
  if (Math.abs(dMin) >= 1) parts.push(`${dMin > 0 ? "+" : "−"}${minutes(dMin)}`);
  if (next.stops.length !== current.stops.length) {
    parts.push(`${next.stops.length} ${next.stops.length === 1 ? "parada" : "paradas"}`);
  }
  return parts.length ? parts.join(" · ") : "Sin cambios en esta ruta";
}
