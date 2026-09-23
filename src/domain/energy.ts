import type { RouteSample, TripConditions, Vehicle, WeatherSnapshot } from "./types";
import { tripMassKg, safetyPct } from "./types";

const G = 9.81;
const J_PER_KWH = 3_600_000;
const REF_SPEED = 70;
const AUX_KW = 0.45;
const CYCLE_OVERHEAD = 1.14;
const AIR_RHO = 1.225;

const STYLE_MULT: Record<TripConditions["drivingStyle"], number> = {
  efficient: 0.9,
  normal: 1,
  sport: 1.14,
};

const AC_KW: Record<TripConditions["ac"], number> = {
  off: 0,
  eco: 0.6,
  normal: 1.2,
  max: 2.2,
};

export type EnergyMode = "manual" | "estimated";

export interface EnergyContext {
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
}

export interface EnergySlice {
  grossKwh: number;
  regenKwh: number;
  netKwh: number;
}

export function hasManualConsumption(vehicle: Vehicle): boolean {
  return Boolean(vehicle.consumptionManual && vehicle.consumptionKwhPer100km && vehicle.consumptionKwhPer100km > 0);
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

export function regenFactor(vehicle: Vehicle): number {
  return clamp(0.5 + vehicle.motorKw / 1800, 0.48, 0.68);
}

/** Trip regen as a fraction of recoverable descent potential. Default 20%. */
export function tripRegenCap(conditions: TripConditions): number {
  const pct = Number.isFinite(conditions.regenPct) ? conditions.regenPct : 20;
  return clamp(pct / 100, 0.05, 0.8);
}

export function effectiveRegen(_vehicle: Vehicle, conditions: TripConditions, socPct = 50): number {
  let r = tripRegenCap(conditions);
  if (socPct >= 98) return 0;
  if (socPct > 80) r *= (98 - socPct) / 18;
  return r;
}

export function climateMultiplier(tempC: number): number {
  if (tempC <= 0) return 1.28;
  if (tempC < 8) return 1.16;
  if (tempC < 15) return 1.07;
  if (tempC <= 26) return 1;
  if (tempC <= 32) return 1.05;
  return 1.1;
}

export function acPowerKw(ac: TripConditions["ac"], tempC: number): number {
  const base = AC_KW[ac];
  if (base === 0) return 0;
  const heat = tempC < 12 ? (12 - tempC) * 0.06 : 0;
  const cool = tempC > 24 ? (tempC - 24) * 0.05 : 0;
  return base + heat + cool;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function airDensity(tempC: number): number {
  return AIR_RHO * (288.15 / (273.15 + tempC));
}

function speedFactor(speedKmh: number): number {
  const r = Math.max(30, Math.min(140, speedKmh)) / REF_SPEED;
  return Math.min(1.55, Math.max(0.88, 1 + 0.42 * (r * r - 1)));
}

function wheelForcesKwh(args: {
  distanceKm: number;
  elevDeltaM: number;
  speedKmh: number;
  massKg: number;
  cda: number;
  crr: number;
  tempC: number;
}): { rollAero: number; gravity: number } {
  const dM = args.distanceKm * 1000;
  if (dM <= 0) return { rollAero: 0, gravity: 0 };
  const v = Math.max(6, args.speedKmh) / 3.6;
  const rho = airDensity(args.tempC);
  const fRoll = args.crr * args.massKg * G;
  const fAero = 0.5 * rho * args.cda * v * v;
  const fGrav = args.massKg * G * (args.elevDeltaM / dM);
  return {
    rollAero: ((fRoll + fAero) * dM) / J_PER_KWH,
    gravity: (fGrav * dM) / J_PER_KWH,
  };
}

function physicsSlice(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct: number,
  opts?: { includeCycle?: boolean },
): EnergySlice {
  const { vehicle, conditions, weather } = ctx;
  const mass = tripMassKg(vehicle, conditions);
  const speed = Math.max(20, Math.min(140, speedKmh || REF_SPEED));
  const temp = conditions.temperatureC ?? weather?.temperatureC ?? 20;
  const wind = weather?.windKmh ?? 0;
  const windFactor = 1 + Math.max(-0.06, Math.min(0.1, wind * 0.002));
  const hours = distanceKm / speed;
  const aux = (acPowerKw(conditions.ac, temp) + AUX_KW) * hours;
  const eff = drivetrainEff(vehicle);
  const climate = climateMultiplier(temp) * windFactor;
  const packOver = 1 + Math.max(0, vehicle.batteryKwh - 55) * 0.0007;
  const style = STYLE_MULT[conditions.drivingStyle];
  const cycle = opts?.includeCycle === false ? 1 : CYCLE_OVERHEAD;

  const { rollAero, gravity } = wheelForcesKwh({
    distanceKm,
    elevDeltaM,
    speedKmh: speed,
    massKg: mass,
    cda: dragAreaM2(vehicle),
    crr: rollingCrr(vehicle),
    tempC: temp,
  });

  const climb = Math.max(0, gravity);
  const descent = Math.max(0, -gravity);
  let traction = (rollAero + climb) / eff;
  traction *= cycle * style * climate * packOver;
  const gross = traction + aux;

  const regenEff = effectiveRegen(vehicle, conditions, socPct);
  const speedRegen = speed < 15 ? clamp(speed / 15, 0, 1) : 1;
  const motorCapKwh = vehicle.motorKw * 0.4 * hours;
  // Recoverable potential = descent gravity energy. Regen % is applied to that
  // potential; drivetrain + motor cap keep it from becoming 100% pack energy.
  let regen = descent * regenEff * eff * speedRegen;
  regen = Math.min(regen, Math.max(0, motorCapKwh), gross + descent);
  const net = gross - regen;
  return { grossKwh: gross, regenKwh: regen, netKwh: net };
}

function manualSlice(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct: number,
): EnergySlice {
  const { vehicle, conditions, weather } = ctx;
  const mass = tripMassKg(vehicle, conditions);
  const massRatio = mass / Math.max(vehicle.weightKg, 1);
  const massFactor = 1 + 0.4 * (massRatio - 1);
  const speed = Math.max(20, Math.min(140, speedKmh || REF_SPEED));
  const temp = conditions.temperatureC ?? weather?.temperatureC ?? 20;
  const wind = weather?.windKmh ?? 0;
  const windFactor = 1 + Math.max(-0.06, Math.min(0.1, wind * 0.002));
  const basePerKm = (vehicle.consumptionKwhPer100km as number) / 100;
  const hours = distanceKm / speed;
  const road =
    basePerKm *
      distanceKm *
      massFactor *
      speedFactor(speed) *
      STYLE_MULT[conditions.drivingStyle] *
      climateMultiplier(temp) *
      windFactor +
    acPowerKw(conditions.ac, temp) * hours;
  const phys = physicsSlice(distanceKm, elevDeltaM, speed, ctx, socPct, { includeCycle: false });
  const flat = physicsSlice(distanceKm, 0, speed, ctx, socPct, { includeCycle: false });
  const gravNet = phys.netKwh - flat.netKwh;
  const gross = Math.max(0, road + Math.max(0, gravNet));
  const regen = phys.regenKwh;
  return { grossKwh: gross, regenKwh: regen, netKwh: gross - regen };
}

export function segmentEnergyBreakdown(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct = 50,
): EnergySlice {
  if (distanceKm <= 0) return { grossKwh: 0, regenKwh: 0, netKwh: 0 };
  if (hasManualConsumption(ctx.vehicle)) return manualSlice(distanceKm, elevDeltaM, speedKmh, ctx, socPct);
  return physicsSlice(distanceKm, elevDeltaM, speedKmh, ctx, socPct);
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
): number {
  return segmentEnergyBreakdown(distanceKm, elevDeltaM, speedKmh, ctx, socPct).netKwh;
}

export function annotateEnergy(
  samples: Omit<RouteSample, "energyKwh" | "energyGrossKwh" | "energyRegenKwh" | "cumulativeKwh" | "avgKwhPer100" | "soc">[],
  ctx: EnergyContext,
  initialSoc: number,
): RouteSample[] {
  const cap = Math.max(ctx.vehicle.batteryKwh, 1);
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
      const slice = segmentEnergyBreakdown(dKm, dElev, s.speedKmh, ctx, soc);
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
  const floorPct = Math.max(safetyPct(conditions), vehicle.minSocRecommended, conditions.arrivalSoc);
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
