import type { BodyType, RegenLevel, RouteSample, TripConditions, Vehicle, WeatherSnapshot } from "./types";
import type { EnergySample } from "./ev/contracts/energy";
import { tripMassKg } from "./types";
import { MODEL_PARAMETERS } from "./ev/core/params";
import { reserveSocPct } from "./ev/core/trip-config";
import { G_MS2, J_PER_KWH as J_PER_KWH_UNIT } from "./ev/core/units";
import { bearingDeg } from "./geo";
import {
  acPowerKw,
  airDensity,
  airSpeedSq,
  segmentTempC,
  type EnergyContext,
  type SegmentGeo,
} from "./ev/engines/energy/environment";

export { acPowerKw, airDensity, airSpeedSq, segmentTempC, type EnergyContext, type SegmentGeo };

const G = G_MS2;
const J_PER_KWH = J_PER_KWH_UNIT;
const REF_SPEED = 70;
const AUX_KW = 0.45;
const CYCLE_OVERHEAD = 1.14;
/** Parte del consumo manual que se atribuye al aire a 70 km/h (el resto no depende de la velocidad). */
const MANUAL_AERO_SHARE = 0.42;
const MIN_SPEED_KMH = 10;
const MAX_SPEED_KMH = 140;
/** Tope de potencia de regeneración, como fracción de la potencia del motor. */
const REGEN_POWER_SHARE = 0.4;

/**
 * Estilo de conducción, en dos efectos separados (para no contarlo dos veces):
 *  - STYLE_SPEED_FACTOR: velocidad de crucero relativa a la de la ruta. Cambia el
 *    TIEMPO y, por la resistencia del aire, también el consumo (vía la física).
 *  - STYLE_MULT: forma de acelerar y frenar, a igual velocidad. Solo afecta la
 *    rodadura y el aire: la energía de subir una pendiente no depende del estilo.
 */
export const STYLE_SPEED_FACTOR: Record<TripConditions["drivingStyle"], number> = {
  efficient: 0.93,
  normal: 1,
  sport: 1.06,
};

export const STYLE_MULT: Record<TripConditions["drivingStyle"], number> = {
  efficient: 0.95,
  normal: 1,
  sport: 1.08,
};

/**
 * Fracción del excedente de energía en la rueda (lo que la bajada da de más
 * después de pagar rodadura y aire) que termina en la batería. Ya incluye
 * motor, inversor, batería y lo que se pierde en el freno de fricción.
 *  - low: regeneración suave o mucho uso del freno.
 *  - medium: uso normal (valor por defecto).
 *  - high: conducción de un pedal, anticipando las bajadas.
 */
export const REGEN_RECOVERY: Record<RegenLevel, number> = {
  low: 0.35,
  medium: 0.55,
  high: 0.7,
};

/** Factor por temperatura (batería, llantas y tren fríos o calientes). Se interpola entre estos puntos. */
const CLIMATE_POINTS: readonly (readonly [number, number])[] = [
  [0, 1.28],
  [5, 1.16],
  [10, 1.07],
  [15, 1],
  [26, 1],
  [32, 1.05],
  [38, 1.1],
];

export type EnergyMode = "manual" | "estimated";



export interface EnergySlice {
  grossKwh: number;
  regenKwh: number;
  netKwh: number;
}

export function hasManualConsumption(vehicle: Vehicle): boolean {
  return Boolean(
    vehicle.consumptionManual &&
    vehicle.consumptionKwhPer100km &&
    vehicle.consumptionKwhPer100km > 0,
  );
}

export function energyMode(vehicle: Vehicle): EnergyMode {
  return hasManualConsumption(vehicle) ? "manual" : "estimated";
}

/** Homologated WLTP pack-to-distance ratio. Reference only, not a trip guarantee. */
export function wltpKwhPer100(vehicle: Vehicle): number | null {
  if (!(vehicle.rangeKm > 0) || !(vehicle.batteryKwh > 0)) return null;
  return (vehicle.batteryKwh / vehicle.rangeKm) * 100;
}

/**
 * Valores estándar por carrocería (MVP, fuente "estimated"). Salen de rangos típicos
 * de eléctricos actuales: sedán Cd 0,23–0,28, SUV compacta 0,27–0,33, SUV grande o
 * pickup 0,32–0,38, con su área frontal. Cada vehículo puede traer los suyos
 * (`dragAreaM2`, `rollingResistance`) en el payload del catálogo.
 */
export const BODY_TYPE_PHYSICS: Record<BodyType, { dragAreaM2: number; rollingResistance: number }> =
  MODEL_PARAMETERS.vehicle.bodyTypePhysics.value;

/** Sin carrocería declarada se asume SUV compacta: la más común entre los eléctricos en Colombia. */
export const DEFAULT_BODY_TYPE: BodyType = MODEL_PARAMETERS.vehicle.defaultBodyType;

function bodyPhysics(vehicle: Vehicle) {
  return BODY_TYPE_PHYSICS[vehicle.bodyType ?? DEFAULT_BODY_TYPE] ?? BODY_TYPE_PHYSICS[DEFAULT_BODY_TYPE];
}

export function dragAreaM2(vehicle: Vehicle): number {
  return vehicle.dragAreaM2 ?? bodyPhysics(vehicle).dragAreaM2;
}

export function rollingCrr(vehicle: Vehicle): number {
  return vehicle.rollingResistance ?? bodyPhysics(vehicle).rollingResistance;
}

/** true si el consumo usa Cd·A o Crr de la tabla por carrocería (valores estimados). */
export function usesDefaultPhysics(vehicle: Vehicle): boolean {
  return vehicle.dragAreaM2 == null || vehicle.rollingResistance == null;
}

export function drivetrainEff(vehicle: Vehicle): number {
  return clamp(0.86 + vehicle.motorKw / 2800, 0.85, 0.925);
}

/** Fracción del excedente de bajada que vuelve a la batería según el nivel elegido. */
export function regenRecovery(conditions: TripConditions): number {
  return REGEN_RECOVERY[conditions.regenLevel] ?? REGEN_RECOVERY.medium;
}

export function climateMultiplier(tempC: number): number {
  const pts = CLIMATE_POINTS;
  if (tempC <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [t1, m1] = pts[i]!;
    if (tempC <= t1) {
      const [t0, m0] = pts[i - 1]!;
      return m0 + ((m1 - m0) * (tempC - t0)) / (t1 - t0);
    }
  }
  return pts[pts.length - 1]![1];
}





function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function clampSpeed(speedKmh: number): number {
  return clamp(speedKmh || REF_SPEED, MIN_SPEED_KMH, MAX_SPEED_KMH);
}

/**
 * Factor de velocidad del modo manual, relativo a 70 km/h. El consumo manual se
 * reparte en una parte fija (58 %) y una de aire (42 % a 70 km/h) que escala con
 * la velocidad relativa al aire y con la densidad del aire frente a la del origen.
 */
export function manualSpeedFactor(
  speedKmh: number,
  ctx: EnergyContext,
  geo: SegmentGeo = {},
): number {
  const speed = clamp(speedKmh || REF_SPEED, 30, MAX_SPEED_KMH);
  const alt = geo.altitudeM;
  const refAlt = ctx.originAltitudeM;
  const rhoRatio =
    alt != null && refAlt != null
      ? airDensity(segmentTempC(ctx, alt), alt) / airDensity(segmentTempC(ctx, refAlt), refAlt)
      : 1;
  const refSq = (REF_SPEED / 3.6) ** 2;
  const aeroRatio = (airSpeedSq(speed, ctx.weather, geo.headingDeg) / refSq) * rhoRatio;
  return Math.max(0.88, 1 - MANUAL_AERO_SHARE + MANUAL_AERO_SHARE * aeroRatio);
}

function physicsSlice(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  geo: SegmentGeo = {},
  opts?: { includeCycle?: boolean },
): EnergySlice {
  const { vehicle, conditions, weather } = ctx;
  const mass = tripMassKg(vehicle, conditions);
  const speed = clampSpeed(speedKmh);
  const altitude = geo.altitudeM ?? ctx.originAltitudeM ?? 0;
  const temp = segmentTempC(ctx, geo.altitudeM);
  const hours = distanceKm / speed;
  const aux = (acPowerKw(conditions.ac, temp) + AUX_KW) * hours;
  const eff = drivetrainEff(vehicle);
  const cycle = opts?.includeCycle === false ? 1 : CYCLE_OVERHEAD;
  const dM = distanceKm * 1000;

  const fRoll = rollingCrr(vehicle) * mass * G;
  const fAero =
    0.5 *
    airDensity(temp, altitude) *
    dragAreaM2(vehicle) *
    airSpeedSq(speed, weather, geo.headingDeg);
  // Rodadura y aire, con el ciclo (aceleraciones, curvas, tráfico) y el estilo.
  const resistKwh =
    (((fRoll + fAero) * dM) / J_PER_KWH) * cycle * STYLE_MULT[conditions.drivingStyle];
  // Gravedad con signo: en bajada paga primero la rodadura y el aire.
  const gravityKwh = (mass * G * elevDeltaM) / J_PER_KWH;
  const wheelKwh = resistKwh + gravityKwh;

  let traction = 0;
  let regen = 0;
  if (wheelKwh >= 0) {
    traction = (wheelKwh / eff) * climateMultiplier(temp);
  } else {
    // Solo el excedente se puede regenerar, y no más rápido que el tope del motor.
    // Es la regeneración POTENCIAL: cuánto acepta la batería según su SOC lo
    // decide el SOCEngine (engines/soc), no este cálculo (F3).
    const speedRegen = speed < 15 ? speed / 15 : 1;
    const capKwh = Math.max(0, vehicle.motorKw * REGEN_POWER_SHARE * hours);
    regen = Math.min(-wheelKwh * regenRecovery(conditions) * speedRegen, capKwh);
  }
  const gross = traction + aux;
  return { grossKwh: gross, regenKwh: regen, netKwh: gross - regen };
}

function manualSlice(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  geo: SegmentGeo = {},
): EnergySlice {
  const { vehicle, conditions } = ctx;
  const mass = tripMassKg(vehicle, conditions);
  const massRatio = mass / Math.max(vehicle.weightKg, 1);
  const massFactor = 1 + 0.4 * (massRatio - 1);
  const speed = clampSpeed(speedKmh);
  const temp = segmentTempC(ctx, geo.altitudeM);
  const basePerKm = (vehicle.consumptionKwhPer100km as number) / 100;
  const hours = distanceKm / speed;
  const road =
    basePerKm *
      distanceKm *
      massFactor *
      manualSpeedFactor(speed, ctx, geo) *
      STYLE_MULT[conditions.drivingStyle] *
      climateMultiplier(temp) +
    acPowerKw(conditions.ac, temp) * hours;
  // Efecto del desnivel = física con pendiente − física en llano (sin el ciclo, que
  // ya viene en el consumo manual). En bajada es negativo y descuenta de la base.
  const phys = physicsSlice(distanceKm, elevDeltaM, speed, ctx, geo, { includeCycle: false });
  const flat = physicsSlice(distanceKm, 0, speed, ctx, geo, { includeCycle: false });
  const net = road + (phys.netKwh - flat.netKwh);
  const regen = phys.regenKwh;
  const gross = Math.max(0, net + regen);
  return { grossKwh: gross, regenKwh: regen, netKwh: gross - regen };
}

/**
 * Energía del tramo, sin depender del SOC. `regenKwh` es la regeneración
 * potencial; `netKwh` puede ser negativo en una bajada fuerte: la batería gana carga.
 */
export function segmentEnergyBreakdown(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  geo: SegmentGeo = {},
): EnergySlice {
  if (distanceKm <= 0) return { grossKwh: 0, regenKwh: 0, netKwh: 0 };
  if (hasManualConsumption(ctx.vehicle)) return manualSlice(distanceKm, elevDeltaM, speedKmh, ctx, geo);
  return physicsSlice(distanceKm, elevDeltaM, speedKmh, ctx, geo);
}

/** Mixed-cycle reference at ~70 km/h on flat, kWh/100 km. */
export function mixedCycleKwhPer100(
  vehicle: Vehicle,
  conditions: TripConditions,
  weather: WeatherSnapshot | null,
): number {
  if (hasManualConsumption(vehicle)) return vehicle.consumptionKwhPer100km as number;
  const e = physicsSlice(100, 0, REF_SPEED, { vehicle, conditions, weather }).netKwh;
  return Math.max(8, e);
}

/** Energía neta de un tramo (con regeneración potencial). Mismo modelo que el perfil de la ruta. */
export function segmentEnergyKwh(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  geo: SegmentGeo = {},
): number {
  return segmentEnergyBreakdown(distanceKm, elevDeltaM, speedKmh, ctx, geo).netKwh;
}

/**
 * Perfil de energía de la ruta: gross, regeneración potencial y neto por tramo,
 * y el acumulado. No depende del SOC (F3): el SOC lo calcula el SOCEngine.
 */
export function annotateEnergy(
  samples: Omit<
    RouteSample,
    "energyKwh" | "energyGrossKwh" | "energyRegenKwh" | "cumulativeKwh" | "avgKwhPer100" | "soc"
  >[],
  ctx: EnergyContext,
): EnergySample[] {
  const energyCtx: EnergyContext = {
    ...ctx,
    originAltitudeM: ctx.originAltitudeM ?? samples[0]?.elevM,
  };
  let cum = 0;
  const out: EnergySample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    let gross = 0;
    let regen = 0;
    let net = 0;
    if (i > 0) {
      const prev = samples[i - 1]!;
      const dKm = Math.max(0, s.km - prev.km);
      const dElev = s.elevM - prev.elevM;
      const geo: SegmentGeo = {
        altitudeM: (prev.elevM + s.elevM) / 2,
        headingDeg: bearingDeg(prev, s),
      };
      const slice = segmentEnergyBreakdown(dKm, dElev, s.speedKmh, energyCtx, geo);
      gross = slice.grossKwh;
      regen = slice.regenKwh;
      net = slice.netKwh;
    }
    cum += net;
    const avg = s.km > 0.3 ? (cum / s.km) * 100 : 0;
    out.push({
      ...s,
      energyKwh: net,
      energyGrossKwh: gross,
      energyRegenKwh: regen,
      cumulativeKwh: cum,
      avgKwhPer100: avg,
    });
  }
  return out;
}

export function energyBetween(samples: EnergySample[], fromIdx: number, toIdx: number): number {
  const a = samples[Math.max(0, fromIdx)]!;
  const b = samples[Math.min(samples.length - 1, toIdx)]!;
  return b.cumulativeKwh - a.cumulativeKwh;
}

export function batteryBudget(
  vehicle: Vehicle,
  conditions: TripConditions,
  weather: WeatherSnapshot | null,
): {
  floorPct: number;
  usablePct: number;
  usableKwh: number;
  reservedKwh: number;
  packedKwh: number;
  rangeKm: number;
  per100: number;
  energyMode: EnergyMode;
  wltpKm: number;
  wltpKwhPer100: number | null;
} {
  const floorPct = reserveSocPct(conditions);
  const usablePct = Math.max(0, conditions.initialSoc - floorPct);
  const packedKwh = (conditions.initialSoc / 100) * vehicle.batteryKwh;
  const usableKwh = (usablePct / 100) * vehicle.batteryKwh;
  const reservedKwh = (floorPct / 100) * vehicle.batteryKwh;
  const per100 = mixedCycleKwhPer100(vehicle, conditions, weather);
  const rangeKm = per100 > 0 ? (usableKwh / per100) * 100 : 0;
  return {
    floorPct,
    usablePct,
    usableKwh,
    reservedKwh,
    packedKwh,
    rangeKm,
    per100,
    energyMode: energyMode(vehicle),
    wltpKm: vehicle.rangeKm,
    wltpKwhPer100: wltpKwhPer100(vehicle),
  };
}

// Bloques de consumo: se mudaron a las series de gráficas (F8).
export { consumptionBlocks, type ConsumptionBlock } from "./ev/engines/chart/series";
