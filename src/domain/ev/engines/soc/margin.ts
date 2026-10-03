import type { EnergySample } from "@/domain/ev/contracts/energy";

/**
 * Margen de energía (M2.3, ADR-0023): para planificar se supone que el viaje gasta `pct` %
 * más de lo calculado, para no quedar justo si el consumo real sale mayor. Se escala la
 * energía bruta (tracción y auxiliares) y no la regeneración: lo que podría recuperarse no
 * sube con un consumo mayor. Con 0 devuelve las mismas muestras. La curva que ve el usuario
 * sigue siendo la nominal; el margen solo mueve dónde y cuánto se carga.
 */
export function withEnergyMargin(samples: EnergySample[], pct: number): EnergySample[] {
  if (!(pct > 0)) return samples;
  const k = 1 + pct / 100;
  let cumulative = 0;
  return samples.map((s, i) => {
    const gross = s.energyGrossKwh * k;
    const net = gross - s.energyRegenKwh;
    if (i > 0) cumulative += net;
    return { ...s, energyGrossKwh: gross, energyKwh: i > 0 ? net : 0, cumulativeKwh: cumulative };
  });
}
