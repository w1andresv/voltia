/**
 * "¿Con cuánto llegaste?" (D13): arma la observación de un viaje guardado a
 * partir de lo que el usuario dice y la compara con el plan que se le mostró,
 * reconstruido desde el snapshot del viaje (sin consultar proveedores).
 */
import { computePlansFromSnapshot } from "@/domain/ev/compute-plan";
import {
  compareObservation,
  type ObservationComparison,
  type TripObservation,
} from "@/domain/ev/contracts/calibration";
import type { PlanningSnapshot } from "@/domain/ev/contracts/snapshot";
import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";
import type { RoutePlan, TripConditions, Vehicle } from "@/domain/types";

export interface ArrivalInput {
  /** SOC con que llegó al destino, %. */
  arrivalSoc: number;
  /** SOC con que salió, % (por defecto, el del plan). */
  departureSoc?: number;
  /** Energía que marcó el vehículo, kWh, si la muestra. */
  energyKwh?: number;
  /** SOC en puntos intermedios, si los anotó. */
  points?: { distanceKm: number; socPercent: number }[];
}

export interface RecordedArrival {
  observation: TripObservation;
  comparison: ObservationComparison;
  /** Lo que el plan predijo para la llegada, %. */
  predictedArrivalSoc: number;
}

/**
 * El plan que el usuario vio: entre los del snapshot, el de distancia más
 * parecida al resumen guardado (el resumen no guarda el id del plan).
 */
export function planShown(
  snapshot: PlanningSnapshot,
  request: PlanRequestShape,
  summary: TripSummaryShape,
): RoutePlan | undefined {
  const { plans } = computePlansFromSnapshot(
    snapshot,
    { origin: request.origin, destination: request.destination },
    request.vehicle as Vehicle,
    request.conditions as TripConditions,
  );
  return plans.reduce<RoutePlan | undefined>(
    (best, p) =>
      !best ||
      Math.abs(p.distanceKm - summary.distanceKm) < Math.abs(best.distanceKm - summary.distanceKm)
        ? p
        : best,
    undefined,
  );
}

export function recordArrival(
  trip: { request: PlanRequestShape; summary: TripSummaryShape; snapshot?: PlanningSnapshot },
  input: ArrivalInput,
): RecordedArrival {
  const plan = trip.snapshot ? planShown(trip.snapshot, trip.request, trip.summary) : undefined;
  // Sin snapshot (viajes viejos): solo se compara la llegada con el resumen guardado.
  const predicted: Pick<RoutePlan, "samples" | "energyKwh" | "distanceKm" | "initialSoc" | "id"> =
    plan ?? {
      id: "summary",
      distanceKm: trip.summary.distanceKm,
      energyKwh: trip.summary.energyKwh,
      initialSoc: trip.request.conditions.initialSoc,
      samples: [
        { km: 0, soc: trip.request.conditions.initialSoc } as RoutePlan["samples"][number],
        {
          km: trip.summary.distanceKm,
          soc: trip.summary.arrivalSoc,
        } as RoutePlan["samples"][number],
      ],
    };
  const observedSoc = [
    { distanceKm: 0, socPercent: input.departureSoc ?? predicted.initialSoc },
    ...(input.points ?? []).filter((p) => p.distanceKm > 0 && p.distanceKm < predicted.distanceKm),
    { distanceKm: predicted.distanceKm, socPercent: input.arrivalSoc },
  ];
  const observation: TripObservation = {
    planId: predicted.id,
    modelVersion: trip.snapshot?.modelVersion ?? trip.summary.modelVersion ?? "desconocido",
    vehicleId: trip.request.vehicle.id,
    conditions: trip.request.conditions as unknown as Record<string, unknown>,
    observedSoc,
    ...(input.energyKwh != null ? { observedEnergyKwh: input.energyKwh } : {}),
  };
  // Las cargas del plan entre salida y llegada, para aislar el consumo.
  const chargedPct = plan ? plan.stops.reduce((a, s) => a + (s.departSoc - s.arriveSoc), 0) : 0;
  const comparison = compareObservation(
    { samples: predicted.samples, energyKwh: predicted.energyKwh },
    observation,
    chargedPct,
  );
  const last = comparison.socErrors[comparison.socErrors.length - 1];
  return {
    observation,
    comparison,
    predictedArrivalSoc: last?.predicted ?? trip.summary.arrivalSoc,
  };
}
