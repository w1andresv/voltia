import { compareByHierarchy } from "./road-hierarchy";
import { chargeTimeMinutes, effectiveChargeKw, isDc, routePlugs, routeSocket } from "./charging";
import {
  STYLE_SPEED_FACTOR,
  annotateEnergy,
  energyBetween,
  energyMode,
  segmentEnergyKwh,
} from "./energy";
import { haversineKm } from "./geo";
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
  RouteSample,
  TripConditions,
  Vehicle,
  WeatherSnapshot,
} from "./types";
import {
  extraWeightKg,
  FIRST_CHARGER_UNREACHABLE_REASON,
  isVerifiedForPlanning,
  NO_VERIFIED_STOP_REASON,
  safetyPct,
} from "./types";

const MAX_STOPS = 7;
const PREFERRED_FROM_ROUTE_KM = 5;
const MAX_FROM_ROUTE_KM = 12;
const MIN_PROGRESS_KM = 4;
const DETOUR_SPEED_KMH = 50;
const FLAT_CURVE = [
  { soc: 0, powerFactor: 1 },
  { soc: 100, powerFactor: 1 },
];

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

export function attachChargersToRoute(
  chargers: Charger[],
  samples: { lat: number; lon: number; km: number }[],
): Charger[] {
  return chargers
    .filter((c) => isVerifiedForPlanning(c))
    .map((c) => {
      let nearestKm = 0;
      let nearestSampleIndex = 0;
      let min = Infinity;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]!;
        const d = haversineKm(c, s);
        if (d < min) {
          min = d;
          nearestKm = s.km;
          nearestSampleIndex = i;
        }
      }
      return { ...c, detourKm: min * 2, fromRouteKm: min, nearestKm, nearestSampleIndex };
    })
    .filter((c) => (c.fromRouteKm ?? 99) <= MAX_FROM_ROUTE_KM)
    .sort((a, b) => (a.nearestKm ?? 0) - (b.nearestKm ?? 0));
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

function neededDepartSoc(args: {
  samples: RouteSample[];
  fromIdx: number;
  destIdx: number;
  arrivalTarget: number;
  capacity: number;
  detourKwh: number;
}): number {
  const e = energyBetween(args.samples, args.fromIdx, args.destIdx) + args.detourKwh;
  return args.arrivalTarget + (e / args.capacity) * 100;
}

interface Candidate {
  charger: Charger;
  arriveSoc: number;
  socket: ChargerSocket;
  adapter: { from: ConnectorType; to: ConnectorType } | null;
  socketKw: number;
  sIdx: number;
  fromRouteKm: number;
  detourKwh: number;
}

function arriveAt(
  charger: Charger,
  fromIdx: number,
  soc: number,
  samples: RouteSample[],
  cap: number,
  ctx: EnergyCtx,
): { arrive: number; detourKwh: number; sIdx: number } | null {
  const sIdx = charger.nearestSampleIndex ?? 0;
  if (sIdx <= fromIdx) return null;
  const detourKwh = segmentEnergyKwh(charger.detourKm ?? 0, 0, DETOUR_SPEED_KMH, ctx, soc, {
    altitudeM: samples[sIdx]?.elevM,
  });
  const e = energyBetween(samples, fromIdx, sIdx) + detourKwh;
  return { arrive: socAfter(soc, e, cap), detourKwh, sIdx };
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
  if (cand.charger.source === "osm") s -= 2;
  return s;
}

function unreachable(): { stops: ChargeStop[]; feasible: boolean; reason: string } {
  return { stops: [], feasible: false, reason: NO_VERIFIED_STOP_REASON };
}

function pickStops(args: {
  samples: RouteSample[];
  chargers: Charger[];
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
}): { stops: ChargeStop[]; feasible: boolean; reason?: string } {
  const { samples, vehicle, conditions, weather } = args;
  const safety = safetyPct(conditions);
  const arrivalTarget = Math.max(conditions.arrivalSoc, safety);
  const cap = Math.max(vehicle.batteryKwh, 1);
  const destIdx = samples.length - 1;
  const maxTravel = Math.min(100, vehicle.maxSocTravel);
  const ctx: EnergyCtx = { vehicle, conditions, weather, originAltitudeM: samples[0]?.elevM };
  const floor = conditions.allowBelowSafety ? 2 : safety;
  // 0: llegar justo a la electrolinera. Con "bajar del margen" se mantiene el 2 %.
  const reachFloor = conditions.allowBelowSafety ? 2 : 0;
  const destKm = samples[destIdx]?.km ?? 0;

  let idx = 0;
  let soc = conditions.initialSoc;
  const stops: ChargeStop[] = [];

  const energyToDest = energyBetween(samples, 0, destIdx);
  if (socAfter(soc, energyToDest, cap) >= arrivalTarget) {
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

  const canReachDestFrom = (fromIdx: number, fromSoc: number, extraKwh = 0) =>
    socAfter(fromSoc, energyBetween(samples, fromIdx, destIdx) + extraKwh, cap) >= arrivalTarget;

  const continuationOk = (fromIdx: number, fromSoc: number, skipId: string) => {
    if (canReachDestFrom(fromIdx, fromSoc)) return true;
    for (const ch of usable) {
      if (ch.id === skipId) continue;
      if (stops.some((s) => s.charger.id === ch.id)) continue;
      const hit = arriveAt(ch, fromIdx, fromSoc, samples, cap, ctx);
      if (hit && hit.arrive >= floor) return true;
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
      if (!hit || hit.arrive < minArrive) continue;
      out.push({
        charger: ch,
        arriveSoc: hit.arrive,
        socket: plug.socket,
        adapter: plug.adapter,
        socketKw: effectiveChargeKw(plug.socket, vehicle),
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
      (c) => isDc(c.socket.connector) && continuationOk(c.sIdx, maxTravel, c.charger.id),
    );
    if (fastOk.length) pool = fastOk;
    else {
      const slowOk = pool.filter(
        (c) => !isDc(c.socket.connector) && continuationOk(c.sIdx, maxTravel, c.charger.id),
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
      if (!hit || hit.arrive < 2) continue;
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
      fromIdx: pick.sIdx,
      destIdx: nextIdx,
      arrivalTarget: reserve,
      capacity: cap,
      detourKwh: detour,
    });
    return Math.min(maxTravel, Math.max(need, pick.arriveSoc + 1));
  };

  const chooseDepart = (pick: Candidate): number => {
    if (!isDc(pick.socket.connector)) return minimumDepart(pick);

    const destNeed = neededDepartSoc({
      samples,
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
      if (!hit || hit.arrive < floor) continue;
      const plug = routeSocket(ch, vehicle);
      if (!plug) continue;
      const cand: Candidate = {
        charger: ch,
        arriveSoc: hit.arrive,
        socket: plug.socket,
        adapter: plug.adapter,
        socketKw: effectiveChargeKw(plug.socket, vehicle),
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
    const slow = !isDc(pick.socket.connector);
    let chargeTo = chooseDepart(pick);
    if (!slow) {
      chargeTo = Math.min(100, Math.max(chargeTo, pick.arriveSoc + 8));
      if (
        chargeTo > maxTravel &&
        neededDepartSoc({
          samples,
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
        const acMode = !isDc(plug.socket.connector);
        const leave = acMode ? minDepartSoc : chargeTo;
        const chargeKw = effectiveChargeKw(plug.socket, vehicle);
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
      chargeKw: chosen.chargeKw,
      kmToNext: 0,
      nextLabel: "",
    });

    idx = pick.sIdx;
    soc = chosen.departSoc;
  }

  const finalSoc = socAfter(soc, energyBetween(samples, idx, destIdx), cap);
  if (finalSoc < arrivalTarget && !conditions.allowBelowSafety) {
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

function applyStopsToSamples(
  base: RouteSample[],
  stops: ChargeStop[],
  vehicle: Vehicle,
  initialSoc: number,
): RouteSample[] {
  const cap = vehicle.batteryKwh;
  const ordered = [...stops].sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
  return base.map((s) => {
    let added = 0;
    for (const st of ordered) {
      if (s.km + 0.05 >= st.kmAlongRoute) added += st.energyAddedKwh;
    }
    const soc = initialSoc - ((s.cumulativeKwh - added) / cap) * 100;
    return { ...s, soc };
  });
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

const ARRIVE_TOLERANCE = 1e-4;

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
  const additionalPct = Math.ceil(socNeededToArrive - currentSoc - 1e-6);
  const requiredStartSoc = currentSoc + additionalPct;
  if (requiredStartSoc > 100 + 1e-6) return { kind: "impossible" };
  return { kind: "precharge", additionalPct, requiredStartSoc };
}

type BareSample = Parameters<typeof annotateEnergy>[0][number];

/**
 * Primera electrolinera verificada y usable a la que el vehículo puede llegar
 * con menos batería. El consumo es el del tramo (ruta + desvío), no una distancia fija.
 */
function assessFirstCharger(args: {
  samplesPre: BareSample[];
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
  const { samplesPre, vehicle, conditions, weather } = args;
  if (samplesPre.length < 2) return { kind: "skip" };

  const cap = Math.max(vehicle.batteryKwh, 1);
  const destIdx = samplesPre.length - 1;
  const arrivalTarget = Math.max(conditions.arrivalSoc, safetyPct(conditions));
  const energyCtx: EnergyCtx = {
    vehicle,
    conditions,
    weather,
    originAltitudeM: samplesPre[0]?.elevM,
  };
  const usable = args.chargers.filter((c) => {
    if (!isVerifiedForPlanning(c)) return false;
    if (!routeSocket(c, vehicle)) return false;
    const sIdx = c.nearestSampleIndex ?? 0;
    return sIdx > 0 && sIdx < destIdx;
  });

  const cache = new Map<number, RouteSample[]>();
  const samplesAt = (soc: number) => {
    const key = Math.round(soc * 1000) / 1000;
    let hit = cache.get(key);
    if (!hit) {
      hit = annotateEnergy(samplesPre, energyCtx, soc);
      cache.set(key, hit);
    }
    return hit;
  };

  const currentSamples = samplesAt(conditions.initialSoc);
  const destSoc = socAfter(conditions.initialSoc, energyBetween(currentSamples, 0, destIdx), cap);
  if (destSoc >= arrivalTarget || !usable.length) return { kind: "skip" };

  // Igual que pickStops: primero exigir el margen de seguridad al llegar a la
  // primera electrolinera; solo se baja a "llega justo" si ni al 100 % cabe.
  const safety = safetyPct(conditions);
  const floor = conditions.allowBelowSafety ? 2 : safety;
  const reachFloor = conditions.allowBelowSafety ? 2 : 0;

  const reachableCharger = (soc: number, minArrive: number): Charger | null => {
    const samples = samplesAt(soc);
    let best: Charger | null = null;
    let bestKm = Infinity;
    for (const charger of usable) {
      const hit = arriveAt(charger, 0, soc, samples, cap, energyCtx);
      if (!hit || hit.arrive < minArrive - ARRIVE_TOLERANCE) continue;
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

  const maxAdd = Math.floor(100 - current + 1e-9);
  let additional = Math.max(1, maxAdd);
  if (current + maxAdd < 100 - 1e-6) {
    additional = Math.ceil(100 - current - 1e-9);
  } else {
    let low = 1;
    let high = Math.max(1, maxAdd);
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (mid >= 1 && reaches(current + mid, minArrive)) {
        additional = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
  }

  const decision = classifyFirstChargerCharge(current, current + additional);
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

export function buildPlan(args: {
  raw: RawRoute;
  vehicle: Vehicle;
  conditions: TripConditions;
  chargers: Charger[];
  weather: WeatherSnapshot | null;
  origin: Place;
  destination: Place;
}): RoutePlan {
  const { raw, vehicle, conditions, weather, origin, destination } = args;
  const safety = safetyPct(conditions);
  const ctx = { vehicle, conditions, weather, originAltitudeM: raw.samples[0]?.elevM };

  const styleSpeed = STYLE_SPEED_FACTOR[conditions.drivingStyle];
  const samplesPre = raw.samples.map((s) => ({
    ...s,
    speedKmh: hasFixedSpeed(conditions)
      ? (conditions.avgSpeedKmh as number)
      : s.speedKmh * styleSpeed,
  }));

  const attached = attachChargersToRoute(args.chargers, samplesPre);
  const gate = assessFirstCharger({
    samplesPre,
    chargers: attached,
    vehicle,
    conditions,
    weather,
  });
  const planningSoc = gate.kind === "precharge" ? gate.requiredStartSoc : conditions.initialSoc;
  const planningConditions =
    planningSoc === conditions.initialSoc ? conditions : { ...conditions, initialSoc: planningSoc };
  const energySamples = annotateEnergy(samplesPre, ctx, planningSoc);
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
  const stops = picked.stops.map((st) => ({
    ...st,
    nextLabel: st.nextLabel || destination.label,
  }));
  const feasible = picked.feasible;
  const reason = picked.reason;

  const samples = applyStopsToSamples(energySamples, stops, vehicle, planningSoc);
  const last = samples[samples.length - 1]!;
  const energyGrossKwh = samples.reduce((a, s) => a + s.energyGrossKwh, 0);
  const energyRegenKwh = samples.reduce((a, s) => a + s.energyRegenKwh, 0);
  const driveMin = driveMinutesFor(raw, conditions);
  const chargeMin = stops.reduce((a, s) => a + s.chargeMinutes, 0);
  const detourKm = stops.reduce((a, s) => a + (s.detourKm ?? 0), 0);
  const detourMin = stops.reduce((a, s) => a + (s.detourMinutes ?? 0), 0);
  const arrivalSoc = last.soc;
  const minSoc = samples.reduce((m, s) => Math.min(m, s.soc), 100);
  const remainingKwh = Math.max(0, (arrivalSoc / 100) * vehicle.batteryKwh);
  const canArriveWithoutCharge =
    stops.length === 0 && arrivalSoc >= Math.max(conditions.arrivalSoc, safety);

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
    energyKwh: last.cumulativeKwh,
    energyGrossKwh,
    energyRegenKwh,
    avgKwhPer100km: raw.distanceKm > 0 ? (last.cumulativeKwh / raw.distanceKm) * 100 : 0,
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
    firstChargerUnreachable: gate.kind === "impossible" ? true : undefined,
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
