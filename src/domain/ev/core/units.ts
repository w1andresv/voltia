/**
 * Unidades del motor v2. Dentro de las fórmulas se usa el SI (m, s, kg, J, W);
 * los campos expuestos llevan la unidad en el nombre (`distanceKm`, `energyKwh`).
 * Toda conversión pasa por aquí.
 */

/** Aceleración de la gravedad, m/s². */
export const G_MS2 = 9.81;
/** Julios en un kWh. */
export const J_PER_KWH = 3_600_000;

export function kmhToMs(kmh: number): number {
  return kmh / 3.6;
}

export function msToKmh(ms: number): number {
  return ms * 3.6;
}

export function kmToM(km: number): number {
  return km * 1000;
}

export function mToKm(m: number): number {
  return m / 1000;
}

export function kwhToJ(kwh: number): number {
  return kwh * J_PER_KWH;
}

export function jToKwh(j: number): number {
  return j / J_PER_KWH;
}

export function hoursToMinutes(h: number): number {
  return h * 60;
}

/** Puntos de SOC que representa `energyKwh` en una batería de `capacityKwh` útiles. 0 si no hay capacidad. */
export function kwhToSocPct(energyKwh: number, capacityKwh: number): number {
  return capacityKwh > 0 ? (energyKwh / capacityKwh) * 100 : 0;
}

/** kWh que representan `socPct` puntos de SOC en una batería de `capacityKwh` útiles. */
export function socPctToKwh(socPct: number, capacityKwh: number): number {
  return (socPct / 100) * capacityKwh;
}
