import type { ModelParameters } from "../ev/core/params";
import type { EnergyV2Result } from "../ev/energy-v2";
import type { ChargeStop, PlanAssumption, PlanDataQuality } from "../types";

/**
 * Supuestos y calidad de los datos de un plan (contrato `RoutePlan`, D7): los
 * valores `estimated` que de verdad pesan en este plan, y qué datos faltaron.
 */

export function planAssumptions(args: {
  energyV2: EnergyV2Result | null;
  stops: ChargeStop[];
  params: ModelParameters;
}): PlanAssumption[] {
  const { energyV2, stops, params } = args;
  const out: PlanAssumption[] = [];
  if (energyV2) {
    for (const [key, v] of Object.entries(energyV2.params)) {
      if (v.source !== "estimated") continue;
      out.push({
        parameter: `vehicle.${key}`,
        value: v.value,
        source: v.source,
        ...(v.reference ? { reference: v.reference } : {}),
      });
    }
    if (energyV2.wetRoad) {
      const wet = params.energy.wetRoad;
      out.push({
        parameter: "energy.wetRoad",
        value: { ...wet.value, origin: energyV2.wetRoad },
        source: wet.source,
        ...(wet.reference ? { reference: wet.reference } : {}),
      });
    }
    if (energyV2.tollStops) {
      const toll = params.speed.tollStopSeconds;
      out.push({
        parameter: "speed.tollStopSeconds",
        value: { seconds: toll.value, booths: energyV2.tollStops },
        source: toll.source,
        ...(toll.reference ? { reference: toll.reference } : {}),
      });
    }
    const regen = params.energy.regenModes;
    if (regen.source === "estimated") {
      out.push({ parameter: "energy.regenModes", value: energyV2.regen, source: regen.source });
    }
  } else {
    out.push({
      parameter: "energy.model",
      value: "legacy",
      source: "estimated",
      reference: "docs/adr/0012-energia-v2-detras-de-energy-engine.md",
    });
  }
  if (stops.length) {
    const overhead = params.charging.connectionOverheadMin;
    out.push({
      parameter: "charging.connectionOverheadMin",
      value: overhead.value,
      source: overhead.source,
    });
  }
  if (stops.some((s) => s.detourSource !== "calculated")) {
    const factor = params.corridor.detourRoadFactor;
    out.push({
      parameter: "corridor.detourRoadFactor",
      value: factor.value,
      source: factor.source,
    });
  }
  if (stops.some((s) => s.charger.availability === "occupied")) {
    const wait = params.planner.occupiedWaitMin;
    out.push({ parameter: "planner.occupiedWaitMin", value: wait.value, source: wait.source });
  }
  return out;
}

export function planDataQuality(args: {
  energyV2: EnergyV2Result | null;
  stops: ChargeStop[];
  elevationUnavailable?: boolean;
}): PlanDataQuality {
  const { energyV2, stops } = args;
  return {
    ...(args.elevationUnavailable ? { elevation: "unavailable" as const } : {}),
    ...(energyV2 ? { providerDurationDeviationPct: energyV2.durationDeviationPct } : {}),
    estimatedDetours: stops.filter((s) => s.detourSource !== "calculated").length,
    stopsWithAssumedPower: stops.filter((s) => s.bestSocket.powerOrigin === "assumed").length,
  };
}
