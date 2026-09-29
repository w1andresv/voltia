import type { ElevationProfile } from "@/domain/types";

/**
 * Perfil de altura en una rejilla uniforme (km 0, stepKm, 2·stepKm, …, fin).
 * Lo arma la elevación por malla y lo lee la energía v2: así ninguno de los
 * dos motores llama al otro.
 */

/** Rejilla uniforme a partir de puntos ordenados por km (una sola pasada). */
export function toElevationGrid(
  km: number[],
  elevM: number[],
  totalKm: number,
  stepKm: number,
): ElevationProfile | undefined {
  if (km.length < 2 || !(stepKm > 0) || !(totalKm > 0)) return undefined;
  const n = Math.max(1, Math.ceil(totalKm / stepKm - 1e-9));
  const out: number[] = new Array(n + 1);
  let j = 1;
  for (let i = 0; i <= n; i++) {
    const x = Math.min(totalKm, i * stepKm);
    while (j < km.length - 1 && km[j]! < x) j++;
    const k0 = km[j - 1]!;
    const k1 = km[j]!;
    const t = k1 > k0 ? Math.min(1, Math.max(0, (x - k0) / (k1 - k0))) : 0;
    out[i] = elevM[j - 1]! + (elevM[j]! - elevM[j - 1]!) * t;
  }
  return { stepKm, elevM: out };
}

/** Altura (m) en `km`, interpolada en la rejilla. */
export function elevationAtKm(profile: ElevationProfile, km: number): number {
  const { stepKm, elevM } = profile;
  const last = elevM.length - 1;
  const x = km / stepKm;
  if (!(x > 0)) return elevM[0] ?? 0;
  if (x >= last) return elevM[last] ?? 0;
  const i = Math.floor(x);
  return elevM[i]! + (elevM[i + 1]! - elevM[i]!) * (x - i);
}
