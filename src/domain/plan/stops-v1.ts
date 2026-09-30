import type { ModelParameters } from "../ev/core/params";
import { routeChargeCapPct, socFloors } from "../ev/core/trip-config";
import type { EnergySample } from "../ev/contracts/energy";
import type { RegenAcceptance } from "../ev/contracts/soc";
import { chargeTimeMinutes, FLAT_CURVE } from "../ev/engines/charging/curve";
import { routePlugs, routeSocket } from "../ev/engines/compatibility/engine";
import { legSoc, requiredStartSoc } from "../ev/engines/soc/simulate";
import {
  FIRST_CHARGER_UNREACHABLE_REASON,
  isVerifiedForPlanning,
  NO_VERIFIED_STOP_REASON,
  type ChargeChoice,
  type ChargeStop,
  type Charger,
  type ChargerSocket,
  type ConnectorType,
  type TripConditions,
  type Vehicle,
  type WeatherSnapshot,
} from "../types";
import {
  detourEnergyKwh,
  detourMinutesOf,
  fromRouteKmOf,
  isOffline,
  rangeFromEnergy,
  socAfter,
  type DetourEnergy,
  type EnergyCtx,
  type StopsArgs,
  type StopsChoice,
} from "./shared";

/**
 * Planificador v1: carga previa hasta la primera estación alcanzable y paradas
 * elegidas por puntaje (desvío, potencia, llegada, disponibilidad).
 */

/** SOC más bajo en el tramo por la vía, saliendo de fromIdx con fromSoc (C1). */
function lowestSocOnLeg(
  samples: EnergySample[],
  fromIdx: number,
  toIdx: number,
  fromSoc: number,
  capacity: number,
  regen: RegenAcceptance,
): number {
  return legSoc(samples, fromIdx, toIdx, fromSoc, capacity, regen).lowestSoc;
}

/**
 * SOC de salida para llegar con arrivalTarget (después del desvío) y, además,
 * no bajar de floorPct en ningún punto del tramo. Lo calcula el SOCEngine, que
 * recorta la regeneración si la batería va casi llena (F3).
 */
function neededDepartSoc(args: {
  samples: EnergySample[];
  fromIdx: number;
  destIdx: number;
  arrivalTarget: number;
  floorPct: number;
  capacity: number;
  detourKwh: number;
  params: ModelParameters;
}): number {
  return requiredStartSoc(
    args.samples,
    args.fromIdx,
    args.destIdx,
    args.capacity,
    {
      arrivalTargetPct: args.arrivalTarget,
      floorPct: args.floorPct,
      extraKwh: args.detourKwh,
      tolerancePct: args.params.planner.socTolerancePct,
    },
    args.params.soc.regenAcceptance,
  );
}

interface Candidate {
  charger: Charger;
  arriveSoc: number;
  socket: ChargerSocket;
  adapter: { from: ConnectorType; to: ConnectorType } | null;
  socketKw: number;
  /** Carga rápida (DC) o lenta (AC). */
  dc: boolean;
  sIdx: number;
  fromRouteKm: number;
  detourKwh: number;
}

function arriveAt(
  charger: Charger,
  fromIdx: number,
  soc: number,
  samples: EnergySample[],
  cap: number,
  ctx: EnergyCtx,
  params: ModelParameters,
): { arrive: number; lowest: number; detourKwh: number; sIdx: number } | null {
  const sIdx = charger.nearestSampleIndex ?? 0;
  if (sIdx <= fromIdx) return null;
  const detourKwh = detourEnergyKwh(ctx, charger.detourKm ?? 0, sIdx, samples, params);
  const leg = legSoc(samples, fromIdx, sIdx, soc, cap, params.soc.regenAcceptance);
  const arrive = socAfter(leg.endSoc, detourKwh, cap);
  // El mínimo del tramo: por la vía hasta el cargador, o la llegada tras el desvío.
  const lowest = Math.min(arrive, leg.lowestSoc);
  return { arrive, lowest, detourKwh, sIdx };
}

function scoreCharger(
  cand: Candidate,
  mode: TripConditions["planningMode"],
  safety: number,
): number {
  const detour = cand.fromRouteKm;
  const power = cand.socketKw;
  const arrive = cand.arriveSoc;
  const modeDetour = mode === "efficient" ? 10 : mode === "fastest" ? 3.2 : 5.5;
  let s = detour * modeDetour;
  s += Math.max(0, 250 - power) * 0.08;
  s += Math.max(0, arrive - 36) * 2.1;
  s += Math.max(0, safety + 6 - arrive) * 4;
  if (power < 40) s += 48;
  else if (power < 50) s += 22;
  else if (power < 100) s += 8;
  if (isOffline(cand.charger)) s += 90;
  if (cand.charger.availability === "occupied") s += 14;
  if (cand.charger.availability === "available") s -= 6;
  const price = cand.charger.pricePerKwh?.amount;
  if (price && price > 0) s += Math.min(18, price * 0.35);
  if (cand.charger.source === "plugshare") s -= 4;
  if (cand.charger.source === "siveeic") s -= 3;
  if (cand.charger.source === "osm") s -= 2;
  return s;
}

function unreachable(): { stops: ChargeStop[]; feasible: boolean; reason: string } {
  return { stops: [], feasible: false, reason: NO_VERIFIED_STOP_REASON };
}

function pickStops(args: {
  samples: EnergySample[];
  chargers: Charger[];
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
  detourKwh?: DetourEnergy;
  params: ModelParameters;
}): { stops: ChargeStop[]; feasible: boolean; reason?: string } {
  const { samples, vehicle, conditions, weather, params } = args;
  const tolerance = params.planner.socTolerancePct;
  const { reservePct: safety, arrivalTargetPct: arrivalTarget } = socFloors(conditions);
  const cap = Math.max(vehicle.batteryKwh, 1);
  const destIdx = samples.length - 1;
  const maxTravel = routeChargeCapPct(params);
  const ctx: EnergyCtx = {
    vehicle,
    conditions,
    weather,
    originAltitudeM: samples[0]?.elevM,
    detourKwh: args.detourKwh,
  };
  const floor = conditions.allowBelowSafety ? params.planner.belowSafetyFloorPct : safety;
  // 0: llegar justo a la electrolinera. Con "bajar del margen" se mantiene el 2 %.
  const reachFloor = conditions.allowBelowSafety ? params.planner.belowSafetyFloorPct : 0;
  const destKm = samples[destIdx]?.km ?? 0;

  let idx = 0;
  let soc = conditions.initialSoc;
  const stops: ChargeStop[] = [];

  // Llega al destino con el objetivo y sin bajar del piso en ningún punto (C1).
  const canReachDestFrom = (fromIdx: number, fromSoc: number, extraKwh = 0) => {
    const leg = legSoc(samples, fromIdx, destIdx, fromSoc, cap, params.soc.regenAcceptance);
    return (
      socAfter(leg.endSoc, extraKwh, cap) >= arrivalTarget - tolerance &&
      leg.lowestSoc >= floor - tolerance
    );
  };

  if (canReachDestFrom(0, soc)) {
    return { stops: [], feasible: true };
  }

  const usable = args.chargers.filter((c) => {
    if (!isVerifiedForPlanning(c)) return false;
    if (!routeSocket(c, vehicle)) return false;
    const sIdx = c.nearestSampleIndex ?? 0;
    return sIdx > 0 && sIdx < destIdx;
  });

  if (!usable.length) {
    return conditions.allowBelowSafety
      ? { stops: [], feasible: true, reason: NO_VERIFIED_STOP_REASON }
      : unreachable();
  }

  const continuationOk = (fromIdx: number, fromSoc: number, skipId: string) => {
    if (canReachDestFrom(fromIdx, fromSoc)) return true;
    for (const ch of usable) {
      if (ch.id === skipId) continue;
      if (stops.some((s) => s.charger.id === ch.id)) continue;
      const hit = arriveAt(ch, fromIdx, fromSoc, samples, cap, ctx, params);
      if (hit && hit.lowest >= floor) return true;
    }
    return false;
  };

  const collect = (
    fromIdx: number,
    fromSoc: number,
    currentKm: number,
    minArrive: number,
  ): Candidate[] => {
    const out: Candidate[] = [];
    for (const ch of usable) {
      if (stops.some((s) => s.charger.id === ch.id)) continue;
      if ((ch.nearestKm ?? 0) < currentKm + params.planner.minProgressKm) continue;
      const plug = routeSocket(ch, vehicle);
      if (!plug) continue;
      const hit = arriveAt(ch, fromIdx, fromSoc, samples, cap, ctx, params);
      if (!hit || hit.lowest < minArrive) continue;
      out.push({
        charger: ch,
        arriveSoc: hit.arrive,
        socket: plug.socket,
        adapter: plug.adapter,
        socketKw: plug.powerKw,
        dc: plug.dc,
        sIdx: hit.sIdx,
        fromRouteKm: fromRouteKmOf(ch),
        detourKwh: hit.detourKwh,
      });
    }
    return out;
  };

  const narrow = (list: Candidate[]): Candidate[] => {
    if (!list.length) return list;
    let pool = list;
    const live = pool.filter((c) => !isOffline(c.charger));
    if (live.length) pool = live;
    const close = pool.filter((c) => c.fromRouteKm <= params.corridor.preferredFromRouteKm);
    const closeCont = close.filter((c) => continuationOk(c.sIdx, maxTravel, c.charger.id));
    if (closeCont.length) pool = closeCont;
    else {
      const cont = pool.filter((c) => continuationOk(c.sIdx, maxTravel, c.charger.id));
      if (cont.length) pool = cont;
      else if (close.length) pool = close;
    }
    const fastOk = pool.filter((c) => c.dc && continuationOk(c.sIdx, maxTravel, c.charger.id));
    if (fastOk.length) pool = fastOk;
    else {
      const slowOk = pool.filter((c) => !c.dc && continuationOk(c.sIdx, maxTravel, c.charger.id));
      if (slowOk.length) pool = slowOk;
    }
    if (conditions.planningMode !== "fewer_stops") {
      const windowed = pool.filter((c) => c.arriveSoc <= 40);
      if (windowed.length) pool = windowed;
    }
    return pool;
  };

  const minimumDepart = (pick: Candidate): number => {
    let nextIdx = destIdx;
    let detour = pick.detourKwh;
    let reserve = arrivalTarget;
    let nearest = Infinity;
    for (const ch of usable) {
      if (ch.id === pick.charger.id) continue;
      if (stops.some((s) => s.charger.id === ch.id)) continue;
      const hit = arriveAt(ch, pick.sIdx, maxTravel, samples, cap, ctx, params);
      if (!hit || hit.lowest < 2) continue;
      const km = ch.nearestKm ?? Infinity;
      if (km < nearest) {
        nearest = km;
        nextIdx = hit.sIdx;
        detour = pick.detourKwh + hit.detourKwh;
        reserve = safety;
      }
    }
    const need = neededDepartSoc({
      params,
      samples,
      floorPct: floor,
      fromIdx: pick.sIdx,
      destIdx: nextIdx,
      arrivalTarget: reserve,
      capacity: cap,
      detourKwh: detour,
    });
    return Math.min(maxTravel, Math.max(need, pick.arriveSoc + 1));
  };

  const chooseDepart = (pick: Candidate): number => {
    if (!pick.dc) return minimumDepart(pick);

    const destNeed = neededDepartSoc({
      params,
      samples,
      floorPct: floor,
      fromIdx: pick.sIdx,
      destIdx,
      arrivalTarget,
      capacity: cap,
      detourKwh: pick.detourKwh,
    });
    const minBump = pick.arriveSoc + 8;
    const taperCap = Math.min(maxTravel, 90);
    const hardCap = maxTravel;

    if (destNeed <= taperCap) {
      let extra = 4;
      if (conditions.planningMode === "safer") extra = 8;
      if (conditions.planningMode === "fastest") extra = 2;
      if (conditions.planningMode === "fewer_stops") {
        return Math.min(hardCap, Math.max(destNeed, 80, minBump));
      }
      return Math.min(taperCap, Math.max(destNeed + extra, minBump));
    }

    if (conditions.planningMode === "fewer_stops" || conditions.planningMode === "safer") {
      return Math.min(
        hardCap,
        Math.max(minBump, destNeed, conditions.planningMode === "safer" ? 70 : 80),
      );
    }

    let nextNeed = destNeed;
    let bestNext: Candidate | null = null;
    let bestScore = Infinity;
    for (const ch of usable) {
      if (ch.id === pick.charger.id) continue;
      if (stops.some((s) => s.charger.id === ch.id)) continue;
      const hit = arriveAt(ch, pick.sIdx, maxTravel, samples, cap, ctx, params);
      if (!hit || hit.lowest < floor) continue;
      const plug = routeSocket(ch, vehicle);
      if (!plug) continue;
      const cand: Candidate = {
        charger: ch,
        arriveSoc: hit.arrive,
        socket: plug.socket,
        adapter: plug.adapter,
        socketKw: plug.powerKw,
        dc: plug.dc,
        sIdx: hit.sIdx,
        fromRouteKm: fromRouteKmOf(ch),
        detourKwh: hit.detourKwh,
      };
      const sc =
        scoreCharger(cand, conditions.planningMode, safety) - (hit.sIdx - pick.sIdx) * 0.02;
      if (sc < bestScore) {
        bestScore = sc;
        bestNext = cand;
      }
    }
    if (bestNext) {
      nextNeed = neededDepartSoc({
        params,
        samples,
        floorPct: floor,
        fromIdx: pick.sIdx,
        destIdx: bestNext.sIdx,
        arrivalTarget: safety,
        capacity: cap,
        detourKwh: pick.detourKwh + bestNext.detourKwh,
      });
    }
    const extra = conditions.planningMode === "fastest" ? 2 : 4;
    const floorCharge =
      conditions.planningMode === "fastest" ? Math.max(minBump, pick.arriveSoc + 12) : minBump;
    return Math.min(hardCap, Math.max(nextNeed + extra, floorCharge));
  };

  while (stops.length < params.planner.maxStops) {
    if (canReachDestFrom(idx, soc)) break;

    const currentKm = samples[idx]?.km ?? 0;
    // Primero el margen de seguridad. Si ningún cargador cabe ahí, se usa el
    // que sí se alcanza (aunque se llegue justo): es el punto y la carga a mostrar.
    let raw = collect(idx, soc, currentKm, floor);
    if (!raw.length && floor > reachFloor) raw = collect(idx, soc, currentKm, reachFloor);
    if (!raw.length) {
      if (conditions.allowBelowSafety) {
        return { stops, feasible: true, reason: NO_VERIFIED_STOP_REASON };
      }
      return { stops, feasible: false, reason: NO_VERIFIED_STOP_REASON };
    }

    const pool = narrow(raw);
    pool.sort((a, b) => {
      if (conditions.planningMode === "fewer_stops") {
        return (
          b.sIdx - a.sIdx ||
          scoreCharger(a, conditions.planningMode, safety) -
            scoreCharger(b, conditions.planningMode, safety)
        );
      }
      return (
        scoreCharger(a, conditions.planningMode, safety) -
        scoreCharger(b, conditions.planningMode, safety)
      );
    });

    const pick = pool[0]!;
    const slow = !pick.dc;
    let chargeTo = chooseDepart(pick);
    if (!slow) {
      chargeTo = Math.min(100, Math.max(chargeTo, pick.arriveSoc + 8));
      if (
        chargeTo > maxTravel &&
        neededDepartSoc({
          params,
          samples,
          floorPct: floor,
          fromIdx: pick.sIdx,
          destIdx,
          arrivalTarget,
          capacity: cap,
          detourKwh: pick.detourKwh,
        }) <=
          maxTravel + 1
      ) {
        chargeTo = maxTravel;
      }
      if (
        !continuationOk(pick.sIdx, chargeTo, pick.charger.id) &&
        continuationOk(pick.sIdx, maxTravel, pick.charger.id)
      ) {
        chargeTo = maxTravel;
      }
    }

    const minDepartSoc = minimumDepart(pick);
    const reachesNext = continuationOk(pick.sIdx, maxTravel, pick.charger.id);
    const options: ChargeChoice[] = routePlugs(pick.charger, vehicle)
      .map((plug) => {
        const acMode = !plug.dc;
        const leave = acMode ? minDepartSoc : chargeTo;
        const chargeKw = plug.powerKw;
        const energyAddedKwh = Math.max(0, ((leave - pick.arriveSoc) / 100) * cap);
        return {
          mode: plug.adapter
            ? ("adapter" as const)
            : acMode
              ? ("ac" as const)
              : ("direct" as const),
          socket: plug.socket,
          adapter: plug.adapter ?? undefined,
          nominalKw: plug.socket.powerKw,
          chargeKw,
          arriveSoc: pick.arriveSoc,
          minDepartSoc,
          departSoc: leave,
          energyAddedKwh,
          chargeMinutes: chargeTimeMinutes(
            cap,
            pick.arriveSoc,
            leave,
            acMode ? vehicle.acMaxKw : vehicle.dcMaxKw,
            chargeKw,
            acMode ? FLAT_CURVE : vehicle.chargeCurve,
          ),
          rangeGainKm: rangeFromEnergy(vehicle, energyAddedKwh),
          reachesNext,
        };
      })
      .sort((a, b) => {
        if (a.reachesNext !== b.reachesNext) return a.reachesNext ? -1 : 1;
        if (b.chargeKw !== a.chargeKw) return b.chargeKw - a.chargeKw;
        const rank = { direct: 0, adapter: 1, ac: 2 };
        return rank[a.mode] - rank[b.mode];
      });
    const chosen = options[0] ?? {
      socket: pick.socket,
      adapter: pick.adapter ?? undefined,
      chargeKw: pick.socketKw,
      arriveSoc: pick.arriveSoc,
      minDepartSoc,
      departSoc: chargeTo,
      energyAddedKwh: ((chargeTo - pick.arriveSoc) / 100) * cap,
      chargeMinutes: chargeTimeMinutes(
        cap,
        pick.arriveSoc,
        chargeTo,
        slow ? vehicle.acMaxKw : vehicle.dcMaxKw,
        pick.socketKw,
        slow ? FLAT_CURVE : vehicle.chargeCurve,
      ),
      rangeGainKm: 0,
    };
    const acOpt = options.find((o) => o.mode === "ac" && o.socket !== chosen.socket);
    const detourKm = pick.charger.detourKm ?? pick.fromRouteKm * 2;

    stops.push({
      charger: pick.charger,
      arriveSoc: chosen.arriveSoc,
      departSoc: chosen.departSoc,
      minDepartSoc: chosen.minDepartSoc,
      chargeMinutes: chosen.chargeMinutes,
      energyAddedKwh: chosen.energyAddedKwh,
      bestSocket: chosen.socket,
      adapter: chosen.adapter,
      alternative: acOpt
        ? {
            mode: "ac",
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
      rangeGainKm: chosen.rangeGainKm || rangeFromEnergy(vehicle, chosen.energyAddedKwh),
      kmAlongRoute: pick.charger.nearestKm ?? samples[pick.sIdx]!.km,
      fromRouteKm: pick.fromRouteKm,
      detourKm,
      detourMinutes: pick.charger.detourMinutes ?? detourMinutesOf(detourKm, params),
      detourSource: pick.charger.detourSource,
      detourEnergyKwh: pick.detourKwh,
      chargeKw: chosen.chargeKw,
      kmToNext: 0,
      nextLabel: "",
    });

    idx = pick.sIdx;
    soc = chosen.departSoc;
  }

  if (!canReachDestFrom(idx, soc) && !conditions.allowBelowSafety) {
    return {
      stops,
      feasible: false,
      reason: NO_VERIFIED_STOP_REASON,
    };
  }

  const labeled = stops.map((st, i) => {
    const next = stops[i + 1];
    return {
      ...st,
      kmToNext: (next ? next.kmAlongRoute : destKm) - st.kmAlongRoute,
      nextLabel: next ? next.charger.name : "",
    };
  });
  return { stops: labeled, feasible: true };
}

/**
 * SOC de salida mínimo (en puntos enteros sobre la batería actual) para llegar
 * a una electrolinera. `socNeededToArrive` sale del consumo del tramo.
 */
export function classifyFirstChargerCharge(
  currentSoc: number,
  socNeededToArrive: number,
):
  | { kind: "enough" }
  | { kind: "precharge"; additionalPct: number; requiredStartSoc: number }
  | { kind: "impossible" } {
  if (!(socNeededToArrive > currentSoc + 1e-6)) return { kind: "enough" };
  if (socNeededToArrive > 100 + 1e-6) return { kind: "impossible" };
  // Puntos enteros hacia arriba para mostrar; el SOC de salida no pasa de 100
  // (con 20,5 % y 100 % necesario: +80 puntos, salida al 100 %) (C5).
  const additionalPct = Math.ceil(socNeededToArrive - currentSoc - 1e-6);
  const requiredStartSoc = Math.min(100, currentSoc + additionalPct);
  return { kind: "precharge", additionalPct, requiredStartSoc };
}

/**
 * Primera electrolinera verificada y usable a la que el vehículo puede llegar
 * con menos batería. El consumo es el del tramo (ruta + desvío), no una distancia fija.
 */
function assessFirstCharger(args: {
  samples: EnergySample[];
  chargers: Charger[];
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
  params: ModelParameters;
}):
  | { kind: "skip" }
  | { kind: "impossible" }
  | {
      kind: "precharge";
      additionalPct: number;
      requiredStartSoc: number;
      charger: Charger;
    } {
  const { samples, vehicle, conditions, weather, params } = args;
  if (samples.length < 2) return { kind: "skip" };
  const tolerance = params.planner.socTolerancePct;
  const regen = params.soc.regenAcceptance;

  const cap = Math.max(vehicle.batteryKwh, 1);
  const destIdx = samples.length - 1;
  const { reservePct: safety, arrivalTargetPct: arrivalTarget } = socFloors(conditions);
  const energyCtx: EnergyCtx = {
    vehicle,
    conditions,
    weather,
    originAltitudeM: samples[0]?.elevM,
  };
  const usable = args.chargers.filter((c) => {
    if (!isVerifiedForPlanning(c)) return false;
    if (!routeSocket(c, vehicle)) return false;
    const sIdx = c.nearestSampleIndex ?? 0;
    return sIdx > 0 && sIdx < destIdx;
  });

  // Igual que pickStops: primero exigir el margen de seguridad al llegar a la
  // primera electrolinera; solo se baja a "llega justo" si ni al 100 % cabe.
  const floor = conditions.allowBelowSafety ? params.planner.belowSafetyFloorPct : safety;
  const reachFloor = conditions.allowBelowSafety ? params.planner.belowSafetyFloorPct : 0;

  // El perfil de energía no depende del SOC: se evalúa con cualquier SOC de salida (F3).
  const toDest = legSoc(samples, 0, destIdx, conditions.initialSoc, cap, regen);
  const destLowest = lowestSocOnLeg(samples, 0, destIdx, conditions.initialSoc, cap, regen);
  const destOk = toDest.endSoc >= arrivalTarget && destLowest >= floor - tolerance;
  if (destOk || !usable.length) return { kind: "skip" };

  const reachableCharger = (soc: number, minArrive: number): Charger | null => {
    let best: Charger | null = null;
    let bestKm = Infinity;
    for (const charger of usable) {
      const hit = arriveAt(charger, 0, soc, samples, cap, energyCtx, params);
      if (!hit || hit.lowest < minArrive - tolerance) continue;
      const km = charger.nearestKm ?? Infinity;
      if (km < bestKm) {
        bestKm = km;
        best = charger;
      }
    }
    return best;
  };

  const reaches = (soc: number, minArrive: number) => reachableCharger(soc, minArrive) != null;
  const current = conditions.initialSoc;
  let minArrive = floor;
  if (!reaches(100, minArrive) && floor > reachFloor) minArrive = reachFloor;
  if (reaches(current, minArrive)) return { kind: "skip" };
  if (!reaches(100, minArrive)) return { kind: "impossible" };

  // Búsqueda binaria del menor número entero de puntos a cargar. El último
  // escalón se recorta a 100 %, que ya se sabe que alcanza (C5).
  const startWith = (add: number) => Math.min(100, current + add);
  const maxAdd = Math.max(1, Math.ceil(100 - current - 1e-9));
  let additional = maxAdd;
  let low = 1;
  let high = maxAdd;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (reaches(startWith(mid), minArrive)) {
      additional = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  const decision = classifyFirstChargerCharge(current, startWith(additional));
  if (decision.kind !== "precharge") return { kind: "impossible" };
  const charger = reachableCharger(decision.requiredStartSoc, minArrive);
  if (!charger) return { kind: "impossible" };
  return {
    kind: "precharge",
    additionalPct: decision.additionalPct,
    requiredStartSoc: decision.requiredStartSoc,
    charger,
  };
}

/** Planificador actual: carga previa hasta la primera estación y paradas por puntaje. */
export function planStopsLegacy(args: StopsArgs): StopsChoice {
  const { samples: energySamples, chargers: attached, vehicle, conditions, weather, params } = args;
  const gate = assessFirstCharger({
    samples: energySamples,
    chargers: attached,
    vehicle,
    conditions,
    weather,
    params,
  });
  const planningSoc = gate.kind === "precharge" ? gate.requiredStartSoc : conditions.initialSoc;
  const planningConditions =
    planningSoc === conditions.initialSoc ? conditions : { ...conditions, initialSoc: planningSoc };
  const picked =
    gate.kind === "impossible"
      ? { stops: [] as ChargeStop[], feasible: false, reason: FIRST_CHARGER_UNREACHABLE_REASON }
      : pickStops({
          samples: energySamples,
          chargers: attached,
          vehicle,
          conditions: planningConditions,
          weather,
          detourKwh: args.detourKwh,
          params,
        });
  const departureCharge =
    gate.kind === "precharge"
      ? {
          currentSoc: conditions.initialSoc,
          additionalPct: gate.additionalPct,
          requiredStartSoc: gate.requiredStartSoc,
          chargerId: gate.charger.id,
          chargerName: gate.charger.name,
        }
      : undefined;
  return {
    stops: picked.stops,
    feasible: picked.feasible,
    reason: picked.reason,
    planningSoc,
    departureCharge,
    firstChargerUnreachable: gate.kind === "impossible" ? true : undefined,
  };
}
