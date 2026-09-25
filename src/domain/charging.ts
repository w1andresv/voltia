import type { ChargeCurvePoint, Charger, ChargerSocket, ConnectorType, Vehicle } from "./types";

export interface RoutePlug {
  socket: ChargerSocket;
  adapter: { from: ConnectorType; to: ConnectorType } | null;
}

export const DEFAULT_CURVE: ChargeCurvePoint[] = [
  { soc: 0, powerFactor: 0.55 },
  { soc: 8, powerFactor: 0.9 },
  { soc: 15, powerFactor: 1 },
  { soc: 40, powerFactor: 1 },
  { soc: 55, powerFactor: 0.86 },
  { soc: 70, powerFactor: 0.64 },
  { soc: 80, powerFactor: 0.42 },
  { soc: 90, powerFactor: 0.22 },
  { soc: 100, powerFactor: 0.08 },
];

export function lerpFactor(curve: ChargeCurvePoint[], soc: number): number {
  const pts = curve.length ? curve : DEFAULT_CURVE;
  const x = Math.max(0, Math.min(100, soc));
  if (x <= pts[0]!.soc) return pts[0]!.powerFactor;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (x <= b.soc) {
      const t = (x - a.soc) / Math.max(0.001, b.soc - a.soc);
      return a.powerFactor + (b.powerFactor - a.powerFactor) * t;
    }
  }
  return pts[pts.length - 1]!.powerFactor;
}

export function chargeTimeMinutes(
  capacityKwh: number,
  socFrom: number,
  socTo: number,
  vehiclePeakKw: number,
  chargerKw: number,
  curve: ChargeCurvePoint[],
): number {
  if (socTo <= socFrom + 0.2) return 0;
  const steps = 24;
  let hours = 0;
  const span = socTo - socFrom;
  for (let i = 0; i < steps; i++) {
    const soc = socFrom + (span * (i + 0.5)) / steps;
    const power = Math.min(vehiclePeakKw, chargerKw) * lerpFactor(curve, soc);
    const energy = (capacityKwh * span) / 100 / steps;
    hours += energy / Math.max(power, 1.5);
  }
  return hours * 60;
}

const DC_CONNECTORS: ConnectorType[] = ["ccs2", "ccs1", "chademo", "nacs", "gb_t"];

/**
 * Únicos adaptadores de carga rápida que la ruta propone. Fuera de esta lista
 * no hay compatibilidad: CHAdeMO, NACS y el resto no se inventan.
 */
export const VERIFIED_DC_ADAPTERS: { from: ConnectorType; to: ConnectorType }[] = [
  { from: "gb_t", to: "ccs2" },
  { from: "ccs1", to: "ccs2" },
];

export function isDc(connector: ConnectorType): boolean {
  return DC_CONNECTORS.includes(connector);
}

export function compatibleSockets(charger: Charger, vehicle: Vehicle): ChargerSocket[] {
  return charger.sockets.filter((s) => vehicle.connectors.includes(s.connector));
}

function highestPower(list: ChargerSocket[]): ChargerSocket {
  return list.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
}

export function bestSocket(charger: Charger, vehicle: Vehicle): ChargerSocket | null {
  const list = compatibleSockets(charger, vehicle);
  if (!list.length) return null;
  const dc = list.filter((s) => isDc(s.connector));
  const pool = dc.length ? dc : list;
  return highestPower(pool);
}

export function directAcSocket(charger: Charger, vehicle: Vehicle): ChargerSocket | null {
  const ac = compatibleSockets(charger, vehicle).filter((s) => !isDc(s.connector));
  return ac.length ? highestPower(ac) : null;
}

function verifiedAdapter(
  station: ConnectorType,
  vehicle: Vehicle,
): { from: ConnectorType; to: ConnectorType } | null {
  const match = VERIFIED_DC_ADAPTERS.find(
    (a) => a.from === station && vehicle.connectors.includes(a.to) && isDc(a.to),
  );
  return match ? { from: match.from, to: match.to } : null;
}

/** Todas las formas reales de usar la estación: directo, adaptador definido o AC. */
export function routePlugs(charger: Charger, vehicle: Vehicle): RoutePlug[] {
  const plugs: RoutePlug[] = [];
  for (const socket of charger.sockets) {
    if (!isDc(socket.connector)) continue;
    if (vehicle.connectors.includes(socket.connector)) {
      plugs.push({ socket, adapter: null });
      continue;
    }
    const adapter = verifiedAdapter(socket.connector, vehicle);
    if (adapter) plugs.push({ socket, adapter });
  }
  const ac = directAcSocket(charger, vehicle);
  if (ac) plugs.push({ socket: ac, adapter: null });
  return plugs;
}

/** La opción más rápida que el auto puede usar. Sin ninguna, la estación no sirve. */
export function routeSocket(charger: Charger, vehicle: Vehicle): RoutePlug | null {
  const plugs = routePlugs(charger, vehicle);
  if (!plugs.length) return null;
  return plugs.reduce((best, plug) =>
    effectiveChargeKw(plug.socket, vehicle) > effectiveChargeKw(best.socket, vehicle) ? plug : best,
  );
}

export function effectiveChargeKw(socket: ChargerSocket, vehicle: Vehicle): number {
  const cap = isDc(socket.connector) ? vehicle.dcMaxKw : vehicle.acMaxKw;
  return Math.min(socket.powerKw, cap);
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
