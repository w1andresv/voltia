import { CONNECTOR_LABEL, type AdapterNeeded } from "@/domain/types";
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
