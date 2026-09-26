import { compareByHierarchy } from "./road-hierarchy";
import { FLAT_CURVE, chargeTimeMinutes, lerpFactor } from "./ev/engines/charging/curve";
import { routePlugs, routeSocket, uncarriedAdapterPlugs, type RoutePlug } from "./ev/engines/compatibility/engine";
import { planCharging, requiredInitialCharge, type PlannerInput, type PlannerNode } from "./ev/engines/charging/planner";
import { classifyFeasibility, type FeasibilityStatus, type InfeasibilityReason } from "./ev/engines/feasibility/engine";
import { toTripConfiguration } from "./ev/core/trip-config";
import { kwhToSocPct } from "./ev/core/units";
import { placeOnRoute } from "./ev/engines/corridor/engine";
import { STYLE_SPEED_FACTOR, annotateEnergy, energyMode, segmentEnergyKwh } from "./energy";
import type { EnergySample } from "./ev/contracts/energy";
import type { SocEvent } from "./ev/contracts/soc";
import { legSoc, requiredStartSoc, simulateSoc, walkSoc } from "./ev/engines/soc/simulate";
import type {
  ChargeChoice,
  ChargeStop,
  Charger,
  ChargerSocket,
  ConnectorType,
  ItineraryNode,
  Place,
  RawRoute,
  RoutePlan,
  TripConditions,
  Vehicle,
  WeatherSnapshot,
} from "./types";
import {
  extraWeightKg,
  FIRST_CHARGER_UNREACHABLE_REASON,
  isVerifiedForPlanning,
  INFEASIBILITY_TEXT,
  NO_VERIFIED_STOP_REASON,
} from "./types";
import { MODEL_PARAMETERS } from "./ev/core/params";
import { socFloors } from "./ev/core/trip-config";

// Umbrales del planificador: viven en ModelParameters (valores sin cambios).
const MAX_STOPS = MODEL_PARAMETERS.planner.maxStops;
const PREFERRED_FROM_ROUTE_KM = MODEL_PARAMETERS.corridor.preferredFromRouteKm;
export const MAX_FROM_ROUTE_KM = MODEL_PARAMETERS.corridor.maxFromRouteKm;
const MIN_PROGRESS_KM = MODEL_PARAMETERS.planner.minProgressKm;
const DETOUR_SPEED_KMH = MODEL_PARAMETERS.planner.detourSpeedKmh;
/**
 * Margen para comparar SOC calculados: una salida calculada para llegar justo al
 * objetivo puede dar 19,999… al restar el tramo por redondeo de punto flotante.
 */
const ARRIVE_TOLERANCE = MODEL_PARAMETERS.planner.socTolerancePct;

function rangeFromEnergy(vehicle: Vehicle, kwh: number): number {
  if (!(vehicle.batteryKwh > 0)) return 0;
  return (kwh / vehicle.batteryKwh) * vehicle.rangeKm;
}



type EnergyCtx = {
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
  originAltitudeM?: number;
};

/** Estaciones verificadas ubicadas sobre la ruta por el corredor (D7). */
function placeChargers(chargers: Charger[], samples: { lat: number; lon: number; km: number }[]): Charger[] {
  return placeOnRoute(
    chargers.filter((c) => isVerifiedForPlanning(c)),
    samples,
    { maxKm: MAX_FROM_ROUTE_KM, detourRoadFactor: MODEL_PARAMETERS.corridor.detourRoadFactor.value },
  );
}

function socAfter(soc: number, energyKwh: number, capacity: number): number {
  return soc - (energyKwh / capacity) * 100;
}

function fromRouteKmOf(c: Charger): number {
  if (Number.isFinite(c.fromRouteKm)) return c.fromRouteKm as number;
  if (Number.isFinite(c.detourKm)) return (c.detourKm as number) / 2;
  return 99;
}

function isOffline(c: Charger): boolean {
  return c.availability === "offline" || c.available === false;
}

function detourMinutesOf(km: number): number {
  if (km <= 0.05) return 0;
  return (km / DETOUR_SPEED_KMH) * 60;
}

/** SOC más bajo en el tramo por la vía, saliendo de fromIdx con fromSoc (C1). */
function lowestSocOnLeg(
  samples: EnergySample[],
  fromIdx: number,
  toIdx: number,
  fromSoc: number,
  capacity: number,
): number {
  return legSoc(samples, fromIdx, toIdx, fromSoc, capacity).lowestSoc;
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
}): number {
  return requiredStartSoc(args.samples, args.fromIdx, args.destIdx, args.capacity, {
    arrivalTargetPct: args.arrivalTarget,
    floorPct: args.floorPct,
    extraKwh: args.detourKwh,
    tolerancePct: ARRIVE_TOLERANCE,
  });
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
): { arrive: number; lowest: number; detourKwh: number; sIdx: number } | null {
  const sIdx = charger.nearestSampleIndex ?? 0;
  if (sIdx <= fromIdx) return null;
  const detourKwh = segmentEnergyKwh(charger.detourKm ?? 0, 0, DETOUR_SPEED_KMH, ctx, {
    altitudeM: samples[sIdx]?.elevM,
  });
  const leg = legSoc(samples, fromIdx, sIdx, soc, cap);
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
}): { stops: ChargeStop[]; feasible: boolean; reason?: string } {
  const { samples, vehicle, conditions, weather } = args;
  const { reservePct: safety, arrivalTargetPct: arrivalTarget } = socFloors(vehicle, conditions);
  const cap = Math.max(vehicle.batteryKwh, 1);
  const destIdx = samples.length - 1;
  const maxTravel = Math.min(100, vehicle.maxSocTravel);
  const ctx: EnergyCtx = { vehicle, conditions, weather, originAltitudeM: samples[0]?.elevM };
  const floor = conditions.allowBelowSafety ? MODEL_PARAMETERS.planner.belowSafetyFloorPct : safety;
  // 0: llegar justo a la electrolinera. Con "bajar del margen" se mantiene el 2 %.
  const reachFloor = conditions.allowBelowSafety ? MODEL_PARAMETERS.planner.belowSafetyFloorPct : 0;
  const destKm = samples[destIdx]?.km ?? 0;

  let idx = 0;
  let soc = conditions.initialSoc;
  const stops: ChargeStop[] = [];

  // Llega al destino con el objetivo y sin bajar del piso en ningún punto (C1).
  const canReachDestFrom = (fromIdx: number, fromSoc: number, extraKwh = 0) => {
    const leg = legSoc(samples, fromIdx, destIdx, fromSoc, cap);
    return (
      socAfter(leg.endSoc, extraKwh, cap) >= arrivalTarget - ARRIVE_TOLERANCE &&
      leg.lowestSoc >= floor - ARRIVE_TOLERANCE
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
      const hit = arriveAt(ch, fromIdx, fromSoc, samples, cap, ctx);
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
      if ((ch.nearestKm ?? 0) < currentKm + MIN_PROGRESS_KM) continue;
      const plug = routeSocket(ch, vehicle);
      if (!plug) continue;
      const hit = arriveAt(ch, fromIdx, fromSoc, samples, cap, ctx);
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
    const close = pool.filter((c) => c.fromRouteKm <= PREFERRED_FROM_ROUTE_KM);
    const closeCont = close.filter((c) => continuationOk(c.sIdx, maxTravel, c.charger.id));
    if (closeCont.length) pool = closeCont;
    else {
      const cont = pool.filter((c) => continuationOk(c.sIdx, maxTravel, c.charger.id));
      if (cont.length) pool = cont;
      else if (close.length) pool = close;
    }
    const fastOk = pool.filter(
      (c) => c.dc && continuationOk(c.sIdx, maxTravel, c.charger.id),
    );
    if (fastOk.length) pool = fastOk;
    else {
      const slowOk = pool.filter(
        (c) => !c.dc && continuationOk(c.sIdx, maxTravel, c.charger.id),
      );
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
      const hit = arriveAt(ch, pick.sIdx, maxTravel, samples, cap, ctx);
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
      const hit = arriveAt(ch, pick.sIdx, maxTravel, samples, cap, ctx);
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

  while (stops.length < MAX_STOPS) {
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
          mode: plug.adapter ? ("adapter" as const) : acMode ? ("ac" as const) : ("direct" as const),
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
      detourMinutes: detourMinutesOf(detourKm),
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
 * Cargas y desvíos como eventos del SOCEngine (C2): el desvío resta al llegar al
 * cargador y la carga suma después. La muestra de la parada es la primera en su km.
 */
function stopEvents(samples: EnergySample[], stops: ChargeStop[]): SocEvent[] {
  const events: SocEvent[] = [];
  for (const st of stops) {
    const atIndex = samples.findIndex((s) => s.km + 0.05 >= st.kmAlongRoute);
    if (atIndex < 0) continue;
    if (st.detourEnergyKwh) events.push({ atIndex, energyKwh: -st.detourEnergyKwh });
    events.push({ atIndex, energyKwh: st.energyAddedKwh });
  }
  return events;
}

function hasFixedSpeed(conditions: TripConditions): boolean {
  return Boolean(conditions.avgSpeedKmh && conditions.avgSpeedKmh > 10);
}

/**
 * Tiempo de manejo: con velocidad media fijada por el usuario, esa manda (el
 * estilo ya no la cambia); si no, el de la ruta ajustado por el estilo.
 */
function driveMinutesFor(raw: RawRoute, conditions: TripConditions): number {
  if (hasFixedSpeed(conditions)) {
    return (raw.distanceKm / (conditions.avgSpeedKmh as number)) * 60;
  }
  return raw.driveMinutes / STYLE_SPEED_FACTOR[conditions.drivingStyle];
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
}):
  | { kind: "skip" }
  | { kind: "impossible" }
  | {
      kind: "precharge";
      additionalPct: number;
      requiredStartSoc: number;
      charger: Charger;
    } {
  const { samples, vehicle, conditions, weather } = args;
  if (samples.length < 2) return { kind: "skip" };

  const cap = Math.max(vehicle.batteryKwh, 1);
  const destIdx = samples.length - 1;
  const { reservePct: safety, arrivalTargetPct: arrivalTarget } = socFloors(vehicle, conditions);
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
  const floor = conditions.allowBelowSafety ? MODEL_PARAMETERS.planner.belowSafetyFloorPct : safety;
  const reachFloor = conditions.allowBelowSafety ? MODEL_PARAMETERS.planner.belowSafetyFloorPct : 0;

  // El perfil de energía no depende del SOC: se evalúa con cualquier SOC de salida (F3).
  const toDest = legSoc(samples, 0, destIdx, conditions.initialSoc, cap);
  const destLowest = lowestSocOnLeg(samples, 0, destIdx, conditions.initialSoc, cap);
  const destOk = toDest.endSoc >= arrivalTarget && destLowest >= floor - ARRIVE_TOLERANCE;
  if (destOk || !usable.length) return { kind: "skip" };

  const reachableCharger = (soc: number, minArrive: number): Charger | null => {
    let best: Charger | null = null;
    let bestKm = Infinity;
    for (const charger of usable) {
      const hit = arriveAt(charger, 0, soc, samples, cap, energyCtx);
      if (!hit || hit.lowest < minArrive - ARRIVE_TOLERANCE) continue;
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

interface StopsChoice {
  stops: ChargeStop[];
  feasible: boolean;
  reason?: string;
  planningSoc: number;
  departureCharge?: RoutePlan["departureCharge"];
  firstChargerUnreachable?: boolean;
  feasibilityStatus?: FeasibilityStatus;
  infeasibilityCode?: InfeasibilityReason;
}

type StopsArgs = {
  samples: EnergySample[];
  chargers: Charger[];
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
};

/** Planificador actual: carga previa hasta la primera estación y paradas por puntaje. */
function planStopsLegacy(args: StopsArgs): StopsChoice {
  const { samples: energySamples, chargers: attached, vehicle, conditions, weather } = args;
  const gate = assessFirstCharger({
    samples: energySamples,
    chargers: attached,
    vehicle,
    conditions,
    weather,
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


/**
 * Minutos de carga por estación, precalculados sobre la malla de integración:
 * la programación dinámica los consulta miles de veces.
 */
function chargeMinutesTable(plug: RoutePlug, vehicle: Vehicle, capacityKwh: number): PlannerNode["chargeMinutes"] {
  const step = MODEL_PARAMETERS.charging.integrationStepPct;
  const overhead = MODEL_PARAMETERS.charging.connectionOverheadMin.value;
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
function planStopsV2(args: StopsArgs): StopsChoice {
  const { samples, vehicle, conditions, weather } = args;
  const cfg = toTripConfiguration(vehicle, conditions, weather);
  const cap = Math.max(vehicle.batteryKwh, 1);
  const destIdx = samples.length - 1;
  const floor = cfg.minimumSocPercent;
  // Con "permitir bajar del margen" el destino pide lo que eligió el usuario, sin subirlo a la reserva.
  const destReserve = conditions.allowBelowSafety
    ? Math.max(conditions.arrivalSoc, floor)
    : cfg.destinationReserveSocPercent;
  const ctx: EnergyCtx = { vehicle, conditions, weather, originAltitudeM: samples[0]?.elevM };

  const usable = args.chargers.filter((c) => {
    if (!isVerifiedForPlanning(c) || isOffline(c)) return false;
    const sIdx = c.nearestSampleIndex ?? 0;
    return sIdx > 0 && sIdx < destIdx && routeSocket(c, vehicle) != null;
  });
  const plugs = usable.map((c) => routeSocket(c, vehicle)!);
  const nodes: PlannerNode[] = usable.map((c, i) => {
    const sIdx = c.nearestSampleIndex ?? 0;
    const detourKm = c.detourKm ?? fromRouteKmOf(c) * 2;
    const detourKwh = segmentEnergyKwh(detourKm, 0, DETOUR_SPEED_KMH, ctx, { altitudeM: samples[sIdx]?.elevM });
    return {
      sIdx,
      detourPct: kwhToSocPct(detourKwh, cap),
      detourKm,
      detourKwh,
      detourMin: detourMinutesOf(detourKm),
      waitMin: c.availability === "occupied" ? MODEL_PARAMETERS.planner.occupiedWaitMin.value : 0,
      chargeMinutes: chargeMinutesTable(plugs[i]!, vehicle, cap),
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
    walk: (from, start, visit) => walkSoc(samples, from, start, cap, visit),
    gridPct: MODEL_PARAMETERS.planner.socGridPct,
    tolerancePct: ARRIVE_TOLERANCE,
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
    const need = requiredStartSoc(samples, node.sIdx, nextNode ? nextNode.sIdx : destIdx, cap, {
      arrivalTargetPct: nextNode ? floor : destReserve,
      floorPct: floor,
      extraKwh: nextNode ? nextNode.detourKwh : 0,
      tolerancePct: ARRIVE_TOLERANCE,
    });
    const minDepartSoc = Math.min(cfg.maxChargeTargetSocPercent, Math.max(need, p.arriveSoc));
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
    const chosenOption = options.find((o) => o.socket === plug.socket && o.chargeKw === plug.powerKw) ?? options[0]!;
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
      detourEnergyKwh: node.detourKwh,
      chargeKw: plug.powerKw,
      kmToNext: (next ? (usable[next.node]!.nearestKm ?? 0) : (samples[destIdx]?.km ?? 0)) - (charger.nearestKm ?? 0),
      nextLabel: next ? usable[next.node]!.name : "",
    };
  });

  // Verificación final: la curva completa respeta el piso y la reserva (§5.9).
  let validated = result.feasible;
  if (validated) {
    const sim = simulateSoc(samples, { initialSocPct: planningSoc, capacityKwh: cap, events: stopEvents(samples, stops) });
    validated = sim.minSoc >= floor - ARRIVE_TOLERANCE && sim.arrivalSoc >= destReserve - ARRIVE_TOLERANCE;
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
    full != null && nodes.length > 0 && full.reachable.length === 0 && !full.destinationShort ? true : undefined;
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
/** Minutos de esta carga (llegada → salida) con una forma de cargar. */
function plugMinutes(plug: RoutePlug, vehicle: Vehicle, cap: number, from: number, to: number): number {
  return chargeTimeMinutes(
    cap,
    from,
    to,
    plug.dc ? vehicle.dcMaxKw : vehicle.acMaxKw,
    plug.powerKw,
    plug.dc ? vehicle.chargeCurve : FLAT_CURVE,
  );
}

/**
 * Si la estación tiene carga rápida con otro conector: qué adaptador hace falta,
 * si el usuario lo lleva, y el tiempo de la misma carga con y sin él.
 */
function adapterSummary(stop: ChargeStop, vehicle: Vehicle, cap: number): ChargeStop["adapterNeeded"] {
  const plugs = routePlugs(stop.charger, vehicle);
  const without = plugs.filter((p) => !p.adapter);
  const bestWithout = without.length ? without.reduce((a, b) => (b.powerKw > a.powerKw ? b : a)) : null;
  const withoutAdapter = bestWithout
    ? {
        mode: bestWithout.dc ? ("direct" as const) : ("ac" as const),
        chargeKw: bestWithout.powerKw,
        chargeMinutes: plugMinutes(bestWithout, vehicle, cap, stop.arriveSoc, stop.departSoc),
      }
    : null;
  // Lo lleva y el plan lo usa.
  if (stop.adapter) {
    return {
      from: stop.adapter.from,
      to: stop.adapter.to,
      carried: true,
      withAdapter: { chargeKw: stop.chargeKw, chargeMinutes: stop.chargeMinutes },
      withoutAdapter,
    };
  }
  // No lo lleva: la carga rápida con adaptador más potente, si supera a lo que usa el plan.
  const fast = uncarriedAdapterPlugs(stop.charger, vehicle);
  if (!fast.length) return undefined;
  const best = fast.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
  if (best.powerKw <= stop.chargeKw) return undefined;
  return {
    from: best.adapter!.from,
    to: best.adapter!.to,
    carried: false,
    withAdapter: { chargeKw: best.powerKw, chargeMinutes: plugMinutes(best, vehicle, cap, stop.arriveSoc, stop.departSoc) },
    withoutAdapter,
  };
}

export function buildPlan(args: {
  raw: RawRoute;
  vehicle: Vehicle;
  conditions: TripConditions;
  chargers: Charger[];
  weather: WeatherSnapshot | null;
  origin: Place;
  destination: Place;
  /** Planificador de paradas: el actual (por defecto) o el v2 por programación dinámica (F7). */
  engine?: "legacy" | "v2";
}): RoutePlan {
  const { raw, vehicle, conditions, weather, origin, destination } = args;
  const { reservePct: safety, arrivalTargetPct } = socFloors(vehicle, conditions);
  const ctx = { vehicle, conditions, weather, originAltitudeM: raw.samples[0]?.elevM };

  const styleSpeed = STYLE_SPEED_FACTOR[conditions.drivingStyle];
  const samplesPre = raw.samples.map((s) => ({
    ...s,
    speedKmh: hasFixedSpeed(conditions)
      ? (conditions.avgSpeedKmh as number)
      : s.speedKmh * styleSpeed,
  }));

  const attached = placeChargers(args.chargers, samplesPre);
  // Perfil de energía una sola vez, sin SOC (F3): sirve para cualquier SOC de salida.
  const energySamples = annotateEnergy(samplesPre, ctx);
  const cap = Math.max(vehicle.batteryKwh, 1);
  const chosen =
    args.engine === "v2"
      ? planStopsV2({ samples: energySamples, chargers: attached, vehicle, conditions, weather })
      : planStopsLegacy({ samples: energySamples, chargers: attached, vehicle, conditions, weather });
  const { planningSoc, departureCharge, feasible, reason } = chosen;
  const stops = chosen.stops.map((st) => ({
    ...st,
    nextLabel: st.nextLabel || destination.label,
    adapterNeeded: adapterSummary(st, vehicle, cap),
  }));

  // La curva de batería sale del SOCEngine: regeneración recortada según el SOC
  // real, y desvíos y cargas como eventos (C2, C6).
  const sim = simulateSoc(energySamples, {
    initialSocPct: planningSoc,
    capacityKwh: cap,
    events: stopEvents(energySamples, stops),
  });
  const samples = sim.samples;
  const last = samples[samples.length - 1]!;
  const detourKwh = stops.reduce((a, s) => a + (s.detourEnergyKwh ?? 0), 0);
  const energyKwh = last.cumulativeKwh + detourKwh;
  const energyGrossKwh = samples.reduce((a, s) => a + s.energyGrossKwh, 0) + detourKwh;
  const energyRegenKwh = samples.reduce((a, s) => a + s.energyRegenKwh, 0);
  const driveMin = driveMinutesFor(raw, conditions);
  const chargeMin = stops.reduce((a, s) => a + s.chargeMinutes, 0);
  const detourKm = stops.reduce((a, s) => a + (s.detourKm ?? 0), 0);
  const detourMin = stops.reduce((a, s) => a + (s.detourMinutes ?? 0), 0);
  const arrivalSoc = last.soc;
  // El punto más bajo puede ser la llegada a un cargador (la curva muestra la salida).
  const minSoc = sim.minSoc;
  const remainingKwh = Math.max(0, (arrivalSoc / 100) * vehicle.batteryKwh);
  const canArriveWithoutCharge =
    stops.length === 0 &&
    arrivalSoc >= arrivalTargetPct - ARRIVE_TOLERANCE &&
    minSoc >= safety - ARRIVE_TOLERANCE;

  const itinerary: ItineraryNode[] = [
    {
      kind: "origin",
      label: origin.label,
      km: 0,
      soc: planningSoc,
      durationFromStartMin: 0,
      place: origin,
    },
  ];

  let accDrive = 0;
  let prevKm = 0;
  for (const stop of stops) {
    const dKm = stop.kmAlongRoute - prevKm;
    accDrive += (dKm / raw.distanceKm) * driveMin;
    itinerary.push({
      kind: "charger",
      label: stop.charger.name,
      km: stop.kmAlongRoute,
      soc: stop.arriveSoc,
      durationFromStartMin: accDrive,
      charge: stop,
    });
    accDrive += stop.chargeMinutes + stop.detourMinutes;
    prevKm = stop.kmAlongRoute;
  }
  itinerary.push({
    kind: "destination",
    label: destination.label,
    km: raw.distanceKm,
    soc: arrivalSoc,
    durationFromStartMin: driveMin + chargeMin + detourMin,
    place: destination,
  });

  return {
    id: raw.id,
    label: raw.label,
    via: raw.via,
    noTolls: raw.noTolls,
    roadMix: raw.roadMix,
    hierarchyFactor: raw.hierarchyFactor,
    withinTolerance: raw.withinTolerance,
    minorRoadScore: raw.minorRoadScore,
    engine: raw.engine,
    geometry: raw.geometry,
    samples,
    // Distancia de la ruta (comparable con Google Maps); el desvío hasta los
    // cargadores va aparte, y sí cuenta en tiempo y energía.
    distanceKm: raw.distanceKm,
    detourKm,
    driveMinutes: driveMin + detourMin,
    chargeMinutes: chargeMin,
    totalMinutes: driveMin + chargeMin + detourMin,
    energyKwh,
    energyGrossKwh,
    energyRegenKwh,
    regenCurtailedKwh: sim.curtailedRegenKwh,
    avgKwhPer100km:
      raw.distanceKm + detourKm > 0 ? (energyKwh / (raw.distanceKm + detourKm)) * 100 : 0,
    energyMode: energyMode(vehicle),
    arrivalSoc,
    initialSoc: planningSoc,
    remainingKwh,
    minSoc,
    safetyPct: safety,
    safetyMarginPct: arrivalSoc - safety,
    canArriveWithoutCharge,
    feasible,
    infeasibleReason: reason,
    departureCharge,
    firstChargerUnreachable: chosen.firstChargerUnreachable,
    planner: args.engine === "v2" ? "v2" : "legacy",
    feasibilityStatus: chosen.feasibilityStatus,
    infeasibilityCode: chosen.infeasibilityCode,
    stops,
    itinerary,
    elevation: raw.elevation,
    weather,
  };
}

/**
 * Tiempo "efectivo" para comparar rutas: el total, más el recargo por usar vías
 * de menor jerarquía (secundarias, terciarias, locales) fuera de los accesos.
 * Así una ruta no gana solo porque un atajo por vías menores ahorra minutos.
 */
export function effectiveMinutes(
  p: Pick<RoutePlan, "totalMinutes" | "driveMinutes" | "hierarchyFactor">,
): number {
  return p.totalMinutes + p.driveMinutes * Math.max(0, (p.hierarchyFactor ?? 1) - 1);
}

export function rankPlans(plans: RoutePlan[], mode: TripConditions["planningMode"]): RoutePlan[] {
  const copy = [...plans];
  // Jerarquía vial primero (menos km por vías menores), luego el criterio de la
  // estrategia: así ninguna estrategia elige un atajo por vías secundarias o
  // terciarias si hay una alternativa razonable por vías principales.
  const byHierarchy = (a: RoutePlan, b: RoutePlan, then: number) =>
    compareByHierarchy(
      { minorScore: a.minorRoadScore, cost: then },
      { minorScore: b.minorRoadScore, cost: 0 },
    );
  copy.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    // Fuera de la tolerancia (+15 % tiempo / +10 % km): solo si no hay otra.
    const ta = a.withinTolerance !== false;
    const tb = b.withinTolerance !== false;
    if (ta !== tb) return ta ? -1 : 1;
    switch (mode) {
      case "efficient":
        return byHierarchy(a, b, a.energyKwh - b.energyKwh);
      case "fewer_stops":
        // En esta estrategia, las paradas mandan; la jerarquía desempata.
        return (
          a.stops.length - b.stops.length ||
          byHierarchy(a, b, effectiveMinutes(a) - effectiveMinutes(b))
        );
      case "safer":
        return byHierarchy(a, b, b.minSoc - a.minSoc || b.arrivalSoc - a.arrivalSoc);
      case "fastest":
      case "custom":
      default:
        return byHierarchy(a, b, effectiveMinutes(a) - effectiveMinutes(b));
    }
  });
  return copy;
}

export function extraMassLabel(c: TripConditions): string {
  const kg = extraWeightKg(c);
  return `+${kg} kg`;
}
