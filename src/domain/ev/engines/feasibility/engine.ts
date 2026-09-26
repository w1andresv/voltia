/**
 * RouteFeasibilityEngine (especificación §5.9): clasifica el resultado del
 * planificador. No calcula energía ni elige estaciones. Los textos para el
 * usuario salen de los códigos, en la capa de presentación.
 */

export type FeasibilityStatus =
  | "FEASIBLE_NO_CHARGING"
  | "FEASIBLE_ONE_STOP"
  | "FEASIBLE_MULTIPLE_STOPS"
  | "INFEASIBLE_WITH_CURRENT_SOC"
  | "INFEASIBLE_EVEN_AT_FULL_SOC";

export type InfeasibilityReason =
  | "INITIAL_SOC_INSUFFICIENT"
  | "GAP_BETWEEN_STATIONS_EXCEEDS_RANGE"
  | "NO_COMPATIBLE_STATIONS_IN_CORRIDOR"
  | "DESTINATION_RESERVE_UNREACHABLE"
  | "PLAN_VALIDATION_FAILED";

export interface FeasibilityInput {
  /** Plan viable con el SOC actual. */
  feasibleNow: boolean;
  stops: number;
  /** Plan viable cargando antes de salir (≤ 100 %). */
  feasibleWithPrecharge: boolean;
  compatibleStations: number;
  /** Con la batería llena se llega al último tramo, pero sin la reserva al destino. */
  destinationShort: boolean;
  /** La simulación final del plan elegido respeta pisos y reserva. */
  validated: boolean;
}

export interface FeasibilityResult {
  feasible: boolean;
  status: FeasibilityStatus;
  reasonCode?: InfeasibilityReason;
}

export function classifyFeasibility(input: FeasibilityInput): FeasibilityResult {
  if (input.feasibleNow || input.feasibleWithPrecharge) {
    if (!input.validated) {
      return { feasible: false, status: "INFEASIBLE_EVEN_AT_FULL_SOC", reasonCode: "PLAN_VALIDATION_FAILED" };
    }
    if (!input.feasibleNow) {
      return { feasible: true, status: "INFEASIBLE_WITH_CURRENT_SOC", reasonCode: "INITIAL_SOC_INSUFFICIENT" };
    }
    const status =
      input.stops === 0 ? "FEASIBLE_NO_CHARGING" : input.stops === 1 ? "FEASIBLE_ONE_STOP" : "FEASIBLE_MULTIPLE_STOPS";
    return { feasible: true, status };
  }
  const reasonCode: InfeasibilityReason =
    input.compatibleStations === 0
      ? "NO_COMPATIBLE_STATIONS_IN_CORRIDOR"
      : input.destinationShort
        ? "DESTINATION_RESERVE_UNREACHABLE"
        : "GAP_BETWEEN_STATIONS_EXCEEDS_RANGE";
  return { feasible: false, status: "INFEASIBLE_EVEN_AT_FULL_SOC", reasonCode };
}
