import type { RoutePlan } from "@/domain/types";

/**
 * Modo sombra del modelo de energía (F5): mismo viaje y mismo planificador,
 * con el modelo actual y con el v2 (física sin multiplicadores y perfil de
 * velocidad). En desarrollo, tabla; en producción, JSON de una línea.
 */

export interface EnergyShadowSide {
  kwh: number;
  kwhPer100: number;
  driveMinutes: number;
  totalMinutes: number;
  arrivalSoc: number;
  minSoc: number;
  stops: number;
  feasible: boolean;
}

export interface EnergyShadowReport {
  trip: string;
  ms: number;
  routes: {
    id: string;
    label: string;
    distanceKm: number;
    legacy: EnergyShadowSide;
    v2: EnergyShadowSide;
    /** Tiempo de manejo del proveedor, min (el v2 no lo reescala). */
    providerDriveMinutes?: number;
  }[];
  /** Parámetros del vehículo que el v2 tomó por defecto (estimated). */
  assumptions: string[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function side(p: RoutePlan): EnergyShadowSide {
  return {
    kwh: r1(p.energyKwh),
    kwhPer100: r1(p.avgKwhPer100km),
    driveMinutes: Math.round(p.driveMinutes),
    totalMinutes: Math.round(p.totalMinutes),
    arrivalSoc: r1(p.arrivalSoc),
    minSoc: r1(p.minSoc),
    stops: p.stops.length,
    feasible: p.feasible,
  };
}

export function buildEnergyShadowReport(args: {
  trip: string;
  ms: number;
  legacy: RoutePlan[];
  v2: RoutePlan[];
}): EnergyShadowReport {
  return {
    trip: args.trip,
    ms: args.ms,
    routes: args.legacy.map((a) => {
      const b = args.v2.find((x) => x.id === a.id) ?? a;
      return {
        id: a.id,
        label: a.label,
        distanceKm: r1(a.distanceKm),
        legacy: side(a),
        v2: side(b),
        providerDriveMinutes:
          b.providerDriveMinutes != null ? Math.round(b.providerDriveMinutes) : undefined,
      };
    }),
    assumptions: args.v2[0]?.energyAssumptions ?? [],
  };
}

function delta(a: number, b: number, unit: string): string {
  const d = r1(b - a);
  if (d === 0) return "igual";
  const pctText = a !== 0 ? ` (${d > 0 ? "+" : "−"}${Math.abs(Math.round((d / a) * 100))} %)` : "";
  return `${d > 0 ? "+" : "−"}${String(Math.abs(d)).replace(".", ",")}${unit}${pctText}`;
}

const num = (n: number) => String(n).replace(".", ",");

/** Tabla legible: una fila por dato y ruta, actual → v2 y la diferencia. */
export function formatEnergyShadowReport(r: EnergyShadowReport): string {
  const lines = [`[plan-trip:energy-shadow] ${r.trip} · v2 en ${r.ms} ms`];
  if (r.assumptions.length)
    lines.push(`  Valores por defecto en el v2: ${r.assumptions.join(", ")}`);
  for (const route of r.routes) {
    const a = route.legacy;
    const b = route.v2;
    const provider =
      route.providerDriveMinutes != null ? ` · proveedor ${route.providerDriveMinutes} min` : "";
    lines.push(
      `  ${route.label} (${num(route.distanceKm)} km)`,
      `    Energía          ${num(a.kwh)} → ${num(b.kwh)} kWh  ${delta(a.kwh, b.kwh, " kWh")}`,
      `    kWh/100 km       ${num(a.kwhPer100)} → ${num(b.kwhPer100)}`,
      `    Manejo           ${a.driveMinutes} → ${b.driveMinutes} min${provider}`,
      `    Llegada / mínimo ${num(a.arrivalSoc)} / ${num(a.minSoc)} % → ${num(b.arrivalSoc)} / ${num(b.minSoc)} %`,
      `    Paradas          ${a.stops} → ${b.stops}${a.feasible === b.feasible ? "" : `  (viable: ${a.feasible ? "sí" : "no"} → ${b.feasible ? "sí" : "no"})`}`,
    );
  }
  return lines.join("\n");
}
