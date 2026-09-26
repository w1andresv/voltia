import type { RouteSample } from "@/domain/types";
import type { EnergySample } from "@/domain/ev/contracts/energy";
import type { SpeedProfilePoint } from "@/domain/ev/contracts/speed";
import type { AxisPoint } from "@/domain/ev/core/axis";
import { intervalIndex } from "@/domain/ev/core/axis";
import { MODEL_PARAMETERS, type ModelParameters } from "@/domain/ev/core/params";
import { sourced } from "@/domain/ev/core/provenance";
import { G_STANDARD_MS2, J_PER_KWH, kmhToMs, msToKmh } from "@/domain/ev/core/units";
import { acPowerKw, airDensity, airSpeedSq, segmentTempC, type EnergyContext } from "./environment";
import type { VehicleEnergyParams } from "./vehicle-params";

/**
 * Motor de energía v2 (especificación §5.4): física por tramo, sin
 * multiplicadores de estilo, ciclo ni temperatura. El estilo llega por el
 * perfil de velocidad (velocidades y aceleraciones); la potencia del motor no
 * se usa. Los auxiliares se pagan siempre, también en bajada.
 *
 * Diferencias con el modelo anterior (ADR-0012): sin CYCLE_OVERHEAD (1,14), sin
 * STYLE_MULT, sin el factor por temperatura sobre la tracción, eficiencia fija
 * en vez de depender de motorKw, y regeneración con tope de potencia propio.
 * Se conserva el viento (ADR-0004).
 */

export interface EnergySegmentInput {
  /** Longitud horizontal, m. */
  horizontalM: number;
  /** Desnivel, m. */
  deltaHM: number;
  /** Velocidades al inicio y al final, m/s. */
  v1Ms: number;
  v2Ms: number;
  /** Altitud media del tramo, m. */
  altitudeM: number;
  headingDeg?: number;
}

export interface EnergySegment {
  distanceM: number;
  durationS: number;
  gradePercent: number;
  speedKmh: number;
  accelerationMs2: number;
  airDensityKgM3: number;
  rollingForceN: number;
  aerodynamicForceN: number;
  gradeForceN: number;
  accelerationForceN: number;
  wheelEnergyKwh: number;
  tractionEnergyKwh: number;
  auxiliaryEnergyKwh: number;
  energyConsumedKwh: number;
  energyRegeneratedKwh: number;
  frictionBrakeEnergyKwh: number;
  netEnergyKwh: number;
}

export type RegenModeParams = ModelParameters["energy"]["regenModes"]["value"]["medium"];

/** Factor de la tracción por temperatura, interpolado entre los puntos (constante fuera del rango). */
export function temperatureFactor(
  tempC: number,
  points: [number, number][] = MODEL_PARAMETERS.energy.temperatureFactor.value,
): number {
  if (!points.length) return 1;
  if (tempC <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [t1, f1] = points[i]!;
    if (tempC <= t1) {
      const [t0, f0] = points[i - 1]!;
      return f0 + ((f1 - f0) * (tempC - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1]![1];
}

/** Energía de un tramo con aceleración constante entre v1 y v2. */
export function segmentEnergyV2(
  seg: EnergySegmentInput,
  vp: VehicleEnergyParams,
  ctx: EnergyContext,
  regen: RegenModeParams,
  thermal: [number, number][] = MODEL_PARAMETERS.energy.temperatureFactor.value,
): EnergySegment {
  const dh = seg.horizontalM;
  const theta = dh > 0 ? Math.atan(seg.deltaHM / dh) : 0;
  const d = dh / Math.cos(theta);
  const v1 = Math.max(0, seg.v1Ms);
  const v2 = Math.max(0, seg.v2Ms);
  if (!(d > 0)) {
    return emptySegment(v1, v2);
  }
  if (v1 + v2 <= 0)
    throw new Error("Tramo con distancia y velocidad cero: el perfil de velocidad es inválido.");

  const m = vp.massKg.value;
  const mEff = m * vp.rotationalInertiaFactor.value;
  const g = G_STANDARD_MS2;
  const temp = segmentTempC(ctx, seg.altitudeM);
  const rho = airDensity(temp, seg.altitudeM);
  const vBarSq = (v1 * v1 + v2 * v2) / 2;
  const t = (2 * d) / (v1 + v2);
  const a = (v2 * v2 - v1 * v1) / (2 * d);

  const fAero =
    0.5 *
    rho *
    vp.dragAreaM2.value *
    airSpeedSq(msToKmh(Math.sqrt(vBarSq)), ctx.weather, seg.headingDeg);
  const fRoll = vp.rollingResistance.value * m * g * Math.cos(theta);
  const fGrade = m * g * Math.sin(theta);
  const fAcc = mEff * a;
  const wheelJ = (fAero + fRoll + fGrade + fAcc) * d;
  const wheelKwh = wheelJ / J_PER_KWH;

  const hours = t / 3600;
  let traction = 0;
  let regenKwh = 0;
  let friction = 0;
  if (wheelKwh >= 0) {
    traction = (wheelKwh / vp.drivetrainEfficiency.value) * temperatureFactor(temp, thermal);
  } else {
    const braking = -wheelKwh;
    const capturable = braking * regen.captureFraction * vp.regenEfficiency.value;
    const cap = vp.maxRegenPowerKw.value * regen.maxPowerFraction * hours;
    regenKwh = Math.min(capturable, cap);
    friction = Math.max(0, braking - regenKwh / vp.regenEfficiency.value);
  }
  const aux = (vp.baseAuxPowerKw.value + acPowerKw(ctx.conditions.ac, temp)) * hours;
  const consumed = traction + aux;
  return {
    distanceM: d,
    durationS: t,
    gradePercent: dh > 0 ? (seg.deltaHM / dh) * 100 : 0,
    speedKmh: msToKmh(d / t),
    accelerationMs2: a,
    airDensityKgM3: rho,
    rollingForceN: fRoll,
    aerodynamicForceN: fAero,
    gradeForceN: fGrade,
    accelerationForceN: fAcc,
    wheelEnergyKwh: wheelKwh,
    tractionEnergyKwh: traction,
    auxiliaryEnergyKwh: aux,
    energyConsumedKwh: consumed,
    energyRegeneratedKwh: regenKwh,
    frictionBrakeEnergyKwh: friction,
    netEnergyKwh: consumed - regenKwh,
  };
}

function emptySegment(v1: number, v2: number): EnergySegment {
  return {
    distanceM: 0,
    durationS: 0,
    gradePercent: 0,
    speedKmh: msToKmh((v1 + v2) / 2),
    accelerationMs2: 0,
    airDensityKgM3: 0,
    rollingForceN: 0,
    aerodynamicForceN: 0,
    gradeForceN: 0,
    accelerationForceN: 0,
    wheelEnergyKwh: 0,
    tractionEnergyKwh: 0,
    auxiliaryEnergyKwh: 0,
    energyConsumedKwh: 0,
    energyRegeneratedKwh: 0,
    frictionBrakeEnergyKwh: 0,
    netEnergyKwh: 0,
  };
}

/**
 * Consumo manual (el que el usuario midió): la física se ajusta a ese dato en
 * vez de multiplicar el resultado. Se escalan Cd·A y Crr por el mismo factor
 * para que en llano, a la velocidad de referencia y sin viento, el consumo
 * (tracción + auxiliares) sea el manual. Pendiente, aceleración y regeneración
 * siguen siendo física. El factor se acota a [0,5; 2].
 */
export function calibrateToManual(
  vp: VehicleEnergyParams,
  ctx: EnergyContext,
  manualKwhPer100: number,
  referenceKmh: number = MODEL_PARAMETERS.energy.manualReferenceSpeedKmh,
): VehicleEnergyParams {
  const v = kmhToMs(referenceKmh);
  const altitude = ctx.originAltitudeM ?? 0;
  const calm: EnergyContext = {
    ...ctx,
    weather: ctx.weather ? { ...ctx.weather, windKmh: 0 } : null,
  };
  const temp = segmentTempC(calm, altitude);
  const d = 100_000;
  const hours = d / v / 3600;
  const aux = (vp.baseAuxPowerKw.value + acPowerKw(ctx.conditions.ac, temp)) * hours;
  const resistJ =
    (vp.rollingResistance.value * vp.massKg.value * G_STANDARD_MS2 +
      0.5 * airDensity(temp, altitude) * vp.dragAreaM2.value * v * v) *
    d;
  const resistKwh = resistJ / J_PER_KWH / vp.drivetrainEfficiency.value;
  const k = Math.min(2, Math.max(0.5, (manualKwhPer100 - aux) / resistKwh));
  const note = `Ajustado al consumo manual (${manualKwhPer100} kWh/100 km a ${referenceKmh} km/h): × ${k}.`;
  return {
    ...vp,
    dragAreaM2: sourced(vp.dragAreaM2.value * k, "calculated", { notes: note }),
    rollingResistance: sourced(vp.rollingResistance.value * k, "calculated", { notes: note }),
  };
}

export interface EnergyProfileV2 {
  /** Una por muestra de la ruta, como el perfil del modelo anterior (lo consume el SOCEngine). */
  samples: EnergySample[];
  totals: {
    energyConsumedKwh: number;
    energyRegeneratedKwh: number;
    netEnergyKwh: number;
    auxiliaryEnergyKwh: number;
    frictionBrakeEnergyKwh: number;
  };
  durationMinutes: number;
  segments: number;
}

type RouteSampleIn = Omit<
  RouteSample,
  "energyKwh" | "energyGrossKwh" | "energyRegenKwh" | "cumulativeKwh" | "avgKwhPer100" | "soc"
>;

/**
 * Perfil de energía por muestra a partir de la malla y el perfil de velocidad
 * (mismo número de puntos, mismo km). La elevación de cada punto se interpola
 * de las muestras. Cada tramo de la malla cae dentro de un intervalo entre
 * muestras (la malla incluye el km de cada muestra) y se suma a esa muestra.
 */
export function energyProfileV2(
  samples: RouteSampleIn[],
  mesh: (AxisPoint & { headingDeg?: number })[],
  speed: SpeedProfilePoint[],
  vp: VehicleEnergyParams,
  ctx: EnergyContext,
  regen: RegenModeParams,
): EnergyProfileV2 {
  const n = samples.length;
  const acc = samples.map(() => ({ gross: 0, regen: 0, net: 0, seconds: 0, meters: 0 }));
  const totals = {
    energyConsumedKwh: 0,
    energyRegeneratedKwh: 0,
    netEnergyKwh: 0,
    auxiliaryEnergyKwh: 0,
    frictionBrakeEnergyKwh: 0,
  };
  let seconds = 0;
  let si = 1;
  let ei = 1;
  const elevAt = (km: number) => {
    ei = intervalIndex(samples, km, ei);
    const a = samples[ei - 1]!;
    const b = samples[ei]!;
    const span = b.km - a.km;
    const t = span > 0 ? Math.min(1, Math.max(0, (km - a.km) / span)) : 0;
    return a.elevM + (b.elevM - a.elevM) * t;
  };
  let hPrev = n ? elevAt(mesh[0]?.km ?? 0) : 0;
  for (let i = 0; i + 1 < mesh.length && n >= 2; i++) {
    const p = mesh[i]!;
    const q = mesh[i + 1]!;
    const hNext = elevAt(q.km);
    const seg = segmentEnergyV2(
      {
        horizontalM: (q.km - p.km) * 1000,
        deltaHM: hNext - hPrev,
        v1Ms: kmhToMs(speed[i]!.speedKmh),
        v2Ms: kmhToMs(speed[i + 1]!.speedKmh),
        altitudeM: (hPrev + hNext) / 2,
        headingDeg: p.headingDeg,
      },
      vp,
      ctx,
      regen,
    );
    hPrev = hNext;
    si = intervalIndex(samples, q.km, si);
    const slot = acc[si]!;
    slot.gross += seg.energyConsumedKwh;
    slot.regen += seg.energyRegeneratedKwh;
    slot.net += seg.netEnergyKwh;
    slot.seconds += seg.durationS;
    slot.meters += (q.km - p.km) * 1000;
    seconds += seg.durationS;
    totals.energyConsumedKwh += seg.energyConsumedKwh;
    totals.energyRegeneratedKwh += seg.energyRegeneratedKwh;
    totals.netEnergyKwh += seg.netEnergyKwh;
    totals.auxiliaryEnergyKwh += seg.auxiliaryEnergyKwh;
    totals.frictionBrakeEnergyKwh += seg.frictionBrakeEnergyKwh;
  }

  let cum = 0;
  const out: EnergySample[] = samples.map((s, i) => {
    const slot = acc[i]!;
    cum += i > 0 ? slot.net : 0;
    const speedKmh = slot.seconds > 0 ? msToKmh(slot.meters / slot.seconds) : s.speedKmh;
    return {
      ...s,
      speedKmh,
      energyKwh: i > 0 ? slot.net : 0,
      energyGrossKwh: i > 0 ? slot.gross : 0,
      energyRegenKwh: i > 0 ? slot.regen : 0,
      cumulativeKwh: cum,
      avgKwhPer100: s.km > 0.3 ? (cum / s.km) * 100 : 0,
    };
  });
  // La primera muestra toma la velocidad del primer tramo (como el modelo anterior).
  if (out.length > 1) out[0]!.speedKmh = out[1]!.speedKmh;
  return {
    samples: out,
    totals,
    durationMinutes: seconds / 60,
    segments: Math.max(0, mesh.length - 1),
  };
}

/**
 * Consumo neto local (kWh/km) alrededor de `km`, en una ventana de ±`windowKm`,
 * a partir del perfil por muestra (especificación §5.8.1). Prorratea por
 * distancia los tramos que cruzan el borde. Nunca negativo: un desvío en una
 * bajada no "regala" energía.
 */
export function localNetRateKwhPerKm(
  samples: Pick<EnergySample, "km" | "cumulativeKwh">[],
  km: number,
  windowKm = 2,
): number {
  if (samples.length < 2) return 0;
  const first = samples[0]!.km;
  const last = samples[samples.length - 1]!.km;
  const from = Math.max(first, km - windowKm);
  const to = Math.min(last, km + windowKm);
  if (!(to > from)) return 0;
  const cumAt = (x: number) => {
    let i = 1;
    while (i < samples.length - 1 && samples[i]!.km < x) i++;
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const span = b.km - a.km;
    const t = span > 0 ? Math.min(1, Math.max(0, (x - a.km) / span)) : 1;
    return a.cumulativeKwh + (b.cumulativeKwh - a.cumulativeKwh) * t;
  };
  return Math.max(0, (cumAt(to) - cumAt(from)) / (to - from));
}

/**
 * Energía de detenerse en una parada y volver a arrancar desde `speedKmh`:
 * arrancar cuesta ½·m_eff·v²/η y frenar recupera ½·m_eff·v²·captura·η_regen
 * (sin tope de potencia: la frenada es corta). Siempre ≥ 0.
 */
export function stopEnergyKwh(
  vp: VehicleEnergyParams,
  regen: RegenModeParams,
  speedKmh: number,
): number {
  const v = kmhToMs(Math.max(0, speedKmh));
  const kinetic = (0.5 * vp.massKg.value * vp.rotationalInertiaFactor.value * v * v) / J_PER_KWH;
  const restart = kinetic / vp.drivetrainEfficiency.value;
  const recovered = kinetic * regen.captureFraction * vp.regenEfficiency.value;
  return Math.max(0, restart - recovered);
}
