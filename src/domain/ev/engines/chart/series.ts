import type { RouteSample } from "@/domain/types";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";

/**
 * Series para las gráficas (plan §4.11, especificación §5.10). La UI solo
 * dibuja: todo lo que se grafica se calcula aquí, a partir de la misma
 * simulación que produjo el plan.
 */

/** Tamaño de ventana según el largo de la ruta: la primera fila cuyo tope supera el total. */
export interface WindowRule {
  upToKm: number;
  windowKm: number;
}

export function chartWindowKm(totalKm: number, rules: WindowRule[] = MODEL_PARAMETERS.chart.windows): number {
  for (const r of rules) if (totalKm < r.upToKm) return r.windowKm;
  return rules[rules.length - 1]?.windowKm ?? 5;
}

/** Valor de una serie acumulada en `km`, interpolando entre muestras (prorrateo por distancia). */
export function valueAtKm<T extends { km: number }>(samples: T[], km: number, pick: (s: T) => number): number {
  if (km <= samples[0]!.km) return pick(samples[0]!);
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i]!;
    if (km <= b.km) {
      const a = samples[i - 1]!;
      const span = b.km - a.km;
      const t = span > 0 ? (km - a.km) / span : 1;
      return pick(a) + (pick(b) - pick(a)) * t;
    }
  }
  return pick(samples[samples.length - 1]!);
}

type EnergySample = Pick<RouteSample, "km" | "cumulativeKwh">;

export interface ConsumptionWindow {
  fromKm: number;
  toKm: number;
  /** Centro de la ventana, para el eje X. */
  midKm: number;
  /** kWh netos en la ventana (negativo en bajadas que regeneran más de lo que gastan). */
  kwh: number;
  kwhPer100: number;
}

/**
 * Consumo neto por ventanas de `windowKm`. La energía de cada tramo entre
 * muestras se reparte por distancia entre las ventanas que cruza, así la suma
 * de las ventanas es igual al total de la ruta. La última ventana puede ser
 * más corta.
 */
export function consumptionWindows(samples: EnergySample[], windowKm: number): ConsumptionWindow[] {
  if (samples.length < 2 || !(windowKm > 0)) return [];
  const start = samples[0]!.km;
  const end = samples[samples.length - 1]!.km;
  if (!(end > start)) return [];
  const out: ConsumptionWindow[] = [];
  let prev = valueAtKm(samples, start, (s) => s.cumulativeKwh);
  for (let from = start; from < end - 1e-9; from += windowKm) {
    const to = Math.min(end, from + windowKm);
    const cum = valueAtKm(samples, to, (s) => s.cumulativeKwh);
    const kwh = cum - prev;
    prev = cum;
    out.push({ fromKm: from, toKm: to, midKm: (from + to) / 2, kwh, kwhPer100: (kwh / (to - from)) * 100 });
  }
  return out;
}

export interface ConsumptionPoint {
  km: number;
  /** Consumo de la ventana que contiene este km (kWh/100 km). */
  windowKwhPer100: number | null;
  /** Promedio acumulado desde la salida (kWh/100 km); null en los primeros metros. */
  cumulativeKwhPer100: number | null;
}

export interface ConsumptionSeries {
  windowKm: number;
  windows: ConsumptionWindow[];
  /** Una fila por muestra, para dibujar y enlazar el cursor con el mapa. */
  points: ConsumptionPoint[];
}

/** Por debajo de esta distancia el promedio acumulado es ruido. */
const MIN_CUMULATIVE_KM = 0.3;

export function consumptionSeries(samples: EnergySample[], windowKm?: number): ConsumptionSeries {
  const total = samples.length ? samples[samples.length - 1]!.km - samples[0]!.km : 0;
  const w = windowKm ?? chartWindowKm(total);
  const windows = consumptionWindows(samples, w);
  let wi = 0;
  const points = samples.map((s) => {
    while (wi < windows.length - 1 && s.km > windows[wi]!.toKm) wi++;
    const win = windows[wi];
    return {
      km: s.km,
      windowKwhPer100: win ? win.kwhPer100 : null,
      cumulativeKwhPer100: s.km > MIN_CUMULATIVE_KM ? (s.cumulativeKwh / s.km) * 100 : null,
    };
  });
  return { windowKm: w, windows, points };
}

export interface SocPoint {
  km: number;
  soc: number;
  /** "arrive" y "depart" marcan el salto de una parada (mismo km, dos valores). */
  kind: "route" | "arrive" | "depart";
}

/**
 * SOC contra distancia con el salto de cada carga: en el km de la parada va
 * primero el SOC al llegar y luego el de salida. Sin paradas, es el SOC de
 * cada muestra.
 */
export function socSeries(
  samples: Pick<RouteSample, "km" | "soc">[],
  stops: { kmAlongRoute: number; arriveSoc: number; departSoc: number }[] = [],
): SocPoint[] {
  const sorted = [...stops].sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
  const out: SocPoint[] = [];
  let si = 0;
  for (const s of samples) {
    while (si < sorted.length && sorted[si]!.kmAlongRoute <= s.km) {
      const st = sorted[si++]!;
      out.push({ km: st.kmAlongRoute, soc: st.arriveSoc, kind: "arrive" });
      out.push({ km: st.kmAlongRoute, soc: st.departSoc, kind: "depart" });
    }
    // La muestra de la parada ya quedó representada por el salto.
    const last = out[out.length - 1];
    if (last?.kind === "depart" && Math.abs(last.km - s.km) < 1e-9) continue;
    out.push({ km: s.km, soc: s.soc, kind: "route" });
  }
  for (; si < sorted.length; si++) {
    const st = sorted[si]!;
    out.push({ km: st.kmAlongRoute, soc: st.arriveSoc, kind: "arrive" });
    out.push({ km: st.kmAlongRoute, soc: st.departSoc, kind: "depart" });
  }
  return out;
}

export interface ConsumptionBlock {
  fromKm: number;
  toKm: number;
  /** kWh netos del tramo (negativo si baja mucho y regenera más de lo que gasta). */
  kwh: number;
  kwhPer100: number;
  gainM: number;
  lossM: number;
}

/**
 * Consumo neto por tramos de `blockKm` (100 km por defecto), a partir del
 * acumulado de la ruta. Un resto final menor que `minTailKm` se suma al tramo
 * anterior para no mostrar un promedio ruidoso de pocos km.
 */
export function consumptionBlocks(
  samples: Pick<RouteSample, "km" | "cumulativeKwh" | "elevM">[],
  blockKm = 100,
  minTailKm = 25,
): ConsumptionBlock[] {
  if (samples.length < 2 || !(blockKm > 0)) return [];
  const total = samples[samples.length - 1]!.km;
  if (!(total > 0)) return [];
  const edges: number[] = [0];
  for (let km = blockKm; km < total; km += blockKm) edges.push(km);
  if (edges.length > 1 && total - edges[edges.length - 1]! < minTailKm) edges.pop();
  edges.push(total);

  // Desnivel acumulado (subida y bajada por separado) en cada muestra.
  let gain = 0;
  let loss = 0;
  const climb = samples.map((s, i) => {
    if (i > 0) {
      const d = s.elevM - samples[i - 1]!.elevM;
      if (d > 0) gain += d;
      else loss -= d;
    }
    return { km: s.km, gain, loss };
  });
  const climbAt = (km: number, key: "gain" | "loss") => valueAtKm(climb, km, (p) => p[key]);

  const out: ConsumptionBlock[] = [];
  for (let i = 1; i < edges.length; i++) {
    const fromKm = edges[i - 1]!;
    const toKm = edges[i]!;
    const kwh =
      valueAtKm(samples, toKm, (s) => s.cumulativeKwh) - valueAtKm(samples, fromKm, (s) => s.cumulativeKwh);
    const km = toKm - fromKm;
    out.push({
      fromKm,
      toKm,
      kwh,
      kwhPer100: km > 0 ? (kwh / km) * 100 : 0,
      gainM: climbAt(toKm, "gain") - climbAt(fromKm, "gain"),
      lossM: climbAt(toKm, "loss") - climbAt(fromKm, "loss"),
    });
  }
  return out;
}
