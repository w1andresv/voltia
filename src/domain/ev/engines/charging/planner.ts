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
  /**
   * Minutos acumulados de carga desde 0 hasta `soc`, sin los minutos fijos: creciente.
   * Los minutos de cargar de A a B son `chargeAt(B) − chargeAt(A) + connectionMin` (ver
   * `nodeChargeMinutes`). Que sea una resta de una función acumulada es lo que deja
   * resolver las llegadas a una estación sin recorrer todos los niveles de salida (ADR-0020).
   */
  chargeAt: (soc: number) => number;
  /** Minutos fijos por parada (estacionar, conectar, salir), una vez por carga. */
  connectionMin: number;
  /** Carga rápida (DC): al salir de aquí aplica `PlannerInput.fastChargeBuffer`. */
  fast?: boolean;
  /**
   * Sesión mínima (ADR-0018): SOC al que se llega en esta estación cargando el
   * tiempo mínimo desde `arriveSoc`. Si se para aquí, se sale con al menos ese
   * SOC (o con el tope en ruta, si queda más arriba). Sin él, basta un punto.
   * Recibe también `chargeAt(arriveSoc)`, que el planificador ya calculó.
   */
  minSessionSoc?: (arriveSoc: number, chargeAtArrive: number) => number;
}

/** Minutos para cargar de `fromSoc` a `toSoc` en la estación, con los minutos fijos (0 si no carga). */
export function nodeChargeMinutes(node: PlannerNode, fromSoc: number, toSoc: number): number {
  return toSoc > fromSoc ? node.chargeAt(toSoc) - node.chargeAt(fromSoc) + node.connectionMin : 0;
}

export interface PlannerInput {
  samples: EnergySample[];
  initialSocPct: number;
  /** Piso de SOC en todo punto, también al llegar a una estación: nunca se baja de aquí. */
  floorPct: number;
  /** SOC mínimo al destino: nunca se llega con menos. */
  destinationReservePct: number;
  /**
   * Margen flexible (ADR-0019): el SOC objetivo, por encima del piso y de la
   * reserva al destino. Bajar de `pct` se permite, pero al comparar planes cuesta
   * `penaltyMinPerPct` minutos por punto, medido en el punto más bajo de cada
   * tramo (la llegada al destino incluida). Así solo se baja si se ahorra una
   * parada o bastante tiempo. Sin él, el piso es el objetivo.
   */
  softFloor?: { pct: number; penaltyMinPerPct: number };
  /** Tope de carga en ruta. */
  maxChargePct: number;
  /**
   * Tope estirado (ADR-0018): si viene, se puede salir de una estación hasta este
   * SOC, por encima de `maxChargePct`. Quien llama acepta ese plan solo si tiene
   * menos paradas. La sesión mínima y el extra de carga rápida siguen midiéndose
   * contra `maxChargePct`.
   */
  stretchChargePct?: number;
  /** Estaciones compatibles, ordenadas por `sIdx`. */
  nodes: PlannerNode[];
  objective: PlanningMode;
  walk: SocWalker;
  gridPct: number;
  tolerancePct: number;
  /**
   * Al salir de una estación rápida hacia otra estación, ese tramo debe terminar
   * con `extraPct` puntos de más sobre el objetivo (`softFloor`, o el piso si no
   * hay): se carga eso más de lo necesario
   * para no llegar justo a la siguiente parada. No aplica al tramo final (no hay
   * otra parada que cuidar: solo se pide la reserva al destino), ni si ya se
   * sale con `maxSocPct` o más (ni con el tope de carga). Ningún plan viable
   * deja de serlo.
   */
  fastChargeBuffer?: { extraPct: number; maxSocPct: number };
  /**
   * Atajo opcional (mismo resultado que `walk`): SOC gastado acumulado por
   * muestra (%), con la regeneración aceptada entera, y el SOC hasta el cual la
   * batería la acepta entera. Un tramo cuyo SOC nunca pasa de ese valor es
   * lineal: se resuelve con sumas entre estaciones en vez de muestra por muestra.
   * Si el SOC puede pasarlo (regeneración recortada), se recorre con `walk`.
   */
  linear?: { spentPct: ArrayLike<number>; fullRegenBelowPct: number };
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
  objective: {
    stops: number;
    extraMinutes: number;
    /** Minutos equivalentes por bajar del margen flexible (no son tiempo real). */
    penaltyMinutes: number;
    detourKm: number;
    detourKwh: number;
  };
  /** Contadores deterministas del trabajo hecho (banco y prueba de presupuesto, ADR-0020). */
  stats: PlannerStats;
  /** Estaciones alcanzables desde el origen con alguna combinación de cargas. */
  reachable: number[];
  /** Km (índice de muestra) más lejano al que se llega sin bajar del piso. */
  furthestIdx: number;
  /** Se llega al tramo final pero no con la reserva al destino. */
  destinationShort: boolean;
}

export interface PlannerStats {
  /** Etiquetas (estación, SOC de salida) expandidas, más la del origen. */
  expansions: number;
  /** Llegadas a una estación guardadas (ganan su cubeta). */
  arrivals: number;
  /** Etiquetas de salida armadas al resolver las llegadas. */
  labelWrites: number;
}

interface Label {
  stops: number;
  minutes: number;
  /** Minutos equivalentes por bajar del margen flexible (no son tiempo real). */
  penalty: number;
  detourKm: number;
  detourKwh: number;
  minSoc: number;
  arrive: number;
  prevNode: number;
  prevD: number;
}

/** Llegada a una estación: lo que cuesta llegar, sin lo que cuesta cargar (ver `cand`). */
interface Arrival extends Pick<Label, "stops" | "minutes" | "penalty" | "detourKm" | "detourKwh" | "minSoc" | "arrive" | "prevNode" | "prevD"> {
  /** Minutos acumulados al llegar más desvío y espera (sin la carga). */
  fixed: number;
  /** Orden de llegada: desempata a igual costo. */
  seq: number;
}

const EPS = 1e-9;

function diff(a: number, b: number, eps = 1e-6): number {
  return Math.abs(a - b) > eps ? a - b : 0;
}

type Comparable = Pick<Label, "stops" | "minutes" | "detourKm" | "detourKwh" | "minSoc"> & {
  penalty?: number;
};

/**
 * < 0 si `a` es mejor que `b` para la estrategia. El tiempo que se compara
 * incluye los minutos equivalentes por bajar del margen flexible (ADR-0019).
 */
export function compareLabels(a: Comparable, b: Comparable, objective: PlanningMode): number {
  const ta = a.minutes + (a.penalty ?? 0);
  const tb = b.minutes + (b.penalty ?? 0);
  switch (objective) {
    case "fewer_stops":
      return diff(a.stops, b.stops) || diff(ta, tb) || diff(a.detourKm, b.detourKm) || diff(b.minSoc, a.minSoc);
    case "efficient":
      return diff(a.detourKwh, b.detourKwh) || diff(a.stops, b.stops) || diff(ta, tb);
    case "safer":
      return diff(b.minSoc, a.minSoc) || diff(a.stops, b.stops) || diff(ta, tb);
    case "fastest":
    case "custom":
    default:
      return diff(ta, tb) || diff(a.stops, b.stops) || diff(a.detourKm, b.detourKm) || diff(b.minSoc, a.minSoc);
  }
}

/** Planifica las paradas. Si no hay plan viable, `feasible` es false y se informa hasta dónde se llega. */
export function planCharging(input: PlannerInput): PlannerResult {
  const { samples, nodes, walk, objective } = input;
  const destIdx = samples.length - 1;
  const floor = input.floorPct - input.tolerancePct;
  const reserve = input.destinationReservePct - input.tolerancePct;
  const grid = input.gridPct;
  const softLevels = Math.floor(input.maxChargePct / grid + EPS);
  const levels = Math.max(softLevels, Math.floor((input.stretchChargePct ?? 0) / grid + EPS));
  // Estaciones por muestra (un arreglo, no un Map: se consulta en cada muestra recorrida).
  const nodesAt: (number[] | undefined)[] = new Array<number[] | undefined>(samples.length);
  nodes.forEach((n, i) => {
    (nodesAt[n.sIdx] ??= []).push(i);
  });
  // labels[n][k]: mejor forma de salir de la estación n con SOC k × grid.
  const labels: (Label | undefined)[][] = nodes.map(() => new Array<Label | undefined>(levels + 1));
  // arrivals[n][k]: la mejor llegada a la estación n cuyo primer nivel de salida posible es k.
  // Se guarda la llegada una sola vez y los niveles de salida se arman al procesar la
  // estación (`resolveLabels`), en vez de escribir los ~90 niveles por cada llegada (ADR-0020).
  const arrivals: (Arrival | undefined)[][] = nodes.map(() => new Array<Arrival | undefined>(levels + 1));
  const stats: PlannerStats = { expansions: 0, arrivals: 0, labelWrites: 0 };
  let seq = 0;
  const reachableFlag = new Uint8Array(nodes.length);
  let furthestIdx = 0;
  let destinationShort = false;
  let best: (Label & { arrival: number; lastNode: number; lastD: number }) | null = null;

  const soft = input.softFloor;
  /** Minutos equivalentes por el punto más bajo `low` de un tramo, si queda bajo el margen flexible. */
  const penaltyOf = (low: number): number =>
    soft && low < soft.pct - input.tolerancePct ? soft.penaltyMinPerPct * (soft.pct - low) : 0;
  /** El extra de carga rápida se mide sobre el objetivo, no sobre el piso. */
  const target = soft ? Math.max(floor, soft.pct - input.tolerancePct) : floor;
  /** Con qué SOC mínimo debe terminar un tramo que lleva `margin` puntos de extra de carga rápida. */
  const lowestFor = (margin: number): number => (margin > 0 ? target + margin : floor);

  const buffer = input.fastChargeBuffer;
  const bufferCap = buffer ? Math.min(buffer.maxSocPct, input.maxChargePct) : 0;
  /** Puntos de más con que debe llegar a la siguiente estación el tramo que sale de `fromNode` con `startSoc`. */
  const marginFrom = (fromNode: number, startSoc: number): number => {
    if (!buffer || fromNode < 0 || !nodes[fromNode]!.fast) return 0;
    return startSoc < bufferCap - input.tolerancePct ? buffer.extraPct : 0;
  };

  // Candidato a llegada. `minutes` es la clave de comparación `fixed − chargeAt(arrive)`: al
  // salir con `k` los minutos son esa clave + chargeAt(k) + conexión, y el segundo sumando es
  // igual para todas las llegadas, así que el orden entre ellas no depende de `k`.
  const cand: Pick<Label, "stops" | "minutes" | "penalty" | "detourKm" | "detourKwh" | "minSoc"> = { stops: 0, minutes: 0, penalty: 0, detourKm: 0, detourKwh: 0, minSoc: 0 };
  const reach = (j: number, soc: number, lowest: number, margin: number, fromNode: number, fromD: number, base: Label) => {
    const node = nodes[j]!;
    const arrive = soc - node.detourPct;
    const low = Math.min(lowest, arrive);
    if (low < lowestFor(margin)) return;
    reachableFlag[j] = 1;
    const atArrive = node.chargeAt(arrive);
    let firstK = Math.floor(arrive / grid + EPS) + 1;
    // Sesión mínima: si se para, se carga al menos ese tiempo, o hasta el tope en ruta.
    if (node.minSessionSoc) {
      firstK = Math.max(firstK, Math.min(softLevels, Math.ceil(node.minSessionSoc(arrive, atArrive) / grid - EPS)));
    }
    // Un solo candidato que cambia solo en los minutos: se copia únicamente si gana.
    cand.stops = base.stops + 1;
    cand.detourKm = base.detourKm + node.detourKm;
    cand.detourKwh = base.detourKwh + node.detourKwh;
    cand.minSoc = Math.min(base.minSoc, low);
    cand.penalty = base.penalty + penaltyOf(low);
    const fixedMin = base.minutes + node.detourMin + node.waitMin;
    const bucket = Math.max(0, firstK);
    if (bucket > levels) return;
    cand.minutes = fixedMin - atArrive;
    const row = arrivals[j]!;
    const cur = row[bucket];
    // Gana la de menor costo; a igual costo, la que llegó antes (la primera que se vio).
    if (!cur || compareLabels(cand, cur, objective) < 0) {
      row[bucket] = {
        stops: cand.stops,
        minutes: cand.minutes,
        penalty: cand.penalty,
        detourKm: cand.detourKm,
        detourKwh: cand.detourKwh,
        minSoc: cand.minSoc,
        fixed: fixedMin,
        arrive,
        prevNode: fromNode,
        prevD: fromD,
        seq: seq++,
      };
      stats.arrivals++;
    }
  };
  /**
   * Etiquetas de salida de la estación `n` a partir de sus llegadas. Con SOC de salida
   * `k × grid` valen las llegadas cuyo primer nivel es `k` o menos; entre ellas gana la
   * mejor (el orden no depende de `k`, ver `cand`), y el desempate es la llegada más antigua.
   */
  const resolveLabels = (n: number) => {
    const node = nodes[n]!;
    const bucket = arrivals[n]!;
    const row = labels[n]!;
    let run: Arrival | undefined;
    for (let k = 0; k <= levels; k++) {
      const a = bucket[k];
      if (a) {
        if (!run) run = a;
        else {
          const c = compareLabels(a, run, objective);
          if (c < 0 || (c === 0 && a.seq < run.seq)) run = a;
        }
      }
      if (!run) continue;
      row[k] = {
        stops: run.stops,
        minutes: run.fixed + nodeChargeMinutes(node, run.arrive, k * grid),
        penalty: run.penalty,
        detourKm: run.detourKm,
        detourKwh: run.detourKwh,
        minSoc: run.minSoc,
        arrive: run.arrive,
        prevNode: run.prevNode,
        prevD: run.prevD,
      };
      stats.labelWrites++;
    }
  };
  const atDestination = (soc: number, lowest: number, fromNode: number, fromD: number, base: Label) => {
    // Al destino no se exige el margen de carga rápida: solo la reserva.
    if (soc >= reserve) {
      const low = Math.min(lowest, soc);
      const final = { ...base, minSoc: Math.min(base.minSoc, low), penalty: base.penalty + penaltyOf(low), arrival: soc, lastNode: fromNode, lastD: fromD };
      if (!best || compareLabels(final, best, objective) < 0) best = final;
    } else {
      destinationShort = true;
    }
  };

  // Atajo lineal: posiciones con estaciones (más el origen y el destino) y, entre posiciones
  // seguidas, el máximo del gasto acumulado; el mínimo del gasto hacia adelante dice si el
  // SOC de un tramo puede pasar del umbral de regeneración completa.
  const lin = input.linear;
  const spent = lin?.spentPct;
  const positions = lin ? [...new Set([0, ...nodes.map((n) => n.sIdx), destIdx])].sort((a, b) => a - b) : [];
  const posOf = new Map(positions.map((p, i) => [p, i]));
  const segMax = positions.map((p, b) => {
    if (!spent || b === 0) return -Infinity;
    let m = -Infinity;
    for (let i = positions[b - 1]! + 1; i <= p; i++) m = Math.max(m, spent[i]!);
    return m;
  });
  const minAhead = new Float64Array(samples.length + 1).fill(Infinity);
  if (spent) for (let i = samples.length - 1; i >= 0; i--) minAhead[i] = Math.min(minAhead[i + 1]!, spent[i]!);

  const expandLinear = (fromNode: number, fromD: number, fromIdx: number, startSoc: number, base: Label, margin: number): boolean => {
    if (!lin || !spent) return false;
    const a = posOf.get(fromIdx);
    const base0 = spent[fromIdx]!;
    // El SOC más alto del tramo es el de salida, o más si se gana bajando: si no pasa del umbral, es lineal.
    const maxSoc = startSoc + Math.max(0, base0 - minAhead[fromIdx + 1]!);
    if (a == null || maxSoc > lin.fullRegenBelowPct) return false;
    let runMax = -Infinity;
    for (let b = a + 1; b < positions.length; b++) {
      const pos = positions[b]!;
      runMax = Math.max(runMax, segMax[b]!);
      const lowest = Math.min(startSoc, startSoc - (runMax - base0));
      if (lowest < floor) {
        // Hasta dónde se llegó sobre el piso dentro de este tramo (para `furthestIdx`).
        for (let i = positions[b - 1]! + 1; i < pos; i++) {
          if (startSoc - (spent[i]! - base0) < floor) break;
          if (i > furthestIdx) furthestIdx = i;
        }
        return true;
      }
      if (pos > furthestIdx) furthestIdx = pos;
      const soc = startSoc - (spent[pos]! - base0);
      if (pos === destIdx) {
        atDestination(soc, lowest, fromNode, fromD, base);
        return true;
      }
      if (lowest < lowestFor(margin)) continue;
      const here = nodesAt[pos];
      if (here) for (const j of here) reach(j, soc, lowest, margin, fromNode, fromD, base);
    }
    return true;
  };

  const expand = (fromNode: number, fromD: number, fromIdx: number, startSoc: number, base: Label) => {
    stats.expansions++;
    const margin = marginFrom(fromNode, startSoc);
    if (expandLinear(fromNode, fromD, fromIdx, startSoc, base, margin)) return;
    walk(fromIdx, startSoc, (idx, soc, lowest) => {
      if (lowest < floor) return false;
      if (idx > furthestIdx) furthestIdx = idx;
      // Con el margen de carga rápida se sigue recorriendo (para `furthestIdx`), pero solo se acepta lo que lo cumple.
      const withMargin = lowest >= lowestFor(margin);
      if (idx === destIdx) {
        atDestination(soc, lowest, fromNode, fromD, base);
        return false;
      }
      if (!withMargin) return true;
      const here = nodesAt[idx];
      if (here) for (const j of here) reach(j, soc, lowest, margin, fromNode, fromD, base);
      return true;
    });
  };

  const origin: Label = { stops: 0, minutes: 0, penalty: 0, detourKm: 0, detourKwh: 0, minSoc: input.initialSocPct, arrive: input.initialSocPct, prevNode: -1, prevD: -1 };
  expand(-1, -1, 0, input.initialSocPct, origin);
  for (let n = 0; n < nodes.length; n++) {
    resolveLabels(n);
    for (let k = 0; k <= levels; k++) {
      const label = labels[n]![k];
      if (label) expand(n, k, nodes[n]!.sIdx, k * grid, label);
    }
  }

  const reachableList = (): number[] => {
    const out: number[] = [];
    for (let j = 0; j < reachableFlag.length; j++) if (reachableFlag[j]) out.push(j);
    return out;
  };
  const chosen = best as (Label & { arrival: number; lastNode: number; lastD: number }) | null;
  if (!chosen) {
    return {
      feasible: false,
      stops: [],
      arrivalSoc: Number.NaN,
      minSoc: Number.NaN,
      objective: { stops: 0, extraMinutes: 0, penaltyMinutes: 0, detourKm: 0, detourKwh: 0 },
      stats,
      reachable: reachableList(),
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
    objective: {
      stops: chosen.stops,
      extraMinutes: chosen.minutes,
      penaltyMinutes: chosen.penalty,
      detourKm: chosen.detourKm,
      detourKwh: chosen.detourKwh,
    },
    stats,
    reachable: reachableList(),
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
  /** Quién resuelve cada SOC inicial; por defecto `planCharging`. Permite compartir una memoria. */
  solve: (i: PlannerInput) => PlannerResult = planCharging,
): { additionalPct: number; startSoc: number; result: PlannerResult } | null {
  const current = input.initialSocPct;
  const cache = new Map<number, PlannerResult>();
  const at = (add: number) => {
    let r = cache.get(add);
    if (!r) {
      r = solve({ ...input, initialSocPct: Math.min(100, current + add) });
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
