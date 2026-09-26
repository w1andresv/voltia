/**
 * Informe de un plan (especificación §8.5): resumen, parámetros con su fuente,
 * paradas, series de las gráficas, calidad de datos, avisos y supuestos
 * estimados, en Markdown. Es presentación: aquí sí se redondea.
 */
import type { ModelParameters } from "@/domain/ev/core/params";
import type { SourcedValue } from "@/domain/ev/core/provenance";
import type { PlanningSnapshot } from "@/domain/ev/contracts/snapshot";
import { consumptionSeries, socSeries } from "@/domain/ev/engines/chart/series";
import { energyProfileForRoute } from "@/domain/ev/energy-v2";
import type { VehicleEnergyParams } from "@/domain/ev/engines/energy/vehicle-params";
import { resolveVehicleEnergyParams } from "@/domain/ev/engines/energy/vehicle-params";
import {
  INFEASIBILITY_TEXT,
  VERIFICATION_TEXT,
  type GeoBundle,
  type PlanRequest,
  type RawRoute,
  type RoutePlan,
  type TripConditions,
  type Vehicle,
} from "@/domain/types";

export interface PlanReportInput {
  title: string;
  request: PlanRequest;
  geo: GeoBundle | PlanningSnapshot;
  plan: RoutePlan;
  /** Ruta base del plan (para los parámetros físicos efectivos con la energía v2). */
  route?: RawRoute;
  params: ModelParameters;
  /** Fecha del informe (ISO); por defecto, la del snapshot. */
  generatedAt?: string;
}

const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("es-CO");
const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("es-CO");
const n0 = (x: number) => Math.round(x).toLocaleString("es-CO");
/** Parámetros: 4 cifras significativas (Crr 0,009 no debe salir como 0,01). */
const sig = (x: number) =>
  Math.abs(x) >= 100
    ? n1(x)
    : Number(x.toPrecision(4)).toLocaleString("es-CO", { maximumFractionDigits: 6 });
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

const SOURCE_LABEL: Record<string, string> = {
  manufacturer: "fabricante",
  external_source: "fuente externa",
  calculated: "calculado",
  estimated: "estimado",
  configurable: "configurable",
};

function valueText(v: unknown): string {
  if (typeof v === "number") return sig(v);
  if (Array.isArray(v))
    return v
      .map((x) => (Array.isArray(x) ? `${valueText(x[0])} → ${valueText(x[1])}` : valueText(x)))
      .join("; ");
  if (v && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${valueText(x)}`)
      .join(", ");
  }
  return String(v);
}

function sourcedRow(name: string, v: SourcedValue<unknown>, unit = ""): string {
  const ref = [v.reference, v.notes].filter(Boolean).join(" · ");
  return `| ${cell(name)} | ${cell(valueText(v.value))}${unit ? ` ${unit}` : ""} | ${SOURCE_LABEL[v.source] ?? v.source} | ${cell(ref)} |`;
}

const VEHICLE_PARAM_LABEL: Record<keyof VehicleEnergyParams, [string, string]> = {
  massKg: ["Masa total", "kg"],
  dragAreaM2: ["Cd·A", "m²"],
  rollingResistance: ["Crr", ""],
  rotationalInertiaFactor: ["Factor de inercia rotacional", ""],
  drivetrainEfficiency: ["Eficiencia batería → rueda", ""],
  regenEfficiency: ["Eficiencia rueda → batería", ""],
  maxRegenPowerKw: ["Potencia máxima de regeneración", "kW"],
  baseAuxPowerKw: ["Consumo auxiliar base", "kW"],
};

function vehicleParams(input: PlanReportInput): VehicleEnergyParams {
  const vehicle = input.request.vehicle as Vehicle;
  const conditions = input.request.conditions as TripConditions;
  if (input.route && input.plan.energyEngine === "v2") {
    return energyProfileForRoute(input.route, vehicle, conditions, input.geo.weather, input.params)
      .params;
  }
  return resolveVehicleEnergyParams(vehicle, conditions, input.params);
}

export function buildPlanReport(input: PlanReportInput): string {
  const { plan, request, geo, params } = input;
  const vehicle = request.vehicle as Vehicle;
  const conditions = request.conditions as TripConditions;
  const snapshot = "schemaVersion" in geo ? (geo as PlanningSnapshot) : null;
  const vp = vehicleParams(input);
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(
    `# ${input.title}`,
    "",
    `${request.origin.label} → ${request.destination.label} · ${vehicle.brand} ${vehicle.model} ${vehicle.version} · ${plan.label}${plan.via ? ` (${plan.via})` : ""}`,
    "",
    `Generado: ${input.generatedAt ?? snapshot?.createdAt ?? "—"} · modelo ${snapshot?.modelVersion ?? params.modelVersion} · planificador ${plan.planner ?? "legacy"} · energía ${plan.energyEngine ?? "legacy"}`,
    "",
    "## 1. Resumen",
    "",
    "| Dato | Valor |",
    "|---|---|",
    `| Distancia | ${n1(plan.distanceKm)} km${plan.detourKm >= 0.1 ? ` + ${n1(plan.detourKm)} km de desvíos` : ""} |`,
    `| Tiempo total | ${hm(plan.totalMinutes)} (manejo ${hm(plan.driveMinutes)}, carga ${hm(plan.chargeMinutes)}) |`,
    ...(plan.providerDriveMinutes != null
      ? [`| Manejo según el mapa | ${hm(plan.providerDriveMinutes)} |`]
      : []),
    `| Energía neta | ${n1(plan.energyKwh)} kWh (${n1(plan.avgKwhPer100km)} kWh/100 km) |`,
    `| Energía bruta / regenerada | ${n1(plan.energyGrossKwh)} / ${n1(plan.energyRegenKwh)} kWh${plan.regenCurtailedKwh ? ` (recortada por SOC alto: ${n2(plan.regenCurtailedKwh)} kWh)` : ""} |`,
    `| SOC inicial → llegada (mínimo) | ${n1(plan.initialSoc)} % → ${n1(plan.arrivalSoc)} % (${n1(plan.minSoc)} %) |`,
    ...(plan.departureCharge
      ? [`| Carga antes de salir | +${plan.departureCharge.additionalPct} % |`]
      : []),
    `| Paradas | ${plan.stops.length} |`,
    `| Viable | ${plan.feasible ? "sí" : "no"}${plan.feasibilityStatus ? ` (${plan.feasibilityStatus})` : ""}${plan.infeasibilityCode ? ` — ${INFEASIBILITY_TEXT[plan.infeasibilityCode]}` : ""} |`,
    ...(plan.verification
      ? [`| Verificación con la ruta real | ${VERIFICATION_TEXT[plan.verification.status]} |`]
      : []),
    `| Desnivel | ↑ ${n0(plan.elevation.gainM)} m · ↓ ${n0(plan.elevation.lossM)} m · ${n0(plan.elevation.minM)}–${n0(plan.elevation.maxM)} m |`,
    "",
  );

  const mode = params.speed.modes.value[conditions.drivingStyle];
  const regen = params.energy.regenModes.value[conditions.regenLevel];
  push(
    "## 2. Parámetros con fuente",
    "",
    "| Parámetro | Valor | Fuente | Referencia / notas |",
    "|---|---|---|---|",
    ...(Object.keys(VEHICLE_PARAM_LABEL) as (keyof VehicleEnergyParams)[]).map((k) =>
      sourcedRow(VEHICLE_PARAM_LABEL[k][0], vp[k], VEHICLE_PARAM_LABEL[k][1]),
    ),
    `| Batería útil | ${n1(vehicle.batteryKwh)} kWh | catálogo | |`,
    `| Modo de conducción (${conditions.drivingStyle}) | ${valueText(mode)} | ${SOURCE_LABEL[params.speed.modes.source]} | ${cell(params.speed.modes.notes ?? "")} |`,
    `| Regeneración (${conditions.regenLevel}) | ${valueText(regen)} | ${SOURCE_LABEL[params.energy.regenModes.source]} | ${cell(params.energy.regenModes.notes ?? "")} |`,
    sourcedRow("Factor de tracción por temperatura (°C → factor)", params.energy.temperatureFactor),
    sourcedRow("Tope por clase vial sin límite legal", params.speed.defaultByRoadTier, "km/h"),
    sourcedRow("Minutos fijos por parada", params.charging.connectionOverheadMin, "min"),
    sourcedRow("Espera en estación ocupada", params.planner.occupiedWaitMin, "min"),
    sourcedRow("Factor vial del desvío estimado", params.corridor.detourRoadFactor),
    "",
  );

  push("## 3. Paradas", "");
  if (!plan.stops.length) push("Sin paradas.", "");
  else {
    push(
      "| # | Estación | km | SOC llegada → salida | Carga | Potencia | Desvío | Energía del desvío | Adaptador |",
      "|---|---|---|---|---|---|---|---|---|",
      ...plan.stops.map(
        (s, i) =>
          `| ${i + 1} | ${cell(s.charger.name)} | ${n1(s.kmAlongRoute)} | ${n1(s.arriveSoc)} → ${n1(s.departSoc)} % | ${n0(s.chargeMinutes)} min · ${n1(s.energyAddedKwh)} kWh | ${n0(s.chargeKw)} kW | ${n1(s.detourKm)} km · ${n0(s.detourMinutes)} min | ${s.detourEnergyKwh != null ? `${n2(s.detourEnergyKwh)} kWh` : "—"} | ${s.adapterNeeded ? `${s.adapterNeeded.from} → ${s.adapterNeeded.to}${s.adapterNeeded.carried ? "" : " (no lo lleva)"}` : "—"} |`,
      ),
      "",
    );
  }

  const series = consumptionSeries(plan.samples);
  push(
    "## 4. Series de las gráficas",
    "",
    `### Consumo por ventana (${series.windowKm} km)`,
    "",
    "| Desde km | Hasta km | kWh | kWh/100 km |",
    "|---|---|---|---|",
    ...series.windows.map(
      (w) => `| ${n1(w.fromKm)} | ${n1(w.toKm)} | ${n2(w.kwh)} | ${n1(w.kwhPer100)} |`,
    ),
    "",
    "### SOC contra distancia",
    "",
    "Un punto por ventana y los dos de cada parada (llegada y salida).",
    "",
    "| km | SOC % | |",
    "|---|---|---|",
  );
  const soc = socSeries(plan.samples, plan.stops);
  let nextKm = 0;
  for (const p of soc) {
    if (p.kind !== "route" || p.km >= nextKm || p === soc[soc.length - 1]) {
      push(
        `| ${n1(p.km)} | ${n1(p.soc)} | ${p.kind === "arrive" ? "llega a la parada" : p.kind === "depart" ? "sale de la parada" : ""} |`,
      );
      if (p.kind === "route") nextKm = p.km + series.windowKm;
    }
  }
  push("");

  push(
    "## 5. Calidad de datos",
    "",
    "| Dato | Valor |",
    "|---|---|",
    ...(snapshot
      ? [
          `| Rutas | ${snapshot.providers.routing} |`,
          `| Elevación | ${snapshot.providers.elevation}${plan.elevation.correctedPoints ? ` (${plan.elevation.correctedPoints} puntos corregidos)` : ""} |`,
          `| Clima | ${snapshot.providers.weather ?? "sin clima"} |`,
        ]
      : []),
    `| Electrolineras | dataset ${geo.stationsVersion ?? "—"}, ${geo.chargers.length} en el corredor |`,
    `| Elevación disponible | ${geo.dataQuality?.elevation === "unavailable" ? "NO (ruta plana)" : "sí"} |`,
    `| Límite legal en la ruta | ${pctWith(input.route ?? null, (s) => s.speedLimitKmh != null)} de las muestras |`,
    `| Clase vial en la ruta | ${pctWith(input.route ?? null, (s) => s.roadTier != null)} de las muestras |`,
    "",
    "## 6. Avisos",
    "",
    ...(geo.warnings.length ? geo.warnings.map((w) => `- ${w}`) : ["Ninguno."]),
    "",
    "## 7. Supuestos estimados",
    "",
    "Valores sin fuente del fabricante ni calibración, que conviene revisar o calibrar con viajes reales:",
    "",
    ...estimatedList(vp, params).map((x) => `- ${x}`),
    "",
  );
  return lines.join("\n");
}

function pctWith(route: RawRoute | null, has: (s: RawRoute["samples"][number]) => boolean): string {
  if (!route?.samples.length) return "—";
  const share = route.samples.filter(has).length / route.samples.length;
  return `${Math.round(share * 100)} %`;
}

function estimatedList(vp: VehicleEnergyParams, params: ModelParameters): string[] {
  const out = (Object.keys(vp) as (keyof VehicleEnergyParams)[])
    .filter((k) => vp[k].source === "estimated")
    .map(
      (k) =>
        `${VEHICLE_PARAM_LABEL[k][0]}: ${n2(vp[k].value)}${VEHICLE_PARAM_LABEL[k][1] ? ` ${VEHICLE_PARAM_LABEL[k][1]}` : ""}`,
    );
  const model: [string, SourcedValue<unknown>][] = [
    ["Modos de conducción (velocidad y aceleraciones)", params.speed.modes],
    ["Regeneración por modo", params.energy.regenModes],
    ["Factor de tracción por temperatura", params.energy.temperatureFactor],
    ["Minutos fijos por parada", params.charging.connectionOverheadMin],
    ["Espera en estación ocupada", params.planner.occupiedWaitMin],
    ["Factor vial del desvío estimado", params.corridor.detourRoadFactor],
    ["Cd·A y Crr por carrocería", params.vehicle.bodyTypePhysics],
  ];
  for (const [name, v] of model) if (v.source === "estimated") out.push(name);
  return out.length ? out : ["Ninguno."];
}
