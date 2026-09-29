import type { Charger, ChargerSocket, ConnectorType, Vehicle } from "@/domain/types";

/**
 * StationCompatibilityEngine: ¿puede este vehículo cargar aquí, cómo y a qué
 * potencia? (plan §4.7). Corrige C4: los adaptadores son los que el usuario
 * dice que lleva, la corriente de la toma cuenta, y el adaptador limita potencia.
 */

/**
 * Adaptadores de carga rápida que la ruta puede proponer, SI el usuario los lleva.
 * Fuera de esta lista no se asume compatibilidad.
 */
export const VERIFIED_DC_ADAPTERS: { from: ConnectorType; to: ConnectorType }[] = [
  { from: "gb_t", to: "ccs2" },
  { from: "ccs1", to: "ccs2" },
];

const DC_ONLY: ConnectorType[] = ["ccs2", "ccs1", "chademo", "nacs"];

/**
 * Corriente de la toma. GB/T existe en AC y en DC: sin un dato reportado por
 * una fuente no se asume ninguna (null).
 */
export function socketCurrent(socket: ChargerSocket): "AC" | "DC" | null {
  if (socket.connector === "gb_t") {
    return socket.currentOrigin === "reported" ? (socket.current ?? null) : null;
  }
  if (socket.current) return socket.current;
  if (socket.connector === "type2" || socket.connector === "type1") return "AC";
  return DC_ONLY.includes(socket.connector) ? "DC" : null;
}

export function isDcSocket(socket: ChargerSocket): boolean {
  return socketCurrent(socket) === "DC";
}

export interface ChargeAdapter {
  from: ConnectorType;
  to: ConnectorType;
  maxPowerKw?: number;
}

/** Adaptadores que el vehículo lleva y que la lista verificada permite, hacia un conector del vehículo. */
export function usableAdapters(vehicle: Vehicle): ChargeAdapter[] {
  return (vehicle.adapters ?? []).filter(
    (a) =>
      vehicle.connectors.includes(a.to) &&
      VERIFIED_DC_ADAPTERS.some((v) => v.from === a.from && v.to === a.to),
  );
}

export interface RoutePlug {
  socket: ChargerSocket;
  adapter: { from: ConnectorType; to: ConnectorType } | null;
  /** Carga rápida (DC) o lenta (AC). */
  dc: boolean;
  /** Potencia máxima de esta forma de cargar: el menor entre toma, vehículo y adaptador. */
  powerKw: number;
  limitedBy: "station" | "vehicle" | "adapter";
  /** La potencia de la toma viene de una fuente o se asumió por el estándar (C7). */
  powerSource: "reported" | "assumed";
}

function plugOf(
  socket: ChargerSocket,
  vehicle: Vehicle,
  dc: boolean,
  adapter: ChargeAdapter | null,
): RoutePlug {
  const vehicleKw = dc ? vehicle.dcMaxKw : vehicle.acMaxKw;
  const adapterKw = adapter?.maxPowerKw ?? Infinity;
  const powerKw = Math.min(socket.powerKw, vehicleKw, adapterKw);
  const limitedBy =
    powerKw === socket.powerKw ? "station" : powerKw === vehicleKw ? "vehicle" : "adapter";
  return {
    socket,
    adapter: adapter ? { from: adapter.from, to: adapter.to } : null,
    dc,
    powerKw,
    limitedBy,
    powerSource: socket.powerOrigin === "reported" ? "reported" : "assumed",
  };
}

/**
 * Todas las formas reales de cargar en la estación: cada toma DC directa o con
 * un adaptador que el usuario lleva, y la mejor toma AC compatible.
 */
export function routePlugs(charger: Charger, vehicle: Vehicle): RoutePlug[] {
  const adapters = usableAdapters(vehicle);
  const plugs: RoutePlug[] = [];
  for (const socket of charger.sockets) {
    if (!isDcSocket(socket)) continue;
    if (vehicle.connectors.includes(socket.connector)) {
      plugs.push(plugOf(socket, vehicle, true, null));
      continue;
    }
    const adapter = adapters.find((a) => a.from === socket.connector);
    if (adapter) plugs.push(plugOf(socket, vehicle, true, adapter));
  }
  const ac = charger.sockets.filter((s) => !isDcSocket(s) && vehicle.connectors.includes(s.connector));
  if (ac.length) {
    const best = ac.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
    plugs.push(plugOf(best, vehicle, false, null));
  }
  return plugs;
}

/**
 * Cargas rápidas que la estación ofrece con un adaptador verificado que el
 * usuario NO marcó que lleva. El plan no cuenta con ellas (C4); sirven para
 * avisar "con adaptador cargarías en X min".
 */
export function uncarriedAdapterPlugs(charger: Charger, vehicle: Vehicle): RoutePlug[] {
  const carried = usableAdapters(vehicle);
  const plugs: RoutePlug[] = [];
  for (const socket of charger.sockets) {
    if (!isDcSocket(socket) || vehicle.connectors.includes(socket.connector)) continue;
    if (carried.some((a) => a.from === socket.connector)) continue;
    const verified = VERIFIED_DC_ADAPTERS.find((v) => v.from === socket.connector && vehicle.connectors.includes(v.to));
    if (verified) plugs.push(plugOf(socket, vehicle, true, verified));
  }
  return plugs;
}

/** La forma más rápida de cargar. Sin ninguna, la estación no sirve para este vehículo. */
export function routeSocket(charger: Charger, vehicle: Vehicle): RoutePlug | null {
  const plugs = routePlugs(charger, vehicle);
  if (!plugs.length) return null;
  return plugs.reduce((best, plug) => (plug.powerKw > best.powerKw ? plug : best));
}

export interface AdapterRequirement {
  /** Conectores de la estación, sin repetir. */
  station: ConnectorType[];
  /** Un adaptador de la lista verificada que serviría; null si no hay ninguno. */
  adapter: { from: ConnectorType; to: ConnectorType } | null;
  /** El usuario marcó que lleva ese adaptador. */
  carried: boolean;
  /**
   * Con ese adaptador la estación sirve: la toma es de carga rápida (DC).
   * Un GB/T sin corriente reportada no lo es (C4). Con `carried`, el plan la usa.
   */
  fastCharge: boolean;
}

/**
 * La estación no tiene ningún conector del vehículo: hace falta un adaptador.
 * Dice cuál (si hay uno verificado), si el usuario lo lleva y si con él la
 * estación serviría. null si el vehículo conecta directo o no hay conectores.
 */
export function adapterRequirement(charger: Charger, vehicle: Vehicle): AdapterRequirement | null {
  const station = [...new Set(charger.sockets.map((s) => s.connector))];
  if (!station.length || station.some((c) => vehicle.connectors.includes(c))) return null;
  const candidates = VERIFIED_DC_ADAPTERS.filter(
    (v) => station.includes(v.from) && vehicle.connectors.includes(v.to),
  );
  const carries = (a: ChargeAdapter) =>
    (vehicle.adapters ?? []).some((c) => c.from === a.from && c.to === a.to);
  const works = (a: ChargeAdapter) => routeSocket(charger, { ...vehicle, adapters: [a] }) != null;
  const adapter =
    candidates.find((a) => carries(a) && works(a)) ??
    candidates.find(works) ??
    candidates[0] ??
    null;
  return {
    station,
    adapter,
    carried: adapter ? carries(adapter) : false,
    fastCharge: adapter ? works(adapter) : false,
  };
}
