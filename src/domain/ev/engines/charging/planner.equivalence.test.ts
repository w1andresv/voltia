import { describe, expect, it } from "vitest";
import type { EnergySample } from "@/domain/ev/contracts/energy";
import { walkSoc } from "@/domain/ev/engines/soc/simulate";
import {
  compareLabels,
  planCharging,
  requiredInitialCharge,
  type PlannerInput,
  type PlannerNode,
} from "./planner";
import {
  planChargingReference,
  requiredInitialChargeReference,
  type PlannerInputRef,
} from "./planner.reference";

/**
 * ADR-0020: el planificador optimizado (llegadas separadas de las cargas) debe dar
 * la misma viabilidad y el mismo costo óptimo que la copia congelada anterior a M1,
 * en cualquier combinación de estrategia, margen flexible, sesión mínima, tope
 * estirado y margen de carga rápida.
 */

const CAP = 100;

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Perfil con subidas y bajadas: algunas muestras regeneran más de lo que gastan. */
function hilly(rand: () => number, steps: number): EnergySample[] {
  let cum = 0;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const gross = i ? 0.15 + rand() * 1.5 : 0;
    const regen = i && rand() < 0.35 ? rand() * 2.4 : 0;
    cum += gross - regen;
    return {
      km: i,
      lat: 7 - i * 0.009,
      lon: -73,
      elevM: 0,
      slopePct: 0,
      speedKmh: 60,
      energyKwh: gross - regen,
      energyGrossKwh: gross,
      energyRegenKwh: regen,
      cumulativeKwh: cum,
      avgKwhPer100: 0,
    };
  });
}

const spentOf = (samples: EnergySample[]) => {
  const out = [0];
  for (let i = 1; i < samples.length; i++)
    out.push(out[i - 1]! + (samples[i]!.energyGrossKwh - samples[i]!.energyRegenKwh));
  return out;
};

/** Una estación con curva de carga que se frena al llenarse (como la curva real). */
function node(rand: () => number, sIdx: number): PlannerNode {
  const kw = 20 + rand() * 180;
  const knee = 55 + rand() * 25;
  const slow = 0.25 + rand() * 0.4;
  const at = (soc: number) => {
    const fast = Math.min(soc, knee);
    const tail = Math.max(0, soc - knee);
    return (fast / kw) * 60 + (tail / (kw * slow)) * 60;
  };
  const minSession = rand() < 0.5;
  const sessionMin = 6 + rand() * 8;
  return {
    sIdx,
    detourPct: rand() < 0.5 ? rand() * 2 : 0,
    detourKm: rand() * 4,
    detourKwh: rand() * 2,
    detourMin: rand() * 6,
    waitMin: rand() < 0.15 ? 15 : 0,
    chargeAt: at,
    connectionMin: 5,
    fast: rand() < 0.6,
    ...(minSession
      ? {
          minSessionSoc: (arrive: number) => {
            // SOC al que se llega cargando `sessionMin` minutos desde `arrive`.
            const target = at(arrive) + sessionMin;
            let lo = arrive;
            let hi = 100;
            for (let it = 0; it < 40; it++) {
              const mid = (lo + hi) / 2;
              if (at(mid) < target) lo = mid;
              else hi = mid;
            }
            return hi;
          },
        }
      : {}),
  };
}

const toRef = (input: PlannerInput): PlannerInputRef => ({
  ...input,
  nodes: input.nodes.map((n) => ({
    ...n,
    chargeMinutes: (from: number, to: number) =>
      to > from ? n.chargeAt(to) - n.chargeAt(from) + n.connectionMin : 0,
  })),
});

function randomInput(c: number): PlannerInput {
  const rand = rng(c * 7919 + 13);
  const objectives = ["fastest", "fewer_stops", "efficient", "safer", "custom"] as const;
  const steps = 60 + Math.floor(rand() * 170);
  const samples = hilly(rand, steps);
  const count = 2 + Math.floor(rand() * 18);
  const nodes = Array.from({ length: count }, () =>
    node(rand, 1 + Math.floor(rand() * (steps - 2))),
  ).sort((a, b) => a.sIdx - b.sIdx);
  const floor = 5 + rand() * 12;
  const soft = rand() < 0.45;
  const stretch = rand() < 0.4;
  return {
    samples,
    initialSocPct: 25 + rand() * 75,
    floorPct: soft ? floor - 3 : floor,
    destinationReservePct: soft ? floor - 3 : floor,
    ...(soft ? { softFloor: { pct: floor, penaltyMinPerPct: 4 } } : {}),
    maxChargePct: 80,
    ...(stretch ? { stretchChargePct: 90 } : {}),
    nodes,
    objective: objectives[c % objectives.length]!,
    walk: (from, start, visit) => walkSoc(samples, from, start, CAP, visit),
    ...(rand() < 0.5 ? { linear: { spentPct: spentOf(samples), fullRegenBelowPct: 80 } } : {}),
    gridPct: 1,
    tolerancePct: 1e-4,
    ...(rand() < 0.7 ? { fastChargeBuffer: { extraPct: 10, maxSocPct: 90 } } : {}),
  };
}

const costOf = (r: { objective: { stops: number; extraMinutes: number; penaltyMinutes: number; detourKm: number; detourKwh: number }; minSoc: number }) => ({
  stops: r.objective.stops,
  minutes: r.objective.extraMinutes,
  penalty: r.objective.penaltyMinutes,
  detourKm: r.objective.detourKm,
  detourKwh: r.objective.detourKwh,
  minSoc: r.minSoc,
});

describe("planCharging optimizado frente a la copia congelada (ADR-0020)", () => {
  it("misma viabilidad, mismo costo óptimo y mismas estaciones alcanzables (400 casos)", () => {
    let feasible = 0;
    let identicalPlans = 0;
    for (let c = 0; c < 400; c++) {
      const input = randomInput(c);
      const ref = planChargingReference(toRef(input));
      const now = planCharging(input);
      const where = `caso ${c} (${input.objective})`;
      expect(now.feasible, where).toBe(ref.feasible);
      expect(now.destinationShort, where).toBe(ref.destinationShort);
      expect(now.reachable, where).toEqual(ref.reachable);
      expect(now.furthestIdx, where).toBe(ref.furthestIdx);
      if (!ref.feasible) continue;
      feasible++;
      expect(compareLabels(costOf(now), costOf(ref), input.objective), where).toBe(0);
      expect(now.arrivalSoc, where).toBeCloseTo(ref.arrivalSoc, 6);
      const same =
        now.stops.length === ref.stops.length &&
        now.stops.every((s, i) => s.node === ref.stops[i]!.node && s.departSoc === ref.stops[i]!.departSoc);
      if (same) identicalPlans++;
      // El desempate (la llegada más antigua) reproduce el del oráculo: mismo plan, no solo mismo costo.
      expect(same, where).toBe(true);
    }
    expect(feasible).toBeGreaterThan(250);
    expect(identicalPlans).toBe(feasible);
  }, 120_000);

  it("la carga previa mínima es la misma", () => {
    let compared = 0;
    for (let c = 0; c < 120; c++) {
      const base = { ...randomInput(c + 5000), initialSocPct: 8 + (c % 25) };
      const ref = requiredInitialChargeReference(toRef(base));
      const now = requiredInitialCharge(base);
      expect(now?.additionalPct, `caso ${c}`).toBe(ref?.additionalPct);
      if (ref) compared++;
    }
    expect(compared).toBeGreaterThan(20);
  }, 120_000);

  it("cuenta el trabajo: llegadas guardadas y etiquetas de salida", () => {
    const r = planCharging(randomInput(3));
    expect(r.stats.expansions).toBeGreaterThan(0);
    expect(r.stats.arrivals).toBeGreaterThan(0);
    expect(r.stats.labelWrites).toBeGreaterThan(0);
  });
});
