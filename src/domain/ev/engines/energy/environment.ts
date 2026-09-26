import type { TripConditions, Vehicle, WeatherSnapshot } from "@/domain/types";
import { toRad } from "@/domain/geo";

/**
 * Entorno del tramo, común a los modelos de energía (el actual y el v2):
 * temperatura por altitud, densidad del aire, viento relativo y potencia del
 * aire acondicionado. Se mudó desde domain/energy.ts sin cambiar la aritmética.
 */

/** Gradiente térmico estándar de la atmósfera: °C que se pierden por km de altura. */
const LAPSE_C_PER_KM = 6.5;
/** El pronóstico da el viento a 10 m; a la altura del carro sopla más o menos un 70 %. */
const WIND_GROUND_FACTOR = 0.7;

const AC_KW: Record<TripConditions["ac"], number> = {
  off: 0,
  eco: 0.6,
  normal: 1.2,
  max: 2.2,
};

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
