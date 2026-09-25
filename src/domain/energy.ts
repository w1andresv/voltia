import type { RegenLevel, RouteSample, TripConditions, Vehicle, WeatherSnapshot } from "./types";
import { tripMassKg, safetyPct } from "./types";
import { bearingDeg, toRad } from "./geo";

const G = 9.81;
const J_PER_KWH = 3_600_000;
const REF_SPEED = 70;
const AUX_KW = 0.45;
const CYCLE_OVERHEAD = 1.14;
/** Gradiente térmico estándar de la atmósfera: °C que se pierden por km de altura. */
const LAPSE_C_PER_KM = 6.5;
/** El pronóstico da el viento a 10 m; a la altura del carro sopla más o menos un 70 %. */
const WIND_GROUND_FACTOR = 0.7;
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

const AC_KW: Record<TripConditions["ac"], number> = {
  off: 0,
  eco: 0.6,
  normal: 1.2,
  max: 2.2,
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

export interface EnergyContext {
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
  /**
   * Altitud del origen (m). Es la altura a la que se asume la temperatura que
   * escribió el usuario; sin ella no se corrige la temperatura por altitud.
   */
  originAltitudeM?: number;
}

/** Datos del tramo que no son distancia, desnivel ni velocidad. Todos opcionales. */
export interface SegmentGeo {
  /** Altitud media del tramo, m s. n. m. Cambia la densidad del aire y la temperatura. */
  altitudeM?: number;
  /** Rumbo del tramo en grados (0 = norte, 90 = este). Orienta el viento. */
  headingDeg?: number;
}

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

export function dragAreaM2(vehicle: Vehicle): number {
  const mass = vehicle.weightKg;
  let cda = 0.62 + (mass - 1500) * 0.00048;
  const spec = vehicle.motorKw / Math.max(mass, 1);
  cda -= Math.min(0.07, spec * 0.25);
  return clamp(cda, 0.5, 0.9);
}

export function rollingCrr(vehicle: Vehicle): number {
  return clamp(0.009 + Math.max(0, vehicle.weightKg - 1550) * 0.0000011, 0.0084, 0.011);
}

export function drivetrainEff(vehicle: Vehicle): number {
  return clamp(0.86 + vehicle.motorKw / 2800, 0.85, 0.925);
}

/** Fracción del excedente de bajada que vuelve a la batería según el nivel elegido. */
export function regenRecovery(conditions: TripConditions): number {
  return REGEN_RECOVERY[conditions.regenLevel] ?? REGEN_RECOVERY.medium;
}

/** Recuperación con la batería llena: completa hasta 80 %, baja en línea y es 0 desde 98 %. */
export function effectiveRegen(conditions: TripConditions, socPct = 50): number {
  if (socPct >= 98) return 0;
  const r = regenRecovery(conditions);
  return socPct > 80 ? (r * (98 - socPct)) / 18 : r;
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

export function acPowerKw(ac: TripConditions["ac"], tempC: number): number {
  const base = AC_KW[ac];
  if (base === 0) return 0;
  const heat = tempC < 12 ? (12 - tempC) * 0.06 : 0;
  const cool = tempC > 24 ? (tempC - 24) * 0.05 : 0;
  return base + heat + cool;
}

/**
 * Temperatura del tramo. La del usuario se asume a la altura del origen; la del
 * clima, a la altura de su celda del pronóstico. Si se conocen esa altura de
 * referencia y la del tramo, se corrige con el gradiente estándar (6,5 °C/km).
 */
export function segmentTempC(ctx: EnergyContext, altitudeM?: number): number {
  const { conditions, weather } = ctx;
  let base: number;
  let refAltitude: number | undefined;
  if (conditions.temperatureC != null) {
    base = conditions.temperatureC;
    refAltitude = ctx.originAltitudeM;
  } else if (weather) {
    base = weather.temperatureC;
    refAltitude = weather.elevationM;
  } else {
    return 20;
  }
  if (altitudeM == null || refAltitude == null) return base;
  return base - (LAPSE_C_PER_KM * (altitudeM - refAltitude)) / 1000;
}

/** Densidad del aire (kg/m³) por temperatura y altitud: presión barométrica estándar y gas ideal. */
export function airDensity(tempC: number, altitudeM = 0): number {
  const h = clamp(altitudeM, -500, 6000);
  const pressurePa = 101_325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
  return pressurePa / (287.05 * (273.15 + tempC));
}

/**
 * Cuadrado de la velocidad relativa al aire (m²/s²), con signo: negativo si el
 * viento de cola es más rápido que el carro. Con rumbo, el viento se proyecta
 * sobre la vía (`windDirDeg` es de dónde viene). Sin rumbo se usa el promedio
 * sobre todas las direcciones: v² + w²/2.
 */
export function airSpeedSq(
  speedKmh: number,
  weather: WeatherSnapshot | null,
  headingDeg?: number,
): number {
  const v = speedKmh / 3.6;
  const w = ((weather?.windKmh ?? 0) * WIND_GROUND_FACTOR) / 3.6;
  if (!(w > 0)) return v * v;
  if (headingDeg == null || !Number.isFinite(weather?.windDirDeg)) return v * v + (w * w) / 2;
  const headwind = w * Math.cos(toRad((weather!.windDirDeg as number) - headingDeg));
  const va = v + headwind;
  return va * Math.abs(va);
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
  socPct: number,
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
    const speedRegen = speed < 15 ? speed / 15 : 1;
    const capKwh = Math.max(0, vehicle.motorKw * REGEN_POWER_SHARE * hours);
    regen = Math.min(-wheelKwh * effectiveRegen(conditions, socPct) * speedRegen, capKwh);
  }
  const gross = traction + aux;
  return { grossKwh: gross, regenKwh: regen, netKwh: gross - regen };
}

function manualSlice(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct: number,
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
  const phys = physicsSlice(distanceKm, elevDeltaM, speed, ctx, socPct, geo, {
    includeCycle: false,
  });
  const flat = physicsSlice(distanceKm, 0, speed, ctx, socPct, geo, { includeCycle: false });
  const net = road + (phys.netKwh - flat.netKwh);
  const regen = phys.regenKwh;
  const gross = Math.max(0, net + regen);
  return { grossKwh: gross, regenKwh: regen, netKwh: gross - regen };
}

/**
 * Energía del tramo. `netKwh` puede ser negativo en una bajada fuerte: la
 * batería gana carga.
 */
export function segmentEnergyBreakdown(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct = 50,
  geo: SegmentGeo = {},
): EnergySlice {
  if (distanceKm <= 0) return { grossKwh: 0, regenKwh: 0, netKwh: 0 };
  if (hasManualConsumption(ctx.vehicle))
    return manualSlice(distanceKm, elevDeltaM, speedKmh, ctx, socPct, geo);
  return physicsSlice(distanceKm, elevDeltaM, speedKmh, ctx, socPct, geo);
}

/** Mixed-cycle reference at ~70 km/h on flat, kWh/100 km. */
export function mixedCycleKwhPer100(
  vehicle: Vehicle,
  conditions: TripConditions,
  weather: WeatherSnapshot | null,
): number {
  if (hasManualConsumption(vehicle)) return vehicle.consumptionKwhPer100km as number;
  const e = physicsSlice(100, 0, REF_SPEED, { vehicle, conditions, weather }, 50).netKwh;
  return Math.max(8, e);
}

/**
 * Net energy for a route slice. Same engine as SOC, charge stops and the chart.
 */
export function segmentEnergyKwh(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct = 50,
  geo: SegmentGeo = {},
): number {
  return segmentEnergyBreakdown(distanceKm, elevDeltaM, speedKmh, ctx, socPct, geo).netKwh;
}

export function annotateEnergy(
  samples: Omit<
    RouteSample,
    "energyKwh" | "energyGrossKwh" | "energyRegenKwh" | "cumulativeKwh" | "avgKwhPer100" | "soc"
  >[],
  ctx: EnergyContext,
  initialSoc: number,
): RouteSample[] {
  const cap = Math.max(ctx.vehicle.batteryKwh, 1);
  const energyCtx: EnergyContext = {
    ...ctx,
    originAltitudeM: ctx.originAltitudeM ?? samples[0]?.elevM,
  };
  let cum = 0;
  let soc = initialSoc;
  const out: RouteSample[] = [];
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
      const slice = segmentEnergyBreakdown(dKm, dElev, s.speedKmh, energyCtx, soc, geo);
      gross = slice.grossKwh;
      regen = slice.regenKwh;
      net = slice.netKwh;
    }
    cum += net;
    soc = clamp(soc - (net / cap) * 100, 0, 100);
    const avg = s.km > 0.3 ? (cum / s.km) * 100 : 0;
    out.push({
      ...s,
      energyKwh: net,
      energyGrossKwh: gross,
      energyRegenKwh: regen,
      cumulativeKwh: cum,
      avgKwhPer100: avg,
      soc,
    });
  }
  return out;
}

export function energyBetween(samples: RouteSample[], fromIdx: number, toIdx: number): number {
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
  const floorPct = Math.max(
    safetyPct(conditions),
    vehicle.minSocRecommended,
    conditions.arrivalSoc,
  );
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

export interface ConsumptionBlock {
  fromKm: number;
  toKm: number;
  /** kWh netos del tramo (negativo si baja mucho y regenera más de lo que gasta). */
  kwh: number;
  kwhPer100: number;
  gainM: number;
  lossM: number;
}

/** Valor de una serie acumulada en `km`, interpolando entre muestras. */
function valueAtKm<T extends { km: number }>(samples: T[], km: number, pick: (s: T) => number): number {
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

/**
 * Consumo neto por tramos de `blockKm` (100 km por defecto), a partir del
 * acumulado de la ruta. Un resto final menor que `minTailKm` se suma al tramo
 * anterior para no mostrar un promedio ruidoso de pocos km.
 */
export function consumptionBlocks(
  samples: RouteSample[],
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
      valueAtKm(samples, toKm, (s) => s.cumulativeKwh) -
      valueAtKm(samples, fromKm, (s) => s.cumulativeKwh);
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
