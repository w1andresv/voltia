/**
 * Modelo de juguete de las guías "Cómo funciona" (/v1/como-funciona y
 * /v2/como-funciona). Imita las reglas de cada planificador sobre un perfil
 * aproximado de Piedecuesta → Vélez con un MG S5 EV. No es el motor real: el
 * consumo es un modelo simple sobre la altura y las estaciones son de ejemplo.
 */

export type GuideEngine = "v1" | "v2";
export type GuideStrategy = "fastest" | "fewer" | "safer";

/** Perfil aproximado: [km, pueblo, altura en m]. */
export const GUIDE_TOWNS: readonly (readonly [km: number, name: string, elevationM: number])[] = [
  [0, "Piedecuesta", 1000],
  [15, "Los Curos", 1500],
  [35, "Pescadero", 500],
  [52, "Aratoca", 1800],
  [76, "San Gil", 1100],
  [98, "Socorro", 1230],
  [128, "Oiba", 1420],
  [150, "Suaita", 1500],
  [168, "Santana", 1550],
  [193, "Barbosa", 1600],
  [213, "Vélez", 2100],
];

export const GUIDE_DIST_KM = 213;
const CAPACITY_KWH = 47.1;
export const VEHICLE_MIN_SOC = 15;
const DC_MAX_KW = 120;
const AC_MAX_KW = 7;

export type GuideStation = { name: string; km: number; kw: number; dc: boolean; detourKm: number };

const SAN_GIL: GuideStation = {
  name: "EDS San Gil (ejemplo)",
  km: 76,
  kw: 22,
  dc: false,
  detourKm: 1.5,
};
const SOCORRO: GuideStation = {
  name: "Carga Verde · Socorro",
  km: 98,
  kw: 60,
  dc: true,
  detourKm: 1.0,
};
const SANTANA: GuideStation = {
  name: "Terpel Voltex · Santana",
  km: 168,
  kw: 60,
  dc: true,
  detourKm: 0.3,
};

export function guideStations(includeSanGil: boolean): GuideStation[] {
  return includeSanGil ? [SAN_GIL, SOCORRO, SANTANA] : [SOCORRO, SANTANA];
}

/** Curva DC del MG S5: SOC → fracción de la potencia pico. */
const CURVE: readonly (readonly [soc: number, factor: number])[] = [
  [0, 0.55],
  [8, 0.9],
  [15, 1],
  [40, 1],
  [55, 0.86],
  [70, 0.64],
  [80, 0.42],
  [90, 0.22],
  [100, 0.08],
];

export type GuideParams = {
  /** Batería al salir, %. */
  soc: number;
  passengers: number;
  /** Consumo en plano, kWh/100 km. */
  consumption: number;
  /** Margen de seguridad, %. */
  margin: number;
  /** Batería pedida al llegar, %. */
  arrival: number;
  /** Tope de carga en ruta, %. */
  cap: number;
  strategy: GuideStrategy;
  sanGil: boolean;
  /** Puntos extra al cargar en DC (solo v2). */
  fastBuffer: number;
};

export const GUIDE_PRESETS = {
  local: {
    soc: 90,
    passengers: 1,
    consumption: 23,
    margin: 20,
    arrival: 20,
    cap: 80,
    strategy: "fastest",
    sanGil: false,
    fastBuffer: 10,
  },
  vercel: {
    soc: 80,
    passengers: 2,
    consumption: 23,
    margin: 20,
    arrival: 10,
    cap: 90,
    strategy: "fastest",
    sanGil: false,
    fastBuffer: 10,
  },
  low: {
    soc: 45,
    passengers: 1,
    consumption: 16,
    margin: 15,
    arrival: 15,
    cap: 80,
    strategy: "fastest",
    sanGil: false,
    fastBuffer: 10,
  },
} as const satisfies Record<string, GuideParams>;

export type GuidePresetId = keyof typeof GUIDE_PRESETS;

function interpolate(points: readonly (readonly [number, number])[], at: number): number {
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x0, y0] = points[i - 1]!;
    if (at <= x1) return y0 + ((y1 - y0) * (at - x0)) / (x1 - x0);
  }
  return points[points.length - 1]![1];
}

export function elevationAt(km: number): number {
  return interpolate(
    GUIDE_TOWNS.map(([k, , m]) => [k, m] as const),
    km,
  );
}

/** kWh de cada km de la ruta: consumo en plano + pendiente (regenera 60 % en bajada). */
export function energyPerKm(p: Pick<GuideParams, "passengers" | "consumption">): number[] {
  const massKg = 1627 + 75 + 75 * p.passengers + (p.passengers > 0 ? 15 : 0);
  const out: number[] = [];
  for (let k = 0; k < GUIDE_DIST_KM; k++) {
    const grade = (massKg * 9.81 * (elevationAt(k + 1) - elevationAt(k))) / 3.6e6;
    out.push(p.consumption / 100 + (grade > 0 ? grade / 0.9 : grade * 0.6));
  }
  return out;
}

export const pctOf = (kwh: number) => (kwh / CAPACITY_KWH) * 100;

/** Minutos para cargar de `from` a `to` % (curva del vehículo, +5 min por parada). */
export function chargeMinutes(st: GuideStation, from: number, to: number): number {
  if (to <= from) return 0;
  let t = 0;
  for (let s = from; s < to; s += 1) {
    const top = Math.min(to, s + 1);
    const kw = st.dc
      ? Math.min(st.kw, DC_MAX_KW * interpolate(CURVE, s + 0.5))
      : Math.min(st.kw, AC_MAX_KW);
    t += ((((top - s) / 100) * CAPACITY_KWH) / Math.max(kw, 1.5)) * 60;
  }
  return t + 5;
}

/** Recorre la batería de `fromKm` a `toKm`: SOC al final y mínimo en el camino. */
export function walk(
  e: number[],
  start: number,
  fromKm: number,
  toKm: number,
): { end: number; low: number } {
  let s = start;
  let low = start;
  for (let k = fromKm; k < toKm; k++) {
    s -= pctOf(e[k]!);
    if (s < low) low = s;
  }
  return { end: s, low };
}

export type GuideStop = { station: GuideStation; arrive: number; depart: number };

export type GuidePlan = {
  stops: GuideStop[];
  arrival: number;
  minutes: number;
  low: number;
  /** Puntos que hay que cargar antes de salir (0 si alcanza). */
  preCharge: number;
};

export type GuideResult = ({ viable: true } & GuidePlan) | { viable: false };

export const floorOf = (p: Pick<GuideParams, "margin">) => Math.max(VEHICLE_MIN_SOC, p.margin);

const detourPct = (p: GuideParams, km: number) => pctOf(km * 2 * (p.consumption / 100));
const detourMinutes = (st: GuideStation) => ((st.detourKm * 2) / 50) * 60;

/** SOC de salida mínimo para ir de `from` a `to` terminando con `end` sin bajar de `floor`. */
function need(e: number[], from: number, to: number, floor: number, end: number): number {
  const w = walk(e, 100, from, to);
  return Math.max(end + (100 - w.end), floor + (100 - w.low));
}

/** v1: estación por estación, la de mejor puntaje entre las alcanzables. */
function planV1(p: GuideParams, start: number): Omit<GuidePlan, "preCharge"> | null {
  const e = energyPerKm(p);
  const stations = guideStations(p.sanGil);
  const floor = floorOf(p);
  const reserve = Math.max(p.arrival, floor);
  const score = (st: GuideStation, arrive: number) => {
    let s =
      st.detourKm * (p.strategy === "fastest" ? 3.2 : 5.5) +
      Math.max(0, 250 - st.kw) * 0.08 +
      Math.max(0, arrive - 36) * 2.1 +
      Math.max(0, floor + 6 - arrive) * 4;
    s += st.kw < 40 ? 48 : st.kw < 50 ? 22 : st.kw < 100 ? 8 : 0;
    return s;
  };
  let pos = 0;
  let soc = start;
  let minutes = 0;
  let low = start;
  const stops: GuideStop[] = [];
  for (let n = 0; n < 7; n++) {
    const d = walk(e, soc, pos, GUIDE_DIST_KM);
    if (d.low >= floor && d.end >= reserve)
      return { stops, arrival: d.end, minutes, low: Math.min(low, d.low) };
    const cands = stations
      .filter((st) => st.km > pos)
      .map((st) => {
        const w = walk(e, soc, pos, st.km);
        const arrive = w.end - detourPct(p, st.detourKm);
        return { st, arrive, low: Math.min(w.low, arrive) };
      })
      .filter((c) => c.low >= floor);
    if (!cands.length) return null;
    cands.sort((a, b) =>
      p.strategy === "fewer" ? b.st.km - a.st.km : score(a.st, a.arrive) - score(b.st, b.arrive),
    );
    const c = cands[0]!;
    const st = c.st;
    let nextNeed = need(e, st.km, GUIDE_DIST_KM, floor, reserve);
    if (nextNeed > p.cap) {
      const ahead = stations
        .filter((o) => o.km > st.km)
        .map((o) => need(e, st.km, o.km, floor, floor) + detourPct(p, o.detourKm))
        .filter((v) => v <= p.cap);
      nextNeed = ahead.length ? Math.max(...ahead) : p.cap;
    }
    let to = Math.max(
      nextNeed + (p.strategy === "fastest" ? 2 : 4),
      p.strategy === "fastest" ? c.arrive + 12 : 0,
    );
    if (st.dc) to = Math.max(to, c.arrive + 8);
    to = Math.min(p.cap, Math.round(to));
    if (to <= c.arrive) to = Math.min(100, Math.ceil(c.arrive) + 1);
    minutes += chargeMinutes(st, c.arrive, to) + detourMinutes(st);
    low = Math.min(low, c.low);
    stops.push({ station: st, arrive: c.arrive, depart: to });
    pos = st.km;
    soc = to;
  }
  return null;
}

type Label = {
  stops: number;
  minutes: number;
  low: number;
  arrive: number;
  prev: number;
  prevSoc: number;
};

/** v2: programación dinámica sobre (estación, SOC de salida entero). */
function planV2(p: GuideParams, start: number): Omit<GuidePlan, "preCharge"> | null {
  const e = energyPerKm(p);
  const stations = guideStations(p.sanGil);
  const floor = floorOf(p);
  const reserve = Math.max(p.arrival, floor);
  const capBuffered = Math.min(90, p.cap);
  const labels = stations.map(() => new Map<number, Label>());
  type Final = {
    stops: number;
    minutes: number;
    low: number;
    arrival: number;
    last: number;
    lastSoc: number;
  };
  let best: Final | null = null;

  const key = (x: { stops: number; minutes: number; low: number }) =>
    p.strategy === "fewer"
      ? [x.stops, x.minutes]
      : p.strategy === "safer"
        ? [-x.low, x.stops, x.minutes]
        : [x.minutes, x.stops];
  const better = (
    a: { stops: number; minutes: number; low: number },
    b: { stops: number; minutes: number; low: number } | null | undefined,
  ) => {
    if (!b) return true;
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (Math.abs(ka[i]! - kb[i]!) > 1e-6) return ka[i]! < kb[i]!;
    }
    return false;
  };

  function expand(
    from: number,
    depart: number,
    lab: { stops: number; minutes: number; low: number },
  ) {
    const fromKm = from < 0 ? 0 : stations[from]!.km;
    const fast = from >= 0 && stations[from]!.dc && p.fastBuffer > 0 && depart < capBuffered;
    const margin = fast ? p.fastBuffer : 0;
    const dest = walk(e, depart, fromKm, GUIDE_DIST_KM);
    if (dest.low >= floor + margin && dest.end >= reserve + margin) {
      const f: Final = {
        ...lab,
        low: Math.min(lab.low, dest.low),
        arrival: dest.end,
        last: from,
        lastSoc: depart,
      };
      if (better(f, best)) best = f;
    }
    for (let j = from + 1; j < stations.length; j++) {
      const st = stations[j]!;
      const w = walk(e, depart, fromKm, st.km);
      const arrive = w.end - detourPct(p, st.detourKm);
      const low = Math.min(w.low, arrive);
      if (low < floor + margin) continue;
      for (let k = Math.floor(arrive) + 1; k <= p.cap; k++) {
        const c: Label = {
          stops: lab.stops + 1,
          minutes: lab.minutes + chargeMinutes(st, arrive, k) + detourMinutes(st),
          low: Math.min(lab.low, low),
          arrive,
          prev: from,
          prevSoc: depart,
        };
        if (better(c, labels[j]!.get(k))) labels[j]!.set(k, c);
      }
    }
  }

  expand(-1, start, { stops: 0, minutes: 0, low: start });
  for (let j = 0; j < stations.length; j++) {
    for (const [k, lab] of [...labels[j]!.entries()]) expand(j, k, lab);
  }
  const found = best as Final | null;
  if (!found) return null;
  const stops: GuideStop[] = [];
  let j = found.last;
  let k = found.lastSoc;
  while (j >= 0) {
    const lab = labels[j]!.get(k)!;
    stops.unshift({ station: stations[j]!, arrive: lab.arrive, depart: k });
    j = lab.prev;
    k = lab.prevSoc;
  }
  return { stops, arrival: found.arrival, minutes: found.minutes, low: found.low };
}

/** Plan del motor; si no alcanza, sube la carga de salida punto por punto hasta 100 %. */
export function solveGuide(engine: GuideEngine, p: GuideParams): GuideResult {
  const plan = engine === "v1" ? planV1 : planV2;
  for (let add = 0; p.soc + add <= 100; add++) {
    const r = plan(p, p.soc + add);
    if (r) return { viable: true, ...r, preCharge: add };
  }
  return { viable: false };
}

/** Puntos [km, SOC] de la curva de batería, con los saltos de cada parada. */
export function batteryCurve(e: number[], start: number, stops: GuideStop[]): [number, number][] {
  const pts: [number, number][] = [[0, start]];
  let s = start;
  let si = 0;
  for (let k = 0; k < GUIDE_DIST_KM; k++) {
    s -= pctOf(e[k]!);
    pts.push([k + 1, s]);
    const st = stops[si];
    if (st && st.station.km === k + 1) {
      pts.push([k + 1, st.arrive]);
      s = st.depart;
      pts.push([k + 1, s]);
      si++;
    }
  }
  return pts;
}

/** Km donde la batería llega a 0 saliendo con `start` sin parar, o null. */
export function depletionKm(e: number[], start: number): number | null {
  let s = start;
  for (let k = 0; k < GUIDE_DIST_KM; k++) {
    s -= pctOf(e[k]!);
    if (s <= 0) return k;
  }
  return null;
}
