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
    chargeAt: (soc) => (soc / kw) * 60,
    connectionMin: 0,
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

describe("planCharging — extra en carga rápida (fastChargeBuffer)", () => {
  const buffer = { fastChargeBuffer: { extraPct: 10, maxSocPct: 90 } };

  it("en la última parada, aunque sea rápida, carga solo lo necesario para el destino", () => {
    // Llega a la estación con 18 %; lo necesario para el destino con 10 % es salir con 24 %.
    // El extra es para no llegar justo a la siguiente parada; al destino solo se pide la reserva.
    const r = planCharging(input(profile(66), [node(52, 150, { fast: true })], buffer));
    expect(r.stops[0]).toMatchObject({ arriveSoc: 18, departSoc: 24 });
    expect(r.arrivalSoc).toBeCloseTo(10, 9);
  });

  it("en una estación lenta carga solo lo necesario", () => {
    const r = planCharging(input(profile(66), [node(52, 7, { fast: false })], buffer));
    expect(r.stops[0]!.departSoc).toBe(24);
  });

  it("entre dos estaciones: sale de la rápida con lo necesario para llegar a la siguiente con 10 de más", () => {
    // Sin extra: 70 % → llega a la primera (km 55) con 15 %, sale con lo justo hasta la segunda.
    const samples = profile(140);
    const nodes = [node(55, 150, { fast: true }), node(115, 150, { fast: true })];
    const r = planCharging(input(samples, nodes, buffer));
    expect(r.feasible).toBe(true);
    expect(r.stops).toHaveLength(2);
    // A la segunda parada llega con 10 de más; al destino, con la reserva.
    expect(r.stops[1]!.arriveSoc).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(r.arrivalSoc).toBeCloseTo(10, 9);
  });

  it("el extra no pasa del tope de carga del vehículo ni del 90 %", () => {
    // Llega a la primera (km 60) con 10 %; para llegar a la segunda (km 125) con el piso hace falta 75 %.
    // El destino queda lejos (km 170): hay que parar en las dos.
    const samples = profile(170);
    const nodes = [node(60, 150, { fast: true }), node(125, 150, { fast: true })];
    expect(
      planCharging(input(samples, nodes, { ...buffer, maxChargePct: 80 })).stops[0]!.departSoc,
    ).toBe(80);
    expect(
      planCharging(input(samples, nodes, { ...buffer, maxChargePct: 100 })).stops[0]!.departSoc,
    ).toBe(85);
    // Segunda parada en el km 138: lo necesario es 88 %, y el extra se corta en 90 %.
    const far = [node(60, 150, { fast: true }), node(138, 150, { fast: true })];
    const near = planCharging(input(profile(180), far, { ...buffer, maxChargePct: 100 }));
    expect(near.stops[0]!.departSoc).toBe(90);
  });

  it("si lo necesario ya pasa del 90 %, carga solo eso y el plan sigue siendo viable", () => {
    // Llega con 10 %; lo necesario es 95 %.
    const r = planCharging(
      input(profile(145), [node(60, 150, { fast: true })], { ...buffer, maxChargePct: 100 }),
    );
    expect(r.feasible).toBe(true);
    expect(r.stops[0]!.departSoc).toBe(95);
    expect(r.arrivalSoc).toBeCloseTo(10, 9);
  });

  it("no cambia la salida del origen ni un viaje que llega sin cargar", () => {
    const r = planCharging(input(profile(50), [node(20, 150, { fast: true })], buffer));
    expect(r.stops).toEqual([]);
    expect(r.arrivalSoc).toBe(20);
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

describe("atajo lineal (linear)", () => {
  // Generador determinista para casos aleatorios reproducibles.
  function rng(seed: number) {
    let x = seed >>> 0;
    return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  /** Perfil con subidas y bajadas: algunas muestras regeneran más de lo que gastan. */
  function hilly(rand: () => number, steps: number): EnergySample[] {
    let cum = 0;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const gross = i ? rand() * 1.6 : 0;
      const regen = i && rand() < 0.35 ? rand() * 2.4 : 0;
      cum += gross - regen;
      return { ...profile(steps)[i]!, energyKwh: gross - regen, energyGrossKwh: gross, energyRegenKwh: regen, cumulativeKwh: cum };
    });
  }
  const spentOf = (samples: EnergySample[]) => {
    const out = [0];
    for (let i = 1; i < samples.length; i++) out.push(out[i - 1]! + (samples[i]!.energyGrossKwh - samples[i]!.energyRegenKwh));
    return out;
  };

  it("da el mismo plan que recorrer muestra por muestra (500 casos aleatorios)", () => {
    const objectives = ["fastest", "fewer_stops", "efficient", "safer"] as const;
    for (let c = 0; c < 500; c++) {
      const rand = rng(c + 1);
      const steps = 60 + Math.floor(rand() * 160);
      const samples = hilly(rand, steps);
      const nodes = Array.from({ length: 2 + Math.floor(rand() * 10) }, () =>
        node(1 + Math.floor(rand() * (steps - 2)), 20 + rand() * 200, { fast: rand() < 0.6, detourPct: rand() * 2 }),
      ).sort((a, b) => a.sIdx - b.sIdx);
      const base = input(samples, nodes, {
        initialSocPct: 20 + rand() * 80,
        maxChargePct: rand() < 0.5 ? 80 : 100,
        objective: objectives[c % objectives.length],
        fastChargeBuffer: rand() < 0.7 ? { extraPct: 10, maxSocPct: 90 } : undefined,
      });
      const slow = planCharging(base);
      const fast = planCharging({ ...base, linear: { spentPct: spentOf(samples), fullRegenBelowPct: 80 } });
      const where = `caso ${c}`;
      expect(fast.feasible, where).toBe(slow.feasible);
      expect(fast.stops.map((s) => [s.node, s.departSoc]), where).toEqual(slow.stops.map((s) => [s.node, s.departSoc]));
      fast.stops.forEach((s, i) => expect(s.arriveSoc, where).toBeCloseTo(slow.stops[i]!.arriveSoc, 9));
      if (slow.feasible) expect(fast.arrivalSoc, where).toBeCloseTo(slow.arrivalSoc, 9);
      expect(fast.reachable, where).toEqual(slow.reachable);
      expect(fast.furthestIdx, where).toBe(slow.furthestIdx);
      expect(fast.destinationShort, where).toBe(slow.destinationShort);
    }
  }, 60_000);
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
