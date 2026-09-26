import type { TripArrivalSummary } from "@/domain/user/types";
import { formatPct } from "@/lib/format";

/** "¿Con cuánto llegaste?" (D13): cuánto se equivocó el plan en la llegada, en palabras. */
export function arrivalText(o: TripArrivalSummary): string {
  const diff = Math.round(Math.abs(o.errorPct) * 10) / 10;
  const base = `Llegaste con ${formatPct(o.arrivalSoc)}; el plan dijo ${formatPct(o.predictedArrivalSoc)}`;
  if (diff < 1) return `${base}: el plan acertó.`;
  return `${base}: el plan fue ${o.errorPct > 0 ? "optimista" : "conservador"} por ${String(diff).replace(".", ",")} puntos.`;
}
