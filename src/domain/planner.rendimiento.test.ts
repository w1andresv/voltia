import { describe, expect, it } from "vitest";
import { catalogVehicle } from "@/test-support/scenarios";
import {
  BENCH_CONDITIONS,
  BENCH_DESTINATION,
  BENCH_ORIGIN,
  benchChargers,
  benchRoute,
} from "@/test-support/planner-scenarios";
import type { PlannerRunStats } from "./plan/shared";
import { buildPlan } from "./planner";

/**
 * Presupuesto del planificador v2 (M1, ADR-0020): con 120 estaciones en el corredor
 * el trabajo debe seguir siendo de ese orden. Se mide en contadores, que no dependen de
 * la máquina; el tiempo solo tiene un tope holgado (antes de M1 eran ~3 s por ruta).
 */
function run(count: number, clustered: boolean) {
  const raw = benchRoute();
  const stats: PlannerRunStats = { stations: 0, runs: 0, expansions: 0, arrivals: 0, labelWrites: 0 };
  const t0 = performance.now();
  const plan = buildPlan({
    raw,
    vehicle: catalogVehicle("mg-s5-ev-comfort"),
    conditions: BENCH_CONDITIONS,
    chargers: benchChargers(raw, count, clustered),
    weather: null,
    origin: BENCH_ORIGIN,
    destination: BENCH_DESTINATION,
    engine: "v2",
    energyEngine: "v2",
    stats,
  });
  return { plan, stats, ms: performance.now() - t0 };
}

describe("rendimiento del planificador v2 con muchas estaciones", () => {
  it("120 estaciones agrupadas cerca del destino: trabajo y tiempo acotados", () => {
    const { plan, stats, ms } = run(120, true);
    expect(plan.feasible).toBe(true);
    expect(stats.stations).toBe(120);
    // Cada combinación (SOC inicial, tope) se resuelve una sola vez: cuatro como mucho.
    expect(stats.runs).toBeLessThanOrEqual(6);
    expect(stats.expansions).toBeLessThan(40_000);
    expect(stats.arrivals).toBeLessThan(180_000);
    // Las etiquetas de salida se arman una vez por (estación, nivel) y corrida, no por llegada.
    expect(stats.labelWrites).toBeLessThanOrEqual(stats.expansions + stats.runs);
    expect(ms).toBeLessThan(1500);
  }, 30_000);

  it("120 estaciones repartidas por la ruta", () => {
    const { plan, stats, ms } = run(120, false);
    expect(plan.feasible).toBe(true);
    expect(stats.runs).toBeLessThanOrEqual(6);
    expect(stats.expansions).toBeLessThan(40_000);
    expect(ms).toBeLessThan(1500);
  }, 30_000);

  it("sin acumulador no cambia nada: mismo plan", () => {
    const raw = benchRoute();
    const args = {
      raw,
      vehicle: catalogVehicle("mg-s5-ev-comfort"),
      conditions: BENCH_CONDITIONS,
      chargers: benchChargers(raw, 40, false),
      weather: null,
      origin: BENCH_ORIGIN,
      destination: BENCH_DESTINATION,
      engine: "v2" as const,
      energyEngine: "v2" as const,
    };
    const stats: PlannerRunStats = { stations: 0, runs: 0, expansions: 0, arrivals: 0, labelWrites: 0 };
    const a = buildPlan(args);
    const b = buildPlan({ ...args, stats });
    expect(b.stops.map((s) => [s.charger.id, s.departSoc])).toEqual(
      a.stops.map((s) => [s.charger.id, s.departSoc]),
    );
    expect(b.totalMinutes).toBe(a.totalMinutes);
  });
});
