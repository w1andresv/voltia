import type { ChargeCurvePoint } from "@/domain/types";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";

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
