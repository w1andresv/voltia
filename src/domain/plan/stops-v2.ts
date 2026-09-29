import type { ModelParameters } from "../ev/core/params";
import { toTripConfiguration } from "../ev/core/trip-config";
import { kwhToSocPct } from "../ev/core/units";
import { FLAT_CURVE, chargeTimeMinutes, lerpFactor } from "../ev/engines/charging/curve";
import {
  planCharging,
  requiredInitialCharge,
  type PlannerInput,
  type PlannerNode,
} from "../ev/engines/charging/planner";
import { routePlugs, routeSocket, type RoutePlug } from "../ev/engines/compatibility/engine";
import { classifyFeasibility } from "../ev/engines/feasibility/engine";
import { requiredStartSoc, simulateSoc, spentSocPct, walkSoc } from "../ev/engines/soc/simulate";
import {
  FIRST_CHARGER_UNREACHABLE_REASON,
  INFEASIBILITY_TEXT,
  isVerifiedForPlanning,
  type ChargeChoice,
  type ChargeStop,
  type Vehicle,
} from "../types";
import {
  detourEnergyKwh,
  detourMinutesOf,
  fromRouteKmOf,
  isOffline,
  rangeFromEnergy,
  stopEvents,
  type EnergyCtx,
  type StopsArgs,
  type StopsChoice,
} from "./shared";

/**
 * Minutos de carga por estación, precalculados sobre la malla de integración:
 * la programación dinámica los consulta miles de veces.
 */
function chargeMinutesTable(
  plug: RoutePlug,
  vehicle: Vehicle,
  capacityKwh: number,
  params: ModelParameters,
): PlannerNode["chargeMinutes"] {
  const step = params.charging.integrationStepPct;
  const overhead = params.charging.connectionOverheadMin.value;
  const peak = plug.dc ? vehicle.dcMaxKw : vehicle.acMaxKw;
  const curve = plug.dc ? vehicle.chargeCurve : FLAT_CURVE;
  const n = Math.round(100 / step);
  const cum = new Float64Array(n + 1);
  const energy = (capacityKwh * step) / 100;
  for (let k = 0; k < n; k++) {
    const power = Math.min(peak * lerpFactor(curve, (k + 0.5) * step), plug.powerKw);
    cum[k + 1] = cum[k]! + (energy / Math.max(power, 1.5)) * 60;
  }
  const at = (soc: number) => {
    const x = Math.max(0, Math.min(100, soc)) / step;
    const k = Math.min(n - 1, Math.floor(x));
    return cum[k]! + (cum[k + 1]! - cum[k]!) * (x - k);
  };
  return (from, to) => (to > from ? at(to) - at(from) + overhead : 0);
}

/**
 * Planificador v2 (F7): paradas por programación dinámica con costo
 * lexicográfico según la estrategia, carga previa sobre el mismo planificador
 * y viabilidad con códigos. Sin reglas de puntaje ni tope fijo de paradas.
 */
export function planStopsV2(args: StopsArgs): StopsChoice {
  const { samples, vehicle, conditions, weather, params } = args;
  const tolerance = params.planner.socTolerancePct;
  const regen = params.soc.regenAcceptance;
  const cfg = toTripConfiguration(vehicle, conditions, weather, params);
  const cap = Math.max(vehicle.batteryKwh, 1);
  const destIdx = samples.length - 1;
  const floor = cfg.minimumSocPercent;
  // Con "permitir bajar del margen" el destino pide lo que eligió el usuario, sin subirlo a la reserva.
  const destReserve = conditions.allowBelowSafety
    ? Math.max(conditions.arrivalSoc, floor)
    : cfg.destinationReserveSocPercent;
  const ctx: EnergyCtx = {
    vehicle,
    conditions,
    weather,
    originAltitudeM: samples[0]?.elevM,
    detourKwh: args.detourKwh,
  };

  const usable = args.chargers.filter((c) => {
    if (!isVerifiedForPlanning(c) || isOffline(c)) return false;
    const sIdx = c.nearestSampleIndex ?? 0;
    return sIdx > 0 && sIdx < destIdx && routeSocket(c, vehicle) != null;
  });
  const plugs = usable.map((c) => routeSocket(c, vehicle)!);
  const nodes: PlannerNode[] = usable.map((c, i) => {
    const sIdx = c.nearestSampleIndex ?? 0;
    const detourKm = c.detourKm ?? fromRouteKmOf(c) * 2;
    const detourKwh = detourEnergyKwh(ctx, detourKm, sIdx, samples, params);
    return {
      sIdx,
      detourPct: kwhToSocPct(detourKwh, cap),
      detourKm,
      detourKwh,
      detourMin: c.detourMinutes ?? detourMinutesOf(detourKm, params),
      waitMin: c.availability === "occupied" ? params.planner.occupiedWaitMin.value : 0,
      chargeMinutes: chargeMinutesTable(plugs[i]!, vehicle, cap, params),
      fast: plugs[i]!.dc,
    };
  });
  const input: PlannerInput = {
    samples,
    initialSocPct: conditions.initialSoc,
    floorPct: floor,
    destinationReservePct: destReserve,
    maxChargePct: cfg.maxChargeTargetSocPercent,
    nodes,
    objective: conditions.planningMode,
    walk: (from, start, visit) => walkSoc(samples, from, start, cap, visit, regen),
    linear: {
      spentPct: spentSocPct(samples, cap),
      fullRegenBelowPct: regen.fullBelowPct,
    },
    gridPct: params.planner.socGridPct,
    tolerancePct: tolerance,
    fastChargeBuffer: params.planner.fastChargeBuffer.value,
  };

  const now = planCharging(input);
  const pre = now.feasible ? null : requiredInitialCharge(input);
  const result = pre?.result ?? now;
  const planningSoc = pre?.startSoc ?? conditions.initialSoc;
  const full = !now.feasible && !pre ? planCharging({ ...input, initialSocPct: 100 }) : null;

  const planned = result.feasible ? result.stops : [];
  const stops: ChargeStop[] = planned.map((p, i) => {
    const charger = usable[p.node]!;
    const node = nodes[p.node]!;
    const plug = plugs[p.node]!;
    const next = planned[i + 1];
    const nextNode = next ? nodes[next.node]! : null;
    const need = requiredStartSoc(
      samples,
      node.sIdx,
      nextNode ? nextNode.sIdx : destIdx,
      cap,
      {
        arrivalTargetPct: nextNode ? floor : destReserve,
        floorPct: floor,
        extraKwh: nextNode ? nextNode.detourKwh : 0,
        tolerancePct: tolerance,
      },
      regen,
    );
    const minDepartSoc = Math.min(cfg.maxChargeTargetSocPercent, Math.max(need, p.arriveSoc));
    // Lo que se carga de más por ser carga rápida (el resto hasta el mínimo es lo necesario).
    const fastChargeExtraPct = plug.dc ? Math.max(0, p.departSoc - minDepartSoc) : 0;
    const options: ChargeChoice[] = routePlugs(charger, vehicle).map((o) => {
      const minutes = chargeTimeMinutes(
        cap,
        p.arriveSoc,
        p.departSoc,
        o.dc ? vehicle.dcMaxKw : vehicle.acMaxKw,
        o.powerKw,
        o.dc ? vehicle.chargeCurve : FLAT_CURVE,
      );
      const energyAddedKwh = ((p.departSoc - p.arriveSoc) / 100) * cap;
      return {
        mode: o.adapter ? ("adapter" as const) : o.dc ? ("direct" as const) : ("ac" as const),
        socket: o.socket,
        adapter: o.adapter ?? undefined,
        nominalKw: o.socket.powerKw,
        chargeKw: o.powerKw,
        arriveSoc: p.arriveSoc,
        minDepartSoc,
        departSoc: p.departSoc,
        energyAddedKwh,
        chargeMinutes: minutes,
        rangeGainKm: rangeFromEnergy(vehicle, energyAddedKwh),
        reachesNext: true,
      };
    });
    const chosenOption =
      options.find((o) => o.socket === plug.socket && o.chargeKw === plug.powerKw) ?? options[0]!;
    const acOpt = options.find((o) => o.mode === "ac" && o.socket !== chosenOption.socket);
    return {
      charger,
      arriveSoc: p.arriveSoc,
      departSoc: p.departSoc,
      minDepartSoc,
      chargeMinutes: chosenOption.chargeMinutes,
      energyAddedKwh: chosenOption.energyAddedKwh,
      bestSocket: plug.socket,
      adapter: plug.adapter ?? undefined,
      alternative: acOpt
        ? {
            mode: "ac" as const,
            socket: acOpt.socket,
            arriveSoc: acOpt.arriveSoc,
            minDepartSoc: acOpt.minDepartSoc,
            departSoc: acOpt.departSoc,
            energyAddedKwh: acOpt.energyAddedKwh,
            chargeKw: acOpt.chargeKw,
            chargeMinutes: acOpt.chargeMinutes,
            rangeGainKm: acOpt.rangeGainKm,
          }
        : undefined,
      options,
      rangeGainKm: chosenOption.rangeGainKm,
      kmAlongRoute: charger.nearestKm ?? samples[node.sIdx]!.km,
      fromRouteKm: fromRouteKmOf(charger),
      detourKm: node.detourKm,
      detourMinutes: node.detourMin,
      detourSource: charger.detourSource,
      detourEnergyKwh: node.detourKwh,
      chargeKw: plug.powerKw,
      kmToNext:
        (next ? (usable[next.node]!.nearestKm ?? 0) : (samples[destIdx]?.km ?? 0)) -
        (charger.nearestKm ?? 0),
      nextLabel: next ? usable[next.node]!.name : "",
      ...(fastChargeExtraPct >= 1 ? { fastChargeExtraPct } : {}),
    };
  });

  // Verificación final: la curva completa respeta el piso y la reserva (§5.9).
  let validated = result.feasible;
  if (validated) {
    const sim = simulateSoc(samples, {
      initialSocPct: planningSoc,
      capacityKwh: cap,
      events: stopEvents(samples, stops),
      regen,
    });
    validated = sim.minSoc >= floor - tolerance && sim.arrivalSoc >= destReserve - tolerance;
  }
  const verdict = classifyFeasibility({
    feasibleNow: now.feasible,
    stops: stops.length,
    feasibleWithPrecharge: pre != null,
    compatibleStations: nodes.length,
    destinationShort: (full ?? result).destinationShort,
    validated,
  });
  const firstChargerUnreachable =
    full != null && nodes.length > 0 && full.reachable.length === 0 && !full.destinationShort
      ? true
      : undefined;
  const departureCharge =
    pre && verdict.feasible
      ? {
          currentSoc: conditions.initialSoc,
          additionalPct: pre.additionalPct,
          requiredStartSoc: pre.startSoc,
          chargerId: stops[0]?.charger.id ?? "",
          chargerName: stops[0]?.charger.name ?? "",
        }
      : undefined;
  return {
    stops: verdict.feasible ? stops : [],
    feasible: verdict.feasible,
    reason: verdict.feasible
      ? undefined
      : firstChargerUnreachable
        ? FIRST_CHARGER_UNREACHABLE_REASON
        : INFEASIBILITY_TEXT[verdict.reasonCode ?? "GAP_BETWEEN_STATIONS_EXCEEDS_RANGE"],
    planningSoc,
    departureCharge,
    firstChargerUnreachable,
    feasibilityStatus: verdict.status,
    infeasibilityCode: verdict.reasonCode,
  };
}
