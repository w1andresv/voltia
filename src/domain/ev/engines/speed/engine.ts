import { bearingDeg } from "@/domain/geo";
import type { RawRoute } from "@/domain/types";
import type { RoadTier } from "@/domain/road-hierarchy";
import type {
  DrivingMode,
  LimitingFactor,
  SpeedProfile,
  SpeedProfilePoint,
} from "@/domain/ev/contracts/speed";
import { intervalIndex, pointAtKm, routeLine, type AxisPoint } from "@/domain/ev/core/axis";
import { kmhToMs, msToKmh } from "@/domain/ev/core/units";
import { MODEL_PARAMETERS, type ModelParameters } from "@/domain/ev/core/params";

/**
 * Perfil de velocidad (especificación §5.3): a qué velocidad y con qué
 * aceleración se espera recorrer cada punto. El modo de conducción cambia
 * velocidad y aceleraciones; el efecto en el consumo lo calcula la física
 * (engines/energy), nunca un multiplicador.
 *
 *  1. Velocidad típica por punto: la del proveedor en ese tramo (o la fija del usuario).
 *  2. Tope por curva: v = √(a_lat · R), con R del círculo por tres puntos.
 *  3. Objetivo por modo: típica × targetSpeedFactor, sin pasar el límite legal ni la curva.
 *  4. Pasadas hacia adelante (aceleración) y hacia atrás (frenado); 0 en origen y destino.
 * Determinístico. La duración se reporta junto a la del proveedor, sin reescalar.
 */

export interface SpeedInputPoint extends AxisPoint {
  /** Velocidad típica del tramo que llega a este punto (proveedor o fija del usuario), km/h. */
  typicalKmh: number;
  limitKmh?: number;
  /** Clase vial del tramo; da el tope cuando no hay límite legal. */
  roadTier?: RoadTier;
  /** Rumbo hacia el punto siguiente, grados. */
  headingDeg: number;
  /** Punto intermedio de la ruta: el vehículo se detiene (0 km/h). */
  stop?: boolean;
  /** La parada es una caseta de peaje (M2.1): se detiene y espera `tollStopSeconds`. */
  toll?: boolean;
}

type ModeParams = ModelParameters["speed"]["modes"]["value"]["normal"];

/**
 * Malla del perfil: un punto cada `spacingM` y, además, cada muestra de la ruta
 * (así los tramos de energía se agregan exactamente en las muestras).
 */
export function speedMesh(
  route: Pick<RawRoute, "geometry" | "samples" | "distanceKm" | "legBoundariesKm" | "tollBoothsKm">,
  spacingM: number,
  fixedKmh?: number | null,
): SpeedInputPoint[] {
  const line = routeLine(route);
  const samples = route.samples;
  if (line.length < 2 || samples.length < 2) return [];
  const step = spacingM / 1000;
  const EPS = 1e-6;
  // Puntos exactos (muestras, paradas, fin) primero: al fusionar puntos a menos
  // de EPS se conserva el km exacto, sin redondear (especificación §8.4).
  const exact: { km: number; stop: boolean; toll?: boolean }[] = samples.map((s) => ({ km: s.km, stop: false }));
  const stops: number[] = [0, route.distanceKm];
  for (const km of route.legBoundariesKm ?? []) {
    // Paradas estrictamente dentro de la ruta (origen y destino ya son 0 km/h).
    if (km > 1e-3 && km < route.distanceKm - 1e-3) {
      exact.push({ km, stop: true });
      stops.push(km);
    }
  }
  // Casetas de peaje: se detienen, salvo las pegadas a otra parada. Dos paradas a menos de
  // 150 m dejarían un tramo con 0 km/h en los dos extremos, que la física no puede recorrer.
  for (const km of route.tollBoothsKm ?? []) {
    if (stops.some((s) => Math.abs(s - km) < 0.15)) continue;
    exact.push({ km, stop: true, toll: true });
    stops.push(km);
  }
  exact.push({ km: route.distanceKm, stop: false });
  const grid: { km: number; stop: boolean; toll?: boolean }[] = [];
  for (let i = 0; i * step < route.distanceKm - 1e-9; i++) grid.push({ km: i * step, stop: false });
  const merged: { km: number; stop: boolean; toll?: boolean; exact: boolean }[] = [];
  for (const p of [
    ...exact.map((e) => ({ ...e, exact: true })),
    ...grid.map((g) => ({ ...g, exact: false })),
  ].sort((x, y) => x.km - y.km || Number(y.exact) - Number(x.exact))) {
    const last = merged[merged.length - 1];
    if (last && p.km - last.km <= EPS) {
      last.stop ||= p.stop;
      if (p.toll) last.toll = true;
      if (!last.exact && p.exact) {
        last.km = p.km;
        last.exact = true;
      }
      continue;
    }
    merged.push({ ...p });
  }

  let lineIndex = 1;
  let sampleIndex = 1;
  const pts = merged.map(({ km, stop, toll }) => {
    const hit = pointAtKm(line, km, lineIndex);
    lineIndex = hit.index;
    sampleIndex = intervalIndex(samples, km, sampleIndex);
    const s = km <= samples[0]!.km ? samples[1]! : samples[sampleIndex]!;
    return {
      ...hit.point,
      typicalKmh: fixedKmh && fixedKmh > 0 ? fixedKmh : s.speedKmh,
      limitKmh: s.speedLimitKmh,
      ...(s.roadTier ? { roadTier: s.roadTier } : {}),
      headingDeg: 0,
      ...(stop ? { stop: true } : {}),
      ...(toll ? { toll: true } : {}),
    };
  });
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.min(i, pts.length - 2)]!;
    const b = pts[Math.min(i + 1, pts.length - 1)]!;
    pts[i]!.headingDeg = bearingDeg(a, b);
  }
  return pts;
}

/** Radio (m) del círculo que pasa por a, b y c; Infinity si están alineados. */
export function circleRadiusM(a: AxisPoint, b: AxisPoint, c: AxisPoint): number {
  const kx = 111_320 * Math.cos((b.lat * Math.PI) / 180);
  const ky = 110_574;
  const ax = (a.lon - b.lon) * kx;
  const ay = (a.lat - b.lat) * ky;
  const cx = (c.lon - b.lon) * kx;
  const cy = (c.lat - b.lat) * ky;
  const ab = Math.hypot(ax, ay);
  const bc = Math.hypot(cx, cy);
  const ac = Math.hypot(cx - ax, cy - ay);
  const cross = Math.abs(ax * cy - ay * cx); // 2 × área del triángulo
  if (cross < 1e-9 || ab === 0 || bc === 0) return Infinity;
  return (ab * bc * ac) / (2 * cross);
}

/** Radio de curva en cada punto, con los vecinos a ±`spanM` sobre la ruta. */
export function curvatureRadii(points: AxisPoint[], spanM: number): number[] {
  const span = spanM / 1000;
  let lo = 0;
  let hi = 0;
  return points.map((p, i) => {
    const eps = 1e-9; // 19 × 0,1 no es exactamente 1,9
    while (lo < i && points[lo + 1]!.km <= p.km - span + eps) lo++;
    if (hi < i) hi = i;
    while (hi < points.length - 1 && points[hi]!.km < p.km + span - eps) hi++;
    if (lo === i || hi === i) return Infinity;
    return circleRadiusM(points[lo]!, p, points[hi]!);
  });
}

export function buildSpeedProfile(
  points: SpeedInputPoint[],
  mode: DrivingMode,
  params: ModelParameters["speed"] = MODEL_PARAMETERS.speed,
): SpeedProfile {
  const m: ModeParams = params.modes.value[mode] ?? params.modes.value.normal;
  const n = points.length;
  if (n < 2) return { points: [], drivingMode: mode, durationMinutes: 0 };
  const radii = curvatureRadii(points, params.curvatureSpanM);

  const target: number[] = [];
  const factor: LimitingFactor[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    let v = kmhToMs(p.typicalKmh * m.targetSpeedFactor);
    let why: LimitingFactor = "traffic";
    if (p.limitKmh != null && p.limitKmh > 0) {
      if (kmhToMs(p.limitKmh) < v) {
        v = kmhToMs(p.limitKmh);
        why = "speed_limit";
      }
    } else {
      const tierCap = p.roadTier ? params.defaultByRoadTier.value[p.roadTier] : undefined;
      if (tierCap != null && kmhToMs(tierCap) < v) {
        v = kmhToMs(tierCap);
        why = "road_class_default";
      }
    }
    const vCurve = Math.sqrt(m.maxLateralAccelMs2 * radii[i]!);
    if (vCurve < v) {
      v = vCurve;
      why = "curvature";
    }
    if (p.stop) {
      v = 0;
      why = p.toll ? "toll" : "stop";
    }
    target.push(v);
    factor.push(why);
  }

  const v = [...target];
  v[0] = 0;
  v[n - 1] = 0;
  factor[0] = "stop";
  factor[n - 1] = "stop";
  const ds = (i: number) => (points[i + 1]!.km - points[i]!.km) * 1000;
  for (let i = 1; i < n; i++) {
    const reach = Math.sqrt(v[i - 1]! ** 2 + 2 * m.maxAccelMs2 * ds(i - 1));
    if (reach < v[i]!) {
      v[i] = reach;
      factor[i] = "acceleration";
    }
  }
  for (let i = n - 2; i >= 0; i--) {
    const reach = Math.sqrt(v[i + 1]! ** 2 + 2 * m.maxDecelMs2 * ds(i));
    if (reach < v[i]!) {
      v[i] = reach;
      factor[i] = i === 0 ? "stop" : "deceleration";
    }
  }

  // Cada caseta suma el tiempo detenido (M2.1).
  let seconds = factor.filter((f) => f === "toll").length * params.tollStopSeconds.value;
  const out: SpeedProfilePoint[] = points.map((p, i) => {
    let a = 0;
    if (i < n - 1) {
      const d = ds(i);
      if (d > 0) {
        a = (v[i + 1]! ** 2 - v[i]! ** 2) / (2 * d);
        const sum = v[i]! + v[i + 1]!;
        if (sum > 0) seconds += (2 * d) / sum;
      }
    }
    return {
      km: p.km,
      speedKmh: msToKmh(v[i]!),
      targetKmh: msToKmh(target[i]!),
      accelerationMs2: a,
      limitingFactor: factor[i]!,
    };
  });
  return { points: out, drivingMode: mode, durationMinutes: seconds / 60 };
}
