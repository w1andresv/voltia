import type { EnergySample } from "@/domain/ev/contracts/energy";
import type { RegenAcceptance, SocEvent } from "@/domain/ev/contracts/soc";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import { kwhToSocPct } from "@/domain/ev/core/units";
import type { RouteSample } from "@/domain/types";

/**
 * SOCEngine: cómo evoluciona la batería a lo largo del perfil de energía.
 * Recorta la regeneración según el SOC (la batería casi llena no la acepta),
 * aplica cargas y desvíos como eventos y NO recorta el SOC en 0, para poder
 * medir cuánto falta.
 */

/** Fracción de la regeneración que acepta la batería con `socPct`. */
export function regenAcceptance(
  socPct: number,
  params: RegenAcceptance = MODEL_PARAMETERS.soc.regenAcceptance,
): number {
  if (socPct >= params.zeroFromPct) return 0;
  if (socPct <= params.fullBelowPct) return 1;
  return (params.zeroFromPct - socPct) / (params.zeroFromPct - params.fullBelowPct);
}

/** SOC después de recorrer el tramo que llega a `sample`, saliendo con `socPct`. */
function stepSoc(
  sample: EnergySample,
  socPct: number,
  capacityKwh: number,
  params: RegenAcceptance,
): { soc: number; netKwh: number; acceptedKwh: number } {
  const acceptedKwh = sample.energyRegenKwh * regenAcceptance(socPct, params);
  const netKwh = sample.energyGrossKwh - acceptedKwh;
  return { soc: socPct - kwhToSocPct(netKwh, capacityKwh), netKwh, acceptedKwh };
}

/** SOC después de recorrer el tramo que llega a `sample`: la misma aritmética que `stepSoc`, sin armar objetos. */
function nextSoc(
  sample: EnergySample,
  socPct: number,
  capacityKwh: number,
  params: RegenAcceptance,
): number {
  const acceptedKwh = sample.energyRegenKwh * regenAcceptance(socPct, params);
  return socPct - kwhToSocPct(sample.energyGrossKwh - acceptedKwh, capacityKwh);
}

/**
 * Recorre el perfil desde `fromIdx` saliendo con `startSoc` y avisa en cada
 * muestra el SOC y el mínimo hasta ahí. Si `visit` devuelve false, se detiene.
 * El planificador lo recibe inyectado para no duplicar el cálculo del SOC.
 */
export function walkSoc(
  samples: EnergySample[],
  fromIdx: number,
  startSoc: number,
  capacityKwh: number,
  visit: (idx: number, soc: number, lowest: number) => boolean,
  params: RegenAcceptance = MODEL_PARAMETERS.soc.regenAcceptance,
): void {
  let soc = startSoc;
  let lowest = startSoc;
  for (let i = Math.max(0, fromIdx) + 1; i < samples.length; i++) {
    soc = nextSoc(samples[i]!, soc, capacityKwh, params);
    if (soc < lowest) lowest = soc;
    if (!visit(i, soc, lowest)) return;
  }
}

/**
 * SOC gastado acumulado (%) hasta cada muestra con la regeneración entera: el
 * atajo lineal del planificador (`PlannerInput.linear`). Vale mientras el SOC
 * no pase de `fullBelowPct`, donde la batería acepta toda la regeneración.
 */
export function spentSocPct(samples: EnergySample[], capacityKwh: number): Float64Array {
  const out = new Float64Array(samples.length);
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]!;
    out[i] = out[i - 1]! + kwhToSocPct(s.energyGrossKwh - s.energyRegenKwh, capacityKwh);
  }
  return out;
}

export interface LegSoc {
  /** SOC al llegar a `toIdx`. */
  endSoc: number;
  /** SOC más bajo del tramo (incluida la llegada). */
  lowestSoc: number;
}

/** Recorre por la vía de `fromIdx` a `toIdx` saliendo con `startSoc`. */
export function legSoc(
  samples: EnergySample[],
  fromIdx: number,
  toIdx: number,
  startSoc: number,
  capacityKwh: number,
  params: RegenAcceptance = MODEL_PARAMETERS.soc.regenAcceptance,
): LegSoc {
  let soc = startSoc;
  let lowest = startSoc;
  const end = Math.min(samples.length - 1, toIdx);
  for (let i = Math.max(0, fromIdx) + 1; i <= end; i++) {
    soc = nextSoc(samples[i]!, soc, capacityKwh, params);
    if (soc < lowest) lowest = soc;
  }
  return { endSoc: soc, lowestSoc: lowest };
}

/**
 * Menor SOC de salida en `fromIdx` para llegar a `toIdx` con `arrivalTargetPct`
 * (después de gastar `extraKwh`, p. ej. un desvío) sin bajar de `floorPct` en
 * ningún punto. Primero la cuenta directa (regeneración completa); si la batería
 * recorta regeneración, búsqueda binaria: el SOC de llegada crece con el de salida.
 */
export function requiredStartSoc(
  samples: EnergySample[],
  fromIdx: number,
  toIdx: number,
  capacityKwh: number,
  target: { arrivalTargetPct: number; floorPct: number; extraKwh: number; tolerancePct: number },
  params: RegenAcceptance = MODEL_PARAMETERS.soc.regenAcceptance,
): number {
  const base = samples[Math.max(0, fromIdx)]!.cumulativeKwh;
  const end = Math.min(samples.length - 1, toIdx);
  let draw = 0;
  for (let k = Math.max(0, fromIdx) + 1; k <= end; k++) draw = Math.max(draw, samples[k]!.cumulativeKwh - base);
  const leg = samples[end]!.cumulativeKwh - base;
  const guess = Math.max(
    target.arrivalTargetPct + kwhToSocPct(leg + target.extraKwh, capacityKwh),
    target.floorPct + kwhToSocPct(draw, capacityKwh),
  );
  const ok = (start: number) => {
    const r = legSoc(samples, fromIdx, toIdx, start, capacityKwh, params);
    const arrive = r.endSoc - kwhToSocPct(target.extraKwh, capacityKwh);
    return arrive >= target.arrivalTargetPct - target.tolerancePct && r.lowestSoc >= target.floorPct - target.tolerancePct;
  };
  if (guess >= 100 || ok(guess)) return guess;
  let lo = guess;
  let hi = 100;
  // Ni saliendo al 100 % se cumple: más de 100 indica que el tramo no se puede hacer.
  if (!ok(hi)) return Math.max(guess, 100 + target.tolerancePct);
  for (let it = 0; it < 40 && hi - lo > 1e-6; it++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

export interface SocSimulation {
  /** Muestras con el SOC, y la energía y regeneración que la batería realmente aceptó. */
  samples: RouteSample[];
  arrivalSoc: number;
  minSoc: number;
  minIndex: number;
  /** Regeneración potencial que la batería no aceptó por estar casi llena. */
  curtailedRegenKwh: number;
  /** kWh que faltan en el punto más bajo (0 si el SOC nunca baja de 0). */
  maxDeficitKwh: number;
}

/** Simula el recorrido completo con cargas y desvíos como eventos. */
export function simulateSoc(
  samples: EnergySample[],
  opts: { initialSocPct: number; capacityKwh: number; events?: SocEvent[]; regen?: RegenAcceptance },
): SocSimulation {
  const params = opts.regen ?? MODEL_PARAMETERS.soc.regenAcceptance;
  const cap = opts.capacityKwh;
  // Por muestra: lo que sale (desvíos) y lo que entra (cargas), por separado, para
  // medir el mínimo al llegar al cargador, antes de cargar.
  const outAt = new Map<number, number>();
  const inAt = new Map<number, number>();
  for (const ev of opts.events ?? []) {
    const map = ev.energyKwh < 0 ? outAt : inAt;
    map.set(ev.atIndex, (map.get(ev.atIndex) ?? 0) + ev.energyKwh);
  }

  let soc = opts.initialSocPct;
  let cum = 0;
  let curtailed = 0;
  let minSoc = soc;
  let minIndex = 0;
  const out: RouteSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    let net = 0;
    let accepted = 0;
    if (i > 0) {
      const step = stepSoc(s, soc, cap, params);
      soc = step.soc;
      net = step.netKwh;
      accepted = step.acceptedKwh;
      curtailed += s.energyRegenKwh - accepted;
    }
    const spent = outAt.get(i);
    if (spent != null) soc += kwhToSocPct(spent, cap);
    // El mínimo se mide al llegar (después del desvío), antes de cargar.
    if (soc < minSoc) {
      minSoc = soc;
      minIndex = i;
    }
    const added = inAt.get(i);
    if (added != null) soc += kwhToSocPct(added, cap);
    cum += net;
    out.push({
      ...s,
      energyKwh: net,
      energyRegenKwh: accepted,
      cumulativeKwh: cum,
      avgKwhPer100: s.km > 0.3 ? (cum / s.km) * 100 : 0,
      soc,
    });
  }
  return {
    samples: out,
    arrivalSoc: soc,
    minSoc,
    minIndex,
    curtailedRegenKwh: curtailed,
    maxDeficitKwh: Math.max(0, (-minSoc / 100) * cap),
  };
}
