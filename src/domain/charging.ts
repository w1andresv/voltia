/**
 * Compatibilidad y curva de carga. La lógica vive en los engines del motor v2
 * (engines/compatibility y engines/charging); este módulo la reexporta para el
 * código que aún importa desde aquí (se retira en F9).
 */
import type { ChargerSocket, ConnectorType, Vehicle } from "./types";
import { isDcSocket } from "./ev/engines/compatibility/engine";
import { lerpFactor } from "./ev/engines/charging/curve";

export {
  VERIFIED_DC_ADAPTERS,
  adapterRequirement,
  isDcSocket,
  routePlugs,
  routeSocket,
  socketCurrent,
  usableAdapters,
  type AdapterRequirement,
  type RoutePlug,
} from "./ev/engines/compatibility/engine";
export { DEFAULT_CURVE, FLAT_CURVE, chargeTimeMinutes, lerpFactor } from "./ev/engines/charging/curve";

/** ¿El estándar es de carga rápida? GB/T existe en AC y DC: sin la toma no se sabe (usar isDcSocket). */
export function isDc(connector: ConnectorType): boolean {
  return ["ccs2", "ccs1", "chademo", "nacs"].includes(connector);
}

/** Potencia de una toma para este vehículo, sin adaptador. */
export function effectiveChargeKw(socket: ChargerSocket, vehicle: Vehicle): number {
  return Math.min(socket.powerKw, isDcSocket(socket) ? vehicle.dcMaxKw : vehicle.acMaxKw);
}

export function powerKwAtSoc(vehicle: Vehicle, soc: number): number {
  return Math.max(0, vehicle.dcMaxKw * lerpFactor(vehicle.chargeCurve, soc));
}

export function chargeCurveSeries(vehicle: Vehicle, step = 4): { soc: number; kw: number }[] {
  const pts: { soc: number; kw: number }[] = [];
  for (let soc = 0; soc <= 100; soc += step) {
    pts.push({ soc, kw: powerKwAtSoc(vehicle, soc) });
  }
  return pts;
}
