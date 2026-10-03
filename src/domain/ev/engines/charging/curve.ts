import type { ChargeCurvePoint } from "@/domain/types";
import { MODEL_PARAMETERS, type ModelParameters } from "@/domain/ev/core/params";

/**
 * Curva de carga: cuánto tarda cargar de A a B (plan §4.8). La curva genérica
 * no es del fabricante (el seed lo dice): se trata como estimada.
 */

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

/** Curva plana (carga AC, limitada por el cargador a bordo). */
export const FLAT_CURVE: ChargeCurvePoint[] = [
  { soc: 0, powerFactor: 1 },
  { soc: 100, powerFactor: 1 },
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

/**
 * Minutos para cargar de `socFrom` a `socTo`. La potencia en cada punto es
 * min(pico del vehículo × factor de la curva, potencia de la toma) (C3),
 * integrada en pasos de SOC, más los minutos fijos por parada (estacionar,
 * conectar…). `withOverhead: false` da solo el tiempo de carga (fichas del vehículo).
 */
export function chargeTimeMinutes(
  capacityKwh: number,
  socFrom: number,
  socTo: number,
  vehiclePeakKw: number,
  chargerKw: number,
  curve: ChargeCurvePoint[],
  params = MODEL_PARAMETERS.charging,
  opts: { withOverhead?: boolean } = {},
): number {
  if (socTo <= socFrom + 0.2) return 0;
  const span = socTo - socFrom;
  const steps = Math.max(1, Math.ceil(span / params.integrationStepPct));
  const energyPerStep = (capacityKwh * span) / 100 / steps;
  let hours = 0;
  for (let i = 0; i < steps; i++) {
    const soc = socFrom + (span * (i + 0.5)) / steps;
    const power = Math.min(vehiclePeakKw * lerpFactor(curve, soc), chargerKw);
    hours += energyPerStep / Math.max(power, 1.5);
  }
  return hours * 60 + (opts.withOverhead === false ? 0 : params.connectionOverheadMin.value);
}

/**
 * Tiempos de carga de una toma sobre la malla de integración (M4.2, ADR-0026): la ÚNICA
 * función de tiempo del planificador v2. La programación dinámica, las opciones de cada
 * parada y el resumen de adaptadores salen de aquí, así lo que se optimiza y lo que se
 * muestra son los mismos minutos. Se precalcula una vez por toma: se consulta miles de veces.
 */
export interface ChargeTimeTable {
  /** Minutos acumulados de carga desde 0 hasta `soc`, sin los de conexión (crece). */
  at: (soc: number) => number;
  /** Minutos fijos de conexión por parada. */
  overheadMin: number;
  /** Minutos para cargar de `from` a `to`, con los de conexión (0 si no carga). */
  minutes: (from: number, to: number) => number;
  /** Minutos solo cargando, sin los de conexión. */
  chargingMinutes: (from: number, to: number) => number;
  /** SOC al que se llega cargando `min` minutos desde `from` (cuyo `at` ya se calculó); 100 si no alcanza. */
  socAfter: (from: number, atFrom: number, min: number) => number;
}

export function chargeTimeTable(args: {
  capacityKwh: number;
  /** Pico del vehículo en esta forma de cargar (DC o AC), kW, y su curva por SOC. */
  peakKw: number;
  curve: ChargeCurvePoint[];
  /** Potencia de la toma (la menor entre estación, vehículo y adaptador), kW. */
  plugKw: number;
  /** Fracción de la energía del cargador que llega a la batería (M4.2); 1 = sin pérdidas. */
  efficiency: number;
  params: Pick<ModelParameters["charging"], "integrationStepPct" | "connectionOverheadMin">;
}): ChargeTimeTable {
  const { capacityKwh, peakKw, curve, plugKw, efficiency, params } = args;
  const step = params.integrationStepPct;
  const overhead = params.connectionOverheadMin.value;
  const n = Math.floor(100 / step + 1e-9);
  const cum = new Float64Array(n + 1);
  const energy = (capacityKwh * step) / 100;
  for (let k = 0; k < n; k++) {
    // La curva del vehículo ya es de la batería; la estación entrega `plugKw` y llega `× eficiencia`.
    const power = Math.min(peakKw * lerpFactor(curve, (k + 0.5) * step), plugKw * efficiency);
    cum[k + 1] = cum[k]! + (energy / Math.max(power, 1.5)) * 60;
  }
  const at = (soc: number) => {
    const x = Math.max(0, Math.min(100, soc)) / step;
    const k = Math.min(n - 1, Math.floor(x));
    return cum[k]! + (cum[k + 1]! - cum[k]!) * (x - k);
  };
  // Índice de salto sobre `cum` (que crece): para cada fracción del tiempo total, el último
  // tramo que empieza antes. Encuentra el mismo tramo que una búsqueda binaria con 1–3
  // comparaciones: se llama una vez por llegada a una estación.
  const total = cum[n]!;
  const jump = new Int32Array(n + 1);
  for (let g = 0, lo = 0; g <= n; g++) {
    const boundary = (g * total) / n;
    while (lo + 1 < n && cum[lo + 1]! < boundary) lo++;
    jump[g] = lo;
  }
  const socAfter = (from: number, atFrom: number, min: number): number => {
    if (min <= 0) return from;
    const target = atFrom + min;
    if (target >= total) return 100;
    // El último tramo cuyo inicio está antes del tiempo pedido (cum crece).
    let lo = jump[Math.min(n, Math.floor((target / total) * n))]!;
    while (lo + 1 < n && cum[lo + 1]! < target) lo++;
    const hi = lo + 1;
    const x = lo + (target - cum[lo]!) / (cum[hi]! - cum[lo]!);
    return Math.max(from, x * step);
  };
  return {
    at,
    overheadMin: overhead,
    minutes: (from, to) => (to > from ? at(to) - at(from) + overhead : 0),
    chargingMinutes: (from, to) => (to > from ? at(to) - at(from) : 0),
    socAfter,
  };
}
