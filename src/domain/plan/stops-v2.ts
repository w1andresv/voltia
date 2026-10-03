import type { ModelParameters } from "../ev/core/params";
import { toTripConfiguration } from "../ev/core/trip-config";
import { kwhToSocPct } from "../ev/core/units";
import { FLAT_CURVE, chargeTimeMinutes, lerpFactor } from "../ev/engines/charging/curve";
import {
  planCharging,
  requiredInitialCharge,
  type PlannedStop,
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
  type BelowMarginReason,
  type ChargeChoice,
  type ChargeStop,
  type TripConditions,
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

/** Tiempos de carga de una estación sobre la malla de integración. */
interface ChargeTable {
  /** Minutos para cargar de `from` a `to`, con los minutos fijos de conexión (0 si no carga). */
  minutes: PlannerNode["chargeMinutes"];
  /** Minutos solo cargando, sin los de conexión. */
  chargingMinutes: (from: number, to: number) => number;
  /** SOC al que se llega cargando `min` minutos desde `from` (100 si no alcanza). */
  socAfter: (from: number, min: number) => number;
}

/**
 * Minutos de carga por estación, precalculados sobre la malla de integración:
 * la programación dinámica los consulta miles de veces.
 */
function chargeTable(
  plug: RoutePlug,
  vehicle: Vehicle,
  capacityKwh: number,
  params: ModelParameters,
): ChargeTable {
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
  const socAfter = (from: number, min: number): number => {
    if (min <= 0) return from;
    const target = at(from) + min;
    if (target >= cum[n]!) return 100;
    // cum crece: el primer tramo de la malla que llega al tiempo pedido.
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! >= target) hi = mid;
      else lo = mid;
    }
    const x = lo + (target - cum[lo]!) / (cum[hi]! - cum[lo]!);
    return Math.max(from, x * step);
  };
  return {
    minutes: (from, to) => (to > from ? at(to) - at(from) + overhead : 0),
    chargingMinutes: (from, to) => (to > from ? at(to) - at(from) : 0),
    socAfter,
  };
}

/** Pisos con que se planifica: estrictos (el margen) o flexibles (ADR-0019). */
interface Reserves {
  /** Piso duro en todo punto de la ruta. */
  floor: number;
  /** SOC mínimo al destino. */
  destReserve: number;
  /** Margen flexible: bajar del margen se permite con un costo (ver `PlannerInput.softFloor`). */
  soft?: PlannerInput["softFloor"];
}

/** Minutos que suman las paradas (carga y desvío): la ruta es la misma, el manejo no cambia. */
function stopMinutes(c: StopsChoice): number {
  return c.stops.reduce((a, s) => a + s.chargeMinutes + s.detourMinutes, 0);
}

/**
 * Margen flexible (ADR-0019): el plan que baja del margen se usa solo si es
 * claramente mejor que el que lo respeta: hace posible el viaje, evita la
 * carga antes de salir, tiene menos paradas, o con las mismas ahorra al menos
 * `minSavingMin`. En "más segura", solo si respetando el margen no hay plan.
 * Devuelve por qué conviene, o null si no conviene.
 */
function flexibleGain(
  strict: StopsChoice,
  flex: StopsChoice,
  mode: TripConditions["planningMode"],
  minSavingMin: number,
): BelowMarginReason | null {
  if (!flex.feasible) return null;
  if (!strict.feasible) return "only-way";
  if (mode === "safer") return null;
  // Ahorrarse la carga previa cuenta; pedir unos puntos menos de ella, no.
  if (!flex.departureCharge !== !strict.departureCharge) {
    return flex.departureCharge ? null : "no-precharge";
  }
  if (flex.stops.length !== strict.stops.length) {
    return flex.stops.length < strict.stops.length ? "fewer-stops" : null;
  }
  return stopMinutes(strict) - stopMinutes(flex) >= minSavingMin ? "faster" : null;
}

/**
 * Planificador v2 (F7): paradas por programación dinámica con costo
 * lexicográfico según la estrategia, carga previa sobre el mismo planificador
 * y viabilidad con códigos. Sin reglas de puntaje ni tope fijo de paradas.
 *
 * Margen flexible (ADR-0019): primero planifica respetando el margen (el piso
 * de siempre); si ese plan tiene paradas, pide carga previa o no existe,
 * planifica también dejando bajar unos puntos del margen y se queda con ese
 * solo si es claramente mejor (`flexibleGain`).
 */
export function planStopsV2(args: StopsArgs): StopsChoice {
  const { vehicle, conditions, weather, params } = args;
  const cfg = toTripConfiguration(vehicle, conditions, weather, params);
  const margin = cfg.reserveSocPercent;
  const strict = planStopsWith(args, {
    floor: conditions.allowBelowSafety ? params.planner.belowSafetyFloorPct : margin,
    destReserve: margin,
  });
  const canFlex = cfg.destinationReserveSocPercent < margin - params.planner.socTolerancePct;
  const settled = strict.feasible && !strict.departureCharge;
  if (!canFlex || (settled && (strict.stops.length === 0 || conditions.planningMode === "safer"))) {
    return strict;
  }
  const flex = planStopsWith(args, {
    floor: cfg.minimumSocPercent,
    destReserve: cfg.destinationReserveSocPercent,
    soft: { pct: margin, penaltyMinPerPct: cfg.belowMarginPenaltyMinPerPct },
  });
  const { minSavingMin } = params.planner.marginFlex.value;
  const gain = flexibleGain(strict, flex, conditions.planningMode, minSavingMin);
  return gain ? { ...flex, belowMarginReason: gain } : strict;
}

function planStopsWith(args: StopsArgs, reserves: Reserves): StopsChoice {
  const { samples, vehicle, conditions, weather, params } = args;
  const tolerance = params.planner.socTolerancePct;
  const regen = params.soc.regenAcceptance;
  const cfg = toTripConfiguration(vehicle, conditions, weather, params);
  const cap = Math.max(vehicle.batteryKwh, 1);
  const destIdx = samples.length - 1;
  const { floor, destReserve } = reserves;
  // Lo que cada parada busca respetar (lo necesario, el extra de carga rápida): el
  // piso del plan o, si el plan es flexible, el margen completo (ADR-0019).
  const aim = reserves.soft
    ? { floor: reserves.soft.pct, dest: reserves.soft.pct }
    : { floor, dest: destReserve };
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
  const tables = plugs.map((plug) => chargeTable(plug, vehicle, cap, params));
  // Sesión mínima (ADR-0018): si se para, se carga al menos estos minutos o hasta el tope.
  const minSession = params.planner.minChargeSessionMin.value;
  const stretchCap = Math.min(100, params.planner.stretchChargeSocPct.value);
  const nodes: PlannerNode[] = usable.map((c, i) => {
    const sIdx = c.nearestSampleIndex ?? 0;
    const detourKm = c.detourKm ?? fromRouteKmOf(c) * 2;
    const detourKwh = detourEnergyKwh(ctx, detourKm, sIdx, samples, params);
    const table = tables[i]!;
    return {
      sIdx,
      detourPct: kwhToSocPct(detourKwh, cap),
      detourKm,
      detourKwh,
      detourMin: c.detourMinutes ?? detourMinutesOf(detourKm, params),
      waitMin: c.availability === "occupied" ? params.planner.occupiedWaitMin.value : 0,
      chargeMinutes: table.minutes,
      fast: plugs[i]!.dc,
      ...(minSession > 0
        ? { minSessionSoc: (arrive: number) => table.socAfter(arrive, minSession) }
        : {}),
    };
  });
  const input: PlannerInput = {
    samples,
    initialSocPct: conditions.initialSoc,
    floorPct: floor,
    destinationReservePct: destReserve,
    ...(reserves.soft ? { softFloor: reserves.soft } : {}),
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

  /**
   * SOC de salida que la parada `i` necesita para que la ruta sea viable: llegar
   * a la siguiente sobre el piso (con su desvío) o al destino con el margen. Sin
   * el extra de carga rápida ni la sesión mínima, que son conveniencia. En el
   * plan flexible se mide contra el margen completo: si baja de él a propósito
   * (ADR-0019), sale con menos que esto.
   */
  const neededDepart = (planned: PlannedStop[], i: number): number => {
    const p = planned[i]!;
    const next = planned[i + 1];
    const nextNode = next ? nodes[next.node]! : null;
    const need = requiredStartSoc(
      samples,
      nodes[p.node]!.sIdx,
      nextNode ? nextNode.sIdx : destIdx,
      cap,
      {
        arrivalTargetPct: nextNode ? aim.floor : aim.dest,
        floorPct: aim.floor,
        extraKwh: nextNode ? nextNode.detourKwh : 0,
        tolerancePct: tolerance,
      },
      regen,
    );
    return Math.max(need, p.arriveSoc);
  };
  /** Parada marginal (ADR-0018): cargar solo lo necesario toma menos que la sesión mínima. */
  const isMarginal = (planned: PlannedStop[], i: number): boolean => {
    const p = planned[i]!;
    return (
      tables[p.node]!.chargingMinutes(p.arriveSoc, neededDepart(planned, i)) < minSession - 1e-9
    );
  };

  let now = planCharging(input);
  let pre = now.feasible ? null : requiredInitialCharge(input);
  let result = pre?.result ?? now;
  // Por qué alguna parada sale por encima del tope en ruta (ADR-0018), si pasa.
  let stretched: NonNullable<ChargeStop["aboveRouteCap"]> | null = null;
  // Sin ningún plan con el tope normal, ni cargando antes de salir: el tope estirado
  // es la única forma de hacer el viaje. También deja que la pasada 2 vuelva a
  // verificar, solo con sus estaciones, un plan que ya salía por encima del tope.
  if (!result.feasible && stretchCap > input.maxChargePct) {
    const wide = { ...input, stretchChargePct: stretchCap };
    const wideNow = planCharging(wide);
    const widePre = wideNow.feasible ? null : requiredInitialCharge(wide);
    const wideResult = widePre?.result ?? wideNow;
    if (wideResult.feasible) {
      now = wideNow;
      pre = widePre;
      result = wideResult;
      stretched = "only-way";
    }
  }
  const planningSoc = pre?.startSoc ?? conditions.initialSoc;
  const full = !now.feasible && !pre ? planCharging({ ...input, initialSocPct: 100 }) : null;

  // Tope estirado (ADR-0018): si alguna parada carga poco, se vuelve a planificar
  // dejando salir hasta `stretchCap`; ese plan solo se acepta si tiene menos paradas.
  // La programación dinámica ya revisa el piso en toda la ruta y la reserva al destino.
  if (
    !stretched &&
    result.feasible &&
    stretchCap > input.maxChargePct &&
    result.stops.some((_, i) => isMarginal(result.stops, i))
  ) {
    const alt = planCharging({
      ...input,
      initialSocPct: planningSoc,
      stretchChargePct: stretchCap,
    });
    if (alt.feasible && alt.stops.length < result.stops.length) {
      result = alt;
      stretched = "fewer-stops";
    }
  }

  // Carga antes de salir (ADR-0018): si la primera parada es marginal, con cuántos
  // puntos más al salir el plan no la necesita. Es una sugerencia: el SOC actual es un dato real.
  let skipFirstStop: StopsChoice["skipFirstStop"];
  const first = !pre && result.feasible ? result.stops[0] : undefined;
  if (first && isMarginal(result.stops, 0)) {
    const needPts = neededDepart(result.stops, 0) - first.arriveSoc;
    const fromAdd = Math.max(1, Math.floor(needPts - nodes[first.node]!.detourPct));
    for (let add = fromAdd; add <= Math.ceil(needPts) + 3; add++) {
      const startSoc = conditions.initialSoc + add;
      if (startSoc > 100 + tolerance) break;
      const alt = planCharging({
        ...input,
        initialSocPct: Math.min(100, startSoc),
        ...(stretched ? { stretchChargePct: stretchCap } : {}),
      });
      if (
        alt.feasible &&
        alt.stops.length < result.stops.length &&
        !alt.stops.some((s) => s.node === first.node)
      ) {
        skipFirstStop = {
          additionalPct: add,
          startSoc: Math.min(100, startSoc),
          chargerName: usable[first.node]!.name,
        };
        break;
      }
    }
  }

  const planned = result.feasible ? result.stops : [];
  const bufferCfg = params.planner.fastChargeBuffer.value;
  const bufferCap = Math.min(bufferCfg.maxSocPct, input.maxChargePct);
  const stops: ChargeStop[] = planned.map((p, i) => {
    const charger = usable[p.node]!;
    const node = nodes[p.node]!;
    const plug = plugs[p.node]!;
    const next = planned[i + 1];
    const nextNode = next ? nodes[next.node]! : null;
    const needed = neededDepart(planned, i);
    const minDepartSoc = Math.min(p.departSoc, needed);
    // Margen flexible (ADR-0019): sale con menos de lo que pide el margen completo.
    const belowMarginNext = needed > p.departSoc + tolerance;
    const extraPct = Math.max(0, p.departSoc - minDepartSoc);
    // Por qué se carga más que lo necesario: la sesión mínima o el extra de carga rápida.
    const sessionSoc = Math.min(input.maxChargePct, node.minSessionSoc?.(p.arriveSoc) ?? 0);
    const bufferSoc =
      plug.dc && nextNode && bufferCfg.extraPct > 0 && p.departSoc < bufferCap - tolerance
        ? requiredStartSoc(
            samples,
            node.sIdx,
            nextNode.sIdx,
            cap,
            {
              arrivalTargetPct: aim.floor + bufferCfg.extraPct,
              floorPct: aim.floor + bufferCfg.extraPct,
              extraKwh: nextNode.detourKwh,
              tolerancePct: tolerance,
            },
            regen,
          )
        : 0;
    const bySession = sessionSoc > minDepartSoc + tolerance && sessionSoc >= bufferSoc;
    const sessionExtraPct = bySession ? extraPct : 0;
    // Lo que se carga de más por ser carga rápida (el resto hasta el mínimo es lo necesario).
    const fastChargeExtraPct = plug.dc && !bySession ? extraPct : 0;
    const aboveRouteCap =
      stretched && p.departSoc > input.maxChargePct + tolerance ? stretched : undefined;
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
      ...(sessionExtraPct >= 1 ? { sessionExtraPct } : {}),
      ...(aboveRouteCap ? { aboveRouteCap } : {}),
      ...(belowMarginNext ? { belowMarginNext } : {}),
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
    ...(skipFirstStop && verdict.feasible ? { skipFirstStop } : {}),
    firstChargerUnreachable,
    feasibilityStatus: verdict.status,
    infeasibilityCode: verdict.reasonCode,
  };
}
