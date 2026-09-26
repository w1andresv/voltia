import type { PlanningMode, RoutePlan } from "@/domain/types";

/**
 * Reporte del modo sombra: en qué difieren el planificador actual y el v2 para
 * el mismo viaje. `formatShadowReport` lo muestra como tabla (desarrollo);
 * en producción se registra el JSON de una línea para poder filtrarlo.
 */

const MODE_LABEL: Record<PlanningMode, string> = {
  fastest: "más rápida",
  efficient: "más eficiente",
  fewer_stops: "menos paradas",
  safer: "más segura",
  custom: "personalizada",
};

const STATUS_LABEL: Record<string, string> = {
  FEASIBLE_NO_CHARGING: "sin cargar",
  FEASIBLE_ONE_STOP: "1 parada",
  FEASIBLE_MULTIPLE_STOPS: "varias paradas",
  INFEASIBLE_WITH_CURRENT_SOC: "cargar antes de salir",
  INFEASIBLE_EVEN_AT_FULL_SOC: "no viable",
};

export interface ShadowPlanSide {
  feasible: boolean;
  stops: { name: string; arriveSoc: number; departSoc: number; minutes: number }[];
  totalMinutes: number;
  arrivalSoc: number;
  minSoc: number;
  preChargePct?: number;
}

export interface ShadowReport {
  trip: string;
  mode: PlanningMode;
  ms: number;
  selected: [string | undefined, string | undefined];
  routes: { id: string; label: string; legacy: ShadowPlanSide; v2: ShadowPlanSide; v2Status?: string }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function side(p: RoutePlan): ShadowPlanSide {
  return {
    feasible: p.feasible,
    stops: p.stops.map((s) => ({
      name: s.charger.name,
      arriveSoc: r1(s.arriveSoc),
      departSoc: r1(s.departSoc),
      minutes: Math.round(s.chargeMinutes),
    })),
    totalMinutes: Math.round(p.totalMinutes),
    arrivalSoc: r1(p.arrivalSoc),
    minSoc: r1(p.minSoc),
    preChargePct: p.departureCharge?.additionalPct,
  };
}

export function buildShadowReport(args: {
  trip: string;
  mode: PlanningMode;
  ms: number;
  legacy: RoutePlan[];
  v2: RoutePlan[];
  selected: [string | undefined, string | undefined];
}): ShadowReport {
  return {
    trip: args.trip,
    mode: args.mode,
    ms: args.ms,
    selected: args.selected,
    routes: args.legacy.map((a, i) => {
      const b = args.v2[i]!;
      return { id: a.id, label: a.label, legacy: side(a), v2: side(b), v2Status: b.feasibilityStatus };
    }),
  };
}

function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

function signed(n: number, unit: string): string {
  if (n === 0) return "igual";
  return `${n > 0 ? "+" : "−"}${String(Math.abs(n)).replace(".", ",")}${unit}`;
}

function pct(n: number): string {
  return `${String(n).replace(".", ",")} %`;
}

function stopsText(s: ShadowPlanSide): string {
  if (!s.feasible) return "no viable";
  const pre = s.preChargePct ? `cargar +${s.preChargePct} % antes · ` : "";
  if (!s.stops.length) return `${pre}sin paradas`;
  return pre + s.stops.map((x) => `${x.name} (${pct(x.arriveSoc)}→${pct(x.departSoc)}, ${x.minutes} min)`).join(" · ");
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Tabla legible del reporte, una línea por dato y ruta. */
export function formatShadowReport(r: ShadowReport): string {
  const labelOf = (id?: string) => r.routes.find((x) => x.id === id)?.label ?? "—";
  const [selA, selB] = r.selected;
  const lines = [
    `[plan-trip:shadow] ${r.trip} · ${MODE_LABEL[r.mode]} · v2 en ${r.ms} ms`,
    `  Elegida: actual ${labelOf(selA)} · v2 ${labelOf(selB)}${selA === selB ? "" : "  ← distinta"}`,
  ];
  for (const route of r.routes) {
    const a = route.legacy;
    const b = route.v2;
    const same =
      a.feasible === b.feasible &&
      a.totalMinutes === b.totalMinutes &&
      a.arrivalSoc === b.arrivalSoc &&
      stopsText(a) === stopsText(b);
    lines.push("");
    lines.push(`  ${route.label}${same ? "  (sin diferencias)" : ""}${route.v2Status ? `  · v2: ${STATUS_LABEL[route.v2Status] ?? route.v2Status}` : ""}`);
    if (same) continue;
    const row = (name: string, x: string, y: string, delta = "") =>
      `    ${pad(name, 12)}${pad(x, 16)}→ ${pad(y, 16)}${delta}`;
    lines.push(row("", "actual", "v2"));
    lines.push(row("Viable", a.feasible ? "sí" : "no", b.feasible ? "sí" : "no"));
    lines.push(row("Paradas", String(a.stops.length), String(b.stops.length), a.stops.length !== b.stops.length ? signed(b.stops.length - a.stops.length, "") : ""));
    lines.push(row("Tiempo", hm(a.totalMinutes), hm(b.totalMinutes), signed(b.totalMinutes - a.totalMinutes, " min")));
    lines.push(row("Llega con", pct(a.arrivalSoc), pct(b.arrivalSoc), signed(r1(b.arrivalSoc - a.arrivalSoc), " pts")));
    lines.push(row("Mínimo", pct(a.minSoc), pct(b.minSoc)));
    lines.push(`    Actual: ${stopsText(a)}`);
    lines.push(`    v2:     ${stopsText(b)}`);
  }
  return lines.join("\n");
}
