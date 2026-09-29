import type { EnergySample } from "@/domain/ev/contracts/energy";
import type { PlanningMode } from "@/domain/types";

/**
 * ChargingPlanner v2 (plan §4.9, especificación §5.8): dónde parar y cuánto
 * cargar. Programación dinámica sobre (estación, SOC de salida en una malla),
 * con costo lexicográfico según la estrategia. No calcula consumo ni tiempos:
 * recibe inyectados el recorrido del SOC (SOCEngine) y el tiempo de carga de
 * cada estación (curva). Reemplaza la selección por puntaje (D6).
 */

/** Recorre el SOC desde una muestra (lo inyecta el SOCEngine: `walkSoc`). */
export type SocWalker = (
  fromIdx: number,
  startSoc: number,
  visit: (idx: number, soc: number, lowest: number) => boolean,
) => void;

export interface PlannerNode {
  /** Muestra de la ruta donde queda la estación. */
  sIdx: number;
  /** Puntos de SOC del desvío de ida y vuelta (se descuentan al llegar). */
  detourPct: number;
  detourKm: number;
  detourKwh: number;
  detourMin: number;
  /** Espera esperada (p. ej. estación ocupada). */
  waitMin: number;
  /** Minutos para cargar de `fromSoc` a `toSoc` en esta estación, con los minutos fijos. */
  chargeMinutes: (fromSoc: number, toSoc: number) => number;
  /** Carga rápida (DC): al salir de aquí aplica `PlannerInput.fastChargeBuffer`. */
  fast?: boolean;
}

export interface PlannerInput {
  samples: EnergySample[];
  initialSocPct: number;
  /** Piso de SOC en todo punto, también al llegar a una estación. */
  floorPct: number;
  /** SOC mínimo al destino. */
  destinationReservePct: number;
  /** Tope de carga en ruta. */
  maxChargePct: number;
  /** Estaciones compatibles, ordenadas por `sIdx`. */
  nodes: PlannerNode[];
  objective: PlanningMode;
  walk: SocWalker;
  gridPct: number;
  tolerancePct: number;
  /**
   * Al salir de una estación rápida hacia otra estación, ese tramo debe terminar
   * con `extraPct` puntos de más sobre el piso: se carga eso más de lo necesario
   * para no llegar justo a la siguiente parada. No aplica al tramo final (no hay
   * otra parada que cuidar: solo se pide la reserva al destino), ni si ya se
   * sale con `maxSocPct` o más (ni con el tope de carga). Ningún plan viable
   * deja de serlo.
   */
  fastChargeBuffer?: { extraPct: number; maxSocPct: number };
}

export interface PlannedStop {
  node: number;
  arriveSoc: number;
  departSoc: number;
}

export interface PlannerResult {
  feasible: boolean;
  stops: PlannedStop[];
  arrivalSoc: number;
  minSoc: number;
  objective: { stops: number; extraMinutes: number; detourKm: number; detourKwh: number };
  /** Estaciones alcanzables desde el origen con alguna combinación de cargas. */
  reachable: number[];
  /** Km (índice de muestra) más lejano al que se llega sin bajar del piso. */
  furthestIdx: number;
  /** Se llega al tramo final pero no con la reserva al destino. */
  destinationShort: boolean;
}

interface Label {
  stops: number;
  minutes: number;
  detourKm: number;
  detourKwh: number;
  minSoc: number;
  arrive: number;
  prevNode: number;
  prevD: number;
}

const EPS = 1e-9;

function diff(a: number, b: number, eps = 1e-6): number {
  return Math.abs(a - b) > eps ? a - b : 0;
}

/** < 0 si `a` es mejor que `b` para la estrategia. */
export function compareLabels(
  a: Pick<Label, "stops" | "minutes" | "detourKm" | "detourKwh" | "minSoc">,
  b: Pick<Label, "stops" | "minutes" | "detourKm" | "detourKwh" | "minSoc">,
  objective: PlanningMode,
): number {
  switch (objective) {
    case "fewer_stops":
      return diff(a.stops, b.stops) || diff(a.minutes, b.minutes) || diff(a.detourKm, b.detourKm) || diff(b.minSoc, a.minSoc);
    case "efficient":
      return diff(a.detourKwh, b.detourKwh) || diff(a.stops, b.stops) || diff(a.minutes, b.minutes);
    case "safer":
      return diff(b.minSoc, a.minSoc) || diff(a.stops, b.stops) || diff(a.minutes, b.minutes);
    case "fastest":
    case "custom":
    default:
      return diff(a.minutes, b.minutes) || diff(a.stops, b.stops) || diff(a.detourKm, b.detourKm) || diff(b.minSoc, a.minSoc);
  }
}

/** Planifica las paradas. Si no hay plan viable, `feasible` es false y se informa hasta dónde se llega. */
export function planCharging(input: PlannerInput): PlannerResult {
  const { samples, nodes, walk, objective } = input;
  const destIdx = samples.length - 1;
  const floor = input.floorPct - input.tolerancePct;
  const reserve = input.destinationReservePct - input.tolerancePct;
  const grid = input.gridPct;
  const levels = Math.floor(input.maxChargePct / grid + EPS);
  const byIdx = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    const list = byIdx.get(n.sIdx) ?? [];
    list.push(i);
    byIdx.set(n.sIdx, list);
  });
  // labels[n][k]: mejor forma de salir de la estación n con SOC k × grid.
  const labels: (Label | undefined)[][] = nodes.map(() => new Array<Label | undefined>(levels + 1));
  const reachable = new Set<number>();
  let furthestIdx = 0;
  let destinationShort = false;
  let best: (Label & { arrival: number; lastNode: number; lastD: number }) | null = null;

  const buffer = input.fastChargeBuffer;
  const bufferCap = buffer ? Math.min(buffer.maxSocPct, input.maxChargePct) : 0;
  /** Puntos de más con que debe llegar a la siguiente estación el tramo que sale de `fromNode` con `startSoc`. */
  const marginFrom = (fromNode: number, startSoc: number): number => {
    if (!buffer || fromNode < 0 || !nodes[fromNode]!.fast) return 0;
    return startSoc < bufferCap - input.tolerancePct ? buffer.extraPct : 0;
  };

  const expand = (fromNode: number, fromD: number, fromIdx: number, startSoc: number, base: Label) => {
    const margin = marginFrom(fromNode, startSoc);
    walk(fromIdx, startSoc, (idx, soc, lowest) => {
      if (lowest < floor) return false;
      if (idx > furthestIdx) furthestIdx = idx;
      // Con el margen de carga rápida se sigue recorriendo (para `furthestIdx`), pero solo se acepta lo que lo cumple.
      const withMargin = lowest >= floor + margin;
      if (idx === destIdx) {
        // Al destino no se exige el margen de carga rápida: solo la reserva.
        if (soc >= reserve) {
          const final = { ...base, minSoc: Math.min(base.minSoc, lowest), arrival: soc, lastNode: fromNode, lastD: fromD };
          if (!best || compareLabels(final, best, objective) < 0) best = final;
        } else if (soc < reserve) {
          destinationShort = true;
        }
        return false;
      }
      if (!withMargin) return true;
      for (const j of byIdx.get(idx) ?? []) {
        const node = nodes[j]!;
        const arrive = soc - node.detourPct;
        const low = Math.min(lowest, arrive);
        if (low < floor + margin) continue;
        reachable.add(j);
        const firstK = Math.floor(arrive / grid + EPS) + 1;
        for (let k = Math.max(0, firstK); k <= levels; k++) {
          const depart = k * grid;
          const cand: Label = {
            stops: base.stops + 1,
            minutes: base.minutes + node.detourMin + node.waitMin + node.chargeMinutes(arrive, depart),
            detourKm: base.detourKm + node.detourKm,
            detourKwh: base.detourKwh + node.detourKwh,
            minSoc: Math.min(base.minSoc, low),
            arrive,
            prevNode: fromNode,
            prevD: fromD,
          };
          const cur = labels[j]![k];
          if (!cur || compareLabels(cand, cur, objective) < 0) labels[j]![k] = cand;
        }
      }
      return true;
    });
  };

  const origin: Label = { stops: 0, minutes: 0, detourKm: 0, detourKwh: 0, minSoc: input.initialSocPct, arrive: input.initialSocPct, prevNode: -1, prevD: -1 };
  expand(-1, -1, 0, input.initialSocPct, origin);
  for (let n = 0; n < nodes.length; n++) {
    for (let k = 0; k <= levels; k++) {
      const label = labels[n]![k];
      if (label) expand(n, k, nodes[n]!.sIdx, k * grid, label);
    }
  }

  const chosen = best as (Label & { arrival: number; lastNode: number; lastD: number }) | null;
  if (!chosen) {
    return {
      feasible: false,
      stops: [],
      arrivalSoc: Number.NaN,
      minSoc: Number.NaN,
      objective: { stops: 0, extraMinutes: 0, detourKm: 0, detourKwh: 0 },
      reachable: [...reachable].sort((a, b) => a - b),
      furthestIdx,
      destinationShort,
    };
  }
  const stops: PlannedStop[] = [];
  let n = chosen.lastNode;
  let k = chosen.lastD;
  while (n >= 0) {
    const label = labels[n]![k]!;
    stops.unshift({ node: n, arriveSoc: label.arrive, departSoc: k * grid });
    n = label.prevNode;
    k = label.prevD;
  }
  return {
    feasible: true,
    stops,
    arrivalSoc: chosen.arrival,
    minSoc: chosen.minSoc,
    objective: { stops: chosen.stops, extraMinutes: chosen.minutes, detourKm: chosen.detourKm, detourKwh: chosen.detourKwh },
    reachable: [...reachable].sort((a, b) => a - b),
    furthestIdx,
    destinationShort,
  };
}

/**
 * Carga previa (§5.8.6): menor número entero de puntos a agregar al SOC actual
 * con el que hay plan viable, por búsqueda binaria (la viabilidad crece con el
 * SOC inicial). La salida no pasa de 100 %. null si ni al 100 % hay plan.
 */
export function requiredInitialCharge(
  input: PlannerInput,
): { additionalPct: number; startSoc: number; result: PlannerResult } | null {
  const current = input.initialSocPct;
  const cache = new Map<number, PlannerResult>();
  const at = (add: number) => {
    let r = cache.get(add);
    if (!r) {
      r = planCharging({ ...input, initialSocPct: Math.min(100, current + add) });
      cache.set(add, r);
    }
    return r;
  };
  const maxAdd = Math.max(1, Math.ceil(100 - current - 1e-9));
  if (!at(maxAdd).feasible) return null;
  let lo = 0; // sin cargar: no viable (por eso se llama)
  let hi = maxAdd;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (at(mid).feasible) hi = mid;
    else lo = mid;
  }
  return { additionalPct: hi, startSoc: Math.min(100, current + hi), result: at(hi) };
}
