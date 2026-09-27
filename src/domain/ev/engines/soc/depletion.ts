import type { BatteryDepletion } from "@/domain/types";

/**
 * Dónde se agota la batería por la vía: el primer punto en que el SOC cruza
 * el 0 %, interpolado entre dos muestras. null si nunca baja de 0 (un plan
 * viable nunca lo hace). Un plan inviable se muestra así, en vez de "llega
 * con −25 %" (auditoría 2026-09-27, propuesta A).
 */
export function batteryDepletion(
  samples: { km: number; lat: number; lon: number; soc: number }[],
): BatteryDepletion | null {
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i]!;
    if (cur.soc >= 0) continue;
    const prev = samples[i - 1];
    if (!prev || prev.soc < 0) return { km: cur.km, lat: cur.lat, lon: cur.lon };
    const t = prev.soc / (prev.soc - cur.soc);
    return {
      km: prev.km + (cur.km - prev.km) * t,
      lat: prev.lat + (cur.lat - prev.lat) * t,
      lon: prev.lon + (cur.lon - prev.lon) * t,
    };
  }
  return null;
}
