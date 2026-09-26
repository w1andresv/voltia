import { describe, expect, it } from "vitest";
import { annotateEnergy, energyBetween } from "./energy";
import { buildPlan, classifyFirstChargerCharge, rankPlans } from "./planner";
import { DEFAULT_CURVE } from "./charging";
import {
  departureChargeAdvice,
  FIRST_CHARGER_UNREACHABLE_REASON,
  NO_VERIFIED_STOP_REASON,
  safetyPct,
} from "./types";
import type { Charger, Place, RawRoute, TripConditions, Vehicle } from "./types";

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "v1",
    brand: "Test",
    model: "EV",
    year: 2024,
    version: "base",
    batteryKwh: 60,
    rangeKm: 400,
    consumptionKwhPer100km: null,
    weightKg: 1800,
    motorKw: 150,
    acMaxKw: 11,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2", "type2"],
    minSocRecommended: 10,
    maxSocTravel: 90,
    ...overrides,
  };
}

function conditions(overrides: Partial<TripConditions> = {}): TripConditions {
  return {
    passengers: 1,
    luggageKg: 0,
    initialSoc: 90,
    arrivalSoc: 20,
    avgSpeedKmh: 90,
    ac: "normal",
    temperatureC: 20,
    drivingStyle: "normal",
    safetyMode: "normal",
    customSafetyPct: 15,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenLevel: "medium",
    ...overrides,
  };
}

/** Straight line north from (4,-74) for `distanceKm`, one sample per stepKm. */
function straightRoute(distanceKm: number, stepKm = 10): RawRoute {
  const n = Math.round(distanceKm / stepKm) + 1;
  const samples = Array.from({ length: n }, (_, i) => {
    const km = Math.min(distanceKm, i * stepKm);
    return {
      km,
      lat: 4 + km / 111, // ~111 km por grado de latitud
      lon: -74,
      elevM: 0,
      slopePct: 0,
      speedKmh: 90,
    };
  });
  return {
    id: "r1",
    label: "Ruta recta",
    geometry: samples.map((s) => ({ lat: s.lat, lon: s.lon })),
    samples,
    distanceKm,
    driveMinutes: (distanceKm / 90) * 60,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

function chargerAt(km: number, overrides: Partial<Charger> = {}): Charger {
  return {
    id: `chg-${km}`,
    name: `Cargador km ${km}`,
    lat: 4 + km / 111,
    lon: -74,
    sockets: [{ connector: "ccs2", powerKw: 150, count: 2 }],
    source: "osm",
    ...overrides,
  };
}

const ORIGIN: Place = { label: "Origen", lat: 4, lon: -74 };
const DESTINATION_100: Place = { label: "Destino", lat: 4 + 100 / 111, lon: -74 };

describe("buildPlan — cargador por debajo del margen", () => {
  // Si cargando antes de salir se puede respetar el margen, se pide esa carga
  // en vez de aceptar una llegada por debajo del margen.
  it("pide cargar antes de salir para no llegar por debajo del margen", () => {
    const distance = 400;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle({ batteryKwh: 60, rangeKm: 400 }),
      conditions: conditions({ initialSoc: 40, arrivalSoc: 20, safetyMode: "normal" }),
      chargers: [chargerAt(120)],
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.departureCharge).toBeDefined();
    expect(plan.stops).toHaveLength(1);
    const stop = plan.stops[0]!;
    expect(stop.arriveSoc).toBeGreaterThanOrEqual(15);
    expect(stop.departSoc).toBeGreaterThan(stop.arriveSoc + 5);
    expect(stop.energyAddedKwh).toBeGreaterThan(0);
  });
});

describe("buildPlan — carga lenta cuando hace falta", () => {
  it("incluye el punto AC si es la única forma de completar, con su potencia y su energía", () => {
    const distance = 700;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle({ dcMaxKw: 120, acMaxKw: 7 }),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers: [100, 200, 300, 400, 500, 600].map((km) =>
        chargerAt(km, { sockets: [{ connector: "type2", powerKw: 22, count: 1 }] }),
      ),
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.feasible).toBe(true);
    expect(plan.stops.length).toBeGreaterThan(0);
    expect(
      plan.stops.every(
        (stop) =>
          stop.bestSocket.connector === "type2" &&
          stop.chargeKw === 7 &&
          stop.energyAddedKwh > 0 &&
          stop.chargeMinutes > 30 &&
          stop.departSoc > stop.arriveSoc,
      ),
    ).toBe(true);
  });

  it("usa el lento si el rápido queda fuera de alcance", () => {
    const distance = 400;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle({ batteryKwh: 60, rangeKm: 400, dcMaxKw: 120, acMaxKw: 11 }),
      conditions: conditions({ initialSoc: 35, arrivalSoc: 20, safetyMode: "normal" }),
      chargers: [
        chargerAt(80, { sockets: [{ connector: "type2", powerKw: 11, count: 1 }] }),
        chargerAt(340, { sockets: [{ connector: "ccs2", powerKw: 150, count: 1 }] }),
      ],
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.stops.length).toBeGreaterThan(0);
    expect(plan.stops[0]!.bestSocket.connector).toBe("type2");
    expect(plan.stops[0]!.chargeKw).toBe(11);
  });

  it("si hay AC y DC, la parada usa la potencia rápida limitada por el auto", () => {
    const distance = 700;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle({ dcMaxKw: 120, acMaxKw: 7 }),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers: [100, 200, 300, 400, 500, 600].map((km) =>
        chargerAt(km, {
          sockets: [
            { connector: "type2", powerKw: 7, count: 2 },
            { connector: "ccs2", powerKw: 150, count: 1 },
          ],
        }),
      ),
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.stops.length).toBeGreaterThan(0);
    expect(plan.stops.every((stop) => stop.bestSocket.connector === "ccs2" && stop.chargeKw === 120)).toBe(
      true,
    );
  });
});

describe("buildPlan — adaptadores definidos", () => {
  it("compara GB/T 50 kW y CCS1 40 kW hacia CCS2 y elige el más rápido", () => {
    const distance = 400;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle({
        batteryKwh: 60,
        rangeKm: 400,
        connectors: ["ccs2", "type2"],
        dcMaxKw: 120,
        acMaxKw: 11,
      }),
      conditions: conditions({ initialSoc: 35, arrivalSoc: 20, safetyMode: "normal" }),
      chargers: [
        chargerAt(100, {
          sockets: [
            { connector: "gb_t", powerKw: 50, count: 1 },
            { connector: "ccs1", powerKw: 40, count: 1 },
            { connector: "type2", powerKw: 11, count: 1 },
          ],
        }),
      ],
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.stops).toHaveLength(1);
    const stop = plan.stops[0]!;
    expect(stop.bestSocket.connector).toBe("gb_t");
    expect(stop.adapter).toEqual({ from: "gb_t", to: "ccs2" });
    expect(stop.chargeKw).toBe(50);
    expect(stop.options?.map((o) => [o.mode, o.socket.connector, o.nominalKw, o.chargeKw])).toEqual([
      ["adapter", "gb_t", 50, 50],
      ["adapter", "ccs1", 40, 40],
      ["ac", "type2", 11, 11],
    ]);
    expect(stop.options?.every((o) => o.energyAddedKwh > 0 && o.chargeMinutes > 0 && o.rangeGainKm > 0)).toBe(
      true,
    );
    expect(stop.options?.[0]?.chargeMinutes).toBeLessThan(stop.options?.[2]?.chargeMinutes ?? 0);
  });

  it("un CHAdeMO sin adaptador definido no se usa", () => {
    const distance = 400;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle({
        batteryKwh: 60,
        rangeKm: 400,
        connectors: ["ccs2", "type2"],
        dcMaxKw: 120,
        acMaxKw: 11,
      }),
      conditions: conditions({ initialSoc: 35, arrivalSoc: 20 }),
      chargers: [
        chargerAt(100, {
          sockets: [
            { connector: "chademo", powerKw: 50, count: 1 },
            { connector: "type2", powerKw: 11, count: 1 },
          ],
        }),
      ],
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.stops).toHaveLength(1);
    expect(plan.stops[0]!.bestSocket.connector).toBe("type2");
    expect(plan.stops[0]!.options?.some((o) => o.socket.connector === "chademo")).toBe(false);
  });
});

describe("buildPlan — viaje corto sin paradas", () => {
  it("un viaje de 100 km con batería de sobra no necesita paradas", () => {
    const plan = buildPlan({
      raw: straightRoute(100),
      vehicle: vehicle(),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers: [],
      weather: null,
      origin: ORIGIN,
      destination: DESTINATION_100,
    });
    expect(plan.feasible).toBe(true);
    expect(plan.stops).toHaveLength(0);
    expect(plan.canArriveWithoutCharge).toBe(true);
  });
});

describe("buildPlan — viaje largo con paradas", () => {
  it("un viaje de 700 km con cargadores verificados cada 100 km planea 1–2 paradas", () => {
    const distance = 700;
    const chargers = [100, 200, 300, 400, 500, 600].map((km) => chargerAt(km));
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle(),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers,
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.feasible).toBe(true);
    expect(plan.stops.length).toBeGreaterThanOrEqual(1);
    expect(plan.stops.length).toBeLessThanOrEqual(3);
    expect(plan.arrivalSoc).toBeGreaterThanOrEqual(conditions().arrivalSoc - 1);
  });

  it("sin cargadores verificados en el camino, sale el aviso NO_VERIFIED_STOP_REASON", () => {
    const distance = 700;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle(),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers: [],
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.feasible).toBe(false);
    expect(plan.infeasibleReason).toBe(NO_VERIFIED_STOP_REASON);
  });

  it("un cargador pendiente de aprobación no cuenta para el plan", () => {
    const distance = 700;
    const chargers = [100, 200, 300, 400, 500, 600].map((km) =>
      chargerAt(km, { source: "community", status: "pending" }),
    );
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle(),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20 }),
      chargers,
      weather: null,
      origin: ORIGIN,
      destination: { label: "Destino", lat: 4 + distance / 111, lon: -74 },
    });
    expect(plan.feasible).toBe(false);
  });
});

describe("rankPlans", () => {
  const distance = 700;
  const chargers = [100, 200, 300, 400, 500, 600].map((km) => chargerAt(km));
  const destination: Place = { label: "Destino", lat: 4 + distance / 111, lon: -74 };

  function planFor(mode: TripConditions["planningMode"]) {
    return buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle(),
      conditions: conditions({ planningMode: mode }),
      chargers,
      weather: null,
      origin: ORIGIN,
      destination,
    });
  }

  it("los planes factibles siempre van antes que los no factibles", () => {
    const feasible = planFor("fastest");
    const infeasible = { ...planFor("fastest"), feasible: false, id: "infeasible" };
    const ranked = rankPlans([infeasible, feasible], "fastest");
    expect(ranked[0]!.id).toBe(feasible.id);
  });

  it("el modo 'fastest' ordena por tiempo total ascendente", () => {
    const a = { ...planFor("fastest"), id: "a", totalMinutes: 500 };
    const b = { ...planFor("fastest"), id: "b", totalMinutes: 300 };
    const ranked = rankPlans([a, b], "fastest");
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("el modo 'efficient' ordena por energía consumida ascendente", () => {
    const a = { ...planFor("fastest"), id: "a", energyKwh: 80 };
    const b = { ...planFor("fastest"), id: "b", energyKwh: 60 };
    const ranked = rankPlans([a, b], "efficient");
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("el modo 'fewer_stops' ordena por número de paradas ascendente", () => {
    const a = { ...planFor("fastest"), id: "a", stops: [1, 2] as never };
    const b = { ...planFor("fastest"), id: "b", stops: [1] as never };
    const ranked = rankPlans([a, b], "fewer_stops");
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("el modo 'safer' ordena por SOC mínimo descendente", () => {
    const a = { ...planFor("fastest"), id: "a", minSoc: 10 };
    const b = { ...planFor("fastest"), id: "b", minSoc: 25 };
    const ranked = rankPlans([a, b], "safer");
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("rankPlans con jerarquía vial", () => {
  type P = Parameters<typeof rankPlans>[0][number];
  const base = { feasible: true, stops: [], energyKwh: 30, minSoc: 20, arrivalSoc: 20 };
  const shortcut = { ...base, id: "atajo", totalMinutes: 190, driveMinutes: 190, hierarchyFactor: 1.2, withinTolerance: true } as unknown as P;
  const trunk = { ...base, id: "troncal", totalMinutes: 205, driveMinutes: 205, hierarchyFactor: 1.0, withinTolerance: true } as unknown as P;

  it("en modo rápido no elige un atajo por vías menores solo porque ahorra minutos", () => {
    expect(rankPlans([shortcut, trunk], "fastest")[0]?.id).toBe("troncal");
  });

  it("una ruta fuera de la tolerancia solo gana si no hay otra", () => {
    const far = { ...trunk, id: "lejana", withinTolerance: false } as P;
    expect(rankPlans([far, shortcut], "fastest")[0]?.id).toBe("atajo");
  });

  it("sin clasificación (OSRM) se comporta como antes: gana la más rápida", () => {
    const a = { ...shortcut, hierarchyFactor: undefined } as P;
    const b = { ...trunk, hierarchyFactor: undefined } as P;
    expect(rankPlans([b, a], "fastest")[0]?.id).toBe("atajo");
  });
});

describe("rankPlans: menos vías menores antes que minutos", () => {
  type P = Parameters<typeof rankPlans>[0][number];
  const base = { feasible: true, stops: [], energyKwh: 30, minSoc: 20, arrivalSoc: 20, withinTolerance: true };
  it("gana la troncal aunque el atajo sea 30 min más rápido (ambas dentro de la tolerancia)", () => {
    const shortcut = { ...base, id: "atajo", totalMinutes: 310, driveMinutes: 310, hierarchyFactor: 1.05, minorRoadScore: 40 } as unknown as P;
    const trunk = { ...base, id: "troncal", totalMinutes: 340, driveMinutes: 340, hierarchyFactor: 1, minorRoadScore: 0 } as unknown as P;
    expect(rankPlans([shortcut, trunk], "fastest")[0]?.id).toBe("troncal");
  });
  it("con puntajes parecidos (< 2) decide el tiempo", () => {
    const a = { ...base, id: "a", totalMinutes: 300, driveMinutes: 300, minorRoadScore: 1 } as unknown as P;
    const b = { ...base, id: "b", totalMinutes: 320, driveMinutes: 320, minorRoadScore: 0 } as unknown as P;
    expect(rankPlans([b, a], "fastest")[0]?.id).toBe("a");
  });
});

describe("estilo de conducción: energía y tiempo", () => {
  const plan = (drivingStyle: "efficient" | "normal" | "sport", avgSpeedKmh: number | null = null) =>
    buildPlan({
      raw: straightRoute(100),
      vehicle: vehicle(),
      conditions: conditions({ initialSoc: 90, arrivalSoc: 20, drivingStyle, avgSpeedKmh }),
      chargers: [],
      weather: null,
      origin: ORIGIN,
      destination: DESTINATION_100,
    });

  it("deportiva gasta más y llega antes; eficiente gasta menos y tarda más", () => {
    const eff = plan("efficient");
    const nor = plan("normal");
    const spo = plan("sport");
    expect(eff.energyKwh).toBeLessThan(nor.energyKwh);
    expect(spo.energyKwh).toBeGreaterThan(nor.energyKwh);
    expect(eff.driveMinutes).toBeGreaterThan(nor.driveMinutes);
    expect(spo.driveMinutes).toBeLessThan(nor.driveMinutes);
    // Rangos del modelo: ≈ −10 % / +15 % de energía.
    expect(eff.energyKwh / nor.energyKwh).toBeGreaterThan(0.85);
    expect(eff.energyKwh / nor.energyKwh).toBeLessThan(0.97);
    expect(spo.energyKwh / nor.energyKwh).toBeGreaterThan(1.08);
    expect(spo.energyKwh / nor.energyKwh).toBeLessThan(1.22);
  });

  it("con velocidad media fija, el estilo no cambia el tiempo (sí la energía)", () => {
    const nor = plan("normal", 90);
    const spo = plan("sport", 90);
    expect(spo.driveMinutes).toBeCloseTo(nor.driveMinutes, 5);
    expect(spo.energyKwh).toBeGreaterThan(nor.energyKwh);
  });
});

function manualVehicle(kwhPer100: number, batteryKwh = 100): Vehicle {
  return vehicle({
    batteryKwh,
    rangeKm: (batteryKwh / kwhPer100) * 100,
    consumptionManual: true,
    consumptionKwhPer100km: kwhPer100,
    weightKg: 1800,
  });
}

function departureConditions(initialSoc: number): TripConditions {
  return conditions({
    initialSoc,
    passengers: 0,
    luggageKg: 0,
    ac: "off",
    temperatureC: 20,
    drivingStyle: "normal",
    avgSpeedKmh: 70,
    arrivalSoc: 10,
    safetyMode: "low",
  });
}

/** SOC que consume el tramo hasta `chargerKm`, con el mismo modelo que el plan. */
function legSocPct(raw: RawRoute, ev: Vehicle, cond: TripConditions, chargerKm: number): number {
  const speed = cond.avgSpeedKmh && cond.avgSpeedKmh > 10 ? cond.avgSpeedKmh : 70;
  const samples = raw.samples.map((s) => ({ ...s, speedKmh: speed }));
  const annotated = annotateEnergy(
    samples,
    { vehicle: ev, conditions: cond, weather: null, originAltitudeM: samples[0]?.elevM },
    100,
  );
  const idx = samples.findIndex((s) => Math.abs(s.km - chargerKm) < 0.05);
  return (energyBetween(annotated, 0, idx) / ev.batteryKwh) * 100;
}

describe("primera electrolinera verificada", () => {
  const destinationOf = (km: number): Place => ({ label: "Destino", lat: 4 + km / 111, lon: -74 });

  it("traduce el ejemplo: 35 % + 20 % llega; 35 % + 75 % no cabe en el 100 %", () => {
    expect(classifyFirstChargerCharge(35, 55)).toEqual({
      kind: "precharge",
      additionalPct: 20,
      requiredStartSoc: 55,
    });
    expect(classifyFirstChargerCharge(35, 110)).toEqual({ kind: "impossible" });
    expect(classifyFirstChargerCharge(35, 100)).toEqual({
      kind: "precharge",
      additionalPct: 65,
      requiredStartSoc: 100,
    });
    expect(classifyFirstChargerCharge(80, 40)).toEqual({ kind: "enough" });
  });

  it("redacta la recomendación con el porcentaje adicional", () => {
    expect(departureChargeAdvice(20)).toBe(
      "Antes de iniciar la ruta debes cargar al menos un 20% adicional para poder llegar al primer punto de carga.",
    );
    expect(departureChargeAdvice(12)).toBe(
      "Antes de iniciar la ruta debes cargar al menos un 12% adicional para poder llegar al primer punto de carga.",
    );
  });

  it("pide la carga adicional que falta según el consumo del tramo y sigue planificando", () => {
    const distance = 400;
    const chargerKm = 220;
    const ev = manualVehicle(20);
    const cond = departureConditions(15);
    const raw = straightRoute(distance);
    const plan = buildPlan({
      raw,
      vehicle: ev,
      conditions: cond,
      chargers: [chargerAt(chargerKm, { id: "real", name: "Electrolinera real" })],
      weather: null,
      origin: ORIGIN,
      destination: destinationOf(distance),
    });

    // El punto de llegada debe respetar el margen de seguridad, no solo evitar quedarse en 0 %.
    const needed = legSocPct(raw, ev, cond, chargerKm) + safetyPct(cond);
    const additional = Math.ceil(needed - cond.initialSoc - 1e-6);
    expect(additional).toBeGreaterThan(0);
    expect(cond.initialSoc + additional).toBeLessThanOrEqual(100);
    expect(plan.departureCharge).toEqual({
      currentSoc: 15,
      additionalPct: additional,
      requiredStartSoc: 15 + additional,
      chargerId: "real",
      chargerName: "Electrolinera real",
    });
    expect(plan.firstChargerUnreachable).toBeFalsy();
    expect(plan.feasible).toBe(true);
    expect(plan.stops.length).toBeGreaterThan(0);
    expect(plan.stops.every((stop) => stop.charger.id === "real")).toBe(true);
    expect(plan.stops[0]!.arriveSoc).toBeGreaterThanOrEqual(safetyPct(cond) - 1);
    expect(plan.initialSoc).toBe(15 + additional);
    expect(plan.geometry.length).toBeGreaterThan(1);
  });

  it("usa el consumo del vehículo, no una distancia fija", () => {
    const distance = 450;
    const chargerKm = 200;
    const raw = straightRoute(distance);
    const cond = departureConditions(10);
    const low = buildPlan({
      raw,
      vehicle: manualVehicle(15),
      conditions: cond,
      chargers: [chargerAt(chargerKm)],
      weather: null,
      origin: ORIGIN,
      destination: destinationOf(distance),
    });
    const high = buildPlan({
      raw,
      vehicle: manualVehicle(28),
      conditions: cond,
      chargers: [chargerAt(chargerKm)],
      weather: null,
      origin: ORIGIN,
      destination: destinationOf(distance),
    });
    expect(low.departureCharge?.additionalPct).toBeGreaterThan(0);
    expect(high.departureCharge!.additionalPct).toBeGreaterThan(low.departureCharge!.additionalPct);
  });

  it("una subida en el tramo exige más batería que el mismo kilometraje en llano", () => {
    const distance = 450;
    const chargerKm = 200;
    const ev = manualVehicle(18);
    const cond = departureConditions(10);
    const flat = straightRoute(distance);
    const climb = straightRoute(distance);
    climb.samples = climb.samples.map((s, i) => ({ ...s, elevM: i * 40 }));
    const args = {
      vehicle: ev,
      conditions: cond,
      chargers: [chargerAt(chargerKm)],
      weather: null,
      origin: ORIGIN,
      destination: destinationOf(distance),
    };
    const flatPlan = buildPlan({ ...args, raw: flat });
    const climbPlan = buildPlan({ ...args, raw: climb });
    expect(climbPlan.departureCharge!.additionalPct).toBeGreaterThan(flatPlan.departureCharge!.additionalPct);
  });

  it("ignora electrolineras no verificadas y no inventa un punto de carga", () => {
    const distance = 400;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: manualVehicle(20),
      conditions: departureConditions(15),
      chargers: [
        chargerAt(30, { id: "pending", source: "community", status: "pending" }),
        chargerAt(40, { id: "catalog", source: "catalog", verified: false }),
        chargerAt(220, { id: "real", name: "Verificada" }),
      ],
      weather: null,
      origin: ORIGIN,
      destination: destinationOf(distance),
    });
    expect(plan.departureCharge?.chargerId).toBe("real");
    expect(plan.stops.every((stop) => stop.charger.id === "real")).toBe(true);
  });

  it("sin electrolineras verificadas mantiene el aviso de que no hay punto real", () => {
    const distance = 500;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: manualVehicle(20),
      conditions: departureConditions(20),
      chargers: [chargerAt(120, { source: "community", status: "pending" })],
      weather: null,
      origin: ORIGIN,
      destination: destinationOf(distance),
    });
    expect(plan.firstChargerUnreachable).toBeFalsy();
    expect(plan.stops).toHaveLength(0);
    expect(plan.infeasibleReason).toBe(NO_VERIFIED_STOP_REASON);
  });

  it("no marca recarga previa si la batería actual ya llega a la primera electrolinera", () => {
    const distance = 400;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: manualVehicle(20),
      conditions: departureConditions(90),
      chargers: [chargerAt(40, { id: "cerca" })],
      weather: null,
      origin: ORIGIN,
      destination: destinationOf(distance),
    });
    expect(plan.departureCharge).toBeUndefined();
    expect(plan.firstChargerUnreachable).toBeFalsy();
    expect(plan.stops.length).toBeGreaterThan(0);
    expect(plan.feasible).toBe(true);
  });

  it("declara la ruta imposible si ni al 100 % se alcanza la primera electrolinera verificada", () => {
    const distance = 360;
    const plan = buildPlan({
      raw: straightRoute(distance),
      vehicle: manualVehicle(25, 60),
      conditions: departureConditions(35),
      chargers: [chargerAt(280, { id: "lejos", name: "Lejos" })],
      weather: null,
      origin: ORIGIN,
      destination: destinationOf(distance),
    });
    expect(plan.firstChargerUnreachable).toBe(true);
    expect(plan.feasible).toBe(false);
    expect(plan.stops).toEqual([]);
    expect(plan.departureCharge).toBeUndefined();
    expect(plan.infeasibleReason).toBe(FIRST_CHARGER_UNREACHABLE_REASON);
  });
});

describe("rankPlans: 'Más eficiente' también respeta la jerarquía vial", () => {
  type P = Parameters<typeof rankPlans>[0][number];
  const base = { feasible: true, stops: [], minSoc: 20, arrivalSoc: 20, withinTolerance: true, totalMinutes: 300, driveMinutes: 300 };
  it("no elige el atajo por vías menores solo porque gasta 1 kWh menos", () => {
    const shortcut = { ...base, id: "atajo", energyKwh: 39, minorRoadScore: 40 } as unknown as P;
    const trunk = { ...base, id: "troncal", energyKwh: 40, minorRoadScore: 0 } as unknown as P;
    expect(rankPlans([shortcut, trunk], "efficient")[0]?.id).toBe("troncal");
  });
});

describe("buildPlan — reserva con el mínimo recomendado del vehículo (C8)", () => {
  const distance = 400;
  const cond = conditions({ initialSoc: 50, safetyMode: "low", arrivalSoc: 10 });
  const destination: Place = { label: "Destino", lat: 4 + distance / 111, lon: -74 };
  // Cargador donde el vehículo llega con 10–15 %: entre el margen "bajo" y el mínimo del vehículo.
  const soc = annotateEnergy(
    straightRoute(distance).samples,
    { vehicle: vehicle(), conditions: cond, weather: null },
    cond.initialSoc,
  );
  const hit = soc.find((s) => s.soc < 14)!;
  const plan = (minSocRecommended: number) =>
    buildPlan({
      raw: straightRoute(distance),
      vehicle: vehicle({ minSocRecommended }),
      conditions: cond,
      chargers: [chargerAt(hit.km)],
      weather: null,
      origin: ORIGIN,
      destination,
    });

  it("el caso de prueba llega al cargador entre 10 y 15 %", () => {
    expect(hit.soc).toBeGreaterThanOrEqual(10);
    expect(hit.soc).toBeLessThan(15);
  });

  it("con mínimo del vehículo 10 % basta el margen bajo: no pide carga previa", () => {
    const p = plan(10);
    expect(p.safetyPct).toBe(10);
    expect(p.departureCharge).toBeUndefined();
    expect(p.stops[0]!.arriveSoc).toBeLessThan(15);
  });

  it("con mínimo del vehículo 15 % la reserva sube a 15 % y pide cargar antes de salir", () => {
    const p = plan(15);
    expect(p.safetyPct).toBe(15);
    expect(p.departureCharge).toBeDefined();
    expect(p.stops[0]!.arriveSoc).toBeGreaterThanOrEqual(15 - 1e-6);
  });

  it("usa el valor que el usuario haya puesto en el vehículo", () => {
    expect(plan(25).safetyPct).toBe(25);
  });
});
