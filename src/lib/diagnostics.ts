import type { PlanningSnapshot } from "@/domain/ev/contracts/snapshot";
import type { GeoBundle, RoutePlan, TripConditions, Vehicle } from "@/domain/types";
import type { AppInfo } from "@/lib/app-info";

/**
 * Texto de "Diagnóstico y caché": qué versión y configuración responde, con
 * qué se calculó el plan en pantalla y con qué preferencias de este navegador.
 * Sirve para comparar dos entornos (p. ej. localhost contra Vercel), que no
 * comparten ni código desplegado ni preferencias guardadas.
 */
export interface DiagnosticsInput {
  info?: AppInfo;
  engineChoice: "v1" | "v2" | null;
  geo: GeoBundle | null;
  plan: RoutePlan | null;
  vehicle: Vehicle;
  conditions: TripConditions;
  now?: Date;
}

const yesNo = (b: boolean) => (b ? "sí" : "no");

function ago(iso: string | undefined, now: Date): string {
  if (!iso) return "";
  const min = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(min)) return "";
  return min < 1 ? " (hace menos de un minuto)" : ` (hace ${min} min)`;
}

export function diagnosticLines(d: DiagnosticsInput): string[] {
  const now = d.now ?? new Date();
  const lines: string[] = [];
  if (d.info) {
    const { build, server } = d.info;
    lines.push(
      `Versión: ${build.commit}${build.branch ? ` (${build.branch})` : ""} · entorno ${build.environment}`,
      `Servidor: planificador por defecto ${server.plannerEngine} · energía ${server.energyEngine} · ` +
        `elevación ${server.elevationSource} (${server.terrain}) · desvíos ${server.detourSource}`,
      `Claves: Blaze ${yesNo(server.blazeConfigured)} · Mapbox ${yesNo(server.mapboxConfigured)}`,
    );
  } else {
    lines.push("Versión: consultando…");
  }
  lines.push(
    `Motor de esta página: ${d.engineChoice ?? "sin elegir (el del servidor)"}`,
  );
  if (d.geo) {
    const snap = d.geo as GeoBundle & Partial<Pick<PlanningSnapshot, "providers" | "createdAt">>;
    const p = snap.providers;
    lines.push(
      `Plan en pantalla: planificador ${snap.plannerEngine ?? "legacy"} · energía ${snap.energyEngine ?? "legacy"}` +
        (p ? ` · estaciones ${p.stations} · elevación ${p.elevation} · rutas ${p.routing}` : "") +
        ago(snap.createdAt, now),
      `Estaciones cerca de la ruta: ${d.geo.chargers.length}` +
        (d.geo.stationsVersion ? ` · listado ${d.geo.stationsVersion}` : ""),
    );
    if (d.plan) {
      lines.push(
        `Paradas: ${d.plan.stops.map((s) => s.charger.name).join(" → ") || "ninguna"}` +
          (d.plan.departureCharge
            ? ` · cargar ${d.plan.departureCharge.additionalPct} % antes de salir`
            : ""),
      );
    }
  } else {
    lines.push("Plan en pantalla: ninguno");
  }
  const c = d.conditions;
  lines.push(
    `Vehículo: ${d.vehicle.brand} ${d.vehicle.model} ${d.vehicle.version}`,
    `Viaje: sale con ${c.initialSoc} % · llegada ${c.arrivalSoc} % · margen ${c.safetyMode}` +
      (c.safetyMode === "custom" ? ` ${c.customSafetyPct} %` : "") +
      ` · estrategia ${c.planningMode} · ${c.passengers} pasajero(s), ${c.luggageKg} kg · A/C ${c.ac}` +
      ` · ${c.temperatureC == null ? "temperatura del clima" : `${c.temperatureC} °C`}` +
      ` · estilo ${c.drivingStyle} · regeneración ${c.regenLevel}` +
      (c.allowBelowSafety ? " · permite bajar del margen" : ""),
  );
  return lines;
}
