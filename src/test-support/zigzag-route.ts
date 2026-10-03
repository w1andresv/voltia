import type { RawRoute } from "@/domain/types";

/**
 * Ruta en zigzag (M5, ADR-0027): la vía sale 16 km al este y vuelve (una herradura de montaña);
 * las muestras (km 0, 30, 70 y 100, donde la vía está sobre la cuerda) solo ven la recta norte–sur. Una estación en la punta de la
 * herradura está sobre la vía, pero a ~16 km de la cuerda.
 */
const KM_LAT = 110.574;
const KM_LON = 111.32 * Math.cos((7.1 * Math.PI) / 180);

/** Puntos de la vía: (lat, lon) con la punta en el km 50 de 100. */
function roadPoint(km: number): { lat: number; lon: number } {
  // Norte–sur con una excursión de 16 km al este entre el km 30 y el 70 (triangular).
  const east = km < 30 || km > 70 ? 0 : 16 * (1 - Math.abs(km - 50) / 20);
  return { lat: 7 + km / KM_LAT, lon: -73 + east / KM_LON };
}

export function zigzagRoute(): RawRoute {
  const samplesKm = [0, 30, 70, 100];
  const samples = samplesKm.map((km) => ({
    km,
    ...roadPoint(km),
    elevM: 0,
    slopePct: 0,
    speedKmh: 80,
  }));
  // La geometría fina sigue la vía cada 2 km (más puntos que muestras).
  const geometry = Array.from({ length: 51 }, (_, i) => roadPoint(i * 2));
  return {
    id: "zigzag",
    label: "zigzag",
    geometry,
    samples,
    distanceKm: 100,
    driveMinutes: 75,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

/** Un punto sobre la vía, en la punta de la herradura (km 50), y otro a `lateralKm` de ella. */
export function atTip(lateralKm = 0): { lat: number; lon: number } {
  const tip = roadPoint(50);
  return { lat: tip.lat, lon: tip.lon + lateralKm / KM_LON };
}
