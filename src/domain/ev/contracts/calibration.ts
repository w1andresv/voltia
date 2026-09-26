import { z } from "zod";
import type { RouteSample } from "../../types";

/**
 * Contrato de calibración (especificación §9, guía 05 §5.8): lo que se observó
 * en un viaje real, para comparar con lo que el plan predijo y ajustar los
 * parámetros `estimated` (Crr, eficiencias, captura de regeneración,
 * auxiliares, modos de conducción). Un valor calibrado pasa a
 * `source: "calculated"` con referencia al conjunto de viajes usado.
 *
 * Solo el contrato y la comparación: dónde se guarda y cómo lo carga el
 * usuario queda por decidir (guía 05, D13).
 */
export interface TripObservation {
  planId: string;
  /** Versión del modelo con que se calculó el plan (snapshot.modelVersion). */
  modelVersion: string;
  vehicleId: string;
  /** Condiciones del viaje tal como se planificó (PlanRequest.conditions). */
  conditions: Record<string, unknown>;
  /** SOC observado en puntos de la ruta (al menos la salida y la llegada). */
  observedSoc: { distanceKm: number; socPercent: number; timestamp?: string }[];
  /** Energía que marcó el vehículo, si la muestra. */
  observedEnergyKwh?: number;
  observedSpeedsKmh?: { distanceKm: number; speedKmh: number }[];
}

export const TripObservationSchema = z.object({
  planId: z.string().min(1),
  modelVersion: z.string().min(1),
  vehicleId: z.string().min(1),
  conditions: z.record(z.string(), z.unknown()),
  observedSoc: z
    .array(
      z.object({
        distanceKm: z.number().min(0),
        socPercent: z.number().min(0).max(100),
        timestamp: z.string().optional(),
      }),
    )
    .min(2),
  observedEnergyKwh: z.number().positive().optional(),
  observedSpeedsKmh: z
    .array(z.object({ distanceKm: z.number().min(0), speedKmh: z.number().min(0) }))
    .optional(),
});

export interface ObservationComparison {
  /** SOC predicho − observado en cada punto observado, puntos de SOC (positivo = el plan fue optimista). */
  socErrors: { distanceKm: number; predicted: number; observed: number; error: number }[];
  /** Error medio y máximo absoluto de SOC. */
  meanAbsSocError: number;
  maxAbsSocError: number;
  /** Energía predicha − observada, kWh (solo si se observó). */
  energyErrorKwh?: number;
  /**
   * Factor observado / predicho del consumo entre el primer y el último punto
   * observado (sin cargas en medio). > 1: se consumió más de lo previsto.
   */
  consumptionRatio?: number;
}

/** SOC del plan en `km`, interpolado entre muestras. */
function socAt(samples: Pick<RouteSample, "km" | "soc">[], km: number): number {
  if (!samples.length) return 0;
  if (km <= samples[0]!.km) return samples[0]!.soc;
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i]!;
    if (km <= b.km) {
      const a = samples[i - 1]!;
      const span = b.km - a.km;
      return span > 0 ? a.soc + ((b.soc - a.soc) * (km - a.km)) / span : b.soc;
    }
  }
  return samples[samples.length - 1]!.soc;
}

/**
 * Compara lo observado con el plan. `chargedPct` es la carga del plan entre el
 * primer y el último punto observado (para aislar el consumo); sin paradas, 0.
 */
export function compareObservation(
  plan: { samples: Pick<RouteSample, "km" | "soc">[]; energyKwh: number },
  obs: Pick<TripObservation, "observedSoc" | "observedEnergyKwh">,
  chargedPct = 0,
): ObservationComparison {
  const points = [...obs.observedSoc].sort((a, b) => a.distanceKm - b.distanceKm);
  const socErrors = points.map((p) => {
    const predicted = socAt(plan.samples, p.distanceKm);
    return {
      distanceKm: p.distanceKm,
      predicted,
      observed: p.socPercent,
      error: predicted - p.socPercent,
    };
  });
  const abs = socErrors.map((e) => Math.abs(e.error));
  const first = socErrors[0];
  const last = socErrors[socErrors.length - 1];
  const predictedDrop = first && last ? first.predicted - last.predicted + chargedPct : 0;
  const observedDrop = first && last ? first.observed - last.observed + chargedPct : 0;
  return {
    socErrors,
    meanAbsSocError: abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : 0,
    maxAbsSocError: abs.length ? Math.max(...abs) : 0,
    ...(obs.observedEnergyKwh != null
      ? { energyErrorKwh: plan.energyKwh - obs.observedEnergyKwh }
      : {}),
    ...(predictedDrop > 0 ? { consumptionRatio: observedDrop / predictedDrop } : {}),
  };
}
