import { downsample, lerp } from "@/domain/geo";
import { pointAtKm, routeLine, type AxisPoint } from "@/domain/ev/core/axis";
import type { LatLon, RawRoute } from "@/domain/types";
import { MODEL_PARAMETERS, type ModelParameters } from "@/domain/ev/core/params";

/**
 * Elevación de la ruta. El proveedor solo devuelve alturas para los puntos que
 * se le piden; qué puntos pedir y cómo aplicarlas (interpolación, suavizado,
 * pendientes y desnivel) es del dominio.
 *
 * Tres formas de muestrear (ELEVATION_SOURCE, ADR-0011):
 *  - fija: `probesPerRoute` muestras repartidas en la ruta (la de siempre);
 *  - malla: un punto cada `mesh.spacingM` sobre la geometría;
 *  - adaptativa: malla gruesa y más puntos solo donde la altura cambia.
 * Las dos últimas producen un perfil denso que se aplica con
 * `applyDenseElevationProfile`, que además limpia túneles y pendientes imposibles.
 */

type Sample = RawRoute["samples"][number];

/** Muestras de la ruta en las que se consulta la elevación. null si la ruta no tiene tramos. */
export function elevationProbes(
  route: RawRoute,
  params: ModelParameters["elevation"] = MODEL_PARAMETERS.elevation,
): Sample[] | null {
  if (route.samples.length < 2) return null;
  return downsample(route.samples, params.probesPerRoute);
}

function interpolateElev(km: number, probeKm: number[], elev: number[]): number {
  if (!probeKm.length) return 0;
  if (km <= probeKm[0]!) return elev[0] ?? 0;
  for (let i = 1; i < probeKm.length; i++) {
    if (km <= probeKm[i]!) {
      const span = probeKm[i]! - probeKm[i - 1]! || 1;
      const t = (km - probeKm[i - 1]!) / span;
      return lerp(elev[i - 1] ?? 0, elev[i] ?? 0, t);
    }
  }
  return elev[elev.length - 1] ?? 0;
}

function smoothSeries(values: number[], window: number): number[] {
  if (values.length < 3) return values;
  const half = Math.max(1, Math.floor(window / 2));
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i - half; j <= i + half; j++) {
      const v = values[j];
      if (v == null) continue;
      sum += v;
      n += 1;
    }
    return n ? sum / n : values[i]!;
  });
}

/** La ruta con la elevación de cada muestra, la pendiente de cada tramo y el desnivel total. */
export function applyElevationProfile(
  route: RawRoute,
  probes: Sample[],
  elev: number[],
  params: ModelParameters["elevation"] = MODEL_PARAMETERS.elevation,
): RawRoute {
  const samples = route.samples;
  const probeKm = probes.map((p) => p.km);
  const rawElev = samples.map((s) => interpolateElev(s.km, probeKm, elev));
  const smoothed = smoothSeries(rawElev, params.smoothingWindow);
  const withElev = samples.map((s, i) => ({
    ...s,
    elevM: smoothed[i] ?? s.elevM,
  }));
  for (let i = 1; i < withElev.length; i++) {
    const dKm = Math.max(0.05, withElev[i]!.km - withElev[i - 1]!.km);
    const dM = withElev[i]!.elevM - withElev[i - 1]!.elevM;
    withElev[i]!.slopePct = (dM / (dKm * 1000)) * 100;
  }
  let gain = 0;
  let loss = 0;
  let minM = withElev[0]!.elevM;
  let maxM = withElev[0]!.elevM;
  for (let i = 1; i < withElev.length; i++) {
    const d = withElev[i]!.elevM - withElev[i - 1]!.elevM;
    if (d > params.gainThresholdM) gain += d;
    else if (d < -params.gainThresholdM) loss += -d;
    minM = Math.min(minM, withElev[i]!.elevM);
    maxM = Math.max(maxM, withElev[i]!.elevM);
  }
  return {
    ...route,
    samples: withElev,
    elevation: { gainM: gain, lossM: loss, minM, maxM },
  };
}

/** Punto de la malla de elevación: posición y km sobre la ruta (mismo eje que las muestras). */
export interface ElevationProbe extends LatLon {
  km: number;
}

/** Puntos cada `spacingM` entre `fromKm` y `toKm` (incluye los extremos). */
function meshBetween(
  line: AxisPoint[],
  fromKm: number,
  toKm: number,
  spacingM: number,
): ElevationProbe[] {
  const step = spacingM / 1000;
  const n = Math.max(1, Math.ceil((toKm - fromKm) / step - 1e-9));
  const out: ElevationProbe[] = [];
  let index = 1;
  for (let i = 0; i <= n; i++) {
    const km = i === n ? toKm : fromKm + i * step;
    const hit = pointAtKm(line, km, index);
    index = hit.index;
    out.push(hit.point);
  }
  return out;
}

/** Malla por distancia sobre toda la ruta. Vacía si la ruta no tiene tramos. */
export function elevationMesh(route: RawRoute, spacingM: number): ElevationProbe[] {
  const line = routeLine(route);
  if (line.length < 2 || !(spacingM > 0)) return [];
  return meshBetween(line, 0, line[line.length - 1]!.km, spacingM);
}

/**
 * Puntos extra para la malla adaptativa: entre dos puntos gruesos cuya altura
 * difiere más de `refineDeltaM`, uno cada `fineSpacingM`. Se priorizan los
 * tramos con más cambio y se respeta el tope `maxProbes` (contando los gruesos).
 */
export function adaptiveRefinement(
  route: RawRoute,
  coarse: ElevationProbe[],
  heights: number[],
  params: ModelParameters["elevation"]["adaptive"] = MODEL_PARAMETERS.elevation.adaptive,
): ElevationProbe[] {
  const line = routeLine(route);
  if (line.length < 2 || coarse.length < 2) return [];
  const intervals = coarse
    .slice(1)
    .map((b, i) => ({
      a: coarse[i]!,
      b,
      delta: Math.abs((heights[i + 1] ?? 0) - (heights[i] ?? 0)),
    }))
    .filter((x) => x.delta > params.refineDeltaM)
    .sort((x, y) => y.delta - x.delta);
  let budget = params.maxProbes - coarse.length;
  const extra: ElevationProbe[] = [];
  for (const { a, b } of intervals) {
    const inner = meshBetween(line, a.km, b.km, params.fineSpacingM).slice(1, -1);
    if (inner.length > budget) break;
    budget -= inner.length;
    extra.push(...inner);
  }
  return extra.sort((x, y) => x.km - y.km);
}

/**
 * Limpieza del perfil denso (F2b):
 *  - en un túnel, la altura de los puntos interiores es la recta entre la
 *    entrada y la salida (el modelo de terreno da la montaña, no la vía);
 *  - entre puntos consecutivos, la pendiente no pasa de `maxGradePct` (un pico
 *    o un hueco del terreno, como un puente sobre un valle, se recorta).
 * Devuelve las alturas limpias y cuántos puntos cambió. Puntos ordenados por km.
 */
export function cleanElevationProfile(
  km: number[],
  heights: number[],
  structures: RawRoute["structures"] = [],
  maxGradePct: number = MODEL_PARAMETERS.elevation.maxGradePct,
): { heights: number[]; corrected: number } {
  const h = [...heights];
  const changed = new Set<number>();
  for (const st of structures ?? []) {
    let a = -1;
    let b = -1;
    for (let i = 0; i < km.length; i++) {
      if (km[i]! <= st.fromKm) a = i;
      if (b < 0 && km[i]! >= st.toKm) b = i;
    }
    if (a < 0 || b < 0 || b - a < 2) continue;
    for (let i = a + 1; i < b; i++) {
      const t = (km[i]! - km[a]!) / (km[b]! - km[a]!);
      const v = lerp(h[a]!, h[b]!, t);
      if (Math.abs(v - h[i]!) > 1e-9) changed.add(i);
      h[i] = v;
    }
  }
  if (maxGradePct > 0) {
    for (let i = 1; i < h.length; i++) {
      const allowed = (maxGradePct / 100) * Math.max(0, km[i]! - km[i - 1]!) * 1000;
      const d = h[i]! - h[i - 1]!;
      if (Math.abs(d) > allowed + 1e-9) {
        h[i] = h[i - 1]! + Math.sign(d) * allowed;
        changed.add(i);
      }
    }
  }
  return { heights: h, corrected: changed.size };
}

/** Media móvil por distancia (ventana de `windowKm` centrada), para puntos a distinto espaciado. */
function smoothByDistance(km: number[], values: number[], windowKm: number): number[] {
  if (values.length < 3 || !(windowKm > 0)) return values;
  const half = windowKm / 2;
  let lo = 0;
  let hi = 0;
  let sum = 0;
  return values.map((_, i) => {
    while (hi < values.length && km[hi]! <= km[i]! + half) sum += values[hi++]!;
    while (km[lo]! < km[i]! - half) sum -= values[lo++]!;
    return sum / (hi - lo);
  });
}

/** Subida y bajada acumuladas con histéresis: un cambio cuenta cuando se aleja `thresholdM` del último extremo. */
export function hysteresisGainLoss(
  values: number[],
  thresholdM: number,
): { gainM: number; lossM: number } {
  let gain = 0;
  let loss = 0;
  if (!values.length) return { gainM: 0, lossM: 0 };
  let ref = values[0]!;
  for (const v of values) {
    if (v - ref >= thresholdM) {
      gain += v - ref;
      ref = v;
    } else if (ref - v >= thresholdM) {
      loss += ref - v;
      ref = v;
    }
  }
  return { gainM: gain, lossM: loss };
}

/**
 * Aplica un perfil denso (malla o adaptativa): se suaviza por distancia, cada
 * muestra toma la altura interpolada en su km y el desnivel sale del perfil
 * denso con histéresis (no de las muestras, que están a ~1 km y lo recortan).
 */
export function applyDenseElevationProfile(
  route: RawRoute,
  probes: ElevationProbe[],
  heights: number[],
  params: ModelParameters["elevation"] = MODEL_PARAMETERS.elevation,
): RawRoute {
  if (route.samples.length < 2 || !probes.length) return route;
  const order = probes
    .map((p, i) => ({ km: p.km, h: heights[i] ?? 0 }))
    .sort((a, b) => a.km - b.km);
  const km = order.map((o) => o.km);
  const cleaned = cleanElevationProfile(
    km,
    order.map((o) => o.h),
    route.structures,
    params.maxGradePct,
  );
  const smoothed = smoothByDistance(km, cleaned.heights, params.dense.smoothingM / 1000);
  const withElev = route.samples.map((s) => ({ ...s, elevM: interpolateElev(s.km, km, smoothed) }));
  for (let i = 1; i < withElev.length; i++) {
    const dKm = Math.max(0.05, withElev[i]!.km - withElev[i - 1]!.km);
    withElev[i]!.slopePct = ((withElev[i]!.elevM - withElev[i - 1]!.elevM) / (dKm * 1000)) * 100;
  }
  const { gainM, lossM } = hysteresisGainLoss(smoothed, params.dense.hysteresisM);
  return {
    ...route,
    samples: withElev,
    elevation: {
      gainM,
      lossM,
      minM: Math.min(...smoothed),
      maxM: Math.max(...smoothed),
      ...(cleaned.corrected ? { correctedPoints: cleaned.corrected } : {}),
    },
  };
}
