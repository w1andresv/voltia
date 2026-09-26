import { describe, expect, it } from "vitest";
import type { EnergySample } from "@/domain/ev/contracts/energy";
import { walkSoc } from "@/domain/ev/engines/soc/simulate";
import { compareLabels, planCharging, requiredInitialCharge, type PlannerInput, type PlannerNode } from "./planner";

// Batería de 100 kWh: 1 kWh = 1 punto de SOC. Cada muestra gasta `perStep` kWh.
const CAP = 100;

function profile(steps: number, perStep = 1): EnergySample[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    km: i,
    lat: 7 - i * 0.009,
    lon: -73,
    elevM: 0,
    slopePct: 0,
    speedKmh: 60,
    energyKwh: i ? perStep : 0,
    energyGrossKwh: i ? perStep : 0,
    energyRegenKwh: 0,
    cumulativeKwh: i * perStep,
    avgKwhPer100: 0,
  }));
}

/** Estación con potencia constante `kw` (minutos = puntos × 60 / kw con 100 kWh). */
function node(sIdx: number, kw = 60, extra: Partial<PlannerNode> = {}): PlannerNode {
  return {
    sIdx,
    detourPct: 0,
    detourKm: 0,
    detourKwh: 0,
    detourMin: 0,
    waitMin: 0,
    chargeMinutes: (from, to) => (to > from ? ((to - from) / kw) * 60 : 0),
    ...extra,
  };
}

function input(samples: EnergySample[], nodes: PlannerNode[], over: Partial<PlannerInput> = {}): PlannerInput {
  return {
    samples,
    initialSocPct: 70,
    floorPct: 10,
    destinationReservePct: 10,
    maxChargePct: 80,
    nodes,
    objective: "fastest",
    walk: (from, start, visit) => walkSoc(samples, from, start, CAP, visit),
    gridPct: 1,
    tolerancePct: 1e-6,
    ...over,
  };
}

describe("planCharging", () => {
  it("sin paradas si se llega al destino con la reserva", () => {
    const r = planCharging(input(profile(50), [node(20)]));
    expect(r.feasible).toBe(true);
    expect(r.stops).toEqual([]);
    expect(r.arrivalSoc).toBe(20);
  });

  it("ejemplo A/B/C de la especificación: una sola parada basta, y en C si es la más rápida", () => {
    // SOC 70 %, reserva 10 %: A llega con 55, B con 35, C con 18 y el destino con 4 sin cargar.
    const samples = profile(66);
    const nodes = [node(15, 50), node(35, 50), node(52, 150)];
    const r = planCharging(input(samples, nodes));
    expect(r.feasible).toBe(true);
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]).toMatchObject({ node: 2, arriveSoc: 18, departSoc: 24 });
    expect(r.arrivalSoc).toBeCloseTo(10, 9);
  });

  it("carga lo mínimo necesario para el siguiente tramo", () => {
    const r = planCharging(input(profile(66), [node(52)]));
    expect(r.stops[0]!.departSoc).toBe(24);
  });

  it("nunca llega a una estación ni al destino por debajo del piso", () => {
    // La primera estación queda a 65 %: se llega con 5 % < 10 %.
    const r = planCharging(input(profile(100), [node(65)]));
    expect(r.feasible).toBe(false);
    expect(r.reachable).toEqual([]);
  });

  it("menos paradas: prefiere una parada larga a dos cortas aunque tarde más", () => {
    // Dos estaciones rápidas (150 kW) y una lenta (20 kW) a mitad de camino.
    const samples = profile(100);
    const nodes = [node(40, 150), node(60, 20), node(80, 150)];
    const fastest = planCharging(input(samples, nodes, { initialSocPct: 50 }));
    const fewer = planCharging(input(samples, nodes, { initialSocPct: 50, objective: "fewer_stops" }));
    expect(fewer.stops.length).toBeLessThanOrEqual(fastest.stops.length);
    expect(fewer.objective.stops).toBe(1);
  });

  it("más segura: maximiza el SOC mínimo del viaje", () => {
    const samples = profile(66);
    const nodes = [node(15), node(35), node(52)];
    const safer = planCharging(input(samples, nodes, { objective: "safer" }));
    const fastest = planCharging(input(samples, nodes));
    expect(safer.minSoc).toBeGreaterThanOrEqual(fastest.minSoc);
  });

  it("una estación ocupada suma su espera; el desvío resta SOC al llegar", () => {
    const samples = profile(66);
    const busy = node(52, 150, { waitMin: 30 });
    const other = node(50, 60);
    const r = planCharging(input(samples, [other, busy]));
    expect(r.stops[0]!.node).toBe(0);
    const withDetour = planCharging(input(samples, [node(52, 60, { detourPct: 3, detourKm: 4, detourMin: 5 })]));
    expect(withDetour.stops[0]!.arriveSoc).toBeCloseTo(15, 9);
    expect(withDetour.objective.detourKm).toBe(4);
  });

  it("informa si se llega al último tramo pero sin la reserva al destino", () => {
    // Llega al destino con 15 %: sobre el piso (10 %) pero bajo la reserva pedida (20 %).
    const r = planCharging(input(profile(70), [], { initialSocPct: 85, destinationReservePct: 20 }));
    expect(r.feasible).toBe(false);
    expect(r.destinationShort).toBe(true);
  });
});

describe("compareLabels", () => {
  const a = { stops: 1, minutes: 30, detourKm: 2, detourKwh: 0.5, minSoc: 12 };
  const b = { stops: 2, minutes: 20, detourKm: 1, detourKwh: 0.2, minSoc: 15 };
  it("cada estrategia ordena por su criterio principal", () => {
    expect(compareLabels(a, b, "fastest")).toBeGreaterThan(0);
    expect(compareLabels(a, b, "custom")).toBeGreaterThan(0);
    expect(compareLabels(a, b, "fewer_stops")).toBeLessThan(0);
    expect(compareLabels(a, b, "efficient")).toBeGreaterThan(0);
    expect(compareLabels(a, b, "safer")).toBeGreaterThan(0);
  });
  it("con empate en el primero, decide el siguiente", () => {
    expect(compareLabels({ ...a, minutes: 20 }, b, "fastest")).toBeLessThan(0);
  });
});

describe("requiredInitialCharge", () => {
  it("SOC actual 20 %, SOC requerido 34 %: faltan 14 puntos (especificación §8.3)", () => {
    const r = requiredInitialCharge(input(profile(24), [], { initialSocPct: 20 }));
    expect(r).not.toBeNull();
    expect(r!.additionalPct).toBe(14);
    expect(r!.startSoc).toBe(34);
    expect(r!.result.feasible).toBe(true);
  });

  it("con SOC decimal redondea los puntos hacia arriba", () => {
    const r = requiredInitialCharge(input(profile(24), [], { initialSocPct: 20.5 }));
    expect(r!.additionalPct).toBe(14);
    expect(r!.startSoc).toBe(34.5);
  });

  it("null si ni al 100 % hay plan", () => {
    expect(requiredInitialCharge(input(profile(150), [], { initialSocPct: 20 }))).toBeNull();
  });
});

describe("rendimiento", () => {
  it("30 estaciones en 220 muestras en menos de 400 ms", () => {
    const samples = profile(220, 0.9);
    const nodes = Array.from({ length: 30 }, (_, i) => node(5 + i * 7, i % 3 === 0 ? 150 : 50));
    const t0 = performance.now();
    const r = planCharging(input(samples, nodes, { initialSocPct: 60 }));
    const ms = performance.now() - t0;
    expect(r.feasible).toBe(true);
    expect(ms).toBeLessThan(400);
  });
});
