import type { AdapterRequirement } from "@/domain/charging";
import { CONNECTOR_LABEL, type AdapterNeeded, type ConnectorType } from "@/domain/types";
import { formatKw, formatMinutes } from "./format";

/**
 * Texto de una parada con carga rápida que requiere adaptador: cuál, si lo
 * llevas, y cuánto tarda esta carga con y sin él.
 */
export function adapterNote(a: AdapterNeeded): { title: string; withLine: string; withoutLine: string } {
  const pair = `${CONNECTOR_LABEL[a.from]} → ${CONNECTOR_LABEL[a.to]}`;
  const title = a.carried
    ? `Requiere adaptador ${pair} (lo llevas)`
    : `Carga rápida con adaptador ${pair} (no marcaste que lo llevas)`;
  const withLine = `Con adaptador: ${formatMinutes(a.withAdapter.chargeMinutes)} a ${formatKw(a.withAdapter.chargeKw)}${
    a.carried ? "" : " — el plan no cuenta con esta opción"
  }`;
  const withoutLine = a.withoutAdapter
    ? `Sin adaptador: ${formatMinutes(a.withoutAdapter.chargeMinutes)} a ${formatKw(a.withoutAdapter.chargeKw)} (${
        a.withoutAdapter.mode === "ac" ? "carga lenta" : "carga directa"
      })`
    : "Sin adaptador: esta estación no tiene otra toma para tu vehículo";
  return { title, withLine, withoutLine };
}

const labels = (list: ConnectorType[]) => list.map((c) => CONNECTOR_LABEL[c]).join(", ");

/**
 * Aviso de la ficha de una estación cuyo conector no coincide con el del
 * vehículo: requiere adaptador, cuál, y si la ruta cuenta con ella.
 */
export function adapterRequirementNote(
  r: AdapterRequirement,
  vehicle: { name: string; connectors: ConnectorType[] },
): string {
  if (!r.adapter) {
    return `Requiere adaptador para ${vehicle.name}: la estación tiene ${labels(r.station)} y el vehículo usa ${labels(vehicle.connectors)}.`;
  }
  const pair = `${CONNECTOR_LABEL[r.adapter.from]} → ${CONNECTOR_LABEL[r.adapter.to]}`;
  if (!r.fastCharge) {
    return `Requiere adaptador ${pair}, pero la fuente no confirma que la toma ${CONNECTOR_LABEL[r.adapter.from]} sea de carga rápida (DC): la ruta no cuenta con ella.`;
  }
  if (r.carried) return `Requiere adaptador ${pair} (lo llevas).`;
  return `Requiere adaptador ${pair}. Si lo llevas, márcalo en tu vehículo y la ruta contará con esta estación.`;
}
